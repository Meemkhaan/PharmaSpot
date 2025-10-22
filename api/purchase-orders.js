const app = require("express")();
const bodyParser = require("body-parser");
const Datastore = require("@seald-io/nedb");
const validator = require("validator");
const moment = require("moment");
const path = require("path");
const appName = process.env.APPNAME;
const appData = process.env.APPDATA;

app.use(bodyParser.json());

// Database paths
const dbPath = path.join(appData, appName, "server", "databases", "purchase-orders.db");
const inventoryDbPath = path.join(appData, appName, "server", "databases", "inventory.db");
const suppliersDbPath = path.join(appData, appName, "server", "databases", "suppliers.db");

// Initialize databases
let purchaseOrdersDB = new Datastore({
    filename: dbPath,
    autoload: true,
    onload: function(err) {
        if (err) {
            console.error('Purchase Orders database load error:', err);
        } else {
            console.log('Purchase Orders database loaded successfully');
        }
    }
});

let inventoryDB = new Datastore({
    filename: inventoryDbPath,
    autoload: true
});

let suppliersDB = new Datastore({
    filename: suppliersDbPath,
    autoload: true
});

// Ensure indexes
purchaseOrdersDB.ensureIndex({ fieldName: "_id", unique: true });
purchaseOrdersDB.ensureIndex({ fieldName: "poNumber", unique: true });
purchaseOrdersDB.ensureIndex({ fieldName: "status" });
purchaseOrdersDB.ensureIndex({ fieldName: "supplierId" });
purchaseOrdersDB.ensureIndex({ fieldName: "createdAt" });

/**
 * GET endpoint: Get the welcome message for the Purchase Orders API.
 */
app.get("/", function (req, res) {
    res.send("Purchase Orders API");
});

/**
 * GET endpoint: Get all purchase orders with optional filtering.
 */
app.get("/all", function (req, res) {
    const { status, supplierId, startDate, endDate, limit = 100 } = req.query;
    
    let query = {};
    
    if (status) {
        query.status = status;
    }
    
    if (supplierId) {
        query.supplierId = parseInt(supplierId);
    }
    
    if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) {
            query.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
            query.createdAt.$lte = new Date(endDate);
        }
    }
    
    purchaseOrdersDB.find(query)
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .exec(function (err, orders) {
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
 * GET endpoint: Get purchase order by ID.
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
 * POST endpoint: Create a new purchase order.
 */
app.post("/", function (req, res) {
    const orderData = req.body;
    
    // Validate required fields
    if (!orderData.supplierId || !orderData.items || !Array.isArray(orderData.items) || orderData.items.length === 0) {
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
    
    orderData.items.forEach(item => {
        const itemTotal = parseFloat(item.quantity) * parseFloat(item.unitPrice || 0);
        subtotal += itemTotal;
        totalItems += parseInt(item.quantity);
    });
    
    const tax = parseFloat(orderData.tax || 0);
    const discount = parseFloat(orderData.discount || 0);
    const total = subtotal + tax - discount;
    
    const purchaseOrder = {
        _id: Math.floor(Date.now() / 1000),
        poNumber: poNumber,
        supplierId: parseInt(orderData.supplierId),
        supplierName: validator.escape(orderData.supplierName || ''),
        status: 'draft', // draft, sent, partial, received, completed, cancelled
        items: orderData.items.map(item => ({
            productId: parseInt(item.productId),
            productName: validator.escape(item.productName || ''),
            barcode: validator.escape(item.barcode || ''),
            quantity: parseInt(item.quantity),
            unitPrice: parseFloat(item.unitPrice || 0),
            totalPrice: parseFloat(item.quantity) * parseFloat(item.unitPrice || 0),
            receivedQuantity: 0,
            pendingQuantity: parseInt(item.quantity),
            lotNumber: validator.escape(item.lotNumber || ''),
            expiryDate: item.expiryDate || null
        })),
        subtotal: subtotal,
        tax: tax,
        discount: discount,
        total: total,
        totalItems: totalItems,
        notes: validator.escape(orderData.notes || ''),
        expectedDeliveryDate: orderData.expectedDeliveryDate || null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: validator.escape(orderData.createdBy || 'system'),
        sentAt: null,
        receivedAt: null,
        completedAt: null
    };
    
    purchaseOrdersDB.insert(purchaseOrder, function (err, newOrder) {
        if (err) {
            console.error("Error creating purchase order:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to create purchase order."
            });
            return;
        }
        
        console.log("Purchase order created successfully:", newOrder.poNumber);
        res.status(201).json({
            success: true,
            message: "Purchase order created successfully",
            order: newOrder
        });
    });
});

/**
 * PUT endpoint: Update purchase order.
 */
app.put("/:id", function (req, res) {
    const orderId = parseInt(req.params.id);
    const updateData = req.body;
    
    // Check if order exists
    purchaseOrdersDB.findOne({ _id: orderId }, function (err, existingOrder) {
        if (err) {
            console.error("Error finding purchase order:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to update purchase order."
            });
            return;
        }
        
        if (!existingOrder) {
            res.status(404).json({
                error: "Not Found",
                message: "Purchase order not found."
            });
            return;
        }
        
        // Prevent updates to completed orders
        if (existingOrder.status === 'completed') {
            res.status(400).json({
                error: "Bad Request",
                message: "Cannot update completed purchase orders."
            });
            return;
        }
        
        // Update allowed fields
        const allowedUpdates = {
            status: updateData.status,
            notes: validator.escape(updateData.notes || ''),
            expectedDeliveryDate: updateData.expectedDeliveryDate || null,
            updatedAt: new Date()
        };
        
        // Add status-specific timestamps
        if (updateData.status === 'sent' && existingOrder.status !== 'sent') {
            allowedUpdates.sentAt = new Date();
        }
        
        if (updateData.status === 'completed' && existingOrder.status !== 'completed') {
            allowedUpdates.completedAt = new Date();
        }
        
        purchaseOrdersDB.update(
            { _id: orderId },
            { $set: allowedUpdates },
            {},
            function (err, numReplaced) {
                if (err) {
                    console.error("Error updating purchase order:", err);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "Failed to update purchase order."
                    });
                    return;
                }
                
                if (numReplaced === 0) {
                    res.status(404).json({
                        error: "Not Found",
                        message: "Purchase order not found."
                    });
                    return;
                }
                
                console.log("Purchase order updated successfully:", orderId);
                res.json({
                    success: true,
                    message: "Purchase order updated successfully"
                });
            }
        );
    });
});

