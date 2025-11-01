/**
 * Purchase Order Scheduler Module
 * Handles automatic generation of purchase orders based on reorder points and expiry dates
 */

class POScheduler {
    constructor() {
        // In Electron app, use relative URLs for API calls
        this.api = '/api/purchase-orders';
        this.isRunning = false;
        this.scheduleInterval = null;
        this.lastRun = null;
        this.isRunningAutoDraft = false; // Flag to prevent concurrent auto-draft runs
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadSettings();
    }

    setupEventListeners() {
        // Manual auto-draft trigger - now handled by PurchaseOrderManager
        // $(document).on('click', '#autoDraftPO', () => {
        //     this.runAutoDraft();
        // });

        // Schedule settings
        $(document).on('change', '#poScheduleEnabled', (e) => {
            this.toggleSchedule(e.target.checked);
        });

        $(document).on('change', '#poScheduleInterval', (e) => {
            this.updateScheduleInterval(e.target.value);
        });

        // Settings modal events
        $(document).on('click', '#savePOSettings', () => {
            this.saveSettings();
        });
    }

    loadSettings() {
        // Load settings from localStorage or server
        const settings = {
            enabled: localStorage.getItem('poScheduleEnabled') === 'true',
            interval: localStorage.getItem('poScheduleInterval') || 'daily',
            reorderThreshold: parseInt(localStorage.getItem('poReorderThreshold')) || 5,
            expiryAlertDays: parseInt(localStorage.getItem('poExpiryAlertDays')) || 30,
            autoSend: localStorage.getItem('poAutoSend') === 'true',
            lastRun: localStorage.getItem('poLastRun')
        };

        this.settings = settings;
        this.lastRun = settings.lastRun ? new Date(settings.lastRun) : null;

        // Update UI if settings modal exists
        if ($('#poScheduleEnabled').length) {
            $('#poScheduleEnabled').prop('checked', settings.enabled);
            $('#poScheduleInterval').val(settings.interval);
            $('#poReorderThreshold').val(settings.reorderThreshold);
            $('#poExpiryAlertDays').val(settings.expiryAlertDays);
            $('#poAutoSend').prop('checked', settings.autoSend);
        }

        // Start scheduler if enabled
        if (settings.enabled) {
            this.startScheduler();
        }
    }

    saveSettings() {
        const settings = {
            enabled: $('#poScheduleEnabled').is(':checked'),
            interval: $('#poScheduleInterval').val(),
            reorderThreshold: parseInt($('#poReorderThreshold').val()),
            expiryAlertDays: parseInt($('#poExpiryAlertDays').val()),
            autoSend: $('#poAutoSend').is(':checked')
        };

        // Save to localStorage
        Object.keys(settings).forEach(key => {
            localStorage.setItem(`po${key.charAt(0).toUpperCase() + key.slice(1)}`, settings[key]);
        });

        this.settings = settings;
        
        // Restart scheduler with new settings
        this.stopScheduler();
        if (settings.enabled) {
            this.startScheduler();
        }

        if (typeof notiflix !== 'undefined') {
            notiflix.Notify.success('Purchase order settings saved successfully');
        }
    }

    startScheduler() {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        const intervalMs = this.getIntervalMs(this.settings.interval);
        
        this.scheduleInterval = setInterval(() => {
            this.runAutoDraft();
        }, intervalMs);

        console.log(`Purchase order scheduler started with ${this.settings.interval} interval`);
    }

    stopScheduler() {
        if (this.scheduleInterval) {
            clearInterval(this.scheduleInterval);
            this.scheduleInterval = null;
        }
        this.isRunning = false;
        console.log('Purchase order scheduler stopped');
    }

    toggleSchedule(enabled) {
        if (enabled) {
            this.startScheduler();
        } else {
            this.stopScheduler();
        }
    }

    updateScheduleInterval(interval) {
        this.settings.interval = interval;
        if (this.isRunning) {
            this.stopScheduler();
            this.startScheduler();
        }
    }

    getIntervalMs(interval) {
        const intervals = {
            'hourly': 60 * 60 * 1000,
            'daily': 24 * 60 * 60 * 1000,
            'weekly': 7 * 24 * 60 * 60 * 1000,
            'monthly': 30 * 24 * 60 * 60 * 1000
        };
        return intervals[interval] || intervals.daily;
    }

