/**
 * Purchase Order Notifications Module
 * Handles in-app notifications for purchase order events
 */

class PONotifications {
    constructor() {
        // In Electron app, use relative URLs for API calls
        this.notifications = [];
        this.settings = {
            enabled: true,
            showDraftAlerts: true,
            showOverdueAlerts: true,
            showExpiryAlerts: true,
            autoRefresh: true,
            refreshInterval: 30000 // 30 seconds
        };
        this.refreshTimer = null;
        this.init();
    }

    init() {
        this.loadSettings();
        this.setupEventListeners();
        this.startAutoRefresh();
        this.checkForNotifications();
    }

    setupEventListeners() {
        // Notification settings
        $(document).on('change', '#poNotificationsEnabled', (e) => {
            this.settings.enabled = e.target.checked;
            this.saveSettings();
            if (this.settings.enabled) {
                this.startAutoRefresh();
            } else {
                this.stopAutoRefresh();
            }
        });

        $(document).on('change', '#poShowDraftAlerts', (e) => {
            this.settings.showDraftAlerts = e.target.checked;
            this.saveSettings();
        });

        $(document).on('change', '#poShowOverdueAlerts', (e) => {
            this.settings.showOverdueAlerts = e.target.checked;
            this.saveSettings();
        });

        $(document).on('change', '#poShowExpiryAlerts', (e) => {
            this.settings.showExpiryAlerts = e.target.checked;
            this.saveSettings();
        });

        // Manual refresh
        $(document).on('click', '#refreshPONotifications', () => {
            this.checkForNotifications();
        });

        // Clear all notifications
        $(document).on('click', '#clearPONotifications', () => {
            this.clearAllNotifications();
        });

        // Dismiss individual notification
        $(document).on('click', '.dismiss-po-notification', (e) => {
            const notificationId = $(e.target).data('notification-id');
            this.dismissNotification(notificationId);
        });
    }

    loadSettings() {
        const savedSettings = localStorage.getItem('poNotificationSettings');
        if (savedSettings) {
            this.settings = { ...this.settings, ...JSON.parse(savedSettings) };
        }
    }

    saveSettings() {
        localStorage.setItem('poNotificationSettings', JSON.stringify(this.settings));
    }

    startAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
        
