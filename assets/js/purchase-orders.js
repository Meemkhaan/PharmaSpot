/**
 * Purchase Orders Management Module
 * Handles all purchase order operations including auto-draft, sending, receiving, and reporting
 */

class PurchaseOrderManager {
    constructor() {
        // In Electron app, use relative URLs for API calls
        this.api = '/api/purchase-orders';
        this.currentOrder = null;
        this.orders = [];
        this.suppliers = [];
        this.products = [];
        this.init();
    }

    init() {
        this.setupEventListeners();
        // Load data directly since we're now served through the server
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

        // Create new PO button
        $(document).on('click', '#createNewPO', () => {
            this.showCreatePOModal();
        });

        // Send PO button
        $(document).on('click', '.send-po-btn', (e) => {
            const orderId = $(e.target).data('order-id');
            this.sendPOToSupplier(orderId);
        });

        // Receive items button
        $(document).on('click', '.receive-items-btn', (e) => {
            const orderId = $(e.target).data('order-id');
            this.showReceiveItemsModal(orderId);
        });

        // View PO button
        $(document).on('click', '.view-po-btn', (e) => {
            const orderId = $(e.target).data('order-id');
            this.viewPurchaseOrder(orderId);
        });

        // Delete PO button
        $(document).on('click', '.delete-po-btn', (e) => {
            const orderId = $(e.target).data('order-id');
            this.deletePurchaseOrder(orderId);
        });

        // Refresh PO list
        $(document).on('click', '#refreshPOList', () => {
            this.loadPurchaseOrders();
        });


        // Filter PO list
        $(document).on('change', '#poStatusFilter, #poSupplierFilter', () => {
            this.filterPurchaseOrders();
        });

        // Search PO list
        $(document).on('input', '#poSearchInput', () => {
            this.searchPurchaseOrders();
        });

        // Save PO form
        $(document).on('click', '#savePO', () => {
            this.savePurchaseOrder();
        });

        // Add item to PO
        $(document).on('click', '#addPOItem', () => {
            this.addPOItem();
        });

        // Remove item from PO
        $(document).on('click', '.remove-po-item', (e) => {
            $(e.target).closest('tr').remove();
            this.calculatePOTotals();
        });

        // Receive items form
        $(document).on('click', '#saveReceiveItems', () => {
            this.saveReceiveItems();
        });

        // Barcode scan for receiving
        $(document).on('keypress', '#receiveBarcodeInput', (e) => {
            if (e.which === 13) {
                this.scanReceiveBarcode();
            }
        });
    }