    async runAutoDraft() {
        if (this.isRunningAutoDraft) {
            console.log('Auto-draft already running, skipping...');
            return;
        }

        if (this.isRunning && this.lastRun) {
            const timeSinceLastRun = Date.now() - this.lastRun.getTime();
            const intervalMs = this.getIntervalMs(this.settings.interval);
            
            // Don't run if it's been less than the interval time
            if (timeSinceLastRun < intervalMs) {
                return;
            }
        }

        this.isRunningAutoDraft = true;
        try {
            console.log('Running auto-draft purchase order generation...');
            
            // Skip auto-draft generation - now handled by manual Auto-Draft Management
            console.log('Auto-draft generation skipped - use Auto-Draft Management instead');
            return;

            if (response.success && response.orders.length > 0) {
                this.lastRun = new Date();
                localStorage.setItem('poLastRun', this.lastRun.toISOString());
                
                // Show notification
                if (typeof notiflix !== 'undefined') {
                notiflix.Notify.success(`Auto-generated ${response.orders.length} draft purchase orders`);
            }
                
                // Auto-send if enabled
                if (this.settings.autoSend) {
                    this.autoSendOrders(response.orders);
                }
                
                // Update UI if purchase orders modal is open
                if (window.purchaseOrderManager) {
                    window.purchaseOrderManager.loadPurchaseOrders();
                }
                
                console.log(`Auto-draft completed: ${response.orders.length} orders generated`);
            } else {
                console.log('Auto-draft completed: No orders needed');
            }
        } catch (error) {
            console.error('Auto-draft failed:', error);
            if (typeof notiflix !== 'undefined') {
                notiflix.Notify.failure('Auto-draft failed: ' + error.message);
            }
        } finally {
            this.isRunningAutoDraft = false;
        }
    }

    async autoSendOrders(orders) {
        if (!this.settings.autoSend) {
            return;
        }

        console.log(`Auto-sending ${orders.length} purchase orders...`);
        
        for (const order of orders) {
            try {
                // Update status to sent
                await $.ajax({
                    url: `${this.api}/${order._id}`,
                    type: 'PUT',
                    data: JSON.stringify({ status: 'sent' }),
                    contentType: 'application/json'
                });

                // Send WhatsApp message
                if (window.purchaseOrderManager) {
                    window.purchaseOrderManager.openWhatsAppWithPO(order);
                }
                
                console.log(`Auto-sent PO: ${order.poNumber}`);
            } catch (error) {
                console.error(`Failed to auto-send PO ${order.poNumber}:`, error);
            }
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            lastRun: this.lastRun,
            nextRun: this.getNextRunTime(),
            settings: this.settings
        };
    }

    getNextRunTime() {
        if (!this.isRunning || !this.lastRun) {
            return null;
        }

        const intervalMs = this.getIntervalMs(this.settings.interval);
        return new Date(this.lastRun.getTime() + intervalMs);
    }

    // Manual trigger for testing
    async testAutoDraft() {
        console.log('Testing auto-draft functionality...');
        await this.runAutoDraft();
    }

    // Get products that need reordering
    async getProductsNeedingReorder() {
        try {
            const response = await $.get('/api/inventory/products');
            const products = response.filter(product => {
                const quantity = parseInt(product.quantity) || 0;
                const reorderPoint = parseInt(product.reorderPoint) || parseInt(product.minStock) || 5;
                return quantity <= reorderPoint;
            });
            
            return products;
        } catch (error) {
            console.error('Failed to get products needing reorder:', error);
            return [];
        }
    }

    // Get products with expiring dates
    async getExpiringProducts() {
        try {
            const response = await $.get('/api/inventory/products');
            const expiryAlertDays = this.settings.expiryAlertDays;
            const alertDate = new Date();
            alertDate.setDate(alertDate.getDate() + expiryAlertDays);
            
            const products = response.filter(product => {
                if (!product.expirationDate) {
                    return false;
                }
                
                const expiryDate = new Date(product.expirationDate);
                return expiryDate <= alertDate;
            });
            
            return products;
        } catch (error) {
            console.error('Failed to get expiring products:', error);
            return [];
        }
    }

    // Generate report of what would be auto-drafted
    async generateAutoDraftReport() {
        try {
            const [reorderProducts, expiringProducts] = await Promise.all([
                this.getProductsNeedingReorder(),
                this.getExpiringProducts()
            ]);

            // Group by supplier
            const supplierGroups = {};
            
            [...reorderProducts, ...expiringProducts].forEach(product => {
                const supplierId = product.supplier_id || 'unknown';
                if (!supplierGroups[supplierId]) {
                    supplierGroups[supplierId] = {
                        supplierId: supplierId,
                        products: [],
                        totalValue: 0,
                        totalItems: 0
                    };
                }
                
                const reorderQty = product.reorderQuantity || 10;
                const unitPrice = parseFloat(product.actualPrice) || 0;
                const totalPrice = reorderQty * unitPrice;
                
                supplierGroups[supplierId].products.push({
                    ...product,
                    suggestedQuantity: reorderQty,
                    unitPrice: unitPrice,
                    totalPrice: totalPrice
                });
                
                supplierGroups[supplierId].totalValue += totalPrice;
                supplierGroups[supplierId].totalItems += reorderQty;
            });

            return {
                reorderProducts: reorderProducts,
                expiringProducts: expiringProducts,
                supplierGroups: Object.values(supplierGroups),
                summary: {
                    totalProducts: reorderProducts.length + expiringProducts.length,
                    totalSuppliers: Object.keys(supplierGroups).length,
                    totalValue: Object.values(supplierGroups).reduce((sum, group) => sum + group.totalValue, 0),
                    totalItems: Object.values(supplierGroups).reduce((sum, group) => sum + group.totalItems, 0)
                }
            };
        } catch (error) {
            console.error('Failed to generate auto-draft report:', error);
            return null;
        }
    }
}

// Initialize scheduler when DOM is ready
$(document).ready(function() {
    window.poScheduler = new POScheduler();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = POScheduler;
}
