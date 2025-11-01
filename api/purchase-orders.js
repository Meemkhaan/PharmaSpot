const express = require('express');
const Datastore = require('@seald-io/nedb');
const path = require('path');
const moment = require('moment');
const app = express();

// Get app data directory
const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
const appName = process.env.APPNAME || 'PharmaSpot';

// Initialize databases
const purchaseOrdersDB = new Datastore({
    filename: path.join(appData, appName, "server", "databases", "purchase-orders.db"),
    autoload: true,
});

// Flag to track if inventory database is ready
let inventoryDBReady = false;

const inventoryDB = new Datastore({
    filename: path.join(appData, appName, "server", "databases", "inventory.db"),
    autoload: true,
    onload: function(err) {
        if (err) {
            console.error('Inventory database load error in purchase-orders:', err);
            if (err.code === 'ENOENT') {
                console.log('Inventory database file missing - will be created on first write');
            }
            inventoryDBReady = true;
        } else {
            console.log('Inventory database loaded successfully in purchase-orders');
            inventoryDBReady = true;
        }
    }
});

// Ensure database is ready after a short delay (for autoload completion)
setTimeout(() => {
    if (!inventoryDBReady) {
        console.log('Inventory database autoload taking longer than expected - marking as ready');
        inventoryDBReady = true;
    }
}, 1000);

const suppliersDB = new Datastore({
    filename: path.join(appData, appName, "server", "databases", "suppliers.db"),
    autoload: true,
});

// Helpful indexes to speed up auto-draft queries
try {
    inventoryDB.ensureIndex({ fieldName: 'quantity' });
    inventoryDB.ensureIndex({ fieldName: 'minStock' });
    inventoryDB.ensureIndex({ fieldName: 'reorderPoint' });
    inventoryDB.ensureIndex({ fieldName: 'expiryDate' });
} catch (e) {
    console.log('Index ensure warning (inventory):', e.message);
}

// Batches database for lot-level inventory tracking
const inventoryBatchesDB = new Datastore({
    filename: path.join(appData, appName, "server", "databases", "inventory-batches.db"),
    autoload: true,
});

// Generate PO number
function generatePONumber() {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `PO${year}${month}${day}${random}`;
}

// Global flag to prevent concurrent auto-draft calls
let isAutoDraftRunning = false;
let lastAutoDraftTime = null;

// Reset any stuck flags on startup
console.log('🔄 Checking for stuck auto-draft flags on startup...');
if (isAutoDraftRunning) {
    console.log('🔄 Auto-draft flag was stuck, resetting...');
    isAutoDraftRunning = false;
    lastAutoDraftTime = null;
}
console.log('✅ Auto-draft flags initialized');

/**
 * GET batches by productId
 */
app.get("/batches/by-product/:productId", function (req, res) {
    const productId = parseInt(req.params.productId);
    inventoryBatchesDB.find({ productId: productId }, function (err, batches) {
        if (err) {
            console.error('Error fetching batches:', err);
            return res.status(500).json({ success: false, message: 'Failed to fetch batches' });
        }
        res.json({ success: true, batches });
    });
});

/**
 * GET endpoint: Get all purchase orders.
 */
app.get("/", function (req, res) {
    purchaseOrdersDB.find({}, function (err, orders) {
        if (err) {
            console.error("Error fetching purchase orders:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to fetch purchase orders."
            });
            return;
        }
        
        res.json(orders);
    });
});

/**
 * GET endpoint: Get all purchase orders (alternative route).
 */
app.get("/all", function (req, res) {
    purchaseOrdersDB.find({}, function (err, orders) {
            if (err) {
                console.error("Error fetching purchase orders:", err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "Failed to fetch purchase orders."
                });
                return;
            }
            
            res.json(orders);
        });
});

/**
 * GET endpoint: Get a specific purchase order by ID.
 */
app.get("/:id", function (req, res) {
    const orderId = parseInt(req.params.id);
    
    purchaseOrdersDB.findOne({ _id: orderId }, function (err, order) {
        if (err) {
            console.error("Error fetching purchase order:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to fetch purchase order."
            });
            return;
        }
        
        if (!order) {
            res.status(404).json({
                error: "Not Found",
                message: "Purchase order not found."
            });
            return;
        }
        
        res.json(order);
    });
});

/**
 * DELETE endpoint: Delete a purchase order by ID.
 */
app.delete("/:id", function (req, res) {
    const orderId = parseInt(req.params.id);
    console.log('=== DELETE PURCHASE ORDER ===');
    console.log('Order ID:', orderId);
    
    // First check if the order exists
    purchaseOrdersDB.findOne({ _id: orderId }, function (err, order) {
        if (err) {
            console.error("Error finding purchase order:", err);
            return res.status(500).json({
                success: false,
                error: "Internal Server Error",
                message: "Failed to find purchase order."
            });
        }
        
        if (!order) {
            return res.status(404).json({
                success: false,
                error: "Not Found",
                message: "Purchase order not found."
            });
        }
        
        // Delete the purchase order
        purchaseOrdersDB.remove({ _id: orderId }, { multi: false }, function (err, numRemoved) {
        if (err) {
                console.error("Error deleting purchase order:", err);
                return res.status(500).json({
                    success: false,
                error: "Internal Server Error",
                    message: "Failed to delete purchase order."
                });
            }
            
            if (numRemoved === 0) {
                return res.status(404).json({
                    success: false,
                    error: "Not Found",
                    message: "Purchase order not found."
                });
            }
            
            console.log(`Purchase order ${orderId} deleted successfully`);
            res.json({
            success: true,
                message: "Purchase order deleted successfully",
                deletedId: orderId
            });
        });
    });
});