/**
 * POST endpoint: Receive items for a purchase order.
 */
app.post("/:id/receive", function (req, res) {
    const orderId = parseInt(req.params.id);
    const receiveData = req.body;
    
    // Validate required fields
    if (!receiveData.items || !Array.isArray(receiveData.items)) {
        return res.status(400).json({
            error: "Validation Error",
            message: "Items to receive are required."
        });
    }
    
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
        
        order.items.forEach(orderItem => {
            const receivedItem = receiveData.items.find(item => item.productId === orderItem.productId);
            
            if (receivedItem) {
                const receivedQty = parseInt(receivedItem.quantity || 0);
                const newReceivedQty = orderItem.receivedQuantity + receivedQty;
                const newPendingQty = orderItem.quantity - newReceivedQty;
                
                orderItem.receivedQuantity = newReceivedQty;
                orderItem.pendingQuantity = Math.max(0, newPendingQty);
                
                // Update lot number and expiry if provided
                if (receivedItem.lotNumber) {
                    orderItem.lotNumber = validator.escape(receivedItem.lotNumber);
                }
                if (receivedItem.expiryDate) {
                    orderItem.expiryDate = receivedItem.expiryDate;
                }
                
                // Check if item is fully received
                if (newPendingQty > 0) {
                    allItemsReceived = false;
                    hasPartialReceipt = true;
                }
                
                // Update inventory
                updateInventory(orderItem.productId, receivedQty, receivedItem.lotNumber, receivedItem.expiryDate);
            } else {
                // No receipt data for this item
                if (orderItem.pendingQuantity > 0) {
                    allItemsReceived = false;
                }
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
 * POST endpoint: Auto-generate draft purchase orders based on reorder points.
 */
app.post("/auto-draft", function (req, res) {
    const { reorderPointThreshold = 5, expiryAlertDays = 30, supplierId = null } = req.body;
    
    // Find products that need reordering
    const reorderQuery = {
        $or: [
            { quantity: { $lte: reorderPointThreshold } },
            { quantity: 0 }
        ]
    };
    
    if (supplierId) {
        reorderQuery.supplier_id = supplierId;
    }
    
    inventoryDB.find(reorderQuery, function (err, products) {
        if (err) {
            console.error("Error finding products for auto-draft:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to generate auto-draft purchase orders."
            });
            return;
        }
        
        if (products.length === 0) {
            res.json({
                success: true,
                message: "No products need reordering",
                orders: []
            });
            return;
        }
        
        // Group products by supplier
        const supplierGroups = {};
        products.forEach(product => {
            const supplierId = product.supplier_id || 'unknown';
            if (!supplierGroups[supplierId]) {
                supplierGroups[supplierId] = [];
            }
            supplierGroups[supplierId].push(product);
        });
        
        // Create purchase orders for each supplier
        const createdOrders = [];
        let processedSuppliers = 0;
        const totalSuppliers = Object.keys(supplierGroups).length;
        
        Object.keys(supplierGroups).forEach(supplierId => {
            const supplierProducts = supplierGroups[supplierId];
            
            // Get supplier details
            suppliersDB.findOne({ _id: parseInt(supplierId) }, function (err, supplier) {
                if (err || !supplier) {
                    console.log(`Supplier not found for ID: ${supplierId}`);
                    processedSuppliers++;
                    if (processedSuppliers === totalSuppliers) {
                        sendResponse();
                    }
                    return;
                }
                
                // Create items for this supplier
                const items = supplierProducts.map(product => ({
                    productId: product._id,
                    productName: product.name,
                    barcode: product.barcode,
                    quantity: product.reorderQuantity || 10,
                    unitPrice: product.actualPrice || 0,
                    lotNumber: '',
                    expiryDate: null
                }));
                
                // Calculate totals
                let subtotal = 0;
                let totalItems = 0;
                items.forEach(item => {
                    const itemTotal = item.quantity * item.unitPrice;
                    subtotal += itemTotal;
                    totalItems += item.quantity;
                });
                
                const purchaseOrder = {
                    _id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000),
                    poNumber: generatePONumber(),
                    supplierId: parseInt(supplierId),
                    supplierName: supplier.name,
                    status: 'draft',
                    items: items,
                    subtotal: subtotal,
                    tax: 0,
                    discount: 0,
                    total: subtotal,
                    totalItems: totalItems,
                    notes: 'Auto-generated based on reorder points',
                    expectedDeliveryDate: moment().add(7, 'days').toDate(),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    createdBy: 'system',
                    sentAt: null,
                    receivedAt: null,
                    completedAt: null
                };
                
                purchaseOrdersDB.insert(purchaseOrder, function (err, newOrder) {
                    if (err) {
                        console.error("Error creating auto-draft purchase order:", err);
                    } else {
                        console.log("Auto-draft purchase order created:", newOrder.poNumber);
                        createdOrders.push(newOrder);
                    }
                    
                    processedSuppliers++;
                    if (processedSuppliers === totalSuppliers) {
                        sendResponse();
                    }
                });
            });
        });
        
        function sendResponse() {
            res.json({
                success: true,
                message: `Generated ${createdOrders.length} draft purchase orders`,
                orders: createdOrders
            });
        }
    });
});

/**
 * GET endpoint: Get purchase order statistics.
 */
app.get("/stats/overview", function (req, res) {
    const { startDate, endDate } = req.query;
    
    let query = {};
    if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) {
            query.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
            query.createdAt.$lte = new Date(endDate);
        }
    }
    
    purchaseOrdersDB.find(query, function (err, orders) {
        if (err) {
            console.error("Error fetching purchase order statistics:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to fetch statistics."
            });
            return;
        }
        
        const stats = {
            total: orders.length,
            draft: orders.filter(o => o.status === 'draft').length,
            sent: orders.filter(o => o.status === 'sent').length,
            partial: orders.filter(o => o.status === 'partial').length,
            received: orders.filter(o => o.status === 'received').length,
            completed: orders.filter(o => o.status === 'completed').length,
            cancelled: orders.filter(o => o.status === 'cancelled').length,
            totalValue: orders.reduce((sum, order) => sum + (order.total || 0), 0),
            totalItems: orders.reduce((sum, order) => sum + (order.totalItems || 0), 0),
            averageOrderValue: orders.length > 0 ? orders.reduce((sum, order) => sum + (order.total || 0), 0) / orders.length : 0
        };
        
        res.json(stats);
    });
});

