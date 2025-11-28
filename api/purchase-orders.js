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
                    // Apply batchSummary enhancement to match products API behavior
                    const enhancedData = fileData.map(product => {
                        // Use batchSummary.totalQuantity if available, otherwise use quantity
                        if (product.batchSummary && 
                            typeof product.batchSummary.totalQuantity === 'number' && 
                            product.batchSummary.totalQuantity >= 0) {
                            product.quantity = product.batchSummary.totalQuantity;
                        }
                        return product;
                    });
                    return enhancedData;
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
 * Ensure the product record's quantity and batchSummary match the latest batches that were just read.
 * This is invoked by the batches endpoint so the UI list (which reads from /products) stays in sync
 * with the batches shown in the "Product Batches & Barcodes" modal.
 * 
 * CRITICAL: This function should NEVER set a product to 0 if it currently has stock.
 * Products may have "legacy stock" (without batch records) or batches may not be found due to timing issues.
 */
function syncProductQuantityWithBatches(productId, batches, sourceLabel = 'batches endpoint') {
    const numericId = parseInt(productId, 10);
    if (Number.isNaN(numericId)) {
        return;
    }

    const sanitizedBatches = Array.isArray(batches) ? batches : [];
    const totalQuantity = sanitizedBatches.reduce((sum, batch) => {
        return sum + Number(batch && batch.quantity ? batch.quantity : 0);
    }, 0);

    // CRITICAL: Do NOT sync if no batches found - this would erase legitimate stock
    // Products may have "legacy stock" (from bulk import) or batches may be temporarily unavailable
    if (totalQuantity === 0) {
        console.log(`[Batches Sync] Skipping sync for product ${numericId} - no batches found (preserving existing stock)`);
        return;
    }

    // Compute earliest non-expired expiry date for metadata
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const earliestExpiryDate = sanitizedBatches
        .map(batch => batch && batch.expiryDate ? new Date(batch.expiryDate) : null)
        .filter(date => date && !Number.isNaN(date.getTime()) && date >= today)
        .sort((a, b) => a - b)[0];
    const earliestExpiry = earliestExpiryDate ? earliestExpiryDate.toISOString().slice(0, 10) : null;

    process.nextTick(() => {
        inventoryDB.findOne({ _id: numericId }, (findErr, product) => {
            if (findErr || !product) {
                if (findErr) {
                    console.warn(`[Batches Sync] Failed to find product ${numericId}:`, findErr.message || findErr);
                }
                return;
            }

            const currentQuantity = Number(product.quantity || 0);
            const currentSummaryQty = Number(
                product.batchSummary && typeof product.batchSummary.totalQuantity === 'number'
                    ? product.batchSummary.totalQuantity
                    : 0
            );

            if (currentQuantity === totalQuantity && currentSummaryQty === totalQuantity) {
                return; // Already in sync
            }

            const updateFields = {
                quantity: totalQuantity,
                updatedAt: new Date(),
                batchSummary: {
                    totalQuantity,
                    batchCount: sanitizedBatches.length,
                    earliestExpiry
                }
            };

            if (totalQuantity > 0) {
                updateFields.stock = 1;
                updateFields.lastReceived = new Date();
                updateFields.receivedDate = new Date().toISOString().slice(0, 10);
                if (earliestExpiry) {
                    updateFields.expirationDate = earliestExpiry;
                    updateFields.expiryDate = earliestExpiry;
                }
            }
            // REMOVED: Do NOT set stock=0 when totalQuantity is 0 (already handled above)

            inventoryDB.update({ _id: numericId }, { $set: updateFields }, {}, (updateErr) => {
                if (updateErr) {
                    console.error(`[Batches Sync] Failed to update product ${numericId}:`, updateErr);
                    return;
                }
                console.log(`[Batches Sync] Updated product ${numericId} to quantity=${totalQuantity} (source: ${sourceLabel})`);
                try {
                    inventoryDB.persistence.compactDatafile();
                } catch (persistErr) {
                    console.warn('[Batches Sync] Persistence warning:', persistErr.message);
                }
            });
        });
    });
}

/**
 * GET batches by productId
 */