/**
 * PUT endpoint: Update an existing purchase order.
 */
app.put("/:id", function (req, res) {
    const orderId = parseInt(req.params.id);
    const orderData = req.body;
    
    console.log('=== UPDATE PURCHASE ORDER API ENDPOINT HIT ===');
    console.log('Order ID:', orderId);
    console.log('Request method:', req.method);
    console.log('Request URL:', req.url);
    console.log('Request body:', orderData);
    
    // Check if this is a status-only update
    const isStatusOnlyUpdate = Object.keys(orderData).length === 1 && orderData.hasOwnProperty('status');
    
    // Validate required fields only for full updates
    if (!isStatusOnlyUpdate && (!orderData.supplierId || !orderData.items || !Array.isArray(orderData.items) || orderData.items.length === 0)) {
        console.log('Validation failed:', {
            supplierId: orderData.supplierId,
            items: orderData.items,
            isArray: Array.isArray(orderData.items),
            length: orderData.items ? orderData.items.length : 'undefined'
        });
        return res.status(400).json({
            success: false,
            error: "Validation Error",
            message: "Supplier ID and items are required for full updates."
        });
    }
    
    // First check if the order exists
    purchaseOrdersDB.findOne({ _id: orderId }, function (err, existingOrder) {
        if (err) {
            console.error("Error finding purchase order:", err);
            return res.status(500).json({
                success: false,
                error: "Internal Server Error",
                message: "Failed to find purchase order."
            });
        }
        
        if (!existingOrder) {
            return res.status(404).json({
                success: false,
                error: "Not Found",
                message: "Purchase order not found."
            });
        }
        
        // Prepare update data based on update type
        let updateData;
        
        if (isStatusOnlyUpdate) {
            // Status-only update
            console.log('Processing status-only update');
            updateData = {
                status: orderData.status,
                updatedAt: new Date(),
                updatedBy: orderData.updatedBy || 'user'
            };
            
            // Add sentAt timestamp if status is being changed to 'sent'
            if (orderData.status === 'sent' && existingOrder.status !== 'sent') {
                updateData.sentAt = new Date();
            }
        } else {
            // Full update - calculate totals
            let subtotal = 0;
            let totalItems = 0;
            
            console.log('Processing items for totals calculation...');
            orderData.items.forEach((item, index) => {
                console.log(`Item ${index}:`, item);
                const itemTotal = (item.quantity || 0) * (item.unitPrice || 0);
                subtotal += itemTotal;
                totalItems += (item.quantity || 0);
            });
            
            console.log('Calculated totals:', { subtotal, totalItems });
            
            updateData = {
                supplierId: orderData.supplierId,
                supplierName: orderData.supplierName || existingOrder.supplierName,
                status: orderData.status || existingOrder.status,
                items: orderData.items,
                subtotal: subtotal,
                tax: orderData.tax || existingOrder.tax || 0,
                discount: orderData.discount || existingOrder.discount || 0,
                total: subtotal + (orderData.tax || existingOrder.tax || 0) - (orderData.discount || existingOrder.discount || 0),
                totalItems: totalItems,
                notes: orderData.notes || existingOrder.notes || '',
                expectedDeliveryDate: orderData.expectedDeliveryDate ? new Date(orderData.expectedDeliveryDate) : existingOrder.expectedDeliveryDate,
                updatedAt: new Date(),
                updatedBy: orderData.updatedBy || 'user'
            };
        }
        
        console.log('Updating purchase order with data:', updateData);
        
        // Update the purchase order
        purchaseOrdersDB.update(
            { _id: orderId },
            { $set: updateData },
            {},
            function (err, numReplaced) {
                if (err) {
                    console.error("Error updating purchase order:", err);
                    return res.status(500).json({
                        success: false,
                        error: "Internal Server Error",
                        message: "Failed to update purchase order."
                    });
                }
                
                if (numReplaced === 0) {
                    return res.status(404).json({
                        success: false,
                        error: "Not Found",
                        message: "Purchase order not found."
                    });
                }
                
                console.log("Purchase order updated successfully:", orderId);
                res.json({
                    success: true,
                    message: "Purchase order updated successfully",
                    order: { _id: orderId, ...updateData }
                });
            }
        );
    });
});

/**
 * POST endpoint: Create a new purchase order.
 */
