const app = require("express")();
const server = require("http").Server(app);
const bodyParser = require("body-parser");
const Datastore = require('@seald-io/nedb');
const async = require("async");
const path = require("path");
const validator = require("validator");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const appName = process.env.APPNAME;
const appData = process.env.APPDATA;
const dbPath = path.join(
    appData,
    appName,
    "server",
    "databases",
    "manufacturers.db",
);

app.use(bodyParser.json());

// Configure multer for CSV file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'), false);
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

module.exports = app;

let manufacturerDB = new Datastore({
    filename: dbPath,
    autoload: true,
});

manufacturerDB.ensureIndex({ fieldName: "_id", unique: true });
manufacturerDB.ensureIndex({ fieldName: "name", unique: true });
manufacturerDB.ensureIndex({ fieldName: "code", unique: true });

/**
 * Data validation functions for manufacturers
 */
const validateManufacturerData = (data) => {
    const errors = [];
    const warnings = [];
    
    // Required field validation
    if (!data.name || data.name.trim() === '') {
        errors.push('Manufacturer name is required');
    }
    
    // Name validation
    if (data.name) {
        const name = data.name.trim();
        if (name.length < 2) {
            errors.push('Manufacturer name must be at least 2 characters long');
        }
        if (name.length > 100) {
            errors.push('Manufacturer name cannot exceed 100 characters');
        }
        if (!/^[a-zA-Z0-9\s\-\.&()]+$/i.test(name)) {
            warnings.push('Manufacturer name contains special characters that may cause issues');
        }
    }
    
    // Code validation
    if (data.code) {
        const code = data.code.trim();
        if (code.length > 20) {
            errors.push('Manufacturer code cannot exceed 20 characters');
        }
        if (!/^[a-zA-Z0-9\-_]+$/i.test(code)) {
            warnings.push('Manufacturer code should only contain letters, numbers, hyphens, and underscores');
        }
    }
    
    // Email validation
    if (data.email && !validator.isEmail(data.email)) {
        errors.push('Invalid email format');
    }
    
    // Phone validation
    if (data.phone && !/^[\+]?[0-9\s\-\(\)]+$/.test(data.phone)) {
        warnings.push('Phone number format may be invalid');
    }
    
    // Website validation
    if (data.website && !validator.isURL(data.website, { require_protocol: true })) {
        warnings.push('Website URL format may be invalid');
    }
    
    // Postal code validation (basic)
    if (data.postalCode && data.postalCode.length > 10) {
        warnings.push('Postal code seems too long');
    }
    
    return { errors, warnings, isValid: errors.length === 0 };
};

const sanitizeManufacturerData = (data) => {
    const sanitized = {};
    
    // Sanitize string fields
    if (data.name) sanitized.name = validator.trim(data.name);
    if (data.code) sanitized.code = validator.trim(data.code);
    if (data.address) sanitized.address = validator.trim(data.address);
    if (data.city) sanitized.city = validator.trim(data.city);
    if (data.state) sanitized.state = validator.trim(data.state);
    if (data.country) sanitized.country = validator.trim(data.country);
    if (data.postalCode) sanitized.postalCode = validator.trim(data.postalCode);
    if (data.phone) sanitized.phone = validator.trim(data.phone);
    if (data.email) sanitized.email = validator.trim(data.email.toLowerCase());
    if (data.website) sanitized.website = validator.trim(data.website);
    if (data.contactPerson) sanitized.contactPerson = validator.trim(data.contactPerson);
    if (data.taxId) sanitized.taxId = validator.trim(data.taxId);
    if (data.licenseNumber) sanitized.licenseNumber = validator.trim(data.licenseNumber);
    if (data.notes) sanitized.notes = validator.trim(data.notes);
    
    // Set default values
    sanitized.status = data.status || 'active';
    sanitized.registrationDate = data.registrationDate || new Date().toISOString().split('T')[0];
    
    return sanitized;
};