    loadSuppliers() {
        $.get('/api/suppliers/all', (suppliers) => {
            this.suppliers = suppliers;
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
        $.get('/api/inventory/products', (products) => {
            this.products = products;
        }).fail((xhr, status, error) => {
            console.error('Failed to load products:', error);
            if (typeof notiflix !== 'undefined') {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('Failed to load products. Please check server connection.');
            }
        });
    }

    loadPurchaseOrders() {
        $.get(this.api + '/all', (orders) => {
            this.orders = orders;
            this.displayPurchaseOrders();
            this.updateStatistics();
        }).fail((xhr, status, error) => {
            console.error('Failed to load purchase orders:', error);
            if (typeof notiflix !== 'undefined') {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to load purchase orders. Please check server connection.');
            }
        });
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

    generateAutoDraft() {
        const button = $('#autoDraftPO');
        button.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Generating...');

        $.post(this.api + '/auto-draft', {
            reorderPointThreshold: 5,
            expiryAlertDays: 30
        }, (response) => {
            if (response.success) {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success(`Generated ${response.orders.length} draft purchase orders`);
                this.loadPurchaseOrders();
            } else {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to generate auto-draft orders');
            }
        }).fail(() => {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to generate auto-draft orders');
        }).always(() => {
            button.prop('disabled', false).html('<i class="fa fa-magic"></i> Auto-Draft');
        });
    }

    showCreatePOModal() {
        $('#createPOModal').modal('show');
        this.populateSupplierDropdowns();
        this.clearPOModal();
    }

    clearPOModal() {
        $('#poSupplierSelect').val('');
        $('#poNotes').val('');
        $('#poExpectedDelivery').val('');
        $('#poItemsTable tbody').empty();
        this.calculatePOTotals();
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
        const productId = $('#poProductSelect').val();
        const quantity = parseInt($('#poQuantity').val()) || 1;
        const unitPrice = parseFloat($('#poUnitPrice').val()) || 0;

        if (!productId) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('Please select a product');
            return;
        }

        const product = this.products.find(p => p._id == productId);
        if (!product) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('Product not found');
            return;
        }

        const totalPrice = quantity * unitPrice;
        const rowId = `po-item-${Date.now()}`;

        $('#poItemsTable tbody').append(`
            <tr id="${rowId}">
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

        // Clear form
        $('#poProductSelect').val('');
        $('#poQuantity').val('1');
        $('#poUnitPrice').val('');

        this.calculatePOTotals();
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

    savePurchaseOrder() {
        const supplierId = $('#poSupplierSelect').val();
        const notes = $('#poNotes').val();
        const expectedDelivery = $('#poExpectedDelivery').val();

        if (!supplierId) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('Please select a supplier');
            return;
        }

        const items = [];
        $('#poItemsTable tbody tr').each(function() {
            const productName = $(this).find('td:nth-child(1)').text();
            const barcode = $(this).find('td:nth-child(2)').text();
            const quantity = parseInt($(this).find('td:nth-child(3) input').val()) || 0;
            const unitPrice = parseFloat($(this).find('td:nth-child(4) input').val()) || 0;

            if (quantity > 0 && unitPrice >= 0) {
                items.push({
                    productId: this.products.find(p => p.name === productName)?._id,
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
        const orderData = {
            supplierId: supplierId,
            supplierName: supplier.name,
            items: items,
            notes: notes,
            expectedDeliveryDate: expectedDelivery,
            createdBy: 'user'
        };

        $.post(this.api, orderData, (response) => {
            if (response.success) {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success('Purchase order created successfully');
                $('#createPOModal').modal('hide');
                this.loadPurchaseOrders();
            } else {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to create purchase order');
            }
        }).fail(() => {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to create purchase order');
        });
    }

    sendPOToSupplier(orderId) {
        const order = this.orders.find(o => o._id == orderId);
        if (!order) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Purchase order not found');
            return;
        }

        // Update status to sent
        $.ajax({
            url: `${this.api}/${orderId}`,
            type: 'PUT',
            data: JSON.stringify({ status: 'sent' }),
            contentType: 'application/json',
            success: (response) => {
                if (response.success) {
                    (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success('Purchase order sent to supplier');
                    this.loadPurchaseOrders();
                    
                    // Open WhatsApp with formatted message
                    this.openWhatsAppWithPO(order);
                } else {
                    (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to send purchase order');
                }
            },
            error: () => {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to send purchase order');
            }
        });
    }

    openWhatsAppWithPO(order) {
        const supplier = this.suppliers.find(s => s._id == order.supplierId);
        if (!supplier || !supplier.phone) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('Supplier phone number not available');
            return;
        }

        // Format PO message
        let message = `*Purchase Order ${order.poNumber}*\n\n`;
        message += `Dear ${supplier.name},\n\n`;
        message += `Please find below our purchase order details:\n\n`;
        
        order.items.forEach((item, index) => {
            message += `${index + 1}. ${item.productName}\n`;
            message += `   Barcode: ${item.barcode}\n`;
            message += `   Quantity: ${item.quantity}\n`;
            message += `   Unit Price: ${utils.moneyFormat(item.unitPrice)}\n`;
            message += `   Total: ${utils.moneyFormat(item.totalPrice)}\n\n`;
        });
        
        message += `*Order Summary:*\n`;
        message += `Total Items: ${order.totalItems}\n`;
        message += `Subtotal: ${utils.moneyFormat(order.subtotal)}\n`;
        message += `Total: ${utils.moneyFormat(order.total)}\n\n`;
        
        if (order.expectedDeliveryDate) {
            message += `Expected Delivery: ${moment(order.expectedDeliveryDate).format('DD-MMM-YYYY')}\n\n`;
        }
        
        if (order.notes) {
            message += `Notes: ${order.notes}\n\n`;
        }
        
        message += `Please confirm receipt and delivery timeline.\n\n`;
        message += `Thank you!`;

        // Clean phone number (remove non-digits and add country code if needed)
        let phoneNumber = supplier.phone.replace(/\D/g, '');
        if (!phoneNumber.startsWith('1') && phoneNumber.length === 10) {
            phoneNumber = '1' + phoneNumber; // Add US country code
        }

        // Open WhatsApp Web
        const whatsappUrl = `https://web.whatsapp.com/send?phone=${phoneNumber}&text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, '_blank');
    }

    showReceiveItemsModal(orderId) {
        const order = this.orders.find(o => o._id == orderId);
        if (!order) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Purchase order not found');
            return;
        }

        this.currentOrder = order;
        $('#receiveItemsModal').modal('show');
        this.populateReceiveItemsTable();
    }

    populateReceiveItemsTable() {
        const tbody = $('#receiveItemsTable tbody');
        tbody.empty();

        this.currentOrder.items.forEach(item => {
            const pendingQty = item.quantity - item.receivedQuantity;
            if (pendingQty > 0) {
                tbody.append(`
                    <tr data-product-id="${item.productId}">
                        <td>${item.productName}</td>
                        <td>${item.barcode}</td>
                        <td>${item.quantity}</td>
                        <td>${item.receivedQuantity}</td>
                        <td class="text-warning"><strong>${pendingQty}</strong></td>
                        <td>
                            <input type="number" class="form-control form-control-sm receive-qty" 
                                   value="${pendingQty}" min="0" max="${pendingQty}">
                        </td>
                        <td>
                            <input type="text" class="form-control form-control-sm receive-lot" 
                                   placeholder="Lot Number">
                        </td>
                        <td>
                            <input type="date" class="form-control form-control-sm receive-expiry">
                        </td>
                    </tr>
                `);
            }
        });
    }

    scanReceiveBarcode() {
        const barcode = $('#receiveBarcodeInput').val().trim();
        if (!barcode) return;

        const product = this.products.find(p => p.barcode == barcode);
        if (!product) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('Product not found for barcode: ' + barcode);
            $('#receiveBarcodeInput').val('');
            return;
        }

        const orderItem = this.currentOrder.items.find(item => item.productId == product._id);
        if (!orderItem) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('Product not in this purchase order');
            $('#receiveBarcodeInput').val('');
            return;
        }