app.get("/batches/by-product/:productId", function (req, res) {
    const rawProductId = req.params.productId;
    const productId = parseInt(rawProductId);
    
    console.log(`\n=== BATCHES QUERY REQUEST ===`);
    console.log(`Raw productId from URL: ${rawProductId} (type: ${typeof rawProductId})`);
    console.log(`Parsed productId: ${productId} (type: ${typeof productId}, isNaN: ${isNaN(productId)})`);
    console.log(`Request timestamp: ${new Date().toISOString()}`);
    
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
                console.log(`   Database file path: ${dbFilePath}`);
                
                try {
                    const fs = require('fs');
                    if (!fs.existsSync(dbFilePath)) {
                        console.error(`❌ Batch database file does not exist: ${dbFilePath}`);
                        clearTimeout(timeoutTimer);
                        sendResponse({ success: true, batches: [] });
                        return;
                    }
                    
                    const fileStats = fs.statSync(dbFilePath);
                    console.log(`   File exists, size: ${fileStats.size} bytes`);
                    
                    const fileContent = fs.readFileSync(dbFilePath, 'utf8');
                    const lines = fileContent.split('\n').filter(l => l.trim());
                    console.log(`   File contains ${lines.length} lines`);
                    
                    const latestById = new Map();
                    const batchesByKey = new Map(); // Fallback for batches without _id
                    let parsedCount = 0;
                    let skippedCount = 0;
                    lines.forEach((line, lineIndex) => {
                        try {
                            const batch = JSON.parse(line);
                            if (batch && batch.productId) {
                                // Use _id if available, otherwise create a key from productId+lotNumber+barcode
                                if (batch._id) {
                                    latestById.set(batch._id, batch);
                                } else {
                                    // Fallback: use a composite key for batches without _id
                                    const key = `${batch.productId}_${batch.lotNumber || ''}_${batch.barcode || ''}`;
                                    if (!batchesByKey.has(key)) {
                                        batchesByKey.set(key, batch);
                                    } else {
                                        // Merge quantities if duplicate key
                                        const existing = batchesByKey.get(key);
                                        existing.quantity = (Number(existing.quantity || 0) + Number(batch.quantity || 0));
                                    }
                                }
                                parsedCount++;
                            } else {
                                skippedCount++;
                                if (lineIndex < 5) {
                                    console.log(`   ⚠️ Line ${lineIndex + 1} missing productId:`, batch ? Object.keys(batch) : 'null/undefined');
                                }
                            }
                        } catch (e) {
                            skippedCount++;
                            if (lineIndex < 5) {
                                console.log(`   ⚠️ Line ${lineIndex + 1} JSON parse error:`, e.message, 'Line content:', line.substring(0, 100));
                            }
                        }
                    });
                    console.log(`   Parsed ${parsedCount} batches (${latestById.size} with _id, ${batchesByKey.size} without _id), skipped ${skippedCount} lines`);
                    
                    // Combine batches with _id and batches without _id
                    const allBatchesFromFile = Array.from(latestById.values()).concat(Array.from(batchesByKey.values()));
                    console.log(`   Total batches in file (after dedup): ${allBatchesFromFile.length}`);
                    if (allBatchesFromFile.length > 0) {
                        console.log(`   Sample batch productIds: ${allBatchesFromFile.slice(0, 5).map(b => `${b.productId} (type: ${typeof b.productId})`).join(', ')}`);
                    }
                    
                    const batches = allBatchesFromFile.filter(batch => {
                        if (!batch || !batch.productId) {
                            console.log(`   ⚠️ Batch missing productId:`, batch);
                            return false;
                        }
                        // CRITICAL: Filter out batches with quantity <= 0 (removed/empty batches)
                        // These batches should not be shown even if they exist in the file (stale data)
                        const batchQuantity = Number(batch.quantity || 0);
                        if (batchQuantity <= 0) {
                            return false; // Skip empty/removed batches
                        }
                        // Normalize both sides for comparison
                        const batchProductId = typeof batch.productId === 'number' ? batch.productId : parseInt(batch.productId, 10);
                        const matches = !Number.isNaN(batchProductId) && batchProductId === numProductId;
                        if (!matches && allBatchesFromFile.length <= 10) {
                            console.log(`   ⚠️ Batch ${batch._id} productId mismatch: batch=${batchProductId} (${typeof batch.productId}), query=${numProductId} (${typeof numProductId})`);
                        }
                        return matches;
                    });
                    console.log(`   File parsing found ${batches.length} matching batches after dedup by _id (querying for productId: ${numProductId})`);
                    
                    if (batches.length === 0 && allBatchesFromFile.length > 0) {
                        console.warn(`   ⚠️ No matches found! Query productId: ${numProductId}, Available productIds in file: ${[...new Set(allBatchesFromFile.map(b => b.productId))].slice(0, 10).join(', ')}`);
                    }
                    
                    // If no batches found, check if product has quantity - might be legacy stock without batches
                    if (batches.length === 0) {
                        console.log(`   ℹ️ No batches found for productId ${numProductId} - checking if product has quantity (legacy stock)...`);
                        // Try to get product to check if it has quantity
                        inventoryDB.findOne({ _id: numProductId }, function (prodErr, product) {
                            if (!prodErr && product && Number(product.quantity || 0) > 0) {
                                const legacyQuantity = Number(product.quantity || 0);
                                console.log(`   ℹ️ Product has ${legacyQuantity} units but no batches - this is legacy stock`);
                                // Don't create a batch automatically, but log it for debugging
                                // The user should receive items through PO to create proper batches
                            }
                        });
                    }
                    
                    const sortedBatches = batches.sort((a, b) => {
                        const dateA = a.expiryDate ? new Date(a.expiryDate) : new Date('9999-12-31');
                        const dateB = b.expiryDate ? new Date(b.expiryDate) : new Date('9999-12-31');
                        return dateA - dateB;
                    });
                    
                    clearTimeout(timeoutTimer);
                    console.log(`✅ Sending ${sortedBatches.length} batches for productId ${productId}`);
                    if (sortedBatches.length > 0) {
                        console.log(`   Sample batch: productId=${sortedBatches[0].productId}, quantity=${sortedBatches[0].quantity}, lotNumber=${sortedBatches[0].lotNumber}`);
                    }
                    sendResponse({ success: true, batches: sortedBatches });
                    syncProductQuantityWithBatches(numProductId, sortedBatches, 'batches endpoint - numeric query');
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
                                            if (!batch || !batch.productId) return false;
                                            // CRITICAL: Filter out batches with quantity <= 0 (removed/empty batches)
                                            const batchQuantity = Number(batch.quantity || 0);
                                            if (batchQuantity <= 0) {
                                                return false; // Skip empty/removed batches
                                            }
                                            // Normalize both sides for comparison
                                            const batchProductId = typeof batch.productId === 'number' ? batch.productId : parseInt(batch.productId, 10);
                                            return !Number.isNaN(batchProductId) && batchProductId === numProductId;
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
                                syncProductQuantityWithBatches(numProductId, sortedBatches, 'batches endpoint - string query');
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
            
            // CRITICAL: Add quantity > 0 filter to exclude removed/empty batches
            const queryWithQuantity = { ...query, quantity: { $gt: 0 } };
            
            inventoryBatchesDB.find(queryWithQuantity)
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
                    
                    // Additional filter to ensure no batches with quantity <= 0 slip through
                    const validBatches = (batches || []).filter(batch => Number(batch.quantity || 0) > 0);
                    
                    console.log(`✅ Query completed in ${queryDuration}ms`);
                    console.log(`   Found ${validBatches.length} batches for productId ${numProductId} (${batches ? batches.length : 0} before quantity filter)`);
                    console.log(`   Batches is array: ${Array.isArray(validBatches)}`);
                    console.log(`   Batches value:`, validBatches);
                    
                    if (validBatches && validBatches.length > 0) {
                        console.log('   First batch details:', {
                            productId: validBatches[0].productId,
                            productIdType: typeof validBatches[0].productId,
                            quantity: validBatches[0].quantity,
                            lotNumber: validBatches[0].lotNumber
                        });
                    }
                    
                    // If no results with numeric, try string format
                    if (!validBatches || validBatches.length === 0) {
                        console.log(`⚠️ No batches found with numeric productId ${numProductId}, trying string format "${stringProductId}"`);
                        const stringQuery = { productId: stringProductId, quantity: { $gt: 0 } };
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
                                
                                // Additional filter to ensure no batches with quantity <= 0 slip through
                                const validStrBatches = (strBatches || []).filter(batch => Number(batch.quantity || 0) > 0);
                                
                                console.log(`   String query found ${validStrBatches.length} batches (${strBatches ? strBatches.length : 0} before quantity filter)`);
                                
                                if (validStrBatches && validStrBatches.length > 0) {
                                    console.log('   First batch from string query:', {
                                        productId: validStrBatches[0].productId,
                                        productIdType: typeof validStrBatches[0].productId,
                                        quantity: validStrBatches[0].quantity,
                                        lotNumber: validStrBatches[0].lotNumber
                                    });
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
                                const sortedBatches = validStrBatches.sort((a, b) => {
                                    const dateA = a.expiryDate ? new Date(a.expiryDate) : new Date('9999-12-31');
                                    const dateB = b.expiryDate ? new Date(b.expiryDate) : new Date('9999-12-31');
                                    return dateA - dateB;
                                });
                                
                        sendResponse({ success: true, batches: sortedBatches });
                        syncProductQuantityWithBatches(numProductId, sortedBatches, 'batches endpoint - file fallback');
                            });
                        return;
                    }
                    
                    // We found batches with numeric query
                    clearTimeout(timeoutTimer);
                    console.log('📦 Sample batch:', {
                        productId: validBatches[0].productId,
                        productIdType: typeof validBatches[0].productId,
                        lotNumber: validBatches[0].lotNumber,
                        quantity: validBatches[0].quantity,
                        expiryDate: validBatches[0].expiryDate
                    });
                    
                    // Sort by expiry date (oldest first) for FEFO
                    const sortedBatches = validBatches.sort((a, b) => {
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
    purchaseOrdersDB.find({}).sort({ createdAt: -1, _id: -1 }).exec(function (err, orders) {
            if (err) {
                console.error("Error fetching purchase orders:", err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "Failed to fetch purchase orders."
                });
                return;
            }
            
            // If sort didn't work (some NeDB versions), sort manually
            if (orders && orders.length > 0) {
                orders.sort((a, b) => {
                    // Sort by createdAt descending (newest first)
                    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    if (dateB !== dateA) {
                        return dateB - dateA; // Descending order
                    }
                    // If dates are equal, sort by _id descending
                    return (b._id || 0) - (a._id || 0);
                });
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
 * Helper function: Recalculate product quantities from batches
 * This can be called directly or via the HTTP endpoint
 * Defined early so it's available for the receive items endpoint
 */
function recalculateProductQuantitiesDirect(productIds, callback) {
    const productQuery = productIds && Array.isArray(productIds) && productIds.length > 0
        ? { _id: { $in: productIds.map(id => parseInt(id, 10)) } }
        : {};
    const fs = require('fs');
    const batchesDBPath = inventoryBatchesDB.filename;
    const inventoryDBPath = inventoryDB.filename;
    let inventoryFileCache = null;
    
    const filterValidBatches = (batches) => {
        return (batches || [])
            .filter(batch => batch && Number(batch.quantity || 0) > 0);
    };
    
    const readBatchesFromFile = (productIdNum, productIdStr) => {
        try {
            if (!batchesDBPath || !fs.existsSync(batchesDBPath)) {
                console.warn(`[Recalculate Direct] Batch DB file missing when reading fallback for product ${productIdNum}`);
                return [];
            }
            
            const content = fs.readFileSync(batchesDBPath, 'utf8');
            const lines = content.split('\n').filter(Boolean);
            const latestById = new Map();
            
            lines.forEach((line, idx) => {
                try {
                    const batch = JSON.parse(line);
                    if (batch.$$indexCreated) {
                        return;
                    }
                    const batchQuantity = Number(batch.quantity || 0);
                    if (batchQuantity <= 0) {
                        return;
                    }
                    const batchProductId = typeof batch.productId === 'number'
                        ? batch.productId
                        : parseInt(batch.productId, 10);
                    if (!Number.isNaN(batchProductId) && (batchProductId === productIdNum || String(batchProductId) === productIdStr)) {
                        const batchIdKey = batch._id ? String(batch._id) : `${batchProductId}_${batch.lotNumber || ''}_${batch.barcode || ''}`;
                        latestById.set(batchIdKey, batch);
                    }
                } catch (parseErr) {
                    if (idx < 3) {
                        console.warn(`[Recalculate Direct] Failed to parse batch line ${idx + 1}:`, parseErr.message);
                    }
                }
            });
            
            return Array.from(latestById.values());
        } catch (fileErr) {
            console.warn(`[Recalculate Direct] File fallback failed for product ${productIdNum}:`, fileErr.message);
            return [];
        }
    };
    
    const buildInventoryFileCache = () => {
        if (inventoryFileCache) {
            return inventoryFileCache;
        }
        
        const cache = new Map();
        try {
            if (!inventoryDBPath || !fs.existsSync(inventoryDBPath)) {
                console.warn('[Recalculate Direct] Inventory DB file missing when building cache');
            } else {
                const content = fs.readFileSync(inventoryDBPath, 'utf8');
                const lines = content.split('\n').filter(Boolean);
                lines.forEach((line, idx) => {
                    try {
                        const product = JSON.parse(line);
                        if (product && product._id !== undefined && !product.$$indexCreated) {
                            const key = typeof product._id === 'number' ? product._id : parseInt(product._id, 10);
                            if (!Number.isNaN(key)) {
                                cache.set(key, product);
                            }
                        }
                    } catch (parseErr) {
                        if (idx < 3) {
                            console.warn(`[Recalculate Direct] Failed to parse inventory line ${idx + 1}:`, parseErr.message);
                        }
                    }
                });
            }
        } catch (err) {
            console.warn('[Recalculate Direct] Failed to build inventory file cache:', err.message);
        }
        inventoryFileCache = cache;
        return inventoryFileCache;
    };
    
    const getProductFromFileCache = (productIdNum) => {
        const cache = buildInventoryFileCache();
        return cache.get(productIdNum) || null;
    };
    
    const fetchBatchesWithFallback = (productIdNum, productIdStr, cb, options = {}) => {
        if (options.preferFile) {
            const fileBatches = readBatchesFromFile(productIdNum, productIdStr);
            cb(null, filterValidBatches(fileBatches));
            return;
        }
        
        let finished = false;
        const finish = (err, batches) => {
            if (finished) return;
            finished = true;
            clearTimeout(timeoutTimer);
            cb(err, filterValidBatches(batches));
        };
        
        const timeoutTimer = setTimeout(() => {
            if (finished) return;
            console.warn(`[Recalculate Direct] Batch query timeout for product ${productIdNum} - using file fallback`);
            const fileBatches = readBatchesFromFile(productIdNum, productIdStr);
            finish(null, fileBatches);
        }, 2000); // 2 second timeout
        
        const numericQuery = { productId: productIdNum, quantity: { $gt: 0 } };
        inventoryBatchesDB.find(numericQuery, function (numErr, numericBatches) {
            if (finished) return;
            
            if (!numErr && Array.isArray(numericBatches) && numericBatches.length > 0) {
                finish(null, numericBatches);
                return;
            }
            
            if (numErr) {
                console.warn(`[Recalculate Direct] Numeric batch query error for product ${productIdNum}:`, numErr);
            } else {
                console.log(`[Recalculate Direct] No numeric batches for product ${productIdNum}, trying string productId`);
            }
            
            const stringQuery = { productId: productIdStr, quantity: { $gt: 0 } };
            inventoryBatchesDB.find(stringQuery, function (strErr, stringBatches) {
                if (finished) return;
                
                if (!strErr && Array.isArray(stringBatches) && stringBatches.length > 0) {
                    finish(null, stringBatches);
                    return;
                }
                
                if (strErr) {
                    console.warn(`[Recalculate Direct] String batch query error for product ${productIdStr}:`, strErr);
                } else {
                    console.warn(`[Recalculate Direct] No string batches for product ${productIdStr}, using file fallback`);
                }
                
                const fileBatches = readBatchesFromFile(productIdNum, productIdStr);
                finish(null, fileBatches);
            });
        });
    };
    
    const processSpecificProductIds = (ids) => {
        if (!ids || ids.length === 0) {
            if (callback) callback({ success: true, updated: 0, errors: 0, total: 0 });
            return;
        }
        
        console.log(`[Recalculate Direct] Running targeted recalculation for ${ids.length} product(s)...`);
        let updated = 0;
        let errors = 0;
        let processed = 0;
        
        const processNext = (index) => {
            if (index >= ids.length) {
                console.log(`[Recalculate Direct] Targeted recalculation complete: ${updated} updated, ${errors} errors, ${processed} total`);
                if (callback) callback({ success: true, updated, errors, total: processed });
                return;
            }
            
            const rawId = ids[index];
            const productIdNum = typeof rawId === 'number' ? rawId : parseInt(rawId, 10);
            if (Number.isNaN(productIdNum)) {
                console.warn('[Recalculate Direct] Invalid productId provided for recalculation:', rawId);
                errors++;
                processed++;
                processNext(index + 1);
                return;
            }
            const productIdStr = String(productIdNum);
            const productFromFile = getProductFromFileCache(productIdNum);
            
            fetchBatchesWithFallback(productIdNum, productIdStr, (batchErr, batches) => {
                if (batchErr) {
                    console.error(`Error fetching batches for product ${productIdNum}:`, batchErr);
                    errors++;
                    processed++;
                    processNext(index + 1);
                    return;
                }
                
                const validBatches = Array.isArray(batches) ? batches : [];
                const totalBatchQuantity = validBatches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
                
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const earliestExpiry = validBatches.length > 0
                    ? validBatches
                        .map(b => b.expiryDate)
                        .filter(Boolean)
                        .map(d => new Date(d))
                        .filter(date => !Number.isNaN(date.getTime()))
                        .filter(date => date >= today)
                        .sort((a, b) => a - b)[0]
                    : null;
                
                const currentQuantity = productFromFile ? Number(productFromFile.quantity || 0) : null;
                const currentBatchSummaryQty = productFromFile && productFromFile.batchSummary
                    ? Number(productFromFile.batchSummary.totalQuantity || 0)
                    : null;
                const currentBatchCount = productFromFile && productFromFile.batchSummary
                    ? Number(productFromFile.batchSummary.batchCount || 0)
                    : null;
                
                const needsUpdate = currentQuantity === null ||
                    totalBatchQuantity !== currentQuantity ||
                    currentBatchSummaryQty !== totalBatchQuantity ||
                    currentBatchCount !== validBatches.length;
                
                if (!needsUpdate) {
                    processed++;
                    processNext(index + 1);
                    return;
                }
                
                const updateFields = {
                    quantity: totalBatchQuantity,
                    stock: totalBatchQuantity > 0 ? 1 : 0,
                    updatedAt: new Date(),
                    batchSummary: {
                        totalQuantity: totalBatchQuantity,
                        batchCount: validBatches.length,
                        earliestExpiry: earliestExpiry ? earliestExpiry.toISOString().slice(0, 10) : null
                    }
                };
                
                if (earliestExpiry) {
                    updateFields.expirationDate = earliestExpiry.toISOString().slice(0, 10);
                    updateFields.expiryDate = earliestExpiry.toISOString().slice(0, 10);
                }
                
                inventoryDB.update({ _id: productIdNum }, { $set: updateFields }, {}, function (updateErr, numAffected) {
                    if (updateErr) {
                        console.error(`Error updating product ${productIdNum} during targeted recalculation:`, updateErr);
                        errors++;
                        processed++;
                        processNext(index + 1);
                        return;
                    }
                    
                    if (!numAffected) {
                        console.warn(`[Recalculate Direct] Product ${productIdNum} not found during targeted recalculation`);
                        processed++;
                        processNext(index + 1);
                        return;
                    }
                    
                    console.log(`✅ [Recalculate Direct] Updated product ${productIdNum}: ${currentQuantity ?? 'N/A'} → ${totalBatchQuantity} (${validBatches.length} batches)`);
                    updated++;
                    inventoryFileCache = null; // cache is stale after update
                    try {
                        inventoryDB.persistence.compactDatafile();
                    } catch (persistErr) {
                        console.warn('[Recalculate Direct] Persistence warning after targeted update:', persistErr.message);
                    }
                    
                    setTimeout(() => {
                        try {
                            inventoryDB.loadDatabase(function (reloadErr) {
                                if (reloadErr) {
                                    console.warn('[Recalculate Direct] Database reload warning after targeted update:', reloadErr.message);
                                }
                                processed++;
                                processNext(index + 1);
                            });
                        } catch (reloadErr) {
                            console.warn('[Recalculate Direct] Database reload exception after targeted update:', reloadErr.message);
                            processed++;
                            processNext(index + 1);
                        }
                    }, 200);
                });
            }, { preferFile: true });
        };
        
        processNext(0);
    };
    
    if (Array.isArray(productIds) && productIds.length > 0) {
        processSpecificProductIds(productIds);
        return;
    }
    
    inventoryDB.find(productQuery, function (err, products) {
        if (err) {
            console.error('Error fetching products for recalculation:', err);
            if (callback) callback({ success: false, updated: 0, errors: 1, total: 0 });
            return;
        }
        
        if (!products || products.length === 0) {
            if (callback) callback({ success: true, updated: 0, errors: 0, total: 0 });
            return;
        }
        
        console.log(`[Recalculate Direct] Recalculating quantities for ${products.length} products...`);
        let updated = 0;
        let errors = 0;
        let processed = 0;
        
        const processNext = (index) => {
            if (index >= products.length) {
                console.log(`[Recalculate Direct] Complete: ${updated} updated, ${errors} errors, ${processed} total`);
                if (callback) callback({ success: true, updated, errors, total: processed });
                return;
            }
            
            const product = products[index];
            const productId = product._id;
            const productIdNum = typeof productId === 'number' ? productId : parseInt(productId);
            const productIdStr = String(productId);
            
            fetchBatchesWithFallback(productIdNum, productIdStr, (batchErr, batches) => {
                if (batchErr) {
                    console.error(`Error fetching batches for product ${productId}:`, batchErr);
                    errors++;
                    processed++;
                    processNext(index + 1);
                    return;
                }
                
                const totalBatchQuantity = Array.isArray(batches)
                    ? batches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0)
                    : 0;
                
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const earliestExpiry = batches && batches.length > 0
                    ? batches
                        .map(b => b.expiryDate)
                        .filter(Boolean)
                        .map(d => new Date(d))
                        .filter(date => !Number.isNaN(date.getTime()))
                        .filter(date => date >= today)
                        .sort((a, b) => a - b)[0]
                    : null;
                
                const currentQuantity = Number(product.quantity || 0);
                const shouldUpdate = totalBatchQuantity !== currentQuantity;
                
                if (shouldUpdate) {
                    const updateFields = {
                        quantity: totalBatchQuantity,
                        stock: 1,
                        updatedAt: new Date(),
                        batchSummary: {
                            totalQuantity: totalBatchQuantity,
                            batchCount: batches ? batches.length : 0,
                            earliestExpiry: earliestExpiry ? earliestExpiry.toISOString().slice(0, 10) : null
                        }
                    };
                    
                    if (earliestExpiry) {
                        updateFields.expirationDate = earliestExpiry.toISOString().slice(0, 10);
                        updateFields.expiryDate = earliestExpiry.toISOString().slice(0, 10);
                    }
                    
                    inventoryDB.update({ _id: productId }, { $set: updateFields }, {}, function (updateErr) {
                        if (updateErr) {
                            console.error(`Error updating product ${productId}:`, updateErr);
                            errors++;
                        } else {
                            console.log(`✅ [Recalculate Direct] Updated product ${productId} (${product.name}): ${currentQuantity} → ${totalBatchQuantity} (${batches ? batches.length : 0} batches)`);
                            updated++;
                            try {
                                inventoryDB.persistence.compactDatafile();
                            } catch (persistErr) {
                                // Ignore persistence errors
                            }
                            setTimeout(() => {
                                try {
                                    inventoryDB.loadDatabase(function(reloadErr) {
                                        if (!reloadErr) {
                                            console.log(`✅ [Recalculate Direct] Database reloaded for product ${productId}`);
                                        }
                                        processed++;
                                        processNext(index + 1);
                                    });
                                } catch (reloadErr) {
                                    processed++;
                                    processNext(index + 1);
                                }
                            }, 300);
                            return;
                        }
                        processed++;
                        processNext(index + 1);
                    });
                } else {
                    processed++;
                    processNext(index + 1);
                }
            });
        };
        
        processNext(0);
    });
}

/**
 * POST endpoint: manually trigger product quantity recalculation.
 * Optional body: { productIds: [id1, id2] }
 */
app.post("/recalculate-products", function (req, res) {
    try {
        const body = req.body || {};
        const hasIds = Array.isArray(body.productIds) && body.productIds.length > 0;
        const targetIds = hasIds ? body.productIds : undefined;
        
        recalculateProductQuantitiesDirect(targetIds, (result) => {
            if (result && result.success === false) {
                res.status(500).json({ success: false, message: "Recalculation failed", result });
                return;
            }
            res.json({
                success: true,
                message: hasIds
                    ? `Recalculated ${body.productIds.length} product(s)`
                    : 'Recalculated all products',
                result: result || { updated: 0, errors: 0, total: 0 }
            });
        });
    } catch (err) {
        console.error('Error handling recalculation request:', err);
        res.status(500).json({ success: false, message: err.message });
    }
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
        
        // Track async operations to ensure all product updates complete before sending response
        let pendingProductUpdates = 0;
        let productUpdateErrors = [];
        const checkAndSendResponse = () => {
            console.log(`[Response Check] pendingProductUpdates: ${pendingProductUpdates}`);
            if (pendingProductUpdates === 0) {
                // All product updates complete, now update PO status and send response
                console.log(`[Response Check] All product updates complete, sending response`);
                determinePOStatusAndRespond();
            } else {
                console.log(`[Response Check] Waiting for ${pendingProductUpdates} product update(s) to complete`);
                }
        };
        
        const determinePOStatusAndRespond = () => {
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
                    if (productUpdateErrors.length > 0) {
                        console.warn("⚠️ Some product updates had errors:", productUpdateErrors);
                    }
                
                // Note: Frontend will trigger recalculation after 7 seconds, so we don't need to do it here
                // The frontend's recalculation will also trigger productsUpdated event for UI refresh
                // Keeping this code as a backup but reducing delay to avoid conflicts
                const receivedProductIds = receiveData.items.map(item => {
                    const productId = item.productId || order.items.find(oi => 
                        oi.productId === item.productId || 
                        oi.productName === item.productName ||
                        (oi.barcode && item.barcode && parseInt(oi.barcode) === parseInt(item.barcode))
                    )?.productId;
                    return productId ? (typeof productId === 'number' ? productId : parseInt(productId, 10)) : null;
                }).filter(id => id !== null && !Number.isNaN(id));
                
                if (receivedProductIds.length > 0) {
                    console.log(`[Receive] Background recalculation will be handled by frontend for ${receivedProductIds.length} product(s):`, receivedProductIds);
                    // CRITICAL: Also trigger immediate recalculation on backend to ensure product quantities are updated
                    // This is a backup in case the product update during receive didn't complete
                    const recalculationDelay = Math.max(1000, 500 + (receivedProductIds.length * 200)); // At least 1 second, more for multiple products
                    setTimeout(() => {
                        console.log(`[Receive] Triggering backend recalculation for ${receivedProductIds.length} product(s) after ${recalculationDelay}ms delay`);
                        // Call recalculation function directly (more reliable than HTTP in Electron)
                        if (typeof recalculateProductQuantitiesDirect === 'function') {
                            recalculateProductQuantitiesDirect(receivedProductIds, (result) => {
                                if (result) {
                                    console.log(`[Receive] Backend recalculation result: ${result.updated} updated, ${result.errors} errors, ${result.total} total`);
                                } else {
                                    console.warn('[Receive] Backend recalculation returned no result');
                                }
                            });
                        } else {
                            console.warn('[Receive] recalculateProductQuantitiesDirect function not available');
                        }
                    }, recalculationDelay);
                    // Frontend handles recalculation, but keep this as backup with longer delay
                    setTimeout(() => {
                        receivedProductIds.forEach(productId => {
                            // Recalculate this specific product's quantity from batches
                            const productIdNum = typeof productId === 'number' ? productId : parseInt(productId, 10);
                            const productIdStr = String(productIdNum);
                            
                            // Try file reading first
                            let fileBatches = [];
                            try {
                                const fs = require('fs');
                                const batchesDBPath = inventoryBatchesDB.filename;
                                if (fs.existsSync(batchesDBPath)) {
                                    const fileContent = fs.readFileSync(batchesDBPath, 'utf8');
                                    const lines = fileContent.split('\n').filter(line => line.trim());
                                    const seenIds = new Set();
                                    
                                    lines.forEach(line => {
                                        try {
                                            const batch = JSON.parse(line);
                                            const batchProductId = typeof batch.productId === 'number' ? batch.productId : parseInt(batch.productId, 10);
                                            if (!Number.isNaN(batchProductId) && batchProductId === productIdNum && batch._id && !seenIds.has(batch._id)) {
                                                seenIds.add(batch._id);
                                                fileBatches.push(batch);
                                            }
                                        } catch (e) {
                                            // Skip invalid JSON lines
                                        }
                                    });
                                }
                            } catch (fileErr) {
                                // File reading failed, will use NeDB query
                            }
                            
                            const calculateAndUpdate = (batches) => {
                                const totalBatchQuantity = Array.isArray(batches) 
                                    ? batches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0)
                                    : 0;
                                
                                if (totalBatchQuantity > 0 || fileBatches.length > 0) {
                                    inventoryDB.findOne({ _id: productIdNum }, function (findErr, product) {
                                        if (findErr || !product) {
                                            console.warn(`[Background Recalc] Product ${productIdNum} not found or error:`, findErr);
                                            return;
                                        }
                                        
                                        const updateFields = {
                                            quantity: totalBatchQuantity,
                                            batchSummary: {
                                                totalQuantity: totalBatchQuantity,
                                                batchCount: batches.length,
                                                earliestExpiry: null
                                            },
                                            updatedAt: new Date()
                                        };
                                        
                                        // Calculate earliest expiry
                                        const today = new Date();
                                        today.setHours(0, 0, 0, 0);
                                        const earliestExpiry = batches && batches.length > 0
                                            ? batches
                                                .map(b => b.expiryDate)
                                                .filter(Boolean)
                                                .map(d => new Date(d))
                                                .filter(date => !Number.isNaN(date.getTime()))
                                                .filter(date => date >= today)
                                                .sort((a, b) => a - b)[0]
                                            : null;
                                        
                                        if (earliestExpiry) {
                                            updateFields.batchSummary.earliestExpiry = earliestExpiry.toISOString().slice(0, 10);
                                            updateFields.expirationDate = earliestExpiry.toISOString().slice(0, 10);
                                            updateFields.expiryDate = earliestExpiry.toISOString().slice(0, 10);
                                        }
                                        
                                        inventoryDB.update(
                                            { _id: productIdNum },
                                            { $set: updateFields },
                                            {},
                                            function (updateErr) {
                                                if (updateErr) {
                                                    console.error(`[Background Recalc] Failed to update product ${productIdNum}:`, updateErr);
                                                } else {
                                                    console.log(`✅ [Background Recalc] Updated product ${productIdNum} (${product.name}): quantity → ${totalBatchQuantity} (${batches.length} batches)`);
                                                }
                                            }
                                        );
                                    });
                                }
                            };
                            
                            if (fileBatches.length > 0) {
                                console.log(`[Background Recalc] Found ${fileBatches.length} batches from file for product ${productIdNum}`);
                                calculateAndUpdate(fileBatches);
                            } else {
                                // Fallback to NeDB query
                                inventoryBatchesDB.find({ productId: productIdNum }, function (batchErr, batches) {
                                    if (batchErr) {
                                        console.error(`[Background Recalc] Error querying batches for product ${productIdNum}:`, batchErr);
                                        return;
                                    }
                                    if (batches && batches.length > 0) {
                                        console.log(`[Background Recalc] Found ${batches.length} batches from NeDB for product ${productIdNum}`);
                                        calculateAndUpdate(batches);
                                    } else {
                                        console.warn(`[Background Recalc] No batches found for product ${productIdNum}`);
                                    }
                                });
                            }
                        });
                    }, 10000); // 10 second delay - this is a backup, frontend handles the main recalculation
                }
                
                res.json({
                    success: true,
                    message: "Items received successfully",
                    status: newStatus,
                        order: { _id: orderId, status: newStatus },
                        warnings: productUpdateErrors.length > 0 ? productUpdateErrors : undefined
                });
            }
        );
        };
        
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
                let baseProductId = resolvedProductId;
                if (baseProductId !== undefined && baseProductId !== null) {
                    if (typeof baseProductId !== 'number' || Number.isNaN(baseProductId)) {
                        const parsedProductId = parseInt(baseProductId, 10);
                        if (!Number.isNaN(parsedProductId)) {
                            baseProductId = parsedProductId;
                        }
                    }
                }
                
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
                if (!item.productId && resolvedProductId) {
                    item.productId = baseProductId ?? resolvedProductId;
                }

                // Upsert batch record (productId + lotNumber + barcode)
                // Use the normalized productId from the start of the loop
                const normalizedProductId = (baseProductId !== undefined && baseProductId !== null)
                    ? baseProductId
                    : resolvedProductId;

                if (normalizedProductId === undefined || normalizedProductId === null || Number.isNaN(normalizedProductId)) {
                    console.warn(`⚠️ Skipping product ${resolvedProductId} in PO receive for order ${orderId} due to missing/invalid productId`);
                    return;
                }

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
                
                // CRITICAL: Increment counter BEFORE async calls to prevent premature response
                pendingProductUpdates++;
                console.log(`[Receive] Incremented pendingProductUpdates to ${pendingProductUpdates} for product ${normalizedProductId}`);
                
                // CRITICAL FIX: Since NeDB queries often hang, write batch IMMEDIATELY to file
                // Don't wait for findOne or update callbacks - they may never fire
                const totalBatchQuantityAfterReceive = receivedQuantity; // For new batches, just use received qty
                
                // Create batch record for IMMEDIATE file write (before any async NeDB calls)
                const batchRecord = {
                    _id: `batch_${normalizedProductId}_${Date.now()}`,
                    productId: normalizedProductId,
                    productName: item.productName,
                    lotNumber: receivedItem.lotNumber || batchQuery.lotNumber || '',
                    barcode: batchQuery.barcode || null,
                    quantity: receivedQuantity,
                    expiryDate: resolvedExpiry || null,
                    purchasePrice: receivedItem.purchasePrice ? parseFloat(receivedItem.purchasePrice) : (item.unitPrice || null),
                    sellingPrice: receivedItem.sellingPrice ? parseFloat(receivedItem.sellingPrice) : null,
                    supplierId: order.supplierId || null,
                    supplierName: order.supplierName || null,
                    updatedAt: new Date()
                };
                
                // WRITE BATCH IMMEDIATELY TO FILE - Don't wait for NeDB!
                try {
                    const fs = require('fs');
                    const batchesDBPath = inventoryBatchesDB.filename;
                    
                    if (batchesDBPath) {
                        fs.appendFileSync(batchesDBPath, JSON.stringify(batchRecord) + '\n');
                        console.log(`💾 IMMEDIATE: Wrote batch directly to file for product ${normalizedProductId} (qty: ${receivedQuantity})`);
                
                        // CRITICAL: Force NeDB to reload so it knows about the new batch
                        // This prevents compactDatafile() from erasing our directly-written batch
                        try {
                            inventoryBatchesDB.loadDatabase();
                            console.log(`🔄 NeDB reloaded to pick up new batch for product ${normalizedProductId}`);
                        } catch (reloadErr) {
                            console.warn(`⚠️ NeDB reload warning:`, reloadErr.message);
                        }
                    }
                } catch (fileWriteErr) {
                    console.error('❌ IMMEDIATE file write failed:', fileWriteErr.message);
                }
                
                // Store as verified batch for product update
                receivedItem.verifiedBatch = batchRecord;
                console.log(`✅ Created verified batch: ${batchRecord._id} with quantity ${batchRecord.quantity}`);
                
                // Skip NeDB update - we already wrote directly to file and reloaded
                // Using NeDB update with $inc could create duplicate entries or conflicts
                // The batch is already in the file and NeDB's memory after reload
                console.log(`ℹ️ Skipping NeDB batch update - batch already in file and NeDB reloaded`);

                // Update or create product in inventory
                // Note: Product quantity will be recalculated from all batches after batch update completes
                // Use normalized productId to ensure consistency
                // Note: pendingProductUpdates already incremented before async call
                console.log(`[Product Update] Looking up product ${normalizedProductId} in inventory database... (pendingProductUpdates: ${pendingProductUpdates})`);
                
                console.log(`[Product Update] Executing findOne query for productId: ${normalizedProductId} (type: ${typeof normalizedProductId})`);
                
                // Add timeout to findOne to prevent hanging
                let findOneCompleted = false;
                const findOneTimeout = setTimeout(() => {
                    if (!findOneCompleted) {
                        console.error(`⚠️ findOne query timeout for product ${normalizedProductId} - using fallback with file reading`);
                        findOneCompleted = true;
                        // Fallback: Since findOne is hanging, batch queries will likely also hang
                        // Use file reading immediately with a delay to allow batch updates to flush
                        const verifiedBatch = receivedItem.verifiedBatch;
                        if (verifiedBatch && verifiedBatch._id) {
                            // CRITICAL: Since database queries are hanging, use file reading with delay
                            // Add longer delay to allow the batch update to flush to disk AND to find all existing batches
                            setTimeout(() => {
                                readBatchesFromFileForUpdate();
                            }, 1200); // 1200ms delay to allow batch update to flush AND to read all existing batches
                            
                            function readBatchesFromFileForUpdate() {
                                const fs = require('fs');
                                const batchesDBPath = inventoryBatchesDB.filename;
                                let allBatchesForCalculation = [verifiedBatch]; // Start with verified batch
                                
                                try {
                                    if (batchesDBPath && fs.existsSync(batchesDBPath)) {
                                        const fileContent = fs.readFileSync(batchesDBPath, 'utf8');
                                        const lines = fileContent.split('\n').filter(l => l.trim());
                                        const verifiedBatchId = String(verifiedBatch._id);
                                        const seenIds = new Set([verifiedBatchId]);
                                        
                                        lines.forEach(line => {
                                            try {
                                                const batch = JSON.parse(line);
                                                // Skip metadata lines
                                                if (batch.$$indexCreated) return;
                                                
                                                // CRITICAL: Filter out batches with quantity <= 0
                                                const batchQuantity = Number(batch.quantity || 0);
                                                if (batchQuantity <= 0) {
                                                    return; // Skip empty/removed batches
                                                }
                                                
                                                const batchProductId = typeof batch.productId === 'number' ? batch.productId : parseInt(batch.productId, 10);
                                                const batchId = String(batch._id);
                                                
                                                if (batch && batch._id && 
                                                    !Number.isNaN(batchProductId) && 
                                                    batchProductId === normalizedProductId && 
                                                    !seenIds.has(batchId)) {
                                                    seenIds.add(batchId);
                                                    allBatchesForCalculation.push(batch);
                                                    console.log(`[Timeout Fallback] Found additional batch ${batch._id} with quantity ${batch.quantity} (from file - may be stale)`);
                                                }
                                            } catch (e) {
                                                // Skip invalid JSON
                                            }
                                        });
                                        console.log(`[Timeout Fallback] Total batches from file: ${allBatchesForCalculation.length} (1 verified + ${allBatchesForCalculation.length - 1} from file)`);
                                    }
                                } catch (fileErr) {
                                    console.warn(`[Timeout Fallback] File read failed, using only verified batch:`, fileErr.message);
                                }
                                
                                updateProductWithBatches(allBatchesForCalculation, false); // false = from file
                            }
                            
                            function updateProductWithBatches(allBatchesForCalculation, fromDB = false) {
                                const totalBatchQuantity = allBatchesForCalculation.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                const earliestExpiry = allBatchesForCalculation
                                    .map(b => b.expiryDate)
                                    .filter(Boolean)
                                    .map(d => new Date(d))
                                    .filter(date => !Number.isNaN(date.getTime()))
                                    .filter(date => date >= today)
                                    .sort((a, b) => a - b)[0];
                                
                                const updateFields = {
                                    quantity: totalBatchQuantity,
                                    stock: 1,
                                    updatedAt: new Date(),
                                    lastReceived: new Date(),
                                    receivedDate: new Date().toISOString().slice(0, 10),
                                    batchSummary: {
                                        totalQuantity: totalBatchQuantity,
                                        batchCount: allBatchesForCalculation.length,
                                        earliestExpiry: earliestExpiry ? earliestExpiry.toISOString().slice(0, 10) : null
                                    }
                                };
                                if (earliestExpiry) {
                                    updateFields.expirationDate = earliestExpiry.toISOString().slice(0, 10);
                                    updateFields.expiryDate = earliestExpiry.toISOString().slice(0, 10);
                                } else {
                                    // Use resolvedExpiry from outer scope if available, otherwise use earliestExpiry from batches
                                    const expiryToUse = typeof resolvedExpiry !== 'undefined' ? resolvedExpiry : (earliestExpiry ? earliestExpiry.toISOString().slice(0, 10) : null);
                                    if (expiryToUse) {
                                        updateFields.expirationDate = expiryToUse;
                                        updateFields.expiryDate = expiryToUse;
                                    }
                                }
                                
                                console.log(`[Timeout Fallback] Updating product ${normalizedProductId}: quantity=${totalBatchQuantity} (${allBatchesForCalculation.length} batches)`);
                                inventoryDB.update({ _id: normalizedProductId }, { $set: updateFields }, {}, function(updateErr) {
                                    if (updateErr) {
                                        console.error('Failed to update product (findOne timeout fallback):', updateErr);
                                        pendingProductUpdates--;
                                        checkAndSendResponse();
                                    } else {
                                        console.log(`✅ Updated product ${normalizedProductId} quantity to ${totalBatchQuantity} (findOne timeout fallback, ${allBatchesForCalculation.length} batches)`);
                                        // Force persistence and reload
                                        try {
                                            inventoryDB.persistence.compactDatafile();
                                        } catch (persistErr) {
                                            console.warn('Persistence warning:', persistErr.message);
                                        }
                                        setTimeout(() => {
                                            try {
                                                inventoryDB.loadDatabase(function(reloadErr) {
                                                    if (!reloadErr) {
                                                        console.log(`✅ Database reloaded for product ${normalizedProductId} (timeout fallback)`);
                                                    }
                                                    pendingProductUpdates--;
                                                    checkAndSendResponse();
                                                });
                                            } catch (reloadErr) {
                                                console.warn('Database reload warning:', reloadErr.message);
                                                pendingProductUpdates--;
                                                checkAndSendResponse();
                                            }
                                        }, 500);
                                    }
                                });
                            }
                        } else {
                            console.error('⚠️ No verifiedBatch available for timeout fallback');
                            pendingProductUpdates--;
                            checkAndSendResponse();
                        }
                    }
                }, 3000); // 3 second timeout for findOne
                
                inventoryDB.findOne({ _id: normalizedProductId }, function (findErr, product) {
                    if (findOneCompleted) {
                        console.warn('⚠️ findOne callback received after timeout - ignoring');
                        return;
                    }
                    findOneCompleted = true;
                    clearTimeout(findOneTimeout);
                    
                    if (findErr) {
                        console.error('Failed to find product for inventory update:', findErr);
                        pendingProductUpdates--;
                        checkAndSendResponse();
                        return;
                    }
                    
                    console.log(`[Product Update] findOne result: product=${!!product}, name=${product ? product.name : 'N/A'}`);
                    
                    if (!product) {
                        // Product doesn't exist - create it from PO item data
                        console.log(`⚠️ Product ${normalizedProductId} not found in inventory - creating new product`);
                        
                        // Use barcode from received item or PO item
                        const productBarcode = receivedItem.barcode ? parseInt(receivedItem.barcode) : 
                                             (item.barcode ? parseInt(item.barcode) : normalizedProductId);
                        
                        // Check if product with same barcode already exists
                        inventoryDB.findOne({ barcode: productBarcode }, function (barcodeErr, existingByBarcode) {
                            if (barcodeErr) {
                                console.error('Error checking for duplicate barcode:', barcodeErr);
                            }
                            
                            if (existingByBarcode) {
                                // Product exists with same barcode but different ID - use existing product
                                console.log(`Found existing product with barcode ${productBarcode}, using ID: ${existingByBarcode._id}`);
                                
                                // Recalculate quantity and expiry from all batches (including the one we just created)
                                // Note: pendingProductUpdates was already incremented before findOne
                                
                                // Wait for batch update to complete, then recalculate from all batches
                                setTimeout(() => {
                                    const existingProductId = existingByBarcode._id;
                                    // Normalize to match how batches are stored (numeric)
                                    const productIdNum = typeof existingProductId === 'number' ? existingProductId : (parseInt(existingProductId, 10) || existingProductId);
                                    const productIdStr = String(productIdNum);
                                    console.log(`[Update Existing Product by Barcode] Using productId: ${productIdNum} (type: ${typeof productIdNum}) to query batches`);
                                    
                                    // Query all batches for this product
                                    inventoryBatchesDB.find({ productId: productIdNum }, function (batchFindErr, allBatchesNum) {
                                        let allBatches = [];
                                        
                                        if (batchFindErr) {
                                            console.error('Failed to find batches (numeric query):', batchFindErr);
                                            // Try string query as fallback
                                            inventoryBatchesDB.find({ productId: productIdStr }, function (batchFindErr2, allBatchesStr) {
                                                allBatches = allBatchesStr || [];
                                                updateExistingProductFromBatches();
                                            });
                                        } else if (allBatchesNum && allBatchesNum.length > 0) {
                                            allBatches = allBatchesNum;
                                            updateExistingProductFromBatches();
                                        } else {
                                            // Try string query as fallback
                                            inventoryBatchesDB.find({ productId: productIdStr }, function (batchFindErr2, allBatchesStr) {
                                                if (!batchFindErr2 && allBatchesStr && allBatchesStr.length > 0) {
                                                    allBatches = allBatchesStr;
                                                }
                                                updateExistingProductFromBatches();
                                            });
                                        }
                                        
                                        function updateExistingProductFromBatches() {
                                            // Calculate total quantity from all batches
                                            const totalBatchQuantity = Array.isArray(allBatches) 
                                                ? allBatches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0)
                                                : 0;
                                            
                                            // Calculate earliest expiry from all batches
                                            // Only consider batches that haven't expired yet (future expiry dates)
                                            const today = new Date();
                                            today.setHours(0, 0, 0, 0); // Start of today for comparison
                                            
                                            const earliestExpiry = allBatches && allBatches.length > 0
                                                ? allBatches
                                                    .map(b => b.expiryDate)
                                                    .filter(Boolean)
                                                    .map(d => new Date(d))
                                                    .filter(date => !Number.isNaN(date.getTime()))
                                                    .filter(date => date >= today) // Only future expiry dates
                                                    .sort((a, b) => a - b)[0]
                                                : null;
                                            
                                            const currentQty = Number(existingByBarcode.quantity || existingByBarcode.stock || 0);
                                            
                                            const updateFields = {
                                                quantity: totalBatchQuantity,
                                                stock: 1,
                                                updatedAt: new Date(),
                                                lastReceived: new Date(),
                                                receivedDate: new Date().toISOString().slice(0, 10)
                                            };
                                            
                                            // Set expiry from earliest batch expiry (not just current received item)
                                            // Only set expiry if we have a future expiry date
                                            // (today is already declared above)
                                            
                                            if (earliestExpiry) {
                                                updateFields.expirationDate = earliestExpiry.toISOString().slice(0, 10);
                                                updateFields.expiryDate = earliestExpiry.toISOString().slice(0, 10);
                                            } else if (resolvedExpiry) {
                                                // Check if resolvedExpiry is in the future before using it
                                                const resolvedExpiryDate = new Date(resolvedExpiry);
                                                resolvedExpiryDate.setHours(0, 0, 0, 0);
                                                if (resolvedExpiryDate >= today) {
                                                    // Fallback to current received item's expiry if it's in the future
                                                    updateFields.expirationDate = resolvedExpiry;
                                                    updateFields.expiryDate = resolvedExpiry;
                                                } else {
                                                    // If resolvedExpiry is also expired, clear the expiry fields
                                                    updateFields.expirationDate = null;
                                                    updateFields.expiryDate = null;
                                                }
                                            } else {
                                                // No valid future expiry - clear expiry fields
                                                updateFields.expirationDate = null;
                                                updateFields.expiryDate = null;
                                            }
                                            
                                            // Update batchSummary
                                            if (allBatches && allBatches.length > 0) {
                                                updateFields.batchSummary = {
                                                    totalQuantity: totalBatchQuantity,
                                                    batchCount: allBatches.length,
                                                    earliestExpiry: earliestExpiry ? earliestExpiry.toISOString().slice(0, 10) : null
                                                };
                                            }
                                            
                                            console.log(`[Update Existing Product by Barcode] Product ${existingProductId}: quantity ${currentQty} → ${totalBatchQuantity}, earliestExpiry: ${earliestExpiry ? earliestExpiry.toISOString().slice(0, 10) : 'N/A'}`);
                                            
                                            inventoryDB.update(
                                                { _id: existingProductId },
                                                { $set: updateFields },
                                                {},
                                                function (updateErr) {
                                                    if (updateErr) {
                                                        console.error('Failed to update existing product:', updateErr);
                                                        productUpdateErrors.push(`Product ${existingProductId}: ${updateErr.message || updateErr}`);
                                                    } else {
                                                        console.log(`✅ Updated existing product ${existingProductId} quantity: ${currentQty} → ${totalBatchQuantity}`);
                                                        if (earliestExpiry) {
                                                            console.log(`   📅 Updated expiry to earliest from batches: ${earliestExpiry.toISOString().slice(0, 10)}`);
                                                        }
                                                    }
                                                    // Decrement pending counter and check if we can send response
                                                    pendingProductUpdates--;
                                                    checkAndSendResponse();
                                                }
                                            );
                                        }
                                    });
                                }, 1500); // Wait 1.5 seconds for batch update to complete (NeDB write operations can be slow)
                                
                                // Also update the PO item productId to match
                                item.productId = existingByBarcode._id;
            return;
        }
        
                            // Create new product from PO item
                            const newProduct = {
                                _id: baseProductId, // Use normalized productId from PO
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
                            
                            // Note: pendingProductUpdates was already incremented before findOne
                            
                            inventoryDB.insert(newProduct, function (insertErr, createdProduct) {
                                if (insertErr) {
                                    console.error('Failed to create product:', insertErr);
                                    productUpdateErrors.push(`Product creation failed: ${insertErr.message || insertErr}`);
                                } else {
                                    console.log(`✅ Created new product: ${createdProduct.name} (ID: ${createdProduct._id}, Barcode: ${createdProduct.barcode})`);
                                    console.log(`   Initial quantity: ${receivedQuantity}`);
                                }
                                // Decrement pending counter and check if we can send response
                                pendingProductUpdates--;
                                checkAndSendResponse();
                            });
                        });
                    } else {
                        // Product exists - recalculate quantity from all batches
                        // This ensures product quantity always matches the sum of batch quantities
                        // Note: pendingProductUpdates was already incremented before findOne
                        console.log(`[Product Update] Product ${baseProductId} (${product.name}) found, current quantity: ${product.quantity || 0}, starting async update... (pendingProductUpdates: ${pendingProductUpdates})`);
                        
                        // verifiedBatch is now set IMMEDIATELY before the async update, so we can use it right away
                        // No need to wait - verifiedBatch is guaranteed to exist
                        const verifiedBatch = receivedItem.verifiedBatch;
                        
                        console.log(`[Product Update] verifiedBatch check: exists=${!!verifiedBatch}, has_id=${!!(verifiedBatch && verifiedBatch._id)}, _id=${verifiedBatch ? verifiedBatch._id : 'N/A'}`);
                        
                        if (verifiedBatch && verifiedBatch._id) {
                            // Use verified batch immediately - calculate total from it + any existing batches
                            console.log(`[Product Update] Using verified batch immediately: ${verifiedBatch._id} with quantity ${verifiedBatch.quantity}`);
                            
                            // CRITICAL: Query database first to get latest batch data (file might be stale after sales)
                            // Use a short timeout, then fallback to file reading with delay
                            const productIdNum = typeof baseProductId === 'number' ? baseProductId : parseInt(baseProductId, 10);
                            let batchesQueryCompleted = false;
                            const batchesQueryTimeout = setTimeout(() => {
                                if (!batchesQueryCompleted) {
                                    batchesQueryCompleted = true;
                                    console.warn(`[Product Update] Batch query timeout, using file reading with delay`);
                                    // Fallback to file reading with delay to allow batch updates to flush
                                    setTimeout(() => {
                                        readBatchesFromFileForUpdate();
                                    }, 500); // 500ms delay to allow batch updates to flush
                                }
                            }, 2000); // 2 second timeout for database query
                            
                            // Try database query first (most up-to-date)
                            inventoryBatchesDB.find({ productId: productIdNum }, function(batchQueryErr, dbBatches) {
                                if (!batchesQueryCompleted) {
                                    batchesQueryCompleted = true;
                                    clearTimeout(batchesQueryTimeout);
                                    
                                    if (!batchQueryErr && dbBatches && dbBatches.length > 0) {
                                        // Use database batches (most up-to-date)
                                        const verifiedBatchId = String(verifiedBatch._id);
                                        const seenIds = new Set([verifiedBatchId]);
                                        let allBatchesForCalculation = [verifiedBatch];
                                        
                                        dbBatches.forEach(batch => {
                                            const batchId = String(batch._id);
                                            if (batch._id && !seenIds.has(batchId) && Number(batch.quantity || 0) > 0) {
                                                seenIds.add(batchId);
                                                allBatchesForCalculation.push(batch);
                                                console.log(`[Product Update] Found additional batch ${batch._id} with quantity ${batch.quantity} (from DB - latest data)`);
                                            }
                                        });
                                        
                                        console.log(`[Product Update] Total batches for calculation: ${allBatchesForCalculation.length} (1 verified + ${allBatchesForCalculation.length - 1} from DB)`);
                                        updateProductWithBatches(allBatchesForCalculation, true); // true = from DB
                                    } else {
                                        // Database query failed or returned no results, use file reading with delay
                                        console.warn(`[Product Update] Database query failed or empty, using file reading with delay`);
                                        setTimeout(() => {
                                            readBatchesFromFileForUpdate();
                                        }, 500);
                                    }
                                }
                            });
                            
                            function readBatchesFromFileForUpdate() {
                                const fs = require('fs');
                                const batchesDBPath = inventoryBatchesDB.filename;
                                let allBatchesForCalculation = [verifiedBatch]; // Start with verified batch
                                
                                try {
                                    if (batchesDBPath && fs.existsSync(batchesDBPath)) {
                                        const fileContent = fs.readFileSync(batchesDBPath, 'utf8');
                                        const lines = fileContent.split('\n').filter(line => line.trim());
                                        const verifiedBatchId = String(verifiedBatch._id);
                                        const seenIds = new Set([verifiedBatchId]);
                                        
                                        lines.forEach(line => {
                                            try {
                                                const batch = JSON.parse(line);
                                                // Skip metadata lines
                                                if (batch.$$indexCreated) return;
                                                
                                                const batchProductId = typeof batch.productId === 'number' ? batch.productId : parseInt(batch.productId, 10);
                                                const batchId = String(batch._id);
                                                
                                                // Match by productId and exclude the verifiedBatch we already have
                                                if (!Number.isNaN(batchProductId) && 
                                                    batchProductId === productIdNum && 
                                                    batch._id && 
                                                    !seenIds.has(batchId) &&
                                                    Number(batch.quantity || 0) > 0) {
                                                    seenIds.add(batchId);
                                                    allBatchesForCalculation.push(batch);
                                                    console.log(`[Product Update] Found additional batch ${batch._id} with quantity ${batch.quantity} (from file - may be stale)`);
                                                }
                                            } catch (e) {
                                                // Skip invalid JSON lines
                                            }
                                        });
                                        console.log(`[Product Update] Total batches for calculation: ${allBatchesForCalculation.length} (1 verified + ${allBatchesForCalculation.length - 1} from file)`);
                                    }
                                } catch (fileErr) {
                                    console.warn(`[Product Update] File read failed, using only verified batch:`, fileErr.message);
                                    // File read failed, just use verified batch
                                }
                                
                                updateProductWithBatches(allBatchesForCalculation, false); // false = from file
                            }
                            
                            function updateProductWithBatches(allBatchesForCalculation, fromDB = false) {
                                // Calculate batch total
                                let totalBatchQuantity = allBatchesForCalculation.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
                                
                                // CRITICAL FIX: Handle "legacy stock" - products with quantity but NO batch records
                                // If only the verified batch exists (no existing batches found), check if product has legacy stock
                                const currentQuantity = Number(product.quantity || product.stock || 0);
                                const existingBatchCount = allBatchesForCalculation.length - 1; // Exclude verified batch
                                
                                if (existingBatchCount === 0 && currentQuantity > 0) {
                                    // Product had quantity but NO batches - this is legacy stock
                                    // Add the legacy quantity to the new batch total
                                    const legacyQuantity = currentQuantity;
                                    totalBatchQuantity += legacyQuantity;
                                    console.log(`[Update Product] ⚠️ Product had legacy stock (${legacyQuantity} units without batch records)`);
                                    console.log(`[Update Product] Adding legacy stock: ${legacyQuantity} + new batch ${verifiedBatch.quantity} = ${totalBatchQuantity}`);
                                }
                                
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                const earliestExpiry = allBatchesForCalculation
                                    .map(b => b.expiryDate)
                                    .filter(Boolean)
                                    .map(d => new Date(d))
                                    .filter(date => !Number.isNaN(date.getTime()))
                                    .filter(date => date >= today)
                                    .sort((a, b) => a - b)[0];
                                
                                const updateFields = {
                                    quantity: totalBatchQuantity,
                                    stock: 1,
                                    updatedAt: new Date(),
                                    lastReceived: new Date(),
                                    receivedDate: new Date().toISOString().slice(0, 10),
                                    batchSummary: {
                                        totalQuantity: totalBatchQuantity,
                                        batchCount: allBatchesForCalculation.length,
                                        earliestExpiry: earliestExpiry ? earliestExpiry.toISOString().slice(0, 10) : null
                                    }
                                };
                                
                                if (earliestExpiry) {
                                    updateFields.expirationDate = earliestExpiry.toISOString().slice(0, 10);
                                    updateFields.expiryDate = earliestExpiry.toISOString().slice(0, 10);
                                } else if (resolvedExpiry) {
                                    updateFields.expirationDate = resolvedExpiry;
                                    updateFields.expiryDate = resolvedExpiry;
                                }
                                
                                const batchSource = allBatchesForCalculation.length > 1 ? 
                                    `${allBatchesForCalculation.length - 1} from ${fromDB ? 'DB (latest)' : 'file (may be stale)'}` : 
                                    'verified batch only';
                                console.log(`[Update Product] Immediate update: quantity ${currentQuantity} → ${totalBatchQuantity} (using verified batch + ${batchSource})`);
                                console.log(`[Update Product] Batch breakdown: ${allBatchesForCalculation.map(b => `${b._id}:${b.quantity || 0}`).join(', ')}`);
                                console.log(`[Update Product] Setting batchSummary: totalQuantity=${totalBatchQuantity}, batchCount=${allBatchesForCalculation.length}`);
                                
                                inventoryDB.update(
                                    { _id: baseProductId },
                                    { $set: updateFields },
                                    {},
                                    function (invQtyErr) {
                                        if (invQtyErr) {
                                            console.error('Failed to update product quantity (immediate):', invQtyErr);
                                            productUpdateErrors.push(`Product ${baseProductId}: ${invQtyErr.message || invQtyErr}`);
                                            pendingProductUpdates--;
                                            checkAndSendResponse();
                                        } else {
                                            console.log(`✅ Updated product ${baseProductId} (${item.productName}) quantity: ${currentQuantity} → ${totalBatchQuantity} (immediate update)`);
                                            console.log(`   ✅ batchSummary.totalQuantity: ${updateFields.batchSummary.totalQuantity}, batchCount: ${updateFields.batchSummary.batchCount}`);
                                            // Force persistence for real-time updates
                                            try {
                                                inventoryDB.persistence.compactDatafile();
                                            } catch (persistErr) {
                                                console.warn('Persistence warning:', persistErr.message);
                                            }
                                            
                                            // Add a delay to ensure database is flushed before frontend queries
                                            // This ensures the products API reads the updated quantity immediately
                                            // Increased to 500ms to allow both batch and product updates to flush
                                            setTimeout(() => {
                                                console.log(`✅ Product ${baseProductId} update flushed to disk`);
                                                // Force a reload of the database to ensure fresh data is available
                                                try {
                                                    inventoryDB.loadDatabase(function(reloadErr) {
                                                        if (!reloadErr) {
                                                            console.log(`✅ Database reloaded for product ${baseProductId}`);
                                                        }
                                                        pendingProductUpdates--;
                                                        checkAndSendResponse();
                                                    });
                                                } catch (reloadErr) {
                                                    console.warn('Database reload warning:', reloadErr.message);
                                                    pendingProductUpdates--;
                                                    checkAndSendResponse();
                                                }
                                            }, 500); // 500ms delay to allow NeDB to flush both batch and product updates
                                        }
                                    }
                                );
                            }
                        } else {
                            // This should never happen now since verifiedBatch is set immediately
                            // But keep as fallback for safety
                            console.warn(`⚠️ Verified batch not available for product ${baseProductId} - querying batches instead`);
                                // Use normalized productId to match how batches are stored
                                console.log(`[Recalculate Qty] Starting product quantity update for product ${baseProductId} (normalized from ${item.productId}, type: ${typeof baseProductId})...`);
                                console.log(`[Recalculate Qty] Querying batches for product ${baseProductId}...`);
                                // Query batches - batches are stored with numeric productId
                                const productIdNum = typeof baseProductId === 'number' ? baseProductId : parseInt(baseProductId, 10);
                                const productIdStr = String(baseProductId);
                                
                                // Add timeout to prevent hanging
                                let queryCompleted = false;
                                const queryTimeout = setTimeout(() => {
                                if (!queryCompleted) {
                                    console.warn(`⚠️ Batch query timeout for product ${baseProductId} - using fallback increment`);
                                    queryCompleted = true;
                                    // Use fallback: increment quantity directly
                                    const currentQuantity = Number(product.quantity || product.stock || 0);
                                    const newQuantity = currentQuantity + receivedQuantity;
                                    const updateFields = {
                                        quantity: newQuantity,
                                        stock: 1,
                                        updatedAt: new Date(),
                                        lastReceived: new Date(),
                                        receivedDate: new Date().toISOString().slice(0, 10),
                                        // ALWAYS set batchSummary even in timeout fallback
                                        batchSummary: {
                                            totalQuantity: newQuantity,
                                            batchCount: 0,
                                            earliestExpiry: null
                                        }
                                    };
                                    if (resolvedExpiry) {
                                        updateFields.expirationDate = resolvedExpiry;
                                        updateFields.expiryDate = resolvedExpiry;
                                        updateFields.batchSummary.earliestExpiry = resolvedExpiry;
                                    }
                                    
                                    inventoryDB.update(
                                        { _id: baseProductId },
                                        { $set: updateFields },
                                        {},
                                        function (invQtyErr) {
                                            if (invQtyErr) {
                                                console.error('Failed to update product quantity (timeout fallback):', invQtyErr);
                                                productUpdateErrors.push(`Product ${baseProductId}: ${invQtyErr.message || invQtyErr}`);
                                            } else {
                                                console.log(`✅ Updated product ${baseProductId} quantity (timeout fallback): ${currentQuantity} → ${newQuantity} (+${receivedQuantity})`);
                                            }
                                            pendingProductUpdates--;
                                            checkAndSendResponse();
                                        }
                                    );
                                }
                            }, 5000); // 5 second timeout for batch query
                            
                            // Try file reading first as it's more reliable than NeDB queries
                            // Also include the verified batch that was just created/updated
                            let fileBatches = [];
                            const verifiedBatch = receivedItem.verifiedBatch;
                            
                            try {
                                const fs = require('fs');
                                const batchesDBPath = inventoryBatchesDB.filename;
                                
                                // If we have a verified batch, add it first to ensure it's included
                                if (verifiedBatch && verifiedBatch._id) {
                                    fileBatches.push(verifiedBatch);
                                    console.log(`✅ Including verified batch ${verifiedBatch._id} with quantity ${verifiedBatch.quantity}`);
                                }
                                
                                if (fs.existsSync(batchesDBPath)) {
                                    const fileContent = fs.readFileSync(batchesDBPath, 'utf8');
                                    const lines = fileContent.split('\n').filter(line => line.trim());
                                    const seenIds = new Set(verifiedBatch && verifiedBatch._id ? [verifiedBatch._id] : []);
                                    
                                    lines.forEach(line => {
                                        try {
                                            const batch = JSON.parse(line);
                                            // Match by numeric productId
                                            const batchProductId = typeof batch.productId === 'number' ? batch.productId : parseInt(batch.productId, 10);
                                            if (!Number.isNaN(batchProductId) && batchProductId === productIdNum && batch._id && !seenIds.has(batch._id)) {
                                                seenIds.add(batch._id);
                                                fileBatches.push(batch);
                                            }
                                        } catch (e) {
                                            // Skip invalid JSON lines
                                        }
                                    });
                                    
                                    if (fileBatches.length > 0) {
                                        const totalQty = fileBatches.reduce((sum, b) => sum + Number(b.quantity || 0), 0);
                                        console.log(`✅ Read ${fileBatches.length} batches from file for product ${baseProductId}, total quantity: ${totalQty}`);
                                        clearTimeout(queryTimeout);
                                        queryCompleted = true;
                                        handleBatchResults(null, fileBatches);
            return;
                                    } else if (verifiedBatch) {
                                        // If file reading found nothing but we have verified batch, use it
                                        console.log(`✅ Using verified batch only (file had no matches): ${verifiedBatch._id} with quantity ${verifiedBatch.quantity}`);
                                        clearTimeout(queryTimeout);
                                        queryCompleted = true;
                                        handleBatchResults(null, [verifiedBatch]);
                                        return;
                                    } else {
                                        console.log(`⚠️ File reading found 0 batches for product ${baseProductId}, will try NeDB query`);
                                    }
                                } else {
                                    console.log(`⚠️ Batch database file does not exist: ${batchesDBPath}`);
                                    // If file doesn't exist but we have verified batch, use it
                                    if (verifiedBatch) {
                                        console.log(`✅ Using verified batch since file doesn't exist: ${verifiedBatch._id} with quantity ${verifiedBatch.quantity}`);
                                        clearTimeout(queryTimeout);
                                        queryCompleted = true;
                                        handleBatchResults(null, [verifiedBatch]);
                                        return;
                                    }
                                }
                            } catch (fileErr) {
                                console.warn('File reading failed, falling back to NeDB query:', fileErr.message);
                                // If file reading failed but we have verified batch, use it
                                if (verifiedBatch) {
                                    console.log(`✅ Using verified batch after file read error: ${verifiedBatch._id} with quantity ${verifiedBatch.quantity}`);
                                    clearTimeout(queryTimeout);
                                    queryCompleted = true;
                                    handleBatchResults(null, [verifiedBatch]);
                                    return;
                                }
                            }
                            
                            // Fallback to NeDB query if file reading didn't find batches
                            // Try numeric query first
                            inventoryBatchesDB.find({ productId: productIdNum }, function (batchFindErr, allBatchesNum) {
                                if (queryCompleted) {
                                    console.warn('⚠️ Batch query callback received after timeout - ignoring');
            return;
        }
        
                                if (batchFindErr) {
                                    console.error('Failed to find batches (numeric query):', batchFindErr);
                                    clearTimeout(queryTimeout);
                                    queryCompleted = true;
                                    // Try string query as fallback
                                    inventoryBatchesDB.find({ productId: productIdStr }, function (batchFindErr2, allBatchesStr) {
                                        if (queryCompleted) return;
                                        clearTimeout(queryTimeout);
                                        queryCompleted = true;
                                        handleBatchResults(batchFindErr2, allBatchesStr || []);
                                    });
                                    return;
                                }
                                
                                // If numeric query found batches, use them; otherwise try string query
                                if (allBatchesNum && allBatchesNum.length > 0) {
                                    clearTimeout(queryTimeout);
                                    queryCompleted = true;
                                    console.log(`✅ Found ${allBatchesNum.length} batches for product ${baseProductId}`);
                                    handleBatchResults(null, allBatchesNum);
                                } else {
                                    // Try string query as fallback
                                    inventoryBatchesDB.find({ productId: productIdStr }, function (batchFindErr2, allBatchesStr) {
                                        if (queryCompleted) return;
                                        clearTimeout(queryTimeout);
                                        queryCompleted = true;
                                        if (!batchFindErr2 && allBatchesStr && allBatchesStr.length > 0) {
                                            console.log(`✅ Found ${allBatchesStr.length} batches (string query) for product ${baseProductId}`);
                                            handleBatchResults(null, allBatchesStr);
                                        } else {
                                            // No batches found with either query
                                            console.warn(`⚠️ No batches found for product ${baseProductId} - using stored quantity`);
                                            handleBatchResults(null, []);
                                        }
                                    });
                                }
                            });
                            
                            function handleBatchResults(batchFindErr, allBatches) {
                                if (batchFindErr) {
                                    console.error('Failed to find batches for quantity recalculation:', batchFindErr);
                                    // Fallback: increment quantity if batch query fails
                                    const currentQuantity = Number(product.quantity || product.stock || 0);
                                    const newQuantity = currentQuantity + receivedQuantity;
                                    const updateFields = {
                                        quantity: newQuantity,
                                        stock: 1, // stock: 1 means stock checking is enabled
                                        updatedAt: new Date(),
                                        lastReceived: new Date(), // Set received date
                                        receivedDate: new Date().toISOString().slice(0, 10), // Also set as string for compatibility
                                        // ALWAYS set batchSummary even in fallback to ensure consistency
                                        batchSummary: {
                                            totalQuantity: newQuantity,
                                            batchCount: 0,
                                            earliestExpiry: null
                                        }
                                    };
                                    // In fallback, use resolvedExpiry if available
                                    if (resolvedExpiry) {
                                        updateFields.expirationDate = resolvedExpiry;
                                        updateFields.expiryDate = resolvedExpiry;
                                        updateFields.batchSummary.earliestExpiry = resolvedExpiry;
                                    }
                                    
                                    console.log(`[Update Product Fallback] Setting quantity: ${newQuantity}, stock: 1, receivedDate: ${updateFields.receivedDate}, batchSummary.totalQuantity: ${newQuantity}`);
                                    
                                    // Use normalized productId
                                    inventoryDB.update(
                                        { _id: baseProductId },
                                        { $set: updateFields },
                                        {},
                                        function (invQtyErr) {
                                            if (invQtyErr) {
                                                console.error('Failed to increment product quantity:', invQtyErr);
                                                productUpdateErrors.push(`Product ${baseProductId}: ${invQtyErr.message || invQtyErr}`);
                                            } else {
                                                console.log(`✅ Updated product ${baseProductId} quantity: ${currentQuantity} → ${newQuantity} (+${receivedQuantity})`);
                                            }
                                            // Decrement pending counter and check if we can send response
                                            pendingProductUpdates--;
                                            checkAndSendResponse();
                                        }
                                    );
                                    return;
                                }
                                
                                // If no batches found but we just received items, retry once after a delay
                                if ((!allBatches || allBatches.length === 0) && receivedQuantity > 0) {
                                    console.warn(`⚠️ No batches found for product ${baseProductId} after receiving ${receivedQuantity} units - retrying in 1 second...`);
                                    setTimeout(() => {
                                        // Use normalized productId
                                        const productIdNum = typeof baseProductId === 'number' ? baseProductId : parseInt(baseProductId, 10);
                                        const productIdStr = String(baseProductId);
                                        
                                        inventoryBatchesDB.find({ productId: productIdNum }, function (retryErr, retryBatches) {
                                            if (!retryErr && retryBatches && retryBatches.length > 0) {
                                                console.log(`✅ Retry found ${retryBatches.length} batches for product ${baseProductId}`);
                                                handleBatchResults(null, retryBatches);
                                            } else {
                                                // Still no batches - use fallback increment
                                                console.warn(`⚠️ Retry also found no batches - using fallback increment for product ${baseProductId}`);
                                                const currentQuantity = Number(product.quantity || product.stock || 0);
                                                const newQuantity = currentQuantity + receivedQuantity;
                                                const updateFields = {
                                                    quantity: newQuantity,
                                                    stock: 1,
                                                    updatedAt: new Date(),
                                                    lastReceived: new Date(),
                                                    receivedDate: new Date().toISOString().slice(0, 10),
                                                    // ALWAYS set batchSummary even in retry fallback
                                                    batchSummary: {
                                                        totalQuantity: newQuantity,
                                                        batchCount: 0,
                                                        earliestExpiry: null
                                                    }
                                                };
                                                if (resolvedExpiry) {
                                                    updateFields.expirationDate = resolvedExpiry;
                                                    updateFields.expiryDate = resolvedExpiry;
                                                    updateFields.batchSummary.earliestExpiry = resolvedExpiry;
                                                }
                                                
                                                inventoryDB.update(
                                                    { _id: baseProductId },
                                                    { $set: updateFields },
                                                    {},
                                                    function (invQtyErr) {
                                                        if (invQtyErr) {
                                                            console.error('Failed to increment product quantity (retry fallback):', invQtyErr);
                                                            productUpdateErrors.push(`Product ${baseProductId}: ${invQtyErr.message || invQtyErr}`);
                                                        } else {
                                                            console.log(`✅ Updated product ${baseProductId} quantity (retry fallback): ${currentQuantity} → ${newQuantity} (+${receivedQuantity})`);
                                                        }
                                                        pendingProductUpdates--;
                                                        checkAndSendResponse();
                                                    }
                                                );
                                            }
                                        });
                                    }, 1000);
                                    return;
                                }
                                
                                // Calculate total quantity from all batches
                                const totalBatchQuantity = Array.isArray(allBatches) 
                                    ? allBatches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0)
                                    : 0;
                                
                                // Calculate earliest expiry from all batches (not just current received item)
                                // Only consider batches that haven't expired yet (future expiry dates)
                                const today = new Date();
                                today.setHours(0, 0, 0, 0); // Start of today for comparison
                                
                                const earliestExpiry = allBatches && allBatches.length > 0
                                    ? allBatches
                                        .map(b => b.expiryDate)
                                        .filter(Boolean)
                                        .map(d => new Date(d))
                                        .filter(date => !Number.isNaN(date.getTime()))
                                        .filter(date => date >= today) // Only future expiry dates
                                        .sort((a, b) => a - b)[0]
                                    : null;
                                
                                console.log(`[Recalculate Qty] Product ${baseProductId}: Found ${allBatches.length} batches, total quantity: ${totalBatchQuantity}`);
                                if (earliestExpiry) {
                                    console.log(`   📅 Earliest expiry from batches: ${earliestExpiry.toISOString().slice(0, 10)}`);
                                }
                                
                                const currentQuantity = Number(product.quantity || product.stock || 0);
                                const updateFields = {
                                    quantity: totalBatchQuantity,
                                    stock: 1, // stock: 1 means stock checking is enabled
                                    updatedAt: new Date(),
                                    lastReceived: new Date(), // Set received date
                                    receivedDate: new Date().toISOString().slice(0, 10) // Also set as string for compatibility
                                };
                                
                                // ALWAYS set expiry from earliest batch expiry (not just current received item)
                                // This ensures product expiry reflects the earliest expiring batch
                                // Only set expiry if we have a future expiry date
                                if (earliestExpiry) {
                                    updateFields.expirationDate = earliestExpiry.toISOString().slice(0, 10);
                                    updateFields.expiryDate = earliestExpiry.toISOString().slice(0, 10);
                                } else if (resolvedExpiry) {
                                    // Check if resolvedExpiry is in the future before using it
                                    const resolvedExpiryDate = new Date(resolvedExpiry);
                                    resolvedExpiryDate.setHours(0, 0, 0, 0);
                                    if (resolvedExpiryDate >= today) {
                                        // Fallback to current received item's expiry if it's in the future
                                        updateFields.expirationDate = resolvedExpiry;
                                        updateFields.expiryDate = resolvedExpiry;
                                    } else {
                                        // If resolvedExpiry is also expired, clear the expiry fields
                                        // This will make the product show as "no expiry" rather than expired
                                        updateFields.expirationDate = null;
                                        updateFields.expiryDate = null;
                                    }
                                } else {
                                    // No valid future expiry - clear expiry fields
                                    updateFields.expirationDate = null;
                                    updateFields.expiryDate = null;
                                }
                                
                                // ALWAYS update batchSummary (even if no batches) to ensure consistency
                                // This ensures the products API can use batchSummary.totalQuantity
                                if (allBatches && allBatches.length > 0) {
                                    updateFields.batchSummary = {
                                        totalQuantity: totalBatchQuantity,
                                        batchCount: allBatches.length,
                                        earliestExpiry: earliestExpiry ? earliestExpiry.toISOString().slice(0, 10) : null
                                    };
                                    console.log(`[Update Product] Setting batchSummary: totalQuantity=${totalBatchQuantity}, batchCount=${allBatches.length}`);
                                } else {
                                    // If no batches found but we just received items, use received quantity
                                    // Otherwise use current quantity from product
                                    const fallbackQuantity = receivedQuantity > 0 ? (Number(product.quantity || 0) + receivedQuantity) : Number(product.quantity || 0);
                                    updateFields.batchSummary = {
                                        totalQuantity: totalBatchQuantity || fallbackQuantity,
                                        batchCount: 0,
                                        earliestExpiry: null
                                    };
                                    console.log(`[Update Product] No batches found - setting batchSummary.totalQuantity to ${updateFields.batchSummary.totalQuantity}`);
                                }
                                
                                console.log(`[Update Product] Setting quantity: ${totalBatchQuantity}, stock: 1, receivedDate: ${updateFields.receivedDate}`);
                                
                                // Force update even if quantity is 0 (to fix stock status)
                                // Use normalized productId
                                inventoryDB.update(
                                    { _id: baseProductId },
                                    { $set: updateFields },
                                    {},
                                    function (invQtyErr) {
                                        if (invQtyErr) {
                                            console.error('Failed to update product quantity:', invQtyErr);
                                            productUpdateErrors.push(`Product ${item.productId}: ${invQtyErr.message || invQtyErr}`);
                                        } else {
                                            console.log(`✅ Updated product ${baseProductId} (${item.productName}) quantity: ${currentQuantity} → ${totalBatchQuantity} (recalculated from ${allBatches.length} batches)`);
                                            console.log(`   📦 Stock status: ${updateFields.stock === 1 ? 'ENABLED' : 'DISABLED'}, Quantity: ${totalBatchQuantity}`);
                                            if (resolvedExpiry) {
                                                console.log(`   ➕ Updated expiration date to ${resolvedExpiry}`);
                                            }
                                            if (updateFields.receivedDate) {
                                                console.log(`   📅 Received date: ${updateFields.receivedDate}`);
                                            }
                                        }
                                        // Decrement pending counter and check if we can send response
                                        pendingProductUpdates--;
                                        checkAndSendResponse();
                                    }
                                );
                            } // End of handleBatchResults function
                        } // End of else block (no verifiedBatch)
                    } // End of if (verifiedBatch) block
                }); // End of inventoryDB.findOne callback
                
                if (newReceived < item.quantity) {
                    allItemsReceived = false;
                    hasPartialReceipt = true;
                }
            } else {
                    allItemsReceived = false;
            }
        });
        
        // If no items were processed, send response immediately
        // Otherwise, wait for all product updates to complete (handled by checkAndSendResponse)
        if (order.items.length === 0) {
            // No items to process
            console.log('[Receive] No items in order, sending response immediately');
            determinePOStatusAndRespond();
        } else if (pendingProductUpdates === 0) {
            // All updates already complete (shouldn't happen, but safety check)
            console.log('[Receive] No pending product updates, sending response immediately');
            setTimeout(() => {
                checkAndSendResponse();
            }, 100); // Small delay to ensure any pending operations start
        } else {
            // Set a maximum timeout to ensure response is sent even if product updates hang
            console.log(`[Receive] Waiting for ${pendingProductUpdates} product update(s) to complete...`);
            setTimeout(() => {
                if (pendingProductUpdates > 0) {
                    console.warn(`⚠️ Product updates still pending after 15 seconds (${pendingProductUpdates} remaining), forcing response`);
                    pendingProductUpdates = 0;
                    determinePOStatusAndRespond();
                }
            }, 15000); // 15 second maximum wait (product updates have 4s delay + 5s query timeout = 9s max)
        }
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
            // Also check batchSummary.totalQuantity to catch products with batches
            const selector = {
                $or: [
                    { quantity: { $lte: threshold } },
                    { quantity: 0 },
                    { "batchSummary.totalQuantity": { $lte: threshold } },
                    { "batchSummary.totalQuantity": 0 },
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
                        
                        // Use normalizeExpiryDateForStorage to handle DD/MM/YYYY and other formats
                        const normalizedExpiry = normalizeExpiryDateForStorage(expiryValue);
                        if (!normalizedExpiry) {
                            return;
                        }
                        
                        const expiryDate = new Date(normalizedExpiry);
                        if (Number.isNaN(expiryDate.getTime())) {
                            console.log(`[Auto-Draft] ⚠️ Failed to parse normalized expiry for ${prod._id} (${prod.name}): ${normalizedExpiry} (original: ${expiryValue})`);
                            return;
                        }
                        
                        // Check if product is expired (past today) or near expiry (within alert days)
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        expiryDate.setHours(0, 0, 0, 0);
                        const isExpired = expiryDate < today;
                        const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                        const isNearExpiry = daysUntilExpiry <= expiryAlertDaysNumber && daysUntilExpiry >= 0;
                        
                        // Include if expired OR near expiry (within alert days)
                        if (isExpired || isNearExpiry) {
                            combinedMap.set(prod._id, prod);
                            additions++;
                            console.log(`[Auto-Draft] Found ${isExpired ? 'EXPIRED' : 'NEAR EXPIRY'} product: ${prod._id} (${prod.name}), expiry: ${expiryValue} (normalized: ${normalizedExpiry}), days: ${daysUntilExpiry}`);
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
                
                // CRITICAL FIX: Read accurate quantities from batch file (inventoryDB has stale data)
                const batchQuantitiesByProductId = new Map();
                const fs = require('fs');
                try {
                    const batchesDBPath = inventoryBatchesDB.filename;
                    if (batchesDBPath && fs.existsSync(batchesDBPath)) {
                        const fileContent = fs.readFileSync(batchesDBPath, 'utf8');
                        const lines = fileContent.split('\n').filter(l => l.trim());
                        const batchesByKey = new Map(); // Deduplicate by _id
                        
                        lines.forEach(line => {
                            try {
                                const batch = JSON.parse(line);
                                if (batch.$$indexCreated) return;
                                if (batch._id) {
                                    batchesByKey.set(batch._id, batch);
                                }
                            } catch (e) { /* skip invalid lines */ }
                        });
                        
                        batchesByKey.forEach(batch => {
                            const batchQuantity = Number(batch.quantity || 0);
                            if (batchQuantity <= 0) return;
                            
                            const batchProductId = typeof batch.productId === 'number' 
                                ? batch.productId 
                                : parseInt(batch.productId, 10);
                            if (Number.isNaN(batchProductId)) return;
                            
                            const existing = batchQuantitiesByProductId.get(batchProductId) || 0;
                            batchQuantitiesByProductId.set(batchProductId, existing + batchQuantity);
                        });
                        
                        console.log(`[Auto-Draft] Read ${batchesByKey.size} batches from file, ${batchQuantitiesByProductId.size} products have batch stock`);
                    }
                } catch (batchReadErr) {
                    console.warn('[Auto-Draft] Failed to read batch file:', batchReadErr.message);
                }
                
                // Enhance candidate products with accurate batch quantities
                candidateProducts.forEach(item => {
                    const productId = typeof item._id === 'number' ? item._id : parseInt(item._id, 10);
                    const batchQty = batchQuantitiesByProductId.get(productId);
                    if (typeof batchQty === 'number') {
                        // CRITICAL: Check for legacy stock - batchSummary.totalQuantity may include legacy stock
                        // that's not in the batch file (from products that had quantity but no batch records)
                        const existingBatchSummaryQty = item.batchSummary?.totalQuantity;
                        const effectiveBatchQty = (typeof existingBatchSummaryQty === 'number' && existingBatchSummaryQty > batchQty)
                            ? existingBatchSummaryQty // Use batchSummary.totalQuantity (includes legacy stock)
                            : batchQty; // Use batch file total
                        
                        item._batchFileQuantity = batchQty;
                        if (!item.batchSummary) item.batchSummary = {};
                        item.batchSummary.totalQuantity = effectiveBatchQty;
                        
                        if (effectiveBatchQty !== batchQty) {
                            console.log(`[Auto-Draft] Enhanced product ${item.name} (${productId}): batchQty=${batchQty}, using batchSummary=${effectiveBatchQty} (includes legacy stock)`);
                        } else {
                            console.log(`[Auto-Draft] Enhanced product ${item.name} (${productId}): batchQty=${batchQty}, oldQty=${item.quantity}`);
                        }
                    }
                });
            
                const itemsNeedingReorder = candidateProducts.filter(item => {
                    if (productsInExistingPOs.has(item._id) || 
                        productsInExistingPOs.has(String(item._id)) ||
                        productsInExistingPOs.has(parseInt(item._id, 10))) {
                        return false;
                    }
                    
                    // Use batchSummary.totalQuantity if available, otherwise fall back to quantity
                    // This ensures auto-draft uses the actual stock from batches
                    const effectiveQuantity = (item.batchSummary && typeof item.batchSummary.totalQuantity === 'number' && item.batchSummary.totalQuantity >= 0)
                        ? item.batchSummary.totalQuantity
                        : Number(item.quantity || item.stock || 0);
                    const currentStock = effectiveQuantity;
                    const reorderPoint = Number(item.reorderPoint || item.minStock || 0);
                    const expiryDateValue = item.expiryDate || item.expirationDate || (item.batchSummary && item.batchSummary.earliestExpiry) || null;
                    
                    let hasExpiredItems = false;
                    let isExpired = false;
                    let isNearExpiry = false;
                    if (expiryDateValue) {
                        // Use normalizeExpiryDateForStorage to handle DD/MM/YYYY and other formats
                        const normalizedExpiry = normalizeExpiryDateForStorage(expiryDateValue);
                        if (normalizedExpiry) {
                            const expiryDate = new Date(normalizedExpiry);
                            if (!Number.isNaN(expiryDate.getTime())) {
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                expiryDate.setHours(0, 0, 0, 0);
                                const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
                                
                                // Check if expired (past date) or near expiry (within alert days)
                                isExpired = expiryDate < today;
                                isNearExpiry = daysUntilExpiry <= expiryAlertDaysNumber && daysUntilExpiry >= 0;
                                hasExpiredItems = isExpired || isNearExpiry;
                                
                                if (hasExpiredItems) {
                                    console.log(`[Auto-Draft] 🚨 Product ${item._id} (${item.name}): ${isExpired ? 'EXPIRED' : 'NEAR EXPIRY'} - expiry: ${expiryDateValue} (normalized: ${normalizedExpiry}), days: ${daysUntilExpiry}, stock: ${currentStock}`);
                                }
                            } else {
                                console.log(`[Auto-Draft] ⚠️ Product ${item._id} (${item.name}): Failed to parse normalized expiry: ${normalizedExpiry} (original: ${expiryDateValue})`);
                            }
                        } else {
                            console.log(`[Auto-Draft] ⚠️ Product ${item._id} (${item.name}): Could not normalize expiry date: ${expiryDateValue}`);
                        }
                    } else {
                        // Debug: Log products without expiry dates (only for first few to avoid spam)
                        if (candidateProducts.indexOf(item) < 5) {
                            console.log(`[Auto-Draft] ℹ️ Product ${item._id} (${item.name}): No expiry date (expiryDate: ${item.expiryDate}, expirationDate: ${item.expirationDate}, batchSummary.earliestExpiry: ${item.batchSummary?.earliestExpiry})`);
                        }
                    }
                    
                    const needsReorder = (currentStock <= threshold) || 
                                        (currentStock <= reorderPoint && reorderPoint > 0) || 
                                        (currentStock === 0) ||
                                        hasExpiredItems;
                    
                    if (needsReorder && hasExpiredItems) {
                        console.log(`[Auto-Draft] ✅ Product ${item._id} (${item.name}) needs reorder due to expiry (stock: ${currentStock}, reorderPoint: ${reorderPoint}, threshold: ${threshold})`);
                    }
                    
                    return needsReorder;
                });
            
                console.log(`Found ${itemsNeedingReorder.length} items needing reorder`);
            
                // Get all suppliers to match supplier names to IDs
                const supplierDBPath = path.join(appData, appName, "server", "databases", "suppliers.db");
                const supplierDB = new Datastore({
                    filename: supplierDBPath,
                    autoload: true
                });
                
                supplierDB.find({}, function (supplierErr, allSuppliers) {
                    if (supplierErr) {
                        console.warn('Failed to load suppliers for name-to-ID mapping:', supplierErr);
                        processItemsWithSuppliers(itemsNeedingReorder, []);
            return;
        }
        
                    console.log(`Loaded ${allSuppliers.length} suppliers for name-to-ID mapping`);
                    processItemsWithSuppliers(itemsNeedingReorder, allSuppliers || []);
                });
            }
            
            function processItemsWithSuppliers(itemsNeedingReorder, allSuppliers) {
                // Create a map of supplier names to IDs for quick lookup
                const supplierNameToIdMap = {};
                allSuppliers.forEach(supplier => {
                    if (supplier.name) {
                        supplierNameToIdMap[supplier.name.toLowerCase().trim()] = supplier._id;
                    }
                });
                
                // Debug: Log supplier linking info for first few products
                itemsNeedingReorder.slice(0, 5).forEach(item => {
                    if (item.name && item.name.includes('Sleep Aid')) {
                        const supplierName = item.supplier || '';
                        const matchedSupplierId = supplierName ? supplierNameToIdMap[supplierName.toLowerCase().trim()] : null;
                        console.log(`[DEBUG] Product "${item.name}" (ID: ${item._id}) supplier fields:`, {
                            supplier: item.supplier,
                            supplierName: supplierName,
                            matchedSupplierId: matchedSupplierId,
                            designatedSupplierId: item.designatedSupplierId,
                            designatedSupplierID: item.designatedSupplierID,
                            supplierId: item.supplierId,
                            supplier_id: item.supplier_id,
                            supplierID: item.supplierID,
                            allKeys: Object.keys(item).filter(k => k.toLowerCase().includes('supplier'))
                        });
                    }
                });
            
                const hardcodedSuppliers = [
                    { _id: 1761170223, name: 'HealthPlus Wholesale' },
                    { _id: 1761170451, name: 'MediSuppliers Ltd' },
                    { _id: 1761170580, name: 'Global Pharma Distributors' }
                ];
                
                // Use hardcoded suppliers if database suppliers not available
                const suppliers = allSuppliers && allSuppliers.length > 0 ? allSuppliers : hardcodedSuppliers;
            
                sendResponse({
                    success: true,
                    message: `Found ${itemsNeedingReorder.length} products needing reorder`,
                    products: itemsNeedingReorder.map(item => {
                        const expiryDateValue = item.expiryDate || item.expirationDate || (item.batchSummary && item.batchSummary.earliestExpiry) || null;
                        
                        // Try to get designatedSupplierId from various fields
                        let designatedSupplierId = item.designatedSupplierId || item.designatedSupplierID || item.supplierId || item.supplier_id || item.supplierID || null;
                        
                        // If no designatedSupplierId but we have a supplier name, try to match it
                        if (!designatedSupplierId && item.supplier) {
                            const supplierName = item.supplier.toLowerCase().trim();
                            const matchedId = supplierNameToIdMap[supplierName];
                            if (matchedId) {
                                designatedSupplierId = matchedId;
                                console.log(`[Auto-Draft] Matched supplier name "${item.supplier}" to ID ${matchedId} for product "${item.name}"`);
                            }
                        }
                        
                        return {
                            productId: item._id,
                            productName: item.name,
                            barcode: item.barcode || '',
                            // Use batchSummary.totalQuantity if available for accurate stock display
                            currentStock: (item.batchSummary && typeof item.batchSummary.totalQuantity === 'number' && item.batchSummary.totalQuantity >= 0)
                                ? item.batchSummary.totalQuantity
                                : Number(item.quantity || item.stock || 0),
                            reorderPoint: Number(item.reorderPoint || item.minStock || 0),
                            suggestedQuantity: Number(item.reorderQuantity || item.reorderPoint || item.minStock || 10),
                            unitPrice: Number(item.actualPrice || item.price || 0),
                            supplier: item.supplier || '',
                            supplierId: designatedSupplierId, // Use the resolved ID
                            designatedSupplierId: designatedSupplierId, // Explicitly include for product-supplier linking
                            reason: (() => {
                                // Use batchSummary.totalQuantity if available for accurate stock check
                                const currentStock = (item.batchSummary && typeof item.batchSummary.totalQuantity === 'number' && item.batchSummary.totalQuantity >= 0)
                                    ? item.batchSummary.totalQuantity
                                    : Number(item.quantity || item.stock || 0);
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
                    suppliers: suppliers // Use the actual suppliers from database or hardcoded fallback
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
    try {
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
    const failedSuppliers = []; // Declare early for error handlers
    
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
    }, 8000); // 8 second overall timeout (reduced from 12s for faster feedback)
    
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
            // Proceed anyway after 1 second (10 * 100ms)
            console.log('⏱️ Suppliers DB check timeout - proceeding with query');
            if (!queryExecuted) {
                querySuppliers();
            }
            return;
        }
        
        // Try to load database if not ready
        const fs = require('fs');
        const suppliersDBPath = suppliersDB.filename;
        const dbExists = fs.existsSync(suppliersDBPath);
        
        if (dbExists && attempts >= 3) {
            // If file exists but DB might not be loaded, try to load it
            console.log('⚠️ Suppliers DB file exists but might not be loaded - forcing load...');
            suppliersDB.loadDatabase(function(loadErr) {
                if (!loadErr) {
                    console.log('✅ Suppliers DB force load successful');
                }
                // Proceed with query after load attempt (only if not already executed)
                if (!queryExecuted) {
                    querySuppliers();
                }
            });
            return;
        }
        
        // Check if suppliersDB is ready by trying a quick count
        const countTimeout = setTimeout(() => {
            // If count takes too long, proceed anyway (only if not already executed)
            if (attempts < 10 && !queryExecuted) {
                querySuppliers();
            }
        }, 300); // 300ms max for count check
        
        suppliersDB.count({}, function(err, count) {
            clearTimeout(countTimeout);
            if (queryExecuted) {
                // Query already executed, ignore this callback
                return;
            }
            if (!err && count !== undefined && count > 0) {
                // DB is ready and has data
                console.log(`✅ Suppliers DB ready with ${count} suppliers`);
                querySuppliers();
            } else if (!err && count === 0 && dbExists) {
                // DB is ready but empty - try file reading
                console.log('⚠️ Suppliers DB query returned 0 - trying file reading');
                querySuppliers(); // Will use file reading fallback
            } else {
                // Wait a bit more
                setTimeout(() => waitForSuppliersDB(attempts + 1), 100);
            }
        });
    };
    
    // Start the wait process
    waitForSuppliersDB();
    
    // Guards to prevent duplicate execution
    let queryExecuted = false;
    let processExecuted = false;
    
    function querySuppliers() {
        if (queryExecuted) {
            console.warn('⚠️ querySuppliers() already executed - ignoring duplicate call');
            return;
        }
        queryExecuted = true;
        
        const suppliersTimeout = setTimeout(() => {
            if (!responseSent && !processExecuted) {
                console.warn('⏱️ Suppliers query timeout - using file reading fallback');
                // Use file reading fallback if query times out
                try {
                    const fs = require('fs');
                    const suppliersDBPath = suppliersDB.filename;
                    if (fs.existsSync(suppliersDBPath)) {
                        const fileContent = fs.readFileSync(suppliersDBPath, 'utf8');
                        const lines = fileContent.split('\n').filter(line => line.trim());
                        const suppliers = [];
                        const seenIds = new Set();
                        
                        lines.forEach(line => {
                            try {
                                const supplier = JSON.parse(line);
                                if (supplier._id && !seenIds.has(supplier._id)) {
                                    seenIds.add(supplier._id);
                                    suppliers.push(supplier);
                                }
                            } catch (e) {
                                // Skip invalid JSON lines
                            }
                        });
                        
                        if (suppliers.length > 0) {
                            console.log(`✅ Read ${suppliers.length} suppliers from file (timeout fallback)`);
                            processSuppliers(suppliers);
                            return;
                        }
                    }
                } catch (fileErr) {
                    console.error('File reading fallback failed:', fileErr);
                }
                
                // If file reading also fails, return error
                clearTimeout(overallTimeout);
                sendResponse({
                    success: false,
                    message: "Suppliers query timed out. Please try again."
                }, 500);
            }
        }, 2000); // 2 second timeout for suppliers query (reduced from 3s)
        
        console.log('Querying suppliers database...');
        suppliersDB.find({})
            .limit(100) // Limit results
            .exec(function (err, suppliers) {
            clearTimeout(suppliersTimeout);
        
        if (responseSent || processExecuted) {
            console.warn('⚠️ Suppliers query callback received after response sent or processing started - ignoring');
            return;
        }
        
        if (err) {
            console.error("Error fetching suppliers:", err);
            // Try file reading fallback on error
            try {
                const fs = require('fs');
                const suppliersDBPath = suppliersDB.filename;
                if (fs.existsSync(suppliersDBPath)) {
                    const fileContent = fs.readFileSync(suppliersDBPath, 'utf8');
                    const lines = fileContent.split('\n').filter(line => line.trim());
                    const fileSuppliers = [];
                    const seenIds = new Set();
                    
                    lines.forEach(line => {
                        try {
                            const supplier = JSON.parse(line);
                            if (supplier._id && !seenIds.has(supplier._id)) {
                                seenIds.add(supplier._id);
                                fileSuppliers.push(supplier);
                            }
                        } catch (e) {
                            // Skip invalid JSON lines
                        }
                    });
                    
                    if (fileSuppliers.length > 0) {
                        console.log(`✅ Read ${fileSuppliers.length} suppliers from file (error fallback)`);
                        processSuppliers(fileSuppliers);
            return;
                    }
                }
            } catch (fileErr) {
                console.error('File reading fallback failed:', fileErr);
            }
            
            clearTimeout(overallTimeout);
            sendResponse({
                success: false,
                message: "Failed to fetch suppliers data"
            }, 500);
                return;
            }
            
        if (!suppliers || !Array.isArray(suppliers) || suppliers.length === 0) {
            console.warn("⚠️ No suppliers found in database query - trying file reading fallback");
            // Try file reading fallback before giving up
            try {
                const fs = require('fs');
                const suppliersDBPath = suppliersDB.filename;
                if (fs.existsSync(suppliersDBPath)) {
                    const fileContent = fs.readFileSync(suppliersDBPath, 'utf8');
                    const lines = fileContent.split('\n').filter(line => line.trim());
                    const fileSuppliers = [];
                    const seenIds = new Set();
                    
                    lines.forEach(line => {
                        try {
                            const supplier = JSON.parse(line);
                            if (supplier._id && !seenIds.has(supplier._id)) {
                                seenIds.add(supplier._id);
                                fileSuppliers.push(supplier);
                            }
                        } catch (e) {
                            // Skip invalid JSON lines
                        }
                    });
                    
                    if (fileSuppliers.length > 0) {
                        console.log(`✅ Read ${fileSuppliers.length} suppliers from file (empty query fallback)`);
                        processSuppliers(fileSuppliers);
            return;
                    }
                }
            } catch (fileErr) {
                console.error('File reading fallback failed:', fileErr);
            }
            
            console.error("No suppliers found in database or file");
            clearTimeout(overallTimeout);
            sendResponse({
                success: false,
                message: "No suppliers found in database. Please ensure suppliers are created first."
            }, 500);
            return;
        }
        
        processSuppliers(suppliers);
    });
    }
    
    function processSuppliers(suppliers) {
        if (processExecuted) {
            console.warn('⚠️ processSuppliers() already executed - ignoring duplicate call');
            return;
        }
        processExecuted = true;
        
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
        processSuppliersInternal(supplierMap);
    }
    
    waitForSuppliersDB();
    
    function processSuppliersInternal(supplierMap) {
        // Add a hard timeout for DB readiness check - force proceed after 1 second
        let dbReadyCallbackCalled = false;
        const dbReadyTimeout = setTimeout(() => {
            if (!dbReadyCallbackCalled && !responseSent) {
                console.warn('⏱️ Purchase orders DB readiness check timed out - proceeding anyway');
                // Force proceed even if DB not marked ready
                purchaseOrdersDBReady = true;
                processSuppliersInternal(supplierMap);
            }
        }, 1000); // 1 second max wait for DB readiness (reduced from 2s)

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

            // failedSuppliers is already declared at the top level, just clear it
            failedSuppliers.length = 0;

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
                    // For single-item POs, skip the check entirely to speed up creation
                    // For multi-item POs, do a quick non-blocking check
                    let existingPOCheck = null;
                    
                    if (orderItems.length === 1) {
                        // Single item - skip existing PO check to speed up creation
                        console.log('ℹ️ Single-item PO - skipping existing PO check for faster creation');
                    } else {
                        // Multi-item - do a quick check but don't block
                        const today = moment().startOf('day').toDate();
                        const tomorrow = moment().add(1, 'day').startOf('day').toDate();
                        const productIdsInOrder = orderItems.map(item => item.productId);
                        
                        let checkCompleted = false;
                        
                        // Set a very short timeout - if check doesn't complete in 300ms, skip it
                        const checkTimeout = setTimeout(() => {
                            if (!checkCompleted) {
                                checkCompleted = true;
                                console.warn('⏱️ Existing PO check timed out after 300ms - proceeding with new PO creation');
                            }
                        }, 300); // 300ms max - very aggressive timeout
                        
                        try {
                            // Try to check for existing POs, but don't wait if it hangs
                            purchaseOrdersDB.find({
                                status: { $in: ['draft', 'sent'] },
                                $or: [
                                    { createdAt: { $gte: today, $lt: tomorrow } },
                                    { expectedDeliveryDate: { $gte: today, $lt: tomorrow } }
                                ]
                            })
                            .limit(10) // Further reduced limit for faster query
                            .exec((err, existingPOs) => {
                                if (checkCompleted) {
                                    return; // Already timed out, ignore result
                                }
                                
                                clearTimeout(checkTimeout);
                                checkCompleted = true;
                                
            if (err) {
                                    console.warn('⚠️ Error checking for existing POs:', err.message);
                                    return;
                                }
                                
                                if (!existingPOs || existingPOs.length === 0) {
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
                                        existingPOCheck = existingPO;
                                        return;
                                    }
                                }
                            });
                            
                            // Wait for check to complete or timeout (max 400ms)
                            await new Promise(resolve => {
                                const waitInterval = setInterval(() => {
                                    if (checkCompleted) {
                                        clearInterval(waitInterval);
                                        resolve();
                                    }
                                }, 25); // Check every 25ms
                                
                                setTimeout(() => {
                                    clearInterval(waitInterval);
                                    if (!checkCompleted) {
                                        checkCompleted = true;
                                        clearTimeout(checkTimeout);
                                    }
                                    resolve();
                                }, 400); // Max wait 400ms
                            });
                        } catch (checkErr) {
                            console.warn('⚠️ Error in existing PO check:', checkErr.message);
                            if (!checkCompleted) {
                                checkCompleted = true;
                                clearTimeout(checkTimeout);
                            }
                        }
                    }

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
                        const timeoutMs = 3000; // 3 second timeout for insert (reduced from 5s)
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

            // Add timeout wrapper around concurrent processing (10s max)
            const processingTimeout = setTimeout(() => {
                if (!responseSent) {
                    console.warn('⏱️ Supplier processing timed out after 10s - returning partial results');
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
            }, 7000); // 7 second timeout for processing (reduced from 10s)

            try {
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
                        console.error('Error stack:', err?.stack);
                        clearTimeout(overallTimeout);
                        sendResponse({
                            success: false,
                            message: err?.message || 'Unexpected error occurred while creating purchase orders.',
                            orders: createdOrders,
                            existingOrders: existingOrders,
                            failures: failedSuppliers
                        });
                    });
            } catch (syncErr) {
                clearTimeout(processingTimeout);
                clearTimeout(overallTimeout);
                console.error('❌ Synchronous error in processSuppliers:', syncErr);
                console.error('Error stack:', syncErr?.stack);
                if (!responseSent) {
                    sendResponse({
                        success: false,
                        message: syncErr?.message || 'Unexpected error occurred while creating purchase orders.',
                        orders: createdOrders,
                        existingOrders: existingOrders,
                        failures: failedSuppliers
                    }, 500);
                }
            }
        } // End of processSuppliersInternal
    } // End of processSuppliers
    } catch (endpointErr) {
        // Catch any synchronous errors in the endpoint
        console.error('❌ Fatal error in auto-draft-create-pos endpoint:', endpointErr);
        console.error('Error stack:', endpointErr?.stack);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: endpointErr?.message || 'Internal server error occurred while creating purchase orders.',
                error: process.env.NODE_ENV === 'development' ? endpointErr?.stack : undefined
            });
        }
    }
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

