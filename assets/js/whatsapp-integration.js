/**
 * WhatsApp Integration Module for Purchase Orders
 * Handles sending purchase orders to suppliers via WhatsApp Web
 */

class WhatsAppIntegration {
    constructor() {
        // In Electron app, use relative URLs for API calls
        this.templates = {
            purchaseOrder: this.getPOTemplate(),
            reminder: this.getReminderTemplate(),
            followUp: this.getFollowUpTemplate()
        };
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadSettings();
    }

    setupEventListeners() {
        // WhatsApp send button
        $(document).on('click', '.send-whatsapp-btn', (e) => {
            const orderId = $(e.target).data('order-id');
            this.sendPurchaseOrder(orderId);
        });

        // Bulk WhatsApp send
        $(document).on('click', '#bulkSendWhatsApp', () => {
            this.bulkSendPurchaseOrders();
        });

        // WhatsApp settings
        $(document).on('click', '#saveWhatsAppSettings', () => {
            this.saveSettings();
        });
    }

    loadSettings() {
        this.settings = {
            includeLogo: localStorage.getItem('whatsappIncludeLogo') === 'true',
            includeTerms: localStorage.getItem('whatsappIncludeTerms') === 'true',
            defaultMessage: localStorage.getItem('whatsappDefaultMessage') || 'Please find our purchase order below. Please confirm receipt and delivery timeline.',
            companyName: localStorage.getItem('whatsappCompanyName') || 'PharmaSpot',
            phonePrefix: localStorage.getItem('whatsappPhonePrefix') || '+1'
        };
    }

    saveSettings() {
        this.settings = {
            includeLogo: $('#whatsappIncludeLogo').is(':checked'),
            includeTerms: $('#whatsappIncludeTerms').is(':checked'),
            defaultMessage: $('#whatsappDefaultMessage').val(),
            companyName: $('#whatsappCompanyName').val(),
            phonePrefix: $('#whatsappPhonePrefix').val()
        };

        // Save to localStorage
        Object.keys(this.settings).forEach(key => {
            localStorage.setItem(`whatsapp${key.charAt(0).toUpperCase() + key.slice(1)}`, this.settings[key]);
        });

        if (typeof notiflix !== 'undefined') {
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success('WhatsApp settings saved successfully');
        }
    }

    async sendPurchaseOrder(orderId) {
        try {
            // Get purchase order details
            const order = await $.get(`/api/purchase-orders/${orderId}`);
            const supplier = await $.get(`/api/suppliers/supplier/${order.supplierId}`);
            
            if (!supplier || !supplier.phone) {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('Supplier phone number not available');
                return;
            }

            // Generate WhatsApp message
            const message = this.generatePOMessage(order, supplier);
            
            // Open WhatsApp Web
            this.openWhatsApp(supplier.phone, message);
            
            // Update order status to sent
            await $.ajax({
                url: `/api/purchase-orders/${orderId}`,
                type: 'PUT',
                data: JSON.stringify({ status: 'sent' }),
                contentType: 'application/json'
            });

            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success('Purchase order sent to supplier via WhatsApp');
            
        } catch (error) {
            console.error('Failed to send purchase order via WhatsApp:', error);
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to send purchase order: ' + error.message);
        }
    }

    generatePOMessage(order, supplier) {
        let message = `*${this.settings.companyName} - Purchase Order*\n\n`;
        message += `Dear ${supplier.name},\n\n`;
        message += `Please find below our purchase order details:\n\n`;
        message += `*PO Number:* ${order.poNumber}\n`;
        message += `*Date:* ${moment(order.createdAt).format('DD-MMM-YYYY')}\n`;
        message += `*Expected Delivery:* ${order.expectedDeliveryDate ? moment(order.expectedDeliveryDate).format('DD-MMM-YYYY') : 'Not specified'}\n\n`;
        
        message += `*Items Ordered:*\n`;
        order.items.forEach((item, index) => {
            message += `${index + 1}. *${item.productName}*\n`;
            message += `   📦 Barcode: ${item.barcode}\n`;
            message += `   🔢 Quantity: ${item.quantity}\n`;
            message += `   💰 Unit Price: ${utils.moneyFormat(item.unitPrice)}\n`;
            message += `   💵 Total: ${utils.moneyFormat(item.totalPrice)}\n\n`;
        });
        
        message += `*Order Summary:*\n`;
        message += `📊 Total Items: ${order.totalItems}\n`;
        message += `💰 Subtotal: ${utils.moneyFormat(order.subtotal)}\n`;
        if (order.tax > 0) {
            message += `🧾 Tax: ${utils.moneyFormat(order.tax)}\n`;
        }
        if (order.discount > 0) {
            message += `🎯 Discount: ${utils.moneyFormat(order.discount)}\n`;
        }
        message += `💵 *Total Amount: ${utils.moneyFormat(order.total)}*\n\n`;
        
        if (order.notes) {
            message += `*Notes:*\n${order.notes}\n\n`;
        }
        
        message += `${this.settings.defaultMessage}\n\n`;
        
        if (this.settings.includeTerms) {
            message += `*Terms & Conditions:*\n`;
            message += `• Please confirm receipt of this order\n`;
            message += `• Delivery timeline to be confirmed\n`;
            message += `• Payment terms as per agreement\n`;
            message += `• Quality standards must be maintained\n\n`;
        }
        
        message += `Thank you for your business!\n`;
        message += `Best regards,\n${this.settings.companyName} Team`;
        
        return message;
    }

