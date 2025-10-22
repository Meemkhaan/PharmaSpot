const http = require("http");
const express = require("express")();
const server = http.createServer(express);
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
    max: 100, // 100 requests per window
});

console.log("Server started");

express.use(bodyParser.json());
express.use(bodyParser.urlencoded({ extended: false }));
express.use(limiter);

express.all("/*", function (req, res, next) {
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

// Serve static files (CSS, JS, images, etc.)
express.use(express.static(__dirname));

express.get("/", function (req, res) {
    // Serve the main HTML file
    res.sendFile(path.join(__dirname, "index.html"));
});

express.use("/api/inventory", require("./api/inventory"));
express.use("/api/customers", require("./api/customers"));
express.use("/api/categories", require("./api/categories"));
express.use("/api/manufacturers", require("./api/manufacturers"));
express.use("/api/suppliers", require("./api/suppliers"));
express.use("/api/purchase-orders", require("./api/purchase-orders"));
express.use("/api/settings", require("./api/settings"));
express.use("/api/users", require("./api/users"));
express.use("/api", require("./api/transactions"));

server.listen(PORT, () => {
    process.env.PORT = server.address().port;
    console.log("Listening on PORT", process.env.PORT);
});