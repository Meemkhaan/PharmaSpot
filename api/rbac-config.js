/**
 * Role-Based Access Control (RBAC) Configuration
 * Defines roles, permissions, and access control rules for PharmaSpot POS
 */

/**
 * Available Permissions in the System
 */
const PERMISSIONS = {
    // Product Management
    PRODUCTS_VIEW: 'products.view',
    PRODUCTS_CREATE: 'products.create',
    PRODUCTS_EDIT: 'products.edit',
    PRODUCTS_DELETE: 'products.delete',
    PRODUCTS_IMPORT: 'products.import',
    PRODUCTS_EXPORT: 'products.export',

    // Category Management
    CATEGORIES_VIEW: 'categories.view',
    CATEGORIES_CREATE: 'categories.create',
    CATEGORIES_EDIT: 'categories.edit',
    CATEGORIES_DELETE: 'categories.delete',

    // Manufacturer Management
    MANUFACTURERS_VIEW: 'manufacturers.view',
    MANUFACTURERS_CREATE: 'manufacturers.create',
    MANUFACTURERS_EDIT: 'manufacturers.edit',
    MANUFACTURERS_DELETE: 'manufacturers.delete',

    // Supplier Management
    SUPPLIERS_VIEW: 'suppliers.view',
    SUPPLIERS_CREATE: 'suppliers.create',
    SUPPLIERS_EDIT: 'suppliers.edit',
    SUPPLIERS_DELETE: 'suppliers.delete',

    // Purchase Orders
    PURCHASE_ORDERS_VIEW: 'purchase_orders.view',
    PURCHASE_ORDERS_CREATE: 'purchase_orders.create',
    PURCHASE_ORDERS_EDIT: 'purchase_orders.edit',
    PURCHASE_ORDERS_DELETE: 'purchase_orders.delete',
    PURCHASE_ORDERS_APPROVE: 'purchase_orders.approve',
    PURCHASE_ORDERS_RECEIVE: 'purchase_orders.receive',

    // Point of Sale
    POS_ACCESS: 'pos.access',
    POS_PROCESS_SALE: 'pos.process_sale',
    POS_APPLY_DISCOUNT: 'pos.apply_discount',
    POS_VOID_TRANSACTION: 'pos.void_transaction',
    POS_REFUND: 'pos.refund',

    // Transactions & Reports
    TRANSACTIONS_VIEW: 'transactions.view',
    TRANSACTIONS_VIEW_ALL: 'transactions.view_all', // View all users' transactions
    TRANSACTIONS_VIEW_OWN: 'transactions.view_own', // View only own transactions
    TRANSACTIONS_EXPORT: 'transactions.export',
    TRANSACTIONS_DELETE: 'transactions.delete',

    // Reports
    REPORTS_VIEW: 'reports.view',
    REPORTS_SALES: 'reports.sales',
    REPORTS_INVENTORY: 'reports.inventory',
    REPORTS_FINANCIAL: 'reports.financial',

    // User Management
    USERS_VIEW: 'users.view',
    USERS_CREATE: 'users.create',
    USERS_EDIT: 'users.edit',
    USERS_DELETE: 'users.delete',
    USERS_MANAGE_ROLES: 'users.manage_roles',

    // Settings
    SETTINGS_VIEW: 'settings.view',
    SETTINGS_EDIT: 'settings.edit',
    SETTINGS_SYSTEM: 'settings.system',

    // Customer Management
    CUSTOMERS_VIEW: 'customers.view',
    CUSTOMERS_CREATE: 'customers.create',
    CUSTOMERS_EDIT: 'customers.edit',
    CUSTOMERS_DELETE: 'customers.delete',
};

/**
 * Role Definitions with Default Permissions
 */
