/**
 * Purchase Orders Management Module
 * Handles all purchase order operations including auto-draft, sending, receiving, and reporting
 */

// utils will be available globally when loaded in browser context

class PurchaseOrderManager {
    constructor() {
        // In Electron app, use relative URLs for API calls
        this.api = '/api/purchase-orders';
        this.currentOrder = null;
        this.orders = [];
        this.suppliers = [];
        this.products = [];
        this.isAutoDraftRunning = false; // Flag to prevent concurrent auto-draft calls
        this.isLoadingAutoDraftProducts = false; // Flag to prevent multiple concurrent loads
        this.settings = null; // Store settings for store name
        
        // Initialize global flag if not already set
        if (typeof window.isAutoDraftRunning === 'undefined') {
            window.isAutoDraftRunning = false;
        }
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        // Load data directly since we're now served through the server
        this.loadSettings();
        this.loadSuppliers();
        this.loadProducts();
        this.loadPurchaseOrders();
    }


    showOfflineMode() {
        // Show offline message in the purchase orders table
        const tbody = $('#purchaseOrdersTable tbody');
        tbody.html(`
            <tr>
                <td colspan="8" class="text-center text-muted">
                    <i class="fa fa-wifi fa-2x mb-2"></i><br>
                    <strong>Server Not Available</strong><br>
                    <small>Please ensure the PharmaSpot server is running and try again.</small><br>
                    <button class="btn btn-primary btn-sm mt-2" onclick="location.reload()">
                        <i class="fa fa-refresh"></i> Retry
                    </button>
                </td>
            </tr>
        `);
        
        // Update statistics to show offline
        $('#poStatsTotal').text('Offline');
        $('#poStatsDraft').text('-');
        $('#poStatsSent').text('-');
        $('#poStatsPartial').text('-');
        $('#poStatsCompleted').text('-');
        $('#poStatsValue').text('$0.00');
        
        // Show retry button
        $('#retryServerConnection').show();
    }


    setupEventListeners() {
        // Auto-draft button
        $(document).on('click', '#autoDraftPO', () => {
            this.generateAutoDraft();
        });

        // Auto-draft modal events - remove existing handler first to prevent duplicates
        $('#autoDraftModal').off('shown.bs.modal').on('shown.bs.modal', () => {
            // Load products when modal is shown (only once per show)
            if (!this.isLoadingAutoDraftProducts) {
                this.loadAutoDraftProducts();
            }
        });
        
        // Reset loading flag when modal is hidden
        $('#autoDraftModal').off('hidden.bs.modal').on('hidden.bs.modal', () => {
            console.log('Auto-draft modal hidden, resetting loading flag');
            this.isLoadingAutoDraftProducts = false;
        });
        
        // Auto-draft modal buttons
        $(document).on('click', '#refreshAutoDraft', () => {
            // Force allow a new load and clear table state
            this.isLoadingAutoDraftProducts = false;
            $('#autoDraftTable tbody').html('');
            this.loadAutoDraftProducts();
        });
        
        $(document).on('click', '#createPOsFromAssignments', () => {
            this.createPOsFromAssignments();
        });

        // Real-time form validation
        this.setupFormValidation();

        // Create new PO button (from Purchase Orders Management modal)
        $(document).on('click', '#createNewPO', () => {
            if (window.purchaseOrderManager) {
                window.purchaseOrderManager.showCreatePOModal();
            }
        });

        // Create new PO button (from main navigation)
        $(document).on('click', '#newPurchaseOrderModal', () => {
            if (window.purchaseOrderManager) {
                window.purchaseOrderManager.showCreatePOModal();
            }
        });

        // Clear form button
        $(document).on('click', '#clearPOForm', () => {
            console.log('Clear form button clicked');
            if (confirm('Are you sure you want to clear the form? All entered data will be lost.')) {
                if (window.purchaseOrderManager) {
                    window.purchaseOrderManager.resetPOForm();
                    window.purchaseOrderManager.updateProgress();
                }
            }
        });

        // Send PO button
        $(document).on('click', '.send-po-btn', (e) => {
            const orderId = $(e.currentTarget).data('order-id');
            const $btn = $(e.currentTarget);
            
            // Show confirmation dialog
            if (confirm('Are you sure you want to send this purchase order to the supplier? This action cannot be undone.')) {
                // Show loading state
                const originalHtml = $btn.html();
                $btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i>');
                
                if (window.purchaseOrderManager) {
                    window.purchaseOrderManager.sendPOToSupplier(orderId);
                }
                
                // Reset button after delay
                setTimeout(() => {
                    $btn.prop('disabled', false).html(originalHtml);
                }, 3000);
            }
        });

        // Receive items button
        $(document).on('click', '.receive-items-btn', (e) => {
            const orderId = $(e.currentTarget).data('order-id');
            if (window.purchaseOrderManager) {
                window.purchaseOrderManager.showReceiveItemsModal(orderId);
            }
        });

        // View PO button
        $(document).on('click', '.view-po-btn', (e) => {
            const orderId = $(e.currentTarget).data('order-id');
            if (window.purchaseOrderManager) {
                window.purchaseOrderManager.viewPurchaseOrder(orderId);
            }
        });

        // Edit PO button
        $(document).on('click', '.edit-po-btn', (e) => {
            const orderId = $(e.currentTarget).data('order-id');
            const $btn = $(e.currentTarget);
            
            // Show loading state
            const originalHtml = $btn.html();
            $btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i>');
            
            // Call edit function with proper context
            if (window.purchaseOrderManager) {
                window.purchaseOrderManager.editPurchaseOrder(orderId);
            } else {
                console.error('PurchaseOrderManager not found');
            }
            
            // Reset button after modal is shown
            setTimeout(() => {
                $btn.prop('disabled', false).html(originalHtml);
            }, 500);
        });

        // Delete PO button
        $(document).on('click', '.delete-po-btn', (e) => {
            const orderId = $(e.currentTarget).data('order-id');
            console.log('Delete button clicked, orderId from data attribute:', orderId);
            console.log('Event currentTarget:', e.currentTarget);
            console.log('Event target:', e.target);
            console.log('Current target data:', $(e.currentTarget).data());
            if (window.purchaseOrderManager) {
                window.purchaseOrderManager.deletePurchaseOrder(orderId);
            }
        });

        // Refresh PO list
        $(document).on('click', '#refreshPOList', () => {
            if (window.purchaseOrderManager) {
                window.purchaseOrderManager.loadPurchaseOrders();
            }
        });


        // Filter PO list
        $(document).on('change', '#poStatusFilter, #poSupplierFilter', () => {
            if (window.purchaseOrderManager) {
                window.purchaseOrderManager.filterPurchaseOrders();
            }
        });

        // Search PO list
        $(document).on('input', '#poSearchInput', () => {
            if (window.purchaseOrderManager) {
                window.purchaseOrderManager.searchPurchaseOrders();
            }
        });

        // Save PO form
        $(document).on('click', '#createPOBtn', () => {
            if (window.purchaseOrderManager) {
                window.purchaseOrderManager.savePurchaseOrder();
            }
        });

        // Add item to PO
        $(document).on('click', '#addPOItem', () => {
            if (window.purchaseOrderManager) {
                window.purchaseOrderManager.addPOItem();
            }
        });

        // Remove item from PO
        $(document).on('click', '.remove-po-item', (e) => {
            $(e.target).closest('tr').remove();
            
            // Show "no items" row if table is empty
            const remainingRows = $('#poItemsTable tbody tr').not('#noItemsRow').length;
            if (remainingRows === 0) {
                $('#poItemsTable tbody').append(`
                    <tr id="noItemsRow">
                        <td colspan="6" class="text-center text-muted py-4">
                            <i class="fa fa-shopping-cart fa-2x mb-2"></i>
                            <br>No items added yet. Select products above to get started.
                        </td>
                    </tr>
                `);
            }
            
            if (window.purchaseOrderManager) {
                window.purchaseOrderManager.calculatePOTotals();
                window.purchaseOrderManager.updateProgress();
            }
        });

        // Receive items form
        $(document).on('click', '#saveReceiveItems', () => {
            if (window.purchaseOrderManager) {
                window.purchaseOrderManager.saveReceiveItems();
            }
        });

        // Barcode scan for receiving
        $(document).on('keypress', '#receiveBarcodeInput', (e) => {
            if (e.which === 13) {
                if (window.purchaseOrderManager) {
                    window.purchaseOrderManager.scanReceiveBarcode();
                }
            }
        });

        // Supplier selection for product loading
        $(document).on('change', '#poSupplierSelect', (e) => {
            const supplierId = $(e.target).val();
            if (supplierId) {
                if (window.purchaseOrderManager) {
                    window.purchaseOrderManager.loadProductsForSupplier(supplierId);
                }
            } else {
                if (window.purchaseOrderManager) {
                    window.purchaseOrderManager.clearProductSelection();
                }
            }
        });
    }

    loadSettings() {
        $.get('/api/settings/get', (data) => {
            if (data && data.settings) {
                this.settings = data.settings;
                console.log('Settings loaded:', this.settings);
                
                // Update supplier field behavior based on linking setting
                this.updateSupplierFieldBehavior();
            }
        }).fail((xhr, status, error) => {
            console.error('Failed to load settings:', error);
            this.settings = {
                productSupplierLinking: true,
                autoSplitMasterPOs: true,
                defaultSupplierAssignment: 'auto',
                store: 'PharmaSpot'
            };
            this.updateSupplierFieldBehavior();
        });
    }
    
    updateSupplierFieldBehavior() {
        const linkingEnabled = this.settings?.productSupplierLinking !== false;
        const supplierField = $('#supplier');
        const supplierHelpText = $('#supplierHelpText');
        
        if (linkingEnabled) {
            supplierField.prop('required', true);
            if (supplierHelpText.length) {
                supplierHelpText.html('<i class="fa fa-info-circle"></i> Required: Select the designated supplier for this product');
                supplierHelpText.removeClass('text-muted').addClass('text-info');
            }
        } else {
            supplierField.prop('required', false);
            if (supplierHelpText.length) {
                supplierHelpText.html('<i class="fa fa-info-circle"></i> Optional: Product can be ordered from any supplier');
                supplierHelpText.removeClass('text-info').addClass('text-muted');
            }
        }
    }

    loadSuppliers() {
        $.get('/api/suppliers/all', (suppliers) => {
            this.suppliers = suppliers;
            console.log(`Loaded ${suppliers.length} suppliers`);
            this.populateSupplierDropdowns();
        }).fail((xhr, status, error) => {
            console.error('Failed to load suppliers:', error);
            console.log('Server might not be running. Please start the server first.');
            if (typeof notiflix !== 'undefined') {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('Failed to load suppliers. Please check server connection.');
            }
        });
    }

