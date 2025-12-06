const http = require("http");
const express = require("express");
const app = express();
const server = http.createServer(app);
const bodyParser = require("body-parser");
const rateLimit = require("express-rate-limit");
const path = require("path");
const pkg = require("./package.json");

// Initialize environment variables for Electron app
try {
    const {app} = require('electron');
    if (app && app.getPath) {
        process.env.APPDATA = app.getPath('appData');
        process.env.APPNAME = pkg.name;
    }
} catch (error) {
    // Fallback for non-Electron environments
    process.env.APPDATA = process.env.APPDATA || require('os').homedir();
    process.env.APPNAME = pkg.name;
}

// Ensure APPNAME is always set
if (!process.env.APPNAME) {
    process.env.APPNAME = pkg.name;
}
const PORT = process.env.PORT || 0;
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10000, // 10000 requests per window (very high for local app)
    message: {
        error: "Too Many Requests",
        message: "Rate limit exceeded. Please try again later."
    },
    // Skip rate limiting for static files and common paths
    skip: function (req) {
        // Skip rate limiting for:
        // - Static file requests (assets, images, etc.)
        // - Root path requests
        // - Development mode
        if (process.env.NODE_ENV === 'dev') {
            return true; // Disable rate limiting in development
        }
        
        // Skip static file extensions
        const staticExtensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
        const path = req.path.toLowerCase();
        if (staticExtensions.some(ext => path.endsWith(ext))) {
            return true;
        }
        
        // Skip root and common static paths
        if (path === '/' || path.startsWith('/assets/') || path.startsWith('/uploads/')) {
            return true;
        }
        
        return false;
    },
    // Use IP-based tracking, but be lenient
    keyGenerator: function (req) {
        // For localhost, use a single key to avoid per-IP limits
        if (req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1') {
            return 'localhost';
        }
        return req.ip;
    }
});

console.log("Server started");

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.all("/*", function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
    res.header(
        "Access-Control-Allow-Headers",
        "Content-type,Accept,X-Access-Token,X-Key",
    );
    if (req.method == "OPTIONS") {
        res.status(200).end();
    } else {
        next();
    }
});

// Serve static files (CSS, JS, images, etc.) - NO rate limiting
app.use(express.static(__dirname));

// Serve uploaded files (logos, product images, etc.) - NO rate limiting
const uploadsPath = path.join(process.env.APPDATA || require('os').homedir(), process.env.APPNAME || pkg.name, "uploads");
app.use("/uploads", express.static(uploadsPath));

app.get("/", function (req, res) {
    // Serve the main HTML file - NO rate limiting
    res.sendFile(path.join(__dirname, "index.html"));
});

// Apply rate limiting ONLY to API routes (not static files)
app.use("/api", limiter);

app.use("/api/inventory", require("./api/inventory"));
app.use("/api/customers", require("./api/customers"));
app.use("/api/categories", require("./api/categories"));
app.use("/api/manufacturers", require("./api/manufacturers"));
app.use("/api/suppliers", require("./api/suppliers"));
app.use("/api/purchase-orders", require("./api/purchase-orders"));
app.use("/api/settings", require("./api/settings"));
app.use("/api/users", require("./api/users"));
app.use("/api/backup-restore", require("./api/backup-restore"));
app.use("/api", require("./api/transactions"));

server.listen(PORT, () => {
    process.env.PORT = server.address().port;
    console.log("Listening on PORT", process.env.PORT);
});