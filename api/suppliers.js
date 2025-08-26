const app = require("express")();
const server = require("http").Server(app);
const bodyParser = require("body-parser");
const Datastore = require("@seald-io/nedb");
const multer = require("multer");
const sanitizeFilename = require('sanitize-filename');
const fs = require("fs");
const path = require("path");
const validator = require("validator");
const async = require("async");
const appName = process.env.APPNAME;
const appData = process.env.APPDATA;

const dbPath = path.join(
    appData,
    appName,
    "server",
    "databases",
    "suppliers.db",
);

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

app.use(bodyParser.json());

let suppliersDB = new Datastore({
    filename: dbPath,
    autoload: true,
});

suppliersDB.ensureIndex({ fieldName: "_id", unique: true });
suppliersDB.ensureIndex({ fieldName: "name", unique: true });
suppliersDB.ensureIndex({ fieldName: "code", unique: true });

/**
 * GET endpoint: Get the welcome message for the Suppliers API.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/", function (req, res) {
    console.log("Suppliers API root route called - searching database...");
    
    // Force database reload to ensure fresh data
    try {
        suppliersDB.loadDatabase();
        console.log("Database reloaded successfully");
    } catch (reloadError) {
        console.log(`Database reload warning: ${reloadError.message}`);
    }
    
    suppliersDB.find({}, function (err, docs) {
        if (err) {
            console.error("Database error:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "An unexpected error occurred.",
            });
        } else {
            console.log(`Found ${docs.length} suppliers:`, docs);
            res.send(docs);
        }
    });
});

/**
 * GET endpoint: Get details of all suppliers.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/suppliers", function (req, res) {
    console.log("Suppliers API called - searching database...");
    suppliersDB.find({}, function (err, docs) {
        if (err) {
            console.error("Database error:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "An unexpected error occurred.",
            });
        } else {
            console.log(`Found ${docs.length} suppliers:`, docs);
            res.send(docs);
        }
    });
});

/**
 * GET endpoint: Get supplier details by supplier ID.
 *
 * @param {Object} req request object with supplier ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/supplier/:supplierId", function (req, res) {
    if (!req.params.supplierId) {
        res.status(500).send("ID field is required.");
    } else {
        suppliersDB.findOne(
            {
                _id: req.params.supplierId,
            },
            function (err, supplier) {
                if (err) {
                    console.error(err);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "An unexpected error occurred.",
                    });
                } else {
                    res.send(supplier);
                }
            },
        );
    }
});

/**
 * POST endpoint: Create a new supplier.
 *
 * @param {Object} req request object with supplier data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/supplier", function (req, res) {
    let supplierData = {
        name: validator.escape(req.body.name),
        code: validator.escape(req.body.code || ''),
        contact: validator.escape(req.body.contact || ''),
        email: validator.escape(req.body.email || ''),
        phone: validator.escape(req.body.phone || ''),
        address: validator.escape(req.body.address || ''),
        city: validator.escape(req.body.city || ''),
        state: validator.escape(req.body.state || ''),
        country: validator.escape(req.body.country || ''),
        postalCode: validator.escape(req.body.postalCode || ''),
        website: validator.escape(req.body.website || ''),
        notes: validator.escape(req.body.notes || ''),
        status: req.body.status === 'active' ? 'active' : 'inactive',
        createdAt: new Date(),
        updatedAt: new Date()
    };

    // Validate required fields
    if (!supplierData.name) {
        return res.status(400).json({
            error: "Validation Error",
            message: "Supplier name is required."
        });
    }

    // Check if supplier with same name already exists
    suppliersDB.findOne({ name: supplierData.name }, function (err, existingSupplier) {
        if (err) {
            console.error(err);
            return res.status(500).json({
                error: "Internal Server Error",
                message: "An unexpected error occurred.",
            });
        }

        if (existingSupplier) {
            return res.status(400).json({
                error: "Duplicate Error",
                message: "A supplier with this name already exists."
            });
        }

        // Check if supplier with same code already exists (if code provided)
        if (supplierData.code) {
            suppliersDB.findOne({ code: supplierData.code }, function (err, existingCode) {
                if (err) {
                    console.error(err);
                    return res.status(500).json({
                        error: "Internal Server Error",
                        message: "An unexpected error occurred.",
                    });
                }

                if (existingCode) {
                    return res.status(400).json({
                        error: "Duplicate Error",
                        message: "A supplier with this code already exists."
                    });
                }

                // Insert the supplier
                insertSupplier();
            });
        } else {
            // Insert the supplier without code
            insertSupplier();
        }
    });

    function insertSupplier() {
        suppliersDB.insert(supplierData, function (err, supplier) {
            if (err) {
                console.error(err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "An unexpected error occurred.",
                });
            } else {
                console.log("Supplier created successfully:", supplier.name);
                res.json({
                    success: true,
                    message: "Supplier created successfully",
                    supplier: supplier
                });
            }
        });
    }
});

/**
 * PUT endpoint: Update an existing supplier.
 *
 * @param {Object} req request object with supplier data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.put("/supplier/:supplierId", function (req, res) {
    let supplierId = req.params.supplierId;
    let updateData = {
        name: validator.escape(req.body.name),
        code: validator.escape(req.body.code || ''),
        contact: validator.escape(req.body.contact || ''),
        email: validator.escape(req.body.email || ''),
        phone: validator.escape(req.body.phone || ''),
        address: validator.escape(req.body.address || ''),
        city: validator.escape(req.body.city || ''),
        state: validator.escape(req.body.state || ''),
        country: validator.escape(req.body.country || ''),
        postalCode: validator.escape(req.body.postalCode || ''),
        website: validator.escape(req.body.website || ''),
        notes: validator.escape(req.body.notes || ''),
        status: req.body.status === 'active' ? 'active' : 'inactive',
        updatedAt: new Date()
    };

    // Validate required fields
    if (!updateData.name) {
        return res.status(400).json({
            error: "Validation Error",
            message: "Supplier name is required."
        });
    }

    // Check if supplier exists
    suppliersDB.findOne({ _id: supplierId }, function (err, existingSupplier) {
        if (err) {
            console.error(err);
            return res.status(500).json({
                error: "Internal Server Error",
                message: "An unexpected error occurred.",
            });
        }

        if (!existingSupplier) {
            return res.status(404).json({
                error: "Not Found",
                message: "Supplier not found."
            });
        }

        // Check if name is being changed and if new name already exists
        if (updateData.name !== existingSupplier.name) {
            suppliersDB.findOne({ name: updateData.name, _id: { $ne: supplierId } }, function (err, duplicateName) {
                if (err) {
                    console.error(err);
                    return res.status(500).json({
                        error: "Internal Server Error",
                        message: "An unexpected error occurred.",
                    });
                }

                if (duplicateName) {
                    return res.status(400).json({
                        error: "Duplicate Error",
                        message: "A supplier with this name already exists."
                    });
                }

                // Check if code is being changed and if new code already exists
                if (updateData.code && updateData.code !== existingSupplier.code) {
                    suppliersDB.findOne({ code: updateData.code, _id: { $ne: supplierId } }, function (err, duplicateCode) {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({
                                error: "Internal Server Error",
                                message: "An unexpected error occurred.",
                            });
                        }

                        if (duplicateCode) {
                            return res.status(400).json({
                                error: "Duplicate Error",
                                message: "A supplier with this code already exists."
                            });
                        }

                        // Update the supplier
                        updateSupplier();
                    });
                } else {
                    // Update the supplier without code check
                    updateSupplier();
                }
            });
        } else {
            // Name not changed, check only code
            if (updateData.code && updateData.code !== existingSupplier.code) {
                suppliersDB.findOne({ code: updateData.code, _id: { $ne: supplierId } }, function (err, duplicateCode) {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({
                            error: "Internal Server Error",
                            message: "An unexpected error occurred.",
                        });
                    }

                    if (duplicateCode) {
                        return res.status(400).json({
                            error: "Duplicate Error",
                            message: "A supplier with this code already exists."
                        });
                    }

                    // Update the supplier
                    updateSupplier();
                });
            } else {
                // Update the supplier without any checks
                updateSupplier();
            }
        }
    });

    function updateSupplier() {
        suppliersDB.update(
            { _id: supplierId },
            { $set: updateData },
            {},
            function (err, numReplaced) {
                if (err) {
                    console.error(err);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "An unexpected error occurred.",
                    });
                } else if (numReplaced === 0) {
                    res.status(404).json({
                        error: "Not Found",
                        message: "Supplier not found."
                    });
                } else {
                    console.log("Supplier updated successfully:", updateData.name);
                    res.json({
                        success: true,
                        message: "Supplier updated successfully"
                    });
                }
            },
        );
    }
});

/**
 * DELETE endpoint: Delete a supplier.
 *
 * @param {Object} req request object with supplier ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.delete("/supplier/:supplierId", function (req, res) {
    let supplierId = req.params.supplierId;

    suppliersDB.remove({ _id: supplierId }, { multi: false }, function (err, numRemoved) {
        if (err) {
            console.error(err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "An unexpected error occurred.",
            });
        } else if (numRemoved === 0) {
            res.status(404).json({
                error: "Not Found",
                message: "Supplier not found."
            });
        } else {
            console.log("Supplier deleted successfully, ID:", supplierId);
            res.json({
                success: true,
                message: "Supplier deleted successfully"
            });
        }
    });
});

/**
 * POST endpoint: Bulk import suppliers from CSV file.
 *
 * @param {Object} req request object with CSV file and options in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/bulk-import", csvUpload.single('csvFile'), function (req, res) {
    console.log("Supplier bulk import endpoint called");
    console.log("Request body:", req.body);
    console.log("Request file:", req.file);

    if (!req.file) {
        return res.status(400).json({
            error: "No file uploaded",
            message: "Please select a CSV file to import."
        });
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

    console.log('Supplier bulk import started with options:');
    console.log('- Skip Duplicates:', skipDuplicates);
    console.log('- Update Existing:', updateExisting);
    console.log('- File:', req.file.originalname);

    const csv = require('csv-parser');
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
                    // Process rows sequentially
                    processRowsSequentially(rows, 0);
                });
        });

    function processRowsSequentially(rows, index) {
        if (index >= rows.length) {
            // All rows processed, send response
            fs.unlinkSync(req.file.path);
            res.json({
                success: true,
                message: `Import completed. Processed ${processed} suppliers.`,
                processed: processed,
                errors: errors,
                totalRows: totalRows
            });
            return;
        }

        const row = rows[index];
        const rowNumber = index + 1;

        try {
            // Validate and sanitize data
            const supplierData = {
                name: validator.escape(row.Name || row.name || ''),
                code: validator.escape(row.Code || row.code || ''),
                contact: validator.escape(row.Contact || row.contact || ''),
                email: validator.escape(row.Email || row.email || ''),
                phone: validator.escape(row.Phone || row.phone || ''),
                address: validator.escape(row.Address || row.address || ''),
                city: validator.escape(row.City || row.city || ''),
                state: validator.escape(row.State || row.state || ''),
                country: validator.escape(row.Country || row.country || ''),
                postalCode: validator.escape(row.PostalCode || row.postalCode || ''),
                website: validator.escape(row.Website || row.website || ''),
                notes: validator.escape(row.Notes || row.notes || ''),
                status: (row.Status || row.status || 'active').toLowerCase() === 'active' ? 'active' : 'inactive'
            };

            // Validate required fields
            if (!supplierData.name) {
                errors.push(`Row ${rowNumber}: Name is required`);
                processNext(index + 1);
                return;
            }

            // Check for duplicates
            if (skipDuplicates || updateExisting) {
                suppliersDB.findOne({ name: supplierData.name }, function (err, existingSupplier) {
                    if (err) {
                        console.error(err);
                        errors.push(`Row ${rowNumber}: Database error during duplicate check`);
                        processNext(index + 1);
                        return;
                    }

                    if (existingSupplier) {
                        if (skipDuplicates) {
                            console.log(`Row ${rowNumber}: Skipping duplicate supplier: ${supplierData.name}`);
                            processNext(index + 1);
                            return;
                        } else if (updateExisting) {
                            // Update existing supplier
                            supplierData.updatedAt = new Date();
                            suppliersDB.update(
                                { _id: existingSupplier._id },
                                { $set: supplierData },
                                {},
                                function (err, numReplaced) {
                                    if (err) {
                                        console.error(err);
                                        errors.push(`Row ${rowNumber}: Update error: ${err.message}`);
                                    } else {
                                        console.log(`Row ${rowNumber}: Updated existing supplier: ${supplierData.name}`);
                                        processed++;
                                    }
                                    processNext(index + 1);
                                }
                            );
                            return;
                        }
                    }

                    // Insert new supplier
                    insertSupplier();
                });
            } else {
                // Insert new supplier without duplicate check
                insertSupplier();
            }

            function insertSupplier() {
                supplierData.createdAt = new Date();
                supplierData.updatedAt = new Date();

                suppliersDB.insert(supplierData, function (err, supplier) {
                    if (err) {
                        console.error(err);
                        errors.push(`Row ${rowNumber}: Insert error: ${err.message}`);
                    } else {
                        console.log(`Row ${rowNumber}: Inserted new supplier: ${supplierData.name}`);
                        processed++;
                    }
                    processNext(index + 1);
                });
            }

        } catch (error) {
            console.error(`Row ${rowNumber}: Processing error:`, error);
            errors.push(`Row ${rowNumber}: Processing error: ${error.message}`);
            processNext(index + 1);
        }
    }

    function processNext(index) {
        processRowsSequentially(rows, index);
    }
});

/**
 * GET endpoint: Export suppliers to CSV.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/export", function (req, res) {
    suppliersDB.find({}, function (err, suppliers) {
        if (err) {
            console.error(err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "An unexpected error occurred.",
            });
            return;
        }

        // Create CSV content
        let csvContent = "Name,Code,Contact,Email,Phone,Address,City,State,Country,PostalCode,Website,Notes,Status\n";
        
        suppliers.forEach(supplier => {
            csvContent += `"${supplier.name || ''}","${supplier.code || ''}","${supplier.contact || ''}","${supplier.email || ''}","${supplier.phone || ''}","${supplier.address || ''}","${supplier.city || ''}","${supplier.state || ''}","${supplier.country || ''}","${supplier.postalCode || ''}","${supplier.website || ''}","${supplier.notes || ''}","${supplier.status || 'active'}"\n`;
        });

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="suppliers_export.csv"');
        res.send(csvContent);
    });
});

/**
 * GET endpoint: Get supplier statistics and data integrity report.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/integrity-report", function (req, res) {
    suppliersDB.find({}, function (err, suppliers) {
        if (err) {
            console.error(err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "An unexpected error occurred.",
            });
            return;
        }

        const report = {
            totalSuppliers: suppliers.length,
            activeSuppliers: suppliers.filter(s => s.status === 'active').length,
            inactiveSuppliers: suppliers.filter(s => s.status === 'inactive').length,
            suppliersWithCode: suppliers.filter(s => s.code && s.code.trim() !== '').length,
            suppliersWithoutCode: suppliers.filter(s => !s.code || s.code.trim() === '').length,
            suppliersWithContact: suppliers.filter(s => s.contact && s.contact.trim() !== '').length,
            suppliersWithEmail: suppliers.filter(s => s.email && s.email.trim() !== '').length,
            suppliersWithPhone: suppliers.filter(s => s.phone && s.phone.trim() !== '').length,
            suppliersWithAddress: suppliers.filter(s => s.address && s.address.trim() !== '').length,
            validationIssues: [],
            recommendations: []
        };

        // Check for validation issues
        suppliers.forEach((supplier, index) => {
            if (!supplier.name || supplier.name.trim() === '') {
                report.validationIssues.push(`Supplier ${index + 1}: Missing name`);
            }
            if (supplier.email && !validator.isEmail(supplier.email)) {
                report.validationIssues.push(`Supplier ${index + 1}: Invalid email format`);
            }
            if (supplier.website && !validator.isURL(supplier.website)) {
                report.validationIssues.push(`Supplier ${index + 1}: Invalid website URL`);
            }
        });

        // Generate recommendations
        if (report.suppliersWithoutCode > 0) {
            report.recommendations.push("Consider adding codes to suppliers without them for better organization");
        }
        if (report.suppliersWithoutContact > report.totalSuppliers * 0.3) {
            report.recommendations.push("Many suppliers lack contact information - consider adding contact details");
        }
        if (report.suppliersWithoutEmail > report.totalSuppliers * 0.5) {
            report.recommendations.push("Email addresses are missing for many suppliers - consider adding them");
        }

        res.json(report);
    });
});

/**
 * GET endpoint: Get supplier performance report.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/performance", function (req, res) {
    // This endpoint can be enhanced later with actual performance metrics
    // For now, return basic statistics
    suppliersDB.find({}, function (err, suppliers) {
        if (err) {
            console.error(err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "An unexpected error occurred.",
            });
            return;
        }

        const performance = {
            totalSuppliers: suppliers.length,
            activeSuppliers: suppliers.filter(s => s.status === 'active').length,
            inactiveSuppliers: suppliers.filter(s => s.status === 'inactive').length,
            completionRate: {
                withCode: Math.round((suppliers.filter(s => s.code && s.code.trim() !== '').length / suppliers.length) * 100),
                withContact: Math.round((suppliers.filter(s => s.contact && s.contact.trim() !== '').length / suppliers.length) * 100),
                withEmail: Math.round((suppliers.filter(s => s.email && s.email.trim() !== '').length / suppliers.length) * 100),
                withPhone: Math.round((suppliers.filter(s => s.phone && s.phone.trim() !== '').length / suppliers.length) * 100),
                withAddress: Math.round((suppliers.filter(s => s.address && s.address.trim() !== '').length / suppliers.length) * 100)
            }
        };

        res.json(performance);
    });
});

/**
 * GET endpoint: Get supplier directory.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/directory", function (req, res) {
    const status = req.query.status || 'all';
    const search = req.query.search || '';

    let query = {};
    
    if (status !== 'all') {
        query.status = status;
    }
    
    if (search) {
        query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { code: { $regex: search, $options: 'i' } },
            { contact: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } }
        ];
    }

    suppliersDB.find(query).sort({ name: 1 }).exec(function (err, suppliers) {
        if (err) {
            console.error(err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "An unexpected error occurred.",
            });
            return;
        }

        res.json({
            suppliers: suppliers,
            count: suppliers.length,
            filters: { status, search }
        });
    });
});

module.exports = app;
