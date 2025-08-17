const app = require("express")();
const server = require("http").Server(app);
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

console.log("Environment variables:");
console.log("- APPNAME:", appName);
console.log("- APPDATA:", appData);
console.log("- Current working directory:", process.cwd());
console.log("- __dirname:", __dirname);
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

console.log("CSV upload configuration created:", csvUpload);
console.log("CSV upload type:", typeof csvUpload);
console.log("CSV upload single method:", typeof csvUpload.single);
console.log("CSV upload single function:", csvUpload.single('csvFile'));


app.use(bodyParser.json());

module.exports = app;

let inventoryDB = new Datastore({
    filename: dbPath,
    autoload: true,
});

console.log("Inventory database path:", dbPath);
console.log("Inventory database loaded:", inventoryDB ? "Yes" : "No");
console.log("NeDB version check - typeof inventoryDB:", typeof inventoryDB);
console.log("NeDB constructor name:", inventoryDB.constructor.name);
console.log("Available NeDB methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(inventoryDB)).filter(name => typeof inventoryDB[name] === 'function'));
console.log("Direct properties:", Object.keys(inventoryDB));
console.log("remove method exists:", typeof inventoryDB.remove === 'function');
console.log("deleteOne method exists:", typeof inventoryDB.deleteOne === 'function');

inventoryDB.ensureIndex({ fieldName: "_id", unique: true });

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
 * GET endpoint: Get details of all products.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/products", function (req, res) {
    inventoryDB.find({}, function (err, docs) {
        res.send(docs);
    });
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
        category: validator.escape(req.body.category),
        quantity:
            validator.escape(req.body.quantity) == ""
                ? 0
                : validator.escape(req.body.quantity),
        name: validator.escape(req.body.name),
        stock: req.body.stock === "on" ? 0 : 1,
        minStock: validator.escape(req.body.minStock),
        img: image,
    };

    if (validator.escape(req.body.id) === "") {
        Product._id = Math.floor(Date.now() / 1000);
        inventoryDB.insert(Product, function (err, product) {
            if (err) {
                console.error(err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "An unexpected error occurred.",
                });
            } else {
                res.sendStatus(200);
            }
        });
    } else {
        inventoryDB.update(
            {
                _id: parseInt(validator.escape(req.body.id)),
            },
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
                    res.sendStatus(200);
                }
            },
        );
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
                res.sendStatus(200);
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

    console.log('Bulk import started with options:');
    console.log('- Skip Duplicates:', req.body.skipDuplicates);
    console.log('- Update Existing:', req.body.updateExisting);
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
            fs.unlinkSync(req.file.path);
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
            // Validate required fields
            if (!data.Name || !data.Barcode || !data.Price) {
                errors.push({
                    row: index + 1,
                    error: 'Missing required fields (Name, Barcode, or Price)',
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

            // Validate price format
            if (isNaN(parseFloat(data.Price))) {
                errors.push({
                    row: index + 1,
                    error: 'Invalid price format (must be numeric)',
                    data: data
                });
                processed++;
                processRowsSequentially(rows, index + 1);
                return;
            }

            // Check for duplicate barcode if skipDuplicates is true and not updating existing
            if (req.body.skipDuplicates === 'true' && req.body.updateExisting !== 'true') {
                inventoryDB.findOne({ barcode: parseInt(data.Barcode) }, function (err, existingProduct) {
                    if (existingProduct) {
                        errors.push({
                            row: index + 1,
                            error: 'Duplicate barcode found',
                            data: data
                        });
                        processed++;
                        processRowsSequentially(rows, index + 1);
                    } else {
                        processProductWithCategory(data, req.body.defaultCategory, req.body.updateExisting === 'true', () => {
                            processRowsSequentially(rows, index + 1);
                        });
                    }
                });
            } else {
                processProductWithCategory(data, req.body.defaultCategory, req.body.updateExisting === 'true', () => {
                    processRowsSequentially(rows, index + 1);
                });
            }
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

    function processProductWithCategory(data, defaultCategory, updateExisting, callback) {
        // Handle category - check if it exists in the database, if not create it
        let categoryId = defaultCategory; // Default to the selected category
        
        console.log(`Processing category for product: ${data.Name}`);
        console.log(`- CSV Category: "${data.Category}"`);
        console.log(`- Default Category: ${defaultCategory}`);
        
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
                    processProductData(data, categoryId, updateExisting, callback);
                } else if (existingCategory) {
                    // Use existing category ID
                    categoryId = existingCategory._id;
                    console.log(`- Using existing category: ${categoryName} (ID: ${categoryId})`);
                    processProductData(data, categoryId, updateExisting, callback);
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
                            processProductData(data, categoryId, updateExisting, callback);
                        });
                    });
                }
            });
        } else {
            // No category specified, use default
            console.log(`- No category specified in CSV, using default: ${defaultCategory}`);
            processProductData(data, categoryId, updateExisting, callback);
        }
    }

    function processProductData(data, categoryId, updateExisting, callback) {
        const productData = {
            barcode: parseInt(data.Barcode),
            name: validator.escape(data.Name),
            price: validator.escape(data.Price),
            category: categoryId,
            quantity: parseInt(data.Quantity) || 0,
            minStock: parseInt(data.MinStock) || 1,
            stock: 1, // Enable stock checking by default
            img: "",
            expirationDate: data.ExpirationDate || ""
        };

        console.log(`Processing product: ${data.Name} (Barcode: ${data.Barcode}), Category: ${categoryId}, UpdateExisting: ${updateExisting}`);

        if (updateExisting) {
            // Try to update existing product by barcode
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
 *
 * @param {Array} products - List of products in the transaction.
 * @returns {void}
 */
app.decrementInventory = function (products) {
    async.eachSeries(products, function (transactionProduct, callback) {
        inventoryDB.findOne(
            {
                _id: parseInt(transactionProduct.id),
            },
            function (err, product) {
                if (!product || !product.quantity) {
                    callback();
                } else {
                    let updatedQuantity =
                        parseInt(product.quantity) -
                        parseInt(transactionProduct.quantity);

                    inventoryDB.update(
                        {
                            _id: parseInt(product._id),
                        },
                        {
                            $set: {
                                quantity: updatedQuantity,
                            },
                        },
                        {},
                        callback,
                    );
                }
            },
        );
    });
};

console.log("Multer imported:", multer);
console.log("Multer type:", typeof multer);
console.log("Multer methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(multer)).filter(name => typeof multer[name] === 'function'));
