const express = require('express');
const Datastore = require('@seald-io/nedb');
const path = require('path');
const moment = require('moment');
const app = express();

// Get app data directory
const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
const appName = process.env.APPNAME || 'PharmaSpot';

// Initialize databases
let purchaseOrdersDBReady = false;
const purchaseOrdersDB = new Datastore({
    filename: path.join(appData, appName, "server", "databases", "purchase-orders.db"),
    autoload: true,
    onload: function (err) {
        if (err) {
            console.error('Purchase orders database load error:', err);
            if (err.code === 'ENOENT') {
                console.log('Purchase orders database file missing - it will be created on first write');
            }
        } else {
            if (process.env.NODE_ENV === 'dev') {
                console.log('Purchase orders database loaded successfully');
            }
        }
        purchaseOrdersDBReady = true;
    }
});

setTimeout(() => {
    if (!purchaseOrdersDBReady) {
        console.warn('⚠️ Purchase orders database autoload taking longer than expected - forcing manual load');
        purchaseOrdersDB.loadDatabase(function (loadErr) {
            if (loadErr) {
                console.error('❌ Manual purchase orders database load failed:', loadErr);
            } else {
                if (process.env.NODE_ENV === 'dev') {
                    console.log('✅ Purchase orders database loaded via manual load');
                }
            }
            purchaseOrdersDBReady = true;
        });
    }
}, 1000);

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
            if (process.env.NODE_ENV === 'dev') {
                console.log('Inventory database loaded successfully in purchase-orders');
            }
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
let batchesDBReady = false;
const batchesDBPath = path.join(appData, appName, "server", "databases", "inventory-batches.db");
const inventoryBatchesDB = new Datastore({
    filename: batchesDBPath,
    autoload: true,
    onload: function(err) {
        if (err) {
            console.error('Batches database load error:', err);
            if (err.code === 'ENOENT') {
                console.log('Batches database file missing - will be created on first write');
                batchesDBReady = true;
            } else {
                // Other error (like rename error) - try to reload manually
                console.warn('⚠️ Batches DB autoload failed, attempting manual reload...');
                const fs = require('fs');
                if (fs.existsSync(batchesDBPath)) {
                    console.log('   Database file exists, forcing reload...');
                    inventoryBatchesDB.loadDatabase(function(reloadErr) {
                        if (reloadErr) {
                            console.error('   Manual reload failed:', reloadErr);
                            // Mark as ready anyway - queries will work or fail gracefully
                            batchesDBReady = true;
                        } else {
                            console.log('   ✅ Manual reload successful');
                            batchesDBReady = true;
                        }
                    });
                } else {
                    console.log('   Database file does not exist - will be created on first write');
                    batchesDBReady = true;
                }
            }
        } else {
            if (process.env.NODE_ENV === 'dev') {
                console.log('Batches database loaded successfully');
            }
            batchesDBReady = true;
        }
    }
});

// Create indexes for faster batch queries (after DB is ready)
// Also verify database is actually loaded
setTimeout(() => {
    const fs = require('fs');
    if (fs.existsSync(batchesDBPath) && !batchesDBReady) {
        console.warn('⚠️ Batch DB file exists but not marked ready - forcing load...');
        inventoryBatchesDB.loadDatabase(function(loadErr) {
            if (!loadErr) {
                if (process.env.NODE_ENV === 'dev') {
                    console.log('✅ Batch database manually loaded successfully');
                }
                batchesDBReady = true;
            } else {
                console.error('❌ Manual batch DB load failed:', loadErr);
                batchesDBReady = true; // Mark as ready anyway to allow queries
            }
        });
    }
    
    if (batchesDBReady) {
        try {
            inventoryBatchesDB.ensureIndex({ fieldName: 'productId' });
            inventoryBatchesDB.ensureIndex({ fieldName: 'quantity' });
            inventoryBatchesDB.ensureIndex({ fieldName: 'expiryDate' });
            console.log('✅ Batch database indexes created');
        } catch (e) {
            console.log('Index ensure warning (batches):', e.message);
        }
    }
}, 1000); // Increased delay to ensure DB is loaded

function getInventorySnapshot() {
    const datasetsTried = [];
    const fs = require('fs');
    const inventoryFilePath = inventoryDB && inventoryDB.filename;
    
    if (inventoryFilePath) {
        try {
            if (fs.existsSync(inventoryFilePath)) {
                const fileContent = fs.readFileSync(inventoryFilePath, 'utf8');
                const lines = fileContent.split('\n').filter(line => line.trim());
                const latestById = new Map();
                lines.forEach(line => {
                    try {
                        const doc = JSON.parse(line);
                        if (doc && doc._id !== undefined && doc._id !== null) {
                            latestById.set(doc._id, doc);
                        }
                    } catch (parseErr) {
                        // Ignore malformed lines
                    }
                });
                const fileData = Array.from(latestById.values());
                if (fileData.length) {
                    datasetsTried.push('file');
                    return fileData;
                }
            } else {
                console.warn(`Inventory datafile does not exist yet: ${inventoryFilePath}`);
            }
        } catch (fileErr) {
            console.warn('⚠️ Failed to read inventory datafile:', fileErr.message || fileErr);
        }
    }
    
    try {
        if (typeof inventoryDB.getAllData === 'function') {
            const data = inventoryDB.getAllData();
            if (Array.isArray(data) && data.length) {
                datasetsTried.push('memory');
                return data;
            }
        }
    } catch (memoryErr) {
        console.warn('⚠️ inventoryDB.getAllData() failed:', memoryErr.message || memoryErr);
    }
    
    if (datasetsTried.length === 0) {
        console.warn('⚠️ No inventory datasets available (file and memory both empty)');
    }
    
    return [];
}

function isBlankValue(value) {
    if (value === undefined || value === null) {
        return true;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return true;
        }
        const lowered = trimmed.toLowerCase();
        if (lowered === 'null' || lowered === 'undefined' || lowered === 'na' || lowered === 'n/a') {
            return true;
        }
    }
    return false;
}

function normalizeExpiryDateForStorage(rawValue) {
    if (isBlankValue(rawValue)) {
        return null;
    }
    if (rawValue instanceof Date) {
        return moment(rawValue).format('YYYY-MM-DD');
    }
    const stringValue = String(rawValue).trim();
    const knownFormats = [
        moment.ISO_8601,
        'YYYY-MM-DD',
        'YYYY/MM/DD',
        'MM/DD/YYYY',
        'DD/MM/YYYY',
        'DD-MMM-YYYY',
        'DD-MMM-YY',
        'MMM DD, YYYY'
    ];
    let parsed = null;
    for (const fmt of knownFormats) {
        const candidate = moment(stringValue, fmt, true);
        if (candidate.isValid()) {
            parsed = candidate;
            break;
        }
    }
    if (!parsed) {
        const fallback = moment(stringValue);
        if (fallback.isValid()) {
            parsed = fallback;
        }
    }
    if (!parsed) {
        return stringValue;
    }
    return parsed.startOf('day').format('YYYY-MM-DD');
}