app.post("/", function (req, res) {
    console.log('=== PURCHASE ORDER API ENDPOINT HIT ===');
    console.log('Request method:', req.method);
    console.log('Request URL:', req.url);
    console.log('Request headers:', req.headers);
    console.log('Request body type:', typeof req.body);
    console.log('Request body:', req.body);
    
    const orderData = req.body;
    
    console.log('=== PURCHASE ORDER API RECEIVED ===');
    console.log('Order data:', orderData);
    console.log('Supplier ID:', orderData.supplierId);
    console.log('Items:', orderData.items);
    console.log('Items type:', typeof orderData.items);
    console.log('Items is array:', Array.isArray(orderData.items));
    console.log('Items length:', orderData.items ? orderData.items.length : 'undefined');
    console.log('=== END API DEBUG ===');
    
    // Validate required fields
    if (!orderData.supplierId || !orderData.items || !Array.isArray(orderData.items) || orderData.items.length === 0) {
        console.log('Validation failed:', {
            supplierId: orderData.supplierId,
            items: orderData.items,
            isArray: Array.isArray(orderData.items),
            length: orderData.items ? orderData.items.length : 'undefined'
        });
        return res.status(400).json({
            error: "Validation Error",
            message: "Supplier ID and items are required."
        });
    }
    
    // Generate PO number
    const poNumber = generatePONumber();
    
    // Calculate totals
    let subtotal = 0;
    let totalItems = 0;
    
    console.log('Processing items for totals calculation...');
    orderData.items.forEach((item, index) => {
        console.log(`Item ${index}:`, item);
        const itemTotal = (item.quantity || 0) * (item.unitPrice || 0);
        subtotal += itemTotal;
        totalItems += (item.quantity || 0);
    });
    
    console.log('Calculated totals:', { subtotal, totalItems });
    
    const purchaseOrder = {
        _id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000),
        poNumber: poNumber,
        supplierId: orderData.supplierId,
        supplierName: orderData.supplierName || 'Unknown Supplier',
        status: orderData.status || 'draft',
        items: orderData.items,
        subtotal: subtotal,
        tax: orderData.tax || 0,
        discount: orderData.discount || 0,
        total: subtotal + (orderData.tax || 0) - (orderData.discount || 0),
        totalItems: totalItems,
        notes: orderData.notes || '',
        expectedDeliveryDate: orderData.expectedDeliveryDate ? new Date(orderData.expectedDeliveryDate) : moment().add(7, 'days').toDate(),
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: orderData.createdBy || 'user',
        sentAt: null,
        receivedAt: null,
        completedAt: null,
        poType: orderData.poType || 'standard',
        supplierAssignmentMethod: orderData.supplierAssignmentMethod || 'manual'
    };
    
    console.log('Creating purchase order:', purchaseOrder);
    
    purchaseOrdersDB.insert(purchaseOrder, function (err, savedOrder) {
        if (err) {
            console.error("Error creating purchase order:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to create purchase order."
            });
            return;
        }
        
        console.log("Purchase order created successfully:", savedOrder.poNumber);
        res.json({
            success: true,
            message: "Purchase order created successfully",
            order: savedOrder
        });
    });
});

/**
 * POST endpoint: Receive items for a purchase order.
 */
