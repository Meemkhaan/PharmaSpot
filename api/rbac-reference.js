/**
 * RBAC SYSTEM QUICK REFERENCE
 * ===========================
 *
 * THREE USER ROLES:
 *
 * 1. ADMIN - Full system access
 *    - All permissions
 *    - User management
 *    - System settings
 *    - Cannot be deleted if last admin
 *
 * 2. MANAGER - Inventory & operations management
 *    - Full product/category/manufacturer/supplier access
 *    - Full purchase orders
 *    - Full POS access (including discounts, voids, refunds)
 *    - View all transactions
 *    - All reports
 *    - View users (no edit)
 *    - No settings access
 *
 * 3. CASHIER - Basic sales operations
 *    - View products/categories
 *    - Basic POS (no discounts/voids/refunds)
 *    - View own transactions only
 *    - Basic customer management
 *
 * CUSTOM PERMISSIONS:
 * - Grant specific permissions to any user
 * - Additive to role permissions
 * - Example: Give cashier discount permission
 *
 * API ENDPOINTS:
 * - GET /api/users/roles - List all roles
 * - GET /api/users/permissions - List all permissions
 * - POST /api/users/post - Create/update user
 * - POST /api/users/user/:userId/permissions - Update custom permissions
 * - POST /api/users/login - Login
 * - POST /api/users/emergency-admin-recovery - Restore admin access
 *
 * DEFAULT CREDENTIALS:
 * Username: admin
 * Password: admin
 *
 * SECURITY:
 * - System admin (ID: 1) is protected
 * - At least one admin must exist
 * - Bcrypt password hashing
 * - Permission validation
 */

// This file is for reference only - see rbac-config.js and rbac-middleware.js for implementation