function getLatestBatchForProduct(productId) {
    if (productId === undefined || productId === null) {
        return null;
    }
    
    const fs = require('fs');
    const batchesFilePath = inventoryBatchesDB && inventoryBatchesDB.filename;
    const numericId = Number(productId);
    const stringId = String(productId);
    const matchesById = new Map();
    
    const acceptBatch = (batch) => {
        if (!batch || batch._id === undefined || batch._id === null) {
            return;
        }
        const batchProductId = batch.productId;
        if (
            batchProductId === productId ||
            batchProductId === numericId ||
            batchProductId === stringId ||
            Number(batchProductId) === numericId ||
            String(batchProductId) === stringId
        ) {
            matchesById.set(batch._id, batch);
        }
    };
    
    if (batchesFilePath && fs.existsSync(batchesFilePath)) {
        try {
            const fileContent = fs.readFileSync(batchesFilePath, 'utf8');
            const lines = fileContent.split('\n').filter(line => line.trim());
            lines.forEach(line => {
                try {
                    const batch = JSON.parse(line);
                    acceptBatch(batch);
                } catch (parseErr) {
                    // Ignore malformed lines
                }
            });
        } catch (fileErr) {
            console.warn('⚠️ Failed to read batches datafile:', fileErr.message || fileErr);
        }
    }
    
    if (matchesById.size === 0) {
        try {
            if (typeof inventoryBatchesDB.getAllData === 'function') {
                const data = inventoryBatchesDB.getAllData();
                if (Array.isArray(data)) {
                    data.forEach(batch => acceptBatch(batch));
                }
            }
        } catch (memoryErr) {
            console.warn('⚠️ inventoryBatchesDB.getAllData() failed:', memoryErr.message || memoryErr);
        }
    }
    
    if (matchesById.size === 0) {
        return null;
    }
    
    const sorted = Array.from(matchesById.values()).sort((a, b) => {
        const dateA = new Date(a.updatedAt || a.createdAt || 0);
        const dateB = new Date(b.updatedAt || b.createdAt || 0);
        if (!Number.isNaN(dateB.getTime()) && !Number.isNaN(dateA.getTime())) {
            return dateB - dateA;
        }
        return (b._id || 0) - (a._id || 0);
    });
    
    return sorted[0] || null;
}

function waitForPurchaseOrdersDB(attempts = 0, onReady = () => {}) {
    if (purchaseOrdersDBReady) {
        onReady();
        return;
    }

    if (attempts >= 10) {
        console.warn('⚠️ Purchase orders DB still not marked ready - forcing manual load (attempts exceeded)');
        purchaseOrdersDB.loadDatabase(function (loadErr) {
            if (loadErr) {
                console.error('❌ Manual purchase orders DB load failed from wait helper:', loadErr);
            } else {
                console.log('✅ Manual purchase orders DB load succeeded from wait helper');
            }
            purchaseOrdersDBReady = true;
            onReady();
        });
        return;
    }

    setTimeout(() => waitForPurchaseOrdersDB(attempts + 1, onReady), 100);
}

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

// Reset any stuck flags on startup (log removed for cleaner output)
if (isAutoDraftRunning) {
    isAutoDraftRunning = false;
    lastAutoDraftTime = null;
}

/**
 * GET batches by productId
 */
