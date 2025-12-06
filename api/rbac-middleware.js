/**
 * RBAC Middleware for Express Routes
 * Provides authentication and authorization middleware
 * 
 * This middleware works with client-side authentication where user ID is passed
 * in request parameters or body. It automatically looks up the user from the database.
 */

const { userHasPermission, PERMISSIONS } = require('./rbac-config');
const path = require('path');
const Datastore = require('@seald-io/nedb');

// Initialize users database for user lookup
const usersDBPath = path.join(
    process.env.APPDATA,
    process.env.APPNAME,
    "server",
    "databases",
    "users.db",
);

let usersDB = null;
try {
    usersDB = new Datastore({
        filename: usersDBPath,
        autoload: true,
    });
} catch (err) {
    console.warn('[RBAC] Could not load users database for middleware:', err.message);
}

/**
 * Middleware to load user from database based on userId in request
 * Looks for userId in: req.params.userId, req.body.userId, req.body.id, req.query.userId
 */
function loadUser(req, res, next) {
    // If user is already loaded, skip
    if (req.user) {
        return next();
    }

    // Try to find userId from various sources
    // Check currentUserId first (for logged-in user making the request)
    const userId = req.body.currentUserId ||
                   req.params.userId || 
                   req.body.userId || 
                   req.body.id || 
                   req.query.userId ||
                   (req.body.user && req.body.user._id) ||
                   (req.body.user && req.body.user.id);

    if (!userId) {
        // No userId found - this is OK for public endpoints
        return next();
    }

    // Look up user from database
    if (!usersDB) {
        console.warn('[RBAC] Users database not available for user lookup');
        return next();
    }

    const userIdNum = parseInt(userId);
    if (isNaN(userIdNum)) {
        return next();
    }

    usersDB.findOne({ _id: userIdNum }, (err, user) => {
        if (err) {
            console.error('[RBAC] Error looking up user:', err);
            return next();
        }
        
        if (user) {
            req.user = user;
            // Ensure role is set (default to cashier if missing)
            if (!req.user.role) {
                req.user.role = 'cashier';
            }
        }
        
        next();
    });
}

/**
 * Middleware to check if user is authenticated
 * Requires user to be loaded (use loadUser middleware first)
 */
function isAuthenticated(req, res, next) {
    if (!req.user || !req.user._id) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Authentication required. Please log in.',
        });
    }
    next();
}

/**
 * Middleware factory to check if user has required permission
 * @param {string} permission - Required permission
 * @returns {Function} Express middleware function
 */
function requirePermission(permission) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required.',
            });
        }

        if (!userHasPermission(req.user, permission)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `You do not have permission to perform this action. Required: ${permission}`,
                requiredPermission: permission,
            });
        }

        next();
    };
}

/**
 * Middleware factory to check if user has ANY of the required permissions
 * @param {Array<string>} permissions - Array of permissions (user needs at least one)
 * @returns {Function} Express middleware function
 */
function requireAnyPermission(permissions) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required.',
            });
        }

        const hasPermission = permissions.some(perm => userHasPermission(req.user, perm));

        if (!hasPermission) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `You do not have permission to perform this action. Required one of: ${permissions.join(', ')}`,
                requiredPermissions: permissions,
            });
        }

        next();
    };
}

/**
 * Middleware factory to check if user has ALL of the required permissions
 * @param {Array<string>} permissions - Array of permissions (user needs all)
 * @returns {Function} Express middleware function
 */
function requireAllPermissions(permissions) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required.',
            });
        }

        const hasAllPermissions = permissions.every(perm => userHasPermission(req.user, perm));

        if (!hasAllPermissions) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `You do not have all required permissions. Required: ${permissions.join(', ')}`,
                requiredPermissions: permissions,
            });
        }

        next();
    };
}

/**
 * Middleware to check if user has a specific role
 * @param {string|Array<string>} roles - Role name or array of role names
 * @returns {Function} Express middleware function
 */
function requireRole(roles) {
    const roleArray = Array.isArray(roles) ? roles : [roles];

    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required.',
            });
        }

        if (!roleArray.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `This action requires one of the following roles: ${roleArray.join(', ')}`,
                requiredRoles: roleArray,
                userRole: req.user.role,
            });
        }

        next();
    };
}

/**
 * Middleware to check if user is admin
 */
function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Authentication required.',
        });
    }

    if (req.user.role !== 'admin') {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'This action requires administrator privileges.',
        });
    }

    next();
}

/**
 * Middleware to check if user is system admin (ID: 1)
 */
function requireSystemAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Authentication required.',
        });
    }

    if (req.user._id !== 1) {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'This action requires system administrator privileges.',
        });
    }

    next();
}

/**
 * Middleware to attach user permissions to request
 * Useful for conditional UI rendering
 */
function attachUserPermissions(req, res, next) {
    if (req.user) {
        const { getRolePermissions } = require('./rbac-config');
        const rolePermissions = getRolePermissions(req.user.role);
        const customPermissions = req.user.customPermissions || [];

        // Combine role and custom permissions
        req.userPermissions = [...new Set([...rolePermissions, ...customPermissions])];
    }
    next();
}

/**
 * Helper function to check permission in route handlers
 * @param {Object} user - User object
 * @param {string} permission - Permission to check
 * @param {Object} res - Response object
 * @returns {boolean} True if user has permission, sends error response if not
 */
function checkPermission(user, permission, res) {
    if (!userHasPermission(user, permission)) {
        res.status(403).json({
            error: 'Forbidden',
            message: `You do not have permission to perform this action. Required: ${permission}`,
            requiredPermission: permission,
        });
        return false;
    }
    return true;
}

/**
 * Enhanced ID-based access control helper
 * Checks if user can access/modify a resource based on ownership or permissions
 * @param {Object} user - User object
 * @param {number} resourceUserId - User ID of the resource owner (if applicable)
 * @param {string} permission - Required permission to access others' resources
 * @param {string} ownPermission - Permission to access own resources (optional)
 * @returns {boolean} True if user has access
 */
function canAccessResource(user, resourceUserId, permission, ownPermission = null) {
    if (!user) return false;
    
    // System admin (ID: 1) always has access
    if (user._id === 1) return true;
    
    // If resource belongs to user, check own permission or allow if no ownPermission specified
    if (resourceUserId && user._id === resourceUserId) {
        if (ownPermission) {
            return userHasPermission(user, ownPermission);
        }
        return true; // Users can access their own resources by default
    }
    
    // For others' resources, require the specified permission
    return userHasPermission(user, permission);
}

/**
 * Middleware to check resource ownership or permission
 * @param {Function} getResourceUserId - Function to extract resource owner ID from request
 * @param {string} permission - Permission required to access others' resources
 * @param {string} ownPermission - Permission required to access own resources (optional)
 */
function requireResourceAccess(getResourceUserId, permission, ownPermission = null) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required.',
            });
        }

        const resourceUserId = getResourceUserId(req);
        if (!canAccessResource(req.user, resourceUserId, permission, ownPermission)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You do not have permission to access this resource.',
                requiredPermission: permission,
            });
        }

        next();
    };
}

module.exports = {
    loadUser,
    isAuthenticated,
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
    requireRole,
    requireAdmin,
    requireSystemAdmin,
    attachUserPermissions,
    checkPermission,
    canAccessResource,
    requireResourceAccess,
    PERMISSIONS, // Re-export for convenience
};
