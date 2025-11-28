const app = require("express")();
const server = require("http").Server(app);
const bodyParser = require("body-parser");
const Datastore = require("@seald-io/nedb");
const bcrypt = require("bcrypt");
const saltRounds = 10;
const validator = require("validator");
const path = require("path");
const dbPath = path.join(
    process.env.APPDATA,
    process.env.APPNAME,
    "server",
    "databases",
    "users.db",
);

app.use(bodyParser.json());

module.exports = app;

let usersDB = new Datastore({
    filename: dbPath,
    autoload: true,
});

usersDB.ensureIndex({ fieldName: "username", unique: true });

/**
 * GET endpoint: Get the welcome message for the Users API.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/", function (req, res) {
    res.send("Users API");
});

/**
 * GET endpoint: Get user details by user ID.
 *
 * @param {Object} req request object with user ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/user/:userId", function (req, res) {
    if (!req.params.userId) {
        res.status(500).send("ID field is required.");
    } else {
        usersDB.findOne(
            {
                _id: parseInt(req.params.userId),
            },
            function (err, docs) {
                res.send(docs);
            },
        );
    }
});

/**
 * GET endpoint: Log out a user by updating the user status.
 *
 * @param {Object} req request object with user ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/logout/:userId", function (req, res) {
    if (!req.params.userId) {
        res.status(500).send("ID field is required.");
    } else {
        usersDB.update(
            {
                _id: parseInt(req.params.userId),
            },
            {
                $set: {
                    status: "Logged Out_" + new Date(),
                },
            },
            {},
        );

        res.sendStatus(200);
    }
});

/**
 * POST endpoint: Authenticate user login and update user status.
 *
 * @param {Object} req request object with login credentials in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/login", function (req, res) {
    usersDB.findOne(
        {
            username: validator.escape(req.body.username),
        },
        function (err, docs) {
            if (docs) {
                //verify password
                bcrypt
                    .compare(req.body.password, docs.password)
                    .then((result) => {
                        if (result) {
                            const loginTime = new Date();
                            usersDB.update(
                                {
                                    _id: docs._id,
                                },
                                {
                                    $set: {
                                        status: "Logged In_" + loginTime,
                                        lastLogin: loginTime,
                                    },
                                },
                                {},
                            );
                            res.send({ ...docs, auth: true });
                        }
                        //Invalid password
                        else res.send({ auth: false });
                    })
                    .catch((err) =>
                        res.send({ auth: false, message: err.message }),
                    );
            }
            //No user Account
            else res.send({ auth: false });
        },
    );
});

/**
 * GET endpoint: Get details of all users.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/all", function (req, res) {
    usersDB.find({}).sort({ createdAt: -1, _id: -1 }).exec(function (err, docs) {
        if (err) {
            console.error("Error fetching users:", err);
            res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to fetch users."
            });
            return;
        }
        
        // If sort didn't work, sort manually
        if (docs && docs.length > 0) {
            docs.sort((a, b) => {
                // Sort by createdAt descending (newest first)
                const dateA = a.createdAt ? new Date(a.createdAt).getTime() : (a._id || 0);
                const dateB = b.createdAt ? new Date(b.createdAt).getTime() : (b._id || 0);
                if (dateB !== dateA) {
                    return dateB - dateA; // Descending order
                }
                // If dates are equal, sort by _id descending
                return (b._id || 0) - (a._id || 0);
            });
        }
        
        res.send(docs);
    });
});

/**
 * DELETE endpoint: Delete a user by user ID.
 *
 * @param {Object} req request object with user ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.delete("/user/:userId", function (req, res) {
    usersDB.remove(
        {
            _id: parseInt(req.params.userId),
        },
        function (err, numRemoved) {
            if (err) {
                console.error(err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: `An unexpected error occurred. ${err}`,
                });
            } else {
                res.sendStatus(200);
            }
        },
    );
});

/**
 * POST endpoint: Create or update a user.
 *
 * @param {Object} req request object with user data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/post", function (req, res) {
    // Validate email if provided
    if (req.body.email && req.body.email.trim() !== "") {
        if (!validator.isEmail(req.body.email)) {
            return res.status(400).json({
                error: "Validation Error",
                message: "Invalid email address format.",
            });
        }
    }
    
    // Validate username
    if (!req.body.username || req.body.username.trim() === "") {
        return res.status(400).json({
            error: "Validation Error",
            message: "Username is required.",
        });
    }
    
    // Check if password is required (new user) or optional (update)
    const isNewUser = req.body.id === "";
    if (isNewUser && (!req.body.password || req.body.password.trim() === "")) {
        return res.status(400).json({
            error: "Validation Error",
            message: "Password is required for new users.",
        });
    }
    
    // Validate password match if password is provided
    if (req.body.password && req.body.password.trim() !== "") {
        if (req.body.password !== req.body.pass) {
            return res.status(400).json({
                error: "Validation Error",
                message: "Passwords do not match.",
            });
        }
        
        // Validate password strength (minimum 6 characters)
        if (req.body.password.length < 6) {
            return res.status(400).json({
                error: "Validation Error",
                message: "Password must be at least 6 characters long.",
            });
        }
    }
    
    // Process password encryption
    const processUser = (passwordHash) => {
        if (passwordHash) {
            req.body.password = passwordHash;
        }
        
        const perms = [
            "perm_products",
            "perm_categories",
            "perm_manufacturers",
            "perm_suppliers",
            "perm_transactions",
            "perm_users",
            "perm_settings",
        ];

        for (const perm of perms) {
            if (!!req.body[perm]) {
                req.body[perm] = req.body[perm] === "on" ? 1 : 0;
            } else {
                //create missing permission only with new users
                if(req.body.id==="")
                {
                  req.body[perm] = 0;  
                }
            }
        }

        let User = {
            ...req.body,
            status: req.body.status || "",
        };
        delete User.id;
        delete User.pass;
        
        // Set default role if not provided
        if (!User.role) {
            User.role = "cashier";
        }
        
        // CRITICAL SECURITY: System Admin (ID: 1) Protection
        const userId = parseInt(req.body.id);
        const isSystemAdmin = userId === 1;
        
        if (isSystemAdmin) {
            // System admin (ID: 1) CANNOT change their role or lose admin rights
            // Force role to "admin" and ensure all admin permissions
            User.role = "admin";
            User.perm_settings = 1;
            User.perm_users = 1; // System admin must be able to manage users
            console.log(`[SECURITY] System Admin (ID: 1) role and permissions protected - forced to admin`);
        }
        
        // CRITICAL: Settings permission is restricted to admin only
        // Only users with role "admin" or _id === 1 (system admin) can have settings permission
        const isAdmin = User.role === "admin" || isSystemAdmin || (!req.body.id && User.role === "admin");
        
        if (!isAdmin) {
            // Non-admin users cannot have settings permission - force it to 0
            User.perm_settings = 0;
            console.log(`[User Update] Removed settings permission from non-admin user (ID: ${req.body.id || 'new'}, Role: ${User.role})`);
        } else {
            // Admin users must always have settings permission
            User.perm_settings = 1;
            console.log(`[User Update] Ensured settings permission for admin user (ID: ${req.body.id || 'new'}, Role: ${User.role})`);
        }
        
        // Function to proceed with user update
        const proceedWithUpdate = () => {
            if (req.body.id === "") {
                // New user
                User._id = Math.floor(Date.now() / 1000);
                User.createdAt = new Date();
                User.updatedAt = new Date();
                
                usersDB.insert(User, function (err, user) {
                    if (err) {
                        console.error(err);
                        if (err.errorType === "uniqueViolated") {
                            res.status(400).json({
                                error: "Validation Error",
                                message: "Username already exists. Please choose a different username.",
                            });
                        } else {
                            res.status(500).json({
                                error: "Internal Server Error",
                                message: `An unexpected error occurred. ${err}`,
                            });
                        }
                    }
                    else {
                        res.json({
                            success: true,
                            message: "User created successfully",
                            user: user
                        });
                    }
                });
            } else {
                // Update existing user
                User.updatedAt = new Date();
                
                // If password is not provided, don't update it
                if (!req.body.password || req.body.password.trim() === "") {
                    delete User.password;
                }
                
                usersDB.update(
                    {
                        _id: parseInt(req.body.id),
                    },
                    {
                        $set: User,
                    },
                    {},
                    function (err, numReplaced) {
                        if (err) {
                            console.error(err);
                            if (err.errorType === "uniqueViolated") {
                                res.status(400).json({
                                    error: "Validation Error",
                                    message: "Username already exists. Please choose a different username.",
                                });
                            } else {
                                res.status(500).json({
                                    error: "Internal Server Error",
                                    message: `An unexpected error occurred. ${err}`,
                                });
                            }
                        }
                        else {
                            if (numReplaced === 0) {
                                res.status(404).json({
                                    error: "Not Found",
                                    message: "User not found.",
                                });
                            } else {
                                res.json({
                                    success: true,
                                    message: "User updated successfully"
                                });
                            }
                        }
                    },
                );
            }
        };
        
        // CRITICAL: Ensure at least one admin exists (only for updates, not new users)
        if (!isSystemAdmin && userId) {
            // Check if this user change would remove the last admin
            usersDB.findOne({ _id: userId }, function (findErr, existingUser) {
                if (findErr || !existingUser) {
                    // User not found, proceed normally (will fail in update anyway)
                    proceedWithUpdate();
                    return;
                }
                
                const wasAdmin = existingUser.role === "admin" || existingUser._id === 1;
                const willBeAdmin = User.role === "admin";
                
                if (wasAdmin && !willBeAdmin) {
                    // User is changing from admin to non-admin - check if there are other admins
                    usersDB.find({ 
                        $or: [
                            { role: "admin" },
                            { _id: 1 }
                        ],
                        _id: { $ne: userId }
                    }, function (checkErr, otherAdmins) {
                        if (checkErr) {
                            console.error("Error checking for other admins:", checkErr);
                            proceedWithUpdate();
                            return;
                        }
                        
                        const activeAdmins = (otherAdmins || []).filter(a => 
                            a._id !== userId && (a.role === "admin" || a._id === 1)
                        );
                        
                        if (activeAdmins.length === 0) {
                            // This is the last admin - prevent role change
                            console.error(`[SECURITY] BLOCKED: Cannot change last admin user (ID: ${userId}) to non-admin role`);
                            return res.status(400).json({
                                error: "Security Error",
                                message: "Cannot change role: This is the last administrator. At least one admin user must exist. Please create another admin user first, or use the emergency admin recovery if you are locked out.",
                            });
                        }
                        
                        // Other admins exist, proceed with update
                        proceedWithUpdate();
                    });
                } else {
                    // Not removing admin, proceed normally
                    proceedWithUpdate();
                }
            });
        } else {
            // New user or system admin, proceed normally
            proceedWithUpdate();
        }
    
    // Encrypt password if provided
    if (req.body.password && req.body.password.trim() !== "") {
        bcrypt
            .hash(req.body.password, saltRounds)
            .then((hash) => {
                processUser(hash);
            })
            .catch((err) => {
                console.error(err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: `An unexpected error occurred. ${err}`,
                });
            });
    } else {
        // No password provided (update without changing password)
        processUser(null);
    }
});

/**
 * GET endpoint: Check and initialize the default admin user if not exists.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/check", function (req, res) {
    usersDB.findOne(
        {
            _id: 1,
        },
        function (err, docs) {
            if (!docs) {
                // Create new admin user
                bcrypt
                    .hash("admin", saltRounds)
                    .then((hash) => {
                        let user = {
                            _id: 1,
                            username: "admin",
                            fullname: "Administrator",
                            email: "admin@pharmaspot.local",
                            role: "admin",
                            perm_products: 1,
                            perm_categories: 1,
                            perm_manufacturers: 1,
                            perm_suppliers: 1,
                            perm_transactions: 1,
                            perm_users: 1,
                            perm_settings: 1,
                            status: "",
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        };
                        user.password = hash;
                        usersDB.insert(user, function (err, user) {
                            if (err) {
                                console.error(err);
                                res.status(500).json({
                                    error: "Internal Server Error",
                                    message: `An unexpected error occurred. ${err}`,
                                });
                            } else {
                                console.log("✅ Default admin user created successfully");
                                res.json({ success: true, message: "Admin user initialized" });
                            }
                        });
                    })
                    .catch((err) => 
                        {
                            console.error(err);
                            res.status(500).json({
                                    error: "Internal Server Error",
                                    message: `An unexpected error occurred. ${err}`
                                });
                        });
            } else {
                // Admin user exists - update it with new fields if missing
                const needsUpdate = !docs.role || !docs.email || !docs.createdAt || docs.perm_settings !== 1;
                if (needsUpdate) {
                    const updateData = {};
                    if (!docs.role) {
                        updateData.role = "admin";
                    }
                    if (!docs.email) {
                        updateData.email = "admin@pharmaspot.local";
                    }
                    if (!docs.createdAt) {
                        updateData.createdAt = new Date();
                    }
                    // Ensure admin always has settings permission
                    if (docs.perm_settings !== 1) {
                        updateData.perm_settings = 1;
                    }
                    updateData.updatedAt = new Date();
                    
                    usersDB.update(
                        { _id: 1 },
                        { $set: updateData },
                        {},
                        function (updateErr, numReplaced) {
                            if (updateErr) {
                                console.error("Error updating admin user:", updateErr);
                            } else if (numReplaced > 0) {
                                console.log("✅ Admin user updated with new fields (role, email, timestamps, settings permission)");
                            }
                            
                            // Also migrate all non-admin users to remove settings permission
                            usersDB.find({ _id: { $ne: 1 } }, function (findErr, allUsers) {
                                if (!findErr && allUsers && allUsers.length > 0) {
                                    let migratedCount = 0;
                                    allUsers.forEach((u) => {
                                        const isAdmin = u.role === "admin" || u._id === 1;
                                        if (!isAdmin && u.perm_settings === 1) {
                                            usersDB.update(
                                                { _id: u._id },
                                                { $set: { perm_settings: 0, updatedAt: new Date() } },
                                                {},
                                                function (migrateErr) {
                                                    if (!migrateErr) {
                                                        migratedCount++;
                                                        console.log(`✅ Removed settings permission from non-admin user: ${u.username} (ID: ${u._id})`);
                                                    }
                                                }
                                            );
                                        }
                                    });
                                    if (migratedCount > 0) {
                                        console.log(`✅ Migration complete: Removed settings permission from ${migratedCount} non-admin user(s)`);
                                    }
                                }
                            });
                            
                            res.json({ success: true, message: "Admin user exists", updated: numReplaced > 0 });
                        }
                    );
                } else {
                    // Still run migration check even if admin doesn't need update
                    usersDB.find({ _id: { $ne: 1 } }, function (findErr, allUsers) {
                        if (!findErr && allUsers && allUsers.length > 0) {
                            let migratedCount = 0;
                            allUsers.forEach((u) => {
                                const isAdmin = u.role === "admin" || u._id === 1;
                                if (!isAdmin && u.perm_settings === 1) {
                                    usersDB.update(
                                        { _id: u._id },
                                        { $set: { perm_settings: 0, updatedAt: new Date() } },
                                        {},
                                        function (migrateErr) {
                                            if (!migrateErr) {
                                                migratedCount++;
                                                console.log(`✅ Removed settings permission from non-admin user: ${u.username} (ID: ${u._id})`);
                                            }
                                        }
                                    );
                                }
                            });
                            if (migratedCount > 0) {
                                console.log(`✅ Migration complete: Removed settings permission from ${migratedCount} non-admin user(s)`);
                            }
                        }
                    });
                    
                    res.json({ success: true, message: "Admin user exists" });
                }
            }
        },
    );
});

/**
 * POST endpoint: Emergency admin recovery - restore admin rights to system admin (ID: 1)
 * This endpoint can be used if admin is accidentally locked out
 * Usage: POST /api/users/emergency-admin-recovery
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/emergency-admin-recovery", function (req, res) {
    console.warn("⚠️ EMERGENCY ADMIN RECOVERY ENDPOINT CALLED");
    
    usersDB.findOne({ _id: 1 }, function (err, adminUser) {
        if (err) {
            console.error("Error finding admin user:", err);
            return res.status(500).json({
                error: "Internal Server Error",
                message: "Failed to find admin user."
            });
        }
        
        if (!adminUser) {
            return res.status(404).json({
                error: "Not Found",
                message: "System admin user (ID: 1) not found."
            });
        }
        
        // Restore admin rights
        const recoveryData = {
            role: "admin",
            perm_settings: 1,
            perm_users: 1,
            perm_products: 1,
            perm_categories: 1,
            perm_manufacturers: 1,
            perm_suppliers: 1,
            perm_transactions: 1,
            updatedAt: new Date()
        };
        
        usersDB.update(
            { _id: 1 },
            { $set: recoveryData },
            {},
            function (updateErr, numReplaced) {
                if (updateErr) {
                    console.error("Error recovering admin:", updateErr);
                    return res.status(500).json({
                        error: "Internal Server Error",
                        message: "Failed to recover admin rights."
                    });
                }
                
                if (numReplaced === 0) {
                    return res.status(404).json({
                        error: "Not Found",
                        message: "Admin user not found."
                    });
                }
                
                console.log("✅ Emergency admin recovery successful - admin rights restored to user ID: 1");
                res.json({
                    success: true,
                    message: "Admin rights successfully restored to system administrator (ID: 1). You can now log in with admin/admin credentials.",
                    username: adminUser.username || "admin"
                });
            }
        );
    });
});