/**
 * GET endpoint: Get the welcome message for the Manufacturer API.
 *
 * @param {Object} req  request object.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.get("/", function (req, res) {
    res.send("Manufacturer API");
});

/**
 * GET endpoint: Get details of all manufacturers.
 *
 * @param {Object} req  request object.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.get("/all", function (req, res) {
    // Force database reload to ensure fresh data
    try {
        manufacturerDB.loadDatabase();
    } catch (reloadError) {
        console.log(`Manufacturer database reload warning: ${reloadError.message}`);
    }
    
    manufacturerDB.find({}).sort({ name: 1 }).exec(function (err, docs) {
        if (err) {
            console.error("Error fetching manufacturers:", err);
        res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to fetch manufacturers.",
            });
            return;
        }
        res.json(docs);
    });
});

/**
 * GET endpoint: Get a specific manufacturer by ID.
 *
 * @param {Object} req  request object with manufacturer ID as a parameter.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.get("/manufacturer/:id", function (req, res) {
    const manufacturerId = parseInt(req.params.id);
    
    manufacturerDB.findOne({ _id: manufacturerId }, function (err, manufacturer) {
        if (err) {
            console.error("Error fetching manufacturer:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to fetch manufacturer.",
            });
            return;
        }
        
        if (!manufacturer) {
            res.status(404).json({
                error: "Not Found",
                message: "Manufacturer not found.",
            });
            return;
        }
        
        res.json(manufacturer);
    });
});

/**
 * GET endpoint: Search manufacturers by name or code.
 *
 * @param {Object} req  request object with search query.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.get("/search", function (req, res) {
    const query = req.query.q;
    
    if (!query || query.trim().length === 0) {
        res.json([]);
        return;
    }
    
    const searchRegex = new RegExp(query.trim(), 'i');
    
    manufacturerDB.find({
        $or: [
            { name: searchRegex },
            { code: searchRegex }
        ]
    }).sort({ name: 1 }).limit(20).exec(function (err, docs) {
        if (err) {
            console.error("Error searching manufacturers:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to search manufacturers.",
            });
            return;
        }
        res.json(docs);
    });
});

/**
 * POST endpoint: Create a new manufacturer.
 *
 * @param {Object} req  request object with new manufacturer data in the body.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.post("/manufacturer", function (req, res) {
    let newManufacturer = req.body;
    
    // Validate and sanitize input data
    const validation = validateManufacturerData(newManufacturer);
    if (!validation.isValid) {
        res.status(400).json({
            error: "Validation Error",
            message: "Please fix the following errors:",
            errors: validation.errors,
            warnings: validation.warnings
        });
        return;
    }
    
    // Sanitize data
    const sanitizedData = sanitizeManufacturerData(newManufacturer);
    
    // Create manufacturer object
    const manufacturer = {
        _id: Math.floor(Date.now() / 1000),
        ...sanitizedData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    // Check for duplicate name
    manufacturerDB.findOne({ name: manufacturer.name }, function (err, existing) {
        if (err) {
            console.error("Error checking duplicate manufacturer:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to create manufacturer.",
            });
            return;
        }
        
        if (existing) {
            res.status(409).json({
                error: "Conflict",
                message: "A manufacturer with this name already exists.",
            });
            return;
        }
        
        // Check for duplicate code if provided
        if (manufacturer.code && manufacturer.code.trim().length > 0) {
            manufacturerDB.findOne({ code: manufacturer.code }, function (err, existingCode) {
                if (err) {
                    console.error("Error checking duplicate manufacturer code:", err);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "Failed to create manufacturer.",
                    });
                    return;
                }
                
        if (existingCode) {
                    res.status(409).json({
                        error: "Conflict",
                        message: "A manufacturer with this code already exists.",
                    });
                    return;
                }
                
                // Insert the manufacturer
                insertManufacturer();
            });
        } else {
            // Insert the manufacturer without code validation
            insertManufacturer();
        }
    });
    
    function insertManufacturer() {
        manufacturerDB.insert(manufacturer, function (err, insertedManufacturer) {
            if (err) {
                console.error("Error inserting manufacturer:", err);
        res.status(500).json({
                    error: "Internal Server Error",
                    message: "Failed to create manufacturer.",
                });
                return;
            }
            
            console.log("Manufacturer created successfully:", insertedManufacturer.name);
            res.status(201).json({
                message: "Manufacturer created successfully",
                manufacturer: insertedManufacturer
            });
        });
    }
});

/**
 * PUT endpoint: Update manufacturer details.
 *
 * @param {Object} req  request object with updated manufacturer data in the body.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.put("/manufacturer", function (req, res) {
    const updateData = req.body;
    
    if (!updateData.id) {
        res.status(400).json({
            error: "Validation Error",
            message: "Manufacturer ID is required.",
        });
        return;
    }
    
    // Validate and sanitize input data
    const validation = validateManufacturerData(updateData);
    if (!validation.isValid) {
        res.status(400).json({
            error: "Validation Error",
            message: "Please fix the following errors:",
            errors: validation.errors,
            warnings: validation.warnings
        });
        return;
    }
    
    // Sanitize data
    const sanitizedData = sanitizeManufacturerData(updateData);
    const manufacturer = {
        ...sanitizedData,
        updatedAt: new Date().toISOString()
    };
    
    // Check for duplicate name (excluding current manufacturer)
    manufacturerDB.findOne({ 
        name: manufacturer.name, 
        _id: { $ne: parseInt(updateData.id) } 
    }, function (err, existing) {
        if (err) {
            console.error("Error checking duplicate manufacturer name:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to update manufacturer.",
            });
            return;
        }
        
        if (existing) {
            res.status(409).json({
                error: "Conflict",
                message: "A manufacturer with this name already exists.",
            });
            return;
        }
        
        // Check for duplicate code if provided (excluding current manufacturer)
        if (manufacturer.code && manufacturer.code.trim().length > 0) {
            manufacturerDB.findOne({ 
                code: manufacturer.code, 
                _id: { $ne: parseInt(updateData.id) } 
            }, function (err, existingCode) {
                if (err) {
                    console.error("Error checking duplicate manufacturer code:", err);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "Failed to update manufacturer.",
                    });
                    return;
                }
                
                if (existingCode) {
                    res.status(409).json({
                        error: "Conflict",
                        message: "A manufacturer with this code already exists.",
                    });
                    return;
                }
                
                // Update the manufacturer
                updateManufacturer();
            });
        } else {
            // Update the manufacturer without code validation
            updateManufacturer();
        }
    });
    
    function updateManufacturer() {
        manufacturerDB.update(
            { _id: parseInt(updateData.id) },
            { $set: manufacturer },
            {},
            function (err, numReplaced, updatedManufacturer) {
                if (err) {
                    console.error("Error updating manufacturer:", err);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "Failed to update manufacturer.",
                    });
                    return;
                }
                
                if (numReplaced === 0) {
                    res.status(404).json({
                        error: "Not Found",
                        message: "Manufacturer not found.",
                    });
                    return;
                }
                
                console.log("Manufacturer updated successfully:", manufacturer.name);
                res.json({
                    message: "Manufacturer updated successfully",
                    manufacturer: { ...manufacturer, _id: parseInt(updateData.id) }
                });
            }
        );
    }
});

/**
 * GET endpoint: Validate manufacturer data without saving.
 *
 * @param {Object} req  request object with manufacturer data in query.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.get("/validate", function (req, res) {
    const manufacturerData = req.query;
    
    if (!manufacturerData.name) {
        res.status(400).json({
            error: "Validation Error",
            message: "Manufacturer name is required for validation."
        });
        return;
    }
    
    const validation = validateManufacturerData(manufacturerData);
    res.json({
        isValid: validation.isValid,
        errors: validation.errors,
        warnings: validation.warnings,
        sanitizedData: sanitizeManufacturerData(manufacturerData)
    });
});

/**
 * GET endpoint: Export manufacturers data to CSV.
 *
 * @param {Object} req  request object.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.get("/export", function (req, res) {
    manufacturerDB.find({}).sort({ name: 1 }).exec(function (err, manufacturers) {
        if (err) {
            console.error("Error fetching manufacturers for export:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to export manufacturers."
            });
            return;
        }
        
        // Set headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="manufacturers_export.csv"');
        
        // Create CSV content
        let csvContent = 'Name,Code,Address,City,State,Country,Postal Code,Phone,Email,Website,Contact Person,Tax ID,License Number,Registration Date,Status,Notes\n';
        
        manufacturers.forEach(manufacturer => {
            const row = [
                manufacturer.name || '',
                manufacturer.code || '',
                manufacturer.address || '',
                manufacturer.city || '',
                manufacturer.state || '',
                manufacturer.country || '',
                manufacturer.postalCode || '',
                manufacturer.phone || '',
                manufacturer.email || '',
                manufacturer.website || '',
                manufacturer.contactPerson || '',
                manufacturer.taxId || '',
                manufacturer.licenseNumber || '',
                manufacturer.registrationDate || '',
                manufacturer.status || '',
                manufacturer.notes || ''
            ].map(field => `"${field.replace(/"/g, '""')}"`).join(',');
            
            csvContent += row + '\n';
        });
        
        res.send(csvContent);
    });
});

/**
 * GET endpoint: Get data integrity report for manufacturers.
 *
 * @param {Object} req  request object.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.get("/integrity", function (req, res) {
    manufacturerDB.find({}).exec(function (err, manufacturers) {
        if (err) {
            console.error("Error fetching manufacturers for integrity check:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to check data integrity."
            });
            return;
        }
        
        const report = {
            totalManufacturers: manufacturers.length,
            activeManufacturers: manufacturers.filter(m => m.status === 'active').length,
            inactiveManufacturers: manufacturers.filter(m => m.status === 'inactive').length,
            manufacturersWithCode: manufacturers.filter(m => m.code && m.code.trim()).length,
            manufacturersWithEmail: manufacturers.filter(m => m.email && m.email.trim()).length,
            manufacturersWithPhone: manufacturers.filter(m => m.phone && m.phone.trim()).length,
            manufacturersWithAddress: manufacturers.filter(m => m.address && m.address.trim()).length,
            validationIssues: [],
            recommendations: []
        };
        
        // Check for validation issues
        manufacturers.forEach(manufacturer => {
            const validation = validateManufacturerData(manufacturer);
            if (validation.errors.length > 0 || validation.warnings.length > 0) {
                report.validationIssues.push({
                    id: manufacturer._id,
                    name: manufacturer.name,
                    errors: validation.errors,
                    warnings: validation.warnings
                });
                }
        });
        
        // Generate recommendations
        if (report.manufacturersWithCode === 0) {
            report.recommendations.push("Consider adding codes to all manufacturers for better identification");
        }
        if (report.manufacturersWithEmail === 0) {
            report.recommendations.push("Consider adding email addresses for better communication");
        }
        if (report.manufacturersWithPhone === 0) {
            report.recommendations.push("Consider adding phone numbers for better contact information");
        }
        
        res.json(report);
    });
});

/**
 * GET endpoint: Get products by manufacturer.
 *
 * @param {Object} req  request object with manufacturer ID as parameter.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.get("/products/:id", function (req, res) {
    const manufacturerId = parseInt(req.params.id);
    
    // This would require access to the inventory database
    // For now, we'll return a placeholder response
    res.json({
        manufacturerId: manufacturerId,
        message: "Products by manufacturer endpoint - requires inventory database integration",
        products: []
    });
});

/**
 * GET endpoint: Get manufacturer performance metrics.
 *
 * @param {Object} req  request object.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.get("/performance", function (req, res) {
    manufacturerDB.find({}).exec(function (err, manufacturers) {
        if (err) {
            console.error("Error fetching manufacturers for performance metrics:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to get performance metrics."
            });
            return;
        }
        
        const metrics = {
            totalManufacturers: manufacturers.length,
            activeManufacturers: manufacturers.filter(m => m.status === 'active').length,
            inactiveManufacturers: manufacturers.filter(m => m.status === 'inactive').length,
            manufacturersWithCompleteInfo: manufacturers.filter(m => 
                m.email && m.phone && m.address && m.code
            ).length,
            manufacturersWithPartialInfo: manufacturers.filter(m => 
                (m.email || m.phone || m.address || m.code) && 
                !(m.email && m.phone && m.address && m.code)
            ).length,
            manufacturersWithNoContactInfo: manufacturers.filter(m => 
                !m.email && !m.phone && !m.address
            ).length,
            topManufacturersByCompleteness: manufacturers
                .map(m => ({
                    id: m._id,
                    name: m.name,
                    completenessScore: calculateCompletenessScore(m),
                    missingFields: getMissingFields(m)
                }))
                .sort((a, b) => b.completenessScore - a.completenessScore)
                .slice(0, 10)
        };
        
        res.json(metrics);
    });
});

/**
 * GET endpoint: Get manufacturer contact directory.
 *
 * @param {Object} req  request object.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.get("/directory", function (req, res) {
    manufacturerDB.find({}).sort({ name: 1 }).exec(function (err, manufacturers) {
        if (err) {
            console.error("Error fetching manufacturers for directory:", err);
        res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to get contact directory."
            });
            return;
        }
        
        const directory = manufacturers.map(m => ({
            id: m._id,
            name: m.name,
            code: m.code || '',
            contactPerson: m.contactPerson || '',
            phone: m.phone || '',
            email: m.email || '',
            website: m.website || '',
            address: formatAddress(m),
            status: m.status,
            registrationDate: m.registrationDate || ''
        }));
        
        res.json(directory);
    });
});

/**
 * Helper function to calculate completeness score for a manufacturer
 */