        const pendingQty = orderItem.quantity - orderItem.receivedQuantity;
        if (pendingQty <= 0) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('All items for this product have been received');
            $('#receiveBarcodeInput').val('');
            return;
        }

        // Find the row and focus on quantity input
        const row = $(`#receiveItemsTable tbody tr[data-product-id="${product._id}"]`);
        if (row.length > 0) {
            row.find('.receive-qty').focus().select();
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success(`Found: ${product.name}`);
        }

        $('#receiveBarcodeInput').val('');
    }

    saveReceiveItems() {
        const receivedItems = [];

        $('#receiveItemsTable tbody tr').each(function() {
            const productId = $(this).data('product-id');
            const quantity = parseInt($(this).find('.receive-qty').val()) || 0;
            const lotNumber = $(this).find('.receive-lot').val().trim();
            const expiryDate = $(this).find('.receive-expiry').val();

            if (quantity > 0) {
                receivedItems.push({
                    productId: productId,
                    quantity: quantity,
                    lotNumber: lotNumber,
                    expiryDate: expiryDate || null
                });
            }
        });

        if (receivedItems.length === 0) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('Please enter quantities to receive');
            return;
        }

        $.post(`${this.api}/${this.currentOrder._id}/receive`, {
            items: receivedItems
        }, (response) => {
            if (response.success) {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success('Items received successfully');
                $('#receiveItemsModal').modal('hide');
                this.loadPurchaseOrders();
            } else {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to receive items');
            }
        }).fail(() => {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to receive items');
        });
    }

    viewPurchaseOrder(orderId) {
        const order = this.orders.find(o => o._id == orderId);
        if (!order) {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Purchase order not found');
            return;
        }

        this.currentOrder = order;
        this.populateViewPOModal();
        $('#viewPOModal').modal('show');
    }

    populateViewPOModal() {
        const order = this.currentOrder;
        
        $('#viewPONumber').text(order.poNumber);
        $('#viewPOSupplier').text(order.supplierName);
        $('#viewPODate').text(moment(order.createdAt).format('DD-MMM-YYYY HH:mm'));
        $('#viewPOStatus').html(this.getStatusBadge(order.status));
        $('#viewPOTotal').text(utils.moneyFormat(order.total));
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
            const progress = item.quantity > 0 ? (item.receivedQuantity / item.quantity) * 100 : 0;
            const progressClass = progress === 100 ? 'success' : progress > 0 ? 'warning' : 'secondary';
            
            tbody.append(`
                <tr>
                    <td>${index + 1}</td>
                    <td>${item.productName}</td>
                    <td>${item.barcode}</td>
                    <td class="text-center">${item.quantity}</td>
                    <td class="text-center">${item.receivedQuantity}</td>
                    <td class="text-center">${item.pendingQuantity}</td>
                    <td class="text-right">${utils.moneyFormat(item.unitPrice)}</td>
                    <td class="text-right">${utils.moneyFormat(item.totalPrice)}</td>
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

    deletePurchaseOrder(orderId) {
        (typeof notiflix !== 'undefined' ? notiflix.Report : console.log).warning(
            'Delete Purchase Order',
            'Are you sure you want to delete this purchase order? This action cannot be undone.',
            'Delete',
            () => {
                $.ajax({
                    url: `${this.api}/${orderId}`,
                    type: 'DELETE',
                    success: (response) => {
                        if (response.success) {
                            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success('Purchase order deleted successfully');
                            this.loadPurchaseOrders();
                        } else {
                            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to delete purchase order');
                        }
                    },
                    error: () => {
                        (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to delete purchase order');
                    }
                });
            }
        );
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
}

// Initialize Purchase Order Manager when DOM is ready
$(document).ready(function() {
    window.purchaseOrderManager = new PurchaseOrderManager();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PurchaseOrderManager;
}
