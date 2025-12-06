const app = require("express")();
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { pipeline } = require("stream");
const { promisify } = require("util");
const pipelineAsync = promisify(pipeline);

// Try to use archiver if available, otherwise use built-in zlib
let archiver, unzipper;
try {
    archiver = require("archiver");
    unzipper = require("unzipper");
} catch (err) {
    console.warn("[Backup-Restore] archiver/unzipper not available, will use alternative method");
    // We'll implement a simple zip alternative if needed
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database paths
const appData = process.env.APPDATA || require('os').homedir();
const appName = process.env.APPNAME || "PharmaSpot";
const databasesPath = path.join(appData, appName, "server", "databases");
const uploadsPath = path.join(appData, appName, "uploads");
const settingsPath = path.join(appData, appName, "server");
const backupsPath = path.join(appData, appName, "backups");

// Ensure backups directory exists
if (!fs.existsSync(backupsPath)) {
    fs.mkdirSync(backupsPath, { recursive: true });
}

// List of all database files to backup
const databaseFiles = [
    "users.db",
    "inventory.db",
    "inventory-batches.db",
    "customers.db",
    "categories.db",
    "manufacturers.db",
    "suppliers.db",
    "purchase-orders.db",
    "transactions.db",
    "settings.db"
];

/**
 * GET endpoint: Get backup status and list available backups
 */
app.get("/status", function (req, res) {
    try {
        const backups = [];
        if (fs.existsSync(backupsPath)) {
            const files = fs.readdirSync(backupsPath);
            files.forEach(file => {
                if (file.endsWith('.zip')) {
                    const filePath = path.join(backupsPath, file);
                    const stats = fs.statSync(filePath);
                    backups.push({
                        filename: file,
                        size: stats.size,
                        created: stats.birthtime,
                        modified: stats.mtime
                    });
                }
            });
        }
        
        // Sort by creation date (newest first)
        backups.sort((a, b) => new Date(b.created) - new Date(a.created));
        
        res.json({
            success: true,
            backupsPath: backupsPath,
            backupsCount: backups.length,
            backups: backups
        });
    } catch (err) {
        console.error("Error getting backup status:", err);
        res.status(500).json({
            error: "Internal Server Error",
            message: "Failed to get backup status."
        });
    }
});

/**
 * POST endpoint: Create a backup of all databases and settings
 */
app.post("/backup", function (req, res) {
    const backupName = req.body.name || `backup_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const backupFileName = `${backupName}.zip`;
    const backupFilePath = path.join(backupsPath, backupFileName);
    
    console.log(`[Backup] Starting backup: ${backupFileName}`);
    
    // Check if archiver is available
    if (!archiver) {
        return res.status(500).json({
            error: "Missing Dependency",
            message: "Backup functionality requires 'archiver' package. Please install it: npm install archiver unzipper"
        });
    }
    
    try {
        // Create a file to stream archive data to
        const output = fs.createWriteStream(backupFilePath);
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });
        
        // Listen for all archive data to be written
        output.on('close', function() {
            const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
            console.log(`[Backup] Backup completed: ${backupFileName} (${sizeMB} MB)`);
            
            // Generate checksum for backup file
            const fileBuffer = fs.readFileSync(backupFilePath);
            const hashSum = crypto.createHash('sha256');
            hashSum.update(fileBuffer);
            const checksum = hashSum.digest('hex');
            
            // Save backup metadata
            const metadata = {
                filename: backupFileName,
                size: archive.pointer(),
                checksum: checksum,
                created: new Date().toISOString(),
                version: require('../../package.json').version,
                databases: databaseFiles.filter(db => {
                    const dbPath = path.join(databasesPath, db);
                    return fs.existsSync(dbPath);
                })
            };
            
            const metadataPath = backupFilePath.replace('.zip', '.json');
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
            
            res.json({
                success: true,
                message: "Backup created successfully",
                backup: {
                    filename: backupFileName,
                    size: archive.pointer(),
                    sizeMB: parseFloat(sizeMB),
                    checksum: checksum,
                    path: backupFilePath
                }
            });
        });
        
        // Handle errors
        archive.on('error', function(err) {
            console.error("[Backup] Archive error:", err);
            res.status(500).json({
                error: "Backup Error",
                message: `Failed to create backup: ${err.message}`
            });
        });
        
        // Pipe archive data to the file
        archive.pipe(output);
        
        // Add all database files
        databaseFiles.forEach(dbFile => {
            const dbPath = path.join(databasesPath, dbFile);
            if (fs.existsSync(dbPath)) {
                archive.file(dbPath, { name: `databases/${dbFile}` });
                console.log(`[Backup] Added database: ${dbFile}`);
            }
        });
        
        // Add settings if they exist
        const settingsDBPath = path.join(databasesPath, "settings.db");
        if (fs.existsSync(settingsDBPath)) {
            archive.file(settingsDBPath, { name: `databases/settings.db` });
        }
        
        // Add uploads directory if it exists
        if (fs.existsSync(uploadsPath)) {
            archive.directory(uploadsPath, 'uploads');
            console.log(`[Backup] Added uploads directory`);
        }
        
        // Add backup metadata to the archive
        const backupInfo = {
            timestamp: new Date().toISOString(),
            version: require('../../package.json').version,
            appName: appName,
            databases: databaseFiles.filter(db => {
                const dbPath = path.join(databasesPath, db);
                return fs.existsSync(dbPath);
            })
        };
        
        archive.append(JSON.stringify(backupInfo, null, 2), { name: 'backup-info.json' });
        
        // Finalize the archive
        archive.finalize();
        
    } catch (err) {
        console.error("[Backup] Error creating backup:", err);
        res.status(500).json({
            error: "Internal Server Error",
            message: `Failed to create backup: ${err.message}`
        });
    }
});

/**
 * POST endpoint: Restore from a backup file
 */
app.post("/restore", function (req, res) {
    const backupFileName = req.body.filename;
    
    if (!backupFileName) {
        return res.status(400).json({
            error: "Validation Error",
            message: "Backup filename is required."
        });
    }
    
    const backupFilePath = path.join(backupsPath, backupFileName);
    
    if (!fs.existsSync(backupFilePath)) {
        return res.status(404).json({
            error: "Not Found",
            message: "Backup file not found."
        });
    }
    
    console.log(`[Restore] Starting restore from: ${backupFileName}`);
    
    // Verify backup file integrity
    try {
        const metadataPath = backupFilePath.replace('.zip', '.json');
        let metadata = null;
        
        if (fs.existsSync(metadataPath)) {
            metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            
            // Verify checksum
            const fileBuffer = fs.readFileSync(backupFilePath);
            const hashSum = crypto.createHash('sha256');
            hashSum.update(fileBuffer);
            const calculatedChecksum = hashSum.digest('hex');
            
            if (calculatedChecksum !== metadata.checksum) {
                return res.status(400).json({
                    error: "Integrity Error",
                    message: "Backup file integrity check failed. The file may be corrupted."
                });
            }
        }
    } catch (err) {
        console.warn("[Restore] Could not verify backup metadata:", err);
        // Continue with restore even if metadata is missing
    }
    
    // Check if unzipper is available
    if (!unzipper) {
        return res.status(500).json({
            error: "Missing Dependency",
            message: "Restore functionality requires 'unzipper' package. Please install it: npm install archiver unzipper"
        });
    }
    
    // Create a temporary directory for extraction
    const tempExtractPath = path.join(backupsPath, 'temp_restore_' + Date.now());
    fs.mkdirSync(tempExtractPath, { recursive: true });
    
    try {
        // Extract the backup
        fs.createReadStream(backupFilePath)
            .pipe(unzipper.Extract({ path: tempExtractPath }))
            .on('close', function() {
                console.log("[Restore] Backup extracted successfully");
                
                try {
                    // Backup current databases before restore (safety measure)
                    const safetyBackupPath = path.join(backupsPath, 'pre_restore_backup_' + Date.now());
                    fs.mkdirSync(safetyBackupPath, { recursive: true });
                    
                    databaseFiles.forEach(dbFile => {
                        const dbPath = path.join(databasesPath, dbFile);
                        if (fs.existsSync(dbPath)) {
                            const safetyBackupFile = path.join(safetyBackupPath, dbFile);
                            fs.copyFileSync(dbPath, safetyBackupFile);
                        }
                    });
                    console.log("[Restore] Created safety backup before restore");
                    
                    // Restore databases
                    const extractedDbPath = path.join(tempExtractPath, 'databases');
                    if (fs.existsSync(extractedDbPath)) {
                        const extractedFiles = fs.readdirSync(extractedDbPath);
                        extractedFiles.forEach(file => {
                            const sourcePath = path.join(extractedDbPath, file);
                            const destPath = path.join(databasesPath, file);
                            
                            if (fs.statSync(sourcePath).isFile()) {
                                fs.copyFileSync(sourcePath, destPath);
                                console.log(`[Restore] Restored database: ${file}`);
                            }
                        });
                    }
                    
                    // Restore uploads if they exist
                    const extractedUploadsPath = path.join(tempExtractPath, 'uploads');
                    if (fs.existsSync(extractedUploadsPath)) {
                        // Remove old uploads
                        if (fs.existsSync(uploadsPath)) {
                            fs.rmSync(uploadsPath, { recursive: true, force: true });
                        }
                        // Copy restored uploads
                        fs.cpSync(extractedUploadsPath, uploadsPath, { recursive: true });
                        console.log("[Restore] Restored uploads directory");
                    }
                    
                    // Clean up temporary extraction directory
                    fs.rmSync(tempExtractPath, { recursive: true, force: true });
                    
                    console.log("[Restore] Restore completed successfully");
                    res.json({
                        success: true,
                        message: "Backup restored successfully. Please restart the application for changes to take effect.",
                        safetyBackup: path.basename(safetyBackupPath)
                    });
                    
                } catch (restoreErr) {
                    console.error("[Restore] Error during restore:", restoreErr);
                    // Clean up temp directory
                    if (fs.existsSync(tempExtractPath)) {
                        fs.rmSync(tempExtractPath, { recursive: true, force: true });
                    }
                    res.status(500).json({
                        error: "Restore Error",
                        message: `Failed to restore backup: ${restoreErr.message}`
                    });
                }
            })
            .on('error', function(err) {
                console.error("[Restore] Extraction error:", err);
                // Clean up temp directory
                if (fs.existsSync(tempExtractPath)) {
                    fs.rmSync(tempExtractPath, { recursive: true, force: true });
                }
                res.status(500).json({
                    error: "Extraction Error",
                    message: `Failed to extract backup: ${err.message}`
                });
            });
            
    } catch (err) {
        console.error("[Restore] Error starting restore:", err);
        // Clean up temp directory
        if (fs.existsSync(tempExtractPath)) {
            fs.rmSync(tempExtractPath, { recursive: true, force: true });
        }
        res.status(500).json({
            error: "Internal Server Error",
            message: `Failed to start restore: ${err.message}`
        });
    }
});

/**
 * DELETE endpoint: Delete a backup file
 */
app.delete("/backup/:filename", function (req, res) {
    const filename = req.params.filename;
    const backupFilePath = path.join(backupsPath, filename);
    const metadataPath = backupFilePath.replace('.zip', '.json');
    
    try {
        if (fs.existsSync(backupFilePath)) {
            fs.unlinkSync(backupFilePath);
            console.log(`[Backup] Deleted backup file: ${filename}`);
        }
        
        if (fs.existsSync(metadataPath)) {
            fs.unlinkSync(metadataPath);
        }
        
        res.json({
            success: true,
            message: "Backup deleted successfully"
        });
    } catch (err) {
        console.error("[Backup] Error deleting backup:", err);
        res.status(500).json({
            error: "Internal Server Error",
            message: `Failed to delete backup: ${err.message}`
        });
    }
});

module.exports = app;