const ROLES = {
    ADMIN: {
        name: 'admin',
        displayName: 'Administrator',
        description: 'Full system access with all permissions',
        permissions: Object.values(PERMISSIONS), // All permissions
        isSystemRole: true,
        canBeDeleted: false,
    },
    MANAGER: {
        name: 'manager',
        displayName: 'Manager',
        description: 'Manage inventory, view reports, and oversee operations',
        permissions: [
            // Product Management - Full Access
            PERMISSIONS.PRODUCTS_VIEW,
            PERMISSIONS.PRODUCTS_CREATE,
            PERMISSIONS.PRODUCTS_EDIT,
            PERMISSIONS.PRODUCTS_DELETE,
            PERMISSIONS.PRODUCTS_IMPORT,
            PERMISSIONS.PRODUCTS_EXPORT,

            // Category Management - Full Access
            PERMISSIONS.CATEGORIES_VIEW,
            PERMISSIONS.CATEGORIES_CREATE,
            PERMISSIONS.CATEGORIES_EDIT,
            PERMISSIONS.CATEGORIES_DELETE,

            // Manufacturer Management - Full Access
            PERMISSIONS.MANUFACTURERS_VIEW,
            PERMISSIONS.MANUFACTURERS_CREATE,
            PERMISSIONS.MANUFACTURERS_EDIT,
            PERMISSIONS.MANUFACTURERS_DELETE,

            // Supplier Management - Full Access
            PERMISSIONS.SUPPLIERS_VIEW,
            PERMISSIONS.SUPPLIERS_CREATE,
            PERMISSIONS.SUPPLIERS_EDIT,
            PERMISSIONS.SUPPLIERS_DELETE,

            // Purchase Orders - Full Access
            PERMISSIONS.PURCHASE_ORDERS_VIEW,
            PERMISSIONS.PURCHASE_ORDERS_CREATE,
            PERMISSIONS.PURCHASE_ORDERS_EDIT,
            PERMISSIONS.PURCHASE_ORDERS_DELETE,
            PERMISSIONS.PURCHASE_ORDERS_APPROVE,
            PERMISSIONS.PURCHASE_ORDERS_RECEIVE,

            // POS - Full Access
            PERMISSIONS.POS_ACCESS,
            PERMISSIONS.POS_PROCESS_SALE,
            PERMISSIONS.POS_APPLY_DISCOUNT,
            PERMISSIONS.POS_VOID_TRANSACTION,
            PERMISSIONS.POS_REFUND,

            // Transactions - View All
            PERMISSIONS.TRANSACTIONS_VIEW,
            PERMISSIONS.TRANSACTIONS_VIEW_ALL,
            PERMISSIONS.TRANSACTIONS_EXPORT,

            // Reports - Full Access
            PERMISSIONS.REPORTS_VIEW,
            PERMISSIONS.REPORTS_SALES,
            PERMISSIONS.REPORTS_INVENTORY,
            PERMISSIONS.REPORTS_FINANCIAL,

            // Users - View Only
            PERMISSIONS.USERS_VIEW,

            // Customers - Full Access
            PERMISSIONS.CUSTOMERS_VIEW,
            PERMISSIONS.CUSTOMERS_CREATE,
            PERMISSIONS.CUSTOMERS_EDIT,
            PERMISSIONS.CUSTOMERS_DELETE,
        ],
        isSystemRole: true,
        canBeDeleted: false,
    },
    CASHIER: {
        name: 'cashier',
        displayName: 'Cashier',
        description: 'Process sales and basic customer operations',
        permissions: [
            // Product Management - View Only
            PERMISSIONS.PRODUCTS_VIEW,

            // Category Management - View Only
            PERMISSIONS.CATEGORIES_VIEW,

            // POS - Basic Access
            PERMISSIONS.POS_ACCESS,
            PERMISSIONS.POS_PROCESS_SALE,

            // Transactions - View Own Only
            PERMISSIONS.TRANSACTIONS_VIEW,
            PERMISSIONS.TRANSACTIONS_VIEW_OWN,

            // Customers - Basic Access
            PERMISSIONS.CUSTOMERS_VIEW,
            PERMISSIONS.CUSTOMERS_CREATE,
            PERMISSIONS.CUSTOMERS_EDIT,
        ],
        isSystemRole: true,
        canBeDeleted: false,
    },
};

/**
 * Permission Groups for UI Organization
 */
