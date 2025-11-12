const app = require("express")();
const server = require("http").Server(app);

// Global error handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Don't exit the process, just log the error
});
const bodyParser = require("body-parser");
const Datastore = require("@seald-io/nedb");
const async = require("async");
const sanitizeFilename = require('sanitize-filename');
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const {filterFile} = require('../assets/js/utils');
const validFileTypes = [
    "image/jpg",
    "image/jpeg",
    "image/png",
    "image/webp"];
const maxFileSize = 2097152 //2MB = 2*1024*1024
const validator = require("validator");
const appName = process.env.APPNAME;
const appData = process.env.APPDATA;

// Environment variables (log removed for cleaner output)
const dbPath = path.join(
    appData,
    appName,
    "server",
    "databases",
    "inventory.db",
);

const storage = multer.diskStorage({
    destination: path.join(appData, appName, "uploads"),
    filename: function (req, file, callback) {
        callback(null, Date.now()+path.extname(file.originalname));
    },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: maxFileSize },
  fileFilter: filterFile,
}).single("imagename");

// CSV upload configuration for bulk import
const csvUpload = multer({
  dest: 'uploads/',
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

// CSV upload configuration (log removed for cleaner output)


app.use(bodyParser.json());

// Flag to track if database is ready
let inventoryDBReady = false;

let inventoryDB = new Datastore({
    filename: dbPath,
    autoload: true,
    onload: function(err) {
                if (err) {
            console.error('Inventory database load error:', err);
            if (err.code === 'ENOENT') {
                console.log('Database file missing - will be created on first write');
                inventoryDBReady = true;
            } else {
                // Other error (like rename error) - try to reload manually
                console.warn('⚠️ Inventory DB autoload failed, attempting manual reload...');
                const fs = require('fs');
                if (fs.existsSync(dbPath)) {
                    console.log('   Database file exists, forcing reload...');
                    inventoryDB.loadDatabase(function(reloadErr) {
                        if (reloadErr) {
                            console.error('   Manual reload failed:', reloadErr);
                            // Mark as ready anyway - queries will work or fail gracefully
                            inventoryDBReady = true;
                        } else {
                            console.log('   ✅ Manual reload successful');
                            inventoryDBReady = true;
                        }
                    });
                } else {
                    console.log('   Database file does not exist - will be created on first write');
                    inventoryDBReady = true;
                }
            }
                } else {
            if (process.env.NODE_ENV === 'dev') {
                console.log('Inventory database loaded successfully');
            }
            inventoryDBReady = true;
        }
    }
});

// Verify database is actually loaded after a delay
setTimeout(() => {
    const fs = require('fs');
    if (fs.existsSync(dbPath) && !inventoryDBReady) {
        console.warn('⚠️ Inventory DB file exists but not marked ready - forcing load...');
        inventoryDB.loadDatabase(function(loadErr) {
            if (!loadErr) {
                if (process.env.NODE_ENV === 'dev') {
                    console.log('✅ Inventory database manually loaded successfully');
                }
                inventoryDBReady = true;
            } else {
                console.error('❌ Manual inventory DB load failed:', loadErr);
                inventoryDBReady = true; // Mark as ready anyway to allow queries
            }
        });
    }
}, 500);

// Database initialization (log removed for cleaner output)

// Ensure database is ready after a short delay (for autoload completion)
setTimeout(() => {
    if (!inventoryDBReady) {
        console.log('Database autoload taking longer than expected - marking as ready');
        inventoryDBReady = true;
    }
inventoryDB.ensureIndex({ fieldName: "_id", unique: true });
}, 1000);

// Batches database for lot-level inventory tracking
const inventoryBatchesDB = new Datastore({
    filename: path.join(appData, appName, "server", "databases", "inventory-batches.db"),
    autoload: true,
});

function parseBatchesPayload(rawBatches) {
    let batchesArray = [];

    if (Array.isArray(rawBatches)) {
        batchesArray = rawBatches;
    } else if (typeof rawBatches === 'string' && rawBatches.trim()) {
        try {
            batchesArray = JSON.parse(rawBatches);
        } catch (e) {
            console.warn('Failed to parse batches payload JSON:', e.message);
        }
    }

    const normalized = [];
    batchesArray.forEach((entry) => {
        if (!entry) {
            return;
        }

        const lotNumber = entry.lotNumber ? validator.escape(String(entry.lotNumber).trim()) : "";
        const barcodeRaw = entry.barcode !== null && entry.barcode !== undefined
            ? String(entry.barcode).trim()
            : "";
        let barcodeNumeric = null;
        if (barcodeRaw) {
            const parsedBarcode = Number(barcodeRaw);
            if (!Number.isNaN(parsedBarcode)) {
                barcodeNumeric = parsedBarcode;
            }
        }

        let quantity = Number(entry.quantity || 0);
        if (Number.isNaN(quantity) || quantity < 0) {
            quantity = 0;
        }

        let purchasePrice = null;
        if (entry.purchasePrice !== "" && entry.purchasePrice !== null && entry.purchasePrice !== undefined) {
            const parsedPurchase = Number(entry.purchasePrice);
            if (!Number.isNaN(parsedPurchase) && parsedPurchase >= 0) {
                purchasePrice = parsedPurchase;
            }
        }

        let sellingPrice = null;
        if (entry.sellingPrice !== "" && entry.sellingPrice !== null && entry.sellingPrice !== undefined) {
            const parsedSelling = Number(entry.sellingPrice);
            if (!Number.isNaN(parsedSelling) && parsedSelling >= 0) {
                sellingPrice = parsedSelling;
            }
        }

        let expiryDate = "";
        if (entry.expiryDate) {
            const parsedDate = new Date(entry.expiryDate);
            if (!Number.isNaN(parsedDate.getTime())) {
                expiryDate = parsedDate.toISOString().slice(0, 10);
            }
        }

        normalized.push({
            lotNumber,
            barcodeRaw,
            barcodeNumeric,
            quantity,
            purchasePrice,
            sellingPrice,
            expiryDate,
            supplierId: entry.supplierId || entry.supplierID || null,
            supplierName: entry.supplierName || ""
        });
    });

    const totalQuantity = normalized.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);

    const earliestExpiryDate = normalized
        .map((batch) => batch.expiryDate)
        .filter(Boolean)
        .map((value) => new Date(value))
        .filter((date) => !Number.isNaN(date.getTime()))
        .sort((a, b) => a - b)[0];

    const earliestExpiry = earliestExpiryDate ? earliestExpiryDate.toISOString().slice(0, 10) : "";

    const primaryEntry = normalized.length ? normalized[0] : null;

    const barcodeRawList = normalized
        .map((batch) => batch.barcodeRaw)
        .filter((value) => !!value);

    const barcodeNumericList = normalized
        .map((batch) => batch.barcodeNumeric)
        .filter((value) => value !== null && !Number.isNaN(value));

    return {
        entries: normalized,
        totalQuantity,
        earliestExpiry,
        primaryEntry,
        barcodes: {
            raw: barcodeRawList,
            numeric: barcodeNumericList
        }
    };
}

function syncProductBatches(productId, productName, supplierName, batches, callback) {
    if (!Array.isArray(batches)) {
        if (typeof callback === 'function') {
            callback();
        }
        return;
    }

    inventoryBatchesDB.remove({ productId: productId }, { multi: true }, function (removeErr) {
        if (removeErr) {
            console.error('Failed to clear existing batches for product:', productId, removeErr);
            if (typeof callback === 'function') {
                callback(removeErr);
            }
            return;
        }

        if (batches.length === 0) {
            if (typeof callback === 'function') {
                callback();
            }
            return;
        }

        async.eachSeries(
            batches,
            function (entry, next) {
                if (!entry) {
                    next();
                    return;
                }

                const barcodeValue = entry.barcodeNumeric !== null ? entry.barcodeNumeric : (entry.barcodeRaw || null);

                const batchQuery = {
                    productId: productId,
                    lotNumber: entry.lotNumber || "",
                    barcode: barcodeValue
                };

                const payload = {
                    productId: productId,
                    productName: productName || "",
                    lotNumber: entry.lotNumber || "",
                    barcode: barcodeValue,
                    barcodeRaw: entry.barcodeRaw || "",
                    quantity: Number(entry.quantity || 0),
                    purchasePrice: entry.purchasePrice !== null ? Number(entry.purchasePrice) : null,
                    sellingPrice: entry.sellingPrice !== null ? Number(entry.sellingPrice) : null,
                    expiryDate: entry.expiryDate || "",
                    supplierId: entry.supplierId || null,
                    supplierName: entry.supplierName || supplierName || "",
                    updatedAt: new Date()
                };

                inventoryBatchesDB.update(
                    batchQuery,
                    { $set: payload },
                    { upsert: true },
                    function (err) {
                        if (err) {
                            console.error('Failed to upsert batch for product:', productId, payload, err);
                        }
                        next(err);
                    }
                );
            },
            function (err) {
                if (typeof callback === 'function') {
                    callback(err);
                }
            }
        );
    });
}

function validateBarcodesUnique(barcodes, skipProductId, callback) {
    if (!Array.isArray(barcodes) || barcodes.length === 0) {
        callback();
        return;
    }

    const uniqueBarcodes = [...new Set(
        barcodes
            .map((value) => Number(value))
            .filter((value) => !Number.isNaN(value))
    )];

    if (!uniqueBarcodes.length) {
        callback();
        return;
    }

    async.eachSeries(
        uniqueBarcodes,
        function (barcodeValue, next) {
            inventoryDB.findOne({ barcode: barcodeValue }, function (err, existing) {
                if (err) {
                    next(err);
                    return;
                }

                if (existing && (!skipProductId || existing._id !== skipProductId)) {
                    const duplicateError = new Error("duplicate_barcode");
                    duplicateError.duplicateId = existing._id;
                    duplicateError.barcode = barcodeValue;
                    return next(duplicateError);
                }

                next();
            });
        },
        callback
    );
}

function applyBatchPayloadToProduct(product, batchPayload) {
    if (!batchPayload || !Array.isArray(batchPayload.entries) || batchPayload.entries.length === 0) {
        product.batchSummary = {
            totalQuantity: Number(product.quantity || 0),
            batchCount: 0,
            earliestExpiry: null
        };
        product.additionalBarcodes = [];
        return;
    }

    const primaryEntry = batchPayload.primaryEntry;

    product.quantity = batchPayload.totalQuantity;
    product.batchSummary = {
        totalQuantity: batchPayload.totalQuantity,
        batchCount: batchPayload.entries.length,
        earliestExpiry: batchPayload.earliestExpiry || null
    };

    if (primaryEntry && primaryEntry.lotNumber) {
        product.batchNumber = primaryEntry.lotNumber;
    }

    if (primaryEntry && primaryEntry.barcodeNumeric !== null) {
        product.barcode = primaryEntry.barcodeNumeric;
    } else if (primaryEntry && primaryEntry.barcodeRaw) {
        product.barcode = primaryEntry.barcodeRaw;
    }

    if (batchPayload.earliestExpiry) {
        product.expirationDate = batchPayload.earliestExpiry;
    }

    product.additionalBarcodes = batchPayload.barcodes.raw.slice(1);
}

/**
 * GET endpoint: Get the welcome message for the Inventory API.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/", function (req, res) {
    res.send("Inventory API");
});

/**
 * GET endpoint: Get all products from inventory.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/products", function (req, res) {
    // Products endpoint called (log removed for cleaner output)
    
    // Response guard to prevent duplicate responses
    let responseSent = false;
    const sendResponse = (data, statusCode = 200) => {
        if (responseSent) {
            console.warn('⚠️ Products response already sent, ignoring duplicate');
            return;
        }
        responseSent = true;
        if (!res.headersSent) {
            if (statusCode !== 200) {
                res.status(statusCode);
            }
            res.json(data);
        }
    };
    
    // Fallback timer - if the entire operation takes too long, return empty array
    const fallbackTimer = setTimeout(() => {
        if (!responseSent) {
            console.warn('⏱️ Products endpoint timeout - returning empty array');
            sendResponse([], 200);
        }
    }, 5000); // Reduced to 5 second timeout
    
    // Check if database file exists
    const fs = require('fs');
    const dbExists = fs.existsSync(dbPath);
    
    // Don't wait too long - proceed quickly
    const waitForDB = (attempts = 0) => {
        // If DB is ready OR we've waited enough (500ms max), proceed
        if (inventoryDBReady || attempts >= 5) {
            const queryStartTime = Date.now();
            // Executing products query (log removed for cleaner output)
            
            // If DB file exists but not ready, try to load it
            if (dbExists && !inventoryDBReady && attempts >= 5) {
                console.warn('⚠️ DB file exists but not ready - attempting quick load...');
                inventoryDB.loadDatabase(function(quickLoadErr) {
                    if (!quickLoadErr) {
                        console.log('✅ Quick load successful');
                        inventoryDBReady = true;
                    }
                    // Proceed with query anyway
                    executeQuery();
                });
            } else {
                executeQuery();
            }
            
            function executeQuery() {
                inventoryDB.find({})
                    .limit(10000) // Add limit to prevent huge queries
                    .exec(function (err, products) {
                        const queryDuration = Date.now() - queryStartTime;
                        // Products query completed (log removed for cleaner output)
                        
                        clearTimeout(fallbackTimer);
                        
                        if (responseSent) {
                            console.warn('⚠️ Response already sent via timeout, ignoring query result');
                            return;
                        }
                        
                        if (err) {
                            console.error("Error fetching products:", err);
                            sendResponse({
                                error: "Internal Server Error",
                                message: "Failed to fetch products."
                            }, 500);
                            return;
                        }
                        
                        // Found products (log removed for cleaner output)
                        sendResponse(products || []);
                    });
            }
        } else {
            // Wait 100ms before retrying (max 500ms total)
            setTimeout(() => waitForDB(attempts + 1), 100);
        }
    };
    
    waitForDB();
});

/**
 * POST endpoint: Create a single product (form submission from UI).
 * Accepts multipart/form-data (for optional image upload) and standard fields.
 */
app.post("/product", function (req, res) {
    upload(req, res, function (err) {
        if (err) {
            console.error("Upload error:", err);
            return res.status(400).json({
                error: "Upload Error",
                message: err.message || "Failed to upload file",
            });
        }

        try {
            const data = req.body || {};
            const isUpdate = data.id && String(data.id).trim() !== "";
            const parsedBatches = parseBatchesPayload(data.batches);
            const primaryBatch = parsedBatches.primaryEntry;

            const rawName = data.name ? data.name.toString().trim() : "";
            if (!rawName) {
                return res.status(400).json({
                    error: "Validation Error",
                    message: "Product name is required.",
                });
            }

            const resolvedBarcode = data.barcode && String(data.barcode).trim()
                ? String(data.barcode).trim()
                : (primaryBatch && primaryBatch.barcodeRaw ? primaryBatch.barcodeRaw : "");

            if (!resolvedBarcode) {
                return res.status(400).json({
                    error: "Validation Error",
                    message: "A primary barcode is required. Provide one or add a batch with a barcode.",
                });
            }

            let sellingPriceInput = typeof data.price !== "undefined" && data.price !== ""
                ? data.price
                : (primaryBatch && primaryBatch.sellingPrice !== null ? primaryBatch.sellingPrice : "");

            if (sellingPriceInput === "" || sellingPriceInput === null || Number.isNaN(Number(sellingPriceInput))) {
                return res.status(400).json({
                    error: "Validation Error",
                    message: "Selling Price is required.",
                });
            }

            let purchasePriceInput = typeof data.actualPrice !== "undefined" && data.actualPrice !== ""
                ? data.actualPrice
                : (primaryBatch && primaryBatch.purchasePrice !== null ? primaryBatch.purchasePrice : "");

            let imageName = "";
            if (data.img && validator.escape(data.img) !== "") {
                imageName = sanitizeFilename(data.img);
            }
            if (req.file && req.file.filename) {
                imageName = sanitizeFilename(req.file.filename);
            }

            if (validator.escape(data.remove || "") === "1") {
                try {
                    if (!req.file && imageName) {
                        const imgPath = path.join(appData, appName, "uploads", imageName);
                        if (fs.existsSync(imgPath)) {
                            fs.unlinkSync(imgPath);
                        }
                    }
                    imageName = "";
                } catch (removeErr) {
                    console.error("Failed to remove existing image:", removeErr);
                }
            }

            const productId = isUpdate
                ? parseInt(validator.escape(data.id), 10)
                : Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000);

            const product = {
                _id: productId,
                barcode: Number(resolvedBarcode),
                name: validator.escape(rawName),
                price: validator.escape(String(sellingPriceInput)),
                actualPrice: purchasePriceInput === "" ? "" : validator.escape(String(purchasePriceInput)),
                genericName: validator.escape((data.genericName || "").toString()),
                manufacturer: validator.escape((data.manufacturer || "").toString()),
                supplier: validator.escape((data.supplier || "").toString()),
                batchNumber: validator.escape((data.batchNumber || "").toString()),
                category: data.category ? (parseInt(data.category, 10) || data.category) : "",
                quantity: data.quantity ? parseInt(data.quantity, 10) || 0 : 0,
                minStock: data.minStock ? parseInt(data.minStock, 10) || 1 : 1,
                stock: data.stock ? 0 : 1,
                img: imageName,
                expirationDate: data.expirationDate || "",
                designatedSupplierId: data.designatedSupplierId ? parseInt(data.designatedSupplierId, 10) : null,
                supplierAssignmentDate: data.designatedSupplierId ? new Date() : null,
                supplierAssignmentMethod: data.supplierAssignmentMethod || 'manual',
                reorderPoint: data.reorderPoint ? parseInt(data.reorderPoint, 10) || parseInt(data.minStock || 5, 10) : parseInt(data.minStock || 5, 10),
                reorderQuantity: data.reorderQuantity ? parseInt(data.reorderQuantity, 10) || 10 : 10,
                supplier_id: validator.escape((data.supplier_id || "").toString()),
                expiryAlertDays: data.expiryAlertDays ? parseInt(data.expiryAlertDays, 10) || 30 : 30,
                createdAt: isUpdate ? undefined : new Date(),
                updatedAt: new Date()
            };

            applyBatchPayloadToProduct(product, parsedBatches);

            if (Number.isNaN(Number(product.barcode))) {
                product.barcode = resolvedBarcode;
            }

            const barcodesToValidate = [];
            const numericPrimary = Number(product.barcode);
            if (!Number.isNaN(numericPrimary)) {
                barcodesToValidate.push(numericPrimary);
            }
            barcodesToValidate.push(...parsedBatches.barcodes.numeric);

            const duplicateCompositeQuery = {
                name: product.name,
                batchNumber: product.batchNumber,
                manufacturer: product.manufacturer
            };

            inventoryDB.findOne(duplicateCompositeQuery, function (errDup, existingByCombo) {
                if (errDup) {
                    console.error("Database error on combo duplicate check:", errDup);
                    return res.status(500).json({
                        error: "Internal Server Error",
                        message: "Failed to save product (duplicate combo check).",
                    });
                }

                if (existingByCombo && (!isUpdate || existingByCombo._id !== product._id)) {
                    return res.json({
                        status: 'duplicate_product',
                        id: existingByCombo._id,
                        message: 'A product with the same Name, Batch Number and Manufacturer already exists.'
                    });
                }

                validateBarcodesUnique(barcodesToValidate, isUpdate ? product._id : null, function (duplicateErr) {
                    if (duplicateErr) {
                        if (duplicateErr.message === "duplicate_barcode") {
                            return res.json({
                                status: "duplicate_barcode",
                                id: duplicateErr.duplicateId,
                                barcode: duplicateErr.barcode
                            });
                        }
                        console.error("Barcode validation error:", duplicateErr);
                        return res.status(500).json({
                            error: "Internal Server Error",
                            message: "Failed to validate product barcodes."
                        });
                    }

                if (!isUpdate) {
                    inventoryDB.insert(product, function (errInsert, saved) {
                        if (errInsert) {
                            console.error("Insert error:", errInsert);
                            return res.status(500).json({
                                error: "Internal Server Error",
                                message: "Failed to save product.",
                            });
                        }

                        syncProductBatches(saved._id, saved.name, saved.supplier, parsedBatches.entries, function (batchErr) {
                            if (batchErr) {
                                console.error("Batch sync error (create):", batchErr);
                            }

                            return res.json({
                                success: true,
                                message: 'Product saved successfully.',
                                data: saved,
                                batchWarning: batchErr ? batchErr.message : null
                            });
                        });
                    });
                } else {
                    inventoryDB.findOne({ _id: product._id }, function (findErr, existingProduct) {
                        if (findErr) {
                            console.error("Product lookup error:", findErr);
                            return res.status(500).json({
                                error: "Internal Server Error",
                                message: "Failed to update product.",
                            });
                        }

                        if (!existingProduct) {
                            return res.status(404).json({
                                error: "Not Found",
                                message: "Product not found."
                            });
                        }

                        if (existingProduct.createdAt) {
                            product.createdAt = existingProduct.createdAt;
                        } else if (!product.createdAt) {
                            product.createdAt = new Date();
                        }

                        inventoryDB.update(
                            { _id: product._id },
                            product,
                            {},
                            function (errUpdate) {
                                if (errUpdate) {
                                    console.error("Update error:", errUpdate);
                                    return res.status(500).json({
                                        error: "Internal Server Error",
                                        message: "Failed to update product.",
                                    });
                                }

                                syncProductBatches(product._id, product.name, product.supplier, parsedBatches.entries, function (batchErr) {
                                    if (batchErr) {
                                        console.error("Batch sync error (update):", batchErr);
                                    }

                                    return res.json({
                                        success: true,
                                        message: `Product "${product.name}" updated successfully!`,
                                        product: product,
                                        batchWarning: batchErr ? batchErr.message : null
                                    });
                                });
                            }
                        );
                    });
                }
                });
            });
        } catch (e) {
            console.error("Unexpected error while saving product:", e);
            return res.status(500).json({
                error: "Internal Server Error",
                message: e.message || "Unexpected error",
            });
        }
    });
});