/**
 * Helper function: Recalculate product quantities from batches
 * This can be called directly or via the HTTP endpoint
 * 
 * NOTE: This is a duplicate - the main function is defined earlier at line 1219
 * This duplicate should be removed to avoid confusion
 */
function recalculateProductQuantitiesDirect_DUPLICATE_REMOVE(productIds, callback) {
    const productQuery = productIds && Array.isArray(productIds) && productIds.length > 0
        ? { _id: { $in: productIds.map(id => parseInt(id)) } }
        : {};
    
    inventoryDB.find(productQuery, function (err, products) {
        if (err) {
            console.error('Error fetching products for recalculation:', err);
            if (callback) callback({ success: false, updated: 0, errors: 1, total: 0 });
            return;
        }
        
        if (!products || products.length === 0) {
            if (callback) callback({ success: true, updated: 0, errors: 0, total: 0 });
            return;
        }
        
        console.log(`[Recalculate Direct] Recalculating quantities for ${products.length} products...`);
        let updated = 0;
        let errors = 0;
        let processed = 0;
        
        const processNext = (index) => {
            if (index >= products.length) {
                console.log(`[Recalculate Direct] Complete: ${updated} updated, ${errors} errors, ${processed} total`);
                if (callback) callback({ success: true, updated, errors, total: processed });
                return;
            }
            
            const product = products[index];
            const productId = product._id;
            const productIdNum = typeof productId === 'number' ? productId : parseInt(productId);
            const productIdStr = String(productId);
            
            function handleBatchQueryResult(batchErr, batches) {
                if (batchErr) {
                    console.error(`Error fetching batches for product ${productId}:`, batchErr);
                    errors++;
                    processed++;
                    processNext(index + 1);
                    return;
                }
                
                const totalBatchQuantity = Array.isArray(batches)
                    ? batches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0)
                    : 0;
                
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const earliestExpiry = batches && batches.length > 0
                    ? batches
                        .map(b => b.expiryDate)
                        .filter(Boolean)
                        .map(d => new Date(d))
                        .filter(date => !Number.isNaN(date.getTime()))
                        .filter(date => date >= today)
                        .sort((a, b) => a - b)[0]
                    : null;
                
                const currentQuantity = Number(product.quantity || 0);
                const shouldUpdate = totalBatchQuantity !== currentQuantity;
                
                if (shouldUpdate) {
                    const updateFields = {
                        quantity: totalBatchQuantity,
                        stock: 1,
                        updatedAt: new Date(),
                        batchSummary: {
                            totalQuantity: totalBatchQuantity,
                            batchCount: batches ? batches.length : 0,
                            earliestExpiry: earliestExpiry ? earliestExpiry.toISOString().slice(0, 10) : null
                        }
                    };
                    
                    if (earliestExpiry) {
                        updateFields.expirationDate = earliestExpiry.toISOString().slice(0, 10);
                        updateFields.expiryDate = earliestExpiry.toISOString().slice(0, 10);
                    }
                    
                    inventoryDB.update({ _id: productId }, { $set: updateFields }, {}, function (updateErr) {
                        if (updateErr) {
                            console.error(`Error updating product ${productId}:`, updateErr);
                            errors++;
                        } else {
                            console.log(`✅ [Recalculate Direct] Updated product ${productId} (${product.name}): ${currentQuantity} → ${totalBatchQuantity} (${batches ? batches.length : 0} batches)`);
                            updated++;
                        }
                        processed++;
                        processNext(index + 1);
                    });
                } else {
                    processed++;
                    processNext(index + 1);
                }
            }
            
            inventoryBatchesDB.find({ productId: productIdNum }, function (batchErr, batchesNum) {
                if (batchErr) {
                    inventoryBatchesDB.find({ productId: productIdStr }, function (batchErr2, batchesStr) {
                        handleBatchQueryResult(batchErr2, batchesStr || []);
                    });
                } else {
                    handleBatchQueryResult(null, batchesNum || []);
                }
            });
        };
        
        processNext(0);
    });
}