function calculateCompletenessScore(manufacturer) {
    let score = 0;
    const fields = ['name', 'code', 'address', 'city', 'phone', 'email', 'website', 'contactPerson'];
    
    fields.forEach(field => {
        if (manufacturer[field] && manufacturer[field].trim()) {
            score += 12.5; // 100% / 8 fields = 12.5% per field
        }
    });
    
    return Math.round(score);
}

/**
 * Helper function to get missing fields for a manufacturer
 */
function getMissingFields(manufacturer) {
    const fields = ['code', 'address', 'city', 'phone', 'email', 'website', 'contactPerson'];
    return fields.filter(field => !manufacturer[field] || !manufacturer[field].trim());
}

/**
 * Helper function to format address
 */
function formatAddress(manufacturer) {
    const parts = [
        manufacturer.address,
        manufacturer.city,
        manufacturer.state,
        manufacturer.postalCode,
        manufacturer.country
    ].filter(part => part && part.trim());
    
    return parts.join(', ');
}

/**
 * DELETE endpoint: Delete a manufacturer by manufacturer ID.
 *
 * @param {Object} req  request object with manufacturer ID as a parameter.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.delete("/manufacturer/:id", function (req, res) {
    const manufacturerId = parseInt(req.params.id);
    
        // Check if manufacturer exists
    manufacturerDB.findOne({ _id: manufacturerId }, function (err, manufacturer) {
        if (err) {
            console.error("Error checking manufacturer existence:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to delete manufacturer.",
            });
            return;
        }
        
        if (!manufacturer) {
            res.status(404).json({
                error: "Not Found",
                message: "Manufacturer not found.",
            });
            return;
        }
        
        // TODO: Check if manufacturer is linked to any products
        // For now, allow deletion but log a warning
        
        manufacturerDB.remove(
            { _id: manufacturerId },
            function (err, numRemoved) {
                if (err) {
                    console.error("Error deleting manufacturer:", err);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "Failed to delete manufacturer.",
                    });
                    return;
                }
                
                console.log("Manufacturer deleted successfully:", manufacturer.name);
        res.json({
                    message: "Manufacturer deleted successfully",
                    manufacturer: manufacturer
                });
            }
        );
    });
});

/**
 * GET endpoint: Get manufacturer statistics.
 *
 * @param {Object} req  request object.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.get("/stats", function (req, res) {
    manufacturerDB.count({}, function (err, totalCount) {
        if (err) {
            console.error("Error counting manufacturers:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to get manufacturer statistics.",
            });
            return;
        }
        
        manufacturerDB.count({ status: 'active' }, function (err, activeCount) {
            if (err) {
                console.error("Error counting active manufacturers:", err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "Failed to get manufacturer statistics.",
                });
                return;
            }

        res.json({
                total: totalCount,
                active: activeCount,
                inactive: totalCount - activeCount
            });
        });
    });
});

/**
 * POST endpoint: Bulk import manufacturers from CSV file.
 *
 * @param {Object} req  request object with CSV file and options.
 * @param {Object} res  response object.
 * @returns {void}
 */