    loadProducts() {
        $.ajax({
            url: '/api/inventory/products',
            timeout: 15000, // 15 seconds to match backend fallback timeout
            success: (products) => {
                // Handle empty array (might be timeout response)
                if (!products || (Array.isArray(products) && products.length === 0)) {
                    console.warn('Products endpoint returned empty array - might be timeout');
                    this.products = [];
                    return;
                }
                
            this.products = products;
                console.log(`Loaded ${products.length} products successfully`);
            },
            error: (xhr, status, error) => {
                console.error('Failed to load products:', error, 'Status:', status);
                this.products = [];
                if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                    notiflix.Notify.warning('Failed to load products. Please check server connection.');
                }
            }
        });
    }

    loadAllProducts() {
        console.log('Loading ALL products (not filtered by supplier)');
        
        // Use the already loaded products if available, otherwise load them
        if (this.products && this.products.length > 0) {
            console.log(`Using cached products: ${this.products.length}`);
            this.populateProductDropdown(this.products);
        } else {
            console.log('Products not cached, loading from API...');
            $.ajax({
                url: '/api/inventory/products',
                timeout: 15000,
                success: (products) => {
                    if (!products || (Array.isArray(products) && products.length === 0)) {
                        console.warn('Products endpoint returned empty array');
                        this.products = [];
                        this.populateProductDropdown([]);
                        return;
                    }
                    
                    this.products = products;
                    console.log(`Loaded ${products.length} products successfully`);
                    this.populateProductDropdown(products);
                },
                error: (xhr, status, error) => {
                    console.error('Failed to load products:', error, 'Status:', status);
                    this.products = [];
                    this.populateProductDropdown([]);
                    if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                        notiflix.Notify.warning('Failed to load products. Please check server connection.');
                    }
                }
            });
        }
    }

    loadProductsForSupplier(supplierId) {
        console.log('Loading products for supplier:', supplierId);
        
        // Add timeout and loading state
        const timeout = setTimeout(() => {
            console.warn('Products loading timeout - taking longer than expected');
            if (typeof notiflix !== 'undefined') {
                notiflix.Notify.warning('Products loading is taking longer than expected...');
            }
        }, 10000); // 10 second timeout warning
        
        // Simplified approach - try the supplier-specific endpoint first
        $.ajax({
            url: `/api/inventory/products/supplier/${supplierId}`,
            timeout: 30000, // 30 second timeout
            success: (products) => {
                clearTimeout(timeout);
                console.log(`API call successful. Found ${products.length} products for supplier ${supplierId}`);
                this.populateProductDropdown(products);
            },
            error: (xhr, status, error) => {
                clearTimeout(timeout);
                console.error('Supplier-specific endpoint failed:', error);
                
                // Fallback: load all products and filter client-side
                console.log('Trying fallback: loading all products and filtering client-side');
                $.ajax({
                    url: '/api/inventory/products',
                    timeout: 30000,
                    success: (allProducts) => {
                        console.log(`Fallback successful. Loaded ${allProducts.length} total products`);
                        
                        // Filter products by supplier client-side
                        const supplierProducts = allProducts.filter(product => {
                            const productSupplierId = product.supplier_id || product.supplierId || product.supplier;
                            return productSupplierId == supplierId;
                        });
                        
                        console.log(`Found ${supplierProducts.length} products for supplier ${supplierId} via fallback`);
                        this.populateProductDropdown(supplierProducts);
                    },
                    error: (fallbackXhr, fallbackStatus, fallbackError) => {
                        console.error('Fallback also failed:', fallbackError);
                        if (typeof notiflix !== 'undefined') {
                            notiflix.Notify.failure(`Failed to load products. Please try again.`);
                        }
                    }
                });
            }
        });
    }

    populateProductDropdown(products) {
        // Store the current supplier's products for later use
        this.currentSupplierProducts = products;
        
        const productSelect = $('#poProductSelect');
        productSelect.empty().append('<option value="">Select Product</option>');
        
        products.forEach(product => {
            productSelect.append(`
                <option value="${product._id}" 
                        data-price="${product.actualPrice || product.price || 0}"
                        data-stock="${product.quantity || product.stock || 0}">
                    ${product.name} (${product.barcode || 'No Barcode'}) - Stock: ${product.quantity || product.stock || 0}
                </option>
            `);
        });
        
        // Add change event for product selection to auto-fill price
        productSelect.off('change.productPrice').on('change.productPrice', (e) => {
            const selectedOption = $(e.target).find('option:selected');
            const price = selectedOption.data('price');
            const stock = selectedOption.data('stock');
            
            if (price) {
                $('#poUnitPrice').val(price);
            }
            
            // Show current stock info
            if (stock !== undefined) {
                $('#poStockInfo').text(`Current Stock: ${stock}`).show();
            } else {
                $('#poStockInfo').hide();
            }
        });
    }

    clearProductSelection() {
        const productSelect = $('#poProductSelect');
        productSelect.empty().append('<option value="">Select Product</option>');
        $('#poUnitPrice').val('');
        $('#poQuantity').val('1');
        $('#poStockInfo').hide();
    }

    resetPOForm(clearCurrentOrder = true) {
        // Clear validation errors
        this.clearValidationErrors();
        
        // Reset all form fields
        $('#poSupplierSelect').val('');
        $('#poProductSelect').empty().append('<option value="">Select Product</option>');
        $('#poQuantity').val('1');
        $('#poUnitPrice').val('');
        $('#poCurrentStock').val('');
        $('#poTax').val('0');
        $('#poDiscount').val('0');
        $('#poNotes').val('');
        $('#poExpectedDelivery').val('');
        
        // Clear items table and show "no items" row
        $('#poItemsTable tbody').empty().append(`
            <tr id="noItemsRow">
                <td colspan="6" class="text-center text-muted py-4">
                    <i class="fa fa-shopping-cart fa-2x mb-2"></i>
                    <br>No items added yet. Select products above to get started.
                </td>
            </tr>
        `);
        
        // Reset totals
        $('#poSubtotal').text('0.00');
        $('#poTotal').text('0.00');
        $('#poTotalItems').text('0');
        
        // Clear current supplier products
        this.currentSupplierProducts = null;
        
        // Only clear current order if explicitly requested (for new orders)
        if (clearCurrentOrder) {
            this.currentOrder = null;
            console.log('🔄 Cleared currentOrder for new PO');
        } else {
            console.log('🔄 Preserved currentOrder for edit');
        }
        
        // Hide stock info
        $('#poStockInfo').hide();
        
        // Reset modal title and button
        $('#createPOModalLabel').text('Create New Purchase Order');
        $('#createPOBtn').html('<i class="fa fa-plus"></i> Create Purchase Order');
        $('#createPOBtn').removeData('original-order-id');
        
        // Reset button state
        $('#createPOBtn').prop('disabled', false);
        
        // Clear any validation classes
        $('.form-control').removeClass('is-valid is-invalid');
    }

    loadPurchaseOrders() {
        console.log('Loading purchase orders...');
        $.get(this.api + '/all', (orders) => {
            console.log('Loaded purchase orders:', orders);
            console.log('Total orders count:', orders.length);
            this.orders = orders;
            this.displayPurchaseOrders();
            this.updateStatistics();
            this.updateNotificationBadge();
        }).fail((xhr, status, error) => {
            console.error('Failed to load purchase orders:', error);
            if (typeof notiflix !== 'undefined') {
                notiflix.Notify.failure('Failed to load purchase orders. Please check server connection.');
            } else {
                alert('Failed to load purchase orders. Please check server connection.');
            }
        });
    }

    updateNotificationBadge() {
        // Update the notification badge based on actual purchase order data
        const draftCount = this.orders.filter(o => o.status === 'draft').length;
        const badge = $('#poNotificationBadge');
        
        console.log('=== NOTIFICATION BADGE UPDATE ===');
        console.log('Total orders:', this.orders.length);
        console.log('All order statuses:', this.orders.map(o => ({ id: o._id, status: o.status, poNumber: o.poNumber })));
        console.log('Draft orders:', this.orders.filter(o => o.status === 'draft').map(o => ({ id: o._id, status: o.status, poNumber: o.poNumber })));
        console.log('Draft count:', draftCount);
        
        if (draftCount > 0) {
            badge.text(draftCount).addClass('show').css('display', 'inline-block');
        } else {
            badge.removeClass('show').css('display', 'none');
        }
        
        console.log(`Updated notification badge: ${draftCount} draft orders`);
    }

    displayPurchaseOrders() {
        const tbody = $('#purchaseOrdersTable tbody');
        tbody.empty();

        if (this.orders.length === 0) {
            tbody.append(`
                <tr>
                    <td colspan="8" class="text-center text-muted">
                        <i class="fa fa-inbox fa-2x"></i><br>
                        No purchase orders found
                    </td>
                </tr>
            `);
            return;
        }

        this.orders.forEach(order => {
            const statusBadge = this.getStatusBadge(order.status);
            const actions = this.getOrderActions(order);
            
            tbody.append(`
                <tr data-order-id="${order._id}">
                    <td><strong>${order.poNumber}</strong></td>
                    <td>${order.supplierName}</td>
                    <td>${moment(order.createdAt).format('DD-MMM-YYYY')}</td>
                    <td>${order.totalItems}</td>
                    <td class="text-right">${utils.moneyFormat(order.total)}</td>
                    <td>${statusBadge}</td>
                    <td>${order.expectedDeliveryDate ? moment(order.expectedDeliveryDate).format('DD-MMM-YYYY') : '-'}</td>
                    <td class="text-center">${actions}</td>
                </tr>
            `);
        });
    }

    getStatusBadge(status) {
        const badges = {
            'draft': '<span class="badge badge-secondary">Draft</span>',
            'sent': '<span class="badge badge-primary">Sent</span>',
            'partial': '<span class="badge badge-warning">Partial</span>',
            'received': '<span class="badge badge-info">Received</span>',
            'completed': '<span class="badge badge-success">Completed</span>',
            'cancelled': '<span class="badge badge-danger">Cancelled</span>'
        };
        return badges[status] || '<span class="badge badge-light">Unknown</span>';
    }

    getOrderActions(order) {
        let actions = `
            <button class="btn btn-sm btn-info view-po-btn" data-order-id="${order._id}" title="View Details">
                <i class="fa fa-eye"></i>
            </button>
        `;

        if (order.status === 'draft') {
            actions += `
                <button class="btn btn-sm btn-primary edit-po-btn" data-order-id="${order._id}" title="Edit Purchase Order">
                    <i class="fa fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-success send-po-btn" data-order-id="${order._id}" title="Send to Supplier">
                    <i class="fa fa-paper-plane"></i>
                </button>
                <button class="btn btn-sm btn-danger delete-po-btn" data-order-id="${order._id}" title="Delete">
                    <i class="fa fa-trash"></i>
                </button>
            `;
        }

        if (order.status === 'sent' || order.status === 'partial') {
            actions += `
                <button class="btn btn-sm btn-warning receive-items-btn" data-order-id="${order._id}" title="Receive Items">
                    <i class="fa fa-check-square"></i>
                </button>
            `;
        }

        return actions;
    }

    updateStatistics() {
        const stats = {
            total: this.orders.length,
            draft: this.orders.filter(o => o.status === 'draft').length,
            sent: this.orders.filter(o => o.status === 'sent').length,
            partial: this.orders.filter(o => o.status === 'partial').length,
            completed: this.orders.filter(o => o.status === 'completed').length,
            totalValue: this.orders.reduce((sum, order) => sum + (order.total || 0), 0)
        };

        $('#poStatsTotal').text(stats.total);
        $('#poStatsDraft').text(stats.draft);
        $('#poStatsSent').text(stats.sent);
        $('#poStatsPartial').text(stats.partial);
        $('#poStatsCompleted').text(stats.completed);
        $('#poStatsValue').text(utils.moneyFormat(stats.totalValue));
    }

    debugProductStockLevels() {
        console.log('=== DEBUGGING PRODUCT STOCK LEVELS ===');
        $.get('/api/inventory/products', (products) => {
            console.log('Total products in inventory:', products.length);
            
            if (products.length > 0) {
                console.log('Sample products with stock info:');
                products.slice(0, 10).forEach((product, index) => {
                    const currentStock = Number(product.quantity || product.stock || 0);
                    const reorderPoint = Number(product.reorderPoint || product.minStock || 0);
                    const supplier = product.supplier || product.supplier_id || product.supplierId || 'No supplier';
                    
                    console.log(`Product ${index + 1}:`, {
                        name: product.name,
                        currentStock: currentStock,
                        reorderPoint: reorderPoint,
                        supplier: supplier,
                        needsReorder: currentStock <= 5 || currentStock <= reorderPoint || currentStock === 0
                    });
                });
                
                // Check how many products need reordering
                const itemsNeedingReorder = products.filter(item => {
                    const currentStock = Number(item.quantity || item.stock || 0);
                    const reorderPoint = Number(item.reorderPoint || item.minStock || 0);
                    return (currentStock <= 5) || (currentStock <= reorderPoint && reorderPoint > 0) || (currentStock === 0);
                });
                
                console.log(`Products needing reorder: ${itemsNeedingReorder.length} out of ${products.length}`);
                
                if (itemsNeedingReorder.length > 0) {
                    console.log('Products that need reordering:');
                    itemsNeedingReorder.forEach(item => {
                        const currentStock = Number(item.quantity || item.stock || 0);
                        const reorderPoint = Number(item.reorderPoint || item.minStock || 0);
                        console.log(`- ${item.name}: stock=${currentStock}, reorderPoint=${reorderPoint}, supplier=${item.supplier || item.supplier_id || item.supplierId}`);
                    });
                } else {
                    console.log('No products need reordering - all products have sufficient stock');
                    console.log('💡 TIP: To test auto-draft, you can manually reduce stock levels of some products');
                }
            } else {
                console.log('No products found in inventory');
            }
        }).fail((xhr, status, error) => {
            console.error('Failed to get products for debugging:', error);
        });
    }

    // Test function to create a low-stock product for testing auto-draft
    createTestLowStockProduct() {
        console.log('=== CREATING TEST LOW-STOCK PRODUCT ===');
        
        // Get the first supplier
        if (this.suppliers.length === 0) {
            console.error('No suppliers available for test product');
            return;
        }
        
        const testSupplier = this.suppliers[0];
        console.log('Using supplier for test:', testSupplier.name);
        
        // Create a test product with low stock
        const testProduct = {
            name: 'Test Product for Auto-Draft',
            barcode: 'TEST' + Date.now(),
            quantity: 2, // Low stock
            stock: 2,
            reorderPoint: 5,
            minStock: 5,
            supplier: testSupplier.name,
            supplier_id: testSupplier._id,
            supplierId: testSupplier._id,
            price: 10.00,
            actualPrice: 10.00,
            category: 'Test',
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        console.log('Creating test product:', testProduct);
        
        $.post('/api/inventory/product', testProduct, (response) => {
            console.log('Test product created:', response);
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success('Test product created with low stock');
        }).fail((xhr, status, error) => {
            console.error('Failed to create test product:', error);
        });
    }

    // Test function to check if API is reachable
    testAutoDraftAPI() {
        console.log('=== TESTING AUTO-DRAFT API CONNECTIVITY ===');
        
        // Test basic API connectivity
        $.get(this.api + '/test', (data) => {
            console.log('✅ API test endpoint working:', data);
        }).fail((xhr, status, error) => {
            console.error('❌ API test endpoint failed:', { xhr, status, error });
        });
        
        // Test purchase orders endpoint
        $.get(this.api + '/all', (data) => {
            console.log('✅ Purchase orders API working, got response:', data);
            console.log('Response type:', typeof data);
            console.log('Response length:', data ? data.length : 'undefined');
        }).fail((xhr, status, error) => {
            console.error('❌ Purchase orders API failed:', { xhr, status, error });
        });
    }

    // Test auto-draft endpoint specifically
    testAutoDraftEndpoint() {
        console.log('=== TESTING AUTO-DRAFT ENDPOINT ===');
        console.log('⚠️ Old auto-draft endpoint is deprecated - use Auto-Draft Management instead');
        return;
        
        $.ajax({
            url: this.api + '/auto-draft',
            method: 'POST',
            data: JSON.stringify({ reorderPointThreshold: 5, expiryAlertDays: 30 }),
            contentType: 'application/json',
            timeout: 5000, // 5 second timeout for test
            success: (response) => {
                console.log('✅ Auto-draft endpoint working:', response);
            },
            error: (xhr, status, error) => {
                console.error('❌ Auto-draft endpoint failed:', { xhr, status, error });
                console.error('Status code:', xhr.status);
                console.error('Response text:', xhr.responseText);
            }
        });
    }

    // Test suppliers database
    testSuppliersDatabase() {
        console.log('=== TESTING SUPPLIERS DATABASE ===');
        
        $.ajax({
            url: this.api + '/test-suppliers',
            method: 'GET',
            timeout: 10000, // 10 second timeout
            success: (response) => {
                console.log('✅ Suppliers database working:', response);
            },
            error: (xhr, status, error) => {
                console.error('❌ Suppliers database failed:', { xhr, status, error });
                console.error('Status code:', xhr.status);
                console.error('Response text:', xhr.responseText);
            }
        });
    }

    generateAutoDraft() {
        console.log('=== OPENING AUTO-DRAFT MANAGEMENT ===');
        console.log('Auto-draft management opened at:', new Date().toISOString());
        
        // Reset state to ensure fresh start
        this.resetAutoDraftState();
        
        // Open the auto-draft management modal
        // Products will be loaded via modal event listener
        $('#autoDraftModal').modal('show');
    }
    
    // Reset auto-draft state
    resetAutoDraftState() {
        console.log('=== RESETTING AUTO-DRAFT STATE ===');
        this.isLoadingAutoDraftProducts = false;
        // Clear any existing table content
        $('#autoDraftTable tbody').html('');
        // Reset summary
        $('#totalProducts').text('0');
        $('#assignedProducts').text('0');
        $('#estimatedTotal').text('$0.00');
        $('#supplierSummary').html('');
        console.log('Auto-draft state reset successfully');
    }
    
    // Load products for auto-draft management
    loadAutoDraftProducts() {
        // Prevent multiple concurrent calls
        if (this.isLoadingAutoDraftProducts) {
            console.log('⚠️ Auto-draft products already loading, skipping duplicate call');
            return;
        }
        
        this.isLoadingAutoDraftProducts = true;
        console.log('=== LOADING AUTO-DRAFT PRODUCTS ===');
        
        // Show loading state
        $('#autoDraftTable tbody').html('<tr><td colspan="9" class="text-center"><i class="fa fa-spinner fa-spin"></i> Loading products...</td></tr>');

        // Watchdog to recover if request hangs (network hiccup)
        // Backend has 8-second timeout, so allow 10 seconds on frontend for buffer
        const watchdogId = setTimeout(() => {
            if (this.isLoadingAutoDraftProducts) {
                console.warn('⏱️ Auto-draft products request timeout - resetting state');
                this.isLoadingAutoDraftProducts = false;
                $('#autoDraftTable tbody').html(
                    '<tr><td colspan="9" class="text-center">' +
                    '<div class="text-warning mb-2"><i class="fa fa-exclamation-triangle"></i> Request timed out.</div>' +
                    '<button class="btn btn-sm btn-primary" onclick="window.purchaseOrderManager.loadAutoDraftProducts()">' +
                    '<i class="fa fa-refresh"></i> Refresh</button>' +
                    '</td></tr>'
                );
            }
        }, 10000);

        $.ajax({
            url: this.api + '/auto-draft-products',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
            reorderPointThreshold: 5,
            expiryAlertDays: 30
            }),
            timeout: 0,
            success: (response) => {
                console.log('=== AUTO-DRAFT PRODUCTS RESPONSE ===');
                console.log('Response:', response);
                
                clearTimeout(watchdogId);
                this.isLoadingAutoDraftProducts = false;
                
            if (response.success) {
                    if (response.products && response.products.length > 0) {
                        this.populateAutoDraftTable(response.products, response.suppliers);
                        this.updateAutoDraftSummary(response.products);
                    } else {
                        $('#autoDraftTable tbody').html('<tr><td colspan="9" class="text-center text-info">No products need reordering at this time.</td></tr>');
                        this.updateAutoDraftSummary([]);
                    }
                } else {
                    console.error('Failed to load auto-draft products:', response.message);
                    $('#autoDraftTable tbody').html('<tr><td colspan="9" class="text-center text-warning">' + (response.message || 'Failed to load products. Please try again.') + '</td></tr>');
                    this.updateAutoDraftSummary([]);
                }
            },
            error: (xhr, status, error) => {
                console.error('❌ Auto-draft products API call failed:', error);
                $('#autoDraftTable tbody').html('<tr><td colspan="9" class="text-center text-danger">Failed to load products. Please try again.</td></tr>');
            },
            complete: () => {
                // Reset flag when request completes (success or error)
                this.isLoadingAutoDraftProducts = false;
                clearTimeout(watchdogId);
            }
        });
    }
    
    // Populate auto-draft table with products
    populateAutoDraftTable(products, suppliers) {
        console.log('=== POPULATING AUTO-DRAFT TABLE ===');
        console.log('Products:', products.length);
        console.log('Suppliers:', suppliers.length);
        
        const tbody = $('#autoDraftTable tbody');
        tbody.empty();
        
        if (products.length === 0) {
            tbody.html('<tr><td colspan="9" class="text-center text-info">No products need reordering at this time.</td></tr>');
            return;
        }
        
        products.forEach((product, index) => {
            const row = $(`
                <tr data-product-id="${product.productId}">
                    <td>
                        <strong>${product.productName}</strong>
                        ${product.barcode ? `<br><small class="text-muted">${product.barcode}</small>` : ''}
                    </td>
                    <td>${product.barcode || '-'}</td>
                    <td>
                        <span class="badge badge-${product.currentStock === 0 ? 'danger' : 'warning'}">${product.currentStock}</span>
                        <small class="text-muted d-block">Reorder: ${product.reorderPoint}</small>
                    </td>
                    <td>
                        <span class="badge badge-${product.reason === 'out of stock' ? 'danger' : product.reason === 'expired/expiring' ? 'warning' : 'info'}">
                            ${product.reason}
                        </span>
                    </td>
                    <td>
                        <select class="form-control supplier-select" data-product-id="${product.productId}">
                            <option value="">Select Supplier</option>
                            ${suppliers.map(supplier => 
                                `<option value="${supplier._id}" ${product.supplierId == supplier._id ? 'selected' : ''}>${supplier.name}</option>`
                            ).join('')}
                        </select>
                    </td>
                    <td>
                        <input type="number" class="form-control quantity-input" data-product-id="${product.productId}" 
                               value="${product.suggestedQuantity}" min="1" step="1">
                    </td>
                    <td>$${product.unitPrice.toFixed(2)}</td>
                    <td class="total-price" data-product-id="${product.productId}">$${(product.suggestedQuantity * product.unitPrice).toFixed(2)}</td>
                    <td>
                        ${product.expiryDate ? 
                            `<small class="text-muted">${new Date(product.expiryDate).toLocaleDateString()}</small>` : 
                            '-'
                        }
                    </td>
                </tr>
            `);
            
            tbody.append(row);
        });
        
        // Add event listeners
        this.attachAutoDraftEventListeners();
    }
    
    // Attach event listeners for auto-draft table
    attachAutoDraftEventListeners() {
        // Quantity input change
        $(document).off('input', '.quantity-input').on('input', '.quantity-input', (e) => {
            const productId = $(e.target).data('product-id');
            const quantity = parseFloat($(e.target).val()) || 0;
            const unitPrice = parseFloat($(e.target).closest('tr').find('td:nth-child(7)').text().replace('$', '')) || 0;
            const total = quantity * unitPrice;
            
            $(e.target).closest('tr').find('.total-price').text('$' + total.toFixed(2));
            this.updateAutoDraftSummary();
        });
        
        // Supplier selection change
        $(document).off('change', '.supplier-select').on('change', '.supplier-select', (e) => {
            this.updateAutoDraftSummary();
        });
    }
    
    // Update auto-draft summary
    updateAutoDraftSummary(products = null) {
        if (!products) {
            // Get data from table
            const rows = $('#autoDraftTable tbody tr[data-product-id]');
            products = [];
            rows.each(function() {
                const productId = $(this).data('product-id');
                const supplierId = $(this).find('.supplier-select').val();
                const quantity = parseFloat($(this).find('.quantity-input').val()) || 0;
                const unitPrice = parseFloat($(this).find('td:nth-child(7)').text().replace('$', '')) || 0;
                
                if (supplierId && quantity > 0) {
                    products.push({
                        productId: productId,
                        supplierId: supplierId,
                        quantity: quantity,
                        unitPrice: unitPrice
                    });
                }
            });
        }
        
        const totalProducts = $('#autoDraftTable tbody tr[data-product-id]').length;
        const assignedProducts = products.length;
        const estimatedTotal = products.reduce((sum, product) => sum + (product.quantity * product.unitPrice), 0);
        
        $('#totalProducts').text(totalProducts);
        $('#assignedProducts').text(assignedProducts);
        $('#estimatedTotal').text('$' + estimatedTotal.toFixed(2));
        
        // Update supplier summary
        this.updateSupplierSummary(products);
    }
    
    // Update supplier summary
    updateSupplierSummary(products) {
        const supplierSummary = {};
        products.forEach(product => {
            if (!supplierSummary[product.supplierId]) {
                supplierSummary[product.supplierId] = {
                    count: 0,
                    total: 0
                };
            }
            supplierSummary[product.supplierId].count++;
            supplierSummary[product.supplierId].total += product.quantity * product.unitPrice;
        });
        
        const summaryHtml = Object.keys(supplierSummary).map(supplierId => {
            const supplier = this.suppliers.find(s => s._id == supplierId);
            const supplierName = supplier ? supplier.name : 'Unknown Supplier';
            return `<div class="mb-1"><strong>${supplierName}:</strong> ${supplierSummary[supplierId].count} products, $${supplierSummary[supplierId].total.toFixed(2)}</div>`;
        }).join('');
        
        $('#supplierSummary').html(summaryHtml || '<div class="text-muted">No suppliers assigned yet</div>');
    }
    
    // Create POs from assignments
    createPOsFromAssignments() {
        console.log('=== CREATING POS FROM ASSIGNMENTS ===');
        
        // Collect assignments
        const assignments = [];
        $('#autoDraftTable tbody tr[data-product-id]').each(function() {
            const productId = $(this).data('product-id');
            const supplierId = $(this).find('.supplier-select').val();
            const quantity = parseFloat($(this).find('.quantity-input').val()) || 0;
            
            console.log(`Assignment row - productId: ${productId} (type: ${typeof productId}), supplierId: ${supplierId}, quantity: ${quantity}`);
            
            if (supplierId && quantity > 0) {
                // Ensure productId is properly formatted (NeDB uses numbers for _id)
                const normalizedProductId = typeof productId === 'string' ? parseInt(productId) || productId : productId;
                assignments.push({
                    productId: normalizedProductId,
                    supplierId: parseInt(supplierId),
                    quantity: quantity
                });
            } else {
                console.warn(`Skipping assignment - missing supplierId or quantity. supplierId: ${supplierId}, quantity: ${quantity}`);
            }
        });
        
        if (assignments.length === 0) {
            if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                notiflix.Notify.warning('Please assign suppliers and quantities to at least one product.');
            } else {
                console.log('Please assign suppliers and quantities to at least one product.');
            }
            return;
        }
        
        console.log('Assignments:', assignments);
        console.log('Sending to API:', JSON.stringify({ assignments: assignments }));
        
        // Show loading state
        $('#createPOsFromAssignments').prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Creating...');
        
        $.ajax({
            url: this.api + '/auto-draft-create-pos',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ assignments: assignments }),
            success: (response) => {
                console.log('=== CREATE POS RESPONSE ===');
                console.log('Response:', response);
                
                if (response.success) {
                    const message = `Successfully created ${response.orders.length} purchase orders!`;
                    console.log('✅ ' + message);
                    
                    if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                        notiflix.Notify.success(message);
                    } else {
                        console.log('✅ ' + message);
                    }
                    
                    // Close modal and refresh purchase orders
                    $('#autoDraftModal').modal('hide');
                this.loadPurchaseOrders();
            } else {
                    console.error('Failed to create POs:', response.message);
                    if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                        notiflix.Notify.failure('Failed to create purchase orders: ' + response.message);
                    } else {
                        console.error('❌ Failed to create purchase orders: ' + response.message);
            }
                }
            },
            error: (xhr, status, error) => {
                console.error('❌ Create POs API call failed:', error);
                if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                    notiflix.Notify.failure('Failed to create purchase orders. Please try again.');
                } else {
                    console.error('❌ Failed to create purchase orders. Please try again.');
                }
            },
            complete: () => {
                $('#createPOsFromAssignments').prop('disabled', false).html('<i class="fa fa-save"></i> Create POs');
            }
        });
    }

    showCreatePOModal() {
        $('#createPOModal').modal('show');
        this.populateSupplierDropdowns();
        this.resetPOForm();
    }

    populateSupplierDropdowns() {
        const supplierSelect = $('#poSupplierSelect');
        const supplierFilter = $('#poSupplierFilter');
        
        supplierSelect.empty().append('<option value="">Select Supplier</option>');
        supplierFilter.empty().append('<option value="">All Suppliers</option>');
        
        this.suppliers.forEach(supplier => {
            supplierSelect.append(`<option value="${supplier._id}">${supplier.name}</option>`);
            supplierFilter.append(`<option value="${supplier._id}">${supplier.name}</option>`);
        });
    }

    addPOItem() {
        const addBtn = $('#addPOItem');
        const originalText = addBtn.html();
        addBtn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Adding...');

        const productId = $('#poProductSelect').val();
        const quantity = parseInt($('#poQuantity').val()) || 1;
        const unitPrice = parseFloat($('#poUnitPrice').val()) || 0;

        // Enhanced validation
        if (!productId) {
            if (typeof notiflix !== 'undefined') {
                notiflix.Notify.warning('Please select a product');
            } else {
                alert('Please select a product');
            }
            $('#poProductSelect').focus();
            addBtn.prop('disabled', false).html(originalText);
            return;
        }

        if (quantity <= 0) {
            if (typeof notiflix !== 'undefined') {
                notiflix.Notify.warning('Please enter a valid quantity');
            } else {
                alert('Please enter a valid quantity');
            }
            $('#poQuantity').focus();
            addBtn.prop('disabled', false).html(originalText);
            return;
        }

        if (unitPrice < 0) {
            if (typeof notiflix !== 'undefined') {
                notiflix.Notify.warning('Please enter a valid unit price');
            } else {
                alert('Please enter a valid unit price');
            }
            $('#poUnitPrice').focus();
            addBtn.prop('disabled', false).html(originalText);
            return;
        }

        // Find product from current supplier's products
        const product = this.currentSupplierProducts?.find(p => p._id == productId);
        if (!product) {
            if (typeof notiflix !== 'undefined') {
                notiflix.Notify.warning('Product not found');
            } else {
                alert('Product not found');
            }
            addBtn.prop('disabled', false).html(originalText);
            return;
        }

        // Check if product is already in the order
        const existingRow = $(`#poItemsTable tbody tr[data-product-id="${productId}"]`);
        if (existingRow.length > 0) {
            if (typeof notiflix !== 'undefined') {
                notiflix.Notify.warning('This product is already in the order. Please update the quantity instead.');
            } else {
                alert('This product is already in the order. Please update the quantity instead.');
            }
            addBtn.prop('disabled', false).html(originalText);
            return;
        }

        const totalPrice = quantity * unitPrice;
        const rowId = `po-item-${Date.now()}`;

        // Hide "no items" row if it exists
        $('#noItemsRow').hide();

        $('#poItemsTable tbody').append(`
            <tr id="${rowId}" data-product-id="${productId}">
                <td>${product.name}</td>
                <td>${product.barcode}</td>
                <td><input type="number" class="form-control form-control-sm" value="${quantity}" min="1"></td>
                <td><input type="number" class="form-control form-control-sm" value="${unitPrice}" step="0.01" min="0"></td>
                <td class="text-right">${utils.moneyFormat(totalPrice)}</td>
                <td class="text-center">
                    <button type="button" class="btn btn-sm btn-danger remove-po-item">
                        <i class="fa fa-trash"></i>
                    </button>
                </td>
            </tr>
        `);

        // Show success feedback
        if (typeof notiflix !== 'undefined') {
            notiflix.Notify.success(`${product.name} added to order`);
        }

        // Clear form
        $('#poProductSelect').val('');
        $('#poQuantity').val('1');
        $('#poUnitPrice').val('');

        // Reset button state
        addBtn.prop('disabled', false).html(originalText);

        this.calculatePOTotals();
    }

    addExistingItemToTable(item) {
        try {
            console.log('Adding existing item to table:', item.productName, 'Qty:', item.quantity);
            
            const rowId = `po-item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const totalPrice = item.quantity * item.unitPrice;

        // Hide "no items" row if it exists
        $('#noItemsRow').hide();
        
        $('#poItemsTable tbody').append(`
                <tr id="${rowId}" data-product-id="${item.productId}">
                    <td>${item.productName}</td>
                    <td>${item.barcode || ''}</td>
                    <td><input type="number" class="form-control form-control-sm" value="${item.quantity}" min="1"></td>
                    <td><input type="number" class="form-control form-control-sm" value="${item.unitPrice}" step="0.01" min="0"></td>
                    <td class="text-right">${utils.moneyFormat(totalPrice)}</td>
                    <td class="text-center">
                        <button type="button" class="btn btn-sm btn-danger remove-po-item">
                            <i class="fa fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `);
            
            console.log('✅ Item added to table successfully:', item.productName);
            
        } catch (error) {
            console.error('❌ Error adding existing item to table:', error);
            console.error('Item data:', item);
            throw error; // Re-throw to be caught by caller
        }
    }

    calculatePOTotals() {
        let subtotal = 0;
        let totalItems = 0;

        $('#poItemsTable tbody tr').each(function() {
            const quantity = parseInt($(this).find('td:nth-child(3) input').val()) || 0;
            const unitPrice = parseFloat($(this).find('td:nth-child(4) input').val()) || 0;
            const total = quantity * unitPrice;
            
            $(this).find('td:nth-child(5)').text(utils.moneyFormat(total));
            subtotal += total;
            totalItems += quantity;
        });

        const tax = parseFloat($('#poTax').val()) || 0;
        const discount = parseFloat($('#poDiscount').val()) || 0;
        const total = subtotal + tax - discount;

        $('#poSubtotal').text(utils.moneyFormat(subtotal));
        $('#poTotal').text(utils.moneyFormat(total));
        $('#poTotalItems').text(totalItems);
    }

    showValidationError(message, targetSelector = null) {
        // Show error notification
        if (typeof notiflix !== 'undefined' && notiflix.Notify) {
            notiflix.Notify.warning(message);
        } else {
            alert(message);
        }
        
        // Highlight target field if specified
        if (targetSelector) {
            $(targetSelector).addClass('is-invalid');
            $(targetSelector).focus();
            
            // Remove highlight after 3 seconds
            setTimeout(() => {
                $(targetSelector).removeClass('is-invalid');
            }, 3000);
        }
    }

    clearValidationErrors() {
        $('.is-invalid').removeClass('is-invalid');
    }

    setupFormValidation() {
        // Real-time validation for supplier selection
        $(document).on('change', '#poSupplierSelect', () => {
            const supplierId = $('#poSupplierSelect').val();
            if (supplierId) {
                $('#poSupplierSelect').removeClass('is-invalid').addClass('is-valid');
            } else {
                $('#poSupplierSelect').removeClass('is-valid').addClass('is-invalid');
            }
        });

        // Real-time validation for quantity and price inputs
        $(document).on('input', '#poItemsTable input[type="number"]', () => {
            this.validateItemInputs();
        });

        // Real-time validation for tax and discount
        $(document).on('input', '#poTax, #poDiscount', () => {
            const tax = parseFloat($('#poTax').val()) || 0;
            const discount = parseFloat($('#poDiscount').val()) || 0;
            
            if (tax < 0) {
                $('#poTax').addClass('is-invalid');
            } else {
                $('#poTax').removeClass('is-invalid').addClass('is-valid');
            }
            
            if (discount < 0) {
                $('#poDiscount').addClass('is-invalid');
            } else {
                $('#poDiscount').removeClass('is-invalid').addClass('is-valid');
            }
            
            this.calculatePOTotals();
        });
    }

    validateItemInputs() {
        let hasErrors = false;
        
        $('#poItemsTable tbody tr').each(function() {
            const quantity = parseInt($(this).find('td:nth-child(3) input').val()) || 0;
            const unitPrice = parseFloat($(this).find('td:nth-child(4) input').val()) || 0;
            
            const $quantityInput = $(this).find('td:nth-child(3) input');
            const $priceInput = $(this).find('td:nth-child(4) input');
            
            // Validate quantity
            if (quantity <= 0) {
                $quantityInput.addClass('is-invalid').removeClass('is-valid');
                hasErrors = true;
            } else {
                $quantityInput.removeClass('is-invalid').addClass('is-valid');
            }
            
            // Validate unit price
            if (unitPrice < 0) {
                $priceInput.addClass('is-invalid').removeClass('is-valid');
                hasErrors = true;
            } else {
                $priceInput.removeClass('is-invalid').addClass('is-valid');
            }
        });
        
        // Update totals
        this.calculatePOTotals();
        
        return !hasErrors;
    }

    savePurchaseOrder() {
        const supplierId = $('#poSupplierSelect').val();
        const notes = $('#poNotes').val();
        const expectedDelivery = $('#poExpectedDelivery').val();

        // Enhanced validation
        if (!supplierId) {
            this.showValidationError('Please select a supplier', '#poSupplierSelect');
            return;
        }

        // Check if any items are added
        const itemCount = $('#poItemsTable tbody tr').length;
        if (itemCount === 0) {
            this.showValidationError('Please add at least one item to the purchase order', '#poItemsTable');
            return;
        }

        const items = [];
        const self = this; // Store reference to the class instance
        $('#poItemsTable tbody tr').each(function() {
            const productName = $(this).find('td:nth-child(1)').text();
            const barcode = $(this).find('td:nth-child(2)').text();
            const quantity = parseInt($(this).find('td:nth-child(3) input').val()) || 0;
            const unitPrice = parseFloat($(this).find('td:nth-child(4) input').val()) || 0;

            if (quantity > 0 && unitPrice >= 0) {
                // Find the product ID from the current supplier's products
                const product = self.currentSupplierProducts?.find(p => p.name === productName);
                items.push({
                    productId: product?._id,
                    productName: productName,
                    barcode: barcode,
                    quantity: quantity,
                    unitPrice: unitPrice
                });
            }
        });

        if (items.length === 0) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('Please add at least one item');
            return;
        }

        const supplier = this.suppliers.find(s => s._id == supplierId);
        console.log('Found supplier:', supplier);
        console.log('All suppliers:', this.suppliers);
        console.log('Looking for supplier ID:', supplierId);
        
        if (!supplier) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Supplier not found');
            return;
        }
        
        const tax = parseFloat($('#poTax').val()) || 0;
        const discount = parseFloat($('#poDiscount').val()) || 0;
        
        const orderData = {
            supplierId: supplierId,
            supplierName: supplier.name,
            items: items,
            tax: tax,
            discount: discount,
            notes: notes,
            expectedDeliveryDate: expectedDelivery,
            createdBy: 'user',
            // New fields for supplier linking system
            poType: $('#createMasterPO').is(':checked') ? 'master' : 'individual',
            supplierAssignmentMethod: 'manual'
        };

        console.log('=== PURCHASE ORDER DATA ===');
        console.log('Order Data:', orderData);
        console.log('Items:', items);
        console.log('Items details:');
        items.forEach((item, index) => {
            console.log(`  Item ${index}:`, {
                productId: item.productId,
                productName: item.productName,
                barcode: item.barcode,
                quantity: item.quantity,
                unitPrice: item.unitPrice
            });
        });
        console.log('Supplier ID:', supplierId);
        console.log('Supplier Name:', supplier.name);
        console.log('Tax:', tax);
        console.log('Discount:', discount);
        console.log('=== END ORDER DATA ===');

        // Get submit button reference first
        const submitBtn = $('#createPOBtn');
        
        // Check if this is an edit operation
        const originalOrderId = submitBtn.data('original-order-id');
        const isEdit = !!originalOrderId || !!this.currentOrder;
        
        console.log('=== EDIT DETECTION DEBUG ===');
        console.log('Original Order ID from button:', originalOrderId);
        console.log('Current Order exists:', !!this.currentOrder);
        console.log('Current Order ID:', this.currentOrder ? this.currentOrder._id : 'none');
        console.log('Is Edit Operation:', isEdit);
        console.log('=== END EDIT DETECTION DEBUG ===');
        
        // For edit operations, preserve the original status
        if (isEdit && this.currentOrder) {
            orderData.status = this.currentOrder.status;
            console.log('Preserving status for edit:', orderData.status);
        } else {
            // For new orders, set status to draft
            orderData.status = 'draft';
            console.log('Setting status for new order:', orderData.status);
        }
        
        // Show loading state
        const originalText = submitBtn.text();
        const loadingText = isEdit ? '<i class="fa fa-spinner fa-spin"></i> Updating...' : '<i class="fa fa-spinner fa-spin"></i> Creating...';
        submitBtn.prop('disabled', true).html(loadingText);

        // Determine URL and method
        const editOrderId = originalOrderId || (this.currentOrder ? this.currentOrder._id : null);
        const url = isEdit ? `${this.api}/${editOrderId}` : this.api;
        const method = isEdit ? 'PUT' : 'POST';
        
        console.log('=== API CALL DEBUG ===');
        console.log('Edit Order ID:', editOrderId);
        console.log('URL:', url);
        console.log('Method:', method);
        console.log('=== END API CALL DEBUG ===');

        $.ajax({
            url: url,
            type: method,
            data: JSON.stringify(orderData),
            contentType: 'application/json',
            dataType: 'json',
            success: (response) => {
                console.log('Purchase order response:', response);
                console.log('Response type:', typeof response);
                console.log('Response keys:', Object.keys(response));
                console.log('Response.success:', response.success);
                console.log('Response.poNumber:', response.poNumber);
                console.log('Response.data:', response.data);
                console.log('Response.order:', response.order);
                console.log('Response.order.poNumber:', response.order?.poNumber);
                
            if (response.success) {
                    // Show enhanced success notification
                    const successMessage = isEdit ? 'Purchase order updated successfully!' : 'Purchase order created successfully!';
                    const poNumber = response.order?.poNumber || response.poNumber || response.data?.poNumber || 'N/A';
                    
                    console.log('Success message:', successMessage);
                    console.log('PO Number extracted:', poNumber);
                    
                    // Test notiflix availability
                    console.log('Notiflix available:', typeof notiflix !== 'undefined');
                    console.log('Notiflix.Notify available:', typeof notiflix !== 'undefined' && typeof notiflix.Notify !== 'undefined');
                    
                    // Show single, clean notification
                    try {
                        if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                            console.log('Showing notiflix success notification');
                            notiflix.Notify.success(successMessage);
                        } else {
                            console.log('Notiflix not available, showing custom notification');
                            this.showCustomNotification(successMessage, poNumber);
                        }
                    } catch (error) {
                        console.error('Error showing notification:', error);
                        this.showCustomNotification(successMessage, poNumber);
                    }
                    
                    // Show success message in console for debugging
                    console.log('✅ Purchase order created successfully!');
                    console.log('📋 PO Number:', poNumber);
                    console.log('📊 Status: Draft');
                    
                    // Close modal and reset form
                $('#createPOModal').modal('hide');
                    this.resetPOForm();
                    
                    // Reload purchase orders to update the list
                this.loadPurchaseOrders();
                    
            } else {
                    console.error('Purchase order creation failed:', response);
                    const errorMessage = 'Failed to create purchase order: ' + (response.message || 'Unknown error');
                    
                    if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                        notiflix.Notify.failure(errorMessage);
                    } else {
                        alert(errorMessage);
                    }
                }
                
                // Reset button state
                submitBtn.prop('disabled', false).text(originalText);
            },
            error: (xhr, status, error) => {
                console.error('Purchase order request failed:', {
                    status: status,
                    error: error,
                    xhr: xhr,
                    responseText: xhr.responseText,
                    statusCode: xhr.status
                });
                
                let errorMessage = 'Failed to create purchase order';
                try {
                    const errorResponse = JSON.parse(xhr.responseText);
                    errorMessage += ': ' + (errorResponse.message || errorResponse.error || 'Unknown error');
                } catch (e) {
                    errorMessage += ': ' + error;
                }
                
                // Show enhanced error notification
                if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                    notiflix.Notify.failure(errorMessage);
                } else {
                    alert(errorMessage);
                }
                
                // Show error banner for better visibility
                this.showErrorFeedback(errorMessage);
                
                // Reset button state
                submitBtn.prop('disabled', false).text(originalText);
            }
        });
    }

    sendPOToSupplier(orderId) {
        console.log('🚀 PURCHASE-ORDERS.JS: sendPOToSupplier called for order:', orderId);
        
        const order = this.orders.find(o => o._id == orderId);
        if (!order) {
            console.error('❌ Order not found:', orderId);
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Purchase order not found');
            return;
        }
        console.log('✅ Order found:', order);

        // First, check if supplier has phone number before changing status
        const supplier = this.suppliers.find(s => s._id == order.supplierId);
        if (!supplier) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Supplier not found');
            return;
        }
        
        if (!supplier.phone) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning(`Phone number is not available for supplier "${supplier.name}". Please add a phone number to the supplier profile to send WhatsApp messages.`);
            return;
        }
                    
        // If phone number exists, proceed with sending
                    this.openWhatsAppWithPO(order);
    }

    openWhatsAppWithPO(order) {
        const supplier = this.suppliers.find(s => s._id == order.supplierId);
        if (!supplier) {
            if (typeof notiflix !== 'undefined') {
                notiflix.Notify.failure('Supplier not found');
            } else {
                alert('Supplier not found');
            }
            return;
        }

        // Format PO message according to new specification
        let message = '';
        message += `Hi *${supplier.name}* ,\n\n`;
        message += `Please kindly process the following purchase order:\n`;
        
        // Add items in the specified format
        order.items.forEach((item) => {
            message += `${item.productName}: ${item.quantity} units\n`;
        });
        
        message += `\nReference: *${order.poNumber}*\n`;
        
        // Add delivery information
        if (order.expectedDeliveryDate) {
            const deliveryDate = moment(order.expectedDeliveryDate).format('DD-MMM-YYYY');
            message += `Delivery requested: ASAP, preferably by *${deliveryDate}* .\n\n`;
        } else {
            message += `Delivery requested: ASAP.\n\n`;
        }
        
        message += `Kindly confirm receipt of this order, product availability, and the total cost at your earliest convenience.\n\n`;
        
        // Get pharmacy name from settings (store name)
        const pharmacyName = (this.settings && this.settings.store) ? this.settings.store : 'PharmaSpot';
        message += `Thank you,\n*${pharmacyName}*\n\n`;
        
        // Add PO type information if it's a sub-PO
        if (order.poType === 'sub' && order.masterPOId) {
            message += `(Sub-PO from Master PO)\n`;
        } else if (order.poType === 'master') {
            message += `(Master PO - will be split by supplier)\n`;
        }
        
        // Add notes with generation info
        const generatedDateTime = moment().format('DD-MMM-YYYY HH:mm');
        message += `Note: _This order was auto-generated based on reorder points on_ ${generatedDateTime}.\nPowered by MukhtiYar Khan`;

        // Clean phone number (remove non-digits and add country code if needed)
        let phoneNumber = supplier.phone.replace(/\D/g, '');
        if (!phoneNumber.startsWith('1') && phoneNumber.length === 10) {
            phoneNumber = '1' + phoneNumber; // Add US country code
        }

        // For WhatsApp desktop app, ensure proper international format
        let whatsappPhoneNumber = phoneNumber;
        if (!whatsappPhoneNumber.startsWith('+')) {
            whatsappPhoneNumber = '+' + whatsappPhoneNumber;
        }

        // Open WhatsApp Web in default browser
        const whatsappUrl = `https://web.whatsapp.com/send?phone=${whatsappPhoneNumber}&text=${encodeURIComponent(message)}`;
        
        // Try multiple methods to ensure it opens in the correct browser
        this.openWhatsAppInDefaultBrowser(whatsappUrl, order._id);
    }

    openWhatsAppInDefaultBrowser(whatsappUrl, orderId) {
        console.log('🚀 PURCHASE-ORDERS.JS: openWhatsAppInDefaultBrowser called');
        console.log('📱 WhatsApp URL:', whatsappUrl);
        console.log('🆔 Order ID:', orderId);
        
        // For Electron, use a simpler approach that won't trigger browser update screens
        try {
            console.log('🔄 Opening WhatsApp in Electron');
            
            // Use Electron's shell.openExternal for better compatibility
            if (typeof require !== 'undefined') {
                const { shell } = require('electron');
                shell.openExternal(whatsappUrl);
                console.log('✅ WhatsApp opened via Electron shell');
                
                // Update status after opening
                setTimeout(() => {
                    this.updatePOStatus(orderId, 'sent', 'Purchase order sent to supplier');
                }, 1000);
                return;
            }
            
            // Fallback to window.open if not in Electron
            const newWindow = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
            
            if (newWindow && !newWindow.closed) {
                console.log('✅ WhatsApp opened in new tab successfully');
                setTimeout(() => {
                    this.updatePOStatus(orderId, 'sent', 'Purchase order sent to supplier');
                }, 1000);
                return;
            }
        } catch (error) {
            console.log('❌ Failed to open WhatsApp:', error);
        }
        
        // Method 2: Try using location.href (opens in current window)
        try {
            console.log('Trying Method 2: location.href');
            window.location.href = whatsappUrl;
            // Update status after redirect
            setTimeout(() => {
                this.updatePOStatus(orderId, 'sent', 'Purchase order sent to supplier');
            }, 500);
            return;
        } catch (error) {
            console.log('Method 2 failed:', error);
        }
        
        // Method 3: Create a temporary link and click it
        try {
            console.log('Trying Method 3: temporary link');
            const link = document.createElement('a');
            link.href = whatsappUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Update status after link click
            setTimeout(() => {
                this.updatePOStatus(orderId, 'sent', 'Purchase order sent to supplier');
            }, 1000);
            return;
        } catch (error) {
            console.log('Method 3 failed:', error);
        }
        
        // Method 4: Fallback - show URL for manual copy
        console.log('All methods failed, showing manual option');
        if (typeof notiflix !== 'undefined' && notiflix.Report) {
            notiflix.Report.info(
                'WhatsApp Link',
                `Please copy this link and open it in your default browser (Brave):\n\n${whatsappUrl}`,
                'Copy Link',
                () => {
                    navigator.clipboard.writeText(whatsappUrl).then(() => {
                        notiflix.Notify.success('Link copied to clipboard!');
                        this.updatePOStatus(orderId, 'sent', 'Purchase order sent to supplier');
                    });
                }
            );
        } else {
            const copy = confirm(`Please copy this link and open it in Brave:\n\n${whatsappUrl}\n\nClick OK to copy to clipboard.`);
            if (copy) {
                navigator.clipboard.writeText(whatsappUrl).then(() => {
                    alert('Link copied to clipboard!');
                    this.updatePOStatus(orderId, 'sent', 'Purchase order sent to supplier');
                });
            }
        }
    }

    updatePOStatus(orderId, status, successMessage) {
        console.log('🔄 Updating PO status:', { orderId, status, successMessage });
        console.log('📡 API URL:', `${this.api}/${orderId}`);
        
        $.ajax({
            url: `${this.api}/${orderId}`,
            type: 'PUT',
            data: JSON.stringify({ status: status }),
            contentType: 'application/json',
            success: (response) => {
                console.log('✅ Status update response:', response);
                if (response.success) {
                    console.log('✅ Status updated successfully');
                    if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                        notiflix.Notify.success(successMessage);
                    } else {
                        console.log(successMessage);
                    }
                    this.loadPurchaseOrders();
                } else {
                    console.error('❌ Status update failed:', response);
                    if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                        notiflix.Notify.failure('Failed to update purchase order status');
                    } else {
                        console.error('Failed to update purchase order status');
                    }
                }
            },
            error: (xhr, status, error) => {
                console.error('❌ Status update AJAX error:', { xhr, status, error });
                if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                    notiflix.Notify.failure('Failed to update purchase order status');
                } else {
                    console.error('Failed to update purchase order status');
                }
            }
        });
    }

    showReceiveItemsModal(orderId) {
        console.log('Looking for purchase order to receive items for ID:', orderId);
        console.log('Available orders:', this.orders.map(o => ({ id: o._id, poNumber: o.poNumber })));
        
        const order = this.orders.find(o => o._id == orderId);
        if (!order) {
            console.error('Purchase order not found for ID:', orderId);
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Purchase order not found');
            return;
        }

        this.currentOrder = order;
        
        // Update modal title with PO details
        $('#receiveItemsModalLabel').html(`
            <i class="fa fa-check-square"></i> Receive Items - ${order.poNumber}
            <small class="text-muted">${order.supplierName}</small>
        `);
        
        // Show loading state
        this.showReceiveItemsLoading();
        
        $('#receiveItemsModal').modal('show');
        this.populateReceiveItemsTable();

        // Ensure fields are enabled and focus is set when modal is shown
        $('#receiveItemsModal').off('shown.bs.modal.receive').on('shown.bs.modal.receive', () => {
            const $modal = $('#receiveItemsModal');
            $modal.find('input, select, textarea, button').prop('disabled', false);
            // Focus the first quantity input for better UX
            const $firstQty = $modal.find('.receive-qty').first();
            if ($firstQty.length) {
                $firstQty.focus();
            }
        });
    }

    showReceiveItemsLoading() {
        const tbody = $('#receiveItemsTable tbody');
        tbody.html(`
            <tr>
                <td colspan="10" class="text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="sr-only">Loading...</span>
                    </div>
                    <p class="mt-2">Loading items to receive...</p>
                </td>
            </tr>
        `);
    }

    populateReceiveItemsTable() {
        const tbody = $('#receiveItemsTable tbody');
        tbody.empty();

        if (!this.currentOrder || !this.currentOrder.items) {
            tbody.html(`
                <tr>
                    <td colspan="10" class="text-center text-muted">
                        <i class="fa fa-exclamation-triangle"></i> No items found in this purchase order
                    </td>
                </tr>
            `);
            return;
        }

        let hasPendingItems = false;
        let totalPending = 0;
        let totalReceived = 0;

        this.currentOrder.items.forEach((item, index) => {
            const pendingQty = item.quantity - (item.receivedQuantity || 0);
            totalPending += pendingQty;
            totalReceived += (item.receivedQuantity || 0);
            
            if (pendingQty > 0) {
                hasPendingItems = true;
                const rowClass = pendingQty === item.quantity ? 'table-warning' : 'table-info';
                
                // Resolve product by id, then fallback to barcode, then name
                let product = (this.products || []).find(p => p._id == item.productId) || null;
                if (!product) {
                    const tryBarcode = item.barcode || (typeof item.productBarcode !== 'undefined' ? item.productBarcode : null);
                    if (tryBarcode) {
                        const numericBarcode = parseInt(tryBarcode);
                        product = (this.products || []).find(p => parseInt(p.barcode) === numericBarcode) || null;
                    }
                }
                if (!product && item.productName) {
                    const nameLower = String(item.productName).toLowerCase();
                    product = (this.products || []).find(p => String(p.name).toLowerCase() === nameLower) || null;
                }
                const rowProductId = item.productId || (product ? product._id : (item._id || ''));
                const currentBarcode = item.barcode || (product ? product.barcode : '') || '';
                const currentPurchasePrice = Number((item.unitPrice !== undefined ? item.unitPrice : (product.actualPrice !== undefined ? product.actualPrice : 0))) || 0;
                const currentSellingPrice = Number((product.price !== undefined ? product.price : 0)) || 0;

                tbody.append(`
                    <tr data-product-id="${rowProductId}" class="${rowClass}">
                        <td>
                            <div class="d-flex align-items-center">
                                <div class="mr-2">
                                    <span class="badge badge-primary">${index + 1}</span>
                                </div>
                                <div>
                                    <strong>${item.productName}</strong>
                                    <br><small class="text-muted">${currentBarcode}</small>
                                </div>
                            </div>
                        </td>
                        <td>
                            <input type="number" class="form-control form-control-sm receive-barcode" 
                                   placeholder="Barcode" value="${currentBarcode}">
                        </td>
                        <td>
                            <input type="number" step="0.01" class="form-control form-control-sm receive-purchase-price" 
                                   placeholder="Purchase price" value="${currentPurchasePrice}">
                        </td>
                        <td>
                            <input type="number" step="0.01" class="form-control form-control-sm receive-selling-price" 
                                   placeholder="Selling price" value="${currentSellingPrice}">
                        </td>
                        <td>
                            <span class="badge badge-secondary">${item.quantity}</span>
                        </td>
                        <td>
                            <span class="badge badge-success">${item.receivedQuantity || 0}</span>
                        </td>
                        <td>
                            <span class="badge badge-warning">${pendingQty}</span>
                        </td>
                        <td>
                            <div class="input-group input-group-sm">
                                <input type="number" class="form-control receive-qty" 
                                       value="${pendingQty}" min="0" max="${pendingQty}"
                                       data-original-qty="${pendingQty}"
                                       placeholder="0">
                                <div class="input-group-append">
                                    <button class="btn btn-outline-secondary btn-sm" type="button" 
                                            onclick="window.purchaseOrderManager.setReceiveQty('${rowProductId}', '${pendingQty}')"
                                            title="Set to pending quantity">
                                        <i class="fa fa-arrow-up"></i>
                                    </button>
                                </div>
                            </div>
                        </td>
                        <td>
                            <input type="text" class="form-control form-control-sm receive-lot" 
                                   placeholder="Enter lot number" maxlength="50">
                        </td>
                        <td>
                            <input type="date" class="form-control form-control-sm receive-expiry"
                                   min="${new Date().toISOString().split('T')[0]}">
                        </td>
                    </tr>
                `);
            }
        });

        if (!hasPendingItems) {
            tbody.html(`
                <tr>
                    <td colspan="10" class="text-center text-success">
                        <i class="fa fa-check-circle"></i> All items have been received for this purchase order
                    </td>
                </tr>
            `);
        }

        // Update summary information
        this.updateReceiveItemsSummary(totalPending, totalReceived);
        
        // Setup event listeners for better UX
        this.setupReceiveItemsEventListeners();
    }

    updateReceiveItemsSummary(totalPending, totalReceived) {
        // Add or update summary section
        let summaryHtml = `
            <div class="row mb-3" id="receiveItemsSummary">
                <div class="col-md-4">
                    <div class="card bg-light">
                        <div class="card-body text-center">
                            <h5 class="card-title text-primary">${totalPending}</h5>
                            <p class="card-text">Items Pending</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card bg-light">
                        <div class="card-body text-center">
                            <h5 class="card-title text-success">${totalReceived}</h5>
                            <p class="card-text">Items Received</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card bg-light">
                        <div class="card-body text-center">
                            <h5 class="card-title text-info" id="itemsToReceive">0</h5>
                            <p class="card-text">Items to Receive</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Insert summary before the table
        if ($('#receiveItemsSummary').length === 0) {
            $('#receiveItemsTable').before(summaryHtml);
        } else {
            $('#receiveItemsSummary').html(summaryHtml);
        }
    }

    setupReceiveItemsEventListeners() {
        // Real-time validation and feedback
        $(document).off('input.receiveItems').on('input.receiveItems', '.receive-qty', (e) => {
            const input = $(e.target);
            const value = parseInt(input.val()) || 0;
            const max = parseInt(input.attr('max')) || 0;
            const row = input.closest('tr');
            
            // Visual feedback
            if (value > max) {
                input.addClass('is-invalid');
                row.addClass('table-danger');
            } else if (value > 0) {
                input.removeClass('is-invalid');
                row.removeClass('table-danger').addClass('table-success');
            } else {
                input.removeClass('is-invalid');
                row.removeClass('table-danger table-success');
            }
            
            // Update summary
            this.updateReceiveItemsCount();
        });

        // Auto-focus next field on Enter
        $(document).off('keydown.receiveItems').on('keydown.receiveItems', '.receive-qty', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const row = $(e.target).closest('tr');
                row.find('.receive-lot').focus();
            }
        });

        $(document).off('keydown.receiveItems').on('keydown.receiveItems', '.receive-lot', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const row = $(e.target).closest('tr');
                row.find('.receive-expiry').focus();
            }
        });

        // Auto-focus next row on Tab
        $(document).off('keydown.receiveItems').on('keydown.receiveItems', '.receive-expiry', (e) => {
            if (e.key === 'Tab' && !e.shiftKey) {
                const currentRow = $(e.target).closest('tr');
                const nextRow = currentRow.next('tr');
                if (nextRow.length > 0) {
                    e.preventDefault();
                    nextRow.find('.receive-qty').focus();
                }
            }
        });
    }

    updateReceiveItemsCount() {
        let totalToReceive = 0;
        $('.receive-qty').each(function() {
            const qty = parseInt($(this).val()) || 0;
            if (qty > 0) {
                totalToReceive += qty;
            }
        });
        $('#itemsToReceive').text(totalToReceive);
    }

    setReceiveQty(productId, qty) {
        const input = $(`tr[data-product-id="${productId}"] .receive-qty`);
        input.val(qty).trigger('input');
        input.focus();
    }

    scanReceiveBarcode() {
        const barcode = $('#receiveBarcodeInput').val().trim();
        if (!barcode) return;

        // Show scanning feedback
        const inputGroup = $('#receiveBarcodeInput').closest('.input-group');
        inputGroup.addClass('scanning');
        
        // Add visual feedback
        setTimeout(() => {
            inputGroup.removeClass('scanning');
        }, 500);

        const product = this.products.find(p => p.barcode == barcode);
        if (!product) {
            this.showBarcodeFeedback('error', `Product not found for barcode: ${barcode}`);
            $('#receiveBarcodeInput').val('');
            return;
        }

        const orderItem = this.currentOrder.items.find(item => item.productId == product._id);
        if (!orderItem) {
            this.showBarcodeFeedback('warning', `Product "${product.name}" is not in this purchase order`);
            $('#receiveBarcodeInput').val('');
            return;
        }

        const pendingQty = orderItem.quantity - (orderItem.receivedQuantity || 0);
        if (pendingQty <= 0) {
            this.showBarcodeFeedback('info', `All items for "${product.name}" have been received`);
            $('#receiveBarcodeInput').val('');
            return;
        }

        // Find the row and highlight it
        const row = $(`#receiveItemsTable tbody tr[data-product-id="${product._id}"]`);
        if (row.length > 0) {
            // Highlight the row
            row.addClass('table-info');
            setTimeout(() => {
                row.removeClass('table-info');
            }, 2000);
            
            // Focus on quantity input
            const qtyInput = row.find('.receive-qty');
            qtyInput.focus().select();
            
            this.showBarcodeFeedback('success', `Found: ${product.name} (${pendingQty} pending)`);
        }

        $('#receiveBarcodeInput').val('');
    }

    showBarcodeFeedback(type, message) {
        const feedbackHtml = `
            <div class="alert alert-${type === 'error' ? 'danger' : type} alert-dismissible fade show" role="alert">
                <i class="fa fa-${type === 'success' ? 'check-circle' : type === 'warning' ? 'exclamation-triangle' : type === 'error' ? 'times-circle' : 'info-circle'}"></i>
                ${message}
                <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        `;
        
        // Insert feedback above the barcode input
        const inputContainer = $('#receiveBarcodeInput').closest('.row');
        inputContainer.find('.alert').remove(); // Remove existing alerts
        inputContainer.append(feedbackHtml);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            inputContainer.find('.alert').fadeOut();
        }, 3000);
    }

    saveReceiveItems() {
        console.log('=== SAVE RECEIVE ITEMS DEBUG ===');
        const receivedItems = [];
        const validationErrors = [];

        // Debug: Check table structure
        const tableRows = $('#receiveItemsTable tbody tr');
        console.log('Total table rows found:', tableRows.length);
        console.log('Table HTML:', $('#receiveItemsTable tbody').html());

        // Validate all inputs
        $('#receiveItemsTable tbody tr').each((index, el) => {
            const $row = $(el);
            let productId = $row.data('product-id');
            const quantity = parseInt($row.find('.receive-qty').val()) || 0;
            const lotNumber = $row.find('.receive-lot').val().trim();
            const expiryDate = $row.find('.receive-expiry').val();
            const barcodeVal = ($row.find('.receive-barcode').val() || '').toString().trim();
            const purchasePriceVal = ($row.find('.receive-purchase-price').val() || '').toString().trim();
            const sellingPriceVal = ($row.find('.receive-selling-price').val() || '').toString().trim();
            const maxQty = parseInt($row.find('.receive-qty').attr('max')) || 0;
            const productName = $row.find('td:first strong').text();

            console.log(`Row ${index}:`, {
                productId: productId,
                quantity: quantity,
                lotNumber: lotNumber,
                expiryDate: expiryDate,
                maxQty: maxQty,
                productName: productName
            });

            // Resolve missing productId using barcode or name
            if (!productId || productId === '' || productId === 'undefined') {
                const numericBarcode = barcodeVal ? parseInt(barcodeVal) : null;
                const fromBarcode = numericBarcode ? (this.products || []).find(p => parseInt(p.barcode) === numericBarcode) : null;
                if (fromBarcode) {
                    productId = fromBarcode._id;
                    $row.attr('data-product-id', productId);
                } else if (productName) {
                    const nameLower = productName.toLowerCase();
                    const fromName = (this.products || []).find(p => String(p.name).toLowerCase() === nameLower);
                    if (fromName) {
                        productId = fromName._id;
                        $row.attr('data-product-id', productId);
                    }
                }
                if (!productId) {
                    validationErrors.push(`${productName || 'Row ' + (index + 1)}: Unable to resolve product. Please ensure barcode or name matches an existing product.`);
                }
            }

            if (quantity > 0 && productId) {
                // Validate quantity
                if (quantity > maxQty) {
                    validationErrors.push(`${productName}: Cannot receive more than ${maxQty} items`);
                    return;
                }

                // Validate expiry date if provided
                if (expiryDate) {
                    const expiry = new Date(expiryDate);
                    const today = new Date();
                    if (expiry < today) {
                        validationErrors.push(`${productName}: Expiry date cannot be in the past`);
                        return;
                    }
                }

                receivedItems.push({
                    productId: productId,
                    quantity: quantity,
                    lotNumber: lotNumber,
                    expiryDate: expiryDate || null,
                    // Optional updates to product master
                    barcode: barcodeVal || null,
                    purchasePrice: purchasePriceVal || null,
                    sellingPrice: sellingPriceVal || null
                });
            }
        });

        console.log('Received items array:', receivedItems);
        console.log('Validation errors:', validationErrors);
        console.log('=== END DEBUG ===');

        // Show validation errors
        if (validationErrors.length > 0) {
            this.showValidationErrors(validationErrors);
            return;
        }

        if (receivedItems.length === 0) {
            console.log('No items to receive - checking if table has rows...');
            const tableRows = $('#receiveItemsTable tbody tr');
            if (tableRows.length === 0) {
                this.showValidationErrors(['No items found in the table. Please refresh and try again.']);
            } else {
                this.showValidationErrors(['Please enter quantities to receive for at least one item']);
            }
            return;
        }

        // Show loading state
        this.showSaveLoading();

        // Prepare summary for confirmation
        const summary = receivedItems.map(item => {
            const orderItem = this.currentOrder.items.find(oi => oi.productId == item.productId);
            if (orderItem) {
                return `${orderItem.productName}: ${item.quantity} units`;
            }
            // Fallback: use product name from table row
            const row = $(`#receiveItemsTable tbody tr[data-product-id="${item.productId}"]`);
            const name = row.find('td:first strong').text() || 'Item';
            return `${name}: ${item.quantity} units`;
        }).join('\n');

        // Confirm before saving
        if (confirm(`Confirm receiving the following items:\n\n${summary}\n\nProceed?`)) {
            console.log('Making API call to:', `${this.api}/${this.currentOrder._id}/receive`);
            console.log('Sending data:', { items: receivedItems });
            console.log('Current order ID:', this.currentOrder._id);
            
        $.ajax({
            url: `${this.api}/${this.currentOrder._id}/receive`,
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ items: receivedItems }),
            success: (response) => {
                this.hideSaveLoading();
                console.log('Receive items API success response:', response);
            if (response.success) {
                    this.showSaveSuccess(receivedItems.length);
                $('#receiveItemsModal').modal('hide');
                this.loadPurchaseOrders();
            } else {
                    this.showSaveError(response.message || 'Failed to receive items');
                }
            },
            error: (xhr, status, error) => {
                this.hideSaveLoading();
                console.log('Receive items API error:', { xhr, status, error });
                console.log('Response text:', xhr.responseText);
                console.log('Response JSON:', xhr.responseJSON);
                const errorMessage = xhr.responseJSON?.message || xhr.responseText || 'Failed to receive items';
                this.showSaveError(errorMessage);
            }
        });
        } else {
            this.hideSaveLoading();
        }
    }

    // Debug method to inspect receive items table
    debugReceiveItemsTable() {
        console.log('=== RECEIVE ITEMS TABLE DEBUG ===');
        const table = $('#receiveItemsTable');
        const tbody = table.find('tbody');
        const rows = tbody.find('tr');
        
        console.log('Table element:', table);
        console.log('Tbody element:', tbody);
        console.log('Number of rows:', rows.length);
        
        rows.each(function(index) {
            const $row = $(this);
            console.log(`Row ${index}:`, {
                html: $row.html(),
                dataProductId: $row.data('product-id'),
                receiveQty: $row.find('.receive-qty').val(),
                receiveLot: $row.find('.receive-lot').val(),
                receiveExpiry: $row.find('.receive-expiry').val(),
                productName: $row.find('td:first strong').text()
            });
        });
        
        console.log('=== END DEBUG ===');
    }

    showValidationErrors(errors) {
        const errorHtml = `
            <div class="alert alert-danger" role="alert">
                <h6><i class="fa fa-exclamation-triangle"></i> Validation Errors:</h6>
                <ul class="mb-0">
                    ${errors.map(error => `<li>${error}</li>`).join('')}
                </ul>
            </div>
        `;
        
        // Insert error above the table
        const tableContainer = $('#receiveItemsTable').closest('.table-responsive');
        tableContainer.find('.alert').remove();
        tableContainer.before(errorHtml);
        
        // Scroll to error
        $('html, body').animate({
            scrollTop: $('.alert-danger').offset().top - 100
        }, 500);
    }

    showSaveLoading() {
        const saveBtn = $('#saveReceiveItems');
        saveBtn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Saving...');
    }

    hideSaveLoading() {
        const saveBtn = $('#saveReceiveItems');
        saveBtn.prop('disabled', false).html('<i class="fa fa-check"></i> Receive Items');
    }

    showSaveSuccess(itemCount) {
        (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success(`Successfully received ${itemCount} item(s)`);
    }

    showSaveError(message) {
        (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure(message);
    }

    viewPurchaseOrder(orderId) {
        console.log('Looking for purchase order with ID:', orderId);
        console.log('Available orders:', this.orders.map(o => ({ id: o._id, poNumber: o.poNumber })));
        
        const order = this.orders.find(o => o._id == orderId);
        if (!order) {
            console.error('Purchase order not found for ID:', orderId);
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Purchase order not found');
            return;
        }

        this.currentOrder = order;
        this.populateViewPOModal();
        $('#viewPOModal').modal('show');
    }

    populateViewPOModal() {
        const order = this.currentOrder;
        
        $('#viewPONumber').text(order.poNumber || 'N/A');
        $('#viewPOSupplier').text(order.supplierName || 'N/A');
        $('#viewPODate').text(order.createdAt ? moment(order.createdAt).format('DD-MMM-YYYY HH:mm') : 'N/A');
        $('#viewPOStatus').html(this.getStatusBadge(order.status));
        
        // Calculate total if missing - sum of all item totals
        let poTotal = Number(order.total || order.subtotal || 0);
        if (!poTotal || isNaN(poTotal)) {
            poTotal = 0;
            if (order.items && Array.isArray(order.items)) {
                order.items.forEach(item => {
                    const itemTotal = Number(item.totalPrice || (Number(item.quantity || 0) * Number(item.unitPrice || 0)));
                    poTotal += itemTotal;
                });
            }
        }
        $('#viewPOTotal').text(utils.moneyFormat(poTotal));
        $('#viewPONotes').text(order.notes || 'No notes');
        
        if (order.expectedDeliveryDate) {
            $('#viewPOExpectedDelivery').text(moment(order.expectedDeliveryDate).format('DD-MMM-YYYY'));
        } else {
            $('#viewPOExpectedDelivery').text('Not specified');
        }

        // Populate items table
        const tbody = $('#viewPOItemsTable tbody');
        tbody.empty();

        order.items.forEach((item, index) => {
            const orderedQty = Number(item.quantity || 0);
            const receivedQty = Number(item.receivedQuantity || 0);
            const pendingQty = orderedQty - receivedQty;
            const progress = orderedQty > 0 ? (receivedQty / orderedQty) * 100 : 0;
            const progressClass = progress === 100 ? 'success' : progress > 0 ? 'warning' : 'secondary';
            const unitPrice = Number(item.unitPrice || 0);
            const totalPrice = Number(item.totalPrice || (orderedQty * unitPrice));
            
            tbody.append(`
                <tr>
                    <td>${index + 1}</td>
                    <td>${item.productName || 'Unknown Product'}</td>
                    <td>${item.barcode || '-'}</td>
                    <td class="text-center">${orderedQty}</td>
                    <td class="text-center">${receivedQty}</td>
                    <td class="text-center">${pendingQty}</td>
                    <td class="text-right">${utils.moneyFormat(unitPrice)}</td>
                    <td class="text-right">${utils.moneyFormat(totalPrice)}</td>
                    <td>
                        <div class="progress" style="height: 20px;">
                            <div class="progress-bar bg-${progressClass}" role="progressbar" 
                                 style="width: ${progress}%" aria-valuenow="${progress}" 
                                 aria-valuemin="0" aria-valuemax="100">
                                ${Math.round(progress)}%
                            </div>
                        </div>
                    </td>
                </tr>
            `);
        });
    }

    editPurchaseOrder(orderId) {
        console.log('Edit purchase order requested for ID:', orderId);
        
        try {
            const order = this.orders.find(o => o._id == orderId);
            if (!order) {
                console.error('Purchase order not found:', orderId);
                console.log('Available orders:', this.orders.map(o => ({ id: o._id, poNumber: o.poNumber })));
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Purchase order not found');
                return;
            }

            console.log('✅ Order found for editing:', order.poNumber, 'Status:', order.status);

            // Show loading state
            if (typeof notiflix !== 'undefined' && notiflix.Loading) {
                notiflix.Loading.standard('Loading purchase order...');
            }

            // Store current order for editing
            this.currentOrder = order;
            console.log('✅ Current order set for editing:', this.currentOrder._id, this.currentOrder.poNumber);

            // Reset form first to ensure clean state (but preserve currentOrder)
            this.resetPOForm(false);

            // Populate the create PO form with existing data
            this.populateEditForm(order);

            // Show the create PO modal with better error handling
            try {
                $('#createPOModal').modal({
                    backdrop: 'static',
                    keyboard: false,
                    show: true
                });
                console.log('✅ Modal shown successfully');
                
                // Ensure modal is focused and visible
                setTimeout(() => {
                    $('#createPOModal').focus();
                    console.log('✅ Modal focused');
                }, 100);
                
            } catch (modalError) {
                console.error('❌ Error showing modal:', modalError);
                if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                    notiflix.Notify.failure('Error opening edit modal: ' + modalError.message);
                }
            }

            // Remove loading state
            if (typeof notiflix !== 'undefined' && notiflix.Loading) {
                notiflix.Loading.remove();
            }
            
        } catch (error) {
            console.error('❌ Error in editPurchaseOrder:', error);
            if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                notiflix.Notify.failure('Error editing purchase order: ' + error.message);
            }
            
            // Remove loading state on error
            if (typeof notiflix !== 'undefined' && notiflix.Loading) {
                notiflix.Loading.remove();
            }
        }
    }

    populateEditForm(order) {
        console.log('Populating edit form for order:', order.poNumber);
        
        try {
            // Set supplier
            $('#poSupplierSelect').val(order.supplierId);
            console.log('✅ Supplier set:', order.supplierId);
            
            // Set other fields first
            $('#poTax').val(order.tax || 0);
            $('#poDiscount').val(order.discount || 0);
            $('#poNotes').val(order.notes || '');
            $('#poExpectedDelivery').val(order.expectedDeliveryDate ? moment(order.expectedDeliveryDate).format('YYYY-MM-DD') : '');
            console.log('✅ Form fields populated');
            
            // Clear existing items
            $('#poItemsTable tbody').empty();
            console.log('✅ Items table cleared');
            
            // Add existing items with error handling
            if (order.items && Array.isArray(order.items)) {
                order.items.forEach((item, index) => {
                    try {
                        this.addExistingItemToTable(item);
                        console.log(`✅ Item ${index + 1} added: ${item.productName}`);
                    } catch (error) {
                        console.error(`❌ Error adding item ${index + 1}:`, error);
                    }
                });
            } else {
                console.warn('⚠️ No items found in order or items is not an array');
            }
            
            // Update totals with error handling
            try {
                this.calculatePOTotals();
                console.log('✅ Totals calculated');
            } catch (error) {
                console.error('❌ Error calculating totals:', error);
            }
            
            // Change modal title and button text
            $('#createPOModalLabel').text('Edit Purchase Order');
            $('#createPOBtn').html('<i class="fa fa-save"></i> Update Purchase Order');
            console.log('✅ Modal title and button updated');
            
            // Store original order ID for update
            $('#createPOBtn').data('original-order-id', order._id);
            console.log('✅ Button data attribute set:', $('#createPOBtn').data('original-order-id'));
            console.log('✅ Current order ID:', this.currentOrder ? this.currentOrder._id : 'none');
            
            // Load ALL products when editing (not filtered by supplier)
            // This allows user to change supplier and see all products
            console.log('🔄 Loading ALL products for edit mode (not filtered by supplier)');
            this.loadAllProducts();
            
        } catch (error) {
            console.error('❌ Error in populateEditForm:', error);
            if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                notiflix.Notify.failure('Error populating edit form: ' + error.message);
            }
        }
    }

    deletePurchaseOrder(orderId) {
        console.log('Delete purchase order requested for ID:', orderId);
        
        // Use browser confirm for reliability
        if (confirm('Are you sure you want to delete this purchase order? This action cannot be undone.')) {
            console.log('User confirmed deletion for order:', orderId);
            this.confirmDeleteOrder(orderId);
        } else {
            console.log('User cancelled deletion for order:', orderId);
        }
    }

    confirmDeleteOrder(orderId) {
        console.log('Sending delete request for order:', orderId);
        console.log('Delete URL:', `${this.api}/${orderId}`);
        
                $.ajax({
                    url: `${this.api}/${orderId}`,
                    type: 'DELETE',
            timeout: 10000, // 10 second timeout
                    success: (response) => {
                console.log('Delete response received:', response);
                if (response && response.success) {
                    console.log('Purchase order deleted successfully');
                    if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                        notiflix.Notify.success('Purchase order deleted successfully');
                    } else {
                        alert('Purchase order deleted successfully');
                    }
                    // Reload the purchase orders list
                            this.loadPurchaseOrders();
                        } else {
                    console.error('Delete failed - invalid response:', response);
                    const errorMsg = response ? response.message : 'Failed to delete purchase order';
                    if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                        notiflix.Notify.failure(errorMsg);
                    } else {
                        alert(errorMsg);
                    }
                }
            },
            error: (xhr, status, error) => {
                console.error('Delete request failed:', {
                    xhr: xhr,
                    status: status,
                    error: error,
                    responseText: xhr.responseText
                });
                const errorMsg = 'Failed to delete purchase order. Please try again.';
                if (typeof notiflix !== 'undefined' && notiflix.Notify) {
                    notiflix.Notify.failure(errorMsg);
                } else {
                    alert(errorMsg);
            }
            }
        });
    }

    filterPurchaseOrders() {
        const statusFilter = $('#poStatusFilter').val();
        const supplierFilter = $('#poSupplierFilter').val();

        let filteredOrders = this.orders;

        if (statusFilter) {
            filteredOrders = filteredOrders.filter(order => order.status === statusFilter);
        }

        if (supplierFilter) {
            filteredOrders = filteredOrders.filter(order => order.supplierId == supplierFilter);
        }

        this.displayFilteredOrders(filteredOrders);
    }

    searchPurchaseOrders() {
        const searchTerm = $('#poSearchInput').val().toLowerCase();
        
        if (!searchTerm) {
            this.displayPurchaseOrders();
            return;
        }

        const filteredOrders = this.orders.filter(order => 
            order.poNumber.toLowerCase().includes(searchTerm) ||
            order.supplierName.toLowerCase().includes(searchTerm) ||
            order.items.some(item => item.productName.toLowerCase().includes(searchTerm))
        );

        this.displayFilteredOrders(filteredOrders);
    }

    displayFilteredOrders(orders) {
        const tbody = $('#purchaseOrdersTable tbody');
        tbody.empty();

        if (orders.length === 0) {
            tbody.append(`
                <tr>
                    <td colspan="8" class="text-center text-muted">
                        <i class="fa fa-search fa-2x"></i><br>
                        No purchase orders match your criteria
                    </td>
                </tr>
            `);
            return;
        }

        orders.forEach(order => {
            const statusBadge = this.getStatusBadge(order.status);
            const actions = this.getOrderActions(order);
            
            tbody.append(`
                <tr data-order-id="${order._id}">
                    <td><strong>${order.poNumber}</strong></td>
                    <td>${order.supplierName}</td>
                    <td>${moment(order.createdAt).format('DD-MMM-YYYY')}</td>
                    <td>${order.totalItems}</td>
                    <td class="text-right">${utils.moneyFormat(order.total)}</td>
                    <td>${statusBadge}</td>
                    <td>${order.expectedDeliveryDate ? moment(order.expectedDeliveryDate).format('DD-MMM-YYYY') : '-'}</td>
                    <td class="text-center">${actions}</td>
                </tr>
            `);
        });
    }

    showCreatePOModal() {
        console.log('Opening Create Purchase Order modal...');
        
        // Clear any existing validation errors
        this.clearValidationErrors();
        
        // Reset form to clean state
        this.resetPOForm();
        
        // Clear current order reference to ensure it's a new order
        this.currentOrder = null;
        
        // Check supplier linking mode and update UI accordingly
        this.updatePOModalForLinkingMode();
        
        // Load suppliers if not already loaded
        if (!this.suppliers || this.suppliers.length === 0) {
            console.log('Loading suppliers for Create PO modal...');
            this.loadSuppliers().then(() => {
                this.showModal();
            }).catch((error) => {
                console.error('Failed to load suppliers:', error);
                this.showModal(); // Show modal anyway
            });
        } else {
            this.showModal();
        }
    }
    
    updatePOModalForLinkingMode() {
        const linkingEnabled = this.settings?.productSupplierLinking !== false;
        const supplierSelect = $('#poSupplierSelect');
        const supplierHelpText = $('#poSupplierHelpText');
        
        if (linkingEnabled) {
            // Mode 1: Linking Enabled - Supplier selection required
            supplierSelect.prop('required', true);
            if (supplierHelpText.length) {
                supplierHelpText.html('<i class="fa fa-info-circle"></i> Required: Select the supplier for this purchase order');
                supplierHelpText.removeClass('text-muted').addClass('text-info');
            }
            
            // Update modal title to reflect linking mode
            $('#createPOModalLabel').html(`
                <i class="fa fa-file-text-o"></i>
                <span class="title-text">Create Purchase Order</span>
                <p class="modal-subtitle">Supplier-specific order creation</p>
            `);
            
        } else {
            // Mode 2: Linking Disabled - Flexible supplier selection
            supplierSelect.prop('required', false);
            if (supplierHelpText.length) {
                supplierHelpText.html('<i class="fa fa-info-circle"></i> Optional: You can assign suppliers per product or create a master PO');
                supplierHelpText.removeClass('text-info').addClass('text-muted');
            }
            
            // Update modal title to reflect flexible mode
            $('#createPOModalLabel').html(`
                <i class="fa fa-file-text-o"></i>
                <span class="title-text">Create Purchase Order</span>
                <p class="modal-subtitle">Flexible supplier assignment mode</p>
            `);
            
            // Add master PO option
            this.addMasterPOOption();
        }
    }
    
    addMasterPOOption() {
        // Add a checkbox for creating master PO when linking is disabled
        const supplierGroup = $('#poSupplierSelect').closest('.form-group');
        if (supplierGroup.find('#createMasterPO').length === 0) {
            supplierGroup.append(`
                <div class="form-check mt-2">
                    <input type="checkbox" class="form-check-input" id="createMasterPO">
                    <label class="form-check-label" for="createMasterPO">
                        Create Master PO (split by supplier later)
                    </label>
                </div>
            `);
            
            // Add event handler for master PO checkbox
            $('#createMasterPO').on('change', () => {
                const isMasterPO = $('#createMasterPO').is(':checked');
                if (isMasterPO) {
                    $('#poSupplierSelect').prop('disabled', true).val('');
                    $('#poSupplierHelpText').html('<i class="fa fa-info-circle"></i> Master PO will be split by supplier later');
                } else {
                    $('#poSupplierSelect').prop('disabled', false);
                    $('#poSupplierHelpText').html('<i class="fa fa-info-circle"></i> Optional: You can assign suppliers per product or create a master PO');
                }
            });
        }
    }

    showModal() {
        // Show modal with animation
        $('#createPOModal').modal({
            backdrop: 'static',
            keyboard: false,
            show: true
        });
        
        // Initialize progress tracking
        this.updateProgress();
        
        // Focus on first field after modal is shown
        $('#createPOModal').on('shown.bs.modal', () => {
            $('#poSupplierSelect').focus();
            
            // Add visual feedback
            $('#poSupplierSelect').addClass('form-control-focus');
            
            // Show helpful tooltip
            if (this.suppliers && this.suppliers.length > 0) {
                console.log(`Modal opened with ${this.suppliers.length} suppliers available`);
            } else {
                console.warn('Modal opened but no suppliers loaded');
            }
            
            // Set default delivery date to 7 days from now
            const defaultDate = new Date();
            defaultDate.setDate(defaultDate.getDate() + 7);
            $('#poExpectedDelivery').val(defaultDate.toISOString().split('T')[0]);
        });
        
        // Clean up focus class when modal is hidden
        $('#createPOModal').on('hidden.bs.modal', () => {
            $('#poSupplierSelect').removeClass('form-control-focus');
        });
        
        // Add real-time progress tracking
        this.setupProgressTracking();
    }

    updateProgress() {
        const progressBar = $('#poProgressBar');
        let progress = 0;
        
        // Check form completion
        if ($('#poSupplierSelect').val()) progress += 30;
        if ($('#poExpectedDelivery').val()) progress += 10;
        if ($('#poNotes').val().trim()) progress += 10;
        
        // Check if items are added
        const itemCount = $('#poItemsTable tbody tr').not('#noItemsRow').length;
        if (itemCount > 0) progress += 50;
        
        progressBar.css('width', `${progress}%`);
        
        // Update progress text
        let progressText = '';
        if (progress === 0) {
            progressText = '0% Complete - Start by selecting a supplier';
        } else if (progress < 30) {
            progressText = `${progress}% Complete - Select a supplier`;
        } else if (progress < 40) {
            progressText = `${progress}% Complete - Set delivery date`;
        } else if (progress < 50) {
            progressText = `${progress}% Complete - Add items to order`;
        } else if (progress < 100) {
            progressText = `${progress}% Complete - Add more items or notes`;
        } else {
            progressText = '100% Complete - Ready to create order';
        }
        
        $('#formProgressText').text(progressText);
        
        if (progress >= 100) {
            progressBar.removeClass('progress-bar-striped progress-bar-animated');
            progressBar.addClass('bg-success');
        } else {
            progressBar.removeClass('bg-success');
            progressBar.addClass('progress-bar-striped progress-bar-animated');
        }
    }

    setupProgressTracking() {
        // Track form changes for progress updates
        $('#poSupplierSelect, #poExpectedDelivery, #poNotes').on('change input', () => {
            this.updateProgress();
        });
        
        // Track when items are added/removed
        $(document).on('DOMNodeInserted DOMNodeRemoved', '#poItemsTable tbody', () => {
            setTimeout(() => this.updateProgress(), 100);
        });
    }

    showErrorFeedback(errorMessage) {
        // Create a temporary error banner
        const errorBanner = $(`
            <div id="poErrorBanner" class="alert alert-danger alert-dismissible fade show" style="position: fixed; top: 20px; right: 20px; z-index: 9999; min-width: 300px; box-shadow: 0 4px 8px rgba(0,0,0,0.2);">
                <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
                <h5 class="alert-heading">
                    <i class="fa fa-exclamation-triangle"></i> Purchase Order Failed!
                </h5>
                <p class="mb-1">${errorMessage}</p>
                <hr>
                <p class="mb-0">
                    <small>
                        <i class="fa fa-info-circle"></i> 
                        Please check your input and try again. Contact support if the issue persists.
                    </small>
                </p>
            </div>
        `);
        
        // Add to body
        $('body').append(errorBanner);
        
        // Auto-remove after 10 seconds
        setTimeout(() => {
            errorBanner.fadeOut(500, function() {
                $(this).remove();
            });
        }, 10000);
        
        // Add click to dismiss
        errorBanner.on('click', '.close', function() {
            errorBanner.fadeOut(300, function() {
                $(this).remove();
            });
        });
    }

    showSuccessFeedback(poNumber) {
        console.log('showSuccessFeedback called with PO Number:', poNumber);
        
        // Create a temporary success banner
        const successBanner = $(`
            <div id="poSuccessBanner" class="alert alert-success alert-dismissible fade show" style="position: fixed; top: 20px; right: 20px; z-index: 9999; min-width: 300px; box-shadow: 0 4px 8px rgba(0,0,0,0.2);">
                <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
                <h5 class="alert-heading">
                    <i class="fa fa-check-circle"></i> Purchase Order Created!
                </h5>
                <p class="mb-1"><strong>PO Number:</strong> ${poNumber}</p>
                <p class="mb-1"><strong>Status:</strong> <span class="badge badge-secondary">Draft</span></p>
                <hr>
                <p class="mb-0">
                    <small>
                        <i class="fa fa-info-circle"></i> 
                        You can now review and send this order to the supplier from the Purchase Orders Management.
                    </small>
                </p>
            </div>
        `);
        
        console.log('Success banner HTML created:', successBanner.length);
        
        // Add to body
        $('body').append(successBanner);
        console.log('Success banner appended to body');
        
        // Auto-remove after 8 seconds
        setTimeout(() => {
            console.log('Auto-removing success banner');
            successBanner.fadeOut(500, function() {
                $(this).remove();
                console.log('Success banner removed');
            });
        }, 8000);
        
        // Add click to dismiss
        successBanner.on('click', '.close', function() {
            console.log('Success banner manually closed');
            successBanner.fadeOut(300, function() {
                $(this).remove();
            });
        });
        
        // Force show the banner immediately
        successBanner.show();
        console.log('Success banner forced to show');
    }

    showCustomNotification(message, poNumber) {
        console.log('showCustomNotification called with:', message, poNumber);
        
        // Create a simple custom notification
        const notification = $(`
            <div id="customNotification" style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #28a745;
                color: white;
                padding: 20px 30px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                z-index: 10000;
                font-size: 16px;
                font-weight: bold;
                text-align: center;
                min-width: 300px;
                animation: fadeInScale 0.3s ease-out;
            ">
                <div style="font-size: 18px; margin-bottom: 10px;">
                    <i class="fa fa-check-circle"></i> ${message}
                </div>
                <div style="font-size: 14px; opacity: 0.9;">
                    PO Number: ${poNumber}
                </div>
                <div style="font-size: 12px; opacity: 0.8; margin-top: 5px;">
                    Status: Draft
                </div>
            </div>
        `);
        
        // Add CSS animation
        if (!$('#customNotificationCSS').length) {
            $('head').append(`
                <style id="customNotificationCSS">
                    @keyframes fadeInScale {
                        0% {
                            opacity: 0;
                            transform: translate(-50%, -50%) scale(0.8);
                        }
                        100% {
                            opacity: 1;
                            transform: translate(-50%, -50%) scale(1);
                        }
                    }
                </style>
            `);
        }
        
        // Add to body
        $('body').append(notification);
        console.log('Custom notification added to body');
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            notification.fadeOut(500, function() {
                $(this).remove();
                console.log('Custom notification removed');
            });
        }, 5000);
        
        // Add click to dismiss
        notification.on('click', function() {
            $(this).fadeOut(300, function() {
                $(this).remove();
            });
        });
    }
    
    // New method to send multiple POs (for master PO splitting)
    sendMultiplePOs(orders) {
        console.log('Sending multiple POs:', orders.length);
        
        let sentCount = 0;
        const totalOrders = orders.length;
        
        orders.forEach((order, index) => {
            setTimeout(() => {
                console.log(`Sending PO ${index + 1}/${totalOrders}: ${order.poNumber}`);
                this.sendPurchaseOrder(order);
                sentCount++;
                
                if (sentCount === totalOrders) {
                    console.log('All POs sent successfully');
                    if (typeof notiflix !== 'undefined') {
                        notiflix.Notify.success(`Successfully sent ${totalOrders} purchase orders to suppliers`);
                    }
                }
            }, index * 2000); // 2 second delay between sends
        });
    }
    
    // New method to handle master PO splitting and sending
    splitAndSendMasterPO(masterPOId) {
        console.log('Splitting and sending master PO:', masterPOId);
        
        // First, get the master PO
        const masterPO = this.orders.find(o => o._id == masterPOId);
        if (!masterPO) {
            if (typeof notiflix !== 'undefined') {
                notiflix.Notify.failure('Master PO not found');
            }
            return;
        }
        
        // Show supplier assignment modal
        this.showSupplierAssignmentModal(masterPO);
    }
    
    showSupplierAssignmentModal(masterPO) {
        // Create supplier assignment modal
        const modalHtml = `
            <div class="modal fade" id="supplierAssignmentModal" tabindex="-1" role="dialog">
                <div class="modal-dialog modal-lg" role="document">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h4 class="modal-title">
                                <i class="fa fa-users"></i> Assign Suppliers - ${masterPO.poNumber}
                            </h4>
                            <button type="button" class="close" data-dismiss="modal">&times;</button>
                        </div>
                        <div class="modal-body">
                            <p class="text-muted">Assign suppliers to each product in this master PO:</p>
                            <div class="table-responsive">
                                <table class="table table-striped" id="supplierAssignmentTable">
                                    <thead>
                                        <tr>
                                            <th>Product</th>
                                            <th>Quantity</th>
                                            <th>Supplier</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${masterPO.items.map(item => `
                                            <tr>
                                                <td>${item.productName}</td>
                                                <td>${item.quantity}</td>
                                                <td>
                                                    <select class="form-control supplier-select" data-product-id="${item.productId}">
                                                        <option value="">Select Supplier</option>
                                                        ${this.suppliers.map(supplier => `
                                                            <option value="${supplier._id}">${supplier.name}</option>
                                                        `).join('')}
                                                    </select>
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" id="splitAndSendBtn">
                                <i class="fa fa-split"></i> Split & Send POs
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Remove existing modal if present
        $('#supplierAssignmentModal').remove();
        
        // Add modal to body
        $('body').append(modalHtml);
        
        // Show modal
        $('#supplierAssignmentModal').modal('show');
        
        // Handle split and send button
        $('#splitAndSendBtn').on('click', () => {
            const supplierAssignments = {};
            $('.supplier-select').each(function() {
                const productId = $(this).data('product-id');
                const supplierId = $(this).val();
                if (supplierId) {
                    supplierAssignments[productId] = supplierId;
                }
            });
            
            if (Object.keys(supplierAssignments).length === 0) {
                if (typeof notiflix !== 'undefined') {
                    notiflix.Notify.warning('Please assign at least one supplier');
                }
                return;
            }
            
            // Split master PO
            $.ajax({
                url: `${this.api}/${masterPO._id}/split`,
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    supplierAssignments: supplierAssignments,
                    suppliers: this.suppliers
                }),
                success: (response) => {
                    console.log('Master PO split response:', response);
                    if (response.success) {
                        $('#supplierAssignmentModal').modal('hide');
                        
                        // Send all sub-POs
                        this.sendMultiplePOs(response.subPOs);
                        
                        // Refresh purchase orders list
                        this.loadPurchaseOrders();
                        
                        if (typeof notiflix !== 'undefined') {
                            notiflix.Notify.success(`Master PO split into ${response.subPOs.length} sub-POs and sent to suppliers`);
                        }
                    } else {
                        if (typeof notiflix !== 'undefined') {
                            notiflix.Notify.failure(response.message || 'Failed to split master PO');
                        }
                    }
                },
                error: (xhr, status, error) => {
                    console.error('Error splitting master PO:', error);
                    if (typeof notiflix !== 'undefined') {
                        notiflix.Notify.failure('Failed to split master PO');
                    }
                }
            });
        });
    }
}