/**
 * POST endpoint: Recalculate product quantities from batches (utility endpoint)
 * This fixes products where quantity doesn't match batch totals
 */
app.post("/recalculate-product-quantities", function (req, res) {
    console.log('=== RECALCULATE PRODUCT QUANTITIES ===');
    
    const { productIds } = req.body; // Optional: array of product IDs to recalculate, or null for all
    
    // Response guard
    let responseSent = false;
    const sendResponse = (data, statusCode = 200) => {
        if (responseSent) return;
        responseSent = true;
        if (!res.headersSent) {
            if (statusCode !== 200) res.status(statusCode);
            res.json(data);
        }
    };
    
    // Get all products or specific products
    const productQuery = productIds && Array.isArray(productIds) && productIds.length > 0
        ? { _id: { $in: productIds.map(id => parseInt(id)) } }
        : {};
    
    inventoryDB.find(productQuery, function (err, products) {
        if (err) {
            console.error('Error fetching products:', err);
            return sendResponse({
                success: false,
                message: 'Failed to fetch products',
                error: err.message
            }, 500);
        }
        
        if (!products || products.length === 0) {
            return sendResponse({
                success: true,
                message: 'No products found to recalculate',
                updated: 0
            });
        }
        
        console.log(`Recalculating quantities for ${products.length} products...`);
        let updated = 0;
        let errors = 0;
        let processed = 0;
        
        const processNext = (index) => {
            if (index >= products.length) {
                sendResponse({
                    success: true,
                    message: `Recalculated quantities for ${updated} products`,
                    updated: updated,
                    errors: errors,
                    total: products.length
                });
            return;
        }
        
            const product = products[index];
            const productId = product._id;
            
            // Query all batches for this product - try both numeric and string productId
            const productIdNum = typeof productId === 'number' ? productId : parseInt(productId);
            const productIdStr = String(productId);
            
            // Define handler function first
            function handleBatchQueryResult(batchErr, batches) {
                if (batchErr) {
                    console.error(`Error fetching batches for product ${productId}:`, batchErr);
                    errors++;
                    processed++;
                    processNext(index + 1);
                    return;
                }
                
                console.log(`[Recalculate] Product ${productId}: Found ${batches ? batches.length : 0} batches`);
                
                // Calculate total from batches
                const totalBatchQuantity = Array.isArray(batches)
                    ? batches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0)
                    : 0;
                
                // Calculate earliest expiry from all batches
                // Only consider batches that haven't expired yet (future expiry dates)
                const today = new Date();
                today.setHours(0, 0, 0, 0); // Start of today for comparison
                
                const earliestExpiry = batches && batches.length > 0
                    ? batches
                        .map(b => b.expiryDate)
                        .filter(Boolean)
                        .map(d => new Date(d))
                        .filter(date => !Number.isNaN(date.getTime()))
                        .filter(date => date >= today) // Only future expiry dates
                        .sort((a, b) => a - b)[0]
                    : null;
                
                const currentQuantity = Number(product.quantity || 0);
                
                // Check if expiry needs updating (compare current product expiry with earliest batch expiry)
                const currentExpiry = product.expiryDate || product.expirationDate;
                const needsExpiryUpdate = earliestExpiry && (
                    !currentExpiry || 
                    new Date(currentExpiry).getTime() !== earliestExpiry.getTime()
                );
                
                // Always update expiry if it's different, even if quantity matches
                // Also update if quantity is different OR expiry needs updating
                const shouldUpdate = totalBatchQuantity !== currentQuantity || needsExpiryUpdate;
                
                if (shouldUpdate) {
                    const updateFields = {
                        quantity: totalBatchQuantity,
                        stock: 1, // Ensure stock checking is enabled
            updatedAt: new Date()
        };
        
                    // Update received date if not already set or if batches were recently updated
                    if (!product.lastReceived || !product.receivedDate) {
                        updateFields.lastReceived = new Date();
                        updateFields.receivedDate = new Date().toISOString().slice(0, 10);
                    }
                    
                    // ALWAYS update product expiry from earliest batch expiry (only if future date)
                    // This ensures expiry is always in sync with batches
                    if (earliestExpiry) {
                        updateFields.expirationDate = earliestExpiry.toISOString().slice(0, 10);
                        updateFields.expiryDate = earliestExpiry.toISOString().slice(0, 10);
                        console.log(`[Recalculate] Updating expiry for product ${productId}: ${currentExpiry || 'N/A'} → ${earliestExpiry.toISOString().slice(0, 10)}`);
                    } else {
                        // No future expiry dates - clear expiry fields to prevent showing as expired
                        updateFields.expirationDate = null;
                        updateFields.expiryDate = null;
                        if (currentExpiry) {
                            console.log(`[Recalculate] Clearing expired expiry for product ${productId}: ${currentExpiry} → null`);
                        }
                    }
                    
                    // ALWAYS update batchSummary (even if no batches) to ensure consistency
                    // This ensures the products API can use batchSummary.totalQuantity
                    if (batches && batches.length > 0) {
                        updateFields.batchSummary = {
                            totalQuantity: totalBatchQuantity,
                            batchCount: batches.length,
                            earliestExpiry: earliestExpiry ? earliestExpiry.toISOString().slice(0, 10) : null
                        };
                    } else {
                        // If no batches, set batchSummary to match current quantity
                        updateFields.batchSummary = {
                            totalQuantity: totalBatchQuantity || currentQuantity,
                            batchCount: 0,
                            earliestExpiry: null
                        };
                    }
                    
                    console.log(`[Recalculate] Updating product ${productId}: quantity ${currentQuantity} → ${totalBatchQuantity}, stock: 1`);
        
        inventoryDB.update(
            { _id: productId },
                        { $set: updateFields },
                        {},
                        function (updateErr) {
                            if (updateErr) {
                                console.error(`Error updating product ${productId}:`, updateErr);
                                errors++;
                } else {
                                console.log(`✅ Updated product ${productId} (${product.name}): ${currentQuantity} → ${totalBatchQuantity} (${batches.length} batches)`);
                                updated++;
                            }
                            processed++;
                            processNext(index + 1);
                        }
                    );
                } else {
                    // Even if quantity matches, check if expiry needs updating
                    // This handles cases where batches were updated but product expiry wasn't
                    if (needsExpiryUpdate) {
                        console.log(`[Recalculate] Updating expiry only for product ${productId} (${product.name}): ${currentExpiry || 'N/A'} → ${earliestExpiry ? earliestExpiry.toISOString().slice(0, 10) : 'null'}`);
                        const expiryUpdateFields = {
                            updatedAt: new Date()
                        };
                        
                        if (earliestExpiry) {
                            expiryUpdateFields.expirationDate = earliestExpiry.toISOString().slice(0, 10);
                            expiryUpdateFields.expiryDate = earliestExpiry.toISOString().slice(0, 10);
                        } else {
                            expiryUpdateFields.expirationDate = null;
                            expiryUpdateFields.expiryDate = null;
                        }
                        
                        // ALWAYS update batchSummary (even if no batches) to ensure consistency
                        if (batches && batches.length > 0) {
                            expiryUpdateFields.batchSummary = {
                                totalQuantity: totalBatchQuantity,
                                batchCount: batches.length,
                                earliestExpiry: earliestExpiry ? earliestExpiry.toISOString().slice(0, 10) : null
                            };
                        } else {
                            // If no batches, set batchSummary to match current quantity
                            expiryUpdateFields.batchSummary = {
                                totalQuantity: totalBatchQuantity || currentQuantity,
                                batchCount: 0,
                                earliestExpiry: null
                            };
                        }
                        
                        inventoryDB.update(
                            { _id: productId },
                            { $set: expiryUpdateFields },
                            {},
                            function (expiryErr) {
                                if (expiryErr) {
                                    console.error(`Error updating expiry for product ${productId}:`, expiryErr);
                                    errors++;
                                } else {
                                    console.log(`✅ Updated expiry for product ${productId} (${product.name})`);
                                    updated++;
                                }
                                processed++;
                                processNext(index + 1);
                            }
                        );
                    } else {
                        // Even if quantity and expiry match, ensure stock is enabled, received date is set, and batchSummary exists
                        const needsUpdate = product.stock !== 1 || !product.receivedDate || !product.lastReceived || !product.batchSummary;
                        if (needsUpdate) {
                            console.log(`[Recalculate] Fixing product ${productId} (${product.name}): stock=${product.stock}, hasReceivedDate=${!!product.receivedDate}, hasBatchSummary=${!!product.batchSummary}`);
                            const fixFields = {
                                stock: 1,
                                updatedAt: new Date()
                            };
                            if (!product.receivedDate) {
                                fixFields.receivedDate = new Date().toISOString().slice(0, 10);
                            }
                            if (!product.lastReceived) {
                                fixFields.lastReceived = new Date();
                            }
                            // Always ensure batchSummary is set
                            if (!product.batchSummary) {
                                fixFields.batchSummary = {
                                    totalQuantity: totalBatchQuantity || currentQuantity,
                                    batchCount: batches ? batches.length : 0,
                                    earliestExpiry: earliestExpiry ? earliestExpiry.toISOString().slice(0, 10) : null
                                };
                            }
                            
                            inventoryDB.update(
                                { _id: productId },
                                { $set: fixFields },
                                {},
                                function (fixErr) {
                                    if (fixErr) {
                                        console.error(`Error fixing product ${productId}:`, fixErr);
                                        errors++;
                                    } else {
                                        console.log(`✅ Fixed product ${productId} (${product.name}): stock=1, receivedDate set`);
                                        updated++;
                                    }
                                    processed++;
                                    processNext(index + 1);
                                }
                            );
                        } else {
                            processed++;
                            processNext(index + 1);
                        }
                    }
                }
            }
            
            // Try numeric query first
            inventoryBatchesDB.find({ productId: productIdNum }, function (batchErr, batchesNum) {
                if (batchErr) {
                    console.error(`Error fetching batches for product ${productId} (numeric):`, batchErr);
                    // Try string query as fallback
                    inventoryBatchesDB.find({ productId: productIdStr }, function (batchErr2, batchesStr) {
                        handleBatchQueryResult(batchErr2, batchesStr || []);
                    });
                    return;
                }
                
                // If numeric query found batches, use them; otherwise try string query
                if (batchesNum && batchesNum.length > 0) {
                    handleBatchQueryResult(null, batchesNum);
                } else {
                    // Try string query as fallback
                    inventoryBatchesDB.find({ productId: productIdStr }, function (batchErr2, batchesStr) {
                        if (!batchErr2 && batchesStr && batchesStr.length > 0) {
                            handleBatchQueryResult(null, batchesStr);
                        } else {
                            // No batches found with either query
                            handleBatchQueryResult(null, []);
                        }
                    });
                }
            });
        };
        
        processNext(0);
    });
});