    openWhatsApp(phoneNumber, message) {
        // Clean and format phone number
        let cleanPhone = phoneNumber.replace(/\D/g, '');
        
        // Add country code if not present
        if (!cleanPhone.startsWith('1') && cleanPhone.length === 10) {
            cleanPhone = '1' + cleanPhone;
        }
        
        // Remove the + from prefix if present
        const prefix = this.settings.phonePrefix.replace('+', '');
        if (!cleanPhone.startsWith(prefix)) {
            cleanPhone = prefix + cleanPhone;
        }
        
        // Encode message for URL
        const encodedMessage = encodeURIComponent(message);
        
        // Open WhatsApp Web
        const whatsappUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMessage}`;
        
        // Open in new tab
        window.open(whatsappUrl, '_blank');
        
        console.log(`Opening WhatsApp for ${cleanPhone} with message length: ${message.length}`);
    }

    async bulkSendPurchaseOrders() {
        try {
            // Get all draft purchase orders
            const orders = await $.get('/api/purchase-orders/all?status=draft');
            
            if (orders.length === 0) {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).info('No draft purchase orders to send');
                return;
            }

            notiflix.Report.warning(
                'Bulk Send Purchase Orders',
                `Are you sure you want to send ${orders.length} purchase orders via WhatsApp?`,
                'Send All',
                async () => {
                    let sentCount = 0;
                    let failedCount = 0;
                    
                    for (const order of orders) {
                        try {
                            await this.sendPurchaseOrder(order._id);
                            sentCount++;
                            
                            // Add delay between sends to avoid rate limiting
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        } catch (error) {
                            console.error(`Failed to send PO ${order.poNumber}:`, error);
                            failedCount++;
                        }
                    }
                    
                    (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success(`Bulk send completed: ${sentCount} sent, ${failedCount} failed`);
                }
            );
            
        } catch (error) {
            console.error('Bulk send failed:', error);
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Bulk send failed: ' + error.message);
        }
    }

    generateReminderMessage(order, supplier) {
        let message = `*${this.settings.companyName} - Order Reminder*\n\n`;
        message += `Dear ${supplier.name},\n\n`;
        message += `This is a friendly reminder about our purchase order:\n\n`;
        message += `*PO Number:* ${order.poNumber}\n`;
        message += `*Order Date:* ${moment(order.createdAt).format('DD-MMM-YYYY')}\n`;
        message += `*Expected Delivery:* ${order.expectedDeliveryDate ? moment(order.expectedDeliveryDate).format('DD-MMM-YYYY') : 'Not specified'}\n\n`;
        
        if (order.expectedDeliveryDate) {
            const daysUntilDelivery = moment(order.expectedDeliveryDate).diff(moment(), 'days');
            if (daysUntilDelivery < 0) {
                message += `⚠️ *This order is overdue by ${Math.abs(daysUntilDelivery)} days*\n\n`;
            } else if (daysUntilDelivery <= 3) {
                message += `⏰ *This order is due in ${daysUntilDelivery} days*\n\n`;
            }
        }
        
        message += `Please provide an update on the delivery status.\n\n`;
        message += `Thank you!\n${this.settings.companyName} Team`;
        
        return message;
    }

    generateFollowUpMessage(order, supplier) {
        let message = `*${this.settings.companyName} - Order Follow-up*\n\n`;
        message += `Dear ${supplier.name},\n\n`;
        message += `We hope you're doing well. We wanted to follow up on our purchase order:\n\n`;
        message += `*PO Number:* ${order.poNumber}\n`;
        message += `*Order Date:* ${moment(order.createdAt).format('DD-MMM-YYYY')}\n\n`;
        