        if (this.settings.enabled && this.settings.autoRefresh) {
            this.refreshTimer = setInterval(() => {
                this.checkForNotifications();
            }, this.settings.refreshInterval);
        }
    }

    stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    async checkForNotifications() {
        if (!this.settings.enabled) {
            return;
        }

        try {
            const notifications = await this.generateNotifications();
            this.updateNotificationDisplay(notifications);
        } catch (error) {
            console.error('Failed to check for notifications:', error);
        }
    }

    async generateNotifications() {
        const notifications = [];

        try {
            // Get all purchase orders
            const orders = await $.get('/api/purchase-orders/all');
            
            // Check for draft orders
            if (this.settings.showDraftAlerts) {
                const draftOrders = orders.filter(order => order.status === 'draft');
                if (draftOrders.length > 0) {
                    notifications.push({
                        id: 'draft-orders',
                        type: 'warning',
                        title: 'Draft Purchase Orders',
                        message: `${draftOrders.length} purchase order(s) are in draft status and need to be sent to suppliers.`,
                        count: draftOrders.length,
                        action: 'View Draft Orders',
                        data: { status: 'draft' }
                    });
                }
            }

            // Check for overdue orders
            if (this.settings.showOverdueAlerts) {
                const overdueOrders = orders.filter(order => {
                    if (!order.expectedDeliveryDate || order.status === 'completed') {
                        return false;
                    }
                    const expectedDate = moment(order.expectedDeliveryDate);
                    return expectedDate.isBefore(moment(), 'day');
                });

                if (overdueOrders.length > 0) {
                    notifications.push({
                        id: 'overdue-orders',
                        type: 'danger',
                        title: 'Overdue Purchase Orders',
                        message: `${overdueOrders.length} purchase order(s) are overdue for delivery.`,
                        count: overdueOrders.length,
                        action: 'View Overdue Orders',
                        data: { overdue: true }
                    });
                }
            }

            // Check for orders due soon
            const dueSoonOrders = orders.filter(order => {
                if (!order.expectedDeliveryDate || order.status === 'completed') {
                    return false;
                }
                const expectedDate = moment(order.expectedDeliveryDate);
                const daysUntilDue = expectedDate.diff(moment(), 'days');
                return daysUntilDue >= 0 && daysUntilDue <= 3;
            });

            if (dueSoonOrders.length > 0) {
                notifications.push({
                    id: 'due-soon-orders',
                    type: 'info',
                    title: 'Orders Due Soon',
                    message: `${dueSoonOrders.length} purchase order(s) are due for delivery within 3 days.`,
                    count: dueSoonOrders.length,
                    action: 'View Due Soon Orders',
                    data: { dueSoon: true }
                });
            }

            // Check for partial deliveries
            const partialOrders = orders.filter(order => order.status === 'partial');
            if (partialOrders.length > 0) {
                notifications.push({
                    id: 'partial-orders',
                    type: 'warning',
                    title: 'Partial Deliveries',
                    message: `${partialOrders.length} purchase order(s) have partial deliveries and need completion.`,
                    count: partialOrders.length,
                    action: 'View Partial Orders',
                    data: { status: 'partial' }
                });
            }

            // Check for low stock items that need reordering
            if (this.settings.showExpiryAlerts) {
                const lowStockProducts = await this.getLowStockProducts();
                if (lowStockProducts.length > 0) {
                    notifications.push({
                        id: 'low-stock-items',
                        type: 'warning',
                        title: 'Low Stock Alert',
                        message: `${lowStockProducts.length} product(s) are below reorder point and need restocking.`,
                        count: lowStockProducts.length,
                        action: 'Generate Auto-Draft',
                        data: { lowStock: true }
                    });
                }
            }

        } catch (error) {
            console.error('Error generating notifications:', error);
        }

        return notifications;
    }

    async getLowStockProducts() {
        try {
            const products = await $.get('/api/inventory/products');
            return products.filter(product => {
                const quantity = parseInt(product.quantity) || 0;
                const reorderPoint = parseInt(product.reorderPoint) || parseInt(product.minStock) || 5;
                return quantity <= reorderPoint;
            });
        } catch (error) {
            console.error('Failed to get low stock products:', error);
            return [];
        }
    }

    updateNotificationDisplay(notifications) {
        this.notifications = notifications;
        this.updateNotificationBadge();
        this.updateNotificationPanel();
    }

    updateNotificationBadge() {
        const totalCount = this.notifications.reduce((sum, notif) => sum + notif.count, 0);
        const badge = $('#poNotificationBadge');
        
        if (totalCount > 0) {
            badge.text(totalCount).show();
        } else {
            badge.hide();
        }
    }

    updateNotificationPanel() {
        const panel = $('#poNotificationsPanel');
        if (panel.length === 0) {
            return;
        }

        const tbody = panel.find('tbody');
        tbody.empty();

        if (this.notifications.length === 0) {
            tbody.append(`
                <tr>
                    <td colspan="4" class="text-center text-muted">
                        <i class="fa fa-check-circle fa-2x"></i><br>
                        No notifications
                    </td>
                </tr>
            `);
            return;
        }

        this.notifications.forEach(notification => {
            const icon = this.getNotificationIcon(notification.type);
            const badgeClass = this.getNotificationBadgeClass(notification.type);
            
            tbody.append(`
                <tr>
                    <td>
                        <i class="${icon} text-${notification.type}"></i>
                    </td>
                    <td>
                        <strong>${notification.title}</strong><br>
                        <small class="text-muted">${notification.message}</small>
                    </td>
                    <td class="text-center">
                        <span class="badge badge-${badgeClass}">${notification.count}</span>
                    </td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-primary" onclick="poNotifications.handleNotificationAction('${notification.id}')">
                            ${notification.action}
                        </button>
                        <button class="btn btn-sm btn-outline-secondary dismiss-po-notification" data-notification-id="${notification.id}">
                            <i class="fa fa-times"></i>
                        </button>
                    </td>
                </tr>
            `);
        });
    }

    getNotificationIcon(type) {
        const icons = {
            'info': 'fa fa-info-circle',
            'warning': 'fa fa-exclamation-triangle',
            'danger': 'fa fa-exclamation-circle',
            'success': 'fa fa-check-circle'
        };
        return icons[type] || 'fa fa-bell';
    }

    getNotificationBadgeClass(type) {
        const classes = {
            'info': 'info',
            'warning': 'warning',
            'danger': 'danger',
            'success': 'success'
        };
        return classes[type] || 'secondary';
    }

    handleNotificationAction(notificationId) {
        const notification = this.notifications.find(n => n.id === notificationId);
        if (!notification) {
            return;
        }

        switch (notificationId) {
            case 'draft-orders':
                $('#PurchaseOrders').modal('show');
                $('#poStatusFilter').val('draft').trigger('change');
                break;
            case 'overdue-orders':
                $('#PurchaseOrders').modal('show');
                // Filter for overdue orders
                this.filterOverdueOrders();
                break;
            case 'due-soon-orders':
                $('#PurchaseOrders').modal('show');
                // Filter for due soon orders
                this.filterDueSoonOrders();
                break;
            case 'partial-orders':
                $('#PurchaseOrders').modal('show');
                $('#poStatusFilter').val('partial').trigger('change');
                break;
            case 'low-stock-items':
                if (window.purchaseOrderManager) {
                    window.purchaseOrderManager.generateAutoDraft();
                }
                break;
        }

        // Dismiss the notification after action
        this.dismissNotification(notificationId);
    }

    filterOverdueOrders() {
        if (window.purchaseOrderManager) {
            const overdueOrders = window.purchaseOrderManager.orders.filter(order => {
                if (!order.expectedDeliveryDate || order.status === 'completed') {
                    return false;
                }
                const expectedDate = moment(order.expectedDeliveryDate);
                return expectedDate.isBefore(moment(), 'day');
            });
            window.purchaseOrderManager.displayFilteredOrders(overdueOrders);
        }
    }

    filterDueSoonOrders() {
        if (window.purchaseOrderManager) {
            const dueSoonOrders = window.purchaseOrderManager.orders.filter(order => {
                if (!order.expectedDeliveryDate || order.status === 'completed') {
                    return false;
                }
                const expectedDate = moment(order.expectedDeliveryDate);
                const daysUntilDue = expectedDate.diff(moment(), 'days');
                return daysUntilDue >= 0 && daysUntilDue <= 3;
            });
            window.purchaseOrderManager.displayFilteredOrders(dueSoonOrders);
        }
    }

    dismissNotification(notificationId) {
        this.notifications = this.notifications.filter(n => n.id !== notificationId);
        this.updateNotificationDisplay(this.notifications);
    }

    clearAllNotifications() {
        this.notifications = [];
        this.updateNotificationDisplay(this.notifications);
        (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success('All notifications cleared');
    }

    // Show toast notification
    showToastNotification(notification) {
        if (!this.settings.enabled) {
            return;
        }

        const toastOptions = {
            type: notification.type,
            title: notification.title,
            message: notification.message,
            timeout: 5000,
            showCloseButton: true
        };

        switch (notification.type) {
            case 'info':
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).info(toastOptions.message, toastOptions);
                break;
            case 'warning':
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning(toastOptions.message, toastOptions);
                break;
            case 'danger':
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure(toastOptions.message, toastOptions);
                break;
            case 'success':
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success(toastOptions.message, toastOptions);
                break;
        }
    }

    // Add new notification
    addNotification(notification) {
        this.notifications.push(notification);
        this.updateNotificationDisplay(this.notifications);
        this.showToastNotification(notification);
    }

    // Get notification statistics
    getNotificationStats() {
        return {
            total: this.notifications.length,
            byType: this.notifications.reduce((stats, notif) => {
                stats[notif.type] = (stats[notif.type] || 0) + 1;
                return stats;
            }, {}),
            totalCount: this.notifications.reduce((sum, notif) => sum + notif.count, 0)
        };
    }
}

// Initialize notifications when DOM is ready
$(document).ready(function() {
    window.poNotifications = new PONotifications();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PONotifications;
}