app.post("/:id/receive", function (req, res) {
    const orderId = parseInt(req.params.id);
    const receiveData = req.body;
    
    console.log('=== RECEIVE ITEMS API DEBUG ===');
    console.log('Order ID:', orderId);
    console.log('Request body:', receiveData);
    console.log('receiveData.items:', receiveData.items);
    console.log('receiveData.items type:', typeof receiveData.items);
    console.log('receiveData.items is array:', Array.isArray(receiveData.items));
    console.log('receiveData.items length:', receiveData.items ? receiveData.items.length : 'undefined');
    console.log('=== END API DEBUG ===');
    
    // Validate required fields
    if (!receiveData.items || !Array.isArray(receiveData.items)) {
        console.log('Validation failed - items not found or not array');
        return res.status(400).json({
            error: "Validation Error",
            message: "Items to receive are required."
        });
    }

    // Basic normalization for numeric strings
    receiveData.items = receiveData.items.map(it => ({
        ...it,
        quantity: parseInt(it.quantity) || 0,
        barcode: it.barcode ? parseInt(it.barcode) : null,
        purchasePrice: it.purchasePrice !== undefined && it.purchasePrice !== null && it.purchasePrice !== '' ? parseFloat(it.purchasePrice) : null,
        sellingPrice: it.sellingPrice !== undefined && it.sellingPrice !== null && it.sellingPrice !== '' ? parseFloat(it.sellingPrice) : null,
    }));
    
    // Find the purchase order
    purchaseOrdersDB.findOne({ _id: orderId }, function (err, order) {
        if (err) {
            console.error("Error finding purchase order:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to process receipt."
            });
            return;
        }
        
        if (!order) {
            res.status(404).json({
                error: "Not Found",
                message: "Purchase order not found."
            });
            return;
        }
        
        if (order.status === 'completed') {
            res.status(400).json({
                error: "Bad Request",
                message: "Cannot receive items for completed purchase order."
            });
            return;
        }
        
        // Process received items
        let allItemsReceived = true;
        let hasPartialReceipt = false;
        
        order.items.forEach(item => {
            // Try to match by productId; if missing, fallback to barcode or productName
            let receivedItem = receiveData.items.find(ri => ri.productId === item.productId);
            if (!receivedItem) {
                if (!item.productId && item.barcode) {
                    const itemBarcode = parseInt(item.barcode);
                    receivedItem = receiveData.items.find(ri => ri.barcode && parseInt(ri.barcode) === itemBarcode) || receivedItem;
                }
                if (!receivedItem && item.productName) {
                    const nameLower = String(item.productName).toLowerCase();
                    receivedItem = receiveData.items.find(ri => String(ri.productName || '').toLowerCase() === nameLower) || receivedItem;
                }
            }
            if (receivedItem) {
                const receivedQuantity = parseInt(receivedItem.quantity) || 0;
                const currentReceived = parseInt(item.receivedQuantity) || 0;
                const newReceived = currentReceived + receivedQuantity;
                
                item.receivedQuantity = newReceived;
                item.lotNumber = receivedItem.lotNumber || item.lotNumber;
                item.expiryDate = receivedItem.expiryDate || item.expiryDate;
                // Backfill missing productId on the order item if available
                if (!item.productId && receivedItem.productId) {
                    item.productId = receivedItem.productId;
                }

                // Upsert batch record (productId + lotNumber + barcode)
                const batchQuery = {
                    productId: item.productId,
                    lotNumber: receivedItem.lotNumber || '',
                    barcode: receivedItem.barcode ? parseInt(receivedItem.barcode) : (item.barcode || null),
                };
                const batchUpdate = {
                    $set: {
                        productId: item.productId,
                        productName: item.productName,
                        lotNumber: receivedItem.lotNumber || '',
                        barcode: batchQuery.barcode || null,
                        expiryDate: receivedItem.expiryDate || null,
                        purchasePrice: receivedItem.purchasePrice ? parseFloat(receivedItem.purchasePrice) : (item.unitPrice || null),
                        sellingPrice: receivedItem.sellingPrice ? parseFloat(receivedItem.sellingPrice) : null,
                        supplierId: order.supplierId || null,
                        supplierName: order.supplierName || null,
                        updatedAt: new Date()
                    },
                    $inc: { quantity: receivedQuantity }
                };
                inventoryBatchesDB.update(batchQuery, batchUpdate, { upsert: true }, function (batchErr) {
                    if (batchErr) {
                        console.error('Failed to upsert inventory batch:', batchErr);
                    }
                });

                // Update or create product in inventory
                inventoryDB.findOne({ _id: item.productId }, function (findErr, product) {
                    if (findErr) {
                        console.error('Failed to find product for inventory update:', findErr);
                        return;
                    }
                    
                    if (!product) {
                        // Product doesn't exist - create it from PO item data
                        console.log(`⚠️ Product ${item.productId} not found in inventory - creating new product`);
                        
                        // Use barcode from received item or PO item
                        const productBarcode = receivedItem.barcode ? parseInt(receivedItem.barcode) : 
                                             (item.barcode ? parseInt(item.barcode) : item.productId);
                        
                        // Check if product with same barcode already exists
                        inventoryDB.findOne({ barcode: productBarcode }, function (barcodeErr, existingByBarcode) {
                            if (barcodeErr) {
                                console.error('Error checking for duplicate barcode:', barcodeErr);
                            }
                            
                            if (existingByBarcode) {
                                // Product exists with same barcode but different ID - use existing product
                                console.log(`Found existing product with barcode ${productBarcode}, using ID: ${existingByBarcode._id}`);
                                
                                // Update existing product quantity
                                const currentQty = Number(existingByBarcode.quantity || existingByBarcode.stock || 0);
                                const newQty = currentQty + receivedQuantity;
                                
                                inventoryDB.update(
                                    { _id: existingByBarcode._id },
                                    { $set: { quantity: newQty, stock: 1, updatedAt: new Date() } },
                                    {},
                                    function (updateErr) {
                                        if (updateErr) {
                                            console.error('Failed to update existing product:', updateErr);
                                        } else {
                                            console.log(`✅ Updated existing product ${existingByBarcode._id} quantity: ${currentQty} → ${newQty}`);
                                        }
                                    }
                                );
                                
                                // Also update the PO item productId to match
                                item.productId = existingByBarcode._id;
                                return;
                            }
                            
                            // Create new product from PO item
                            const newProduct = {
                                _id: item.productId, // Use the productId from PO
                                barcode: productBarcode,
                                name: item.productName || receivedItem.productName || 'Unknown Product',
                                price: receivedItem.sellingPrice ? String(receivedItem.sellingPrice) : String(item.unitPrice || 0),
                                actualPrice: receivedItem.purchasePrice ? String(receivedItem.purchasePrice) : String(item.unitPrice || 0),
                                quantity: receivedQuantity, // Initial quantity from received items
                                stock: 1, // Enable stock checking
                                minStock: 1,
                                supplier: order.supplierName || '',
                                category: '', // Will need to be set manually or via UI
                                manufacturer: '',
                                genericName: '',
                                batchNumber: receivedItem.lotNumber || '',
                                expirationDate: receivedItem.expiryDate || '',
                                img: '',
                                createdAt: new Date(),
                                updatedAt: new Date()
                            };
                            
                            inventoryDB.insert(newProduct, function (insertErr, createdProduct) {
                                if (insertErr) {
                                    console.error('Failed to create product:', insertErr);
                                } else {
                                    console.log(`✅ Created new product: ${createdProduct.name} (ID: ${createdProduct._id}, Barcode: ${createdProduct.barcode})`);
                                    console.log(`   Initial quantity: ${receivedQuantity}`);
                                }
                            });
                        });
                    } else {
                        // Product exists - update quantity
                        const currentQuantity = Number(product.quantity || product.stock || 0);
                        const newQuantity = currentQuantity + receivedQuantity;
                        
                        inventoryDB.update(
                            { _id: item.productId },
                            { 
                                $set: { 
                                    quantity: newQuantity,
                                    stock: newQuantity, // Also update stock field if it exists
                                    updatedAt: new Date() 
                                } 
                            },
                            {},
                            function (invQtyErr) {
                                if (invQtyErr) {
                                    console.error('Failed to increment product quantity:', invQtyErr);
                                } else {
                                    console.log(`✅ Updated product ${item.productId} quantity: ${currentQuantity} → ${newQuantity} (+${receivedQuantity})`);
                                }
                            }
                        );
                    }
                });
                
                if (newReceived < item.quantity) {
                    allItemsReceived = false;
                    hasPartialReceipt = true;
                }
            } else {
                    allItemsReceived = false;
            }
        });
        
        // Determine new status
        let newStatus = order.status;
        if (allItemsReceived) {
            newStatus = 'completed';
        } else if (hasPartialReceipt || order.status === 'sent') {
            newStatus = 'partial';
        }
        
        // Update the purchase order
        const updateData = {
            items: order.items,
            status: newStatus,
            receivedAt: newStatus === 'completed' ? new Date() : (order.receivedAt || new Date()),
            completedAt: newStatus === 'completed' ? new Date() : null,
            updatedAt: new Date()
        };
        
        purchaseOrdersDB.update(
            { _id: orderId },
            { $set: updateData },
            {},
            function (err, numReplaced) {
                if (err) {
                    console.error("Error updating purchase order after receipt:", err);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "Failed to process receipt."
                    });
                    return;
                }
                
                console.log("Purchase order receipt processed successfully:", orderId);
                res.json({
                    success: true,
                    message: "Items received successfully",
                    status: newStatus,
                    order: { _id: orderId, status: newStatus }
                });
            }
        );
    });
});