const PERMISSION_GROUPS = {
    PRODUCTS: {
        name: 'Product Management',
        permissions: [
            PERMISSIONS.PRODUCTS_VIEW,
            PERMISSIONS.PRODUCTS_CREATE,
            PERMISSIONS.PRODUCTS_EDIT,
            PERMISSIONS.PRODUCTS_DELETE,
            PERMISSIONS.PRODUCTS_IMPORT,
            PERMISSIONS.PRODUCTS_EXPORT,
        ],
    },
    CATEGORIES: {
        name: 'Category Management',
        permissions: [
            PERMISSIONS.CATEGORIES_VIEW,
            PERMISSIONS.CATEGORIES_CREATE,
            PERMISSIONS.CATEGORIES_EDIT,
            PERMISSIONS.CATEGORIES_DELETE,
        ],
    },
    MANUFACTURERS: {
        name: 'Manufacturer Management',
        permissions: [
            PERMISSIONS.MANUFACTURERS_VIEW,
            PERMISSIONS.MANUFACTURERS_CREATE,
            PERMISSIONS.MANUFACTURERS_EDIT,
            PERMISSIONS.MANUFACTURERS_DELETE,
        ],
    },
    SUPPLIERS: {
        name: 'Supplier Management',
        permissions: [
            PERMISSIONS.SUPPLIERS_VIEW,
            PERMISSIONS.SUPPLIERS_CREATE,
            PERMISSIONS.SUPPLIERS_EDIT,
            PERMISSIONS.SUPPLIERS_DELETE,
        ],
    },
    PURCHASE_ORDERS: {
        name: 'Purchase Orders',
        permissions: [
            PERMISSIONS.PURCHASE_ORDERS_VIEW,
            PERMISSIONS.PURCHASE_ORDERS_CREATE,
            PERMISSIONS.PURCHASE_ORDERS_EDIT,
            PERMISSIONS.PURCHASE_ORDERS_DELETE,
            PERMISSIONS.PURCHASE_ORDERS_APPROVE,
            PERMISSIONS.PURCHASE_ORDERS_RECEIVE,
        ],
    },
    POS: {
        name: 'Point of Sale',
        permissions: [
            PERMISSIONS.POS_ACCESS,
            PERMISSIONS.POS_PROCESS_SALE,
            PERMISSIONS.POS_APPLY_DISCOUNT,
            PERMISSIONS.POS_VOID_TRANSACTION,
            PERMISSIONS.POS_REFUND,
        ],
    },
    TRANSACTIONS: {
        name: 'Transactions',
        permissions: [
            PERMISSIONS.TRANSACTIONS_VIEW,
            PERMISSIONS.TRANSACTIONS_VIEW_ALL,
            PERMISSIONS.TRANSACTIONS_VIEW_OWN,
            PERMISSIONS.TRANSACTIONS_EXPORT,
            PERMISSIONS.TRANSACTIONS_DELETE,
        ],
    },
    REPORTS: {
        name: 'Reports',
        permissions: [
            PERMISSIONS.REPORTS_VIEW,
            PERMISSIONS.REPORTS_SALES,
            PERMISSIONS.REPORTS_INVENTORY,
            PERMISSIONS.REPORTS_FINANCIAL,
        ],
    },
    USERS: {
        name: 'User Management',
        permissions: [
            PERMISSIONS.USERS_VIEW,
            PERMISSIONS.USERS_CREATE,
            PERMISSIONS.USERS_EDIT,
            PERMISSIONS.USERS_DELETE,
            PERMISSIONS.USERS_MANAGE_ROLES,
        ],
    },
    SETTINGS: {
        name: 'Settings',
        permissions: [
            PERMISSIONS.SETTINGS_VIEW,
            PERMISSIONS.SETTINGS_EDIT,
            PERMISSIONS.SETTINGS_SYSTEM,
        ],
    },
    CUSTOMERS: {
        name: 'Customer Management',
        permissions: [
            PERMISSIONS.CUSTOMERS_VIEW,
            PERMISSIONS.CUSTOMERS_CREATE,
            PERMISSIONS.CUSTOMERS_EDIT,
            PERMISSIONS.CUSTOMERS_DELETE,
        ],
    },
};

/**
 * Get all permissions for a role
 * @param {string} roleName - The role name
 * @returns {Array<string>} Array of permission strings
 */
function getRolePermissions(roleName) {
    const role = Object.values(ROLES).find(r => r.name === roleName);
    return role ? role.permissions : [];
}

/**
 * Check if a role has a specific permission
 * @param {string} roleName - The role name
 * @param {string} permission - The permission to check
 * @returns {boolean} True if role has permission
 */
function roleHasPermission(roleName, permission) {
    const permissions = getRolePermissions(roleName);
    return permissions.includes(permission);
}

/**
 * Check if a user has a specific permission
 * @param {Object} user - The user object with role and customPermissions
 * @param {string} permission - The permission to check
 * @returns {boolean} True if user has permission
 */