        if (order.status === 'partial') {
            message += `We have received partial delivery. Please confirm when the remaining items will be delivered.\n\n`;
        } else if (order.status === 'sent') {
            message += `Please confirm receipt and provide delivery timeline.\n\n`;
        }
        
        message += `Thank you for your prompt attention.\n\n`;
        message += `Best regards,\n${this.settings.companyName} Team`;
        
        return message;
    }

    async sendReminder(orderId) {
        try {
            const order = await $.get(`/api/purchase-orders/${orderId}`);
            const supplier = await $.get(`/api/suppliers/supplier/${order.supplierId}`);
            
            if (!supplier || !supplier.phone) {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('Supplier phone number not available');
                return;
            }

            const message = this.generateReminderMessage(order, supplier);
            this.openWhatsApp(supplier.phone, message);
            
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success('Reminder sent to supplier via WhatsApp');
            
        } catch (error) {
            console.error('Failed to send reminder:', error);
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to send reminder: ' + error.message);
        }
    }

    async sendFollowUp(orderId) {
        try {
            const order = await $.get(`/api/purchase-orders/${orderId}`);
            const supplier = await $.get(`/api/suppliers/supplier/${order.supplierId}`);
            
            if (!supplier || !supplier.phone) {
                (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).warning('Supplier phone number not available');
                return;
            }

            const message = this.generateFollowUpMessage(order, supplier);
            this.openWhatsApp(supplier.phone, message);
            
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).success('Follow-up sent to supplier via WhatsApp');
            
        } catch (error) {
            console.error('Failed to send follow-up:', error);
            (typeof notiflix !== 'undefined' ? notiflix.Notify : { success: console.log, failure: console.error, warning: console.warn, info: console.info }).failure('Failed to send follow-up: ' + error.message);
        }
    }

    getPOTemplate() {
        return `*{companyName} - Purchase Order*

Dear {supplierName},

Please find below our purchase order details:

*PO Number:* {poNumber}
*Date:* {date}
*Expected Delivery:* {expectedDelivery}

*Items Ordered:*
{items}

*Order Summary:*
📊 Total Items: {totalItems}
💰 Subtotal: {subtotal}
💵 Total Amount: {total}

{notes}

{defaultMessage}

Thank you for your business!
Best regards,
{companyName} Team`;
    }

    getReminderTemplate() {
        return `*{companyName} - Order Reminder*

Dear {supplierName},

This is a friendly reminder about our purchase order:

*PO Number:* {poNumber}
*Order Date:* {date}
*Expected Delivery:* {expectedDelivery}

{deliveryStatus}

Please provide an update on the delivery status.

Thank you!
{companyName} Team`;
    }

    getFollowUpTemplate() {
        return `*{companyName} - Order Follow-up*

Dear {supplierName},

We hope you're doing well. We wanted to follow up on our purchase order:

*PO Number:* {poNumber}
*Order Date:* {date}

{followUpMessage}

Thank you for your prompt attention.

Best regards,
{companyName} Team`;
    }

    // Validate phone number format
    validatePhoneNumber(phoneNumber) {
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        return cleanPhone.length >= 10 && cleanPhone.length <= 15;
    }

    // Format phone number for display
    formatPhoneNumber(phoneNumber) {
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        if (cleanPhone.length === 10) {
            return `(${cleanPhone.slice(0, 3)}) ${cleanPhone.slice(3, 6)}-${cleanPhone.slice(6)}`;
        }
        return phoneNumber;
    }

    // Get WhatsApp Web URL for a phone number
    getWhatsAppURL(phoneNumber, message = '') {
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        const encodedMessage = encodeURIComponent(message);
        return `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMessage}`;
    }

    // Check if WhatsApp Web is available
    async checkWhatsAppAvailability() {
        try {
            // Simple check by trying to open WhatsApp Web
            const testUrl = 'https://web.whatsapp.com/';
            const response = await fetch(testUrl, { method: 'HEAD' });
            return response.ok;
        } catch (error) {
            return false;
        }
    }
}

// Initialize WhatsApp integration when DOM is ready
$(document).ready(function() {
    window.whatsappIntegration = new WhatsAppIntegration();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WhatsAppIntegration;
}