/**
 * GET endpoint: Debug - Get sample products with supplier information.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/products/debug", function (req, res) {
    console.log("Products debug endpoint called - fetching sample products...");
    
    inventoryDB.find({}, function (err, products) {
        if (err) {
            console.error("Error fetching products for debug:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to fetch products for debug."
            });
            return;
        }
        
        console.log(`Found ${products.length} products for debug`);
        
        // Return first 5 products with supplier information
        const sampleProducts = products.slice(0, 5).map(product => ({
            _id: product._id,
            name: product.name,
            supplier_id: product.supplier_id,
            supplierId: product.supplierId,
            supplier: product.supplier,
            barcode: product.barcode
        }));
        
        res.json({
            totalProducts: products.length,
            sampleProducts: sampleProducts,
            allSupplierIds: [...new Set(products.map(p => p.supplier_id).filter(Boolean))],
            allSupplierNames: [...new Set(products.map(p => p.supplier).filter(Boolean))]
        });
    });
});

/**
 * GET endpoint: Debug - Get suppliers information.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/suppliers/debug", function (req, res) {
    console.log("Suppliers debug endpoint called - fetching suppliers...");
    
    const supplierDBPath = path.join(appData, appName, "server", "databases", "suppliers.db");
    const supplierDB = new Datastore({
        filename: supplierDBPath,
        autoload: true
    });
    
    supplierDB.find({}, function (err, suppliers) {
        if (err) {
            console.error("Error fetching suppliers for debug:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to fetch suppliers for debug."
            });
            return;
        }
        
        console.log(`Found ${suppliers.length} suppliers for debug`);
        
        res.json({
            totalSuppliers: suppliers.length,
            suppliers: suppliers.map(supplier => ({
                _id: supplier._id,
                name: supplier.name,
                code: supplier.code
            }))
        });
    });
});

/**
 * GET endpoint: Get products by supplier ID.
 *
 * @param {Object} req request object with supplier ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/products/supplier/:supplierId", function (req, res) {
    const supplierId = req.params.supplierId;
    console.log(`Products by supplier endpoint called for supplier: ${supplierId}`);
    
    if (!supplierId) {
        res.status(400).json({
            error: "Bad Request",
            message: "Supplier ID is required."
        });
        return;
    }
    
    // First, get the supplier name from the supplier ID
    const supplierDBPath = path.join(appData, appName, "server", "databases", "suppliers.db");
    const supplierDB = new Datastore({
        filename: supplierDBPath,
        autoload: true
    });
    
    // Try both string and number lookups since there might be a data type mismatch
    const numericSupplierId = parseInt(supplierId);
    const stringSupplierId = supplierId.toString();
    
    console.log(`Looking for supplier with ID: ${supplierId} (numeric: ${numericSupplierId}, string: ${stringSupplierId})`);
    
    // Try numeric ID first
    supplierDB.findOne({ _id: numericSupplierId }, function (err, supplier) {
        if (err) {
            console.error("Error fetching supplier with numeric ID:", err);
            // Try string ID as fallback
            supplierDB.findOne({ _id: stringSupplierId }, function (err2, supplier2) {
                if (err2) {
                    console.error("Error fetching supplier with string ID:", err2);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "Failed to fetch supplier information."
                    });
                    return;
                }
                processSupplierResult(supplier2, stringSupplierId);
            });
            return;
        }
        
        if (supplier) {
            processSupplierResult(supplier, numericSupplierId);
        } else {
            // Try string ID as fallback
            console.log(`Supplier not found with numeric ID ${numericSupplierId}, trying string ID ${stringSupplierId}`);
            supplierDB.findOne({ _id: stringSupplierId }, function (err2, supplier2) {
                if (err2) {
                    console.error("Error fetching supplier with string ID:", err2);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "Failed to fetch supplier information."
                    });
                    return;
                }
                processSupplierResult(supplier2, stringSupplierId);
            });
        }
    });
    
    function processSupplierResult(supplier, usedId) {
        console.log(`Supplier lookup result for ID ${usedId}:`, supplier);
        
        if (!supplier) {
            console.log(`Supplier not found for ID: ${usedId}`);
            res.json([]);
            return;
        }
        
        const supplierName = supplier.name;
        console.log(`Supplier name for ID ${usedId}: ${supplierName}`);
        
        // Search for products with this supplier name (since products are linked by name, not ID)
        const query = { supplier: supplierName };
        
        console.log("Search query:", JSON.stringify(query, null, 2));
        
        inventoryDB.find(query, function (err, products) {
            if (err) {
                console.error("Error fetching products for supplier:", err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "Failed to fetch products for supplier."
                });
                return;
            }
            
            console.log(`Found ${products.length} products for supplier ${supplierName} (ID: ${usedId})`);
            
            // Debug: Log first few products to see their supplier fields
            if (products.length > 0) {
                console.log("Sample product supplier fields:", {
                    supplier_id: products[0].supplier_id,
                    supplier: products[0].supplier,
                    name: products[0].name
                });
            } else {
                console.log("No products found. Let's check if there are any products with similar supplier names...");
                // Debug: Check if there are any products with similar supplier names
                inventoryDB.find({}, function (err, allProducts) {
                    if (!err && allProducts.length > 0) {
                        const uniqueSuppliers = [...new Set(allProducts.map(p => p.supplier).filter(Boolean))];
                        console.log("All supplier names in products:", uniqueSuppliers);
                        console.log("Looking for supplier name:", supplierName);
                        console.log("Exact match found:", uniqueSuppliers.includes(supplierName));
                    }
                });
            }
            
            res.json(products);
        });
    }
});

// Test endpoint for debugging
app.post("/test", function (req, res) {
    console.log("Test endpoint called");
    console.log("Request body:", req.body);
    console.log("Request headers:", req.headers);
    
    // Test if remove method exists and works
    console.log("Testing remove method...");
    if (typeof inventoryDB.remove === 'function') {
        console.log("✓ remove method exists");
        // Test with a dummy query that won't affect data
        inventoryDB.remove({ _id: -999999 }, { multi: false }, function(err, numRemoved) {
            if (err) {
                console.log("✗ remove method test failed:", err.message);
            } else {
                console.log("✓ remove method test passed, removed:", numRemoved);
            }
        });
    } else {
        console.log("✗ remove method does not exist");
    }
    
    res.json({
        success: true,
        message: "Test endpoint working",
        body: req.body,
        headers: req.headers
    });
});

/**
 * GET endpoint: Get product details by product ID.
 *
 * @param {Object} req request object with product ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/product/:productId", function (req, res) {
    if (!req.params.productId) {
        res.status(500).send("ID field is required.");
    } else {
        inventoryDB.findOne(
            {
                _id: parseInt(req.params.productId),
            },
            function (err, product) {
                res.send(product);
            },
        );
    }
});


/**
 * POST endpoint: Create or update a product.
 *
 * @param {Object} req request object with product data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/product", function (req, res) {
    upload(req, res, function (err) {

        if (err) {
            if (err instanceof multer.MulterError) {
                console.error('Upload Error:', err);
                return res.status(400).json({
                    error: 'Upload Error',
                    message: err.message,
                });
            } else {
                console.error('Unknown Error:', err);
                return res.status(500).json({
                    error: 'Internal Server Error',
                    message: err.message,
                });
            }
        }

    let image = "";

    if (validator.escape(req.body.img) !== "") {
        image = sanitizeFilename(req.body.img);
    }

    if (req.file) {
        image = sanitizeFilename(req.file.filename);
    }


    if (validator.escape(req.body.remove) === "1") {
            try {
                let imgPath = path.join(
                appData,
                appName,
                "uploads",
                image,
                );

                if (!req.file) {
                fs.unlinkSync(imgPath);
                image = "";
                }
                
            } catch (err) {
                console.error(err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "An unexpected error occurred.",
                });
            }

        }

    let Product = {
        _id: parseInt(validator.escape(req.body.id)),
        barcode: parseInt(validator.escape(req.body.barcode)),
        expirationDate: validator.escape(req.body.expirationDate),
        price: validator.escape(req.body.price),
        actualPrice: validator.escape(req.body.actualPrice || ""),
        genericName: validator.escape(req.body.genericName || ""),
        manufacturer: validator.escape(req.body.manufacturer || ""),
        supplier: validator.escape(req.body.supplier || ""),
        batchNumber: validator.escape(req.body.batchNumber || ""),
        category: validator.escape(req.body.category),
        quantity:
            validator.escape(req.body.quantity) == ""
                ? 0
                : validator.escape(req.body.quantity),
        name: validator.escape(req.body.name),
        stock: req.body.stock === "on" ? 0 : 1,
        minStock: validator.escape(req.body.minStock),
        reorderPoint: validator.escape(req.body.reorderPoint || req.body.minStock || 5),
        reorderQuantity: validator.escape(req.body.reorderQuantity || 10),
        supplier_id: validator.escape(req.body.supplier_id || ""),
        expiryAlertDays: validator.escape(req.body.expiryAlertDays || 30),
        img: image,
    };

    if (validator.escape(req.body.id) === "") {
        // New product: prevent duplicates by barcode or by (name,batchNumber,manufacturer)
        const barcodeVal = parseInt(validator.escape(req.body.barcode));
        const nameVal = validator.escape(req.body.name).trim();
        const batchVal = validator.escape(req.body.batchNumber || "");
        const manuVal = validator.escape(req.body.manufacturer || "");

        const duplicateByBarcode = { barcode: barcodeVal };
        const duplicateByComposite = {
            name: new RegExp("^" + nameVal + "$", "i"),
            batchNumber: new RegExp("^" + batchVal + "$", "i"),
            manufacturer: new RegExp("^" + manuVal + "$", "i"),
        };

        inventoryDB.findOne(duplicateByBarcode, function (e1, d1) {
            if (d1) {
                return res.status(200).json({ status: "duplicate_barcode", id: d1._id });
            }
            inventoryDB.findOne(duplicateByComposite, function (e2, d2) {
                if (d2) {
                    return res.status(200).json({ status: "duplicate_product", id: d2._id });
                }
                Product._id = Math.floor(Date.now() / 1000);
                inventoryDB.insert(Product, function (err, product) {
                    if (err) {
                        console.error(err);
                        res.status(500).json({
                            error: "Internal Server Error",
                            message: "An unexpected error occurred.",
                        });
                    } else {
                        console.log(`Product created successfully: ${Product.name}`);
                        res.json({
                            success: true,
                            message: `Product "${Product.name}" created successfully!`,
                            product: product
                        });
                    }
                });
            });
        });
    } else {
        // Update: prevent setting a barcode that belongs to a different product
        const currentId = parseInt(validator.escape(req.body.id));
        const newBarcode = parseInt(validator.escape(req.body.barcode));
        inventoryDB.findOne({ barcode: newBarcode }, function (e3, d3) {
            if (d3 && d3._id !== currentId) {
                return res.status(200).json({ status: "duplicate_barcode", id: d3._id });
            }
            inventoryDB.update(
                { _id: currentId },
                Product,
                {},
                function (err, numReplaced, product) {
                    if (err) {
                        console.error(err);
                        res.status(500).json({
                            error: "Internal Server Error",
                            message: "An unexpected error occurred.",
                        });
                    } else {
                        console.log(`Product updated successfully: ${Product.name}`);
                        res.json({
                            success: true,
                            message: `Product "${Product.name}" updated successfully!`,
                            product: Product
                        });
                        }
                    },
                );
        });
    }
    });
});

/**
 * DELETE endpoint: Delete a product by product ID.
 *
 * @param {Object} req request object with product ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.delete("/product/:productId", function (req, res) {
    inventoryDB.remove(
        {
            _id: parseInt(req.params.productId),
        },
        { multi: false },
        function (err, numRemoved) {
            if (err) {
                console.error(err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "An unexpected error occurred.",
                });
            } else {
                console.log(`Product deleted successfully, ID: ${req.params.productId}`);
                res.json({
                    success: true,
                    message: "Product deleted successfully!",
                    deletedId: req.params.productId
                });
            }
        },
    );
});

/**
 * POST endpoint: Bulk import products from CSV file.
 *
 * @param {Object} req request object with CSV file and options in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/bulk-import", csvUpload.single('csvFile'), function (req, res) {
    console.log("Bulk import endpoint called");
    console.log("Request body:", req.body);
    console.log("Request file:", req.file);
    console.log("Default category:", req.body.defaultCategory);
    console.log("Skip duplicates:", req.body.skipDuplicates);
    console.log("Update existing:", req.body.updateExisting);
    
    if (!req.file) {
        return res.status(400).json({
            error: "No file uploaded",
            message: "Please select a CSV file to import."
        });
    }

    if (!req.body.defaultCategory) {
        console.log("Warning: No default category specified");
    }

    // Normalize boolean flags coming from multipart form-data
    const parseBool = (v) => {
        if (Array.isArray(v)) {
            return v.includes('on') || v.includes('true') || v.includes('1');
        }
        return v === true || v === 'true' || v === '1' || v === 1;
    };
    const skipDuplicates = parseBool(req.body.skipDuplicates);
    const updateExisting = parseBool(req.body.updateExisting);
    let createManufacturers = parseBool(req.body.createManufacturers);
    let createSuppliers = parseBool(req.body.createSuppliers);
    
    // Check settings for auto-create manufacturers if not explicitly set
    if (!createManufacturers) {
        try {
            const settingsDB = new Datastore({
                filename: path.join(process.env.APPDATA, process.env.APPNAME, "server", "databases", "settings.db"),
                autoload: true
            });
            
            settingsDB.findOne({ _id: 1 }, (err, settings) => {
                if (!err && settings && settings.settings && settings.settings.autoCreateManufacturers) {
                    createManufacturers = true;
                    console.log('- Auto-create manufacturers enabled from settings');
                }
            });
        } catch (err) {
            console.log('- Could not load settings for manufacturer auto-creation');
        }
    }
    
    // Check settings for auto-create suppliers if not explicitly set
    if (!createSuppliers) {
        try {
            const settingsDB = new Datastore({
                filename: path.join(process.env.APPDATA, process.env.APPNAME, "server", "databases", "settings.db"),
                autoload: true
            });
            
            settingsDB.findOne({ _id: 1 }, (err, settings) => {
                if (!err && settings && settings.settings && settings.settings.autoCreateSuppliers) {
                    createSuppliers = true;
                    console.log('- Auto-create suppliers enabled from settings');
                }
            });
        } catch (err) {
            console.log('- Could not load settings for supplier auto-creation');
        }
    }

    console.log('Bulk import started with options:');
    console.log('- Skip Duplicates:', skipDuplicates);
    console.log('- Update Existing:', updateExisting);
    console.log('- Create Manufacturers:', createManufacturers);
    console.log('- Create Suppliers:', createSuppliers);
    console.log('- Default Category:', req.body.defaultCategory);
    console.log('- File:', req.file.originalname);

    const csv = require('csv-parser');
    const fs = require('fs');
    const results = [];
    const errors = [];
    let processed = 0;
    let totalRows = 0;

    // Count total rows first
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', () => totalRows++)
        .on('end', () => {
            // Now process the actual data
            const rows = [];
            fs.createReadStream(req.file.path)
                .pipe(csv())
                .on('data', (data) => {
                    rows.push(data);
                })
                .on('end', () => {
                    // Process rows sequentially to handle categories properly
                    processRowsSequentially(rows, 0);
                });
        });

    function processRowsSequentially(rows, index) {
        if (index >= rows.length) {
            // All rows processed, send response
            // Safe file cleanup with error handling
            try {
                if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
                }
            } catch (cleanupError) {
                console.log(`File cleanup warning: ${cleanupError.message}`);
            }
            
            // Force database reload to ensure fresh data
            console.log("Forcing database reload after bulk import...");
            try {
                // Reload all relevant databases
                const categoryDBPath = path.join(appData, appName, "server", "databases", "categories.db");
                const manufacturerDBPath = path.join(appData, appName, "server", "databases", "manufacturers.db");
                const supplierDBPath = path.join(appData, appName, "server", "databases", "suppliers.db");
                
                // Force reload by creating new instances
                const categoryDB = new Datastore({ filename: categoryDBPath, autoload: true });
                const manufacturerDB = new Datastore({ filename: manufacturerDBPath, autoload: true });
                const supplierDB = new Datastore({ filename: supplierDBPath, autoload: true });
                
                console.log("Databases reloaded successfully");
            } catch (reloadError) {
                console.log(`Database reload warning: ${reloadError.message}`);
            }
            
            // Safely compact and sync databases after bulk import completion
            try {
                console.log(`- Compacting inventory database...`);
                inventoryDB.compactDatafile();
            } catch (compactError) {
                console.log(`- Inventory database compaction warning: ${compactError.message}`);
            }
            
            res.json({
                success: true,
                message: `Import completed. Processed ${processed} products.`,
                processed: processed,
                errors: errors,
                totalRows: totalRows
            });
            return;
        }

        const data = rows[index];
        
        try {
            // Validate required fields (SellingPrice or Price is required)
            const sellingPriceField = (typeof data.SellingPrice !== 'undefined' && data.SellingPrice !== '') ? data.SellingPrice : data.Price;
            if (!data.Name || !data.Barcode || typeof sellingPriceField === 'undefined' || sellingPriceField === '') {
                errors.push({
                    row: index + 1,
                    error: 'Missing required fields (Name, Barcode, or SellingPrice/Price)',
                    data: data
                });
                processed++;
                processRowsSequentially(rows, index + 1);
                return;
            }

            // Validate barcode format
            if (isNaN(parseInt(data.Barcode))) {
                errors.push({
                    row: index + 1,
                    error: 'Invalid barcode format (must be numeric)',
                    data: data
                });
                processed++;
                processRowsSequentially(rows, index + 1);
                return;
            }

            // Validate selling price format
            if (isNaN(parseFloat(sellingPriceField))) {
                errors.push({
                    row: index + 1,
                    error: 'Invalid selling price format (must be numeric)',
                    data: data
                });
                processed++;
                processRowsSequentially(rows, index + 1);
                return;
            }

            // Validate purchase/actual price format if provided
            if (typeof data.PurchasePrice !== 'undefined' && data.PurchasePrice !== '' && isNaN(parseFloat(data.PurchasePrice))) {
                errors.push({
                    row: index + 1,
                    error: 'Invalid purchase price format (must be numeric)',
                    data: data
                });
                processed++;
                processRowsSequentially(rows, index + 1);
                return;
            }
            if (typeof data.ActualPrice !== 'undefined' && data.ActualPrice !== '' && isNaN(parseFloat(data.ActualPrice))) {
                errors.push({
                    row: index + 1,
                    error: 'Invalid purchase/actual price format (must be numeric)',
                    data: data
                });
                processed++;
                processRowsSequentially(rows, index + 1);
                return;
            }

            // Comprehensive duplicate checking
            const barcodeVal = parseInt(data.Barcode);
            const nameVal = validator.escape((data.Name || '').trim());
            const batchVal = validator.escape((data.BatchNumber || '').toString().trim());
            const manuVal = validator.escape((data.Manufacturer || '').toString().trim());

            // Check for duplicates by barcode first
            inventoryDB.findOne({ barcode: barcodeVal }, function (err, existingByBarcode) {
                if (err) {
                    errors.push({ row: index + 1, error: 'Database error checking barcode: ' + err.message, data });
                    processed++;
                    return processRowsSequentially(rows, index + 1);
                }

                if (existingByBarcode) {
                    // Duplicate barcode found
                    if (skipDuplicates && !updateExisting) {
                        errors.push({ row: index + 1, error: 'Duplicate barcode found (skipped)', data });
                        processed++;
                        return processRowsSequentially(rows, index + 1);
                    }
                    
                    if (updateExisting) {
                        errors.push({ row: index + 1, error: 'Duplicate barcode found (will update existing)', data });
                        // Process as update
                        return processProductWithCategory(data, req.body.defaultCategory, true, existingByBarcode._id, () => {
                            processRowsSequentially(rows, index + 1);
                        });
                    }
                    
                    // If neither skip nor update, proceed with insert (will fail with constraint error)
                    return processProductWithCategory(data, req.body.defaultCategory, false, null, () => {
                        processRowsSequentially(rows, index + 1);
                    });
                }

                // No barcode duplicate, check for composite duplicates
                // Check by name first (most common duplicate scenario)
                if (nameVal) {
                    inventoryDB.findOne({
                        name: new RegExp('^' + nameVal + '$', 'i')
                    }, function (err2, existingByName) {
                        if (err2) {
                            errors.push({ row: index + 1, error: 'Database error checking by name: ' + err2.message, data });
                            processed++;
                            return processRowsSequentially(rows, index + 1);
                        }

                        if (existingByName) {
                            // Duplicate name found
                            if (skipDuplicates && !updateExisting) {
                                errors.push({ row: index + 1, error: 'Duplicate product name found (skipped)', data });
                                processed++;
                                return processRowsSequentially(rows, index + 1);
                            }
                            
                            if (updateExisting) {
                                errors.push({ row: index + 1, error: 'Duplicate product name found (will update existing)', data });
                                // Process as update using the found product's ID
                                return processProductWithCategory(data, req.body.defaultCategory, true, existingByName._id, () => {
                                    processRowsSequentially(rows, index + 1);
                                });
                            }
                            
                            // If neither skip nor update, proceed with insert
                            return processProductWithCategory(data, req.body.defaultCategory, false, null, () => {
                                processRowsSequentially(rows, index + 1);
                            });
                        }

                        // No name duplicate, check for more specific composite duplicates if fields exist
                        if (batchVal && manuVal) {
                            inventoryDB.findOne({
                                name: new RegExp('^' + nameVal + '$', 'i'),
                                batchNumber: new RegExp('^' + batchVal + '$', 'i'),
                                manufacturer: new RegExp('^' + manuVal + '$', 'i')
                            }, function (err3, existingByComposite) {
                                if (err3) {
                                    errors.push({ row: index + 1, error: 'Database error checking composite: ' + err3.message, data });
                                    processed++;
                                    return processRowsSequentially(rows, index + 1);
                                }

                                if (existingByComposite) {
                                    // Duplicate composite found
                                    if (skipDuplicates && !updateExisting) {
                                        errors.push({ row: index + 1, error: 'Duplicate product (name+batch+manufacturer) found (skipped)', data });
                                        processed++;
                                        return processRowsSequentially(rows, index + 1);
                                    }
                                    
                                    if (updateExisting) {
                                        errors.push({ row: index + 1, error: 'Duplicate product (name+batch+manufacturer) found (will update existing)', data });
                                        // Process as update using the found product's ID
                                        return processProductWithCategory(data, req.body.defaultCategory, true, existingByComposite._id, () => {
                                            processRowsSequentially(rows, index + 1);
                                        });
                                    }
                                    
                                    // If neither skip nor update, proceed with insert
                                    return processProductWithCategory(data, req.body.defaultCategory, false, null, () => {
                                        processRowsSequentially(rows, index + 1);
                                    });
                                }

                                // No duplicates found, proceed with insert
                                return processProductWithCategory(data, req.body.defaultCategory, false, null, () => {
                                    processRowsSequentially(rows, index + 1);
                                });
                            });
                        } else {
                            // No composite fields to check, proceed with insert
                            return processProductWithCategory(data, req.body.defaultCategory, false, null, () => {
                                processRowsSequentially(rows, index + 1);
                            });
                        }
                    });
                } else {
                    // No name field, proceed with insert (this should rarely happen)
                    return processProductWithCategory(data, req.body.defaultCategory, false, null, () => {
                        processRowsSequentially(rows, index + 1);
                    });
                }
            });
        } catch (error) {
            errors.push({
                row: index + 1,
                error: 'Processing error: ' + error.message,
                data: data
            });
            processed++;
            processRowsSequentially(rows, index + 1);
        }
    }

    // Function to create or find manufacturer
    function processManufacturer(manufacturerName, callback) {
        if (!manufacturerName || manufacturerName.trim() === '') {
            return callback(null, null);
        }

        const manufacturerDBPath = path.join(appData, appName, "server", "databases", "manufacturers.db");
        
        // Add safety check for database file
        const fs = require('fs');
        if (!fs.existsSync(manufacturerDBPath)) {
            console.log(`- Manufacturer database file does not exist, creating directory structure`);
            const dbDir = path.dirname(manufacturerDBPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }
        }
        
        const manufacturerDB = new Datastore({
            filename: manufacturerDBPath,
            autoload: true,
            onload: function(err) {
                if (err) {
                    console.error(`Manufacturer database load error: ${err.message}`);
                }
            }
        });

        const cleanName = validator.escape(manufacturerName.trim());
        
        // Check if manufacturer exists
        manufacturerDB.findOne({ name: cleanName }, function (err, existingManufacturer) {
            if (err) {
                console.error(`Manufacturer lookup error for ${cleanName}:`, err);
                return callback(err, null);
            }
            
            if (existingManufacturer) {
                console.log(`- Using existing manufacturer: ${cleanName} (ID: ${existingManufacturer._id})`);
                return callback(null, existingManufacturer._id);
            }
            
            // Create new manufacturer if createManufacturers is enabled
            if (createManufacturers) {
                const newManufacturer = {
                    _id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000),
                    name: cleanName,
                    code: cleanName.substring(0, 5).toUpperCase(), // Auto-generate code from name
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                
                console.log(`- Creating new manufacturer: ${cleanName} (ID: ${newManufacturer._id})`);
                
                try {
                    manufacturerDB.insert(newManufacturer, function (err, manufacturer) {
                        if (err) {
                            console.error(`Manufacturer creation error for ${cleanName}:`, err);
                            return callback(err, null);
                        }
                        
                        console.log(`- Successfully created new manufacturer: ${cleanName} (ID: ${manufacturer._id})`);
                        return callback(null, manufacturer._id);
                    });
                } catch (dbError) {
                    console.error(`Manufacturer database operation error for ${cleanName}:`, dbError);
                    return callback(dbError, null);
                }
            } else {
                console.log(`- Manufacturer not found and auto-creation disabled: ${cleanName}`);
                return callback(null, null);
            }
        });
    }

    // Function to create or find supplier
    function processSupplier(supplierName, callback) {
        if (!supplierName || supplierName.trim() === '') {
            return callback(null, null);
        }

        const supplierDBPath = path.join(appData, appName, "server", "databases", "suppliers.db");
        
        // Add safety check for database file
        if (!fs.existsSync(supplierDBPath)) {
            console.log(`- Supplier database file does not exist, creating directory structure`);
            const dbDir = path.dirname(supplierDBPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }
        }
        
        const supplierDB = new Datastore({
            filename: supplierDBPath,
            autoload: true,
            onload: function(err) {
                if (err) {
                    console.error(`Supplier database load error: ${err.message}`);
                }
            }
        });

        const cleanName = validator.escape(supplierName.trim());
        
        // Check if supplier exists
        supplierDB.findOne({ name: cleanName }, function (err, existingSupplier) {
            if (err) {
                console.error(`Supplier lookup error for ${cleanName}:`, err);
                return callback(err, null);
            }
            
            if (existingSupplier) {
                console.log(`- Using existing supplier: ${cleanName} (ID: ${existingSupplier._id})`);
                return callback(null, existingSupplier._id);
            }
            
            // Create new supplier if createSuppliers is enabled
            if (createSuppliers) {
                const newSupplier = {
                    _id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000),
                    name: cleanName,
                    code: `SUPP-${cleanName.substring(0, 3).toUpperCase()}-${Date.now()}`,
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                
                console.log(`- Creating new supplier: ${cleanName} (ID: ${newSupplier._id})`);
                
                try {
                    supplierDB.insert(newSupplier, function (err, supplier) {
                        if (err) {
                            console.error(`Supplier creation error for ${cleanName}:`, err);
                            return callback(err, null);
                        }
                        
                        console.log(`- Successfully created new supplier: ${cleanName} (ID: ${supplier._id})`);
                        return callback(null, supplier._id);
                    });
                } catch (dbError) {
                    console.error(`Supplier database operation error for ${cleanName}:`, dbError);
                    return callback(dbError, null);
                }
            } else {
                console.log(`- Supplier not found and auto-creation disabled: ${cleanName}`);
                return callback(null, null);
            }
        });
    }

    function processProductWithCategory(data, defaultCategory, updateExisting, existingProductId, callback) {
        // Handle category - check if it exists in the database, if not create it
        let categoryId = defaultCategory; // Default to the selected category
        
        // Handle manufacturer - check if it exists in the database, if not create it
        let manufacturerId = null;
        
        console.log(`Processing category for product: ${data.Name}`);
        console.log(`- CSV Category: "${data.Category}"`);
        console.log(`- Default Category: ${defaultCategory}`);
        console.log(`- CSV Manufacturer: "${data.Manufacturer || 'Not specified'}"`);
        
        if (data.Category && data.Category.trim() !== '') {
            // Try to find existing category by name
            const categoryName = validator.escape(data.Category.trim());
            console.log(`- Looking for category: "${categoryName}"`);
            
            // First check if category exists
            const categoryDBPath = path.join(appData, appName, "server", "databases", "categories.db");
            console.log(`- Categories database path: ${categoryDBPath}`);
            console.log(`- AppData: ${appData}`);
            console.log(`- AppName: ${appName}`);
            
            const categoryDB = new Datastore({
                filename: categoryDBPath,
                autoload: true,
            });
            
            console.log(`- Category database loaded: ${categoryDB ? 'Yes' : 'No'}`);
            console.log(`- Category database type: ${typeof categoryDB}`);
            
            // Check if database file exists
            const fs = require('fs');
            if (fs.existsSync(categoryDBPath)) {
                console.log(`- Categories database file exists`);
                // Check file size and permissions
                const stats = fs.statSync(categoryDBPath);
                console.log(`- Categories database file size: ${stats.size} bytes`);
                console.log(`- Categories database file permissions: ${stats.mode}`);
            } else {
                console.log(`- Categories database file does not exist`);
                // Try to create the directory if it doesn't exist
                const dbDir = path.dirname(categoryDBPath);
                if (!fs.existsSync(dbDir)) {
                    console.log(`- Creating database directory: ${dbDir}`);
                    fs.mkdirSync(dbDir, { recursive: true });
                }
            }
            
            categoryDB.findOne({ name: categoryName }, function (err, existingCategory) {
                console.log(`- Category lookup result for "${categoryName}":`, { err, existingCategory });
                
                if (err) {
                    console.error(`Category lookup error for ${categoryName}:`, err);
                    // Use default category if lookup fails
                    console.log(`- Using default category due to lookup error: ${defaultCategory}`);
                    categoryId = defaultCategory;
                    // Process manufacturer and supplier after category
                    processManufacturer(data.Manufacturer, (err, manufacturerId) => {
                        if (err) {
                            console.log(`- Manufacturer processing error: ${err.message}`);
                            manufacturerId = null;
                        }
                        
                        // Process supplier
                        processSupplier(data.Supplier, (err2, supplierId) => {
                            if (err2) {
                                console.log(`- Supplier processing error: ${err2.message}`);
                                supplierId = null;
                            }
                            
                            // Now process the product with all the resolved IDs
                    processProductData(data, categoryId, updateExisting, null, callback);
                        });
                    });
                } else if (existingCategory) {
                    // Use existing category ID
                    categoryId = existingCategory._id;
                    console.log(`- Using existing category: ${categoryName} (ID: ${categoryId})`);
                    // Process manufacturer and supplier after category
                    processManufacturer(data.Manufacturer, (err, manufacturerId) => {
                        if (err) {
                            console.log(`- Manufacturer processing error: ${err.message}`);
                            manufacturerId = null;
                        }
                        
                        // Process supplier
                        processSupplier(data.Supplier, (err2, supplierId) => {
                            if (err2) {
                                console.log(`- Supplier processing error: ${err2.message}`);
                                supplierId = null;
                            }
                            
                            // Now process the product with all the resolved IDs
                    processProductData(data, categoryId, updateExisting, null, callback);
                        });
                    });
                } else {
                    // Create new category
                    const newCategory = {
                        _id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000),
                        name: categoryName
                    };
                    
                    console.log(`- Creating new category: ${categoryName} (ID: ${newCategory._id})`);
                    console.log(`- New category object:`, newCategory);
                    
                    // Test if the database is working by trying to find all categories first
                    categoryDB.find({}, function(err, allCategories) {
                        console.log(`- Current categories in database:`, { err, allCategories });
                        
                        // Now try to insert the new category
                        categoryDB.insert(newCategory, function (err, category) {
                            console.log(`- Category insert result:`, { err, category });
                            
                            if (err) {
                                console.error(`Category creation error for ${categoryName}:`, err);
                                console.log(`- Error details:`, err.message, err.stack);
                                console.log(`- Falling back to default category: ${defaultCategory}`);
                                categoryId = defaultCategory; // Fallback to default
                            } else {
                                categoryId = newCategory._id;
                                console.log(`- Successfully created new category: ${categoryName} (ID: ${categoryId})`);
                                console.log(`- Inserted category object:`, category);
                            }
                            // Process manufacturer and supplier after category
                            processManufacturer(data.Manufacturer, (err, manufacturerId) => {
                                if (err) {
                                    console.log(`- Manufacturer processing error: ${err.message}`);
                                    manufacturerId = null;
                                }
                                
                                // Process supplier
                                processSupplier(data.Supplier, (err2, supplierId) => {
                                    if (err2) {
                                        console.log(`- Supplier processing error: ${err2.message}`);
                                        supplierId = null;
                                    }
                                    
                                    // Now process the product with all the resolved IDs
                            processProductData(data, categoryId, updateExisting, null, callback);
                                });
                            });
                        });
                    });
                }
            });
        } else {
            // No category specified, use default
            console.log(`- No category specified in CSV, using default: ${defaultCategory}`);
            // Process manufacturer and supplier after category
            processManufacturer(data.Manufacturer, (err, manufacturerId) => {
                if (err) {
                    console.log(`- Manufacturer processing error: ${err.message}`);
                    manufacturerId = null;
                }
                
                // Process supplier
                processSupplier(data.Supplier, (err2, supplierId) => {
                    if (err2) {
                        console.log(`- Supplier processing error: ${err2.message}`);
                        supplierId = null;
                    }
                    
                    // Now process the product with all the resolved IDs
                    processProductData(data, categoryId, updateExisting, existingProductId, callback);
                });
            });
        }
    }
    


    function processProductData(data, categoryId, updateExisting, existingProductId, callback) {
        const sellingPriceField = (typeof data.SellingPrice !== 'undefined' && data.SellingPrice !== '') ? data.SellingPrice : data.Price;
        
        // Get manufacturer name from the data (this should already be processed)
        const manufacturerName = data.Manufacturer ? validator.escape(data.Manufacturer.toString()) : "";
        
        const productData = {
            barcode: parseInt(data.Barcode),
            name: validator.escape(data.Name),
            price: validator.escape(sellingPriceField),
            // Accept both PurchasePrice (new) and ActualPrice (legacy)
            actualPrice: validator.escape((data.PurchasePrice !== undefined && data.PurchasePrice !== "") ? data.PurchasePrice : (data.ActualPrice || "")),
            genericName: validator.escape((data.GenericName || "").toString()),
            manufacturer: manufacturerName,
            supplier: validator.escape((data.Supplier || "").toString()),
            batchNumber: validator.escape((data.BatchNumber || "").toString()),
            category: categoryId,
            quantity: parseInt(data.Quantity) || 0,
            minStock: parseInt(data.MinStock) || 1,
            stock: 1, // Enable stock checking by default
            img: "",
            expirationDate: data.ExpirationDate || ""
        };

        console.log(`Processing product: ${data.Name} (Barcode: ${data.Barcode}), Category: ${categoryId}, UpdateExisting: ${updateExisting}`);

        if (updateExisting && existingProductId) {
            // Update existing product using provided ID
            const updateData = {
                ...productData,
                _id: existingProductId // Use the provided ID
            };
            
            console.log(`Updating existing product: ${data.Name} (ID: ${existingProductId})`);
            
            inventoryDB.update(
                { _id: existingProductId },
                updateData,
                {},
                function (err, numReplaced) {
                    if (err) {
                        console.error(`Update error for ${data.Name}:`, err);
                        errors.push({
                            row: processed + 1,
                            error: 'Update error: ' + err.message,
                            data: data
                        });
                    } else {
                        console.log(`Successfully updated product: ${data.Name} (${numReplaced} records updated)`);
                    }
                    processed++;
                    callback();
                }
            );
        } else if (updateExisting) {
            // Try to find existing product by barcode for update
            inventoryDB.findOne({ barcode: productData.barcode }, function (err, existingProduct) {
                if (err) {
                    errors.push({
                        row: processed + 1,
                        error: 'Database error: ' + err.message,
                        data: data
                    });
                    processed++;
                    callback();
                } else if (existingProduct) {
                    // Update existing product - preserve the original _id
                    const updateData = {
                        ...productData,
                        _id: existingProduct._id // Keep the original ID
                    };
                    
                    console.log(`Updating existing product: ${existingProduct.name} (ID: ${existingProduct._id})`);
                    
                    inventoryDB.update(
                        { _id: existingProduct._id },
                        updateData,
                        {},
                        function (err, numReplaced) {
                            if (err) {
                                console.error(`Update error for ${data.Name}:`, err);
                                errors.push({
                                    row: processed + 1,
                                    error: 'Update error: ' + err.message,
                                    data: data
                                });
                            } else {
                                console.log(`Successfully updated product: ${data.Name} (${numReplaced} records updated)`);
                            }
                            processed++;
                            callback();
                        }
                    );
                } else {
                    // Product doesn't exist, insert new one
                    productData._id = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000);
                    console.log(`Inserting new product: ${data.Name} (ID: ${productData._id})`);
                    
                    inventoryDB.insert(productData, function (err, product) {
                        if (err) {
                            console.error(`Insert error for ${data.Name}:`, err);
                            errors.push({
                                row: processed + 1,
                                error: 'Insert error: ' + err.message,
                                data: data
                            });
                        } else {
                            console.log(`Successfully inserted product: ${data.Name}`);
                        }
                        processed++;
                        callback();
                    });
                }
            });
        } else {
            // Insert new product only
            productData._id = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000);
            console.log(`Inserting new product (insert-only mode): ${data.Name} (ID: ${productData._id})`);
            
            inventoryDB.insert(productData, function (err, product) {
                if (err) {
                    console.error(`Insert error for ${data.Name}:`, err);
                    errors.push({
                        row: processed + 1,
                        error: 'Insert error: ' + err.message,
                        data: data
                    });
                } else {
                    console.log(`Successfully inserted product: ${data.Name}`);
                }
                processed++;
                callback();
            });
        }
    }
});

/**
 * POST endpoint: Bulk remove products by IDs.
 *
 * @param {Object} req request object with product IDs array in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/bulk-remove", function (req, res) {
    try {
        console.log("Bulk remove endpoint called");
        console.log("Request body:", req.body);
        console.log("Request headers:", req.headers);
        
        // Check if database is accessible
        if (!inventoryDB) {
            console.error("Database not accessible");
            return res.status(500).json({
                error: 'Database Error',
                message: 'Database connection not available.',
            });
        }
        
        if (!req.body.productIds || !Array.isArray(req.body.productIds) || req.body.productIds.length === 0) {
            console.log("Validation failed - productIds missing or invalid");
            return res.status(400).json({
                error: 'Invalid Request',
                message: 'Product IDs array is required and must not be empty.',
            });
        }

        const productIds = req.body.productIds.map(id => parseInt(id));
        const errors = [];
        let removedCount = 0;

        console.log(`Bulk remove started for ${productIds.length} products`);
        console.log("Product IDs to remove:", productIds);

        // Process products sequentially to avoid overwhelming the database
        function processNext(index) {
            if (index >= productIds.length) {
                // All products processed, send response
                console.log("Bulk remove completed, sending response");
                res.json({
                    success: true,
                    message: `Bulk removal completed. Successfully removed ${removedCount} products.`,
                    removed: removedCount,
                    errors: errors,
                    totalRequested: productIds.length
                });
                return;
            }

            const productId = productIds[index];
            
            inventoryDB.findOne({ _id: productId }, function (err, product) {
                if (err) {
                    console.error(`Database error for product ID ${productId}:`, err);
                    errors.push({
                        productId: productId,
                        error: 'Database error: ' + err.message
                    });
                    processNext(index + 1);
                } else if (!product) {
                    console.log(`Product not found for ID ${productId}`);
                    errors.push({
                        productId: productId,
                        error: 'Product not found'
                    });
                    processNext(index + 1);
                } else {
                    console.log(`Attempting to remove product: ${product.name} (ID: ${productId})`);
                    // Remove the product - use remove() with multi: false for single document removal
                    inventoryDB.remove({ _id: productId }, { multi: false }, function (err, numRemoved) {
                        if (err) {
                            console.error(`Remove error for product ${product.name} (ID: ${productId}):`, err);
                            errors.push({
                                productId: productId,
                                productName: product.name,
                                error: 'Remove error: ' + err.message
                            });
                        } else if (numRemoved === 0) {
                            console.error(`No products removed for ID ${productId}`);
                            errors.push({
                                productId: productId,
                                productName: product.name,
                                error: 'No products were removed'
                            });
                        } else {
                            console.log(`Successfully removed product: ${product.name} (ID: ${productId})`);
                            removedCount++;
                        }
                        processNext(index + 1);
                    });
                }
            });
        }

        // Start processing
        processNext(0);
        
    } catch (error) {
        console.error("Unexpected error in bulk remove:", error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'An unexpected error occurred: ' + error.message,
        });
    }
});

/**
 * POST endpoint: Find a product by SKU code.
 *
 * @param {Object} req request object with SKU code in the body.
 * @param {Object} res response object.
 * @returns {void}
 */