// Initialize Purchase Order Manager when DOM is ready
$(document).ready(function() {
    window.purchaseOrderManager = new PurchaseOrderManager();
    
    // Add global reset function for debugging
    window.resetAutoDraftFlags = function() {
        window.isAutoDraftRunning = false;
        window.lastAutoDraftTime = null;
        if (window.purchaseOrderManager) {
            window.purchaseOrderManager.isAutoDraftRunning = false;
            window.purchaseOrderManager.isLoadingAutoDraftProducts = false;
        }
        
        // Reset backend flags
        $.ajax({
            url: '/api/purchase-orders/reset-auto-draft-flags',
            type: 'POST',
            success: (response) => {
                console.log('✅ Auto-draft flags reset successfully:', response.message);
                alert('Auto-draft flags have been reset successfully! You can now try Auto-Draft again.');
            },
            error: (xhr, status, error) => {
                console.error('❌ Failed to reset backend auto-draft flags:', error);
                alert('Frontend flags reset, but backend reset failed. Please try again.');
            }
        });
    };
    
    // Add global reset function for auto-draft state
    window.resetAutoDraftState = function() {
        if (window.purchaseOrderManager) {
            window.purchaseOrderManager.resetAutoDraftState();
        }
    };
    
    // Note: Backend reset is now handled by the resetAutoDraftFlags() function when called manually
    
    console.log('Auto-draft reset function available: resetAutoDraftFlags()');
    
    // Check notiflix availability (no test notification)
    console.log('=== NOTIFLIX CHECK ===');
    console.log('Notiflix available:', typeof notiflix !== 'undefined');
    console.log('Notiflix.Notify available:', typeof notiflix !== 'undefined' && typeof notiflix.Notify !== 'undefined');
    
    // Make debug method available globally
    window.debugReceiveItemsTable = () => {
        if (window.purchaseOrderManager) {
            window.purchaseOrderManager.debugReceiveItemsTable();
        } else {
            console.log('PurchaseOrderManager not available');
        }
    };
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PurchaseOrderManager;
}