/**
 * POST endpoint: Auto-draft endpoint (deprecated).
 */
app.post("/auto-draft", function (req, res) {
    console.log('=== AUTO-DRAFT ENDPOINT HIT (DEPRECATED) ===');
    console.log('Request received at:', new Date().toISOString());
    console.log('Request body:', req.body);
    
    // This endpoint is now deprecated - redirect to new auto-draft management
    console.log('⚠️ Old auto-draft endpoint called - redirecting to new management system');
    
    return res.json({
        success: false,
        message: "Auto-draft endpoint is deprecated. Please use the Auto-Draft Management interface.",
        orders: []
    });
});

/**
 * POST endpoint: Split master PO into supplier-specific sub-POs.
 */
app.post("/:id/split", function (req, res) {
    const masterPOId = parseInt(req.params.id);
    console.log('=== SPLIT MASTER PO REQUEST ===');
    console.log('Master PO ID:', masterPOId);
    console.log('Request body:', req.body);
    
    // Find the master PO
    purchaseOrdersDB.findOne({ _id: masterPOId, poType: 'master' }, function (err, masterPO) {
        if (err) {
            console.error('Error finding master PO:', err);
            return res.status(500).json({
                success: false,
                message: "Failed to find master purchase order"
            });
        }
        
        if (!masterPO) {
            return res.status(404).json({
                success: false,
                message: "Master purchase order not found"
            });
        }
        
        console.log('Found master PO:', masterPO.poNumber);
        
        // Group items by supplier
        const itemsBySupplier = {};
        const supplierAssignments = req.body.supplierAssignments || {};
        
        masterPO.items.forEach(item => {
            const supplierId = supplierAssignments[item.productId] || item.assignedSupplierId;
            if (supplierId) {
                if (!itemsBySupplier[supplierId]) {
                    itemsBySupplier[supplierId] = [];
                }
                itemsBySupplier[supplierId].push(item);
            }
        });
        
        console.log('Items grouped by supplier:', Object.keys(itemsBySupplier).map(id => ({
            supplierId: id,
            itemCount: itemsBySupplier[id].length
        })));
        
        if (Object.keys(itemsBySupplier).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No supplier assignments found for items"
            });
        }
        
        // Get suppliers data
        suppliersDB.find({}, function (err, suppliers) {
            if (err) {
                console.error("Error fetching suppliers:", err);
                return res.status(500).json({
                    success: false,
                    message: "Failed to fetch suppliers data"
                });
            }
            
            const supplierMap = {};
            suppliers.forEach(supplier => {
                supplierMap[supplier._id] = supplier;
            });
            
            // Create sub-POs for each supplier
            const createdSubPOs = [];
        let processedSuppliers = 0;
            const totalSuppliers = Object.keys(itemsBySupplier).length;
            
            Object.keys(itemsBySupplier).forEach(supplierId => {
                const supplier = supplierMap[supplierId];
                const items = itemsBySupplier[supplierId];
                
                if (!supplier) {
                    console.error(`Supplier not found for ID: ${supplierId}`);
                    processedSuppliers++;
                    if (processedSuppliers === totalSuppliers) {
                        sendResponse();
                    }
                    return;
                }
                
                const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
                const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
                
                const subPO = {
                    _id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000),
                    poNumber: generatePONumber(),
                    supplierId: parseInt(supplierId),
                    supplierName: supplier.name,
                    status: 'draft',
                    poType: 'sub',
                    masterPOId: masterPOId,
                    items: items,
                    subtotal: subtotal,
                    tax: 0,
                    discount: 0,
                    total: subtotal,
                    totalItems: totalItems,
                    notes: `Sub-PO split from master PO ${masterPO.poNumber}`,
                    expectedDeliveryDate: masterPO.expectedDeliveryDate,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    createdBy: 'system',
                    sentAt: null,
                    receivedAt: null,
                    completedAt: null
                };
                
                // Save sub-PO
                purchaseOrdersDB.insert(subPO, function (err, savedSubPO) {
                    if (err) {
                        console.error("Error creating sub-PO:", err);
                    } else {
                        console.log(`Created sub-PO ${savedSubPO.poNumber} for supplier ${supplier.name}`);
                        createdSubPOs.push(savedSubPO);
                    }
                    
                    processedSuppliers++;
                    if (processedSuppliers === totalSuppliers) {
                        sendResponse();
                    }
            });
        });
        
        function sendResponse() {
                console.log(`Split master PO into ${createdSubPOs.length} sub-POs`);
            res.json({
                success: true,
                    message: `Split master PO into ${createdSubPOs.length} sub-POs`,
                    masterPO: masterPO,
                    subPOs: createdSubPOs
            });
        }
        });
    });
});