app.post("/product/sku", function (req, res) {
    let sku = validator.escape(req.body.skuCode);
    inventoryDB.findOne(
        {
            barcode: parseInt(sku),
        },
        function (err, doc) {
            if (err) {
                console.error(err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "An unexpected error occurred.",
                });
            } else {
                res.send(doc);
            }
        },
    );
});

/**
 * Decrement inventory quantities based on a list of products in a transaction.
 * Uses FEFO (First-Expiry, First-Out) to deduct from batches.
 *
 * @param {Array} products - List of products in the transaction.
 * @returns {void}
 */
app.decrementInventory = function (products) {
    return new Promise((resolve, reject) => {
        console.log('=== DECREMENT INVENTORY CALLED ===');
        console.log('Products to decrement:', products);
        
        const summary = {
            totalRequested: Array.isArray(products) ? products.length : 0,
            processed: 0,
            skipped: 0,
            totalDeducted: 0,
            batchAdjustments: [],
            errors: []
        };
        
        if (!Array.isArray(products) || products.length === 0) {
            console.log('No products to decrement');
            console.log('=== DECREMENT INVENTORY COMPLETED ===');
            resolve(summary);
            return;
        }
        
    async.eachSeries(products, function (transactionProduct, callback) {
            const productId = parseInt(transactionProduct.id || transactionProduct._id || transactionProduct.productId);
            const quantityToDeduct = parseInt(transactionProduct.quantity || transactionProduct.qty || 0);
            
            console.log(`Processing product ID: ${productId}, quantity: ${quantityToDeduct}`);
            
            if (!productId || isNaN(productId) || quantityToDeduct <= 0 || isNaN(quantityToDeduct)) {
                console.log(`Skipping invalid product: id=${productId}, quantity=${quantityToDeduct}`);
                summary.skipped += 1;
                callback();
                return;
            }
            
        inventoryDB.findOne(
            {
                    _id: productId,
            },
            function (err, product) {
                    if (err) {
                        const errorMsg = `Error finding product ${productId}: ${err.message || err}`;
                        console.error(errorMsg);
                        summary.errors.push(errorMsg);
                    callback();
                        return;
                    }
                    
                    if (!product) {
                        console.log(`Product ${productId} not found in inventory`);
                        summary.skipped += 1;
                        callback();
                        return;
                    }
                    
                    const currentQuantity = Number(product.quantity || 0);
                    if (currentQuantity <= 0) {
                        console.log(`Product ${productId} has no quantity`);
                        summary.skipped += 1;
                        callback();
                        return;
                    }
                    
                    console.log(`Found product: ${product.name || productId}, current quantity: ${currentQuantity}`);
                    
                    // First, try to decrement from batches using FEFO (First-Expiry, First-Out)
                    // Use file reading fallback since queries are hanging
                    const batchesDBPath = inventoryBatchesDB.filename;
                    const fs = require('fs');
                    let batches = [];
                    
                    const selectedBatchInfo = (function resolveSelectedBatch(infoSource) {
                        if (!infoSource) return null;
                        const selected = infoSource.selectedBatch || infoSource.batchSelection || null;
                        const fallbackLot = infoSource.batchNumber || infoSource.lotNumber || (selected && selected.lotNumber) || null;
                        const fallbackBarcode = infoSource.batchBarcode || infoSource.barcode || (selected && selected.barcode) || null;
                        const fallbackId = infoSource.batchId || infoSource.batch_id || infoSource.batchID || (selected && (selected._id || selected.id || selected.batchId));
                        
                        if (selected || fallbackLot || fallbackBarcode || fallbackId) {
                            return {
                                _id: selected && (selected._id || selected.id || selected.batchId) || fallbackId || null,
                                lotNumber: selected && selected.lotNumber || fallbackLot || null,
                                barcode: selected && selected.barcode || fallbackBarcode || null
                            };
                        }
                        
                        return null;
                    })(transactionProduct);
                    
                    function doesBatchMatchSelection(batch, selection) {
                        if (!batch || !selection) return false;
                        if (selection._id && (String(batch._id) === String(selection._id))) {
                            return true;
                        }
                        const lotMatches = selection.lotNumber && batch.lotNumber &&
                            String(batch.lotNumber).toLowerCase() === String(selection.lotNumber).toLowerCase();
                        const barcodeMatches = selection.barcode && batch.barcode &&
                            String(batch.barcode) === String(selection.barcode);
                        
                        if (lotMatches) {
                            if (!selection.barcode) {
                                return true;
                            }
                            return barcodeMatches;
                        }
                        
                        if (barcodeMatches && !selection.lotNumber) {
                            return true;
                        }
                        
                        return false;
                    }
                    
                    function sortAndPrioritizeBatches() {
                        // Sort by expiry date (oldest first) for FEFO
                        batches.sort((a, b) => {
                            const dateA = a.expiryDate ? new Date(a.expiryDate) : new Date('9999-12-31');
                            const dateB = b.expiryDate ? new Date(b.expiryDate) : new Date('9999-12-31');
                            return dateA - dateB;
                        });
                        
                        if (selectedBatchInfo) {
                            const preferredIndex = batches.findIndex(batch => doesBatchMatchSelection(batch, selectedBatchInfo));
                            if (preferredIndex > 0) {
                                const [preferredBatch] = batches.splice(preferredIndex, 1);
                                batches.unshift(preferredBatch);
                                console.log(`Prioritized user-selected batch ${preferredBatch._id || preferredBatch.lotNumber || preferredBatch.barcode || 'N/A'} for product ${productId}`);
                            } else if (preferredIndex === -1) {
                                console.warn(`Selected batch not found for product ${productId}. Falling back to FEFO. Selection:`, selectedBatchInfo);
                            }
                        }
                    }
                    
                    function loadBatchesAndProcess() {
                        sortAndPrioritizeBatches();
                        processBatches();
                    }
                    
                    // Try to get batches from file directly (since queries hang)
                    if (fs.existsSync(batchesDBPath)) {
                        try {
                            const fileContent = fs.readFileSync(batchesDBPath, 'utf8');
                            const lines = fileContent.split('\n').filter(l => l.trim());
                            const latestById = new Map();
                            lines.forEach(line => {
                                try {
                                    const batch = JSON.parse(line);
                                    if (batch && batch._id) {
                                        latestById.set(batch._id, batch);
                                    }
                                } catch (e) {
                                    // Skip invalid JSON lines
                                }
                            });
                            batches = Array.from(latestById.values()).filter(batch => {
                                const bId = batch.productId;
                                return (bId === productId || 
                                        String(bId) === String(productId) ||
                                        Number(bId) === productId) &&
                                       Number(batch.quantity || 0) > 0;
                            });
                            console.log(`Found ${batches.length} batches for product ${productId} (from file)`);
                            loadBatchesAndProcess();
                        } catch (fileErr) {
                            console.warn('File read failed, trying DB query:', fileErr);
                            // Fallback to DB query
                            inventoryBatchesDB.find(
                                { productId: productId, quantity: { $gt: 0 } },
                                { sort: { expiryDate: 1 } },
                                function (batchErr, dbBatches) {
                                    if (!batchErr && dbBatches && dbBatches.length > 0) {
                                        batches = dbBatches;
                                        console.log(`Found ${batches.length} batches for product ${productId} (from DB)`);
                                    }
                                    loadBatchesAndProcess();
                                }
                            );
                        }
                } else {
                        // No file, try DB query
                        inventoryBatchesDB.find(
                            { productId: productId, quantity: { $gt: 0 } },
                            { sort: { expiryDate: 1 } },
                            function (batchErr, dbBatches) {
                                if (!batchErr && dbBatches && dbBatches.length > 0) {
                                    batches = dbBatches;
                                    console.log(`Found ${batches.length} batches for product ${productId} (from DB)`);
                                }
                                loadBatchesAndProcess();
                            }
                        );
                    }
                    
                    function processBatches() {
                        let remainingQty = quantityToDeduct;
                        let totalDeductedForProduct = 0;
                        const batchLogs = [];

                        if (batches && batches.length > 0) {
                            async.eachSeries(batches, function (batch, batchCallback) {
                                if (remainingQty <= 0) {
                                    batchCallback();
                                    return;
                                }

                                const batchQty = parseInt(batch.quantity || 0);
                                const deductFromBatch = Math.min(remainingQty, batchQty);

                                if (deductFromBatch <= 0) {
                                    batchCallback();
                                    return;
                                }

                                const newBatchQty = batchQty - deductFromBatch;
                                remainingQty -= deductFromBatch;
                                totalDeductedForProduct += deductFromBatch;
                                batchLogs.push({
                                    batchId: batch._id || null,
                                    lotNumber: batch.lotNumber || null,
                                    barcode: batch.barcode || null,
                                    deducted: deductFromBatch,
                                    newQuantity: newBatchQty
                                });

                                console.log(`Deducting ${deductFromBatch} from batch ${batch._id} (lot: ${batch.lotNumber || 'N/A'}), new quantity: ${newBatchQty}`);

                                const batchQuery = { _id: batch._id };
                                const backupQuery = {
                                    productId: productId,
                                    lotNumber: batch.lotNumber || '',
                                    barcode: batch.barcode || null
                                };

                                const finalizeBatchUpdate = (updateErr, numAffected) => {
                                    if (updateErr) {
                                        console.error(`Error updating batch ${batch._id}:`, updateErr);
                                    } else if (typeof numAffected === 'number' && numAffected === 0) {
                                        console.warn(`⚠️ No batch updated with _id ${batch._id}`);
                                    } else {
                                        console.log(`✅ Updated batch ${batch._id || '[backup-match]'} (lot: ${batch.lotNumber || 'N/A'}): ${batchQty} → ${newBatchQty}`);
                                    }
                                    batchCallback();
                                };

                                if (newBatchQty > 0) {
                                    inventoryBatchesDB.update(
                                        batchQuery,
                                        { $set: { quantity: newBatchQty, updatedAt: new Date() } },
                                        {},
                                        function(updateErr, numAffected) {
                                            if (updateErr || numAffected === 0) {
                                                if (updateErr) {
                                                    console.error(`Primary batch update failed:`, updateErr);
                                                } else {
                                                    console.warn(`⚠️ Primary batch update affected 0 records, trying backup query...`);
                                                }
                                                inventoryBatchesDB.update(
                                                    backupQuery,
                                                    { $set: { quantity: newBatchQty, updatedAt: new Date() } },
                                                    {},
                                                    finalizeBatchUpdate
                                                );
                                            } else {
                                                finalizeBatchUpdate(null, numAffected);
                                            }
                                        }
                                    );
                                } else {
                                    console.log(`Removing batch ${batch._id} (lot: ${batch.lotNumber || 'N/A'}) - quantity reached 0`);
                                    inventoryBatchesDB.remove(
                                        { _id: batch._id },
                                        {},
                                        function(removeErr) {
                                            if (removeErr) {
                                                console.error(`Error removing batch ${batch._id}:`, removeErr);
                                                summary.errors.push(`Failed to remove empty batch ${batch._id}: ${removeErr.message || removeErr}`);
                                            } else {
                                                console.log(`✅ Removed batch ${batch._id} (lot: ${batch.lotNumber || 'N/A'})`);
                                            }
                                            batchCallback();
                                        }
                                    );
                                }
                            }, function () {
                                const actualDeducted = Math.min(quantityToDeduct, totalDeductedForProduct);
                                const finalQuantity = Math.max(0, currentQuantity - actualDeducted);

                                if (remainingQty > 0) {
                                    const warnMsg = `Requested ${quantityToDeduct} but only ${actualDeducted} deducted for product ${productId} (insufficient batch stock).`;
                                    console.warn(warnMsg);
                                    summary.errors.push(warnMsg);
                                }

                                console.log(`Updating product ${productId} quantity from ${currentQuantity} to ${finalQuantity}`);

                    inventoryDB.update(
                                    { _id: productId },
                                    { $set: { quantity: finalQuantity } },
                                    {},
                                    function (updateErr) {
                                        if (updateErr) {
                                            const errorMsg = `Error updating product ${productId}: ${updateErr.message || updateErr}`;
                                            console.error(errorMsg);
                                            summary.errors.push(errorMsg);
                                        } else {
                                            console.log(`Successfully decremented product ${productId}`);
                                        }
                                        summary.processed += 1;
                                        summary.totalDeducted += actualDeducted;
                                        summary.batchAdjustments.push({
                                            productId,
                                            requested: quantityToDeduct,
                                            deducted: actualDeducted,
                                            batches: batchLogs
                                        });
                                        callback();
                                    }
                                );
                            });
                            return;
                        }

                        console.log(`No batches found for product ${productId}, updating quantity directly`);
                        const actualDeducted = Math.min(quantityToDeduct, currentQuantity);
                        const finalQuantity = Math.max(0, currentQuantity - actualDeducted);

                        inventoryDB.update(
                            { _id: productId },
                            { $set: { quantity: finalQuantity } },
                            {},
                            function (updateErr) {
                                if (updateErr) {
                                    const errorMsg = `Error updating product ${productId}: ${updateErr.message || updateErr}`;
                                    console.error(errorMsg);
                                    summary.errors.push(errorMsg);
                                } else {
                                    console.log(`Successfully decremented product ${productId} to ${finalQuantity}`);
                                }
                                summary.processed += 1;
                                summary.totalDeducted += actualDeducted;
                                summary.batchAdjustments.push({
                                    productId,
                                    requested: quantityToDeduct,
                                    deducted: actualDeducted,
                                    batches: []
                                });
                                callback();
                            }
                    );
                }
            },
        );
        }, function (err) {
            if (err) {
                console.error('Error while decrementing inventory:', err);
                summary.errors.push(err.message || err);
                return reject(err);
            }
            console.log('=== DECREMENT INVENTORY COMPLETED ===');
            resolve(summary);
        });
    });
};

// Multer initialized (log removed for cleaner output)

module.exports = app;