/**
 * GET endpoint: Get supplier performance report.
 */
app.get("/reports/supplier-performance", function (req, res) {
    const { startDate, endDate } = req.query;
    
    let query = { status: { $in: ['completed', 'partial'] } };
    if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) {
            query.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
            query.createdAt.$lte = new Date(endDate);
        }
    }
    
    purchaseOrdersDB.find(query, function (err, orders) {
        if (err) {
            console.error("Error fetching supplier performance data:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to fetch supplier performance report."
            });
            return;
        }
        
        // Group by supplier
        const supplierStats = {};
        orders.forEach(order => {
            const supplierId = order.supplierId;
            if (!supplierStats[supplierId]) {
                supplierStats[supplierId] = {
                    supplierId: supplierId,
                    supplierName: order.supplierName,
                    totalOrders: 0,
                    totalValue: 0,
                    totalItems: 0,
                    completedOrders: 0,
                    partialOrders: 0,
                    averageDeliveryTime: 0,
                    onTimeDeliveries: 0
                };
            }
            
            supplierStats[supplierId].totalOrders++;
            supplierStats[supplierId].totalValue += order.total || 0;
            supplierStats[supplierId].totalItems += order.totalItems || 0;
            
            if (order.status === 'completed') {
                supplierStats[supplierId].completedOrders++;
            } else if (order.status === 'partial') {
                supplierStats[supplierId].partialOrders++;
            }
            
            // Calculate delivery time if completed
            if (order.completedAt && order.createdAt) {
                const deliveryTime = moment(order.completedAt).diff(moment(order.createdAt), 'days');
                supplierStats[supplierId].averageDeliveryTime += deliveryTime;
                
                if (order.expectedDeliveryDate) {
                    const expectedDelivery = moment(order.expectedDeliveryDate);
                    const actualDelivery = moment(order.completedAt);
                    if (actualDelivery.isSameOrBefore(expectedDelivery)) {
                        supplierStats[supplierId].onTimeDeliveries++;
                    }
                }
            }
        });
        
        // Calculate averages and percentages
        Object.keys(supplierStats).forEach(supplierId => {
            const stats = supplierStats[supplierId];
            stats.averageDeliveryTime = stats.completedOrders > 0 ? 
                Math.round(stats.averageDeliveryTime / stats.completedOrders) : 0;
            stats.onTimePercentage = stats.totalOrders > 0 ? 
                Math.round((stats.onTimeDeliveries / stats.totalOrders) * 100) : 0;
            stats.completionRate = stats.totalOrders > 0 ? 
                Math.round((stats.completedOrders / stats.totalOrders) * 100) : 0;
        });
        
        const report = Object.values(supplierStats).sort((a, b) => b.totalValue - a.totalValue);
        
        res.json({
            report: report,
            summary: {
                totalSuppliers: report.length,
                totalOrders: report.reduce((sum, s) => sum + s.totalOrders, 0),
                totalValue: report.reduce((sum, s) => sum + s.totalValue, 0),
                averageOrderValue: report.length > 0 ? 
                    report.reduce((sum, s) => sum + s.totalValue, 0) / report.reduce((sum, s) => sum + s.totalOrders, 0) : 0
            }
        });
    });
});