/**
 * POST endpoint: Get products needing reorder for manual supplier assignment.
 */
app.post("/auto-draft-products", function (req, res) {
    console.log('=== AUTO-DRAFT PRODUCTS ENDPOINT HIT ===');
    console.log('Request received at:', new Date().toISOString());
    console.log('Request body:', req.body);
    
    const { reorderPointThreshold = 5, expiryAlertDays = 30 } = req.body;
    
    console.log('=== FETCHING PRODUCTS FOR AUTO-DRAFT ===');
    console.log('Reorder threshold:', reorderPointThreshold);
    console.log('Expiry alert days:', expiryAlertDays);
    
    // Response guard to prevent duplicate responses
    let responseSent = false;
    const sendResponse = (data) => {
        if (responseSent) {
            console.warn('⚠️ Response already sent, ignoring duplicate');
            return;
        }
        responseSent = true;
        if (!res.headersSent) {
            res.json(data);
        }
    };
    
    // Fallback timer - if query takes too long, return empty result
    const fallbackTimer = setTimeout(() => {
        if (!responseSent) {
            console.warn('⏱️ Auto-draft products query timeout - returning empty result');
            sendResponse({
                success: false,
                message: "Query timed out. Please try again.",
                products: [],
                suppliers: [
                    { _id: 1761170223, name: 'HealthPlus Wholesale' },
                    { _id: 1761170451, name: 'MediSuppliers Ltd' },
                    { _id: 1761170580, name: 'Global Pharma Distributors' }
                ]
            });
        }
    }, 8000); // 8 second timeout (matching products endpoint)
    
    // Wait for database to be ready (max 3 seconds) before querying
    const waitForDB = (attempts = 0) => {
        if (inventoryDBReady || attempts >= 30) {
            // Build targeted selector to avoid scanning entire DB
            const expiryCutoff = new Date();
            expiryCutoff.setDate(expiryCutoff.getDate() + Number(expiryAlertDays));
            
            // Simplified selector - just check quantity first
            const selector = {
                $or: [
                    { quantity: { $lte: Number(reorderPointThreshold) } },
                    { quantity: 0 }
                ]
            };
            
            console.log(`Executing auto-draft query (DB ready: ${inventoryDBReady}, attempts: ${attempts})`);
            console.log('Query selector:', JSON.stringify(selector));
            const queryStartTime = Date.now();
            
            // Find candidate products (smaller subset)
            inventoryDB.find(selector, function (err, candidateProducts) {
                clearTimeout(fallbackTimer);
                
                if (responseSent) {
                    console.warn('⚠️ Response already sent via timeout, ignoring database result');
                    return;
                }
                
                const queryDuration = Date.now() - queryStartTime;
                console.log(`Auto-draft database query completed in ${queryDuration}ms`);
                
        if (err) {
                    console.error("Error fetching inventory:", err);
                    sendResponse({
                        success: false,
                        message: "Failed to fetch inventory data.",
                        products: [],
                        suppliers: [
                            { _id: 1761170223, name: 'HealthPlus Wholesale' },
                            { _id: 1761170451, name: 'MediSuppliers Ltd' },
                            { _id: 1761170580, name: 'Global Pharma Distributors' }
                        ]
            });
            return;
        }
        
                console.log(`Found ${candidateProducts.length} candidate products for auto-draft query`);
                
                // Check for existing draft/sent POs to exclude products that already have a PO
                purchaseOrdersDB.find({ 
                    status: { $in: ['draft', 'sent', 'partial'] } 
                }, function (err, existingPOs) {
                    if (err) {
                        console.error("Error fetching existing POs:", err);
                        // Continue anyway, but log the error
                    } else {
                        console.log(`Found ${existingPOs.length} existing draft/sent/partial POs`);
                    }
                    
                    // Extract product IDs from existing POs
                    const productsInExistingPOs = new Set();
                    if (existingPOs) {
                        existingPOs.forEach(po => {
                            if (po.items && Array.isArray(po.items)) {
                                po.items.forEach(item => {
                                    if (item.productId) {
                                        productsInExistingPOs.add(item.productId);
                                        // Also handle string/number variations
                                        if (typeof item.productId === 'number') {
                                            productsInExistingPOs.add(String(item.productId));
                                        } else if (typeof item.productId === 'string') {
                                            const numId = parseInt(item.productId);
                                            if (!isNaN(numId)) {
                                                productsInExistingPOs.add(numId);
                                            }
                                        }
                                    }
                                });
                            }
                        });
                        console.log(`Found ${productsInExistingPOs.size} unique products already in existing POs`);
                    }
                
                    // Filter items that need reordering (including expired items) AND exclude those with existing POs
                    const itemsNeedingReorder = candidateProducts.filter(item => {
                        // Skip if product already has a PO
                        if (productsInExistingPOs.has(item._id) || 
                            productsInExistingPOs.has(String(item._id)) ||
                            productsInExistingPOs.has(parseInt(item._id))) {
                            console.log(`Skipping ${item.name} - already has a draft/sent PO`);
                            return false;
                        }
                    const currentStock = Number(item.quantity || item.stock || 0);
                    const reorderPoint = Number(item.reorderPoint || item.minStock || 0);
                    
                    // Check for expired items
                    let hasExpiredItems = false;
                    if (item.expiryDate) {
                        const expiryDate = new Date(item.expiryDate);
                        const today = new Date();
                        const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                        
                        if (daysUntilExpiry <= expiryAlertDays) {
                            hasExpiredItems = true;
                            console.log(`Item has expired/expiring stock: ${item.name} (expires in ${daysUntilExpiry} days)`);
                        }
                    }
                    
                    // Item needs reordering if:
                    const needsReorder = (currentStock <= reorderPointThreshold) || 
                                        (currentStock <= reorderPoint && reorderPoint > 0) || 
                                        (currentStock === 0) ||
                                        hasExpiredItems;
                    
                    if (needsReorder) {
                        const reason = hasExpiredItems ? 'expired/expiring' : 
                                      currentStock === 0 ? 'out of stock' :
                                      currentStock <= reorderPoint ? 'below reorder point' : 'below threshold';
                        console.log(`Item needs reorder: ${item.name} (stock: ${currentStock}, reorderPoint: ${reorderPoint}, reason: ${reason})`);
                    }
                    
                    return needsReorder;
                });
                
                console.log(`Found ${itemsNeedingReorder.length} items needing reorder`);
                
                // Always respond immediately to avoid client timeout; use lightweight suppliers list
                const hardcodedSuppliers = [
                    { _id: 1761170223, name: 'HealthPlus Wholesale' },
                    { _id: 1761170451, name: 'MediSuppliers Ltd' },
                    { _id: 1761170580, name: 'Global Pharma Distributors' }
                ];
                
                sendResponse({
                    success: true,
                    message: `Found ${itemsNeedingReorder.length} products needing reorder`,
                    products: itemsNeedingReorder.map(item => ({
                        productId: item._id,
                        productName: item.name,
                        barcode: item.barcode || '',
                        currentStock: Number(item.quantity || item.stock || 0),
                        reorderPoint: Number(item.reorderPoint || item.minStock || 0),
                        suggestedQuantity: Number(item.reorderQuantity || item.reorderPoint || item.minStock || 10),
                        unitPrice: Number(item.actualPrice || item.price || 0),
                        supplier: item.supplier || '',
                        supplierId: item.supplierId || item.supplier_id || null,
                        reason: (() => {
                            const currentStock = Number(item.quantity || item.stock || 0);
                            const reorderPoint = Number(item.reorderPoint || item.minStock || 0);
                            if (item.expiryDate) {
                                const expiryDate = new Date(item.expiryDate);
                                const today = new Date();
                                const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                                if (daysUntilExpiry <= expiryAlertDays) return 'expired/expiring';
                            }
                            if (currentStock === 0) return 'out of stock';
                            if (currentStock <= reorderPoint) return 'below reorder point';
                            return 'below threshold';
                        })(),
                        expiryDate: item.expiryDate || null
                    })),
                    suppliers: hardcodedSuppliers
                });
                    }); // Close purchaseOrdersDB.find callback
                }); // Close inventoryDB.find callback
            } else {
                // Wait 100ms before retrying
                setTimeout(() => waitForDB(attempts + 1), 100);
            }
        };
    
    waitForDB();
});