app.post("/bulk-import", upload.single('csvFile'), function (req, res) {
    if (!req.file) {
        return res.status(400).json({
            error: "Bad Request",
            message: "No CSV file uploaded."
        });
    }

    // Parse and normalize the flags coming from multipart form-data
    const parseBool = (v) => {
        if (Array.isArray(v)) {
            return v.includes('on') || v.includes('true') || v.includes('1');
        }
        return v === true || v === 'true' || v === '1' || v === 1;
    };
    
    const skipDuplicates = parseBool(req.body.skipDuplicates);
    const updateExisting = parseBool(req.body.updateExisting);

    console.log("Manufacturer bulk import started with options:");
    console.log("- Skip Duplicates:", skipDuplicates);
    console.log("- Update Existing:", updateExisting);

    try {
        // Parse CSV content
        const csvContent = req.file.buffer.toString('utf8');
        const lines = csvContent.split('\n').filter(line => line.trim().length > 0);
        
        if (lines.length < 2) {
            return res.status(400).json({
                error: "Bad Request",
                message: "CSV file must contain at least a header row and one data row."
            });
        }

        const headers = lines[0].split(',').map(h => h.trim());
        const dataRows = lines.slice(1);
        
        console.log(`Processing ${dataRows.length} manufacturer records...`);

        let processed = 0;
        let created = 0;
        let updated = 0;
        let skipped = 0;
        let errors = [];

        // Process each row sequentially
        async.eachSeries(dataRows, function (row, callback) {
            const rowIndex = processed + 1;
            const values = row.split(',').map(v => v.trim());
            
            if (values.length < headers.length) {
                // Pad with empty values if row is shorter than headers
                while (values.length < headers.length) {
                    values.push('');
                }
            }

            // Create data object from headers and values
            const data = {};
            headers.forEach((header, index) => {
                data[header] = values[index] || '';
            });

            // Validate required fields
            if (!data.Name || data.Name.trim().length === 0) {
                errors.push({ row: rowIndex, error: 'Manufacturer name is required', data });
                processed++;
                return callback();
            }

            const manufacturerName = validator.escape(data.Name.trim());
            const manufacturerCode = validator.escape(data.Code || '');
            
            // Check for existing manufacturer
            manufacturerDB.findOne({ 
            $or: [
                    { name: manufacturerName },
                    { code: manufacturerCode }
                ]
            }, function (err, existingManufacturer) {
                if (err) {
                    errors.push({ row: rowIndex, error: `Database error: ${err.message}`, data });
                    processed++;
                    return callback();
                }

                if (existingManufacturer) {
                    if (skipDuplicates && !updateExisting) {
                        console.log(`- Skipping duplicate manufacturer: ${manufacturerName}`);
                        skipped++;
                        processed++;
                        return callback();
                    }

                    if (updateExisting) {
                        // Update existing manufacturer
                        const updateData = {
                            name: manufacturerName,
                            code: manufacturerCode,
                            address: validator.escape(data.Address || ''),
                            city: validator.escape(data.City || ''),
                            state: validator.escape(data.State || ''),
                            country: validator.escape(data.Country || ''),
                            postalCode: validator.escape(data.PostalCode || ''),
                            phone: validator.escape(data.Phone || ''),
                            email: validator.escape(data.Email || ''),
                            website: validator.escape(data.Website || ''),
                            contactPerson: validator.escape(data.ContactPerson || ''),
                            taxId: validator.escape(data.TaxId || ''),
                            licenseNumber: validator.escape(data.LicenseNumber || ''),
                            registrationDate: validator.escape(data.RegistrationDate || ''),
                            status: data.Status === 'inactive' ? 'inactive' : 'active',
                            notes: validator.escape(data.Notes || ''),
                            updatedAt: new Date().toISOString()
                        };

                        manufacturerDB.update(
                            { _id: existingManufacturer._id },
                            { $set: updateData },
                            {},
                            function (err, numReplaced) {
                                if (err) {
                                    errors.push({ row: rowIndex, error: `Update error: ${err.message}`, data });
                                } else {
                                    console.log(`- Updated existing manufacturer: ${manufacturerName}`);
                                    updated++;
                                }
                                processed++;
                                callback();
                            }
                        );
                    } else {
                        // Skip duplicate
                        console.log(`- Skipping duplicate manufacturer: ${manufacturerName}`);
                        skipped++;
                        processed++;
                        callback();
                    }
                } else {
                    // Create new manufacturer
                    const newManufacturer = {
                        _id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000),
                        name: manufacturerName,
                        code: manufacturerCode,
                        address: validator.escape(data.Address || ''),
                        city: validator.escape(data.City || ''),
                        state: validator.escape(data.State || ''),
                        country: validator.escape(data.Country || ''),
                        postalCode: validator.escape(data.PostalCode || ''),
                        phone: validator.escape(data.Phone || ''),
                        email: validator.escape(data.Email || ''),
                        website: validator.escape(data.Website || ''),
                        contactPerson: validator.escape(data.ContactPerson || ''),
                        taxId: validator.escape(data.TaxId || ''),
                        licenseNumber: validator.escape(data.LicenseNumber || ''),
                        registrationDate: validator.escape(data.RegistrationDate || ''),
                        status: data.Status === 'inactive' ? 'inactive' : 'active',
                        notes: validator.escape(data.Notes || ''),
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };

                    manufacturerDB.insert(newManufacturer, function (err, insertedManufacturer) {
                        if (err) {
                            errors.push({ row: rowIndex, error: `Insert error: ${err.message}`, data });
                        } else {
                            console.log(`- Created new manufacturer: ${manufacturerName}`);
                            created++;
                        }
                        processed++;
                        callback();
                    });
                }
            });
        }, function (err) {
            if (err) {
                console.error("Error during bulk import:", err);
                return res.status(500).json({
                    error: "Internal Server Error",
                    message: "An error occurred during bulk import processing."
                });
            }

            console.log(`Manufacturer bulk import completed. Processed: ${processed}, Created: ${created}, Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors.length}`);

        res.json({
            success: true,
                message: `Import completed. Processed ${processed} manufacturers. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}.`,
                summary: {
                    processed,
                    created,
                    updated,
                    skipped,
                    errors: errors.length
                },
                errors: errors.length > 0 ? errors : undefined
            });
        });

    } catch (error) {
        console.error("Error processing CSV:", error);
        res.status(500).json({
            error: "Internal Server Error",
            message: "Failed to process CSV file: " + error.message
        });
    }
});
