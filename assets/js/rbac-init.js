/**
 * RBAC Integration Initializer
 * This file integrates RBAC into the existing POS system
 * Load this AFTER rbac-helper.js and BEFORE pos.js
 */

(function () {
    'use strict';

    console.log('%c[RBAC] Integration initializer loaded', 'color: blue; font-weight: bold');

    // Store original user object
    let originalUser = null;

    // Override Storage.set to intercept user data
    if (typeof Store !== 'undefined') {
        const OriginalStore = Store;
        window.Store = function () {
            const store = new OriginalStore(...arguments);
            const originalSet = store.set.bind(store);

            store.set = function (key, value) {
                if (key === 'user' && value) {
                    // Migrate old permissions to new RBAC system
                    if (typeof migrateOldPermissions === 'function') {
                        value = migrateOldPermissions(value);
                    }

                    console.log(`%c[RBAC] User stored: ${value.username} (${value.role || 'unknown role'})`, 'color: green');
                    console.log(`%c[RBAC] Permissions: ${value.allPermissions ? value.allPermissions.length : 0}`, 'color: green');
                }
                return originalSet(key, value);
            };

            return store;
        };
    }

    // Apply RBAC when DOM is ready
    $(document).ready(function () {
        console.log('%c[RBAC] DOM ready, initializing RBAC...', 'color: blue');

        // Check if we have a stored user
        if (typeof storage !== 'undefined') {
            const storedUser = storage.get('user');
            if (storedUser) {
                console.log('%c[RBAC] Found stored user, applying permissions...', 'color: blue');
                applyRBACPermissions(storedUser);
            }
        }

        // Watch for user changes
        setInterval(function () {
            if (typeof user !== 'undefined' && user && user !== originalUser) {
                originalUser = user;
                applyRBACPermissions(user);
            }
        }, 1000);
    });

    /**
     * Apply RBAC permissions to UI
     */
    function applyRBACPermissions(userData) {
        if (!userData || !userData.role) {
            console.warn('[RBAC] No user data or role found');
            return;
        }

        // Migrate old permissions if needed
        if (typeof migrateOldPermissions === 'function') {
            userData = migrateOldPermissions(userData);
        }

        console.log(`%c[RBAC] Applying permissions for ${userData.username} (${userData.role})`, 'color: green; font-weight: bold');

        // Apply RBAC to UI elements with data attributes
        if (typeof applyRBACToUI === 'function') {
            applyRBACToUI(userData);
        }

        // Hide/show menu items based on permissions
        applyMenuPermissions(userData);

        // Add role badge to user display
        addRoleBadge(userData);
    }

    /**
     * Apply permissions to menu items
     */
    function applyMenuPermissions(userData) {
        if (typeof hasPermission !== 'function' || typeof RBAC_PERMISSIONS === 'undefined') {
            console.warn('[RBAC] RBAC helper functions not available');
            return;
        }

        // Products
        if (!hasPermission(userData, RBAC_PERMISSIONS.PRODUCTS_VIEW)) {
            $('.p_one').hide();
        } else {
            $('.p_one').show();
        }

        // Categories
        if (!hasPermission(userData, RBAC_PERMISSIONS.CATEGORIES_VIEW)) {
            $('.p_two').hide();
        } else {
            $('.p_two').show();
        }

        // Manufacturers
        if (!hasPermission(userData, RBAC_PERMISSIONS.MANUFACTURERS_VIEW)) {
            $('.p_manufacturers').hide();
        } else {
            $('.p_manufacturers').show();
        }

        // Suppliers
        if (!hasPermission(userData, RBAC_PERMISSIONS.SUPPLIERS_VIEW)) {
            $('.p_suppliers').hide();
        } else {
            $('.p_suppliers').show();
        }

        // Purchase Orders
        if (!hasPermission(userData, RBAC_PERMISSIONS.PURCHASE_ORDERS_VIEW)) {
            $('.p_purchase_orders').hide();
        } else {
            $('.p_purchase_orders').show();
        }

        // Transactions
        if (!hasPermission(userData, RBAC_PERMISSIONS.TRANSACTIONS_VIEW)) {
            $('.p_three').hide();
        } else {
            $('.p_three').show();
        }

        // Users
        if (!hasPermission(userData, RBAC_PERMISSIONS.USERS_VIEW)) {
            $('.p_four').hide();
        } else {
            $('.p_four').show();
        }

        // Settings
        if (!hasPermission(userData, RBAC_PERMISSIONS.SETTINGS_VIEW)) {
            $('.p_five').hide();
        } else {
            $('.p_five').show();
        }

        console.log('[RBAC] Menu permissions applied');
    }

    /**
     * Add role badge to user display
     */
    function addRoleBadge(userData) {
        if (typeof getRoleBadge !== 'function') return;

        const badge = getRoleBadge(userData);
        const $userDisplay = $('#loggedin-user');

        if ($userDisplay.length && badge) {
            const currentText = $userDisplay.text();
            // Only add badge if it's not already there
            if (!currentText.includes('badge')) {
                $userDisplay.html(`${userData.username} ${badge}`);
            }
        }
    }

    // Export for debugging
    window.rbacIntegration = {
        applyPermissions: applyRBACPermissions,
        version: '1.0.0'
    };

    console.log('%c[RBAC] Integration initializer ready', 'color: green; font-weight: bold');
})();