/**
 * POST endpoint: Create purchase orders from assigned suppliers.
 */
app.post("/auto-draft-create-pos", function (req, res) {
    console.log('=== CREATE POS FROM AUTO-DRAFT ASSIGNMENTS ===');
    console.log('Request received at:', new Date().toISOString());
    console.log('Request body:', req.body);
    
    const { assignments } = req.body; // Array of {productId, supplierId, quantity}
    
    if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
        return res.status(400).json({
            success: false,
            message: "No assignments provided"
        });
    }
    
    // Group assignments by supplier
    const assignmentsBySupplier = {};
    assignments.forEach(assignment => {
        if (!assignmentsBySupplier[assignment.supplierId]) {
            assignmentsBySupplier[assignment.supplierId] = [];
        }
        assignmentsBySupplier[assignment.supplierId].push(assignment);
    });
    
    console.log('Grouped assignments by supplier:', Object.keys(assignmentsBySupplier));
    
    // Get suppliers data
    suppliersDB.find({}, function (err, suppliers) {
        if (err) {
            console.error("Error fetching suppliers:", err);
            return res.status(500).json({
                success: false,
                message: "Failed to fetch suppliers data"
            });
        }
        
        const supplierMap = {};
        suppliers.forEach(supplier => {
            supplierMap[supplier._id] = supplier;
        });
        
        // Create POs for each supplier
        const createdOrders = [];
        let processedSuppliers = 0;
        const totalSuppliers = Object.keys(assignmentsBySupplier).length;
        
        Object.keys(assignmentsBySupplier).forEach(supplierId => {
            const supplier = supplierMap[supplierId];
            if (!supplier) {
                console.error(`Supplier not found for ID: ${supplierId}`);
                processedSuppliers++;
                if (processedSuppliers === totalSuppliers) {
                    res.json({
                        success: true,
                        message: `Created ${createdOrders.length} purchase orders`,
                        orders: createdOrders
                    });
                }
                return;
            }
            
            const supplierAssignments = assignmentsBySupplier[supplierId];
            
            // Get product details for this supplier's assignments
            const productIds = supplierAssignments.map(a => a.productId);
            console.log(`Fetching products for supplier ${supplier.name}:`, productIds);
            
            // Wait for database to be ready before querying
            const waitForDB = (attempts = 0) => {
                if (inventoryDBReady || attempts >= 30) {
                    // Try both string and number IDs (NeDB might store as either)
                    const numericIds = productIds.map(id => typeof id === 'string' ? parseInt(id) : id);
                    const stringIds = productIds.map(id => String(id));
                    const allIds = [...new Set([...productIds, ...numericIds, ...stringIds])];
                    
                    console.log(`Querying inventory with IDs (attempts: ${attempts}, DB ready: ${inventoryDBReady}):`, allIds);
                    
                    inventoryDB.find({ _id: { $in: allIds } }, function (err, products) {
                        if (err) {
                            console.error("Error fetching products:", err);
                            processedSuppliers++;
                            if (processedSuppliers === totalSuppliers) {
            res.json({
                success: true,
                                    message: `Created ${createdOrders.length} purchase orders`,
                                    orders: createdOrders
                                });
                            }
            return;
        }
        
                        console.log(`Found ${products.length} products for supplier ${supplier.name} out of ${productIds.length} requested`);
                        
                        if (products.length === 0) {
                            console.warn(`⚠️ No products found for supplier ${supplier.name} with IDs:`, productIds);
                            console.warn('This might indicate a data mismatch. Check product IDs.');
                            console.warn('Creating PO with default product info...');
                        }
                        
                        const productMap = {};
                        products.forEach(product => {
                            productMap[product._id] = product;
                            // Also map string/number variations
                            if (typeof product._id === 'number') {
                                productMap[String(product._id)] = product;
                            } else if (typeof product._id === 'string') {
                                const numId = parseInt(product._id);
                                if (!isNaN(numId)) {
                                    productMap[numId] = product;
                                }
                            }
                        });
                
                        // Create order items
                        const orderItems = supplierAssignments.map(assignment => {
                            // Try to find product with multiple ID formats
                            let product = productMap[assignment.productId];
                            if (!product) {
                                // Try string version
                                product = productMap[String(assignment.productId)];
                            }
                            if (!product) {
                                // Try number version
                                const numId = typeof assignment.productId === 'string' ? parseInt(assignment.productId) : assignment.productId;
                                product = productMap[numId];
                            }
                            
                            console.log(`Order item for productId ${assignment.productId}:`, product ? `Found: ${product.name}` : 'NOT FOUND');
                            
                            const unitPrice = Number(product?.actualPrice || product?.price || 0);
                            
                            return {
                                productId: assignment.productId,
                                productName: product?.name || `Product ID: ${assignment.productId}`,
                                barcode: product?.barcode || '',
                                quantity: Number(assignment.quantity),
                                unitPrice: unitPrice,
                                totalPrice: Number(assignment.quantity) * unitPrice,
                                lotNumber: '',
                                expiryDate: null,
                                receivedQuantity: 0
                            };
                        });
                
                // Calculate totals
                const totalAmount = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);
                const totalItems = orderItems.reduce((sum, item) => sum + item.quantity, 0);
                
                const purchaseOrder = {
                    _id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000),
                    poNumber: generatePONumber(),
                    supplierId: parseInt(supplierId),
                    supplierName: supplier.name,
                    status: 'draft',
                    items: orderItems,
                    subtotal: totalAmount,
                    tax: 0,
                    discount: 0,
                    total: totalAmount,
                    totalItems: totalItems,
                    notes: `Auto-generated from manual supplier assignment. Generated on ${moment().format('DD-MMM-YYYY HH:mm')}`,
                    expectedDeliveryDate: moment().add(7, 'days').toDate(),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    createdBy: 'system',
                    sentAt: null,
                    receivedAt: null,
                    completedAt: null
                };
                
                        // Save purchase order
                        console.log(`Attempting to save PO ${purchaseOrder.poNumber} for supplier ${supplier.name} with ${orderItems.length} items`);
                        purchaseOrdersDB.insert(purchaseOrder, function (err, savedOrder) {
                if (err) {
                                console.error("❌ Error creating purchase order:", err);
                                console.error("PO data that failed:", JSON.stringify(purchaseOrder, null, 2));
                } else {
                                console.log(`✅ Created purchase order ${savedOrder.poNumber} (ID: ${savedOrder._id}) for supplier ${supplier.name}`);
                                console.log(`   - Total: $${savedOrder.total}`);
                                console.log(`   - Items: ${savedOrder.items.length}`);
                                createdOrders.push(savedOrder);
                            }
                            
                            processedSuppliers++;
                            console.log(`Processed ${processedSuppliers}/${totalSuppliers} suppliers`);
                            if (processedSuppliers === totalSuppliers) {
                                console.log(`=== FINAL RESPONSE: Created ${createdOrders.length} purchase orders ===`);
                                res.json({
                                    success: true,
                                    message: `Created ${createdOrders.length} purchase orders`,
                                    orders: createdOrders
                                });
                            }
                        });
                    }); // Close inventoryDB.find callback
                } else {
                    // Wait 100ms before retrying
                    setTimeout(() => waitForDB(attempts + 1), 100);
                }
            };
            
            waitForDB();
        });
    });
});

/**
 * POST endpoint: Reset auto-draft flags (emergency reset).
 */
app.post("/reset-auto-draft-flags", function (req, res) {
    console.log('🔄 Manual auto-draft flag reset requested');
    isAutoDraftRunning = false;
    lastAutoDraftTime = null;
    console.log('✅ Auto-draft flags manually reset');
    res.json({
        success: true,
        message: "Auto-draft flags have been reset successfully."
    });
});

module.exports = app;
