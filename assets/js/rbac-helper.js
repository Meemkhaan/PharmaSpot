/**
 * RBAC Helper Functions
 * Client-side implementation of Role-Based Access Control
 * 
 * IMPORTANT: This file must be kept in sync with api/rbac-config.js
 * When adding new permissions or roles, update both files.
 * 
 * The permissions and roles defined here should exactly match the server-side
 * definitions to ensure consistent access control across the application.
 */

// Permissions Constants (Must match server-side rbac-config.js)
const RBAC_PERMISSIONS = {
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

// Role Definitions (Must match server-side rbac-config.js)
const RBAC_ROLES = {
    ADMIN: {
        name: 'admin',
        displayName: 'Administrator',
        permissions: Object.values(RBAC_PERMISSIONS),
    },
    MANAGER: {
        name: 'manager',
        displayName: 'Manager',
        permissions: [
            RBAC_PERMISSIONS.PRODUCTS_VIEW,
            RBAC_PERMISSIONS.PRODUCTS_CREATE,
            RBAC_PERMISSIONS.PRODUCTS_EDIT,
            RBAC_PERMISSIONS.PRODUCTS_DELETE,
            RBAC_PERMISSIONS.PRODUCTS_IMPORT,
            RBAC_PERMISSIONS.PRODUCTS_EXPORT,
            RBAC_PERMISSIONS.CATEGORIES_VIEW,
            RBAC_PERMISSIONS.CATEGORIES_CREATE,
            RBAC_PERMISSIONS.CATEGORIES_EDIT,
            RBAC_PERMISSIONS.CATEGORIES_DELETE,
            RBAC_PERMISSIONS.MANUFACTURERS_VIEW,
            RBAC_PERMISSIONS.MANUFACTURERS_CREATE,
            RBAC_PERMISSIONS.MANUFACTURERS_EDIT,
            RBAC_PERMISSIONS.MANUFACTURERS_DELETE,
            RBAC_PERMISSIONS.SUPPLIERS_VIEW,
            RBAC_PERMISSIONS.SUPPLIERS_CREATE,
            RBAC_PERMISSIONS.SUPPLIERS_EDIT,
            RBAC_PERMISSIONS.SUPPLIERS_DELETE,
            RBAC_PERMISSIONS.PURCHASE_ORDERS_VIEW,
            RBAC_PERMISSIONS.PURCHASE_ORDERS_CREATE,
            RBAC_PERMISSIONS.PURCHASE_ORDERS_EDIT,
            RBAC_PERMISSIONS.PURCHASE_ORDERS_DELETE,
            RBAC_PERMISSIONS.PURCHASE_ORDERS_APPROVE,
            RBAC_PERMISSIONS.PURCHASE_ORDERS_RECEIVE,
            RBAC_PERMISSIONS.POS_ACCESS,
            RBAC_PERMISSIONS.POS_PROCESS_SALE,
            RBAC_PERMISSIONS.POS_APPLY_DISCOUNT,
            RBAC_PERMISSIONS.POS_VOID_TRANSACTION,
            RBAC_PERMISSIONS.POS_REFUND,
            RBAC_PERMISSIONS.TRANSACTIONS_VIEW,
            RBAC_PERMISSIONS.TRANSACTIONS_VIEW_ALL,
            RBAC_PERMISSIONS.TRANSACTIONS_EXPORT,
            RBAC_PERMISSIONS.REPORTS_VIEW,
            RBAC_PERMISSIONS.REPORTS_SALES,
            RBAC_PERMISSIONS.REPORTS_INVENTORY,
            RBAC_PERMISSIONS.REPORTS_FINANCIAL,
            RBAC_PERMISSIONS.USERS_VIEW,
            RBAC_PERMISSIONS.CUSTOMERS_VIEW,
            RBAC_PERMISSIONS.CUSTOMERS_CREATE,
            RBAC_PERMISSIONS.CUSTOMERS_EDIT,
            RBAC_PERMISSIONS.CUSTOMERS_DELETE,
        ],
    },
    CASHIER: {
        name: 'cashier',
        displayName: 'Cashier',
        permissions: [
            RBAC_PERMISSIONS.PRODUCTS_VIEW,
            RBAC_PERMISSIONS.CATEGORIES_VIEW,
            RBAC_PERMISSIONS.POS_ACCESS,
            RBAC_PERMISSIONS.POS_PROCESS_SALE,
            RBAC_PERMISSIONS.TRANSACTIONS_VIEW,
            RBAC_PERMISSIONS.TRANSACTIONS_VIEW_OWN,
            RBAC_PERMISSIONS.CUSTOMERS_VIEW,
            RBAC_PERMISSIONS.CUSTOMERS_CREATE,
            RBAC_PERMISSIONS.CUSTOMERS_EDIT,
        ],
    },
};

/**
 * Get permissions for a specific role
 */
function getRolePermissions(roleName) {
    const role = Object.values(RBAC_ROLES).find(r => r.name === roleName);
    return role ? role.permissions : [];
}

/**
 * Check if a user has a specific permission
 */
function hasPermission(user, permission) {
    if (!user) return false;

    // System admin (ID: 1) always has all permissions
    if (user._id === 1 || user.id === 1) return true;

    // Check if user has allPermissions array (populated by backend)
    if (user.allPermissions && Array.isArray(user.allPermissions)) {
        return user.allPermissions.includes(permission);
    }

    // Fallback: Check role-based permissions locally
    const rolePermissions = getRolePermissions(user.role);
    if (rolePermissions.includes(permission)) return true;

    // Check custom permissions
    if (user.customPermissions && Array.isArray(user.customPermissions)) {
        return user.customPermissions.includes(permission);
    }

    return false;
}

/**
 * Get role badge HTML for user display
 */
function getRoleBadge(user) {
    if (!user || !user.role) return '';

    let badgeClass = 'badge-default';
    let roleName = user.role;

    switch (user.role) {
        case 'admin':
            badgeClass = 'badge-danger';
            roleName = 'Admin';
            break;
        case 'manager':
            badgeClass = 'badge-primary';
            roleName = 'Manager';
            break;
        case 'cashier':
            badgeClass = 'badge-success';
            roleName = 'Cashier';
            break;
    }

    return `<span class="badge ${badgeClass}">${roleName}</span>`;
}

/**
 * Migrate old user permissions to new RBAC system
 * (Useful for legacy data compatibility)
 */
function migrateOldPermissions(user) {
    if (!user) return user;

    // If user already has 'role', assume it's migrated
    if (user.role) return user;

    // Default to cashier if no role
    user.role = 'cashier';
    user.customPermissions = [];

    // Map old boolean flags to new permissions if they exist
    if (user.perm_products === 1) user.customPermissions.push(RBAC_PERMISSIONS.PRODUCTS_EDIT);
    if (user.perm_users === 1) user.customPermissions.push(RBAC_PERMISSIONS.USERS_EDIT);
    if (user.perm_settings === 1) user.customPermissions.push(RBAC_PERMISSIONS.SETTINGS_EDIT);

    return user;
}

/**
 * Apply RBAC to specific UI elements
 */
function applyRBACToUI(user) {
    // Buttons and Actions

    // New Product Button
    if (hasPermission(user, RBAC_PERMISSIONS.PRODUCTS_CREATE)) {
        $('#newProductModal').show();
    } else {
        $('#newProductModal').hide();
    }

    // New Category Button
    if (hasPermission(user, RBAC_PERMISSIONS.CATEGORIES_CREATE)) {
        $('#newCategoryModal').show();
    } else {
        $('#newCategoryModal').hide();
    }

    // New Manufacturer Button
    if (hasPermission(user, RBAC_PERMISSIONS.MANUFACTURERS_CREATE)) {
        $('#newManufacturerModal').show();
    } else {
        $('#newManufacturerModal').hide();
    }

    // New Supplier Button
    if (hasPermission(user, RBAC_PERMISSIONS.SUPPLIERS_CREATE)) {
        $('#newSupplierModal').show();
    } else {
        $('#newSupplierModal').hide();
    }

    // New User Button
    if (hasPermission(user, RBAC_PERMISSIONS.USERS_CREATE)) {
        $('#add-user').show();
    } else {
        $('#add-user').hide();
    }

    // Settings Button (Main Menu)
    if (hasPermission(user, RBAC_PERMISSIONS.SETTINGS_VIEW)) {
        $('#settings').show();
    } else {
        $('#settings').hide();
    }

    // Discount Input in POS
    if (hasPermission(user, RBAC_PERMISSIONS.POS_APPLY_DISCOUNT)) {
        $('#inputDiscount').prop('disabled', false);
    } else {
        $('#inputDiscount').prop('disabled', true);
    }

    // User Management Modal - Role Selection
    // Only admins can change roles to admin/manager
    if (user.role !== 'admin' && user._id !== 1) {
        // Hide admin option for non-admins
        $("#userRole option[value='admin']").hide();
    } else {
        $("#userRole option[value='admin']").show();
    }
}

// Export functions to global scope
window.hasPermission = hasPermission;
window.getRoleBadge = getRoleBadge;
window.migrateOldPermissions = migrateOldPermissions;
window.applyRBACToUI = applyRBACToUI;
window.getRolePermissions = getRolePermissions;
window.RBAC_PERMISSIONS = RBAC_PERMISSIONS;
window.RBAC_ROLES = RBAC_ROLES;