/**
 * GET endpoint: List all batches (for debugging)
 */
app.get("/batches/all", function (req, res) {
    const fs = require('fs');
    const dbFilePath = inventoryBatchesDB.filename;
    
    console.log(`\n=== ALL BATCHES DEBUG ENDPOINT ===`);
    console.log(`Database file path: ${dbFilePath}`);
    console.log(`File exists: ${fs.existsSync(dbFilePath)}`);
    
    if (!fs.existsSync(dbFilePath)) {
        return res.json({ success: true, batches: [], message: "Batch database file does not exist", filePath: dbFilePath });
    }
    
    try {
        const fileStats = fs.statSync(dbFilePath);
        const fileContent = fs.readFileSync(dbFilePath, 'utf8');
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
        
        const allBatches = Array.from(latestById.values());
        const productIdGroups = {};
        allBatches.forEach(batch => {
            const pid = String(batch.productId || 'unknown');
            if (!productIdGroups[pid]) {
                productIdGroups[pid] = [];
            }
            productIdGroups[pid].push({
                _id: batch._id,
                productId: batch.productId,
                quantity: batch.quantity,
                lotNumber: batch.lotNumber
            });
        });
        
        console.log(`Total batches: ${allBatches.length}`);
        console.log(`Batches by productId:`, Object.keys(productIdGroups).map(pid => `${pid}: ${productIdGroups[pid].length}`).join(', '));
        
        res.json({ 
            success: true, 
            batches: allBatches,
            total: allBatches.length,
            filePath: dbFilePath,
            fileSize: fileStats.size,
            batchesByProduct: productIdGroups
        });
    } catch (err) {
        console.error('Error reading batches:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = app;