app.get("/batches/by-product/:productId", function (req, res) {
    const productId = parseInt(req.params.productId);
    
    // Response guard to prevent duplicate responses
    let responseSent = false;
    const sendResponse = (data, statusCode = 200) => {
        if (responseSent) {
            console.warn('⚠️ Batches response already sent, ignoring duplicate');
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
    
    // Increased timeout - batch queries shouldn't take this long
    const timeoutTimer = setTimeout(() => {
        if (!responseSent) {
            console.warn('⏱️ Batches query timeout - returning empty result');
            sendResponse({ success: true, batches: [] });
        }
    }, 8000); // 8 second timeout (increased from 5s to match frontend)
    
    // Check if database file exists first (fast check)
    const fs = require('fs');
    const dbFilePath = inventoryBatchesDB.filename;
    const dbExists = fs.existsSync(dbFilePath);
    
    if (!dbExists) {
        console.log(`📂 Batch DB file doesn't exist yet: ${dbFilePath}`);
        console.log('   Returning empty result (database will be created on first write)');
        clearTimeout(timeoutTimer);
        sendResponse({ success: true, batches: [] });
        return;
    }
    
    // Wait for DB to be ready (but don't wait too long)
    const waitForDB = (attempts = 0) => {
        // If DB is ready OR we've waited long enough (500ms max), proceed
        if (batchesDBReady || attempts >= 10) {
            console.log(`Fetching batches for productId ${productId} (DB ready: ${batchesDBReady}, attempts: ${attempts}, file exists: ${dbExists})`);
            
            // If DB file exists but DB reports not ready, force a load
            if (dbExists && !batchesDBReady && attempts >= 10) {
                console.warn('⚠️ DB file exists but batchesDBReady is false - forcing load...');
                inventoryBatchesDB.loadDatabase(function(forceLoadErr) {
                    if (!forceLoadErr) {
                        console.log('✅ Force load successful');
                        batchesDBReady = true;
                    }
                    // Proceed with query
                    executeQuery();
                });
                return;
            }
            
            // If DB file exists, try to load it if not ready, then proceed
            if (dbExists && !batchesDBReady) {
                console.warn('⚠️ DB file exists but not ready - forcing load...');
                inventoryBatchesDB.loadDatabase(function(loadErr) {
                    if (!loadErr) {
                        console.log('✅ Force load successful');
                        batchesDBReady = true;
                    }
                    // Proceed with query (or fallback) regardless
                    executeQuery();
                });
                return;
            }
            
            // Execute query directly (or use fallback immediately)
            // Since queries are hanging, use file reading fallback immediately
            if (dbExists) {
                console.log('📂 Using direct file reading fallback (queries are hanging)');
                executeFileFallback();
            } else {
                executeQuery();
            }
            
            function executeFileFallback() {
                const numProductId = parseInt(productId);
                const stringProductId = String(productId);
                
                console.log(`🔍 Reading batches from file for productId: ${productId}`);
                
                try {
                    const fs = require('fs');
                    const fileContent = fs.readFileSync(dbFilePath, 'utf8');
                    const lines = fileContent.split('\n').filter(l => l.trim());
                    console.log(`   File contains ${lines.length} lines`);
                    
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
                    const batches = Array.from(latestById.values()).filter(batch => {
                        return batch.productId === numProductId || 
                               batch.productId === stringProductId ||
                               String(batch.productId) === String(numProductId) ||
                               Number(batch.productId) === numProductId;
                    });
                    console.log(`   File parsing found ${batches.length} matching batches after dedup by _id`);
                    
                    const sortedBatches = batches.sort((a, b) => {
                        const dateA = a.expiryDate ? new Date(a.expiryDate) : new Date('9999-12-31');
                        const dateB = b.expiryDate ? new Date(b.expiryDate) : new Date('9999-12-31');
                        return dateA - dateB;
                    });
                    
                    clearTimeout(timeoutTimer);
                    sendResponse({ success: true, batches: sortedBatches });
                } catch (fileErr) {
                    console.error('❌ File read failed:', fileErr);
                    clearTimeout(timeoutTimer);
                    sendResponse({ success: true, batches: [] });
                }
            }
            
            // Normalize productId to number (batches are stored with numeric productId)
            const numProductId = parseInt(productId);
            const stringProductId = String(productId);
            
            console.log(`🔍 Querying batches for productId: ${productId} (parsed: ${numProductId}, string: "${stringProductId}")`);
            console.log(`📊 Batch DB ready: ${batchesDBReady}, filename: ${inventoryBatchesDB.filename}`);
            
            const queryStartTime = Date.now();
            
            // Try numeric query first (most common - batches are stored with numeric productId)
            const query = { productId: numProductId };
            
            console.log('Query:', JSON.stringify(query));
            console.log('Query type check:', typeof numProductId, 'isNaN:', isNaN(numProductId));
            
            // Add query timeout at database level - if query hangs, use fallback
            const dbQueryTimeout = setTimeout(() => {
                if (!responseSent) {
                    console.error('⏱️ Database query timeout after 3s - using fallback getAllData()');
                    // Try fallback: getAllData and filter in memory
                    try {
                        // Ensure database is loaded first
                        if (!inventoryBatchesDB.persistence || !inventoryBatchesDB.persistence.executor) {
                            console.warn('   Database not fully loaded, attempting quick load...');
                            inventoryBatchesDB.loadDatabase(function(loadErr) {
                                if (loadErr) {
                                    console.error('   Quick load failed:', loadErr);
                                } else {
                                    console.log('   Quick load successful');
                                }
                                // Proceed with fallback
                                executeFallback();
                            });
                        } else {
                            executeFallback();
                        }
                        
                        function executeFallback() {
                            try {
                                const allData = inventoryBatchesDB.getAllData();
                                console.log(`   Fallback: Retrieved ${allData ? allData.length : 0} total batches from memory`);
                                
                                if (!allData || allData.length === 0) {
                                    console.warn('   ⚠️ getAllData() returned empty - database may not be loaded');
                                    // Try reading file directly as last resort
                                    const fs = require('fs');
                                    try {
                                        const fileContent = fs.readFileSync(dbFilePath, 'utf8');
                                        const lines = fileContent.split('\n').filter(l => l.trim());
                                        console.log(`   File contains ${lines.length} lines`);
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
                                        const batches = Array.from(latestById.values()).filter(batch => {
                                            return batch.productId === numProductId || 
                                                   batch.productId === stringProductId ||
                                                   String(batch.productId) === String(numProductId) ||
                                                   Number(batch.productId) === numProductId;
                                        });
                                        console.log(`   File parsing found ${batches.length} matching batches after dedup by _id`);
                                        const sortedBatches = batches.sort((a, b) => {
                                            const dateA = a.expiryDate ? new Date(a.expiryDate) : new Date('9999-12-31');
                                            const dateB = b.expiryDate ? new Date(b.expiryDate) : new Date('9999-12-31');
                                            return dateA - dateB;
                                        });
                                        clearTimeout(timeoutTimer);
                                        sendResponse({ success: true, batches: sortedBatches });
                                        return;
                                    } catch (fileErr) {
                                        console.error('   File read failed:', fileErr);
                                    }
                                }
                                
                                const filtered = allData.filter(b => {
                                    const bId = b.productId;
                                    return bId === numProductId || 
                                           bId === stringProductId || 
                                           String(bId) === String(numProductId) ||
                                           Number(bId) === numProductId;
                                });
                                console.log(`   Fallback: Filtered to ${filtered.length} batches for productId ${numProductId}`);
                                const sortedBatches = filtered.sort((a, b) => {
                                    const dateA = a.expiryDate ? new Date(a.expiryDate) : new Date('9999-12-31');
                                    const dateB = b.expiryDate ? new Date(b.expiryDate) : new Date('9999-12-31');
                                    return dateA - dateB;
                                });
                                clearTimeout(timeoutTimer);
                                sendResponse({ success: true, batches: sortedBatches });
                            } catch (fallbackErr) {
                                console.error('❌ Fallback failed:', fallbackErr);
                                clearTimeout(timeoutTimer);
                                sendResponse({ success: true, batches: [] });
                            }
                        }
                    } catch (fallbackErr) {
                        console.error('❌ Fallback setup failed:', fallbackErr);
                        clearTimeout(timeoutTimer);
                        sendResponse({ success: true, batches: [] });
                    }
                }
            }, 3000); // 3 second timeout - if query hangs, use fallback
            
            // First try with numeric productId
            console.log('🔍 Executing NeDB query:', JSON.stringify(query));
            console.log('   Database instance:', inventoryBatchesDB ? 'exists' : 'missing');
            console.log('   Database filename:', inventoryBatchesDB.filename);
            
            // Test: Count all batches to verify DB is accessible
            inventoryBatchesDB.count({}, function(countErr, totalCount) {
                if (!countErr) {
                    console.log(`📊 Total batches in database: ${totalCount}`);
                } else {
                    console.warn('⚠️ Could not count batches:', countErr);
                }
            });
            
            inventoryBatchesDB.find(query)
                .limit(100)
                .exec(function (err, batches) {
                clearTimeout(dbQueryTimeout);
                    const queryDuration = Date.now() - queryStartTime;
                    
                    if (responseSent) {
                        console.warn('⚠️ Response already sent via timeout, ignoring batch results');
                        return;
                    }
                    
                    if (err) {
                        console.error('❌ Error fetching batches:', err);
                        console.error('   Error details:', JSON.stringify(err));
                        clearTimeout(timeoutTimer);
                        sendResponse({ success: false, message: 'Failed to fetch batches', error: err.message }, 500);
                        return;
                    }
                    
                    console.log(`✅ Query completed in ${queryDuration}ms`);
                    console.log(`   Found ${batches ? batches.length : 0} batches for productId ${numProductId}`);
                    console.log(`   Batches is array: ${Array.isArray(batches)}`);
                    console.log(`   Batches value:`, batches);
                    
                    if (batches && batches.length > 0) {
                        console.log('   First batch details:', {
                            productId: batches[0].productId,
                            productIdType: typeof batches[0].productId,
                            quantity: batches[0].quantity,
                            lotNumber: batches[0].lotNumber
                        });
                    }
                    
                    // If no results with numeric, try string format
                    if (!batches || batches.length === 0) {
                        console.log(`⚠️ No batches found with numeric productId ${numProductId}, trying string format "${stringProductId}"`);
                        const stringQuery = { productId: stringProductId };
                        inventoryBatchesDB.find(stringQuery)
                            .limit(100)
                            .exec(function (strErr, strBatches) {
                                clearTimeout(timeoutTimer);
                                
                                if (responseSent) {
                                    return;
                                }
                                
                                if (strErr) {
                                    console.error('❌ Error with string query:', strErr);
                                    sendResponse({ success: true, batches: [] });
                                    return;
                                }
                                
                                console.log(`   String query found ${strBatches ? strBatches.length : 0} batches`);
                                
                                if (strBatches && strBatches.length > 0) {
                                    batches = strBatches;
                                } else {
                                    // Debug: Check what's actually in the database
                                    inventoryBatchesDB.count({}, function(countErr, totalBatches) {
                                        if (!countErr) {
                                            console.log(`📊 Total batches in database: ${totalBatches}`);
                                            if (totalBatches > 0) {
                                                console.warn(`⚠️ ProductId ${productId} not found, but ${totalBatches} batches exist`);
                                                // Get a sample batch to see the format
                                                inventoryBatchesDB.findOne({}, function(sampleErr, sampleBatch) {
                                                    if (!sampleErr && sampleBatch) {
                                                        console.log('📋 Sample batch from DB:', {
                                                            productId: sampleBatch.productId,
                                                            productIdType: typeof sampleBatch.productId,
                                                            productIdValue: sampleBatch.productId,
                                                            lotNumber: sampleBatch.lotNumber
                                                        });
                                                        console.log('   Query productId:', numProductId, 'Type:', typeof numProductId);
                                                        console.log('   Match check:', sampleBatch.productId === numProductId, sampleBatch.productId == numProductId);
                                                    }
                                                });
                                            }
                                        }
                                    });
                                }
                                
                                // Sort and return
                                const sortedBatches = (batches || []).sort((a, b) => {
                                    const dateA = a.expiryDate ? new Date(a.expiryDate) : new Date('9999-12-31');
                                    const dateB = b.expiryDate ? new Date(b.expiryDate) : new Date('9999-12-31');
                                    return dateA - dateB;
                                });
                                
                                sendResponse({ success: true, batches: sortedBatches });
                            });
                        return;
                    }
                    
                    // We found batches with numeric query
                    clearTimeout(timeoutTimer);
                    console.log('📦 Sample batch:', {
                        productId: batches[0].productId,
                        productIdType: typeof batches[0].productId,
                        lotNumber: batches[0].lotNumber,
                        quantity: batches[0].quantity,
                        expiryDate: batches[0].expiryDate
                    });
                    
                    // Sort by expiry date (oldest first) for FEFO
                    const sortedBatches = (batches || []).sort((a, b) => {
                        const dateA = a.expiryDate ? new Date(a.expiryDate) : new Date('9999-12-31');
                        const dateB = b.expiryDate ? new Date(b.expiryDate) : new Date('9999-12-31');
                        return dateA - dateB;
                    });
                    
                    sendResponse({ success: true, batches: sortedBatches });
                });
        } else {
            // Wait 50ms before retrying (max 500ms total)
            if (attempts < 10) {
                setTimeout(() => waitForDB(attempts + 1), 50);
            } else {
                // Proceed anyway after 500ms
                console.warn('⚠️ Batch DB not ready after 500ms, proceeding with query anyway');
                waitForDB(10); // Force proceed
            }
        }
    };
    
    waitForDB();
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
        expectedDeliveryDate: orderData.expectedDeliveryDate ? new Date(orderData.expectedDeliveryDate) : moment().add(1, 'day').toDate(),
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
                const resolvedProductId = item.productId || receivedItem.productId;
                
                const lotProvided = !isBlankValue(receivedItem.lotNumber);
                if (!lotProvided) {
                    const latestBatch = getLatestBatchForProduct(resolvedProductId);
                    if (latestBatch) {
                        receivedItem.lotNumber = latestBatch.lotNumber || latestBatch.barcode || String(latestBatch._id);
                        if (isBlankValue(receivedItem.barcode) && latestBatch.barcode) {
                            const parsedBarcode = parseInt(latestBatch.barcode);
                            receivedItem.barcode = Number.isNaN(parsedBarcode) ? latestBatch.barcode : parsedBarcode;
                        }
                        console.log(`ℹ️ No lot provided - using latest batch ${latestBatch._id} (lot: ${receivedItem.lotNumber || 'N/A'}) for product ${resolvedProductId}`);
                    } else {
                        receivedItem.lotNumber = `AUTO-${resolvedProductId}-${Date.now()}`;
                        console.log(`ℹ️ No existing batch found - generated lot ${receivedItem.lotNumber} for product ${resolvedProductId}`);
                    }
                }
                
                const providedExpiryRaw = !isBlankValue(receivedItem.expiryDate) ? receivedItem.expiryDate : receivedItem.expirationDate;
                let resolvedExpiry = normalizeExpiryDateForStorage(providedExpiryRaw);
                if (!resolvedExpiry) {
                    const defaultExpiry = moment().add(1, 'year').startOf('day').format('YYYY-MM-DD');
                    resolvedExpiry = defaultExpiry;
                    console.log(`ℹ️ No expiry provided - defaulting to ${resolvedExpiry} for product ${resolvedProductId}`);
                }
                receivedItem.expiryDate = resolvedExpiry;
                receivedItem.expirationDate = resolvedExpiry;
                
                item.receivedQuantity = newReceived;
                item.lotNumber = receivedItem.lotNumber || item.lotNumber;
                item.expiryDate = resolvedExpiry || item.expiryDate;
                if (resolvedExpiry) {
                    item.expirationDate = resolvedExpiry;
                } else if (!item.expirationDate && item.expiryDate) {
                    item.expirationDate = item.expiryDate;
                }
                // Backfill missing productId on the order item if available
                if (!item.productId && receivedItem.productId) {
                    item.productId = receivedItem.productId;
                }

                // Upsert batch record (productId + lotNumber + barcode)
                // Ensure productId is numeric for consistency
                const normalizedProductId = parseInt(item.productId) || item.productId;
                const parsedBarcode = !isBlankValue(receivedItem.barcode)
                    ? parseInt(receivedItem.barcode)
                    : (!isBlankValue(item.barcode) ? parseInt(item.barcode) : null);
                const batchQuery = {
                    productId: normalizedProductId, // Always use numeric for consistency
                    lotNumber: receivedItem.lotNumber || '',
                    barcode: Number.isNaN(parsedBarcode) ? null : parsedBarcode,
                };
                
                console.log(`📦 Creating/updating batch for product:`, {
                    productId: normalizedProductId,
                    productIdType: typeof normalizedProductId,
                    lotNumber: batchQuery.lotNumber,
                    barcode: batchQuery.barcode,
                    quantity: receivedQuantity
                });
                
                const batchUpdate = {
                    $set: {
                        productId: normalizedProductId, // Use normalized numeric ID
                        productName: item.productName,
                        lotNumber: receivedItem.lotNumber || '',
                        barcode: batchQuery.barcode || null,
                        expiryDate: resolvedExpiry || null,
                        purchasePrice: receivedItem.purchasePrice ? parseFloat(receivedItem.purchasePrice) : (item.unitPrice || null),
                        sellingPrice: receivedItem.sellingPrice ? parseFloat(receivedItem.sellingPrice) : null,
                        supplierId: order.supplierId || null,
                        supplierName: order.supplierName || null,
                        updatedAt: new Date()
                    },
                    $inc: { quantity: receivedQuantity }
                };
                inventoryBatchesDB.update(batchQuery, batchUpdate, { upsert: true }, function (batchErr, numAffected, upsertedBatch) {
                    if (batchErr) {
                        console.error('❌ Failed to upsert inventory batch:', batchErr);
                        console.error('Batch query:', batchQuery);
                        console.error('Batch update:', batchUpdate);
                    } else {
                        console.log(`✅ Batch upserted for ${item.productName}: ${numAffected} records affected`);
                        console.log(`   Batch details:`, {
                            productId: batchQuery.productId,
                            lotNumber: batchQuery.lotNumber,
                            barcode: batchQuery.barcode,
                            quantity: receivedQuantity,
                            expiryDate: resolvedExpiry
                        });
                        
                        // Verify batch was created by querying it
                        inventoryBatchesDB.findOne(batchQuery, function (verifyErr, verifyBatch) {
                            if (verifyErr) {
                                console.error('❌ Error verifying batch creation:', verifyErr);
                            } else if (!verifyBatch) {
                                console.warn('⚠️ Warning: Batch was not found after upsert! Query:', batchQuery);
                            } else {
                                console.log(`✅ Verified batch exists: quantity=${verifyBatch.quantity}, expiry=${verifyBatch.expiryDate || 'N/A'}`);
                            }
                        });
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
                                
                                const updateFields = {
                                    quantity: newQty,
                                    stock: 1,
                                    updatedAt: new Date()
                                };
                                if (resolvedExpiry) {
                                    updateFields.expirationDate = resolvedExpiry;
                                    updateFields.expiryDate = resolvedExpiry;
                                }
                                
                                inventoryDB.update(
                                    { _id: existingByBarcode._id },
                                    { $set: updateFields },
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
                                expiryDate: receivedItem.expiryDate || '',
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
                        const updateFields = {
                            quantity: newQuantity,
                            stock: 1, // stock: 1 means stock checking is enabled (fixed from stock: newQuantity)
                            updatedAt: new Date()
                        };
                        if (resolvedExpiry) {
                            updateFields.expirationDate = resolvedExpiry;
                            updateFields.expiryDate = resolvedExpiry;
                        }
                        
                        inventoryDB.update(
                            { _id: item.productId },
                            { 
                                $set: updateFields
                            },
                            {},
                            function (invQtyErr) {
                                if (invQtyErr) {
                                    console.error('Failed to increment product quantity:', invQtyErr);
                                } else {
                                    console.log(`✅ Updated product ${item.productId} quantity: ${currentQuantity} → ${newQuantity} (+${receivedQuantity})`);
                                    if (resolvedExpiry) {
                                        console.log(`   ➕ Updated expiration date to ${resolvedExpiry}`);
                                    }
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
    }, 6000); // 6 second timeout (reduced further)
    
    // Skip waitForDB and query immediately - DB should be ready by now
    const waitForDB = (attempts = 0) => {
        if (inventoryDBReady || attempts >= 3) {
            // Build targeted selector to avoid scanning entire DB
            const threshold = Number(reorderPointThreshold);
            const expiryAlertDaysNumber = Number(expiryAlertDays);
            const expiryCutoff = new Date();
            expiryCutoff.setDate(expiryCutoff.getDate() + expiryAlertDaysNumber);
            const expiryCutoffISO = expiryCutoff.toISOString().slice(0, 10);
            
            // Optimized selector - use indexed fields for better performance
            // Query for products with low stock, zero stock, or expiring inventory
            const selector = {
                $or: [
                    { quantity: { $lte: threshold } },
                    { quantity: 0 },
                    { expiryDate: { $lte: expiryCutoff } },
                    { expiryDate: { $lte: expiryCutoffISO } },
                    { expirationDate: { $lte: expiryCutoff } },
                    { expirationDate: { $lte: expiryCutoffISO } },
                    { "batchSummary.earliestExpiry": { $lte: expiryCutoffISO } }
                ]
            };
            
            function collectExpiredProducts(baseProducts, callback) {
                const combinedMap = new Map();
                const initialProducts = Array.isArray(baseProducts) ? baseProducts : [];
                initialProducts.forEach(prod => {
                    if (prod && prod._id !== undefined && prod._id !== null) {
                        combinedMap.set(prod._id, prod);
                    }
                });
                
                const finalize = () => {
                    callback(Array.from(combinedMap.values()));
                };
                
                const addExpiredProducts = (products, sourceLabel) => {
                    if (!Array.isArray(products)) {
                        console.warn(`Expiry augmentation skipped (${sourceLabel} returned non-array)`);
                        finalize();
            return;
        }
        
                    let additions = 0;
                    products.forEach(prod => {
                        if (!prod || prod._id === undefined || prod._id === null) {
                            return;
                        }
                        if (combinedMap.has(prod._id)) {
                            return;
                        }
                        
                        const expiryValue = prod.expiryDate || prod.expirationDate ||
                            (prod.batchSummary && prod.batchSummary.earliestExpiry) || null;
                        if (!expiryValue) {
                            return;
                        }
                        
                        const expiryDate = new Date(expiryValue);
                        if (Number.isNaN(expiryDate.getTime())) {
                            return;
                        }
                        
                        if (expiryDate <= expiryCutoff) {
                            combinedMap.set(prod._id, prod);
                            additions++;
                        }
                    });
                    
                    console.log(`Expiry augmentation (${sourceLabel}) added ${additions} products`);
                    finalize();
                };
                
                const inMemoryData = getInventorySnapshot();
                if (Array.isArray(inMemoryData) && inMemoryData.length) {
                    console.log(`Expiry augmentation using in-memory dataset of ${inMemoryData.length} products`);
                    addExpiredProducts(inMemoryData, 'memory');
                    return;
                }
                
                console.log('Expiry augmentation fallback query running (fetching all products)');
                inventoryDB.find({})
                    .limit(1000)
                    .exec(function (expiryErr, allProducts) {
                        if (expiryErr) {
                            console.error('Failed to fetch products for expiry augmentation:', expiryErr);
                            finalize();
                            return;
                        }
                        
                        addExpiredProducts(allProducts, 'query');
                    });
            }
            
            function processProducts(candidateProducts, existingPOs = []) {
                const productsInExistingPOs = new Set();
                if (existingPOs && Array.isArray(existingPOs)) {
                    existingPOs.forEach(po => {
                        if (po.items && Array.isArray(po.items)) {
                            po.items.forEach(item => {
                                if (item.productId) {
                                    productsInExistingPOs.add(item.productId);
                                    if (typeof item.productId === 'number') {
                                        productsInExistingPOs.add(String(item.productId));
                                    } else if (typeof item.productId === 'string') {
                                        const numId = parseInt(item.productId, 10);
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
            
                const itemsNeedingReorder = candidateProducts.filter(item => {
                    if (productsInExistingPOs.has(item._id) || 
                        productsInExistingPOs.has(String(item._id)) ||
                        productsInExistingPOs.has(parseInt(item._id, 10))) {
                        return false;
                    }
                    
                    const currentStock = Number(item.quantity || item.stock || 0);
                    const reorderPoint = Number(item.reorderPoint || item.minStock || 0);
                    const expiryDateValue = item.expiryDate || item.expirationDate || (item.batchSummary && item.batchSummary.earliestExpiry) || null;
                    
                    let hasExpiredItems = false;
                    if (expiryDateValue) {
                        const expiryDate = new Date(expiryDateValue);
                        if (!Number.isNaN(expiryDate.getTime())) {
                            const today = new Date();
                            const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                            if (daysUntilExpiry <= expiryAlertDaysNumber) {
                                hasExpiredItems = true;
                            }
                        }
                    }
                    
                    const needsReorder = (currentStock <= threshold) || 
                                        (currentStock <= reorderPoint && reorderPoint > 0) || 
                                        (currentStock === 0) ||
                                        hasExpiredItems;
                    
                    return needsReorder;
                });
            
                console.log(`Found ${itemsNeedingReorder.length} items needing reorder`);
            
                const hardcodedSuppliers = [
                    { _id: 1761170223, name: 'HealthPlus Wholesale' },
                    { _id: 1761170451, name: 'MediSuppliers Ltd' },
                    { _id: 1761170580, name: 'Global Pharma Distributors' }
                ];
            
                sendResponse({
                    success: true,
                    message: `Found ${itemsNeedingReorder.length} products needing reorder`,
                    products: itemsNeedingReorder.map(item => {
                        const expiryDateValue = item.expiryDate || item.expirationDate || (item.batchSummary && item.batchSummary.earliestExpiry) || null;
                        return {
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
                                if (expiryDateValue) {
                                    const expiryDate = new Date(expiryDateValue);
                                    if (!Number.isNaN(expiryDate.getTime())) {
                                        const today = new Date();
                                        const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                                        if (daysUntilExpiry <= expiryAlertDaysNumber) return 'expired/expiring';
                                    }
                                }
                                if (currentStock === 0) return 'out of stock';
                                if (currentStock <= reorderPoint) return 'below reorder point';
                                return 'below threshold';
                            })(),
                            expiryDate: expiryDateValue
                        };
                    }),
                    suppliers: hardcodedSuppliers
                });
            }
            
            let queryTimeout = null;
            
            function handleInventoryFallback(reason) {
                if (responseSent) {
                    return;
                }
                
                console.warn(`${reason} - attempting inventory fallback`);
                clearTimeout(fallbackTimer);
                if (queryTimeout) {
                    clearTimeout(queryTimeout);
                    queryTimeout = null;
                }
                
            const inMemoryFallback = getInventorySnapshot();
                if (Array.isArray(inMemoryFallback) && inMemoryFallback.length) {
                    console.log(`Fallback using in-memory inventory dataset of ${inMemoryFallback.length} products`);
                    collectExpiredProducts(inMemoryFallback, function (augmentedProducts) {
                        // Check for existing POs to exclude their products
                        const today = moment().startOf('day').toDate();
                        const tomorrow = moment().add(1, 'day').startOf('day').toDate();
                        
                        purchaseOrdersDB.find({ 
                            status: { $in: ['draft', 'sent'] },
                            $or: [
                                { createdAt: { $gte: today, $lt: tomorrow } },
                                { expectedDeliveryDate: { $gte: today, $lt: tomorrow } }
                            ]
                        })
                            .limit(100)
                            .exec(function (err, existingPOs) {
                                if (err || !existingPOs) {
                                    processProducts(augmentedProducts, []);
                                } else {
                                    console.log(`Fallback: Found ${existingPOs.length} existing POs - excluding their products`);
                                    processProducts(augmentedProducts, existingPOs);
                                }
                            });
                    });
                    return;
                }
                
                const dbFilePath = inventoryDB.filename;
                if (dbFilePath) {
                    try {
                        const fs = require('fs');
                        if (fs.existsSync(dbFilePath)) {
                            const fileContent = fs.readFileSync(dbFilePath, 'utf8');
                            const lines = fileContent.split('\n').filter(line => line.trim());
                            const latestById = new Map();
                            lines.forEach(line => {
                                try {
                                    const record = JSON.parse(line);
                                    if (record && record._id !== undefined && record._id !== null) {
                                        latestById.set(record._id, record);
                                    }
                                } catch (parseErr) {
                                    // Ignore malformed lines
                                }
                            });
                            const fallbackProducts = Array.from(latestById.values());
                            console.log(`Fallback using inventory file returned ${fallbackProducts.length} products`);
                            if (fallbackProducts.length) {
                                collectExpiredProducts(fallbackProducts, function (augmentedProducts) {
                                    // Check for existing POs to exclude their products
                                    const today = moment().startOf('day').toDate();
                                    const tomorrow = moment().add(1, 'day').startOf('day').toDate();
                                    
                                    purchaseOrdersDB.find({ 
                                        status: { $in: ['draft', 'sent'] },
                                        $or: [
                                            { createdAt: { $gte: today, $lt: tomorrow } },
                                            { expectedDeliveryDate: { $gte: today, $lt: tomorrow } }
                                        ]
                                    })
                                        .limit(100)
                                        .exec(function (err, existingPOs) {
                                            if (err || !existingPOs) {
                                                processProducts(augmentedProducts, []);
                                            } else {
                                                console.log(`Fallback: Found ${existingPOs.length} existing POs - excluding their products`);
                                                processProducts(augmentedProducts, existingPOs);
                                            }
                                        });
                                });
                                return;
                            }
                        } else {
                            console.warn(`Inventory DB file does not exist at ${dbFilePath}`);
                        }
                    } catch (fileErr) {
                        console.error('Inventory file fallback failed:', fileErr);
                    }
                } else {
                    console.warn('Inventory DB filename unavailable for fallback');
                }
                
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
            
            console.log(`Executing auto-draft query (DB ready: ${inventoryDBReady}, attempts: ${attempts})`);
            console.log('Query selector:', JSON.stringify(selector));
            const queryStartTime = Date.now();
            
            const inMemoryInventory = getInventorySnapshot();
            if (Array.isArray(inMemoryInventory) && inMemoryInventory.length) {
                console.log(`Using in-memory inventory dataset of ${inMemoryInventory.length} products for auto-draft`);
                clearTimeout(fallbackTimer);
                collectExpiredProducts(inMemoryInventory, function (augmentedProducts) {
                    // Check for existing POs to exclude their products
                    const today = moment().startOf('day').toDate();
                    const tomorrow = moment().add(1, 'day').startOf('day').toDate();
                    
                    purchaseOrdersDB.find({ 
                        status: { $in: ['draft', 'sent'] },
                        $or: [
                            { createdAt: { $gte: today, $lt: tomorrow } },
                            { expectedDeliveryDate: { $gte: today, $lt: tomorrow } }
                        ]
                    })
                        .limit(100)
                        .exec(function (err, existingPOs) {
                            if (err || !existingPOs) {
                                processProducts(augmentedProducts, []);
                            } else {
                                console.log(`In-memory path: Found ${existingPOs.length} existing POs - excluding their products`);
                                processProducts(augmentedProducts, existingPOs);
                            }
                        });
                });
                return;
            }
            
            // Add query timeout - reduced for faster response
            queryTimeout = setTimeout(() => {
                if (!responseSent) {
                    handleInventoryFallback('⏱️ Inventory query timeout');
                }
            }, 3000); // 3 second timeout for inventory query (reduced from 4s)
            
            // Find candidate products (smaller subset) - use smaller limit for faster queries
            inventoryDB.find(selector)
                .limit(200) // Reduced limit for faster queries (from 500)
                .exec(function (err, candidateProducts) {
                if (queryTimeout) {
                    clearTimeout(queryTimeout);
                    queryTimeout = null;
                }
                
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
                
                // Clear fallback timer since query succeeded
                clearTimeout(fallbackTimer);
                
                // Augment the initial candidate list with any products that only qualify due to expiry/expiry alerts.
                collectExpiredProducts(candidateProducts, function (augmentedProducts) {
                    console.log(`After expiry augmentation, ${augmentedProducts.length} candidate products will be processed`);
                    
                    // Check for existing draft/sent POs created today or with expected delivery today
                    // This prevents showing products that already have POs on the same date
                    const today = moment().startOf('day').toDate();
                    const tomorrow = moment().add(1, 'day').startOf('day').toDate();
                    
                    const poQueryTimeout = setTimeout(() => {
                        console.warn('⏱️ Purchase orders query timeout - proceeding without PO exclusion');
                        processProducts(augmentedProducts, []);
                    }, 2000); // 2 second timeout for PO query
                    
                    purchaseOrdersDB.find({ 
                        status: { $in: ['draft', 'sent'] },
                        $or: [
                            { createdAt: { $gte: today, $lt: tomorrow } },
                            { expectedDeliveryDate: { $gte: today, $lt: tomorrow } }
                        ]
                    })
                        .limit(100) // Limit to recent POs for performance
                        .exec(function (err, existingPOs) {
                        clearTimeout(poQueryTimeout);
                        if (err || !existingPOs) {
                            console.warn('⚠️ Error or no existing POs found - proceeding without PO exclusion');
                            processProducts(augmentedProducts, []);
                        } else {
                            console.log(`Found ${existingPOs.length} existing draft/sent POs for today - excluding their products from auto-draft`);
                            processProducts(augmentedProducts, existingPOs);
                        }
                    });
                });
                
                }); // Close inventoryDB.find callback
            } else {
                // Wait 50ms before retrying (max 150ms total wait)
                if (attempts < 3) {
                    setTimeout(() => waitForDB(attempts + 1), 50);
                } else {
                    // If DB still not ready after 150ms, proceed anyway
                    console.warn('⚠️ Database not ready after 150ms, proceeding with query anyway');
                    waitForDB(3); // Force proceed
                }
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
    
    // Response guard to prevent duplicate responses
    let responseSent = false;
    const sendResponse = (data, statusCode = 200) => {
        if (responseSent) {
            console.warn('⚠️ Response already sent, ignoring duplicate');
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
    
    // Track created orders and existing orders (declare early for timeout handler)
    const createdOrders = [];
    const existingOrders = [];
    
    // Overall timeout - if operation takes too long, return partial results
    const overallTimeout = setTimeout(() => {
        if (!responseSent) {
            console.warn('⏱️ Auto-draft PO creation timeout - returning partial results');
            sendResponse({
                success: false,
                message: "Operation timed out. Some purchase orders may not have been created.",
                orders: createdOrders || [],
                existingOrders: existingOrders || []
            });
        }
    }, 45000); // 45 second overall timeout
    
    // Group assignments by supplier
    const assignmentsBySupplier = {};
    assignments.forEach(assignment => {
        if (!assignmentsBySupplier[assignment.supplierId]) {
            assignmentsBySupplier[assignment.supplierId] = [];
        }
        assignmentsBySupplier[assignment.supplierId].push(assignment);
    });
    
    console.log('Grouped assignments by supplier:', Object.keys(assignmentsBySupplier));
    
    // Wait for suppliers database to be ready first, then query
    const waitForSuppliersDB = (attempts = 0) => {
        // Suppliers DB should be ready by now, but give it a moment
        if (attempts >= 10) {
            // Proceed anyway after 1 second
            querySuppliers();
            return;
        }
        
        // Check if suppliersDB is ready by trying a quick count
        suppliersDB.count({}, function(err, count) {
            if (!err && count !== undefined) {
                // DB is ready
                querySuppliers();
            } else {
                // Wait a bit more
                setTimeout(() => waitForSuppliersDB(attempts + 1), 100);
            }
        });
    };
    
    function querySuppliers() {
        const suppliersTimeout = setTimeout(() => {
            if (!responseSent) {
                console.warn('⏱️ Suppliers query timeout - returning error');
                clearTimeout(overallTimeout);
                sendResponse({
                    success: false,
                    message: "Suppliers query timed out. Please try again."
                }, 500);
            }
        }, 5000); // 5 second timeout for suppliers query
        
        console.log('Querying suppliers database...');
        suppliersDB.find({})
            .limit(100) // Limit results
            .exec(function (err, suppliers) {
            clearTimeout(suppliersTimeout);
        
        if (responseSent) {
            return;
        }
        
            if (err) {
            console.error("Error fetching suppliers:", err);
            clearTimeout(overallTimeout);
            sendResponse({
                success: false,
                message: "Failed to fetch suppliers data"
            }, 500);
                return;
            }
            
        if (!suppliers || !Array.isArray(suppliers) || suppliers.length === 0) {
            console.error("No suppliers found in database");
            clearTimeout(overallTimeout);
            sendResponse({
                success: false,
                message: "No suppliers found in database"
            }, 500);
            return;
        }
        
        const supplierMap = {};
        suppliers.forEach(supplier => {
            supplierMap[supplier._id] = supplier;
            // Also map string/number variations for compatibility
            if (typeof supplier._id === 'number') {
                supplierMap[String(supplier._id)] = supplier;
            } else if (typeof supplier._id === 'string') {
                const numId = parseInt(supplier._id);
                if (!isNaN(numId)) {
                    supplierMap[numId] = supplier;
                }
            }
        });
        
        console.log(`✅ Loaded ${suppliers.length} suppliers into map`);
        console.log('Supplier map keys:', Object.keys(supplierMap).slice(0, 5)); // Log first 5 for debugging
        processSuppliers(supplierMap);
        });
    }
    
    waitForSuppliersDB();
    
    function processSuppliers(supplierMap) {
        // Add a hard timeout for DB readiness check - force proceed after 2 seconds
        let dbReadyCallbackCalled = false;
        const dbReadyTimeout = setTimeout(() => {
            if (!dbReadyCallbackCalled && !responseSent) {
                console.warn('⏱️ Purchase orders DB readiness check timed out - proceeding anyway');
                // Force proceed even if DB not marked ready
                purchaseOrdersDBReady = true;
                processSuppliersInternal(supplierMap);
            }
        }, 2000); // 2 second max wait for DB readiness

        waitForPurchaseOrdersDB(0, () => {
            if (dbReadyCallbackCalled) {
                return; // Already processed via timeout
            }
            dbReadyCallbackCalled = true;
            clearTimeout(dbReadyTimeout);
            processSuppliersInternal(supplierMap);
        });

        function processSuppliersInternal(supplierMap) {
            if (responseSent) {
                console.warn('⚠️ Response already sent before processing suppliers - aborting supplier processing');
                return;
            }
            
            // First, filter out suppliers with no valid assignments (quantity > 0)
            const validSupplierIds = [];
            Object.keys(assignmentsBySupplier).forEach(supplierId => {
                const assignments = assignmentsBySupplier[supplierId] || [];
                const hasValidAssignment = assignments.some(a => a && a.quantity > 0 && a.supplierId);
                if (hasValidAssignment) {
                    validSupplierIds.push(supplierId);
                }
            });

            if (validSupplierIds.length === 0) {
                clearTimeout(overallTimeout);
                sendResponse({
                    success: false,
                    message: "No valid assignments found (all quantities are zero or missing supplierId)"
                });
                return;
            }

            console.log(`Filtered to ${validSupplierIds.length} suppliers with valid assignments out of ${Object.keys(assignmentsBySupplier).length} total`);

            // Get inventory snapshot with timeout protection
            let inventorySnapshot = [];
            try {
                const snapshotStart = Date.now();
                inventorySnapshot = getInventorySnapshot();
                const snapshotDuration = Date.now() - snapshotStart;
                console.log(`Inventory snapshot retrieved in ${snapshotDuration}ms`);
            } catch (snapshotErr) {
                console.error('⚠️ Error getting inventory snapshot:', snapshotErr.message || snapshotErr);
                clearTimeout(overallTimeout);
                sendResponse({
                    success: false,
                    message: `Failed to load inventory data: ${snapshotErr.message || 'Unknown error'}`
                }, 500);
            return;
        }
            const productSnapshotMap = {};
            inventorySnapshot.forEach(product => {
                if (!product || product._id === undefined || product._id === null) {
                    return;
                }
                productSnapshotMap[product._id] = product;
                if (typeof product._id === 'number') {
                    productSnapshotMap[String(product._id)] = product;
                } else if (typeof product._id === 'string') {
                    const numId = parseInt(product._id);
                    if (!isNaN(numId)) {
                        productSnapshotMap[numId] = product;
                    }
                }
            });
            console.log(`Inventory snapshot loaded with ${inventorySnapshot.length} products (unique keys: ${Object.keys(productSnapshotMap).length})`);

            const failedSuppliers = [];

            const processSuppliersConcurrently = async () => {
                const supplierPromises = validSupplierIds.map(supplierId => (async () => {
                    if (responseSent) {
                        return;
                    }

                    let supplier = supplierMap[supplierId] || supplierMap[String(supplierId)];
                    if (!supplier) {
                        const numId = typeof supplierId === 'string' ? parseInt(supplierId, 10) : supplierId;
                        supplier = supplierMap[numId];
                    }

                    if (!supplier) {
                        console.error(`Supplier not found for ID: ${supplierId}. Available supplier IDs:`, Object.keys(supplierMap));
                        failedSuppliers.push({ supplierId, reason: 'Supplier not found in database' });
            return;
        }
        
                    console.log(`✅ Processing supplier ${supplier.name} (ID: ${supplier._id})`);
                    const supplierAssignments = assignmentsBySupplier[supplierId] || [];
                    const productsForSupplier = supplierAssignments
                        .map(assignment => {
                            let product = productSnapshotMap[assignment.productId];
                            if (!product) {
                                product = productSnapshotMap[String(assignment.productId)];
                            }
                            if (!product) {
                                const numId = typeof assignment.productId === 'string' ? parseInt(assignment.productId, 10) : assignment.productId;
                                product = productSnapshotMap[numId];
                            }
                            if (!product) {
                                console.warn(`Product ${assignment.productId} not found in snapshot for supplier ${supplier.name}`);
                            }
                            return product;
                        })
                        .filter(Boolean);

                    if (!productsForSupplier.length) {
                        console.warn(`⚠️ No matching products found for supplier ${supplier.name} (ID: ${supplier._id}) - skipping`);
                        failedSuppliers.push({ supplierId, supplierName: supplier.name, reason: 'No matching products found in snapshot' });
                        return;
                    }

                    const productMap = {};
                    productsForSupplier.forEach(product => {
                        productMap[product._id] = product;
                        if (typeof product._id === 'number') {
                            productMap[String(product._id)] = product;
                        } else if (typeof product._id === 'string') {
                            const numId = parseInt(product._id, 10);
                            if (!isNaN(numId)) {
                                productMap[numId] = product;
                            }
                        }
                    });

                    const orderItems = supplierAssignments
                        .map(assignment => {
                            if (!assignment || assignment.quantity <= 0) {
                                return null;
                            }

                            let product = productMap[assignment.productId] || productMap[String(assignment.productId)];
                            if (!product) {
                                const numId = typeof assignment.productId === 'string' ? parseInt(assignment.productId, 10) : assignment.productId;
                                product = productMap[numId];
                            }

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
                        })
                        .filter(Boolean);

                    if (!orderItems.length) {
                        console.warn(`⚠️ Supplier ${supplier.name} has no valid items after filtering. Skipping PO creation for this supplier.`);
            return;
        }
        
                    // Check for existing PO with same products on same date (regardless of supplier)
                    const today = moment().startOf('day').toDate();
                    const tomorrow = moment().add(1, 'day').startOf('day').toDate();
                    const productIdsInOrder = orderItems.map(item => item.productId);
                    
                    const existingPOCheck = await new Promise(resolve => {
                        let settled = false;
                        const checkTimeout = setTimeout(() => {
                            if (settled) return;
                            settled = true;
                            console.warn('⏱️ Existing PO check timed out - proceeding with new PO creation');
                            resolve(null);
                        }, 3000); // 3 second timeout for check

                        // Check for any PO with matching products on same date, regardless of supplier
                        purchaseOrdersDB.find({
                            status: { $in: ['draft', 'sent'] },
                            $or: [
                                { createdAt: { $gte: today, $lt: tomorrow } },
                                { expectedDeliveryDate: { $gte: today, $lt: tomorrow } }
                            ]
                        }, (err, existingPOs) => {
                            if (settled) return;
                            settled = true;
                            clearTimeout(checkTimeout);
                            
                            if (err) {
                                console.warn('⚠️ Error checking for existing POs:', err.message);
                                resolve(null);
                                return;
                            }
                            
                            if (!existingPOs || existingPOs.length === 0) {
                                resolve(null);
                                return;
                            }
                            
                            // Check if any existing PO has matching products (regardless of supplier)
                            for (const existingPO of existingPOs) {
                                if (!existingPO.items || !Array.isArray(existingPO.items)) {
                                    continue;
                                }
                                
                                const existingProductIds = existingPO.items.map(item => item.productId);
                                const hasMatchingProduct = productIdsInOrder.some(pid => 
                                    existingProductIds.some(epid => 
                                        pid === epid || 
                                        String(pid) === String(epid) ||
                                        Number(pid) === Number(epid)
                                    )
                                );
                                
                                if (hasMatchingProduct) {
                                    console.log(`ℹ️ Found existing PO ${existingPO.poNumber} (ID: ${existingPO._id}) for supplier ${existingPO.supplierName || 'Unknown'} with matching products on same date`);
                                    console.log(`   - Product(s) already in PO: ${productIdsInOrder.filter(pid => 
                                        existingProductIds.some(epid => 
                                            pid === epid || String(pid) === String(epid) || Number(pid) === Number(epid)
                                        )
                                    ).join(', ')}`);
                                    resolve(existingPO);
                                    return;
                                }
                            }
                            
                            resolve(null);
                        });
                    });

                    if (existingPOCheck) {
                        console.log(`⏭️ Skipping PO creation - existing PO ${existingPOCheck.poNumber} (supplier: ${existingPOCheck.supplierName || 'Unknown'}) already exists for these products on this date`);
                        existingOrders.push(existingPOCheck);
                        return;
                    }
        
                    const totalAmount = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);
                    const totalItems = orderItems.reduce((sum, item) => sum + item.quantity, 0);

                    const purchaseOrder = {
                        _id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000),
                        poNumber: generatePONumber(),
                        supplierId: parseInt(supplierId, 10),
                        supplierName: supplier.name,
                        status: 'draft',
                        items: orderItems,
                        subtotal: totalAmount,
                        tax: 0,
                        discount: 0,
                        total: totalAmount,
                        totalItems: totalItems,
                        notes: `Auto-generated from manual supplier assignment. Generated on ${moment().format('DD-MMM-YYYY HH:mm')}`,
                        expectedDeliveryDate: moment().add(1, 'day').toDate(),
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        createdBy: 'system',
                        sentAt: null,
                        receivedAt: null,
                        completedAt: null
                    };

                    console.log(`Attempting to save PO ${purchaseOrder.poNumber} for supplier ${supplier.name} with ${orderItems.length} items`);
                    const insertStart = Date.now();
                    const insertResult = await new Promise(resolve => {
                        let settled = false;
                        const timeoutMs = 8000; // Reduced from 15s to 8s for faster failure
                        const timeout = setTimeout(() => {
                            if (settled) {
                                return;
                            }
                            settled = true;
                            console.warn(`⏱️ purchaseOrdersDB.insert timed out after ${timeoutMs}ms for supplier ${supplier.name} (ID: ${supplier._id})`);
                            console.warn(`   - PO Number: ${purchaseOrder.poNumber}`);
                            console.warn(`   - Items count: ${orderItems.length}`);
                            resolve({ error: new Error(`Insert timed out after ${timeoutMs}ms`) });
                        }, timeoutMs);

                        purchaseOrdersDB.insert(purchaseOrder, (err, savedDoc) => {
                            if (settled) {
                                return;
                            }
                            settled = true;
                            clearTimeout(timeout);
                if (err) {
                                resolve({ error: err });
                } else {
                                resolve({ result: savedDoc });
                            }
                        });
                    });

                    if (insertResult && insertResult.result) {
                        const savedOrder = insertResult.result;
                        const duration = Date.now() - insertStart;
                        console.log(`✅ Created purchase order ${savedOrder.poNumber} (ID: ${savedOrder._id}) for supplier ${supplier.name} in ${duration}ms`);
                        console.log(`   - Total: $${savedOrder.total}`);
                        console.log(`   - Items: ${savedOrder.items.length}`);
                        createdOrders.push(savedOrder);
                    } else if (insertResult && insertResult.error) {
                        const err = insertResult.error;
                        console.error(`❌ Error creating purchase order for supplier ${supplier.name}:`, err);
                        failedSuppliers.push({ supplierId, supplierName: supplier.name, reason: err?.message || 'Insert failed' });
                    }
                })());

                await Promise.allSettled(supplierPromises);

                if (responseSent) {
                    return;
                }

                clearTimeout(overallTimeout);

                if (createdOrders.length === 0 && existingOrders.length === 0) {
                    const primaryReason = failedSuppliers[0]?.reason || 'Operation timed out while creating purchase orders.';
                    sendResponse({
                        success: false,
                        message: primaryReason,
                        orders: createdOrders,
                        existingOrders: existingOrders,
                        failures: failedSuppliers
                    });
                    return;
                }

                let message = '';
                if (createdOrders.length > 0) {
                    message = `Created ${createdOrders.length} purchase order${createdOrders.length === 1 ? '' : 's'}`;
                }
                if (existingOrders.length > 0) {
                    if (message) message += '. ';
                    message += `Skipped ${existingOrders.length} existing purchase order${existingOrders.length === 1 ? '' : 's'} (already exists for same products on same date)`;
                }
                if (failedSuppliers.length) {
                    if (message) message += '. ';
                    message += `${failedSuppliers.length} supplier(s) failed.`;
                }
                if (!message) {
                    message = 'No purchase orders were created.';
                }

                sendResponse({
                    success: failedSuppliers.length === 0,
                    message,
                    orders: createdOrders,
                    existingOrders: existingOrders,
                    failures: failedSuppliers
                });
            };

            // Add timeout wrapper around concurrent processing (30s max)
            const processingTimeout = setTimeout(() => {
                if (!responseSent) {
                    console.warn('⏱️ Supplier processing timed out after 30s - returning partial results');
                    clearTimeout(overallTimeout);
                    let timeoutMessage = '';
                    if (createdOrders.length > 0) {
                        timeoutMessage = `Created ${createdOrders.length} purchase order(s) before timeout.`;
                    }
                    if (existingOrders.length > 0) {
                        if (timeoutMessage) timeoutMessage += ' ';
                        timeoutMessage += `Skipped ${existingOrders.length} existing order(s).`;
                    }
                    if (!timeoutMessage) {
                        timeoutMessage = 'Processing timed out. No purchase orders were created.';
                    } else {
                        timeoutMessage += ' Some may have failed.';
                    }
                    sendResponse({
                        success: createdOrders.length > 0,
                        message: timeoutMessage,
                        orders: createdOrders,
                        existingOrders: existingOrders,
                        failures: failedSuppliers
                    });
                }
            }, 30000); // 30 second timeout for processing

            processSuppliersConcurrently()
                .then(() => {
                    clearTimeout(processingTimeout);
                })
                .catch(err => {
                    clearTimeout(processingTimeout);
                    if (responseSent) {
                        return;
                    }
                    console.error('❌ Unexpected error while processing suppliers:', err);
                    clearTimeout(overallTimeout);
                    sendResponse({
                        success: false,
                        message: err?.message || 'Unexpected error occurred while creating purchase orders.',
                        orders: createdOrders,
                        existingOrders: existingOrders,
                        failures: failedSuppliers
                    });
                });
        } // End of processSuppliersInternal
    } // End of processSuppliers
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