/**
 * DELETE endpoint: Delete a purchase order.
 */
app.delete("/:id", function (req, res) {
    const orderId = parseInt(req.params.id);
    
    purchaseOrdersDB.findOne({ _id: orderId }, function (err, order) {
        if (err) {
            console.error("Error finding purchase order:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to delete purchase order."
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
        
        // Only allow deletion of draft orders
        if (order.status !== 'draft') {
            res.status(400).json({
                error: "Bad Request",
                message: "Only draft purchase orders can be deleted."
            });
            return;
        }
        
        purchaseOrdersDB.remove({ _id: orderId }, { multi: false }, function (err, numRemoved) {
            if (err) {
                console.error("Error deleting purchase order:", err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "Failed to delete purchase order."
                });
                return;
            }
            
            console.log("Purchase order deleted successfully:", orderId);
            res.json({
                success: true,
                message: "Purchase order deleted successfully"
            });
        });
    });
});

/**
 * Helper function to generate unique PO numbers.
 */
function generatePONumber() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `PO-${timestamp}-${random}`;
}

/**
 * Helper function to update inventory after receiving items.
 */
function updateInventory(productId, quantity, lotNumber, expiryDate) {
    inventoryDB.findOne({ _id: productId }, function (err, product) {
        if (err || !product) {
            console.error("Error finding product for inventory update:", err);
            return;
        }
        
        const newQuantity = (product.quantity || 0) + quantity;
        
        const updateData = {
            quantity: newQuantity,
            updatedAt: new Date()
        };
        
        // Update lot number and expiry if provided
        if (lotNumber) {
            updateData.batchNumber = validator.escape(lotNumber);
        }
        if (expiryDate) {
            updateData.expirationDate = expiryDate;
        }
        
        inventoryDB.update(
            { _id: productId },
            { $set: updateData },
            {},
            function (err, numReplaced) {
                if (err) {
                    console.error("Error updating inventory:", err);
                } else {
                    console.log(`Inventory updated for product ${productId}: +${quantity} units`);
                }
            }
        );
    });
}

module.exports = app;
