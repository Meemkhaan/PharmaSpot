/**
 * RBAC System Test Script
 * Run this in the browser console to test RBAC functionality
 */

// Test configuration
const API_BASE = 'http://localhost:3000/api/users';

// Color codes for console output
const colors = {
    success: 'color: green; font-weight: bold',
    error: 'color: red; font-weight: bold',
    info: 'color: blue; font-weight: bold',
    warning: 'color: orange; font-weight: bold'
};

console.log('%c========================================', colors.info);
console.log('%cRBAC SYSTEM TEST SCRIPT', colors.info);
console.log('%c========================================', colors.info);

// Test 1: Get all roles
async function testGetRoles() {
    console.log('%n%cTest 1: Get All Roles', colors.info);
    try {
        const response = await fetch(`${API_BASE}/roles`);
        const data = await response.json();

        if (data.success && data.roles) {
            console.log('%c✓ PASS: Retrieved roles successfully', colors.success);
            console.table(data.roles);
            return true;
        } else {
            console.log('%c✗ FAIL: Invalid response', colors.error);
            return false;
        }
    } catch (error) {
        console.log('%c✗ FAIL: ' + error.message, colors.error);
        return false;
    }
}

// Test 2: Get all permissions
async function testGetPermissions() {
    console.log('%n%cTest 2: Get All Permissions', colors.info);
    try {
        const response = await fetch(`${API_BASE}/permissions`);
        const data = await response.json();

        if (data.success && data.allPermissions) {
            console.log('%c✓ PASS: Retrieved permissions successfully', colors.success);
            console.log(`Total permissions: ${data.allPermissions.length}`);
            console.log('Permission groups:', Object.keys(data.permissionGroups));
            return true;
        } else {
            console.log('%c✗ FAIL: Invalid response', colors.error);
            return false;
        }
    } catch (error) {
        console.log('%c✗ FAIL: ' + error.message, colors.error);
        return false;
    }
}

// Test 3: Get admin role permissions
async function testGetAdminPermissions() {
    console.log('%n%cTest 3: Get Admin Role Permissions', colors.info);
    try {
        const response = await fetch(`${API_BASE}/roles/admin/permissions`);
        const data = await response.json();

        if (data.success && data.role) {
            console.log('%c✓ PASS: Retrieved admin permissions', colors.success);
            console.log(`Admin has ${data.role.permissions.length} permissions`);
            return true;
        } else {
            console.log('%c✗ FAIL: Invalid response', colors.error);
            return false;
        }
    } catch (error) {
        console.log('%c✗ FAIL: ' + error.message, colors.error);
        return false;
    }
}

// Test 4: Login as admin
async function testAdminLogin() {
    console.log('%n%cTest 4: Admin Login', colors.info);
    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: 'admin',
                password: 'admin'
            })
        });
        const data = await response.json();

        if (data.auth === true) {
            console.log('%c✓ PASS: Admin login successful', colors.success);
            console.log(`Username: ${data.username}`);
            console.log(`Role: ${data.role}`);
            console.log(`Permissions: ${data.allPermissions ? data.allPermissions.length : 0}`);
            return data;
        } else {
            console.log('%c✗ FAIL: Login failed', colors.error);
            return null;
        }
    } catch (error) {
        console.log('%c✗ FAIL: ' + error.message, colors.error);
        return null;
    }
}

// Test 5: Create manager user
async function testCreateManager() {
    console.log('%n%cTest 5: Create Manager User', colors.info);
    try {
        const response = await fetch(`${API_BASE}/post`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: '',
                username: 'test_manager',
                fullname: 'Test Manager',
                email: 'manager@test.com',
                role: 'manager',
                password: 'manager123',
                pass: 'manager123'
            })
        });
        const data = await response.json();

        if (data.success) {
            console.log('%c✓ PASS: Manager created successfully', colors.success);
            console.log(`User ID: ${data.user._id}`);
            return data.user;
        } else {
            console.log('%c⚠ WARNING: ' + data.message, colors.warning);
            return null;
        }
    } catch (error) {
        console.log('%c✗ FAIL: ' + error.message, colors.error);
        return null;
    }
}