function userHasPermission(user, permission) {
    if (!user) return false;

    // System admin (ID: 1) always has all permissions - ID-based access control
    if (user._id === 1 || user.id === 1) return true;

    // Ensure role is set (default to cashier for backward compatibility)
    const userRole = (user.role || 'cashier').toLowerCase();

    // Admin role always has all permissions (case-insensitive check)
    if (userRole === 'admin' || userRole === 'administrator') {
        return true;
    }

    // Check role-based permissions
    const rolePermissions = getRolePermissions(userRole);
    if (rolePermissions.includes(permission)) return true;

    // Check custom permissions (overrides) - additive to role permissions
    if (user.customPermissions && Array.isArray(user.customPermissions)) {
        return user.customPermissions.includes(permission);
    }

    // Backward compatibility: Check old permission fields for user-related permissions
    // This allows users with perm_users = 1 to edit users even if RBAC isn't fully migrated
    if (permission === PERMISSIONS.USERS_EDIT || permission === PERMISSIONS.USERS_CREATE || permission === PERMISSIONS.USERS_DELETE) {
        if (user.perm_users === 1 || user.perm_users === true) {
            return true;
        }
    }

    // Backward compatibility: Check other old permission fields
    if (permission === PERMISSIONS.PRODUCTS_EDIT || permission === PERMISSIONS.PRODUCTS_CREATE || permission === PERMISSIONS.PRODUCTS_DELETE) {
        if (user.perm_products === 1 || user.perm_products === true) {
            return true;
        }
    }

    if (permission === PERMISSIONS.SETTINGS_EDIT || permission === PERMISSIONS.SETTINGS_VIEW) {
        if (user.perm_settings === 1 || user.perm_settings === true) {
            return true;
        }
    }

    return false;
}

/**
 * Check if a user ID is the system admin
 * @param {number} userId - The user ID to check
 * @returns {boolean} True if user is system admin
 */
function isSystemAdmin(userId) {
    return userId === 1;
}

/**
 * Check if a user can be modified/deleted
 * System admin (ID: 1) is protected from role changes and deletion
 * @param {Object} user - The user object
 * @param {number} targetUserId - The ID of the user being modified
 * @returns {boolean} True if the target user can be modified
 */
function canModifyUser(user, targetUserId) {
    if (!user || !targetUserId) return false;
    
    // System admin (ID: 1) cannot be modified by anyone (including themselves for role changes)
    if (targetUserId === 1) {
        // Only allow password changes and status updates for system admin
        return false; // This should be checked more granularly in the route handler
    }
    
    // System admin (ID: 1) can modify anyone except system admin
    if (user._id === 1 || user.id === 1) {
        return true;
    }
    
    // Admins can modify anyone except system admin (case-insensitive check)
    const userRole = (user.role || '').toLowerCase();
    if (userRole === 'admin' || userRole === 'administrator') {
        return true;
    }
    
    // Backward compatibility: Users with perm_users = 1 can modify other users
    if (user.perm_users === 1 || user.perm_users === true) {
        return true;
    }
    
    // Users can modify themselves (but not change their role)
    if (user._id === targetUserId || user.id === targetUserId) {
        return true;
    }
    
    return false;
}

/**
 * Get all permissions for a user (role + custom permissions)
 * @param {Object} user - The user object
 * @returns {Array<string>} Array of all permissions the user has
 */
function getUserPermissions(user) {
    if (!user) return [];
    
    // System admin has all permissions
    if (user._id === 1 || user.id === 1) {
        return Object.values(PERMISSIONS);
    }
    
    const rolePermissions = getRolePermissions(user.role || 'cashier');
    const customPermissions = user.customPermissions || [];
    
    // Combine and deduplicate
    return [...new Set([...rolePermissions, ...customPermissions])];
}

/**
 * Get all available roles
 * @returns {Array<Object>} Array of role objects
 */
function getAllRoles() {
    return Object.values(ROLES);
}

/**
 * Get role by name
 * @param {string} roleName - The role name
 * @returns {Object|null} Role object or null
 */
function getRole(roleName) {
    return Object.values(ROLES).find(r => r.name === roleName) || null;
}

module.exports = {
    PERMISSIONS,
    ROLES,
    PERMISSION_GROUPS,
    getRolePermissions,
    roleHasPermission,
    userHasPermission,
    getAllRoles,
    getRole,
    isSystemAdmin,
    canModifyUser,
    getUserPermissions,
};