// Test 6: Create cashier user
async function testCreateCashier() {
    console.log('%n%cTest 6: Create Cashier User', colors.info);
    try {
        const response = await fetch(`${API_BASE}/post`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: '',
                username: 'test_cashier',
                fullname: 'Test Cashier',
                email: 'cashier@test.com',
                role: 'cashier',
                password: 'cashier123',
                pass: 'cashier123'
            })
        });
        const data = await response.json();

        if (data.success) {
            console.log('%c✓ PASS: Cashier created successfully', colors.success);
            console.log(`User ID: ${data.user._id}`);
            return data.user;
        } else {
            console.log('%c⚠ WARNING: ' + data.message, colors.warning);
            return null;
        }
    } catch (error) {
        console.log('%c✗ FAIL: ' + error.message, colors.error);
        return null;
    }
}

// Test 7: Grant custom permission to cashier
async function testCustomPermissions(userId) {
    console.log('%n%cTest 7: Grant Custom Permissions', colors.info);
    if (!userId) {
        console.log('%c⚠ SKIP: No user ID provided', colors.warning);
        return false;
    }

    try {
        const response = await fetch(`${API_BASE}/user/${userId}/permissions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customPermissions: ['pos.apply_discount', 'pos.void_transaction']
            })
        });
        const data = await response.json();

        if (data.success) {
            console.log('%c✓ PASS: Custom permissions granted', colors.success);
            return true;
        } else {
            console.log('%c✗ FAIL: ' + data.message, colors.error);
            return false;
        }
    } catch (error) {
        console.log('%c✗ FAIL: ' + error.message, colors.error);
        return false;
    }
}

// Test 8: Get all users
async function testGetAllUsers() {
    console.log('%n%cTest 8: Get All Users', colors.info);
    try {
        const response = await fetch(`${API_BASE}/all`);
        const data = await response.json();

        if (Array.isArray(data)) {
            console.log('%c✓ PASS: Retrieved users successfully', colors.success);
            console.log(`Total users: ${data.length}`);
            console.table(data.map(u => ({
                id: u._id,
                username: u.username,
                role: u.role,
                permissions: u.allPermissions ? u.allPermissions.length : 0
            })));
            return true;
        } else {
            console.log('%c✗ FAIL: Invalid response', colors.error);
            return false;
        }
    } catch (error) {
        console.log('%c✗ FAIL: ' + error.message, colors.error);
        return false;
    }
}

// Run all tests
async function runAllTests() {
    console.log('%n%c========================================', colors.info);
    console.log('%cRUNNING ALL TESTS...', colors.info);
    console.log('%c========================================', colors.info);

    const results = [];

    // Run tests
    results.push(await testGetRoles());
    results.push(await testGetPermissions());
    results.push(await testGetAdminPermissions());

    const adminUser = await testAdminLogin();
    results.push(adminUser !== null);

    const managerUser = await testCreateManager();
    results.push(managerUser !== null);

    const cashierUser = await testCreateCashier();
    results.push(cashierUser !== null);

    if (cashierUser) {
        results.push(await testCustomPermissions(cashierUser._id));
    } else {
        results.push(false);
    }

    results.push(await testGetAllUsers());

    // Summary
    console.log('%n%c========================================', colors.info);
    console.log('%cTEST SUMMARY', colors.info);
    console.log('%c========================================', colors.info);

    const passed = results.filter(r => r === true).length;
    const total = results.length;
    const percentage = ((passed / total) * 100).toFixed(1);

    console.log(`%cPassed: ${passed}/${total} (${percentage}%)`,
        percentage === '100.0' ? colors.success : colors.warning);

    if (percentage === '100.0') {
        console.log('%c✓ ALL TESTS PASSED!', colors.success);
        console.log('%cRBAC system is working correctly!', colors.success);
    } else {
        console.log('%c⚠ SOME TESTS FAILED', colors.warning);
        console.log('%cCheck the output above for details', colors.warning);
    }

    console.log('%c========================================', colors.info);
}

// Export functions for manual testing
window.rbacTests = {
    runAll: runAllTests,
    testGetRoles,
    testGetPermissions,
    testGetAdminPermissions,
    testAdminLogin,
    testCreateManager,
    testCreateCashier,
    testCustomPermissions,
    testGetAllUsers
};

console.log('%n%cRBAC Test Script Loaded!', colors.success);
console.log('%cRun: rbacTests.runAll() to test all features', colors.info);
console.log('%cOr run individual tests: rbacTests.testGetRoles(), etc.', colors.info);
