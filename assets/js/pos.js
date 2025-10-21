const jsPDF = require("jspdf");
const html2canvas = require("html2canvas");
const JsBarcode = require("jsbarcode");
const macaddress = require("macaddress");
const notiflix = require("notiflix");
const validator = require("validator");
const DOMPurify = require("dompurify");
const _ = require("lodash");
let fs = require("fs");
let path = require("path");
let moment = require("moment");
let { ipcRenderer } = require("electron");
let dotInterval = setInterval(function () {
  $(".dot").text(".");
}, 3000);
let Store = require("electron-store");
const remote = require("@electron/remote");
const app = remote.app;
let cart = [];
let index = 0;
let allUsers = [];
let allProducts = [];
let allCategories = [];
let allTransactions = [];
let sold = [];
let state = [];
let sold_items = [];
let item;
let auth;
let holdOrder = 0;
let vat = 0;
let perms = null;
let deleteId = 0;
let paymentType = 0;
let receipt = "";
let totalVat = 0;
let subTotal = 0;
let method = "";
let order_index = 0;
let user_index = 0;
let product_index = 0;
let transaction_index;
const appName = process.env.APPNAME;
const appData = process.env.APPDATA;
let host = "localhost";
let port = process.env.PORT;
let img_path = path.join(appData, appName, "uploads", "/");
let api = "http://" + host + ":" + port + "/api/";
const bcrypt = require("bcrypt");
let categories = [];
let holdOrderList = [];
let customerOrderList = [];
let ownUserEdit = null;
let totalPrice = 0;
let orderTotal = 0;
let auth_error = "Incorrect username or password";
let auth_empty = "Please enter a username and password";
let holdOrderlocation = $("#renderHoldOrders");
let customerOrderLocation = $("#renderCustomerOrders");
let storage = new Store();
let settings;
let platform;
let user = {};
let start = moment().subtract(1, "year").startOf("year");
let end = moment().add(1, "year").endOf("year");
let start_date = moment(start).toDate().toJSON();
let end_date = moment(end).toDate().toJSON();
let by_till = 0;
let by_user = 0;
let by_status = 'all';
const default_item_img = path.join("assets","images","default.jpg");
const permissions = [
  "perm_products",
  "perm_categories",
  "perm_manufacturers",
  "perm_suppliers",
  "perm_transactions",
  "perm_users",
  "perm_settings",
];
notiflix.Notify.init({
  position: "right-top",
  cssAnimationDuration: 600,
  messageMaxLength: 150,
  clickToClose: true,
  closeButton: true
});

// Add keyboard support for notiflix popups
notiflix.Report.init({
  className: "notiflix-report",
  width: "320px",
  backgroundColor: "#f8f9fa",
  borderRadius: "25px",
  rtl: false,
  zindex: 4002,
  backOverlay: true,
  backOverlayColor: "rgba(0,0,0,0.5)",
  fontFamily: "Quicksand",
  svgSize: "110px",
  plainText: true,
  titleMaxLength: 34,
  messageMaxLength: 400,
  buttonFontSize: "14px",
  buttonMaxLength: 34,
  cssAnimation: true,
  cssAnimationDuration: 360,
  cssAnimationStyle: "fade",
  success: {
    svgColor: "#32c682",
    titleColor: "#1e1e1e",
    messageColor: "#242424",
    buttonBackground: "#32c682",
    buttonColor: "#fff",
    backOverlayColor: "rgba(50,198,130,0.2)",
  },
  failure: {
    svgColor: "#ff5549",
    titleColor: "#1e1e1e",
    messageColor: "#242424",
    buttonBackground: "#ff5549",
    buttonColor: "#fff",
    backOverlayColor: "rgba(255,85,73,0.2)",
  },
  warning: {
    svgColor: "#eebf31",
    titleColor: "#1e1e1e",
    messageColor: "#242424",
    buttonBackground: "#eebf31",
    buttonColor: "#fff",
    backOverlayColor: "rgba(238,191,49,0.2)",
  },
  info: {
    svgColor: "#26c0d3",
    titleColor: "#1e1e1e",
    messageColor: "#242424",
    buttonBackground: "#26c0d3",
    buttonColor: "#fff",
    backOverlayColor: "rgba(38,192,211,0.2)",
  },
});

// Add global keyboard support for closing popups
$(document).on('keydown', function(e) {
  // ESC key to close notiflix popups
  if (e.keyCode === 27) { // ESC key
    // Close any open notiflix reports
    if ($('.notiflix-report').length > 0) {
      $('.notiflix-report').remove();
      $('.notiflix-report-back').remove();
    }
    
    // Close any open notiflix notifications
    if (notiflix && notiflix.Notify && typeof notiflix.Notify.dismiss === 'function') {
      notiflix.Notify.dismiss();
    }
  }
  
  // F5 key to dismiss all alerts
  if (e.keyCode === 116) { // F5 key
    e.preventDefault();
    dismissAllAlerts();
  }
  
    // F6 key to create test transaction (only in transactions view)
    if (e.keyCode === 117) { // F6 key
      e.preventDefault();
      if ($("#transactions_view").is(":visible")) {
        createTestTransaction();
      }
    }
    
    // F7 key to refresh transactions (only in transactions view)
    if (e.keyCode === 118) { // F7 key
      e.preventDefault();
      if ($("#transactions_view").is(":visible")) {
        loadTransactions();
      }
    }
});

// Enhanced transaction view event handlers
$(document).ready(function() {
  // Refresh transactions button
  $(document).on('click', '#refresh_transactions', function() {
    loadTransactions();
  });
  
  // Export transactions button
  $(document).on('click', '#export_transactions', function() {
    if ($.fn.DataTable.isDataTable('#transactionList')) {
      $('#transactionList').DataTable().button('.buttons-csv').trigger();
    }
  });
  
  // Print summary button
  $(document).on('click', '#print_summary', function() {
    if ($.fn.DataTable.isDataTable('#transactionList')) {
      $('#transactionList').DataTable().button('.buttons-print').trigger();
    }
  });
  
  // View toggle buttons
  $(document).on('click', '#view_table', function() {
    $(this).addClass('active');
    $('#view_cards').removeClass('active');
    $('#transaction_table_view').show();
    $('#transaction_cards_view').hide();
  });
  
  $(document).on('click', '#view_cards', function() {
    $(this).addClass('active');
    $('#view_table').removeClass('active');
    $('#transaction_table_view').hide();
    $('#transaction_cards_view').show();
    generateTransactionCards();
  });
  
  // Search functionality
  $(document).on('input', '#transaction_search', function() {
    const searchTerm = $(this).val().toLowerCase();
    if ($.fn.DataTable.isDataTable('#transactionList')) {
      $('#transactionList').DataTable().search(searchTerm).draw();
    }
  });
  
  // Clear search button
  $(document).on('click', '#clear_search', function() {
    $('#transaction_search').val('');
    if ($.fn.DataTable.isDataTable('#transactionList')) {
      $('#transactionList').DataTable().search('').draw();
    }
  });
});

// Generate transaction cards for card view
function generateTransactionCards() {
  if (!allTransactions || allTransactions.length === 0) {
    $('#transaction_cards_container').html(`
      <div class="col-12">
        <div class="alert alert-info text-center">
          <i class="fa fa-info-circle"></i> No transactions found
          <br><small>Try adjusting the date range or create some transactions first</small>
        </div>
      </div>
    `);
    return;
  }
  
  let cardsHtml = '';
  allTransactions.forEach((trans, index) => {
    const isPaid = trans.paid !== "" && trans.paid !== null;
    const statusClass = isPaid ? 'success' : 'warning';
    const statusIcon = isPaid ? 'check' : 'clock-o';
    const paymentMethodIcon = trans.payment_type === 'Cash' ? 'money' : 'credit-card';
    
    cardsHtml += `
      <div class="col-md-6 col-lg-4 mb-3">
        <div class="card transaction-card">
          <div class="card-header">
            <div class="row">
              <div class="col-8">
                <h6 class="mb-0"><i class="fa fa-file-text-o"></i> ${trans.order}</h6>
              </div>
              <div class="col-4 text-right">
                <span class="badge badge-${statusClass}">
                  <i class="fa fa-${statusIcon}"></i> ${isPaid ? 'Paid' : 'Unpaid'}
                </span>
              </div>
            </div>
          </div>
          <div class="card-body">
            <div class="row mb-2">
              <div class="col-6">
                <small class="text-muted">Date</small><br>
                <strong>${moment(new Date(trans.date)).format("DD-MMM-YYYY")}</strong>
              </div>
              <div class="col-6">
                <small class="text-muted">Time</small><br>
                <strong>${moment(new Date(trans.date)).format("HH:mm:ss")}</strong>
              </div>
            </div>
            <div class="row mb-2">
              <div class="col-6">
                <small class="text-muted">Total</small><br>
                <strong class="text-primary">${validator.unescape(settings.symbol)}${moneyFormat(trans.total)}</strong>
              </div>
              <div class="col-6">
                <small class="text-muted">Paid</small><br>
                <strong>${trans.paid == "" ? '-' : validator.unescape(settings.symbol) + moneyFormat(trans.paid)}</strong>
              </div>
            </div>
            <div class="row mb-2">
              <div class="col-6">
                <small class="text-muted">Method</small><br>
                <i class="fa fa-${paymentMethodIcon}"></i> ${trans.payment_type || '-'}
              </div>
              <div class="col-6">
                <small class="text-muted">Till</small><br>
                <span class="badge badge-light">${trans.till}</span>
              </div>
            </div>
            <div class="row">
              <div class="col-12">
                <small class="text-muted">Cashier</small><br>
                <i class="fa fa-user text-muted"></i> ${trans.user}
              </div>
            </div>
          </div>
          <div class="card-footer">
            <div class="btn-group btn-group-sm w-100" role="group">
              ${trans.paid == "" 
                ? '<button class="btn btn-outline-secondary" disabled><i class="fa fa-eye"></i> View</button>'
                : `<button onClick="$(this).viewTransaction(${index})" class="btn btn-info"><i class="fa fa-receipt"></i> View Receipt</button>`
              }
            </div>
          </div>
        </div>
      </div>
    `;
  });
  
  $('#transaction_cards_container').html(cardsHtml);
}

// Auto-focus barcode search input when no modals are open
function autoFocusBarcodeInput() {
  // Check if any modals are open
  const hasOpenModals = $('.modal.in, .modal.show').length > 0;
  const hasOpenPopups = $('.notiflix-report, .notiflix-notify').length > 0;
  
  // Only focus if no modals or popups are open and we're in POS view
  if (!hasOpenModals && !hasOpenPopups && $('#pos_view').is(':visible')) {
    const barcodeInput = $('#skuCode');
    if (barcodeInput.length && !barcodeInput.is(':focus')) {
      barcodeInput.focus();
    }
  }
}

// Focus barcode input on page load
$(document).ready(function() {
  setTimeout(autoFocusBarcodeInput, 500); // Small delay to ensure everything is loaded
});

// Auto-focus barcode input when POS view becomes visible
$(document).on('click', '#pos', function() {
  setTimeout(autoFocusBarcodeInput, 200);
});

// Auto-focus barcode input when switching to POS view via keyboard
$(document).on('keydown', function(e) {
  // Check if user is trying to navigate to POS view
  if (e.keyCode === 112 && $('#pos').length) { // F1 key
    setTimeout(autoFocusBarcodeInput, 200);
  }
});

// Auto-focus barcode input when modals close
$(document).on('hidden.bs.modal', function() {
  setTimeout(autoFocusBarcodeInput, 100); // Small delay to ensure modal is fully closed
});

// Auto-focus barcode input when popups close
$(document).on('click', '.notiflix-report button, .notiflix-notify button', function() {
  setTimeout(autoFocusBarcodeInput, 100);
});

// Auto-focus barcode input when clicking outside of modals
$(document).on('click', function(e) {
  // If click is not on a modal or its children, focus barcode input
  if (!$(e.target).closest('.modal').length && !$(e.target).closest('.notiflix-report').length) {
    setTimeout(autoFocusBarcodeInput, 50);
  }
});

// Prevent focus loss when typing in barcode input
$('#skuCode').on('blur', function() {
  // Only refocus if no modals are open
  const hasOpenModals = $('.modal.in, .modal.show').length > 0;
  const hasOpenPopups = $('.notiflix-report, .notiflix-notify').length > 0;
  
  if (!hasOpenModals && !hasOpenPopups) {
    setTimeout(() => {
      if (!$(this).is(':focus')) {
        $(this).focus();
      }
    }, 10);
  }
});

// Dismiss all stacked notifications (expiry/low-stock, etc.)
function dismissAllAlerts() {
  try {
    if (notiflix && notiflix.Notify && typeof notiflix.Notify.dismiss === 'function') {
      notiflix.Notify.dismiss();
    } else {
      // Fallback: remove Notiflix notification DOM nodes if API not available
      $(".notiflix-notify-wrap, .notiflix-notify").remove();
    }
  } catch (_) {
    $(".notiflix-notify-wrap, .notiflix-notify").remove();
  }
}

// Click handler for clear alerts button
$(document).on('click', '#clearAlerts', function() {
  dismissAllAlerts();
});

// Add keyboard support for Notiflix Report modals
$(document).on('keydown', function(e) {
  // Check if any Notiflix Report modal is open
  const reportModal = $('.notiflix-report-modal');
  if (reportModal.length > 0) {
    // Escape key to close modal
    if (e.keyCode === 27) { // ESC key
      e.preventDefault();
      $('.notiflix-report-modal .notiflix-report-button').click();
    }
    // Enter key to close modal (same as clicking OK button)
    if (e.keyCode === 13) { // Enter key
      e.preventDefault();
      $('.notiflix-report-modal .notiflix-report-button').click();
    }
    // Space key to close modal
    if (e.keyCode === 32) { // Space key
      e.preventDefault();
      $('.notiflix-report-modal .notiflix-report-button').click();
    }
  }
});

// Enhanced auto-focus for Notiflix Report modals
function focusNotiflixModal() {
  // Try both possible modal classes
  const modal = $('.notiflix-report-modal, .notiflix-report-content');
  if (modal.length > 0) {
    // Force focus on the modal
    modal.attr('tabindex', '0');
    
    // Try multiple focus strategies with immediate focus
    // Strategy 1: Immediate focus on button by ID (most reliable)
    const buttonById = $('#NXReportButton');
    if (buttonById.length) {
      buttonById.attr('tabindex', '0').focus();
    }
    
    // Strategy 2: Focus with delay for other elements
    setTimeout(() => {
      // Focus the modal container
      modal.focus();
      
      // Focus the button by class
      const button = modal.find('.notiflix-report-button');
      if (button.length) {
        button.attr('tabindex', '0').focus();
      }
      
      // Focus any focusable element in the modal
      const focusableElements = modal.find('button, [tabindex], input, select, textarea');
      if (focusableElements.length > 0) {
        focusableElements.first().focus();
      }
    }, 25); // Reduced delay for faster response
  }
}

// Modern MutationObserver to catch modal appearance (no deprecated events)

// Use MutationObserver as primary detection method
if (typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        // Check for both possible modal classes
        if (node.nodeType === 1 && node.classList && 
            (node.classList.contains('notiflix-report-modal') || 
             node.classList.contains('notiflix-report-content'))) {
          focusNotiflixModal();
        }
      });
    });
  });
  
  // Start observing immediately
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Aggressive polling fallback for stubborn modals
setInterval(function() {
  const modal = $('.notiflix-report-modal, .notiflix-report-content');
  if (modal.length > 0) {
    const isFocused = document.activeElement && 
                     (document.activeElement.closest('.notiflix-report-modal') || 
                      document.activeElement.closest('.notiflix-report-content'));
    if (!isFocused) {
      focusNotiflixModal();
    }
  }
}, 100); // Check every 100ms for better responsiveness

// Override Notiflix Report to force focus
if (window.notiflix && notiflix.Report) {
  const originalInfo = notiflix.Report.info;
  const originalSuccess = notiflix.Report.success;
  const originalWarning = notiflix.Report.warning;
  const originalFailure = notiflix.Report.failure;
  
  // Override info method
  notiflix.Report.info = function(title, message, buttonText) {
    const result = originalInfo.call(this, title, message, buttonText);
    
    // Immediate focus attempt
    setTimeout(focusNotiflixModal, 50);
    
    // Additional focus attempts with delays
    setTimeout(focusNotiflixModal, 150);
    setTimeout(focusNotiflixModal, 300);
    
    return result;
  };
  
  // Override success method
  notiflix.Report.success = function(title, message, buttonText) {
    const result = originalSuccess.call(this, title, message, buttonText);
    
    // Immediate focus attempt
    setTimeout(focusNotiflixModal, 50);
    
    // Additional focus attempts with delays
    setTimeout(focusNotiflixModal, 150);
    setTimeout(focusNotiflixModal, 300);
    
    return result;
  };
  
  // Override warning method
  notiflix.Report.warning = function(title, message, buttonText) {
    const result = originalWarning.call(this, title, message, buttonText);
    
    // Immediate focus attempt
    setTimeout(focusNotiflixModal, 50);
    
    // Additional focus attempts with delays
    setTimeout(focusNotiflixModal, 150);
    setTimeout(focusNotiflixModal, 300);
    
    return result;
  };
  
  // Override failure method
  notiflix.Report.failure = function(title, message, buttonText) {
    const result = originalFailure.call(this, title, message, buttonText);
    
    // Immediate focus attempt
    setTimeout(focusNotiflixModal, 50);
    
    // Additional focus attempts with delays
    setTimeout(focusNotiflixModal, 150);
    setTimeout(focusNotiflixModal, 300);
    
    return result;
  };
}

// Test function to manually trigger Stock Limit alert (for testing)
window.testStockLimitAlert = function() {
  notiflix.Report.info(
    "Stock Limit!",
    "Maximum available stock: 5",
    "Ok"
  );
};

// Global keyboard handler for Notiflix modals - Enter key only
$(document).on('keydown', function(e) {
  const modal = $('.notiflix-report-modal, .notiflix-report-content');
  if (modal.length > 0) {
    // Close modal with Enter key only (most reliable)
    if (e.keyCode === 13) { // Enter key
      e.preventDefault();
      e.stopPropagation(); // Prevent event bubbling
      
      const button = modal.find('.notiflix-report-button, #NXReportButton');
      if (button.length) {
        button.click();
      }
    }
  }
});

// Global keyboard handler for POS function keys
$(document).on('keydown', function(e) {
  // Only handle function keys when in POS view
  if ($('#pos_view').is(':visible')) {
    switch (e.keyCode) {
      case 112: // F1 key - Pay Button
        e.preventDefault();
        if ($('#payButton').is(':visible')) {
          $('#payButton').click();
        }
        break;
        
      case 113: // F2 key - Hold Button
        e.preventDefault();
        if ($('#hold').is(':visible')) {
          $('#hold').click();
        }
        break;
        
      case 114: // F3 key - Cancel/Clear Cart
        e.preventDefault();
        if ($('button[onclick*="cancelOrder"]').is(':visible')) {
          $('button[onclick*="cancelOrder"]').click();
        }
        break;
    }
  }
});
const {
  DATE_FORMAT,
  moneyFormat,
  isExpired,
  daysToExpire,
  getStockStatus,
  checkFileExists,
  setContentSecurityPolicy,
} = require("./utils");

//set the content security policy of the app
setContentSecurityPolicy();

$(function () {
  function cb(start, end) {
    $("#reportrange span").html(
      start.format("MMMM D, YYYY") + "  -  " + end.format("MMMM D, YYYY"),
    );
  }

  $("#reportrange").daterangepicker(
    {
      startDate: start,
      endDate: end,
      autoApply: true,
      timePicker: true,
      timePicker24Hour: true,
      timePickerIncrement: 10,
      timePickerSeconds: true,
      // minDate: '',
      ranges: {
        Today: [moment().startOf("day"), moment()],
        Yesterday: [
          moment().subtract(1, "days").startOf("day"),
          moment().subtract(1, "days").endOf("day"),
        ],
        "Last 7 Days": [
          moment().subtract(6, "days").startOf("day"),
          moment().endOf("day"),
        ],
        "Last 30 Days": [
          moment().subtract(29, "days").startOf("day"),
          moment().endOf("day"),
        ],
        "This Month": [moment().startOf("month"), moment().endOf("month")],
        "This Month": [moment().startOf("month"), moment()],
        "Last Month": [
          moment().subtract(1, "month").startOf("month"),
          moment().subtract(1, "month").endOf("month"),
        ],
      },
    },
    cb,
  );

  cb(start, end);

  $("#expirationDate").daterangepicker({
    singleDatePicker: true,
    locale: {
      format: DATE_FORMAT,
    },
  });
});

//Allow only numbers in input field
$.fn.allowOnlyNumbers = function() {
  return this.on('keydown', function(e) {
  // Allow: backspace, delete, tab, escape, enter, ., ctrl/cmd+A, ctrl/cmd+C, ctrl/cmd+X, ctrl/cmd+V, end, home, left, right, down, up
    if ($.inArray(e.keyCode, [46, 8, 9, 27, 13, 110, 190]) !== -1 || 
      (e.keyCode >= 35 && e.keyCode <= 40) || 
      ((e.keyCode === 65 || e.keyCode === 67 || e.keyCode === 86 || e.keyCode === 88) && (e.ctrlKey === true || e.metaKey === true))) {
      return;
  }
  // Ensure that it is a number and stop the keypress
  if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
    e.preventDefault();
  }
});
};
$('.number-input').allowOnlyNumbers();

//Serialize Object
$.fn.serializeObject = function () {
  var o = {};
  var a = this.serializeArray();
  $.each(a, function () {
    if (o[this.name]) {
      if (!o[this.name].push) {
        o[this.name] = [o[this.name]];
      }
      o[this.name].push(this.value || "");
    } else {
      o[this.name] = this.value || "";
    }
  });
  return o;
};

auth = storage.get("auth");
user = storage.get("user");

$("#main_app").hide();
if (auth == undefined) {
  $.get(api + "users/check/", function (data) {});

  authenticate();
} else {
  $("#login").hide();
  $("#main_app").show();
  platform = storage.get("settings");

  if (platform != undefined) {
    if (platform.app == "Network Point of Sale Terminal") {
      api = "http://" + platform.ip + ":" + port + "/api/";
      perms = true;
    }
  }

  $.get(api + "users/user/" + user._id, function (data) {
    user = data;
    $("#loggedin-user").text(user.fullname);
  });

  $.get(api + "settings/get", function (data) {
    settings = data.settings;
    
    // Populate manufacturer settings if they exist
    if (settings && settings.defaultManufacturer) {
      $("#defaultManufacturer").val(settings.defaultManufacturer);
    }
    if (settings && settings.autoCreateManufacturers) {
      $("#autoCreateManufacturers").prop('checked', settings.autoCreateManufacturers);
    }
    if (settings && settings.requireManufacturerName !== undefined) {
      $("#requireManufacturerName").prop('checked', settings.requireManufacturerName);
    }
    if (settings && settings.requireManufacturerCode !== undefined) {
      $("#requireManufacturerCode").prop('checked', settings.requireManufacturerCode);
    }
    if (settings && settings.requireManufacturerContact !== undefined) {
      $("#requireManufacturerContact").prop('checked', settings.requireManufacturerContact);
    }
    if (settings && settings.manufacturerCodeFormat) {
      $("#manufacturerCodeFormat").val(settings.manufacturerCodeFormat);
    }
    
    // Populate supplier settings if they exist
    if (settings && settings.defaultSupplier) {
      $("#defaultSupplier").val(settings.defaultSupplier);
    }
    if (settings && settings.autoCreateSuppliers) {
      $("#autoCreateSuppliers").prop('checked', settings.autoCreateSuppliers);
    }
    if (settings && settings.requireSupplierName !== undefined) {
      $("#requireSupplierName").prop('checked', settings.requireSupplierName);
    }
    if (settings && settings.requireSupplierCode !== undefined) {
      $("#requireSupplierCode").prop('checked', settings.requireSupplierCode);
    }
    if (settings && settings.requireSupplierContact !== undefined) {
      $("#requireSupplierContact").prop('checked', settings.requireSupplierContact);
    }
    if (settings && settings.supplierCodeFormat) {
      $("#supplierCodeFormat").val(settings.supplierCodeFormat);
    }
  });

  $.get(api + "users/all", function (users) {
    allUsers = [...users];
  });

  $(document).ready(function () {
    //update title based on company
    let appTitle = !!settings ? `${validator.unescape(settings.store)} - ${appName}` : appName;
    $("title").text(appTitle);

    $(".loading").hide();

    loadCategories();
    loadManufacturers();
    loadSuppliers();
    loadProducts();
    loadCustomers();
    
    // Populate manufacturer settings dropdown when settings modal is opened
    $("#settings").on("click", function() {
      populateManufacturerSettings();
      populateSupplierSettings();
    });

    // Keyboard shortcuts
    $(document).on('keydown', function(e) {
      if (e.ctrlKey && e.keyCode === 57) { // Ctrl+9
        e.preventDefault();
        // Check if Products modal is open, if so trigger bulk import
        if ($('#Products').hasClass('in')) {
          $('#bulkImportModal').click();
        } else {
          // If Products modal is not open, open it first
          $('#productModal').click();
          // Wait for modal to open then trigger bulk import
          setTimeout(function() {
            $('#bulkImportModal').click();
          }, 500);
        }
      }
      
      // Use Alt+0 for bulk remove to avoid conflict with Ctrl+0 (Actual Size)
      if (e.altKey && e.keyCode === 48) { // Alt+0: Bulk Remove
        e.preventDefault();
        // Check if Products modal is open, if so trigger bulk remove
        if ($('#Products').hasClass('in')) {
          $('#bulkRemoveModal').click();
        } else {
          // If Products modal is not open, open it first
          $('#productModal').click();
          // Wait for modal to open then trigger bulk remove
          setTimeout(function() {
            $('#bulkRemoveModal').click();
          }, 500);
        }
      }
      
      // Navigation shortcuts (Ctrl+1 to Ctrl+8)
      if (e.ctrlKey && e.keyCode >= 49 && e.keyCode <= 56) {
        e.preventDefault();
        
        switch(e.keyCode) {
          case 49: // Ctrl+1: Products
            $('#productModal').click();
            break;
          case 50: // Ctrl+2: Categories
            $('#categoryModal').click();
            break;
          case 51: // Ctrl+3: Manufacturers
            $('#manufacturerModal').click();
            break;
          case 52: // Ctrl+4: Suppliers
            $('#supplierModal').click();
            break;
          case 53: // Ctrl+5: Transactions
            $('#viewRefOrders').click();
            break;
          case 54: // Ctrl+6: Settings
            $('#settings').click();
            break;
          case 55: // Ctrl+7: Users
            $('#usersModal').click();
            break;
          case 56: // Ctrl+8: Point of Sale (Orders)
            $('#viewCustomerOrders').click();
            break;
          case 57: // Ctrl+9: Open Tabs (Hold Orders)
            $('#viewRefOrders').click();
            break;
          case 48: // Ctrl+0: Orders
            $('#viewCustomerOrders').click();
            break;
        }
      }
      
      // Quick action shortcuts (when no modal is open) - avoid system conflicts
      if (!$('.modal.in').length) {
        if (e.altKey && e.keyCode === 78) { // Alt+N: New Product (avoid Ctrl+N conflict)
          e.preventDefault();
          $('#newProductModal').click();
        }
        if (e.altKey && e.keyCode === 67) { // Alt+C: New Category (avoid Ctrl+C conflict)
          e.preventDefault();
          $('#newCategoryModal').click();
        }
        if (e.altKey && e.keyCode === 77) { // Alt+M: New Manufacturer (avoid Ctrl+M conflict)
          e.preventDefault();
          $('#newManufacturerModal').click();
        }
        if (e.altKey && e.keyCode === 83) { // Alt+S: New Supplier (avoid Ctrl+S conflict)
          e.preventDefault();
          $('#newSupplierModal').click();
        }
        if (e.altKey && e.keyCode === 85) { // Alt+U: New User
          e.preventDefault();
          $('#add-user').click();
        }
        if (e.altKey && e.keyCode === 79) { // Alt+O: New Customer
          e.preventDefault();
          $('#newCustomerModal').click();
        }
        if (e.altKey && e.keyCode === 80) { // Alt+P: Point of Sale
          e.preventDefault();
          $('#pointofsale').click();
        }
        if (e.altKey && e.keyCode === 84) { // Alt+T: Transactions
          e.preventDefault();
          $('#transactions').click();
        }
      }
      
      // Form submission shortcuts
      if (e.keyCode === 13) { // Enter: Submit Form
        if (e.ctrlKey) {
          // Ctrl+Enter: Submit Modal
          e.preventDefault();
          const activeModal = $('.modal.in');
          if (activeModal.length > 0) {
            const submitBtn = activeModal.find('button[type="submit"], .btn-primary');
            if (submitBtn.length > 0) {
              submitBtn.click();
            }
          }
        }
        // Regular Enter handling is already implemented in forms
      }
      
      // Modal close shortcut
      if (e.keyCode === 27) { // Escape: Close Modal
        const activeModal = $('.modal.in');
        if (activeModal.length > 0) {
          activeModal.modal('hide');
        }
      }
      
      // Search and utility shortcuts - avoid system conflicts
      if (e.altKey && e.keyCode === 70) { // Alt+F: Find/Search (avoid Ctrl+F conflict)
        e.preventDefault();
        const activeModal = $('.modal.in');
        if (activeModal.length > 0) {
          // Focus on search field in active modal
          const searchField = activeModal.find('input[type="search"], input[placeholder*="search"], input[placeholder*="Search"]');
          if (searchField.length > 0) {
            searchField.focus();
          }
        } else {
          // Focus on main search field
          const mainSearch = $('input[type="search"], input[placeholder*="search"], input[placeholder*="Search"]').first();
          if (mainSearch.length > 0) {
            mainSearch.focus();
          }
        }
      }
      
      if (e.altKey && e.keyCode === 82) { // Alt+R: Refresh (avoid Ctrl+R conflict)
        e.preventDefault();
        // Refresh current data based on active modal
        const activeModal = $('.modal.in');
        if (activeModal.length > 0) {
          const modalId = activeModal.attr('id');
          switch(modalId) {
            case 'Products':
              loadProducts();
              break;
            case 'Categories':
              loadCategories();
              break;
            case 'Users':
              // Assuming there's a loadUsers function
              if (typeof loadUsers === 'function') {
                loadUsers();
              }
              break;
            default:
              // General refresh
              location.reload();
          }
        } else {
          // No modal open, refresh page
          location.reload();
        }
      }
      
      // Data operation shortcuts - avoid system conflicts
      if (e.altKey && e.keyCode === 83) { // Alt+S: Save/Submit (avoid Ctrl+S conflict)
        e.preventDefault();
        const activeModal = $('.modal.in');
        if (activeModal.length > 0) {
          const submitBtn = activeModal.find('button[type="submit"], .btn-success, .btn-primary');
          if (submitBtn.length > 0) {
            submitBtn.click();
          }
        }
      }
      
      if (e.altKey && e.keyCode === 69) { // Alt+E: Edit (avoid Ctrl+E conflict)
        e.preventDefault();
        const activeModal = $('.modal.in');
        if (activeModal.length > 0) {
          const editBtn = activeModal.find('.btn-warning, .btn-edit, [title*="Edit"]');
          if (editBtn.length > 0) {
            editBtn.first().click();
          }
        }
      }
      
      // Table operation shortcuts - avoid system conflicts
      if (e.altKey && e.keyCode === 65) { // Alt+A: Select All in tables (avoid Ctrl+A conflict)
        e.preventDefault();
        const activeTable = $('.table:focus, .dataTable:focus');
        if (activeTable.length > 0) {
          activeTable.find('input[type="checkbox"]').prop('checked', true);
        }
      }
      
      if (e.altKey && e.keyCode === 68) { // Alt+D: Deselect All in tables
        e.preventDefault();
        const activeTable2 = $('.table:focus, .dataTable:focus');
        if (activeTable2.length > 0) {
          activeTable2.find('input[type="checkbox"]').prop('checked', false);
        }
      }
      
      // Help shortcut
      if (e.altKey && e.keyCode === 72) { // Alt+H: Help/Keyboard Shortcuts (avoid Ctrl+H conflict)
        e.preventDefault();
        showKeyboardShortcuts();
      }
      
      // Logout shortcut
      if (e.altKey && e.keyCode === 76) { // Alt+L: Logout (avoid Ctrl+L conflict)
        e.preventDefault();
        $('#log-out').click();
      }
    });
    
    // Function to show keyboard shortcuts help
    function showKeyboardShortcuts() {
      const shortcuts = `
        <div class="modal fade" id="keyboardShortcutsModal" tabindex="-1" role="dialog">
          <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
              <div class="modal-header">
                <h4 class="modal-title">PharmaSpot Keyboard Shortcuts Reference</h4>
                <button type="button" class="close" data-dismiss="modal">&times;</button>
              </div>
              <div class="modal-body">
                <div class="row">
                  <div class="col-md-6">
                    <h5>Navigation</h5>
                    <ul class="list-unstyled">
                      <li><kbd>Ctrl+1</kbd> Products</li>
                      <li><kbd>Ctrl+2</kbd> Categories</li>
                      <li><kbd>Ctrl+3</kbd> Manufacturers</li>
                      <li><kbd>Ctrl+4</kbd> Suppliers</li>
                      <li><kbd>Ctrl+5</kbd> Transactions</li>
                      <li><kbd>Ctrl+6</kbd> Settings</li>
                      <li><kbd>Ctrl+7</kbd> Users</li>
                      <li><kbd>Ctrl+8</kbd> Point of Sale</li>
                      <li><kbd>Ctrl+9</kbd> Open Tabs</li>
                      <li><kbd>Ctrl+0</kbd> Orders</li>
                    </ul>
                  </div>
                  <div class="col-md-6">
                    <h5>Actions</h5>
                    <ul class="list-unstyled">
                      <li><kbd>Ctrl+9</kbd> Bulk Import</li>
                      <li><kbd>Alt+0</kbd> Bulk Remove</li>
                      <li><kbd>Alt+N</kbd> New Product</li>
                      <li><kbd>Alt+C</kbd> New Category</li>
                      <li><kbd>Alt+M</kbd> New Manufacturer</li>
                      <li><kbd>Alt+S</kbd> New Supplier</li>
                      <li><kbd>Alt+U</kbd> New User</li>
                      <li><kbd>Alt+O</kbd> New Customer</li>
                      <li><kbd>Alt+P</kbd> Point of Sale</li>
                      <li><kbd>Alt+T</kbd> Transactions</li>
                      <li><kbd>Alt+L</kbd> Logout</li>
                    </ul>
                  </div>
                </div>
                <div class="row mt-3">
                  <div class="col-md-6">
                    <h5>Quick Actions</h5>
                    <ul class="list-unstyled">
                      <li><kbd>Alt+I</kbd> Quick Inventory Menu</li>
                      <li><kbd>Alt+S</kbd> Quick Search</li>
                      <li><kbd>Alt+N</kbd> Quick New Item</li>
                      <li><kbd>Alt+C</kbd> Quick Close Modal</li>
                      <li><kbd>Alt+1-6</kbd> Quick Section Jump</li>
                    </ul>
                  </div>
                  <div class="col-md-6">
                    <h5>POS (Point of Sale)</h5>
                    <ul class="list-unstyled">
                      <li><kbd>Alt+P</kbd> Open POS</li>
                      <li><kbd>Alt+Q</kbd> Quick Product Search</li>
                      <li><kbd>Alt+C</kbd> Clear Cart</li>
                      <li><kbd>Alt+H</kbd> Hold Order</li>
                      <li><kbd>Alt+N</kbd> New Transaction</li>
                    </ul>
                  </div>
                </div>
                <div class="row mt-3">
                  <div class="col-md-6">
                    <h5>POS Product Navigation</h5>
                    <ul class="list-unstyled">
                      <li><kbd>Arrow Keys</kbd> Navigate Product Grid</li>
                      <li><kbd>Enter/Space</kbd> Add to Cart</li>
                      <li><kbd>Alt+1-5</kbd> Filter by Category</li>
                      <li><kbd>Tab</kbd> Move Between Products</li>
                    </ul>
                  </div>
                  <div class="col-md-6">
                    <h5>POS Cart Management</h5>
                    <ul class="list-unstyled">
                      <li><kbd>↑↓</kbd> Navigate Cart Items</li>
                      <li><kbd>←→</kbd> Navigate Item Fields</li>
                      <li><kbd>↑↓</kbd> Change Quantity</li>
                      <li><kbd>Delete</kbd> Remove Item</li>
                      <li><kbd>Enter</kbd> Edit Quantity</li>
                    </ul>
                  </div>
                </div>
                <div class="row mt-3">
                  <div class="col-md-6">
                    <h5>POS Payment</h5>
                    <ul class="list-unstyled">
                      <li><kbd>1</kbd> Cash Payment</li>
                      <li><kbd>2</kbd> Card Payment</li>
                      <li><kbd>C</kbd> Calculate Change</li>
                      <li><kbd>P</kbd> Process Payment</li>
                      <li><kbd>H</kbd> Hold Order</li>
                    </ul>
                  </div>
                  <div class="col-md-6">
                    <h5>POS Button Shortcuts</h5>
                    <ul class="list-unstyled">
                      <li><kbd>F1</kbd> Pay Button</li>
                      <li><kbd>F2</kbd> Hold Button</li>
                      <li><kbd>F3</kbd> Cancel/Clear Cart</li>
                      <li><kbd>F5</kbd> Dismiss All Alerts</li>
                      <li><kbd>F6</kbd> Create Test Transaction (Debug)</li>
                      <li><kbd>F7</kbd> Refresh Transactions (Transactions View)</li>
                      <li><kbd>Enter</kbd> Confirm Actions</li>
                    </ul>
                  </div>
                </div>
                <div class="row mt-3">
                  <div class="col-md-6">
                    <h5>POS Form Navigation</h5>
                    <ul class="list-unstyled">
                      <li><kbd>Enter</kbd> Next Field / Submit</li>
                      <li><kbd>Shift+Enter</kbd> Previous Field</li>
                      <li><kbd>Tab</kbd> Next Field</li>
                      <li><kbd>Shift+Tab</kbd> Previous Field</li>
                    </ul>
                  </div>
                </div>
                <div class="row mt-3">
                  <div class="col-md-6">
                    <h5>Data Operations</h5>
                    <ul class="list-unstyled">
                      <li><kbd>Alt+S</kbd> Save/Submit</li>
                      <li><kbd>Alt+E</kbd> Edit</li>
                      <li><kbd>Alt+F</kbd> Find/Search</li>
                      <li><kbd>Alt+R</kbd> Refresh</li>
                      <li><kbd>Alt+H</kbd> This Help</li>
                    </ul>
                  </div>
                  <div class="col-md-6">
                    <h5>Form Navigation</h5>
                    <ul class="list-unstyled">
                      <li><kbd>Tab</kbd> Next Field</li>
                      <li><kbd>Shift+Tab</kbd> Previous Field</li>
                      <li><kbd>Enter</kbd> Next Field / Submit</li>
                      <li><kbd>Shift+Enter</kbd> Previous Field</li>
                      <li><kbd>Escape</kbd> Close Modal</li>
                    </ul>
                  </div>
                </div>
                <div class="row mt-3">
                  <div class="col-md-6">
                    <h5>Table Operations</h5>
                    <ul class="list-unstyled">
                      <li><kbd>Click</kbd> Select Row</li>
                      <li><kbd>Double-Click</kbd> Edit Row</li>
                      <li><kbd>Alt+A</kbd> Select All</li>
                      <li><kbd>Alt+D</kbd> Deselect All</li>
                      <li><kbd>Arrow Keys</kbd> Navigate Cells</li>
                      <li><kbd>Space</kbd> Toggle Checkbox</li>
                    </ul>
                  </div>
                  <div class="col-md-6">
                    <h5>Auto-Complete</h5>
                    <ul class="list-unstyled">
                      <li><kbd>Type</kbd> Show Suggestions</li>
                      <li><kbd>↑↓</kbd> Navigate Suggestions</li>
                      <li><kbd>Enter</kbd> Select Suggestion</li>
                      <li><kbd>Escape</kbd> Close Suggestions</li>
                    </ul>
                  </div>
                </div>
                <div class="row mt-3">
                  <div class="col-md-6">
                    <h5>System Reserved (Do Not Use)</h5>
                    <ul class="list-unstyled text-muted">
                      <li><kbd>Ctrl+0</kbd> Actual Size</li>
                      <li><kbd>Ctrl+C</kbd> Copy</li>
                      <li><kbd>Ctrl+V</kbd> Paste</li>
                      <li><kbd>Ctrl+X</kbd> Cut</li>
                      <li><kbd>Ctrl+Z</kbd> Undo</li>
                      <li><kbd>Ctrl+Y</kbd> Redo</li>
                      <li><kbd>Ctrl+A</kbd> Select All</li>
                      <li><kbd>Delete</kbd> Delete</li>
                    </ul>
                  </div>
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
                <button type="button" class="btn btn-primary" onclick="window.print()">Print</button>
              </div>
            </div>
          </div>
        </div>
      `;
      
      // Remove existing modal if present
      $('#keyboardShortcutsModal').remove();
      
      // Add new modal to body
      $('body').append(shortcuts);
      
      // Show the modal
      $('#keyboardShortcutsModal').modal('show');
    }
    
    // Add click event for keyboard help button
    $(document).on('click', '#keyboardHelp', function() {
      showKeyboardShortcuts();
    });

    if (settings && validator.unescape(settings.symbol)) {
      $("#price_curr, #payment_curr, #change_curr").text(validator.unescape(settings.symbol));
    }

    setTimeout(function () {
      if (settings == undefined && auth != undefined) {
        $("#settingsModal").modal("show");
      } else {
        vat = parseFloat(validator.unescape(settings.percentage));
        $("#taxInfo").text(settings.charge_tax ? vat : 0);
      }
    }, 1500);

    $("#settingsModal").on("hide.bs.modal", function () {
      setTimeout(function () {
        if (settings == undefined && auth != undefined) {
          $("#settingsModal").modal("show");
        }
      }, 1000);
    });

    if (0 == user.perm_categories) {
      $(".p_two").hide();
    }
    if (0 == user.perm_manufacturers) {
      $(".p_manufacturers").hide();
    }
    if (0 == user.perm_suppliers) {
      $(".p_suppliers").hide();
    }
    if (0 == user.perm_transactions) {
      $(".p_three").hide();
    }
    if (0 == user.perm_users) {
      $(".p_four").hide();
    }
    if (0 == user.perm_settings) {
      $(".p_five").hide();
    }
    if (0 == user.perm_products) {
      $(".p_one").hide();
    }

    function loadProducts() {
      $.get(api + "inventory/products", function (data) {
        data.forEach((item) => {
          item.price = parseFloat(item.price).toFixed(2);
        });

        allProducts = [...data];

        // Update loss tiles immediately after products load
        try {
          let lossPartialExpiry = 0;
          let lossTotalExpired = 0;
          let expiredWithCost = 0;
          let expiredWithoutCost = 0;
          let nearWithCost = 0;
          let nearWithoutCost = 0;
          allProducts.forEach((p) => {
            const qty = parseInt(p.quantity || 0);
            const cost = parseFloat(p.actualPrice || p.purchasePrice || p.buy_price || p.buyPrice || 0);
            const hasCost = !(isNaN(cost) || cost <= 0);
            const isExp = isExpired(p.expirationDate);
            if (isExp) {
              if (qty > 0 && hasCost) {
                lossTotalExpired += qty * cost;
                expiredWithCost++;
              } else if (qty > 0 && !hasCost) {
                expiredWithoutCost++;
              }
              return;
            }
            const days = daysToExpire(p.expirationDate);
            if (days > 0 && days <= 90) {
              if (qty > 0 && hasCost) {
                lossPartialExpiry += 0.5 * qty * cost;
                nearWithCost++;
              } else if (qty > 0 && !hasCost) {
                nearWithoutCost++;
              }
            }
          });

          const overallLoss = lossPartialExpiry + lossTotalExpired;
          const profitText = $("#total_profit #counter").text() || "0";
          const numericProfit = parseFloat((profitText || "0").replace(/[^0-9.\-]/g, "")) || 0;
          const netProfit = numericProfit - overallLoss;

          $("#loss_partial_expiry #counter").text(validator.unescape(settings.symbol) + moneyFormat(lossPartialExpiry.toFixed(2)));
          $("#loss_total_expired #counter").text(validator.unescape(settings.symbol) + moneyFormat(lossTotalExpired.toFixed(2)));
          $("#loss_overall #counter").text(validator.unescape(settings.symbol) + moneyFormat(overallLoss.toFixed(2)));
          $("#net_profit #counter").text(validator.unescape(settings.symbol) + moneyFormat(netProfit.toFixed(2)));

          if ((expiredWithCost + nearWithCost) === 0 && (expiredWithoutCost + nearWithoutCost) > 0) {
            notiflix.Notify.info('Expired/near-expiry items found but no cost set. Set Purchase Price to see losses.');
          }
        } catch (e) { }

        loadProductList();

        let delay = 0;
        let expiredCount = 0;
        allProducts.forEach((product) => {
          let todayDate = moment();
          let expiryDate = moment(product.expirationDate, DATE_FORMAT);

          if (!isExpired(expiryDate)) {
            const diffDays = daysToExpire(expiryDate);

            if (diffDays > 0 && diffDays <= 30) {
              var days_noun = diffDays > 1 ? "days" : "day";
              notiflix.Notify.warning(
                `${product.name} has only ${diffDays} ${days_noun} left to expiry`,
              );
            }
          } else {
            expiredCount++;
          }
        });

        //Show notification if there are any expired goods.
        if(expiredCount>0)
        {
           notiflix.Notify.failure(
          `${expiredCount} ${
            expiredCount > 0 ? "products" : "product"
          } expired. Please restock!`,
        );
        }

       
        $("#parent").text("");

        data.forEach((item) => {
          if (!categories.includes(item.category)) {
            categories.push(item.category);
          }
          let item_isExpired = isExpired(item.expirationDate);
          let item_stockStatus = getStockStatus(item.quantity,item.minStock);
          if(item.img==="")
          {
            item_img = default_item_img;
          }
          else
          {
            item_img = path.join(img_path, item.img);
            item_img = checkFileExists(item_img) ? item_img : default_item_img;
          }
          

          let item_info = `<div class="col-lg-2 box ${item.category}"
                                onclick="$(this).addToCart(${item._id}, ${
                                  item.quantity
                                }, ${item.stock})">
                            <div class="widget-panel widget-style-2 " title="${item.name}">                    
                            <div id="image"><img src="${item_img}" id="product_img" alt=""></div>                    
                                        <div class="text-muted m-t-5 text-center">
                                        <div class="name" id="product_name">
                                          <span class="${
                                          item_isExpired ? "text-danger" : ""
                                          }">${item.name}</span>
                                          ${item.manufacturer ? `<div><small class="text-success"><i class="fa fa-industry"></i> ${item.manufacturer}</small></div>` : ""}
                                          ${item.supplier ? `<div><small class="text-info"><i class="fa fa-truck"></i> ${item.supplier}</small></div>` : ""}
                                          ${item.genericName ? `<div><small class="text-muted">Generic: ${item.genericName}</small></div>` : ""}
                                        </div> 
                                        <span class="sku">${
                                          item.barcode || item._id
                                        }</span>
                                        <span class="${item_stockStatus<1?'text-danger':''}"><span class="stock">STOCK </span><span class="count">${
                                          item.stock == 1
                                            ? item.quantity
                                            : "N/A"
                                        }</span></span></div>
                                        <span class="text-success text-center"><b data-plugin="counterup">${
                                          validator.unescape(settings.symbol) +
                                          moneyFormat(item.price)
                                        }</b> </span>
                            </div>
                        </div>`;
          $("#parent").append(item_info);
        });
        
        // Update product count display after products are loaded
        if ($("#productCount").length) {
          if (data.length === 0) {
            $("#productCount").text("No products");
          } else {
            $("#productCount").text(`${data.length} of ${data.length} products`);
          }
        }
        
        // Now that products are fully rendered, initialize the filter system
        if (typeof filterProducts === 'function') {
          // Small delay to ensure DOM is fully ready
          setTimeout(() => {
            filterProducts();
          }, 100);
        }
      });
    }

    function loadCategories() {
      $.get(api + "categories/all?_t=" + Date.now(), function (data) {
        allCategories = data;
        loadCategoryList();
        $("#category,#categories").html(`<option value="0">Select</option>`);
        allCategories.forEach((category) => {
          $("#category,#categories").append(
            `<option value="${category._id}">${category.name}</option>`,
          );
        });
        
        // Also populate the defaultCategory dropdown in bulk import form
        $("#defaultCategory").html(`<option value="">Select Default Category</option>`);
        allCategories.forEach((category) => {
          $("#defaultCategory").append(
            `<option value="${category._id}">${category.name}</option>`,
          );
        });
      });
    }

    function loadCustomers() {
      $.get(api + "customers/all", function (customers) {
        $("#customer").html(
          `<option value="0" selected="selected">Walk in customer</option>`,
        );

        customers.forEach((cust) => {
          let customer = `<option value='{"id": ${cust._id}, "name": "${cust.name}"}'>${cust.name}</option>`;
          $("#customer").append(customer);
        });
      });
    }

    $.fn.addToCart = function (id, count, stock) {
      $.get(api + "inventory/product/" + id, function (product) {
        if (isExpired(product.expirationDate)) {
          notiflix.Report.failure(
            "Expired",
            `${product.name} is expired! Please restock.`,
            "Ok",
          );
        } else {
          if (count > 0) {
            $(this).addProductToCart(product);
          } else {
            if (stock == 1) {
              notiflix.Report.failure(
                "Out of stock!",
                `${product.name} is out of stock! Please restock.`,
                "Ok",
              );
            }
          }
        }
      });
    };

    function barcodeSearch(e) {
      e.preventDefault();
      let searchBarCodeIcon = $(".search-barcode-btn").html();
      $(".search-barcode-btn").empty();
      $(".search-barcode-btn").append(
        $("<i>", { class: "fa fa-spinner fa-spin" }),
      );

      let req = {
        skuCode: $("#skuCode").val(),
      };

      $.ajax({
        url: api + "inventory/product/sku",
        type: "POST",
        data: JSON.stringify(req),
        contentType: "application/json; charset=utf-8",
        cache: false,
        processData: false,
        success: function (product) {
          $(".search-barcode-btn").html(searchBarCodeIcon);
          const expired = isExpired(product.expirationDate);
          if (product._id != undefined && product.quantity >= 1 && !expired) {
            $(this).addProductToCart(product);
            $("#searchBarCode").get(0).reset();
            $("#basic-addon2").empty();
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-ok" }),
            );
            // Refocus barcode input after successful product addition
            setTimeout(() => {
              autoFocusBarcodeInput();
            }, 100);
          } else if (expired) {
            notiflix.Report.failure(
              "Expired!",
              `${product.name} is expired`,
              "Ok",
            );
          } else if (product.quantity < 1) {
            notiflix.Report.info(
              "Out of stock!",
              "This item is currently unavailable",
              "Ok",
            );
          } else {
            notiflix.Report.warning(
              "Not Found!",
              "<b>" + $("#skuCode").val() + "</b> is not a valid barcode!",
              "Ok",
            );

            $("#searchBarCode").get(0).reset();
            $("#basic-addon2").empty();
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-ok" }),
            );
            // Refocus barcode input after error
            setTimeout(() => {
              autoFocusBarcodeInput();
            }, 100);
          }
        },
        error: function (err) {
          if (err.status === 422) {
            $(this).showValidationError(data);
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-remove" }),
            );
          } else if (err.status === 404) {
            $("#basic-addon2").empty();
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-remove" }),
            );
          } else {
            $(this).showServerError();
            $("#basic-addon2").empty();
            $("#basic-addon2").append(
              $("<i>", { class: "glyphicon glyphicon-warning-sign" }),
            );
          }
        },
      });
    }

    $("#searchBarCode").on("submit", function (e) {
      barcodeSearch(e);
    });

    $("body").on("click", "#jq-keyboard button", function (e) {
      let pressed = $(this)[0].className.split(" ");
      if ($("#skuCode").val() != "" && pressed[2] == "enter") {
        barcodeSearch(e);
      }
    });

    $.fn.addProductToCart = function (data) {
      item = {
        id: data._id,
        product_name: data.name,
        sku: data.sku,
        price: data.price,
        quantity: 1,
        purchasePrice: data.actualPrice || "",
        genericName: data.genericName || "",
        manufacturer: data.manufacturer || "",
        supplier: data.supplier || "",
        batchNumber: data.batchNumber || "",
      };

      if ($(this).isExist(item)) {
        $(this).qtIncrement(index);
      } else {
        cart.push(item);
        $(this).renderTable(cart);
      }
    };

    $.fn.isExist = function (data) {
      let toReturn = false;
      $.each(cart, function (index, value) {
        if (value.id == data.id) {
          $(this).setIndex(index);
          toReturn = true;
        }
      });
      return toReturn;
    };

    $.fn.setIndex = function (value) {
      index = value;
    };

    $.fn.calculateCart = function () {
      let total = 0;
      let grossTotal;
      let total_items = 0;
      $.each(cart, function (index, data) {
        total += data.quantity * data.price;
        total_items += parseInt(data.quantity);
      });
      $("#total").text(total_items);
      total = total - $("#inputDiscount").val();
      $("#price").text(validator.unescape(settings.symbol) + moneyFormat(total.toFixed(2)));

      subTotal = total;

      if ($("#inputDiscount").val() >= total) {
        $("#inputDiscount").val(0);
      }

      if (settings.charge_tax) {
        totalVat = (total * vat) / 100;
        grossTotal = total + totalVat;
      } else {
        grossTotal = total;
      }

      orderTotal = grossTotal.toFixed(2);

      $("#gross_price").text(validator.unescape(settings.symbol) + moneyFormat(orderTotal));
      $("#payablePrice").val(moneyFormat(grossTotal));
    };

    $.fn.renderTable = function (cartList) {
      $("#cartTable .card-body").empty();
      $(this).calculateCart();
      $.each(cartList, function (index, data) {
        $("#cartTable .card-body").append(
          $("<div>", { class: "row m-t-10" }).append(
            $("<div>", { class: "col-md-1", text: index + 1 }),
            $("<div>", { class: "col-md-3", text: data.product_name }),
            $("<div>", { class: "col-md-3" }).append(
              $("<div>", { class: "input-group" }).append(
                $("<span>", { class: "input-group-btn" }).append(
                  $("<button>", {
                    class: "btn btn-light",
                    onclick: "$(this).qtDecrement(" + index + ")",
                  }).append($("<i>", { class: "fa fa-minus" })),
                ),
                $("<input>", {
                  class: "form-control quantity-input",
                  type: "number",
                  value: data.quantity,
                  min: "1",
                  max: "999",
                  "data-index": index,
                  placeholder: "Qty",
                  onInput: "$(this).qtInput(" + index + ")",
                  onKeyDown: "$(this).handleQuantityKeyDown(event, " + index + ")",
                  onFocus: "$(this).select()",
                  onChange: "$(this).qtInputComplete(" + index + ")",
                  onContextMenu: "$(this).showQuantityContextMenu(event, " + index + ")",
                  title: "Tab/Enter: Next product • Shift+Tab: Previous product • Ctrl+Tab: Next product • Esc: Cancel • Right-click: Options",
                }),
                $("<span>", { class: "input-group-btn" }).append(
                  $("<button>", {
                    class: "btn btn-light",
                    onclick: "$(this).qtIncrement(" + index + ")",
                  }).append($("<i>", { class: "fa fa-plus" })),
                ),
              ),
            ),
            $("<div>", {
              class: "col-md-3",
              text:
                validator.unescape(settings.symbol) +
                moneyFormat((data.price * data.quantity).toFixed(2)),
            }),
            $("<div>", { class: "col-md-1" }).append(
              $("<button>", {
                class: "btn btn-light btn-xs",
                onclick: "$(this).deleteFromCart(" + index + ")",
              }).append($("<i>", { class: "fa fa-times" })),
            ),
          ),
        );
      });
      
      // Auto-scroll to the latest added product (last item in cart)
      if (cartList.length > 0) {
        const cartContainer = $("#cartTable .card-body");
        const lastItem = cartContainer.find(".row:last");
        
        // Debug: Log cart structure
        console.log(`Cart rendered: ${cartList.length} items`);
        console.log(`Cart container found: ${cartContainer.length}`);
        console.log(`Cart rows found: ${cartContainer.find('.row').length}`);
        console.log(`Last item found: ${lastItem.length}`);
        
        if (lastItem.length > 0) {
          // Ensure the cart container is scrollable
          if (cartContainer.height() > 300) {
            // Smooth scroll to the latest item with offset for better visibility
            cartContainer.animate({
              scrollTop: lastItem.offset().top - cartContainer.offset().top + cartContainer.scrollTop() - 80
            }, 400);
          }
          
          // Highlight the latest item briefly with enhanced visual feedback
          lastItem.addClass("highlight-new-item");
          
          // Add a subtle pulse effect
          lastItem.css('animation', 'pulse-highlight 0.6s ease-in-out');
          
          setTimeout(() => {
            lastItem.removeClass("highlight-new-item");
            lastItem.css('animation', '');
          }, 2500);
        }
      }
    };

    $.fn.deleteFromCart = function (index) {
      cart.splice(index, 1);
      $(this).renderTable(cart);
    };

    $.fn.qtIncrement = function (i) {
      item = cart[i];
      let product = allProducts.filter(function (selected) {
        return selected._id == parseInt(item.id);
      });

      if (product[0].stock == 1) {
        if (item.quantity < product[0].quantity) {
          item.quantity = parseInt(item.quantity) + 1;
          $(this).renderTable(cart);
        } else {
          notiflix.Report.info(
            "No more stock!",
            "You have already added all the available stock.",
            "Ok",
          );
        }
      } else {
        item.quantity = parseInt(item.quantity) + 1;
        $(this).renderTable(cart);
      }
    };

    $.fn.qtDecrement = function (i) {
      if (item.quantity > 1) {
        item = cart[i];
        item.quantity = parseInt(item.quantity) - 1;
        $(this).renderTable(cart);
      }
    };

    $.fn.qtInput = function (i) {
      // Don't update cart immediately - just store the current input value
      // This allows users to type multi-digit numbers without losing focus
      const input = $(this);
      const currentValue = input.val();
      
      // Add visual feedback that user is typing
      input.addClass('typing');
      
      // Store the current input value in the cart item temporarily
      // but don't render the table yet
      if (cart[i]) {
        cart[i].tempQuantity = currentValue;
      }
    };
    
    // New function to handle when user finishes editing quantity
    $.fn.qtInputComplete = function (i) {
      const input = $(this);
      let newQuantity = parseInt(input.val()) || 1;
      
      // Remove typing visual feedback
      input.removeClass('typing');
      
      // Validate quantity
      if (newQuantity < 1) {
        newQuantity = 1;
        input.val(1);
      }
      
      // Check stock limit
      let product = allProducts.filter(function (selected) {
        return selected._id == parseInt(cart[i].id);
      });
      
      if (product[0] && product[0].stock == 1) {
        if (newQuantity > product[0].quantity) {
          newQuantity = product[0].quantity;
          input.val(newQuantity);
          notiflix.Report.info(
            "Stock Limit!",
            `Maximum available stock: ${product[0].quantity}`,
            "Ok",
          );
        }
      }
      
      // Update the actual cart item
      cart[i].quantity = newQuantity;
      delete cart[i].tempQuantity; // Clean up temporary value
      
      // Now render the table to update totals
      $(this).renderTable(cart);
      
      // Don't blur the input - let user stay in the field
      // User can manually click outside or use shortcuts to move away
    };
    
    // Move to next product row in cart
    $.fn.moveToNextProduct = function (currentIndex) {
      const cartRows = $("#cartTable .card-body .row");
      const nextIndex = currentIndex + 1;
      
      console.log(`Moving to next product: currentIndex=${currentIndex}, nextIndex=${nextIndex}, totalRows=${cartRows.length}`);
      
      if (nextIndex < cartRows.length) {
        // Move to next product row
        const nextRow = cartRows.eq(nextIndex);
        const nextQuantityInput = nextRow.find('.quantity-input');
        if (nextQuantityInput.length) {
          console.log(`Focusing next quantity input at index ${nextIndex}`);
          // Ensure the input is visible and focusable
          nextQuantityInput[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Focus and select with a small delay to ensure DOM is ready
          setTimeout(() => {
            nextQuantityInput.focus().select();
          }, 10);
        } else {
          console.log(`No quantity input found in next row at index ${nextIndex}`);
        }
      } else {
        // At last product, move to checkout buttons
        console.log('At last product, moving to checkout buttons');
        const checkoutButtons = $("#pos_view .btn-success, #pos_view .btn-primary").first();
        if (checkoutButtons.length) {
          checkoutButtons.focus();
        }
      }
    };
    
    // Move to previous product row in cart
    $.fn.moveToPreviousProduct = function (currentIndex) {
      const cartRows = $("#cartTable .card-body .row");
      const prevIndex = currentIndex - 1;
      
      console.log(`Moving to previous product: currentIndex=${currentIndex}, prevIndex=${prevIndex}, totalRows=${cartRows.length}`);
      
      if (prevIndex >= 0) {
        // Move to previous product row
        const prevRow = cartRows.eq(prevIndex);
        const prevQuantityInput = prevRow.find('.quantity-input');
        if (prevQuantityInput.length) {
          console.log(`Focusing previous quantity input at index ${prevIndex}`);
          // Ensure the input is visible and focusable
          prevQuantityInput[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Focus and select with a small delay to ensure DOM is ready
          setTimeout(() => {
            prevQuantityInput.focus().select();
          }, 10);
        } else {
          console.log(`No quantity input found in previous row at index ${prevIndex}`);
        }
      } else {
        // At first product, move to customer field or barcode input
        console.log('At first product, moving to customer field');
        const customerField = $("#customer");
        if (customerField.length) {
          customerField.focus();
        }
      }
    };
    
    // Show context menu for quantity input
    $.fn.showQuantityContextMenu = function (event, index) {
      event.preventDefault();
      
      const input = $(event.target);
      const currentValue = input.val();
      
      // Create context menu
      const contextMenu = $(`
        <div class="quantity-context-menu" style="
          position: absolute;
          background: white;
          border: 1px solid #ddd;
          border-radius: 4px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          z-index: 1000;
          min-width: 150px;
          padding: 5px 0;
        ">
          <div class="context-item" data-action="complete" style="
            padding: 8px 15px;
            cursor: pointer;
            border-bottom: 1px solid #eee;
          ">✓ Complete & Stay</div>
          <div class="context-item" data-action="next" style="
            padding: 8px 15px;
            cursor: pointer;
            border-bottom: 1px solid #eee;
          ">→ Complete & Next Product</div>
          <div class="context-item" data-action="cancel" style="
            padding: 8px 15px;
            cursor: pointer;
          ">✗ Cancel Changes</div>
        </div>
      `);
      
      // Position the menu
      const inputOffset = input.offset();
      contextMenu.css({
        left: inputOffset.left + input.outerWidth() + 5,
        top: inputOffset.top
      });
      
      // Add to body
      $('body').append(contextMenu);
      
      // Handle menu clicks
      contextMenu.on('click', '.context-item', function() {
        const action = $(this).data('action');
        
        switch(action) {
          case 'complete':
            // Complete input and stay in field
            input.qtInputComplete(index);
            input.focus();
            break;
          case 'next':
            // Complete input and move to next field
            input.qtInputComplete(index);
            const nextInput = input.closest('.row').find('input, select, button').not(input).first();
            if (nextInput.length) {
              nextInput.focus();
            }
            break;
          case 'cancel':
            // Restore original value
            input.val(cart[index].quantity);
            input.removeClass('typing');
            break;
        }
        
        // Remove menu
        contextMenu.remove();
      });
      
      // Remove menu when clicking outside
      $(document).one('click', function() {
        contextMenu.remove();
      });
    };
    
    // Handle keyboard shortcuts for quantity input
    $.fn.handleQuantityKeyDown = function (event, index) {
      const key = event.key;
      const input = $(event.target);
      
      // Debug: Log all key events to see what's being captured
      console.log(`Key pressed: "${key}", Shift: ${event.shiftKey}, Ctrl: ${event.ctrlKey}, Alt: ${event.altKey}`);
      
      // Check for Shift+Tab combination first
      if (event.shiftKey && key === 'Tab') {
        event.preventDefault();
        // Complete input and move to previous product row
        console.log(`Shift+Tab pressed for index: ${index}`);
        $(this).qtInputComplete(index);
        // Add small delay to ensure DOM is updated before navigation
        setTimeout(() => {
          $(this).moveToPreviousProduct(index);
        }, 50);
        return;
      }
      
      // Check for Ctrl+Tab combination
      if (event.ctrlKey && key === 'Tab') {
        event.preventDefault();
        // Complete input and move to next product row
        console.log(`Ctrl+Tab pressed for index: ${index}`);
        $(this).qtInputComplete(index);
        // Add small delay to ensure DOM is updated before navigation
        setTimeout(() => {
          $(this).moveToNextProduct(index);
        }, 50);
        return;
      }
      
      // Handle single keys
      switch (key) {
        case 'Enter':
          event.preventDefault();
          // Complete input and move to next product row (or checkout if at last)
          console.log(`Enter pressed for index: ${index}`);
          $(this).qtInputComplete(index);
          // Add small delay to ensure DOM is updated before navigation
          setTimeout(() => {
            $(this).moveToNextProduct(index);
          }, 50);
          break;
        case 'Tab':
          event.preventDefault();
          // Complete input and move to next product row (or checkout if at last)
          console.log(`Tab pressed for index: ${index}`);
          $(this).qtInputComplete(index);
          // Add small delay to ensure DOM is updated before navigation
          setTimeout(() => {
            $(this).moveToNextProduct(index);
          }, 50);
          break;
        case 'Escape':
          event.preventDefault();
          // Restore original value and blur
          input.val(cart[index].quantity);
          input.blur();
          break;
        case 'ArrowUp':
          event.preventDefault();
          $(this).qtIncrement(index);
          break;
        case 'ArrowDown':
          event.preventDefault();
          $(this).qtDecrement(index);
          break;
        default:
          // Allow number input and navigation keys
          if (!/[\d]/.test(key) && !['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight'].includes(key)) {
            event.preventDefault();
          }
      }
    };

    $.fn.cancelOrder = function () {
      if (cart.length > 0) {
        const diagOptions = {
          title: "Are you sure?",
          text: "You are about to remove all items from the cart.",
          icon: "warning",
          showCancelButton: true,
          okButtonText: "Yes, clear it!",
          cancelButtonText: "Cancel",
          options: {
            // okButtonBackground: "#3085d6",
            cancelButtonBackground: "#d33",
          },
        };

        notiflix.Confirm.show(
          diagOptions.title,
          diagOptions.text,
          diagOptions.okButtonText,
          diagOptions.cancelButtonText,
          () => {
            cart = [];
            $(this).renderTable(cart);
            holdOrder = 0;
            notiflix.Report.success(
              "Cleared!",
              "All items have been removed.",
              "Ok",
            );
          },
          "",
          diagOptions.options,
        );
      }
    };

    $("#payButton").on("click", function () {
      if (cart.length != 0) {
        $("#paymentModel").modal("toggle");
      } else {
        notiflix.Report.warning("Oops!", "There is nothing to pay!", "Ok");
      }
    });

    $("#hold").on("click", function () {
      if (cart.length != 0) {
        $("#dueModal").modal("toggle");
      } else {
        notiflix.Report.warning("Oops!", "There is nothing to hold!", "Ok");
      }
    });

    function printJobComplete() {
      notiflix.Report.success("Done", "print job complete", "Ok");
    }

    $.fn.submitDueOrder = function (status) {
      let items = "";
      let payment = 0;
      paymentType = $('.list-group-item.active').data('payment-type');
      cart.forEach((item) => {
    items += `<tr><td>${DOMPurify.sanitize(item.product_name)}</td><td>${
      DOMPurify.sanitize(item.quantity)
    } </td><td class="text-right"> ${DOMPurify.sanitize(validator.unescape(settings.symbol))} ${moneyFormat(
      DOMPurify.sanitize(Math.abs(item.price).toFixed(2)),
    )} </td></tr>`;
});

      let currentTime = new Date(moment());
      let discount = $("#inputDiscount").val();
      let customer = JSON.parse($("#customer").val());
      let date = moment(currentTime).format("YYYY-MM-DD HH:mm:ss");
      let paymentAmount = $("#payment").val().replace(",", "");
      let changeAmount = $("#change").text().replace(",", "");
      let paid =
        $("#payment").val() == "" ? "" : parseFloat(paymentAmount).toFixed(2);
      let change =
        $("#change").text() == "" ? "" : parseFloat(changeAmount).toFixed(2);
      let refNumber = $("#refNumber").val();
      let orderNumber = holdOrder;
      let type = "";
      let tax_row = "";
      switch (paymentType) {
        case 1:
          type = "Cash";
          break;
        case 2:
          type = "Card";
          break;
      }

      if (paid != "") {
        payment = `<tr>
                        <td>Paid</td>
                        <td>:</td>
                        <td class="text-right">${validator.unescape(settings.symbol)} ${moneyFormat(
                          Math.abs(paid).toFixed(2),
                        )}</td>
                    </tr>
                    <tr>
                        <td>Change</td>
                        <td>:</td>
                        <td class="text-right">${validator.unescape(settings.symbol)} ${moneyFormat(
                          Math.abs(change).toFixed(2),
                        )}</td>
                    </tr>
                    <tr>
                        <td>Method</td>
                        <td>:</td>
                        <td class="text-right">${type}</td>
                    </tr>`;
      }

      if (settings.charge_tax) {
        tax_row = `<tr>
                    <td>VAT(${validator.unescape(settings.percentage)})% </td>
                    <td>:</td>
                    <td class="text-right">${validator.unescape(settings.symbol)} ${moneyFormat(
                      parseFloat(totalVat).toFixed(2),
                    )}</td>
                </tr>`;
      }

      if (status == 0) {
        if ($("#customer").val() == 0 && $("#refNumber").val() == "") {
          notiflix.Report.warning(
            "Reference Required!",
            "You either need to select a customer <br> or enter a reference!",
            "Ok",
          );
          return;
        }
      }

      $(".loading").show();
      
      // Show loading state on hold order button
      if (status == 0) {
        $("#holdOrderBtn").prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Holding Order...');
      }

      if (holdOrder != 0) {
        orderNumber = holdOrder;
        method = "PUT";
      } else {
        orderNumber = Math.floor(Date.now() / 1000);
        method = "POST";
      }

      logo = path.join(img_path, validator.unescape(settings.img));

      receipt = `<div style="font-size: 10px">                            
        <p style="text-align: center;">
        ${
          checkFileExists(logo)
            ? `<img style='max-width: 50px' src='${logo}' /><br>`
            : ``
        }
            <span style="font-size: 22px;">${validator.unescape(settings.store)}</span> <br>
            ${validator.unescape(settings.address_one)} <br>
            ${validator.unescape(settings.address_two)} <br>
            ${
              validator.unescape(settings.contact) != "" ? "Tel: " + validator.unescape(settings.contact) + "<br>" : ""
            } 
            ${validator.unescape(settings.tax) != "" ? "Vat No: " + validator.unescape(settings.tax) + "<br>" : ""} 
        </p>
        <hr>
        <left>
            <p>
            Order No : ${orderNumber} <br>
            Ref No : ${refNumber == "" ? orderNumber : _.escape(refNumber)} <br>
            Customer : ${
              customer == 0 ? "Walk in customer" : _.escape(customer.name)
            } <br>
            Cashier : ${user.fullname} <br>
            Date : ${date}<br>
            </p>

        </left>
        <hr>
        <table width="90%">
            <thead>
            <tr>
                <th>Item</th>
                <th>Qty</th>
                <th class="text-right">Price</th>
            </tr>
            </thead>
            <tbody>
             ${items}                
            <tr><td colspan="3"><hr></td></tr>
            <tr>                        
                <td><b>Subtotal</b></td>
                <td>:</td>
                <td class="text-right"><b>${validator.unescape(settings.symbol)}${moneyFormat(
                  subTotal.toFixed(2),
                )}</b></td>
            </tr>
            <tr>
                <td>Discount</td>
                <td>:</td>
                <td class="text-right">${
                  discount > 0
                    ? validator.unescape(settings.symbol) +
                      moneyFormat(parseFloat(discount).toFixed(2))
                    : ""
                }</td>
            </tr>
            ${tax_row}
            <tr>
                <td><h5>Total</h5></td>
                <td><h5>:</h5></td>
                <td class="text-right">
                    <h5>${validator.unescape(settings.symbol)} ${moneyFormat(
                      parseFloat(orderTotal).toFixed(2),
                    )}</h3>
                </td>
            </tr>
            ${payment == 0 ? "" : payment}
            </tbody>
            </table>
            <br>
            <hr>
            <br>
            <p style="text-align: center;">
             ${validator.unescape(settings.footer)}
             </p>
            </div>`;

      if (status == 3) {
        if (cart.length > 0) {
          printJS({ printable: receipt, type: "raw-html" });

          $(".loading").hide();
          return;
        } else {
          $(".loading").hide();
          return;
        }
      }

      let data = {
        order: orderNumber,
        ref_number: refNumber,
        discount: discount,
        customer: customer,
        status: status,
        subtotal: parseFloat(subTotal).toFixed(2),
        tax: totalVat,
        order_type: 1,
        items: cart,
        date: currentTime,
        payment_type: type,
        payment_info: $("#paymentInfo").val(),
        total: orderTotal,
        paid: paid,
        change: change,
        _id: orderNumber,
        till: platform.till,
        mac: platform.mac,
        user: user.fullname,
        user_id: user._id,
      };

      $.ajax({
        url: api + "new",
        type: method,
        data: JSON.stringify(data),
        contentType: "application/json; charset=utf-8",
        cache: false,
        processData: false,
        success: function (data) {
          cart = [];
          receipt = DOMPurify.sanitize(receipt,{ ALLOW_UNKNOWN_PROTOCOLS: true });
          $("#viewTransaction").html("");
          $("#viewTransaction").html(receipt);
          
          // Show different behavior for hold orders vs completed orders
          if (status == 0) {
            // Hold order - show success message and close modal
            notiflix.Report.success(
              "Order Held Successfully!",
              `Order has been held with reference: ${refNumber}`,
              "Ok"
            );
            $("#dueModal").modal("hide");
          } else {
            // Completed order - show receipt modal
          $("#orderModal").modal("show");
          }
          
          loadProducts();
          loadCustomers();
          $(".loading").hide();
          $("#paymentModel").modal("hide");
          $(this).getHoldOrders();
          $(this).getCustomerOrders();
          $(this).renderTable(cart);
          
          // Reset button states
          $("#holdOrderBtn").prop("disabled", false).html('<i class="fa fa-hand-paper-o"></i> Hold Order');
          $("#confirmPayment").prop("disabled", false).html('<i class="fa fa-check"></i> Confirm Payment');
        },

        error: function (data) {
          $(".loading").hide();
          $("#dueModal").modal("toggle");
          
          // Reset button states
          $("#holdOrderBtn").prop("disabled", false).html('<i class="fa fa-hand-paper-o"></i> Hold Order');
          $("#confirmPayment").prop("disabled", false).html('<i class="fa fa-check"></i> Confirm Payment');
          
          notiflix.Report.failure(
            "Something went wrong!",
            "Please refresh this page and try again",
            "Ok",
          );
        },
      });

      $("#refNumber").val("");
      $("#change").text("");
      $("#payment,#paymentText").val("");
    };

    $.get(api + "on-hold", function (data) {
      holdOrderList = data;
      holdOrderlocation.empty();
      // clearInterval(dotInterval);
      $(this).renderHoldOrders(holdOrderList, holdOrderlocation, 1);
    });

    $.fn.getHoldOrders = function () {
      $.get(api + "on-hold", function (data) {
        holdOrderList = data;
        clearInterval(dotInterval);
        holdOrderlocation.empty();
        $(this).renderHoldOrders(holdOrderList, holdOrderlocation, 1);
      });
    };

    $.fn.renderHoldOrders = function (data, renderLocation, orderType) {
      $.each(data, function (index, order) {
        $(this).calculatePrice(order);
        renderLocation.append(
          $("<div>", {
            class:
              orderType == 1 ? "col-md-3 order" : "col-md-3 customer-order",
          }).append(
            $("<a>").append(
              $("<div>", { class: "card-box order-box" }).append(
                $("<p>").append(
                  $("<b>", { text: "Ref :" }),
                  $("<span>", { text: order.ref_number, class: "ref_number" }),
                  $("<br>"),
                  $("<b>", { text: "Price :" }),
                  $("<span>", {
                    text: order.total,
                    class: "label label-info",
                    style: "font-size:14px;",
                  }),
                  $("<br>"),
                  $("<b>", { text: "Items :" }),
                  $("<span>", { text: order.items.length }),
                  $("<br>"),
                  $("<b>", { text: "Customer :" }),
                  $("<span>", {
                    text:
                      order.customer != 0
                        ? order.customer.name
                        : "Walk in customer",
                    class: "customer_name",
                  }),
                ),
                $("<button>", {
                  class: "btn btn-danger del",
                  onclick:
                    "$(this).deleteOrder(" + index + "," + orderType + ")",
                }).append($("<i>", { class: "fa fa-trash" })),

                $("<button>", {
                  class: "btn btn-default",
                  onclick:
                    "$(this).orderDetails(" + index + "," + orderType + ")",
                }).append($("<span>", { class: "fa fa-shopping-basket" })),
              ),
            ),
          ),
        );
      });
    };

    $.fn.calculatePrice = function (data) {
      totalPrice = 0;
      $.each(data.products, function (index, product) {
        totalPrice += product.price * product.quantity;
      });

      let vat = (totalPrice * data.vat) / 100;
      totalPrice = (totalPrice + vat - data.discount).toFixed(0);

      return totalPrice;
    };

    $.fn.orderDetails = function (index, orderType) {
      $("#refNumber").val("");

      if (orderType == 1) {
        $("#refNumber").val(holdOrderList[index].ref_number);

        $("#customer option:selected").removeAttr("selected");

        $("#customer option")
          .filter(function () {
            return $(this).text() == "Walk in customer";
          })
          .prop("selected", true);

        holdOrder = holdOrderList[index]._id;
        cart = [];
        $.each(holdOrderList[index].items, function (index, product) {
          item = {
            id: product.id,
            product_name: product.product_name,
            sku: product.sku,
            price: product.price,
            quantity: product.quantity,
            purchasePrice: product.purchasePrice || product.actualPrice || "",
            genericName: product.genericName || "",
            manufacturer: product.manufacturer || "",
            supplier: product.supplier || "",
            batchNumber: product.batchNumber || "",
          };
          cart.push(item);
        });
      } else if (orderType == 2) {
        $("#refNumber").val("");

        $("#customer option:selected").removeAttr("selected");

        $("#customer option")
          .filter(function () {
            return $(this).text() == customerOrderList[index].customer.name;
          })
          .prop("selected", true);

        holdOrder = customerOrderList[index]._id;
        cart = [];
        $.each(customerOrderList[index].items, function (index, product) {
          item = {
            id: product.id,
            product_name: product.product_name,
            sku: product.sku,
            price: product.price,
            quantity: product.quantity,
            purchasePrice: product.purchasePrice || product.actualPrice || "",
            genericName: product.genericName || "",
            manufacturer: product.manufacturer || "",
            supplier: product.supplier || "",
            batchNumber: product.batchNumber || "",
          };
          cart.push(item);
        });
      }
      $(this).renderTable(cart);
      $("#holdOrdersModal").modal("hide");
      $("#customerModal").modal("hide");
    };

    $.fn.deleteOrder = function (index, type) {
      switch (type) {
        case 1:
          deleteId = holdOrderList[index]._id;
          break;
        case 2:
          deleteId = customerOrderList[index]._id;
      }

      let data = {
        orderId: deleteId,
      };
      let diagOptions = {
        title: "Delete order?",
        text: "This will delete the order. Are you sure you want to delete!",
        icon: "warning",
        showCancelButton: true,
        okButtonColor: "#3085d6",
        cancelButtonColor: "#d33",
        okButtonText: "Yes, delete it!",
        cancelButtonText: "Cancel",
      };

      notiflix.Confirm.show(
        diagOptions.title,
        diagOptions.text,
        diagOptions.okButtonText,
        diagOptions.cancelButtonText,
        () => {
          $.ajax({
            url: api + "delete",
            type: "POST",
            data: JSON.stringify(data),
            contentType: "application/json; charset=utf-8",
            cache: false,
            success: function (data) {
              $(this).getHoldOrders();
              $(this).getCustomerOrders();

              notiflix.Report.success(
                "Deleted!",
                "You have deleted the order!",
                "Ok",
              );
            },
            error: function (data) {
              $(".loading").hide();
            },
          });
        },
      );
    };

    $.fn.getCustomerOrders = function () {
      $.get(api + "customer-orders", function (data) {
        //clearInterval(dotInterval);
        customerOrderList = data;
        customerOrderLocation.empty();
        $(this).renderHoldOrders(customerOrderList, customerOrderLocation, 2);
      });
    };

    $("#saveCustomer").on("submit", function (e) {
      e.preventDefault();

      let custData = {
        _id: Math.floor(Date.now() / 1000),
        name: $("#userName").val(),
        phone: $("#phoneNumber").val(),
        email: $("#emailAddress").val(),
        address: $("#userAddress").val(),
      };

      $.ajax({
        url: api + "customers/customer",
        type: "POST",
        data: JSON.stringify(custData),
        contentType: "application/json; charset=utf-8",
        cache: false,
        processData: false,
        success: function (data) {
          $("#newCustomer").modal("hide");
          notiflix.Report.success(
            "Customer added!",
            "Customer added successfully!",
            "Ok",
          );
          $("#customer option:selected").removeAttr("selected");
          $("#customer").append(
            $("<option>", {
              text: custData.name,
              value: `{"id": ${custData._id}, "name": ${custData.name}}`,
              selected: "selected",
            }),
          );

          $("#customer")
            .val(`{"id": ${custData._id}, "name": ${custData.name}}`)
            .trigger("chosen:updated");
        },
        error: function (data) {
          $("#newCustomer").modal("hide");
          notiflix.Report.failure(
            "Error",
            "Something went wrong please try again",
            "Ok",
          );
        },
      });
    });

    $("#confirmPayment").hide();

    $("#cardInfo").hide();

    $("#payment").on("input", function () {
      $(this).calculateChange();
    });
    $("#confirmPayment").on("click", function () {
      if ($("#payment").val() == "") {
        notiflix.Report.warning(
          "Payment Required!",
          "Please enter the amount that was paid!<br><small>Press ESC to close this message</small>",
          "Ok",
        );
        return;
      }
      
      // Check if payment is sufficient
      var payablePrice = parseFloat($("#payablePrice").val().replace(",", "")) || 0;
      var payment = parseFloat($("#payment").val().replace(",", "")) || 0;
      
      if (payment < payablePrice) {
        notiflix.Report.warning(
          "Insufficient Payment!",
          `Payment of ${utils.moneyFormat(payment.toFixed(2))} is less than the total amount of ${utils.moneyFormat(payablePrice.toFixed(2))}.<br><small>Press ESC to close this message</small>`,
          "Ok",
        );
        return;
      }
      
      // Show loading state
      $(this).prop("disabled", true).html('<i class="fa fa-spinner fa-spin"></i> Processing...');
      
      // Process payment
      $(this).submitDueOrder(1);
    });

    $("#transactions").on("click", function () {
      loadTransactions();
      loadUserList();

      $("#pos_view").hide();
      $("#pointofsale").show();
      $("#transactions_view").show();
      $(this).hide();
    });

    $("#pointofsale").on("click", function () {
      $("#pos_view").show();
      $("#transactions").show();
      $("#transactions_view").hide();
      $(this).hide();
    });

    $("#viewRefOrders").on("click", function () {
      setTimeout(function () {
        $("#holdOrderInput").focus();
      }, 500);
    });

    $("#viewCustomerOrders").on("click", function () {
      setTimeout(function () {
        $("#holdCustomerOrderInput").focus();
      }, 500);
    });

    $("#newProductModal").on("click", function () {
      $("#saveProduct").get(0).reset();
      $("#current_img").text("");
      
      // Load manufacturers for the dropdown
      loadManufacturers();
    });

    // Enhanced UX: Auto-focus and keyboard navigation for Products modal
    $("#newProduct").on("shown.bs.modal", function () {
      // Auto-focus on the first input field (Product Name)
      $("#productName").focus();
      
      // Add keyboard shortcuts for the modal
      $(this).off("keydown.modal").on("keydown.modal", function (e) {
        // Enter key submits the form
        if (e.keyCode === 13 && !$(e.target).is("textarea, select")) {
          e.preventDefault();
          $("#saveProduct").submit();
        }
        
        // Escape key closes the modal
        if (e.keyCode === 27) {
          $("#newProduct").modal("hide");
        }
      });
      
      // Ensure dropdowns are populated
      if (!$("#manufacturer option").length || $("#manufacturer option").length <= 1) {
        console.log("Manufacturer dropdown empty, populating...");
        loadManufacturers();
      }
      
      if (!$("#supplier option").length || $("#supplier option").length <= 1) {
        console.log("Supplier dropdown empty, populating...");
        loadSuppliers();
      }
    });

    // Enhanced UX: Tab navigation and form validation feedback
    $("#saveProduct input, #saveProduct select").on("keydown", function (e) {
      // Shift+Enter moves to previous field
      if (e.keyCode === 13 && e.shiftKey) {
        e.preventDefault();
        $(this).closest(".form-group").prev().find("input, select").focus();
      }
      
      // Enter moves to next field (except for submit button)
      if (e.keyCode === 13 && !e.shiftKey && !$(this).is("#submitProduct")) {
        e.preventDefault();
        $(this).closest(".form-group").next().find("input, select").focus();
      }
    });

    // Enhanced UX: Visual feedback for form validation
    $("#saveProduct input, #saveProduct select").on("blur", function () {
      const $field = $(this);
      const $formGroup = $field.closest(".form-group");
      
      // Remove previous validation states
      $formGroup.removeClass("has-success has-error");
      
      // Add success state for filled required fields
      if ($field.attr("required") && $field.val().trim()) {
        $formGroup.addClass("has-success");
      }
      
      // Add error state for empty required fields
      if ($field.attr("required") && !$field.val().trim()) {
        $formGroup.addClass("has-error");
      }
    });

    $("#saveProduct").submit(function (e) {
      e.preventDefault();

      // Apply default manufacturer setting if no manufacturer is selected
      if (settings && settings.defaultManufacturer && !$("#manufacturer").val()) {
        $("#manufacturer").val(settings.defaultManufacturer);
      }
      
      // Apply default supplier setting if no supplier is selected
      if (settings && settings.defaultSupplier && !$("#supplier").val()) {
        $("#supplier").val(settings.defaultSupplier);
      }

      $(this).attr("action", api + "inventory/product");
      $(this).attr("method", "POST");

      $(this).ajaxSubmit({
        contentType: "application/json",
        success: function (response) {
          let resp = response;
          if (typeof resp === 'string') {
            try { resp = JSON.parse(resp); } catch (_) {}
          }
          if (resp && resp.status === 'duplicate_barcode') {
            return notiflix.Report.warning("Duplicate Barcode","A product with this barcode already exists.","Ok");
          }
          if (resp && resp.status === 'duplicate_product') {
            return notiflix.Report.warning("Duplicate Product","A product with the same Name, Batch Number and Manufacturer already exists.","Ok");
          }

          // Handle new detailed success messages
          if (resp && resp.success && resp.message) {
            notiflix.Report.success("Success", resp.message, "Ok");
          }

          $("#saveProduct").get(0).reset();
          $("#current_img").text("");

          loadProducts();
          diagOptions = {
            title: "Product Saved",
            text: "Select an option below to continue.",
            okButtonText: "Add another",
            cancelButtonText: "Close",
          };

          notiflix.Confirm.show(
            diagOptions.title,
            diagOptions.text,
            diagOptions.okButtonText,
            diagOptions.cancelButtonText,
            ()=>{},
            () => {
              $("#newProduct").modal("hide");
            },
          );
        },
        //error for product
       error: function (jqXHR,textStatus, errorThrown) {
      console.error(jqXHR.responseJSON.message);
      notiflix.Report.failure(
        jqXHR.responseJSON.error,
        jqXHR.responseJSON.message,
        "Ok",
      );
      }

      });
    });

    // Enhanced UX: Auto-focus and keyboard navigation for Categories modal
    $("#newCategory").on("shown.bs.modal", function () {
      // Auto-focus on the category name field
      $("#categoryName").focus();
      
      // Add keyboard shortcuts for the modal
      $(this).off("keydown.modal").on("keydown.modal", function (e) {
        // Enter key submits the form
        if (e.keyCode === 13 && !$(e.target).is("textarea, select")) {
          e.preventDefault();
          $("#saveCategory").submit();
        }
        
        // Escape key closes the modal
        if (e.keyCode === 27) {
          $("#newCategory").modal("hide");
        }
      });
    });

    // Enhanced UX: Visual feedback for form validation
    $("#saveCategory input").on("blur", function () {
      const $field = $(this);
      const $formGroup = $field.closest(".form-group");
      
      // Remove previous validation states
      $formGroup.removeClass("has-success has-error");
      
      // Add success state for filled required fields
      if ($field.attr("required") && $field.val().trim()) {
        $formGroup.addClass("has-success");
      }
      
      // Add error state for empty required fields
      if ($field.attr("required") && !$field.val().trim()) {
        $formGroup.addClass("has-error");
      }
    });

    $("#saveCategory").submit(function (e) {
      e.preventDefault();

      if ($("#category_id").val() == "") {
        method = "POST";
      } else {
        method = "PUT";
      }

      $.ajax({
        type: method,
        url: api + "categories/category",
        data: $(this).serialize(),
        success: function (data, textStatus, jqXHR) {
          // Handle new detailed success messages
          if (data && data.success && data.message) {
            notiflix.Report.success("Success", data.message, "Ok");
          }

          $("#saveCategory").get(0).reset();
          loadCategories();
          loadProducts();
          
          // Refresh category dropdown in product form if it's open
          if ($("#newProduct").is(":visible")) {
            loadCategories();
          }
          diagOptions = {
            title: "Category Saved",
            text: "Select an option below to continue.",
            okButtonText: "Add another",
            cancelButtonText: "Close",
          };

          notiflix.Confirm.show(
            diagOptions.title,
            diagOptions.text,
            diagOptions.okButtonText,
            diagOptions.cancelButtonText,
            ()=>{},

            () => {
                $("#newCategory").modal("hide");
            },
          );
        },
      });
    });

    // Manufacturer Management Functions
    let allManufacturers = [];
    
    // Supplier Management Functions
    let allSuppliers = [];

    function loadManufacturers() {
      $.get(api + "manufacturers/all?_t=" + Date.now(), function (data) {
        allManufacturers = data;
        loadManufacturerList();
        
        // Also populate the manufacturer dropdown in product form
        $("#manufacturer").html(`<option value="">Select Manufacturer</option>`);
        allManufacturers.forEach((manufacturer) => {
          $("#manufacturer").append(
            `<option value="${manufacturer.name}">${manufacturer.name}${manufacturer.code ? ` (${manufacturer.code})` : ''}</option>`,
          );
        });
        
        // Note: Manufacturer filter removed from POS for simplicity
      }).fail(function (jqXHR, textStatus, errorThrown) {
        console.error("Failed to load manufacturers:", errorThrown);
        notiflix.Notify.failure("Failed to load manufacturers");
      });
    }
    
    function populateManufacturerSettings() {
      $("#defaultManufacturer").html(`<option value="">Select Default Manufacturer</option>`);
      if (allManufacturers && allManufacturers.length > 0) {
        allManufacturers.forEach((manufacturer) => {
          $("#defaultManufacturer").append(
            `<option value="${manufacturer._id}">${manufacturer.name}${manufacturer.code ? ` (${manufacturer.code})` : ''}</option>`,
          );
        });
        
        // Set the current default if it exists in settings
        if (settings && settings.defaultManufacturer) {
          $("#defaultManufacturer").val(settings.defaultManufacturer);
        }
      }
    }
    
    function populateSupplierSettings() {
      $("#defaultSupplier").html(`<option value="">Select Default Supplier</option>`);
      if (allSuppliers && allSuppliers.length > 0) {
        allSuppliers.forEach((supplier) => {
          $("#defaultSupplier").append(
            `<option value="${supplier._id}">${supplier.name}${supplier.code ? ` (${supplier.code})` : ''}</option>`,
          );
        });
        
        // Set the current default if it exists in settings
        if (settings && settings.defaultSupplier) {
          $("#defaultSupplier").val(settings.defaultSupplier);
        }
      }
    }
    
    function validateManufacturerData() {
      // Check required fields based on settings
      if (settings && settings.requireManufacturerName && !$("#manufacturerName").val().trim()) {
        notiflix.Report.failure("Validation Error", "Manufacturer name is required.", "Ok");
        $("#manufacturerName").focus();
        return false;
      }
      
      if (settings && settings.requireManufacturerCode && !$("#manufacturerCode").val().trim()) {
        notiflix.Report.failure("Validation Error", "Manufacturer code is required.", "Ok");
        $("#manufacturerCode").focus();
        return false;
      }
      
      if (settings && settings.requireManufacturerContact && 
          !$("#manufacturerPhone").val().trim() && !$("#manufacturerEmail").val().trim()) {
        notiflix.Report.failure("Validation Error", "Either phone or email is required.", "Ok");
        $("#manufacturerPhone").focus();
        return false;
      }
      
      return true;
    }
    
    function validateSupplierData() {
      // Check required fields based on settings
      if (settings && settings.requireSupplierName && !$("#supplierName").val().trim()) {
        notiflix.Report.failure("Validation Error", "Supplier name is required.", "Ok");
        $("#supplierName").focus();
        return false;
      }
      
      if (settings && settings.requireSupplierCode && !$("#supplierCode").val().trim()) {
        notiflix.Report.failure("Validation Error", "Supplier code is required.", "Ok");
        $("#supplierCode").focus();
        return false;
      }
      
      if (settings && settings.requireSupplierContact && 
          !$("#supplierPhone").val().trim() && !$("#supplierEmail").val().trim()) {
        notiflix.Report.failure("Validation Error", "Either phone or email is required.", "Ok");
        $("#supplierPhone").focus();
        return false;
      }
      
      return true;
    }

    function loadManufacturerList() {
      let manufacturer_list = "";
      let counter = 0;
      $("#manufacturer_list").empty();
      
      if ($.fn.DataTable.isDataTable('#manufacturerList')) {
        $("#manufacturerList").DataTable().destroy();
      }

      allManufacturers.forEach((manufacturer, index) => {
        counter++;

        manufacturer_list += `<tr>
          <td>${manufacturer.code || '-'}</td>
          <td>${manufacturer.name}</td>
          <td>${manufacturer.city || '-'}</td>
          <td>${manufacturer.country || '-'}</td>
          <td>${manufacturer.phone || '-'}</td>
          <td><span class="label label-${manufacturer.status === 'active' ? 'success' : 'warning'}">${manufacturer.status}</span></td>
          <td>
            <span class="btn-group">
              <button onClick="$(this).editManufacturer(${index})" class="btn btn-warning btn-xs" title="Edit">
                <i class="fa fa-edit"></i>
              </button>
              <button onClick="$(this).deleteManufacturer(${manufacturer._id})" class="btn btn-danger btn-xs" title="Delete">
                <i class="fa fa-trash"></i>
              </button>
            </span>
          </td>
        </tr>`;
      });

      if (counter == allManufacturers.length) {
        $("#manufacturer_list").html(manufacturer_list);
        $("#manufacturerList").DataTable({
          autoWidth: false,
          info: true,
          JQueryUI: true,
          ordering: true,
          paging: true,
          pageLength: 10,
          lengthMenu: [[10, 25, 50, -1], [10, 25, 50, "All"]]
        });
      }
    }

    $("#saveManufacturer").submit(function (e) {
      e.preventDefault();

      // Validate manufacturer data based on settings
      if (!validateManufacturerData()) {
        return;
      }

      let method;
      if ($("#manufacturer_id").val() == "") {
        method = "POST";
      } else {
        method = "PUT";
      }

      $.ajax({
        type: method,
        url: api + "manufacturers/manufacturer",
        data: $(this).serialize(),
        success: function (data, textStatus, jqXHR) {
          $("#saveManufacturer").get(0).reset();
          loadManufacturers();
          loadProducts();
          
          // Refresh manufacturer dropdown in product form if it's open
          if ($("#newProduct").is(":visible")) {
            loadManufacturers();
          }
          
          diagOptions = {
            title: "Manufacturer Saved",
            text: "Select an option below to continue.",
            okButtonText: "Add another",
            cancelButtonText: "Close",
          };

          notiflix.Confirm.show(
            diagOptions.title,
            diagOptions.text,
            diagOptions.okButtonText,
            diagOptions.cancelButtonText,
            ()=>{},
            () => {
                $("#newManufacturer").modal("hide");
            },
          );
        },
        error: function (jqXHR, textStatus, errorThrown) {
          let errorMessage = "An error occurred while saving the manufacturer.";
          if (jqXHR.responseJSON && jqXHR.responseJSON.message) {
            errorMessage = jqXHR.responseJSON.message;
          }
          notiflix.Report.failure("Error", errorMessage, "Ok");
        }
      });
    });

    $.fn.editManufacturer = function (index) {
      $("#Manufacturers").modal("hide");

      const manufacturer = allManufacturers[index];
      
      $("#manufacturer_id").val(manufacturer._id);
      $("#manufacturerName").val(manufacturer.name);
      $("#manufacturerCode").val(manufacturer.code || "");
      $("#manufacturerAddress").val(manufacturer.address || "");
      $("#manufacturerCity").val(manufacturer.city || "");
      $("#manufacturerState").val(manufacturer.state || "");
      $("#manufacturerCountry").val(manufacturer.country || "");
      $("#manufacturerPostalCode").val(manufacturer.postalCode || "");
      $("#manufacturerPhone").val(manufacturer.phone || "");
      $("#manufacturerEmail").val(manufacturer.email || "");
      $("#manufacturerWebsite").val(manufacturer.website || "");
      $("#manufacturerContactPerson").val(manufacturer.contactPerson || "");
      $("#manufacturerTaxId").val(manufacturer.taxId || "");
      $("#manufacturerLicenseNumber").val(manufacturer.licenseNumber || "");
      $("#manufacturerRegistrationDate").val(manufacturer.registrationDate || "");
      $("#manufacturerStatus").val(manufacturer.status || "active");
      $("#manufacturerNotes").val(manufacturer.notes || "");

      $("#newManufacturer").modal("show");
    };
    
    // Enhanced Auto-generate manufacturer code when name is entered
    $("#manufacturerName").on("input", function() {
      const name = $(this).val().trim();
      if (name) {
        // Always generate code for new manufacturers (not editing existing)
        if (!$("#manufacturer_id").val()) {
          const code = generateManufacturerCode(name);
          $("#manufacturerCode").val(code);
          
          // Add visual feedback
          $("#manufacturerCode").addClass("code-generated");
          $("#manufacturerCodeHint").removeClass("duplicate").addClass("auto-generated").text("✓ Code auto-generated successfully");
          
          setTimeout(() => {
            $("#manufacturerCode").removeClass("code-generated");
          }, 2000);
        }
      } else {
        // Clear code and hint when name is empty
        $("#manufacturerCode").val("");
        $("#manufacturerCodeHint").removeClass("auto-generated duplicate").text("Code will be auto-generated when you enter the manufacturer name");
      }
    });

    // Allow users to edit generated codes
    $("#manufacturerCode").on("input", function() {
      const code = $(this).val().trim();
      if (code) {
        // Remove generated class when user edits
        $(this).removeClass("code-generated");
        
        // Add validation class
        if (isCodeUnique(code, 'manufacturer')) {
          $(this).removeClass("code-duplicate").addClass("code-unique");
          $("#manufacturerCodeHint").removeClass("duplicate").addClass("auto-generated").text("✓ Code is unique and available");
        } else {
          $(this).removeClass("code-unique").addClass("code-duplicate");
          $("#manufacturerCodeHint").removeClass("auto-generated").addClass("duplicate").text("⚠ This code already exists");
        }
      } else {
        // Reset hint when field is empty
        $("#manufacturerCodeHint").removeClass("auto-generated duplicate").text("Code will be auto-generated when you enter the manufacturer name");
      }
    });
    
    // Enhanced Auto-generate supplier code when name is entered
    $("#supplierName").on("input", function() {
      const name = $(this).val().trim();
      if (name) {
        // Always generate code for new suppliers (not editing existing)
        if (!$("#supplier_id").val()) {
          const code = generateSupplierCode(name);
          $("#supplierCode").val(code);
          
          // Add visual feedback
          $("#supplierCode").addClass("code-generated");
          $("#supplierCodeHint").removeClass("duplicate").addClass("auto-generated").text("✓ Code auto-generated successfully");
          
          setTimeout(() => {
            $("#supplierCode").removeClass("code-generated");
          }, 2000);
        }
      } else {
        // Clear code and hint when name is empty
        $("#supplierCode").val("");
        $("#supplierCodeHint").removeClass("auto-generated duplicate").text("Code will be auto-generated when you enter the supplier name");
      }
    });

    // Allow users to edit generated codes
    $("#supplierCode").on("input", function() {
      const code = $(this).val().trim();
      if (code) {
        // Remove generated class when user edits
        $(this).removeClass("code-generated");
        
        // Add validation class
        if (isCodeUnique(code, 'supplier')) {
          $(this).removeClass("code-duplicate").addClass("code-unique");
          $("#supplierCodeHint").removeClass("duplicate").addClass("auto-generated").text("✓ Code is unique and available");
        } else {
          $(this).removeClass("code-unique").addClass("code-duplicate");
          $("#supplierCodeHint").removeClass("auto-generated").addClass("duplicate").text("⚠ This code already exists");
        }
      } else {
        // Reset hint when field is empty
        $("#supplierCodeHint").removeClass("auto-generated duplicate").text("Code will be auto-generated when you enter the supplier name");
      }
    });
    
    function generateManufacturerCode(name) {
      if (!name || !name.trim()) return '';
      
      // Clean and normalize the name
      const cleanName = name.trim().replace(/[^a-zA-Z0-9\s]/g, '');
      const words = cleanName.split(' ').filter(word => word.length > 0);
      
      let code = 'MANU-';
      
      if (words.length >= 2) {
        // Use first letter of first two words
        code += words[0].charAt(0).toUpperCase() + words[1].charAt(0).toUpperCase();
      } else if (words.length === 1) {
        // Use first two letters of single word
        code += words[0].substring(0, 2).toUpperCase();
      }
      
      // Add timestamp for uniqueness
      const timestamp = Date.now().toString().slice(-4);
      code += timestamp;
      
      // Ensure final uniqueness by checking existing codes
      let finalCode = code;
      let counter = 1;
      const existingCodes = allManufacturers.map(m => m.code).filter(c => c);
      
      while (existingCodes.includes(finalCode)) {
        finalCode = `${code}-${counter.toString().padStart(2, '0')}`;
        counter++;
      }
      
      return finalCode;
    }
    
    function generateSupplierCode(name) {
      if (!name || name.trim() === '') return '';
      
      // Clean and normalize the name
      const cleanName = name.trim().replace(/[^a-zA-Z0-9\s]/g, '');
      const words = cleanName.split(' ').filter(word => word.length > 0);
      
      let code = 'SUPP-';
      
      if (words.length >= 2) {
        // Use first letter of first two words
        code += words[0].charAt(0).toUpperCase() + words[1].charAt(0).toUpperCase();
      } else if (words.length === 1) {
        // Use first two letters of single word
        code += name.substring(0, 2).toUpperCase();
      }
      
      // Add timestamp for uniqueness
      const timestamp = Date.now().toString().slice(-4);
      code += timestamp;
      
      // Ensure final uniqueness by checking existing codes
      let finalCode = code;
      let counter = 1;
      const existingCodes = allSuppliers.map(s => s.code).filter(c => c);
      
      while (existingCodes.includes(finalCode)) {
        finalCode = `${code}-${counter.toString().padStart(2, '0')}`;
        counter++;
      }
      
      return finalCode;
    }

    // Enhanced code uniqueness validation function
    function isCodeUnique(code, type) {
      if (!code || !code.trim()) return false;
      
      const currentId = type === 'manufacturer' ? $("#manufacturer_id").val() : $("#supplier_id").val();
      const existingItems = type === 'manufacturer' ? allManufacturers : allSuppliers;
      
      // Check if code already exists (excluding current item if editing)
      const duplicate = existingItems.find(item => 
        item.code === code && item._id !== currentId
      );
      
      return !duplicate;
    }

    $.fn.deleteManufacturer = function (manufacturerId) {
      notiflix.Confirm.show(
        "Delete Manufacturer",
        "Are you sure you want to delete this manufacturer? This action cannot be undone.",
        "Delete",
        "Cancel",
        () => {
          $.ajax({
            type: "DELETE",
            url: api + "manufacturers/manufacturer/" + manufacturerId,
            success: function (data, textStatus, jqXHR) {
              notiflix.Notify.success("Manufacturer deleted successfully");
              loadManufacturers();
              loadProducts();
            },
            error: function (jqXHR, textStatus, errorThrown) {
              let errorMessage = "An error occurred while deleting the manufacturer.";
              if (jqXHR.responseJSON && jqXHR.responseJSON.message) {
                errorMessage = jqXHR.responseJSON.message;
              }
              notiflix.Report.failure("Error", errorMessage, "Ok");
            }
          });
        }
      );
    }

    // Manufacturer search functionality
    $("#manufacturerSearch").on("input", function() {
      const searchTerm = $(this).val().toLowerCase();
      const table = $("#manufacturerList").DataTable();
      table.search(searchTerm).draw();
    });

    $("#manufacturerSearchBtn").on("click", function() {
      const searchTerm = $("#manufacturerSearch").val().toLowerCase();
      const table = $("#manufacturerList").DataTable();
      table.search(searchTerm).draw();
    });

    $("#refreshManufacturers").on("click", function() {
      loadManufacturers();
    });

    // Enhanced UX: Auto-focus and keyboard navigation for Manufacturers modal
    $("#newManufacturer").on("shown.bs.modal", function () {
      // Auto-focus on the manufacturer name field
      $("#manufacturerName").focus();
      
      // Add keyboard shortcuts for the modal
      $(this).off("keydown.modal").on("keydown.modal", function (e) {
        // Enter key submits the form
        if (e.keyCode === 13 && !$(e.target).is("textarea, select")) {
          e.preventDefault();
          $("#saveManufacturer").submit();
        }
        
        // Escape key closes the modal
        if (e.keyCode === 27) {
          $("#newManufacturer").modal("hide");
        }
      });

      // Add helpful hints for code generation
      if (!$("#manufacturerCodeHint").length) {
        $("#manufacturerCode").after('<small class="code-field-hint" id="manufacturerCodeHint">Code will be auto-generated when you enter the manufacturer name</small>');
      }
    });

    // Enhanced UX: Tab navigation and form validation feedback for Manufacturers
    $("#saveManufacturer input, #saveManufacturer select, #saveManufacturer textarea").on("keydown", function (e) {
      // Shift+Enter moves to previous field
      if (e.keyCode === 13 && e.shiftKey) {
        e.preventDefault();
        $(this).closest(".form-group").prev().find("input, select, textarea").focus();
      }
      
      // Enter moves to next field (except for submit button)
      if (e.keyCode === 13 && !e.shiftKey && !$(this).is("#submitManufacturer")) {
        e.preventDefault();
        $(this).closest(".form-group").next().find("input, select, textarea").focus();
      }
    });

    // Enhanced UX: Visual feedback for form validation for Manufacturers
    $("#saveManufacturer input, #saveManufacturer select, #saveManufacturer textarea").on("blur", function () {
      const $field = $(this);
      const $formGroup = $field.closest(".form-group");
      
      // Remove previous validation states
      $formGroup.removeClass("has-success has-error");
      
      // Add success state for filled required fields
      if ($field.attr("required") && $field.val().trim()) {
        $formGroup.addClass("has-success");
      }
      
      // Add error state for empty required fields
      if ($field.attr("required") && !$field.val().trim()) {
        $formGroup.addClass("has-error");
      }
    });

    // Manufacturer modal events
    $("#newManufacturerModal").on("click", function() {
      $("#manufacturer_id").val("");
      $("#saveManufacturer").get(0).reset();
      $("#manufacturerStatus").val("active");
    });

    $("#manufacturerModal").on("click", function() {
      loadManufacturers();
    });

    // New Manufacturer button from product form
    $("#newManufacturerFromProduct").click(function() {
      $("#newManufacturer").modal("show");
    });

    // New Category button from product form
    $("#newCategoryFromProduct").click(function() {
      $("#newCategory").modal("show");
    });

    // Manufacturer reports button
    $("#manufacturerReportsBtn").click(function() {
      // Show reports modal with tabs
      showManufacturerReports();
    });



    // Function to show manufacturer reports
    function showManufacturerReports() {
      // Create modal content dynamically
      let modalContent = `
        <div class="modal fade" id="manufacturerReportsModal" tabindex="-1" role="dialog">
          <div class="modal-dialog modal-lg">
            <div class="modal-content">
              <div class="modal-header">
                <h4 class="modal-title"><i class="fa fa-chart-bar"></i> Manufacturer Reports</h4>
                <button type="button" class="close" data-dismiss="modal">&times;</button>
              </div>
              <div class="modal-body">
                <ul class="nav nav-tabs" id="reportTabs">
                  <li class="nav-item">
                    <a class="nav-link active" data-toggle="tab" href="#performanceTab">Performance</a>
                  </li>
                  <li class="nav-item">
                    <a class="nav-link" data-toggle="tab" href="#directoryTab">Contact Directory</a>
                  </li>
                  <li class="nav-item">
                    <a class="nav-link" data-toggle="tab" href="#completenessTab">Data Completeness</a>
                  </li>
                </ul>
                <div class="tab-content mt-3">
                  <div id="performanceTab" class="tab-pane active">
                    <div id="performanceContent">Loading performance metrics...</div>
                  </div>
                  <div id="directoryTab" class="tab-pane">
                    <div id="directoryContent">Loading contact directory...</div>
                  </div>
                  <div id="completenessTab" class="tab-pane">
                    <div id="completenessContent">Loading completeness data...</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      
      // Remove existing modal if any
      $("#manufacturerReportsModal").remove();
      
      // Add modal to body
      $("body").append(modalContent);
      
      // Show modal
      $("#manufacturerReportsModal").modal("show");
      
      // Load data for each tab
      loadPerformanceMetrics();
      loadContactDirectory();
      loadCompletenessData();
    }

    function loadPerformanceMetrics() {
      $.get(api + "manufacturers/performance", function(data) {
        let content = `
          <div class="row">
            <div class="col-md-6">
              <div class="card">
                <div class="card-header">
                  <h5><i class="fa fa-chart-pie"></i> Overview</h5>
                </div>
                <div class="card-body">
                  <p><strong>Total Manufacturers:</strong> ${data.totalManufacturers}</p>
                  <p><strong>Active:</strong> ${data.activeManufacturers}</p>
                  <p><strong>Inactive:</strong> ${data.inactiveManufacturers}</p>
                </div>
              </div>
            </div>
            <div class="col-md-6">
              <div class="card">
                <div class="card-header">
                  <h5><i class="fa fa-info-circle"></i> Data Quality</h5>
                </div>
                <div class="card-body">
                  <p><strong>Complete Info:</strong> ${data.manufacturersWithCompleteInfo}</p>
                  <p><strong>Partial Info:</strong> ${data.manufacturersWithPartialInfo}</p>
                  <p><strong>No Contact Info:</strong> ${data.manufacturersWithNoContactInfo}</p>
                </div>
              </div>
            </div>
          </div>
        `;
        
        $("#performanceContent").html(content);
      }).fail(function() {
        $("#performanceContent").html('<div class="alert alert-danger">Failed to load performance metrics</div>');
      });
    }

    function loadContactDirectory() {
      $.get(api + "manufacturers/directory", function(data) {
        let content = `
          <div class="table-responsive">
            <table class="table table-striped">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact Person</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
        `;
        
        data.forEach(manufacturer => {
          content += `
            <tr>
              <td><strong>${manufacturer.name}</strong>${manufacturer.code ? ` (${manufacturer.code})` : ''}</td>
              <td>${manufacturer.contactPerson || '-'}</td>
              <td>${manufacturer.phone || '-'}</td>
              <td>${manufacturer.email || '-'}</td>
              <td><span class="label label-${manufacturer.status === 'active' ? 'success' : 'warning'}">${manufacturer.status}</span></td>
            </tr>
          `;
        });
        
        content += `
              </tbody>
            </table>
          </div>
        `;
        
        $("#directoryContent").html(content);
      }).fail(function() {
        $("#directoryContent").html('<div class="alert alert-danger">Failed to load contact directory</div>');
      });
    }

    function loadCompletenessData() {
      $.get(api + "manufacturers/performance", function(data) {
        let content = `
          <div class="table-responsive">
            <table class="table table-striped">
              <thead>
                <tr>
                  <th>Manufacturer</th>
                  <th>Completeness Score</th>
                  <th>Missing Fields</th>
                </tr>
              </thead>
              <tbody>
        `;
        
        data.topManufacturersByCompleteness.forEach(manufacturer => {
          content += `
            <tr>
              <td><strong>${manufacturer.name}</strong></td>
              <td>
                <div class="progress">
                  <div class="progress-bar" style="width: ${manufacturer.completenessScore}%">
                    ${manufacturer.completenessScore}%
                  </div>
                </div>
              </td>
              <td>${manufacturer.missingFields.length > 0 ? manufacturer.missingFields.join(', ') : 'Complete'}</td>
            </tr>
          `;
        });
        
        content += `
              </tbody>
            </table>
          </div>
        `;
        
        $("#completenessContent").html(content);
      }).fail(function() {
        $("#completenessContent").html('<div class="alert alert-danger">Failed to load completeness data</div>');
      });
    }

    // Manufacturer export button
    $("#manufacturerExportBtn").click(function() {
      window.open(api + "manufacturers/export", "_blank");
    });

    // Manufacturer integrity check button
    $("#manufacturerIntegrityBtn").click(function() {
      $.get(api + "manufacturers/integrity", function(data) {
        let integrityReport = `
          <div class="alert alert-info">
            <h5><i class="fa fa-shield"></i> Data Integrity Report</h5>
            <div class="row">
              <div class="col-md-6">
                <strong>Total Manufacturers:</strong> ${data.totalManufacturers}<br>
                <strong>Active:</strong> ${data.activeManufacturers}<br>
                <strong>Inactive:</strong> ${data.inactiveManufacturers}<br>
                <strong>With Code:</strong> ${data.manufacturersWithCode}<br>
                <strong>With Email:</strong> ${data.manufacturersWithEmail}<br>
                <strong>With Phone:</strong> ${data.manufacturersWithPhone}<br>
                <strong>With Address:</strong> ${data.manufacturersWithAddress}
              </div>
              <div class="col-md-6">
                <strong>Validation Issues:</strong> ${data.validationIssues.length}<br>
                <strong>Recommendations:</strong> ${data.recommendations.length}
              </div>
            </div>
          </div>
        `;
        
        if (data.validationIssues.length > 0) {
          integrityReport += `
            <div class="alert alert-warning">
              <h6><i class="fa fa-exclamation-triangle"></i> Validation Issues Found</h6>
              <ul>
          `;
          data.validationIssues.forEach(issue => {
            integrityReport += `<li><strong>${issue.name}</strong>: ${issue.errors.join(', ')}</li>`;
          });
          integrityReport += `</ul></div>`;
        }
        
        if (data.recommendations.length > 0) {
          integrityReport += `
            <div class="alert alert-info">
              <h6><i class="fa fa-lightbulb-o"></i> Recommendations</h6>
              <ul>
          `;
          data.recommendations.forEach(rec => {
            integrityReport += `<li>${rec}</li>`;
          });
          integrityReport += `</ul></div>`;
        }
        
        notiflix.Report.info(
          "Data Integrity Report",
          integrityReport,
          "Close"
        );
      }).fail(function() {
        notiflix.Report.failure(
          "Error",
          "Failed to generate integrity report",
          "Close"
        );
      });
    });

    // Manufacturer bulk import button
    $("#manufacturerBulkImportBtn").click(function () {
        $("#manufacturerBulkImport").modal("show");
    });





    // Download manufacturer template
    $("#downloadManufacturerTemplate").click(function() {
        const header = [
            'Name',
            'Code',
            'Address',
            'City',
            'State',
            'Country',
            'PostalCode',
            'Phone',
            'Email',
            'Website',
            'ContactPerson',
            'TaxId',
            'LicenseNumber',
            'RegistrationDate',
            'Status',
            'Notes'
        ].join(',');

        const rows = [
            ['Acme Pharmaceuticals','ACME','123 Pharma Street','New York','NY','USA','10001','+1-555-0123','info@acmepharma.com','www.acmepharma.com','John Smith','TAX123456','LIC789012','2020-01-15','active','Leading pharmaceutical company'],
            ['HealthCorp International','HEALTH','456 Wellness Avenue','Los Angeles','CA','USA','90210','+1-555-0456','contact@healthcorp.com','www.healthcorp.com','Jane Doe','TAX789012','LIC345678','2019-06-20','active','Global health solutions'],
            ['Wellness Labs','WELL','789 Health Boulevard','Chicago','IL','USA','60601','+1-555-0789','info@wellnesslabs.com','www.wellnesslabs.com','Mike Johnson','TAX456789','LIC901234','2021-03-10','active','Innovative wellness products']
        ].map(r => r.join(',')).join('\n');

        const csvContent = header + '\n' + rows;
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pharmaspot_manufacturers_template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    });

    // Manufacturer bulk import form submission
    $("#manufacturerBulkImportForm").submit(function (e) {
        e.preventDefault();
        
        const formData = new FormData(this);
        formData.append('skipDuplicates', $("#manufacturerSkipDuplicates").is(':checked'));
        formData.append('updateExisting', $("#manufacturerUpdateExisting").is(':checked'));
        
        console.log("Manufacturer bulk import parameters:");
        console.log("- Skip Duplicates:", $("#manufacturerSkipDuplicates").is(':checked'));
        console.log("- Update Existing:", $("#manufacturerUpdateExisting").is(':checked'));
        
        $("#submitManufacturerBulkImport").prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Importing...');
        $("#manufacturerImportProgress").show();
        $("#manufacturerImportStatus").text("Starting import...");
        
        $.ajax({
            url: api + "manufacturers/bulk-import",
            type: "POST",
            data: formData,
            processData: false,
            contentType: false,
            success: function (response) {
                $("#submitManufacturerBulkImport").prop('disabled', false).html('<i class="fa fa-upload"></i> Import Manufacturers');
                $("#manufacturerImportProgress").hide();
                
                if (response.success) {
                    let message = response.message;
                    if (response.errors && response.errors.length > 0) {
                        message += `\n\nErrors encountered:\n`;
                        response.errors.forEach(error => {
                            message += `Row ${error.row}: ${error.error}\n`;
                        });
                    }
                    
                    notiflix.Report.success(
                        "Import Completed",
                        message,
                        "OK"
                    );
                    
                    // Refresh manufacturers list
                    loadManufacturers();
                    
                    // Close modal
                    $("#manufacturerBulkImport").modal("hide");
                    
                    // Reopen Manufacturers modal to show updated list
                    $("#Manufacturers").modal("show");
                }
            },
            error: function (jqXHR, textStatus, errorThrown) {
                $("#submitManufacturerBulkImport").prop('disabled', false).html('<i class="fa fa-upload"></i> Import Manufacturers');
                $("#manufacturerImportProgress").hide();
                
                let errorMessage = "An error occurred during import.";
                if (jqXHR.responseJSON && jqXHR.responseJSON.message) {
                    errorMessage = jqXHR.responseJSON.message;
                }
                
                notiflix.Report.failure(
                    "Import Failed",
                    errorMessage,
                    "OK"
                );
            }
        });
    });

    // ========================================
    // SUPPLIER MANAGEMENT FUNCTIONS
    // ========================================

    function loadSuppliers() {
      // Fix: Call the suppliers API root route which should return suppliers data
      const suppliersUrl = api + "suppliers";
      
      $.get(suppliersUrl + "?_t=" + Date.now(), function (data) {
        
        // Ensure data is an array
        if (!Array.isArray(data)) {
          console.error("Suppliers API did not return an array:", data);
          allSuppliers = [];
        } else {
          allSuppliers = data;
        }
        
        loadSupplierList();
        
        // Also populate the supplier dropdown in product form
        $("#supplier").html(`<option value="">Select Supplier</option>`);
        if (allSuppliers.length > 0) {
          allSuppliers.forEach((supplier) => {
            $("#supplier").append(
              `<option value="${supplier.name}">${supplier.name}${supplier.code ? ` (${supplier.code})` : ''}</option>`,
            );
          });
        }
        
        // Note: Supplier filter removed from POS for simplicity
      }).fail(function (jqXHR, textStatus, errorThrown) {
        console.error("Failed to load suppliers:", errorThrown);
        console.error("Response:", jqXHR.responseText);
        allSuppliers = [];
        notiflix.Notify.failure("Failed to load suppliers");
      });
    }

    function loadSupplierList() {
      let supplier_list = "";
      let counter = 0;
      $("#supplier_list").empty();
      
      if ($.fn.DataTable.isDataTable('#supplierList')) {
        $("#supplierList").DataTable().destroy();
      }

      // Ensure allSuppliers is an array
      if (!Array.isArray(allSuppliers)) {
        console.error("allSuppliers is not an array:", allSuppliers);
        allSuppliers = [];
      }

      if (allSuppliers.length === 0) {
        supplier_list = `<tr>
          <td class="text-center text-muted">-</td>
          <td class="text-center text-muted">No suppliers found</td>
          <td class="text-center text-muted">-</td>
          <td class="text-center text-muted">-</td>
          <td class="text-center text-muted">-</td>
          <td class="text-center text-muted">-</td>
          <td class="text-center text-muted">-</td>
          <td class="text-center text-muted">Click "New Supplier" to add one</td>
        </tr>`;
      } else {
        allSuppliers.forEach((supplier, index) => {
          counter++;

          supplier_list += `<tr>
            <td>${supplier.code || '-'}</td>
            <td>${supplier.name}</td>
            <td>${supplier.contact || '-'}</td>
            <td>${supplier.email || '-'}</td>
            <td>${supplier.phone || '-'}</td>
            <td>${supplier.city || '-'}</td>
            <td><span class="label label-${supplier.status === 'active' ? 'success' : 'warning'}">${supplier.status}</span></td>
            <td>
              <span class="btn-group">
                <button class="btn btn-warning btn-xs edit-supplier-btn" data-index="${index}" title="Edit">
                  <i class="fa fa-edit"></i>
                </button>
                <button class="btn btn-danger btn-xs delete-supplier-btn" data-supplier-id="${supplier._id}" title="Delete">
                  <i class="fa fa-trash"></i>
                </button>
              </span>
            </td>
          </tr>`;
        });
      }

      $("#supplier_list").html(supplier_list);

      // Initialize DataTable
      $("#supplierList").DataTable({
        responsive: true,
        pageLength: 10,
        order: [[1, 'asc']], // Sort by name
        columnDefs: [
          { targets: [0, 2, 3, 4, 5], orderable: false }, // Disable sorting for some columns
          { targets: [7], orderable: false, searchable: false } // Action column
        ]
      });
    }

    // Event handlers for supplier action buttons
    $(document).on('click', '.edit-supplier-btn', function() {
      const index = $(this).data('index');
      $.fn.editSupplier(index);
    });

    $(document).on('click', '.delete-supplier-btn', function() {
      const supplierId = $(this).data('supplier-id');
      $.fn.deleteSupplier(supplierId);
    });

    // Supplier form submission
    $("#saveSupplier").submit(function (e) {
      e.preventDefault();
      
      // Validate supplier data based on settings
      if (!validateSupplierData()) {
        return false;
      }

      let method;
      if ($("#supplier_id").val() == "") {
        method = "POST";
      } else {
        method = "PUT";
      }

      $.ajax({
        type: method,
        url: api + "suppliers/supplier" + ($("#supplier_id").val() ? "/" + $("#supplier_id").val() : ""),
        data: $(this).serialize(),
        success: function (data, textStatus, jqXHR) {
          // Handle new detailed success messages
          if (data && data.success && data.message) {
            notiflix.Notify.success(data.message);
          }
          
          $("#saveSupplier").get(0).reset();
          $("#supplier_id").val("");
          $("#supplierStatus").val("active");
          $("#submitSupplier").val("Create Supplier");
          
          loadSuppliers();
          
          // If editing from product form, refresh the supplier dropdown
          if ($("#supplier").length > 0) {
            loadSuppliers();
          }
          
          diagOptions = {
            title: "Supplier Saved",
            text: "Select an option below to continue.",
            okButtonText: "Add another",
            cancelButtonText: "Close",
          };

          notiflix.Confirm.show(
            diagOptions.title,
            diagOptions.text,
            diagOptions.okButtonText,
            diagOptions.cancelButtonText,
            ()=>{},
            () => {
                $("#newSupplier").modal("hide");
            },
          );
        },
        error: function (jqXHR, textStatus, errorThrown) {
          let errorMessage = "An error occurred while saving the supplier.";
          if (jqXHR.responseJSON && jqXHR.responseJSON.message) {
            errorMessage = jqXHR.responseJSON.message;
          }
          notiflix.Report.failure("Error", errorMessage, "Ok");
        }
      });
    });

    $.fn.editSupplier = function (index) {
      $("#Suppliers").modal("hide");
      
      let supplier = allSuppliers[index];
      
      $("#supplier_id").val(supplier._id);
      $("#supplierName").val(supplier.name);
      $("#supplierCode").val(supplier.code || "");
      $("#supplierContact").val(supplier.contact || "");
      $("#supplierEmail").val(supplier.email || "");
      $("#supplierPhone").val(supplier.phone || "");
      $("#supplierAddress").val(supplier.address || "");
      $("#supplierCity").val(supplier.city || "");
      $("#supplierState").val(supplier.state || "");
      $("#supplierCountry").val(supplier.country || "");
      $("#supplierPostalCode").val(supplier.postalCode || "");
      $("#supplierWebsite").val(supplier.website || "");
      $("#supplierStatus").val(supplier.status || "active");
      $("#supplierNotes").val(supplier.notes || "");
      
      $("#submitSupplier").val("Update Supplier");
      $("#newSupplier").modal("show");
    };

    $.fn.deleteSupplier = function (supplierId) {
      notiflix.Confirm.show(
        "Delete Supplier",
        "Are you sure you want to delete this supplier? This action cannot be undone.",
        "Delete",
        "Cancel",
        () => {
          $.ajax({
            type: "DELETE",
            url: api + "suppliers/supplier/" + supplierId,
            success: function (data, textStatus, jqXHR) {
              // Handle new detailed success messages
              if (data && data.success && data.message) {
                notiflix.Notify.success(data.message);
              } else {
                notiflix.Notify.success("Supplier deleted successfully");
              }
              loadSuppliers();
            },
            error: function (jqXHR, textStatus, errorThrown) {
              let errorMessage = "An error occurred while deleting the supplier.";
              if (jqXHR.responseJSON && jqXHR.responseJSON.message) {
                errorMessage = jqXHR.responseJSON.message;
              }
              notiflix.Report.failure("Error", errorMessage, "Ok");
            }
          });
        }
      );
    }

    // Supplier search functionality
    $("#supplierSearch").on("input", function() {
      const searchTerm = $(this).val().toLowerCase();
      const table = $("#supplierList").DataTable();
      table.search(searchTerm).draw();
    });

    $("#supplierSearchBtn").on("click", function() {
      const searchTerm = $("#supplierSearch").val().toLowerCase();
      const table = $("#supplierList").DataTable();
      table.search(searchTerm).draw();
    });

    $("#refreshSuppliers").on("click", function() {
      loadSuppliers();
    });

    // Enhanced Progress Bar Manager for Bulk Imports
    class ImportProgressManager {
        constructor() {
            this.startTime = null;
            this.currentProgress = 0;
            this.totalItems = 0;
            this.processedItems = 0;
            this.currentOperation = '';
            this.isRunning = false;
            this.interval = null;
        }

        start(totalItems, operation = 'Import') {
            this.startTime = Date.now();
            this.totalItems = totalItems;
            this.processedItems = 0;
            this.currentOperation = operation;
            this.isRunning = true;
            this.currentProgress = 0;
            
            this.updateDisplay();
            this.startProgressAnimation();
        }

        updateProgress(processed, operation = null) {
            this.processedItems = processed;
            this.currentProgress = Math.round((processed / this.totalItems) * 100);
            if (operation) this.currentOperation = operation;
            
            this.updateDisplay();
        }

        updateDisplay() {
            const progressBar = $("#importProgress .progress-bar");
            const progressText = $("#progressText");
            const importStatus = $("#importStatus");
            const importDetails = $("#importDetails");
            const importCount = $("#importCount");
            const importSpeed = $("#importSpeed");

            // Update progress bar
            progressBar.css('width', this.currentProgress + '%');
            progressText.text(this.currentProgress + '%');

            // Update status text
            importStatus.text(this.currentOperation);

            // Update details
            importDetails.text(`Processing item ${this.processedItems} of ${this.totalItems}`);

            // Update count
            importCount.text(`${this.processedItems} / ${this.totalItems} items`);

            // Update speed and estimated time
            if (this.startTime && this.processedItems > 0) {
                const elapsed = (Date.now() - this.startTime) / 1000;
                const rate = this.processedItems / elapsed;
                const remainingItems = this.totalItems - this.processedItems;
                const estimatedTime = remainingItems / rate;
                
                importSpeed.text(`${rate.toFixed(1)} items/sec`);
                
                // Add estimated time to details if more than 5 seconds
                if (estimatedTime > 5) {
                    const minutes = Math.floor(estimatedTime / 60);
                    const seconds = Math.floor(estimatedTime % 60);
                    if (minutes > 0) {
                        importDetails.text(`Processing item ${this.processedItems} of ${this.totalItems} (${minutes}m ${seconds}s remaining)`);
                    } else {
                        importDetails.text(`Processing item ${this.processedItems} of ${this.totalItems} (${seconds}s remaining)`);
                    }
                } else {
                    importDetails.text(`Processing item ${this.processedItems} of ${this.totalItems}`);
                }
            } else {
                importDetails.text(`Processing item ${this.processedItems} of ${this.totalItems}`);
            }

            // Update progress bar color based on progress
            if (this.currentProgress < 25) {
                progressBar.removeClass('progress-bar-success progress-bar-warning').addClass('progress-bar-danger');
            } else if (this.currentProgress < 75) {
                progressBar.removeClass('progress-bar-danger progress-bar-success').addClass('progress-bar-warning');
            } else {
                progressBar.removeClass('progress-bar-danger progress-bar-warning').addClass('progress-bar-success');
            }

            // Save progress to localStorage for persistence
            this.saveProgress();
        }

        saveProgress() {
            const progressData = {
                currentProgress: this.currentProgress,
                processedItems: this.processedItems,
                totalItems: this.totalItems,
                currentOperation: this.currentOperation,
                startTime: this.startTime,
                timestamp: Date.now()
            };
            localStorage.setItem('importProgress', JSON.stringify(progressData));
        }

        loadProgress() {
            const savedProgress = localStorage.getItem('importProgress');
            if (savedProgress) {
                try {
                    const progressData = JSON.parse(savedProgress);
                    const timeDiff = Date.now() - progressData.timestamp;
                    
                    // Only restore progress if it's recent (within last 5 minutes)
                    if (timeDiff < 5 * 60 * 1000) {
                        this.currentProgress = progressData.currentProgress;
                        this.processedItems = progressData.processedItems;
                        this.totalItems = progressData.totalItems;
                        this.currentOperation = progressData.currentOperation;
                        this.startTime = progressData.startTime;
                        return true;
                    }
                } catch (e) {
                    console.log('Could not parse saved progress:', e);
                }
            }
            return false;
        }

        clearProgress() {
            localStorage.removeItem('importProgress');
        }

        startProgressAnimation() {
            this.interval = setInterval(() => {
                if (this.isRunning && this.currentProgress < 100) {
                    // Simulate progress for better UX
                    const remaining = 100 - this.currentProgress;
                    const increment = Math.min(remaining * 0.1, 2);
                    this.currentProgress = Math.min(100, this.currentProgress + increment);
                    this.updateDisplay();
                }
            }, 500);
        }

        complete() {
            this.isRunning = false;
            this.currentProgress = 100;
            this.processedItems = this.totalItems;
            this.currentOperation = 'Import completed';
            
            if (this.interval) {
                clearInterval(this.interval);
                this.interval = null;
            }
            
            this.clearProgress();
            this.updateDisplay();
            
            // Add completion animation
            $("#importProgress .progress-bar").addClass('progress-animation');
            setTimeout(() => {
                $("#importProgress .progress-bar").removeClass('progress-animation');
            }, 2000);
        }

        error(message) {
            this.isRunning = false;
            this.currentOperation = 'Import failed: ' + message;
            
            if (this.interval) {
                clearInterval(this.interval);
                this.interval = null;
            }
            
            this.updateDisplay();
            
            // Show error state
            $("#importProgress .progress-bar").removeClass('progress-bar-success progress-bar-warning').addClass('progress-bar-danger');
        }

        reset() {
            this.isRunning = false;
            this.currentProgress = 0;
            this.processedItems = 0;
            this.currentOperation = '';
            
            if (this.interval) {
                clearInterval(this.interval);
                this.interval = null;
            }
            
            this.clearProgress();
            this.updateDisplay();
        }
    }

             // Initialize progress manager
    const importProgressManager = new ImportProgressManager();

    // Utility function to ensure dropdowns are populated
    function ensureDropdownsPopulated() {
      return new Promise((resolve) => {
        let manufacturersLoaded = allManufacturers && allManufacturers.length > 0;
        let suppliersLoaded = allSuppliers && allSuppliers.length > 0;
        
        if (manufacturersLoaded && suppliersLoaded) {
          resolve();
          return;
        }
        
        const promises = [];
        
        if (!manufacturersLoaded) {
          promises.push(
            new Promise((resolveManufacturer) => {
              $.get(api + "manufacturers/all?_t=" + Date.now(), function (data) {
                allManufacturers = data;
                console.log(`Loaded ${allManufacturers.length} manufacturers`);
                
                // Populate manufacturer dropdown
                $("#manufacturer").html(`<option value="">Select Manufacturer</option>`);
                allManufacturers.forEach((manufacturer) => {
                  $("#manufacturer").append(
                    `<option value="${manufacturer.name}">${manufacturer.name}${manufacturer.code ? ` (${manufacturer.code})` : ''}</option>`,
                  );
                });
                resolveManufacturer();
              }).fail(() => resolveManufacturer());
            })
          );
        }
        
        if (!suppliersLoaded) {
          promises.push(
            new Promise((resolveSupplier) => {
              $.get(api + "suppliers?_t=" + Date.now(), function (data) {
                allSuppliers = data;
                console.log(`Loaded ${allSuppliers.length} suppliers`);
                
                // Populate supplier dropdown
                $("#supplier").html(`<option value="">Select Supplier</option>`);
                allSuppliers.forEach((supplier) => {
                  $("#supplier").append(
                    `<option value="${supplier.name}">${supplier.name}${supplier.code ? ` (${supplier.code})` : ''}</option>`,
                  );
                });
                resolveSupplier();
              }).fail(() => resolveSupplier());
            })
          );
        }
        
        Promise.all(promises).then(resolve);
      });
    }

     // Bulk Import Modal Event Handlers
     $("#bulkImport").on("shown.bs.modal", function() {
         // Try to restore progress if available
         if (importProgressManager.loadProgress()) {
             $("#importProgress").show();
             importProgressManager.updateDisplay();
             console.log("Restored import progress from previous session");
         }
     });

     $("#bulkImport").on("hidden.bs.modal", function() {
         // Clear progress when modal is closed
         importProgressManager.clearProgress();
     });

     // Enhanced UX: Auto-focus and keyboard navigation for Suppliers modal
    $("#newSupplier").on("shown.bs.modal", function () {
      // Auto-focus on the supplier name field
      $("#supplierName").focus();
      
      // Add keyboard shortcuts for the modal
      $(this).off("keydown.modal").on("keydown.modal", function (e) {
        // Enter key submits the form
        if (e.keyCode === 13 && !$(e.target).is("textarea, select")) {
          e.preventDefault();
          $("#saveSupplier").submit();
        }
        
        // Escape key closes the modal
        if (e.keyCode === 27) {
          $("#newSupplier").modal("hide");
        }
      });

      // Add helpful hints for code generation
      if (!$("#supplierCodeHint").length) {
        $("#supplierCode").after('<small class="code-field-hint" id="supplierCodeHint">Code will be auto-generated when you enter the supplier name</small>');
      }
    });

    // Enhanced UX: Tab navigation and form validation feedback for Suppliers
    $("#saveSupplier input, #saveSupplier select, #saveSupplier textarea").on("keydown", function (e) {
      // Shift+Enter moves to previous field
      if (e.keyCode === 13 && e.shiftKey) {
        e.preventDefault();
        $(this).closest(".form-group").prev().find("input, select, textarea").focus();
      }
      
      // Enter moves to next field (except for submit button)
      if (e.keyCode === 13 && !e.shiftKey && !$(this).is("#submitSupplier")) {
        e.preventDefault();
        $(this).closest(".form-group").next().find("input, select, textarea").focus();
      }
    });

    // Enhanced UX: Visual feedback for form validation for Suppliers
    $("#saveSupplier input, #saveSupplier select, #saveSupplier textarea").on("blur", function () {
      const $field = $(this);
      const $formGroup = $field.closest(".form-group");
      
      // Remove previous validation states
      $formGroup.removeClass("has-success has-error");
      
      // Add success state for filled required fields
      if ($field.attr("required") && $field.val().trim()) {
        $formGroup.addClass("has-success");
      }
      
      // Add error state for empty required fields
      if ($field.attr("required") && !$field.val().trim()) {
        $formGroup.addClass("has-error");
      }
    });

    // Supplier modal events
    $("#newSupplierModal").on("click", function() {
      $("#supplier_id").val("");
      $("#saveSupplier").get(0).reset();
      $("#supplierStatus").val("active");
      $("#submitSupplier").val("Create Supplier");
    });

    $("#supplierModal").on("click", function() {
      loadSuppliers();
    });

    // New Supplier button from product form
    $("#newSupplierFromProduct").click(function() {
      $("#newSupplier").modal("show");
    });

    // Supplier reports button
    $("#supplierReportsBtn").click(function() {
      // Show reports modal with tabs
      showSupplierReports();
    });

    // Function to show supplier reports
    function showSupplierReports() {
      // Create modal content dynamically
      let modalContent = `
        <div class="modal fade" id="supplierReportsModal" tabindex="-1" role="dialog">
          <div class="modal-dialog modal-lg">
            <div class="modal-content">
              <div class="modal-header">
                <h4 class="modal-title"><i class="fa fa-chart-bar"></i> Supplier Reports</h4>
                <button type="button" class="close" data-dismiss="modal">&times;</button>
              </div>
              <div class="modal-body">
                <ul class="nav nav-tabs" role="tablist">
                  <li class="nav-item">
                    <a class="nav-link active" data-toggle="tab" href="#supplierPerformanceTab">Performance</a>
                  </li>
                  <li class="nav-item">
                    <a class="nav-link" data-toggle="tab" href="#supplierDirectoryTab">Directory</a>
                  </li>
                  <li class="nav-item">
                    <a class="nav-link" data-toggle="tab" href="#supplierIntegrityTab">Integrity</a>
                  </li>
                </ul>
                <div class="tab-content mt-3">
                  <div id="supplierPerformanceTab" class="tab-pane active">
                    <div id="supplierPerformanceContent">Loading...</div>
                  </div>
                  <div id="supplierDirectoryTab" class="tab-pane">
                    <div id="supplierDirectoryContent">Loading...</div>
                  </div>
                  <div id="supplierIntegrityTab" class="tab-pane">
                    <div id="supplierIntegrityContent">Loading...</div>
                  </div>
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
              </div>
            </div>
          </div>
        </div>
      `;
      
      // Remove existing modal if any
      $("#supplierReportsModal").remove();
      
      // Add modal to body
      $("body").append(modalContent);
      
      // Show modal
      $("#supplierReportsModal").modal("show");
      
      // Load data for each tab
      loadSupplierPerformanceMetrics();
      loadSupplierDirectory();
      loadSupplierIntegrityData();
    }

    function loadSupplierPerformanceMetrics() {
              $.get(api.replace(/\/$/, '') + "/suppliers/performance", function(data) {
        let content = `
          <div class="row">
            <div class="col-md-6">
              <div class="card">
                <div class="card-header">
                  <h5><i class="fa fa-chart-pie"></i> Overview</h5>
                </div>
                <div class="card-body">
                  <p><strong>Total Suppliers:</strong> ${data.totalSuppliers}</p>
                  <p><strong>Active:</strong> ${data.activeSuppliers}</p>
                  <p><strong>Inactive:</strong> ${data.inactiveSuppliers}</p>
                </div>
              </div>
            </div>
            <div class="col-md-6">
              <div class="card">
                <div class="card-header">
                  <h5><i class="fa fa-info-circle"></i> Data Quality</h5>
                </div>
                <div class="card-body">
                  <p><strong>With Code:</strong> ${data.completionRate.withCode}%</p>
                  <p><strong>With Contact:</strong> ${data.completionRate.withContact}%</p>
                  <p><strong>With Email:</strong> ${data.completionRate.withEmail}%</p>
                  <p><strong>With Phone:</strong> ${data.completionRate.withPhone}%</p>
                  <p><strong>With Address:</strong> ${data.completionRate.withAddress}%</p>
                </div>
              </div>
            </div>
          </div>
        `;
        
        $("#supplierPerformanceContent").html(content);
      }).fail(function() {
        $("#supplierPerformanceContent").html('<div class="alert alert-danger">Failed to load performance metrics</div>');
      });
    }

    function loadSupplierDirectory() {
              $.get(api.replace(/\/$/, '') + "/suppliers/directory", function(data) {
        let content = `
          <div class="table-responsive">
            <table class="table table-striped">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>City</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
        `;
        
        data.suppliers.forEach(supplier => {
          content += `
            <tr>
              <td><strong>${supplier.name}</strong>${supplier.code ? ` (${supplier.code})` : ''}</td>
              <td>${supplier.contact || '-'}</td>
              <td>${supplier.phone || '-'}</td>
              <td>${supplier.email || '-'}</td>
              <td>${supplier.city || '-'}</td>
              <td><span class="label label-${supplier.status === 'active' ? 'success' : 'warning'}">${supplier.status}</span></td>
            </tr>
          `;
        });
        
        content += `
              </tbody>
            </table>
          </div>
        `;
        
        $("#supplierDirectoryContent").html(content);
      }).fail(function() {
        $("#supplierDirectoryContent").html('<div class="alert alert-danger">Failed to load contact directory</div>');
      });
    }

          function loadSupplierIntegrityData() {
        $.get(api.replace(/\/$/, '') + "/suppliers/integrity-report", function(data) {
        let content = `
          <div class="alert alert-info">
            <h5><i class="fa fa-shield"></i> Data Integrity Summary</h5>
            <div class="row">
              <div class="col-md-6">
                <strong>Total Suppliers:</strong> ${data.totalSuppliers}<br>
                <strong>Active:</strong> ${data.activeSuppliers}<br>
                <strong>Inactive:</strong> ${data.inactiveSuppliers}<br>
                <strong>With Code:</strong> ${data.suppliersWithCode}<br>
                <strong>With Contact:</strong> ${data.suppliersWithContact}<br>
                <strong>With Email:</strong> ${data.suppliersWithEmail}<br>
                <strong>With Phone:</strong> ${data.suppliersWithPhone}<br>
                <strong>With Address:</strong> ${data.suppliersWithAddress}
              </div>
              <div class="col-md-6">
                <strong>Validation Issues:</strong> ${data.validationIssues.length}<br>
                <strong>Recommendations:</strong> ${data.recommendations.length}
              </div>
            </div>
          </div>
        `;
        
        if (data.validationIssues.length > 0) {
          content += `
            <div class="alert alert-warning">
              <h6><i class="fa fa-exclamation-triangle"></i> Validation Issues Found</h6>
              <ul>
          `;
          data.validationIssues.forEach(issue => {
            content += `<li>${issue}</li>`;
          });
          content += `</ul></div>`;
        }
        
        if (data.recommendations.length > 0) {
          content += `
            <div class="alert alert-info">
              <h6><i class="fa fa-lightbulb-o"></i> Recommendations</h6>
              <ul>
          `;
          data.recommendations.forEach(rec => {
            content += `<li>${rec}</li>`;
          });
          content += `</ul></div>`;
        }
        
        $("#supplierIntegrityContent").html(content);
      }).fail(function() {
        $("#supplierIntegrityContent").html('<div class="alert alert-danger">Failed to load integrity data</div>');
      });
    }

    // Supplier export button
    $("#supplierExportBtn").click(function() {
              window.open(api.replace(/\/$/, '') + "/suppliers/export", "_blank");
    });

    // Supplier integrity check button
    $("#supplierIntegrityBtn").click(function() {
              $.get(api.replace(/\/$/, '') + "/suppliers/integrity-report", function(data) {
        let integrityReport = `
          <div class="alert alert-info">
            <h5><i class="fa fa-shield"></i> Data Integrity Report</h5>
            <div class="row">
              <div class="col-md-6">
                <strong>Total Suppliers:</strong> ${data.totalSuppliers}<br>
                <strong>Active:</strong> ${data.activeSuppliers}<br>
                <strong>Inactive:</strong> ${data.inactiveSuppliers}<br>
                <strong>With Code:</strong> ${data.suppliersWithCode}<br>
                <strong>With Email:</strong> ${data.suppliersWithEmail}<br>
                <strong>With Phone:</strong> ${data.suppliersWithPhone}<br>
                <strong>With Address:</strong> ${data.suppliersWithAddress}
              </div>
              <div class="col-md-6">
                <strong>Validation Issues:</strong> ${data.validationIssues.length}<br>
                <strong>Recommendations:</strong> ${data.recommendations.length}
              </div>
            </div>
          </div>
        `;
        
        if (data.validationIssues.length > 0) {
          integrityReport += `
            <div class="alert alert-warning">
              <h6><i class="fa fa-exclamation-triangle"></i> Validation Issues Found</h6>
              <ul>
          `;
          data.validationIssues.forEach(issue => {
            integrityReport += `<li>${issue}</li>`;
          });
          integrityReport += `</ul></div>`;
        }
        
        if (data.recommendations.length > 0) {
          integrityReport += `
            <div class="alert alert-info">
              <h6><i class="fa fa-lightbulb-o"></i> Recommendations</h6>
              <ul>
          `;
          data.recommendations.forEach(rec => {
            integrityReport += `<li>${rec}</li>`;
          });
          integrityReport += `</ul></div>`;
        }
        
        notiflix.Report.info(
          "Data Integrity Report",
          integrityReport,
          "Close"
        );
      }).fail(function() {
        notiflix.Report.failure(
          "Error",
          "Failed to generate integrity report",
          "Close"
        );
      });
    });

    // Supplier bulk import button
    $("#supplierBulkImportBtn").click(function () {
        $("#supplierBulkImport").modal("show");
    });

    // Supplier bulk import form submission
    $("#supplierBulkImportForm").submit(function (e) {
        e.preventDefault();
        
        let formData = new FormData();
        formData.append('csvFile', $("#supplierCsvFile")[0].files[0]);
        formData.append('skipDuplicates', $("#supplierSkipDuplicates").is(':checked'));
        formData.append('updateExisting', $("#supplierUpdateExisting").is(':checked'));
        
        $("#submitSupplierBulkImport").prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Importing...');
        $("#supplierImportProgress").show();
        $("#supplierImportStatus").text("Processing...");
        
        $.ajax({
            url: api.replace(/\/$/, '') + "/suppliers/bulk-import",
            type: "POST",
            data: formData,
            processData: false,
            contentType: false,
            success: function (response) {
                $("#submitSupplierBulkImport").prop('disabled', false).html('<i class="fa fa-upload"></i> Import Suppliers');
                $("#supplierImportProgress").hide();
                
                if (response.success) {
                    let message = response.message;
                    if (response.errors && response.errors.length > 0) {
                        message += `\n\nErrors encountered:\n`;
                        response.errors.forEach(error => {
                            message += `${error}\n`;
                        });
                    }
                    
                    notiflix.Report.success(
                        "Import Completed",
                        message,
                        "OK"
                    );
                    
                    // Refresh suppliers list
                    loadSuppliers();
                    
                    // Close modal
                    $("#supplierBulkImport").modal("hide");
                    
                    // Reopen Suppliers modal to show updated list
                    $("#Suppliers").modal("show");
                }
            },
            error: function (jqXHR, textStatus, errorThrown) {
                $("#submitSupplierBulkImport").prop('disabled', false).html('<i class="fa fa-upload"></i> Import Suppliers');
                $("#supplierImportProgress").hide();
                
                let errorMessage = "An error occurred during import.";
                if (jqXHR.responseJSON && jqXHR.responseJSON.message) {
                    errorMessage = jqXHR.responseJSON.message;
                }
                
                notiflix.Report.failure(
                    "Import Failed",
                    errorMessage,
                    "OK"
                );
            }
        });
    });

    // Download supplier template
    $("#downloadSupplierTemplate").click(function() {
        const header = [
            'Name',
            'Code',
            'Contact',
            'Email',
            'Phone',
            'Address',
            'City',
            'State',
            'Country',
            'PostalCode',
            'Website',
            'Notes',
            'Status'
        ];
        
        const sampleData = [
            'ABC Pharmaceuticals',
            'ABC',
            'John Smith',
            'john@abcpharma.com',
            '+1-555-0123',
            '123 Main Street',
            'New York',
            'NY',
            'USA',
            '10001',
            'https://abcpharma.com',
            'Primary supplier for antibiotics',
            'active'
        ];
        
        let csvContent = header.join(',') + '\n' + sampleData.join(',');
        
        // Create download link
        let blob = new Blob([csvContent], { type: 'text/csv' });
        let url = window.URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url;
        a.download = 'suppliers_template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    });

    // ========================================
    // END SUPPLIER MANAGEMENT FUNCTIONS
    // ========================================

    $.fn.editProduct = function (index) {
      $("#Products").modal("hide");

      // Get the product data
      const product = allProducts[index];
      if (!product) {
        console.error("Product not found for index:", index);
        notiflix.Notify.failure("Product data not found");
        return;
      }

      // Function to populate the form after manufacturers are loaded
      const populateForm = () => {
        // Validate that dropdowns are populated
        const manufacturerOptions = $("#manufacturer option").length;
        const supplierOptions = $("#supplier option").length;
        
        console.log(`Dropdown validation:`, {
          manufacturerOptions,
          supplierOptions,
          allManufacturers: allManufacturers ? allManufacturers.length : 'undefined',
          allSuppliers: allSuppliers ? allSuppliers.length : 'undefined'
        });
        
        if (manufacturerOptions <= 1) {
          console.warn("Manufacturer dropdown not properly populated, retrying...");
          loadManufacturers();
          setTimeout(() => populateForm(), 500);
          return;
        }
        
        if (supplierOptions <= 1) {
          console.warn("Supplier dropdown not properly populated, retrying...");
          loadSuppliers();
          setTimeout(() => populateForm(), 500);
          return;
        }
        // Set category
      $("#category option")
        .filter(function () {
            return $(this).val() == product.category;
        })
        .prop("selected", true);

        // Set basic product fields
        $("#productName").val(product.name);
        $("#product_price").val(product.price);
        $("#quantity").val(product.quantity);
        $("#barcode").val(product.barcode || product._id);
        $("#expirationDate").val(product.expirationDate);
        $("#minStock").val(product.minStock || 1);
        $("#genericName").val(product.genericName || "");
        $("#batchNumber").val(product.batchNumber || "");
        $("#actual_price").val(product.actualPrice || "");
        $("#product_id").val(product._id);
        $("#img").val(product.img);

        // Handle manufacturer - check if it's an ID or name
        if (product.manufacturer) {
          const manufacturerValue = product.manufacturer;
          console.log(`Processing manufacturer for product ${index}:`, {
            manufacturerValue,
            manufacturerType: typeof manufacturerValue,
            allManufacturers: allManufacturers ? allManufacturers.length : 'undefined'
          });
          
          // Debug: Check what options are available in the dropdown
          const manufacturerOptions = $("#manufacturer option").map(function() {
            return { value: $(this).val(), text: $(this).text() };
          }).get();
          console.log(`Available manufacturer options:`, manufacturerOptions);
          
          // Try to find by ID first, then by name
          const manufacturerById = allManufacturers.find(m => m._id == manufacturerValue);
          const manufacturerByName = allManufacturers.find(m => m.name === manufacturerValue);
          
          console.log(`Manufacturer lookup results:`, {
            manufacturerById,
            manufacturerByName,
            searchValue: manufacturerValue
          });
          
          const finalManufacturer = manufacturerById || manufacturerByName;
          if (finalManufacturer) {
            $("#manufacturer").val(finalManufacturer.name);
            console.log(`Set manufacturer to: ${finalManufacturer.name}`);
            
            // Debug: Check if the value was set correctly
            const actualValue = $("#manufacturer").val();
            console.log(`Manufacturer field value after setting:`, actualValue);
          } else {
            $("#manufacturer").val(manufacturerValue);
            console.log(`Set manufacturer to original value: ${manufacturerValue}`);
            
            // Debug: Check if the value was set correctly
            const actualValue = $("#manufacturer").val();
            console.log(`Manufacturer field value after setting:`, actualValue);
          }
        } else {
          $("#manufacturer").val("");
        }

        // Handle supplier - check if it's an ID or name
        if (product.supplier) {
          const supplierValue = product.supplier;
          console.log(`Processing supplier for product ${index}:`, {
            supplierValue,
            supplierType: typeof supplierValue,
            allSuppliers: allSuppliers ? allSuppliers.length : 'undefined'
          });
          
          // Try to find by ID first, then by name
          const supplierById = allSuppliers.find(s => s._id == supplierValue);
          const supplierByName = allSuppliers.find(s => s.name === supplierValue);
          
          console.log(`Supplier lookup results:`, {
            supplierById,
            supplierByName,
            searchValue: supplierValue
          });
          
          const finalSupplier = supplierById || supplierByName;
          if (finalSupplier) {
            $("#supplier").val(finalSupplier.name);
            console.log(`Set supplier to: ${finalSupplier.name}`);
          } else {
            $("#supplier").val(supplierValue);
            console.log(`Set supplier to original value: ${supplierValue}`);
          }
        } else {
          $("#supplier").val("");
        }

        // Handle image
        if (product.img && product.img !== "") {
        $("#imagename").hide();
        $("#current_img").html(
            `<img src="${img_path + product.img}" alt="">`,
        );
        $("#rmv_img").show();
        } else {
          $("#imagename").show();
          $("#current_img").html("");
          $("#rmv_img").hide();
      }

        // Handle stock status
        if (product.stock == 0) {
        $("#stock").prop("checked", true);
        } else {
          $("#stock").prop("checked", false);
      }

        // Show the modal
      $("#newProduct").modal("show");
      };

      // Ensure dropdowns are populated before proceeding
      ensureDropdownsPopulated().then(() => {
        console.log("Dropdowns populated, now populating form");
        populateForm();
      }).catch((error) => {
        console.error("Failed to populate dropdowns:", error);
        // Still try to populate form with available data
        populateForm();
      });
    };

    $("#userModal").on("hide.bs.modal", function () {
      $(".perms").hide();
    });

    $.fn.editUser = function (index) {
      user_index = index;

      $("#Users").modal("hide");

      $(".perms").show();

      $("#user_id").val(allUsers[index]._id);
      $("#fullname").val(allUsers[index].fullname);
      $("#username").val(validator.unescape(allUsers[index].username));
      $("#password").attr("placeholder", "New Password");
    

      for (perm of permissions) {
        var el = "#" + perm;
        if (allUsers[index][perm] == 1) {
          $(el).prop("checked", true);
        } else {
          $(el).prop("checked", false);
        }
      }

      $("#userModal").modal("show");
    };

    $.fn.editCategory = function (index) {
      $("#Categories").modal("hide");
      $("#categoryName").val(allCategories[index].name);
      $("#category_id").val(allCategories[index]._id);
      $("#newCategory").modal("show");
    };

    $.fn.deleteProduct = function (id) {
      diagOptions = {
        title: "Are you sure?",
        text: "You are about to delete this product.",
        okButtonText: "Yes, delete it!",
        cancelButtonText: "Cancel",
      };

      notiflix.Confirm.show(
        diagOptions.title,
        diagOptions.text,
        diagOptions.okButtonText,
        diagOptions.cancelButtonText,
        () => {
          $.ajax({
            url: api + "inventory/product/" + id,
            type: "DELETE",
            success: function (result) {
              loadProducts();
              // Handle new detailed success messages
              if (result && result.success && result.message) {
                notiflix.Notify.success(result.message);
              } else {
                notiflix.Notify.success("Product deleted successfully");
              }
            },
          });
        },
      );
    };

    $.fn.deleteUser = function (id) {
      diagOptions = {
        title: "Are you sure?",
        text: "You are about to delete this user.",
        cancelButtonColor: "#d33",
        okButtonText: "Yes, delete!",
      };

      notiflix.Confirm.show(
        diagOptions.title,
        diagOptions.text,
        diagOptions.okButtonText,
        diagOptions.cancelButtonText,
        () => {
          $.ajax({
            url: api + "users/user/" + id,
            type: "DELETE",
            success: function (result) {
              loadUserList();
              notiflix.Report.success("Done!", "User deleted", "Ok");
            },
          });
        },
      );
    };

    $.fn.deleteCategory = function (id) {
      diagOptions = {
        title: "Are you sure?",
        text: "You are about to delete this category.",
        okButtonText: "Yes, delete it!",
      };

      notiflix.Confirm.show(
        diagOptions.title,
        diagOptions.text,
        diagOptions.okButtonText,
        diagOptions.cancelButtonText,
        () => {
          $.ajax({
            url: api + "categories/category/" + id,
            type: "DELETE",
            success: function (result) {
              loadCategories();
              // Handle new detailed success messages
              if (result && result.success && result.message) {
                notiflix.Notify.success(result.message);
              } else {
                notiflix.Notify.success("Category deleted successfully");
              }
            },
          });
        },
      );
    };

    $("#productModal").on("click", function () {
      loadProductList();
    });

    $("#usersModal").on("click", function () {
      loadUserList();
    });

    $("#categoryModal").on("click", function () {
      loadCategoryList();
    });

    // Bulk Import Modal
    $("#bulkImportModal").on("click", function () {
      // Load categories for default category dropdown
      loadCategories();
      $("#bulkImportForm").get(0).reset();
      $("#importProgress").hide();
      $("#importStatus").text("");
      // Close the Products modal when opening bulk import
      $("#Products").modal("hide");
    });

    // Bulk Remove Modal
    $("#bulkRemoveModal").on("click", function () {
      // Test API connection first
      testAPIConnection();
      // Load products for bulk removal selection
      loadBulkRemoveProducts();
      // Close the Products modal when opening bulk remove
      $("#Products").modal("hide");
    });

    // Download CSV Template
    $("#downloadTemplate").on("click", function () {
      const header = [
        'Name',
        'Barcode',
        'SellingPrice',
        'PurchasePrice',
        'GenericName',
        'Manufacturer',
        'Supplier',
        'BatchNumber',
        'Category',
        'Quantity',
        'MinStock',
        'ExpirationDate'
      ].join(',');

      const rows = [
        ['Paracetamol 500mg','123456789','5.99','4.20','Paracetamol','Acme Pharma','MediSuppliers Ltd','BATCH-001','Medicines','100','10','31/12/2025'],
        ['Ibuprofen 400mg','987654321','4.99','3.50','Ibuprofen','HealthCorp','MediSuppliers Ltd','BATCH-002','Medicines','50','5','30/06/2025'],
        ['Aspirin 100mg','456789123','3.99','2.60','Aspirin','Wellness Labs','','','', '75','8','31/03/2026']
      ].map(r => r.join(',')).join('\n');

      const csvContent = header + '\n' + rows;
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pharmaspot_products_template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    });

    // Bulk Import Form Submission
    $("#bulkImportForm").submit(function (e) {
      e.preventDefault();
      
      const formData = new FormData(this);
      formData.append('skipDuplicates', $("#skipDuplicates").is(':checked'));
      formData.append('updateExisting', $("#updateExisting").is(':checked'));
        formData.append('createManufacturers', $("#createManufacturers").is(':checked'));
        formData.append('createSuppliers', $("#createSuppliers").is(':checked'));
      
      // Get the selected default category value
      const defaultCategory = $("#defaultCategory").val();
      if (defaultCategory) {
        formData.append('defaultCategory', defaultCategory);
      }
      
      console.log("Bulk import parameters:");
      console.log("- Skip Duplicates:", $("#skipDuplicates").is(':checked'));
      console.log("- Update Existing:", $("#updateExisting").is(':checked'));
        console.log("- Create Manufacturers:", $("#createManufacturers").is(':checked'));
        console.log("- Create Suppliers:", $("#createSuppliers").is(':checked'));
      console.log("- Default Category:", defaultCategory);
      
      $("#submitBulkImport").prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Importing...');
      $("#importProgress").show();
      $("#cancelImport").show();
      
      // Start enhanced progress tracking
      importProgressManager.start(100, "Starting import...");
      
      // Start progress simulation
      window.progressSimulation = setInterval(() => {
        if (importProgressManager.isRunning) {
          const currentProgress = importProgressManager.currentProgress;
          if (currentProgress < 90) {
            importProgressManager.updateProgress(
              Math.min(importProgressManager.totalItems, 
              Math.floor(importProgressManager.totalItems * (currentProgress + 5) / 100)),
              "Processing products..."
            );
          }
        }
      }, 2000);

      // Store the AJAX request for potential cancellation
      window.currentImportRequest = $.ajax({
        url: api + "inventory/bulk-import",
        type: "POST",
        data: formData,
        processData: false,
        contentType: false,
        success: function (response) {
          // Clear progress simulation
          if (window.progressSimulation) {
            clearInterval(window.progressSimulation);
          }
          
          $("#submitBulkImport").prop('disabled', false).html('<i class="fa fa-upload"></i> Import Products');
          $("#importProgress").hide();
          $("#cancelImport").hide();
          
          // Complete progress tracking
          importProgressManager.complete();
          
          if (response.success) {
            let message = response.message;
            if (response.errors && response.errors.length > 0) {
              message += `\n\nErrors encountered:\n`;
              response.errors.forEach(error => {
                message += `Row ${error.row}: ${error.error}\n`;
              });
            }
            
            notiflix.Report.success(
              "Import Completed",
              message,
              "OK"
            );
            
          // Add a longer delay to ensure backend processing and database sync is complete
          setTimeout(() => {
            console.log("Starting to refresh lists after bulk import...");
            
            // Refresh all relevant lists with retry logic
            const refreshLists = (retryCount = 0) => {
              if (retryCount >= 3) {
                console.log("Max retries reached, closing modal...");
                $("#bulkImport").modal("hide");
                return;
              }
              
              console.log(`Refresh attempt ${retryCount + 1}/3`);
              
              // Refresh all relevant lists
              console.log("Refreshing products...");
             loadProducts();
             
              console.log("Refreshing categories...");
              loadCategories();
              
              console.log("Refreshing manufacturers...");
              loadManufacturers();
              
              console.log("Refreshing suppliers...");
              loadSuppliers();
              
              // Check if suppliers loaded successfully
              setTimeout(() => {
                if (allSuppliers && allSuppliers.length > 0) {
                  console.log("All lists refreshed successfully, closing modal...");
             $("#bulkImport").modal("hide");
                } else {
                  console.log(`Suppliers not loaded, retrying... (${retryCount + 1}/3)`);
                  refreshLists(retryCount + 1);
                }
              }, 2000); // Wait 2 seconds to check if data loaded
            };
            
            refreshLists();
          }, 2000); // 2 second delay
          }
        },
        error: function (jqXHR, textStatus, errorThrown) {
          // Clear progress simulation
          if (window.progressSimulation) {
            clearInterval(window.progressSimulation);
          }
          
          $("#submitBulkImport").prop('disabled', false).html('<i class="fa fa-upload"></i> Import Products');
          $("#importProgress").hide();
          $("#cancelImport").hide();
          
          // Show error in progress tracking
          let errorMessage = "An error occurred during import.";
          if (jqXHR.responseJSON && jqXHR.responseJSON.message) {
            errorMessage = jqXHR.responseJSON.message;
          }
          importProgressManager.error(errorMessage);
          
          notiflix.Report.failure(
            "Import Failed",
            errorMessage,
            "OK"
          );
        }
            });
     });

     // Cancel Import Functionality
     $("#cancelImport").on("click", function() {
         if (confirm("Are you sure you want to cancel the import? This action cannot be undone.")) {
             // Reset progress
             importProgressManager.reset();
             
             // Reset UI
             $("#submitBulkImport").prop('disabled', false).html('<i class="fa fa-upload"></i> Import Products');
             $("#importProgress").hide();
             $("#cancelImport").hide();
             
             // Clear progress simulation
             if (window.progressSimulation) {
                 clearInterval(window.progressSimulation);
             }
             
             // Abort any ongoing AJAX request
             if (window.currentImportRequest) {
                 window.currentImportRequest.abort();
                 window.currentImportRequest = null;
             }
             
             notiflix.Notify.info("Import cancelled successfully");
         }
     });

     // Bulk Remove Functions
     function loadBulkRemoveProducts() {
       $("#bulkRemoveProductList").empty();
       $("#selectedCount").text("0");
       $("#confirmBulkRemove").prop('disabled', true);
       
       let product_list = "";
       allProducts.forEach((product, index) => {
         let category = allCategories.filter(function (category) {
           return category._id == product.category;
         });
         
         product_list += `<tr>
           <td>
             <input type="checkbox" class="product-checkbox" value="${product._id}" data-product-name="${product.name}">
           </td>
           <td>${product.barcode || product._id}</td>
           <td>${product.name}</td>
           <td>${validator.unescape(settings.symbol)}${product.price}</td>
           <td>${product.stock == 1 ? product.quantity : "N/A"}</td>
           <td>${category.length > 0 ? category[0].name : ""}</td>
         </tr>`;
       });
       
       $("#bulkRemoveProductList").html(product_list);
       
       // Initialize checkboxes
       initializeBulkRemoveCheckboxes();
     }

     function initializeBulkRemoveCheckboxes() {
       // Select all checkbox
       $("#selectAllProducts").on("change", function() {
         const isChecked = $(this).is(":checked");
         $(".product-checkbox").prop("checked", isChecked);
         updateSelectedCount();
       });

       // Individual product checkboxes
       $(document).on("change", ".product-checkbox", function() {
         updateSelectedCount();
         
         // Update select all checkbox
         const totalCheckboxes = $(".product-checkbox").length;
         const checkedCheckboxes = $(".product-checkbox:checked").length;
         
         if (checkedCheckboxes === 0) {
           $("#selectAllProducts").prop("indeterminate", false).prop("checked", false);
         } else if (checkedCheckboxes === totalCheckboxes) {
           $("#selectAllProducts").prop("indeterminate", false).prop("checked", true);
         } else {
           $("#selectAllProducts").prop("indeterminate", true).prop("checked", false);
         }
       });
     }

     function updateSelectedCount() {
       const selectedCount = $(".product-checkbox:checked").length;
       $("#selectedCount").text(selectedCount);
       $("#confirmBulkRemove").prop('disabled', selectedCount === 0);
     }

     // Confirm Bulk Remove
     $("#confirmBulkRemove").on("click", function() {
       const selectedProducts = $(".product-checkbox:checked");
       
       if (selectedProducts.length === 0) {
         notiflix.Report.warning("No Selection", "Please select at least one product to remove.", "OK");
         return;
       }

       const productIds = [];
       const productNames = [];
       
       selectedProducts.each(function() {
         productIds.push($(this).val());
         productNames.push($(this).data("product-name"));
       });

       const confirmMessage = `Are you sure you want to permanently delete ${productIds.length} product(s)?\n\nThis action cannot be undone.`;
       
       notiflix.Confirm.show(
         "Confirm Bulk Removal",
         confirmMessage,
         "Yes, Remove All",
         "Cancel",
         function() {
           // User confirmed, proceed with bulk removal
           performBulkRemove(productIds, productNames);
         },
         function() {
           // User cancelled
         }
       );
     });

     // Test API connection
     function testAPIConnection() {
       console.log("Testing API connection...");
       $.ajax({
         url: api + "inventory/test",
         type: "POST",
         data: JSON.stringify({ test: "data" }),
         contentType: "application/json; charset=utf-8",
         success: function (response) {
           console.log("API test successful:", response);
         },
         error: function (jqXHR, textStatus, errorThrown) {
           console.error("API test failed:", jqXHR, textStatus, errorThrown);
         }
       });
     }

     function performBulkRemove(productIds, productNames) {
       $("#confirmBulkRemove").prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Removing...');
       
       console.log("Sending bulk remove request with product IDs:", productIds);
       console.log("Product names:", productNames);
       
       $.ajax({
         url: api + "inventory/bulk-remove",
         type: "POST",
         data: JSON.stringify({ productIds: productIds }),
         contentType: "application/json; charset=utf-8",
         cache: false,
         processData: false,
         success: function (response) {
           console.log("Bulk remove success response:", response);
           $("#confirmBulkRemove").prop('disabled', false).html('<i class="fa fa-trash"></i> Remove Selected Products');
           
           if (response.success) {
             let message = response.message;
             if (response.errors && response.errors.length > 0) {
               message += `\n\nErrors encountered:\n`;
               response.errors.forEach(error => {
                 message += `${error.productName || error.productId}: ${error.error}\n`;
               });
             }
             
             notiflix.Report.success(
               "Bulk Removal Completed",
               message,
               "OK"
             );
             
             // Refresh products list
             loadProducts();
             
             // Close modal
             $("#bulkRemove").modal("hide");
             
             // Reopen Products modal to show updated list
             $("#Products").modal("show");
           }
         },
         error: function (jqXHR, textStatus, errorThrown) {
           $("#confirmBulkRemove").prop('disabled', false).html('<i class="fa fa-trash"></i> Remove Selected Products');
           
           console.log("Bulk remove error details:");
           console.log("jqXHR:", jqXHR);
           console.log("textStatus:", textStatus);
           console.log("errorThrown:", errorThrown);
           console.log("Response text:", jqXHR.responseText);
           
           let errorMessage = "An error occurred during bulk removal.";
           if (jqXHR.responseJSON && jqXHR.responseJSON.message) {
             errorMessage = jqXHR.responseJSON.message;
           }
           
           notiflix.Report.failure(
             "Bulk Removal Failed",
             errorMessage,
             "OK"
           );
         }
       });
     }

    function loadUserList() {
      let counter = 0;
      let user_list = "";
      $("#user_list").empty();
      $("#userList").DataTable().destroy();

      $.get(api + "users/all", function (users) {
        allUsers = [...users];

        users.forEach((user, index) => {
          state = [];
          let class_name = "";

          if (user.status != "") {
            state = user.status.split("_");
            login_status = state[0];
            login_time = state[1];

            switch (login) {
              case "Logged In":
                class_name = "btn-default";

                break;
              case "Logged Out":
                class_name = "btn-light";
                break;
            }
          }

          counter++;
          user_list += `<tr>
            <td>${user.fullname}</td>
            <td>${user.username}</td>
            <td class="${class_name}">${
              state.length > 0 ? login_status : ""
            } <br><small> ${state.length > 0 ? login_time : ""}</small></td>
            <td>${
              user._id == 1
                ? '<span class="btn-group"><button class="btn btn-dark"><i class="fa fa-edit"></i></button><button class="btn btn-dark"><i class="fa fa-trash"></i></button></span>'
                : '<span class="btn-group"><button onClick="$(this).editUser(' +
                  index +
                  ')" class="btn btn-warning"><i class="fa fa-edit"></i></button><button onClick="$(this).deleteUser(' +
                  user._id +
                  ')" class="btn btn-danger"><i class="fa fa-trash"></i></button></span>'
            }</td></tr>`;

          if (counter == users.length) {
            $("#user_list").html(user_list);

            $("#userList").DataTable({
              order: [[1, "desc"]],
              autoWidth: false,
              info: true,
              JQueryUI: true,
              ordering: true,
              paging: false,
            });
          }
        });
      });
    }

    function loadProductList() {
      let products = [...allProducts];
      let product_list = "";
      let counter = 0;
      $("#product_list").empty();
      $("#productList").DataTable().destroy();

      products.forEach((product, index) => {
        counter++;

        let category = allCategories.filter(function (category) {
          return category._id == product.category;
        });

        product.stockAlert = "";
        const todayDate = moment();
        const expiryDate = moment(product.expirationDate, DATE_FORMAT);

        //show stock status indicator
        const stockStatus = getStockStatus(product.quantity,product.minStock);
          if(stockStatus<=0)
          {
          if (stockStatus === 0) {
            product.stockStatus = "No Stock";
            icon = "fa fa-exclamation-triangle";
          }
          if (stockStatus === -1) {
            product.stockStatus = "Low Stock";
            icon = "fa fa-caret-down";
          }

          product.stockAlert = `<p class="text-danger"><small><i class="${icon}"></i> ${product.stockStatus}</small></p>`;
        }
        //calculate days to expiry
        product.expiryAlert = "";
        if (!isExpired(expiryDate)) {
          const diffDays = daysToExpire(expiryDate);

          if (diffDays > 0 && diffDays <= 30) {
            var days_noun = diffDays > 1 ? "days" : "day";
            icon = "fa fa-clock-o";
            product.expiryStatus = `${diffDays} ${days_noun} left`;
            product.expiryAlert = `<p class="text-danger"><small><i class="${icon}"></i> ${product.expiryStatus}</small></p>`;
          }
        } else {
          icon = "fa fa-exclamation-triangle";
          product.expiryStatus = "Expired";
          product.expiryAlert = `<p class="text-danger"><small><i class="${icon}"></i> ${product.expiryStatus}</small></p>`;
        }

        if(product.img==="")
        {
          product_img=default_item_img;
        }
        else
        {
          product_img = img_path + product.img;
          product_img = checkFileExists(product_img)
          ? product_img
          : default_item_img;
        }
        
        //render product list
        product_list +=
          `<tr>
            <td><img id="` +
          product._id +
          `"></td>
            <td><img style="max-height: 50px; max-width: 50px; border: 1px solid #ddd;" src="${product_img}" id="product_img"></td>
            <td>
              <div><strong>${product.name}</strong></div>
              ${product.genericName ? `<div><small class="text-muted">Generic: ${product.genericName}</small></div>` : ""}
              ${category.length > 0 ? `<div><small class="text-info"><i class="fa fa-tag"></i> ${category[0].name}</small></div>` : ""}
              ${product.manufacturer ? `<div><small class="text-success"><i class="fa fa-industry"></i> ${product.manufacturer}</small></div>` : ""}
              ${product.supplier ? `<div><small class="text-warning"><i class="fa fa-truck"></i> ${product.supplier}</small></div>` : ""}
              ${product.batchNumber ? `<div><small class="text-muted"><i class="fa fa-barcode"></i> ${product.batchNumber}</small></div>` : ""}
              ${product.expiryAlert}
            </td>
            <td>
              ${product.actualPrice ? `<div><small>Purchase: ${validator.unescape(settings.symbol)}${product.actualPrice}</small></div>`: ""}
              <div><strong>Sell: ${validator.unescape(settings.symbol)}${product.price}</strong></div>
            </td>
            <td>${product.stock == 1 ? product.quantity : "N/A"}
            ${product.stockAlert}
            </td>
            <td>${product.expirationDate}</td>
            <td class="nobr"><span class="btn-group"><button onClick="$(this).editProduct(${index})" class="btn btn-warning btn-sm"><i class="fa fa-edit"></i></button><button onClick="$(this).deleteProduct(` +
              product._id +
            `)" class="btn btn-danger btn-sm"><i class="fa fa-trash"></i></button></span></td></tr>`;

        if (counter == allProducts.length) {
          $("#product_list").html(product_list);

          products.forEach((product) => {
            let bcode = product.barcode || product._id;
            $("#" + product._id + "").JsBarcode(bcode, {
              width: 2,
              height: 25,
              fontSize: 14,
            });
          });
        }
      });

      $("#productList").DataTable({
        order: [[1, "desc"]],
        autoWidth: false,
        info: true,
        JQueryUI: true,
        ordering: true,
        paging: false,
        dom: "Bfrtip",
        buttons: [
          {
            extend: "pdfHtml5",
            className: "btn btn-light", // Custom class name
            text: " Download PDF", // Custom text
            filename: "product_list.pdf", // Default filename
          },
        ],
      });
    }

    function loadCategoryList() {
      let category_list = "";
      let counter = 0;
      $("#category_list").empty();
      $("#categoryList").DataTable().destroy();

      allCategories.forEach((category, index) => {
        counter++;

        category_list += `<tr>
     
            <td>${category.name}</td>
            <td><span class="btn-group"><button onClick="$(this).editCategory(${index})" class="btn btn-warning"><i class="fa fa-edit"></i></button><button onClick="$(this).deleteCategory(${category._id})" class="btn btn-danger"><i class="fa fa-trash"></i></button></span></td></tr>`;
      });

      if (counter == allCategories.length) {
        $("#category_list").html(category_list);
        $("#categoryList").DataTable({
          autoWidth: false,
          info: true,
          JQueryUI: true,
          ordering: true,
          paging: false,
        });
      }
    }


    $("#log-out").on("click", function () {
      const diagOptions = {
        title: "Are you sure?",
        text: "You are about to log out.",
        cancelButtonColor: "#3085d6",
        okButtonText: "Logout",
      };

      notiflix.Confirm.show(
        diagOptions.title,
        diagOptions.text,
        diagOptions.okButtonText,
        diagOptions.cancelButtonText,
        () => {
          $.get(api + "users/logout/" + user._id, function (data) {
            storage.delete("auth");
            storage.delete("user");
            ipcRenderer.send("app-reload", "");
          });
        },
      );
    });

    $("#settings_form").on("submit", function (e) {
      e.preventDefault();
      let formData = $(this).serializeObject();
      let mac_address;

      api = "http://" + host + ":" + port + "/api/";

      macaddress.one(function (err, mac) {
        mac_address = mac;
      });
      const appChoice = $("#app").find("option:selected").text();
    
      formData["app"] = appChoice;
      formData["mac"] = mac_address;
      formData["till"] = 1;

      // Update application field in settings form
      let $appField = $("#settings_form input[name='app']");
      let $hiddenAppField = $('<input>', {
        type: 'hidden',
        name: 'app',
        value: formData.app
    });
        $appField.length 
            ? $appField.val(formData.app) 
            : $("#settings_form").append(`<input type="hidden" name="app" value="${$hiddenAppField}" />`);


      if (formData.percentage != "" && typeof formData.percentage === 'number') {
        notiflix.Report.warning(
          "Oops!",
          "Please make sure the tax value is a number",
          "Ok",
        );
      } else {
        storage.set("settings", formData);

        $(this).attr("action", api + "settings/post");
        $(this).attr("method", "POST");

        $(this).ajaxSubmit({
          contentType: "application/json",
          success: function () {
            ipcRenderer.send("app-reload", "");
          },
          error: function (jqXHR) {
            console.error(jqXHR.responseJSON.message);
            notiflix.Report.failure(
              jqXHR.responseJSON.error,
              jqXHR.responseJSON.message,
              "Ok",
            );
      }
    });
    }
  });

    $("#net_settings_form").on("submit", function (e) {
      e.preventDefault();
      let formData = $(this).serializeObject();

      if (formData.till == 0 || formData.till == 1) {
        notiflix.Report.warning(
          "Oops!",
          "Please enter a number greater than 1.",
          "Ok",
        );
      } else {
        if (isNumeric(formData.till)) {
          formData["app"] = $("#app").find("option:selected").text();
          storage.set("settings", formData);
          ipcRenderer.send("app-reload", "");
        } else {
          notiflix.Report.warning(
            "Oops!",
            "Till number must be a number!",
            "Ok",
          );
        }
      }
    });

    $("#saveUser").on("submit", function (e) {
      e.preventDefault();
      let formData = $(this).serializeObject();

      if (formData.password != formData.pass) {
        notiflix.Report.warning("Oops!", "Passwords do not match!", "Ok");
      }

      if (
        bcrypt.compare(formData.password, user.password) ||
        bcrypt.compare(formData.password, allUsers[user_index].password)
      ) {
        $.ajax({
          url: api + "users/post",
          type: "POST",
          data: JSON.stringify(formData),
          contentType: "application/json; charset=utf-8",
          cache: false,
          processData: false,
          success: function (data) {
            if (ownUserEdit) {
              ipcRenderer.send("app-reload", "");
            } else {
              $("#userModal").modal("hide");

              loadUserList();

              $("#Users").modal("show");
              notiflix.Report.success("Great!", "User details saved!", "Ok");
            }
          },
          error: function (jqXHR,textStatus, errorThrown) {
            notiflix.Report.failure(
              jqXHR.responseJSON.error,
              jqXHR.responseJSON.message,
              "Ok",
            );
          },
        });
      }
    });

    $("#app").on("change", function () {
      if (
        $(this).find("option:selected").text() ==
        "Network Point of Sale Terminal"
      ) {
        $("#net_settings_form").show(500);
        $("#settings_form").hide(500);
        macaddress.one(function (err, mac) {
          $("#mac").val(mac);
        });
      } else {
        $("#net_settings_form").hide(500);
        $("#settings_form").show(500);
      }
    });

    $("#cashier").on("click", function () {
      ownUserEdit = true;

      $("#userModal").modal("show");

      $("#user_id").val(user._id);
      $("#fullname").val(user.fullname);
      $("#username").val(user.username);
      $("#password").attr("placeholder", "New Password");

      for (perm of permissions) {
        var el = "#" + perm;
        if (allUsers[index][perm] == 1) {
          $(el).prop("checked", true);
        } else {
          $(el).prop("checked", false);
        }
      }
    });

    $("#add-user").on("click", function () {
      if (platform.app != "Network Point of Sale Terminal") {
        $(".perms").show();
      }

      $("#saveUser").get(0).reset();
      $("#userModal").modal("show");
    });

    $("#settings").on("click", function () {
      if (platform.app == "Network Point of Sale Terminal") {
        $("#net_settings_form").show(500);
        $("#settings_form").hide(500);

        $("#ip").val(platform.ip);
        $("#till").val(platform.till);

        macaddress.one(function (err, mac) {
          $("#mac").val(mac);
        });

        $("#app option")
          .filter(function () {
            return $(this).text() == platform.app;
          })
          .prop("selected", true);
      } else {
        $("#net_settings_form").hide(500);
        $("#settings_form").show(500);

        $("#settings_id").val("1");
        $("#store").val(validator.unescape(settings.store));
        $("#address_one").val(validator.unescape(settings.address_one));
        $("#address_two").val(validator.unescape(settings.address_two));
        $("#contact").val(validator.unescape(settings.contact));
        $("#tax").val(validator.unescape(settings.tax));
        $("#symbol").val(validator.unescape(settings.symbol));
        $("#percentage").val(validator.unescape(settings.percentage));
        $("#footer").val(validator.unescape(settings.footer));
        $("#logo_img").val(validator.unescape(settings.img));
        if (settings.charge_tax) {
          $("#charge_tax").prop("checked", true);
        }
        if (validator.unescape(settings.img) != "") {
          $("#logoname").hide();
          $("#current_logo").html(
            `<img src="${img_path + validator.unescape(settings.img)}" alt="">`,
          );
          $("#rmv_logo").show();
        }

        $("#app option")
          .filter(function () {
            return $(this).text() == validator.unescape(settings.app);
          })
          .prop("selected", true);
      }
    });
 });

  $("#rmv_logo").on("click", function () {
    $("#remove_logo").val("1");
    // $("#logo_img").val('');
    $("#current_logo").hide(500);
    $(this).hide(500);
    $("#logoname").show(500);
  });

  $("#rmv_img").on("click", function () {
    $("#remove_img").val("1");
    // $("#img").val('');
    $("#current_img").hide(500);
    $(this).hide(500);
    $("#imagename").show(500);
  });
}

$.fn.print = function () {
  printJS({ printable: receipt, type: "raw-html" });
};

// Test function to create a sample transaction (for debugging)
function createTestTransaction() {
  const testTransaction = {
    order: "TEST-" + Date.now(),
    date: new Date().toISOString(),
    total: 25.50,
    paid: 25.50,
    change: 0,
    payment_type: "Cash",
    till: "Till-1",
    user_id: user._id || 1,
    user: user.fullname || "Test User",
    status: 1,
    ref_number: "",
    customer: "0",
    items: [
      {
        id: "test-product-1",
        product_name: "Test Product 1",
        price: 15.50,
        quantity: 1,
        purchasePrice: 10.00
      },
      {
        id: "test-product-2", 
        product_name: "Test Product 2",
        price: 10.00,
        quantity: 1,
        purchasePrice: 7.50
      }
    ]
  };
  
  console.log('Creating test transaction:', testTransaction);
  
  $.ajax({
    url: api + "transactions/new",
    type: "POST",
    data: JSON.stringify(testTransaction),
    contentType: "application/json; charset=utf-8",
    success: function() {
      console.log('Test transaction created successfully');
      notiflix.Report.success("Test Transaction Created", "A sample transaction has been created for testing purposes.", "Ok");
      // Reload transactions after creating test transaction
      setTimeout(() => {
        loadTransactions();
      }, 1000);
    },
    error: function(xhr, status, error) {
      console.error('Failed to create test transaction:', error);
      notiflix.Report.failure("Error", "Failed to create test transaction: " + error, "Ok");
    }
  });
}

function loadTransactions() {
  let tills = [];
  let users = [];
  let sales = 0;
  let transact = 0;
  let unique = 0;

  sold_items = [];
  sold = [];

  let counter = 0;
  let transaction_list = "";
  let query = `by-date?start=${start_date}&end=${end_date}&user=${by_user}&status=${by_status}&till=${by_till}`;

  $.get(api + query, function (transactions) {
    console.log('Loading transactions with query:', query);
    console.log('Found transactions:', transactions.length);
    
    // If no transactions found with date filter, try without date filter
    if (transactions.length === 0) {
      console.log('No transactions found with date filter, trying without date filter...');
      $.get(api + "all", function (allTransactions) {
        console.log('Found all transactions:', allTransactions.length);
        if (allTransactions.length > 0) {
          // Use all transactions but still apply other filters
          let filteredTransactions = allTransactions;
          
          // Apply status filter
          if (by_status !== 'all') {
            filteredTransactions = filteredTransactions.filter(t => t.status == by_status);
          }
          
          // Apply user filter
          if (by_user != 0) {
            filteredTransactions = filteredTransactions.filter(t => t.user_id == by_user);
          }
          
          // Apply till filter
          if (by_till != 0) {
            filteredTransactions = filteredTransactions.filter(t => t.till == by_till);
          }
          
          console.log('Filtered transactions:', filteredTransactions.length);
          processTransactions(filteredTransactions);
        } else {
          console.log('No transactions found in database at all');
          showEmptyState();
        }
      }).fail(function(xhr, status, error) {
        console.error('Failed to load all transactions:', error);
        showEmptyState();
      });
    } else {
      processTransactions(transactions);
    }
    
    function processTransactions(transactions) {
    if (transactions.length > 0) {
      $("#transaction_list").empty();
      if ($.fn.DataTable.isDataTable('#transactionList')) {
      $("#transactionList").DataTable().destroy();
      }

      allTransactions = [...transactions];

      transactions.forEach((trans, index) => {
        sales += parseFloat(trans.total);
        transact++;

        trans.items.forEach((item) => {
          sold_items.push(item);
        });

        if (!tills.includes(trans.till)) {
          tills.push(trans.till);
        }

        if (!users.includes(trans.user_id)) {
          users.push(trans.user_id);
        }

        counter++;
        // Determine payment status and styling
        const isPaid = trans.paid !== "" && trans.paid !== null;
        const statusBadge = isPaid 
          ? '<span class="badge badge-success"><i class="fa fa-check"></i> Paid</span>'
          : '<span class="badge badge-warning"><i class="fa fa-clock-o"></i> Unpaid</span>';
        
        const paymentMethodIcon = trans.payment_type === 'Cash' 
          ? '<i class="fa fa-money text-success"></i>' 
          : '<i class="fa fa-credit-card text-info"></i>';
        
        const viewButton = trans.paid == ""
          ? '<button class="btn btn-sm btn-outline-secondary" title="View Details"><i class="fa fa-eye"></i></button>'
          : '<button onClick="$(this).viewTransaction(' + index + ')" class="btn btn-sm btn-info" title="View Receipt"><i class="fa fa-eye"></i></button>';

        transaction_list += `<tr class="transaction-row" data-status="${isPaid ? 'paid' : 'unpaid'}">
                                <td><strong>${trans.order}</strong></td>
                                <td class="nobr">
                                  <i class="fa fa-calendar text-muted"></i> 
                                  ${moment(new Date(trans.date)).format("DD-MMM-YYYY")}<br>
                                  <small class="text-muted">${moment(new Date(trans.date)).format("HH:mm:ss")}</small>
                                </td>
                                <td class="text-right">
                                  <strong>${validator.unescape(settings.symbol)}${moneyFormat(trans.total)}</strong>
                                </td>
                                <td class="text-right">
                                  ${trans.paid == "" ? '<span class="text-muted">-</span>' : 
                                    '<strong>' + validator.unescape(settings.symbol) + moneyFormat(trans.paid) + '</strong>'}
                                </td>
                                <td class="text-right">
                                  ${trans.change
                                    ? '<span class="text-success">' + validator.unescape(settings.symbol) +
                                      moneyFormat(Math.abs(trans.change).toFixed(2)) + '</span>'
                                    : '<span class="text-muted">-</span>'}
                                </td>
                                <td class="text-center">
                                  ${trans.paid == "" ? '<span class="text-muted">-</span>' : 
                                    paymentMethodIcon + ' ' + trans.payment_type}
                                </td>
                                <td class="text-center">
                                  <span class="badge badge-light">${trans.till}</span>
                                </td>
                                <td>
                                  <i class="fa fa-user text-muted"></i> ${trans.user}
                                </td>
                                <td class="text-center">
                                  ${viewButton}
                                </td>
                            </tr>`;

        if (counter == transactions.length) {
          $("#total_sales #sales_counter").text(
            validator.unescape(settings.symbol) + moneyFormat(parseFloat(sales).toFixed(2)),
          );
          $("#total_transactions #transactions_counter").text(transact);

          const result = {};

          for (const { product_name, price, quantity, id, purchasePrice, genericName, manufacturer, supplier, batchNumber } of sold_items) {
            if (!result[product_name]) result[product_name] = [];
            result[product_name].push({ id, price, quantity, purchasePrice, genericName, manufacturer, supplier, batchNumber });
          }

          for (item in result) {
            let price = 0;
            let quantity = 0;
            let id = 0;
            let totalSales = 0;
            let totalCost = 0;

            result[item].forEach((i) => {
              id = i.id;
              price = i.price;
              quantity = quantity + parseInt(i.quantity);
              totalSales += parseFloat(i.price) * parseInt(i.quantity);
              if (i.purchasePrice && !isNaN(parseFloat(i.purchasePrice))) {
                totalCost += parseFloat(i.purchasePrice) * parseInt(i.quantity);
              }
            });

            sold.push({
              id: id,
              product: item,
              qty: quantity,
              price: price,
              sales: totalSales,
              cost: totalCost,
              profit: totalSales - totalCost,
            });
          }

          loadSoldProducts();

          if (by_user == 0 && by_till == 0) {
            if (allUsers && allUsers.length > 0) {
            userFilter(users);
            }
            tillFilter(tills);
          }

          $("#transaction_list").html(transaction_list);
          $("#transaction_count").text(`${transactions.length} transactions`);
          $("#transactionList").DataTable({
            order: [[1, "desc"]],
            autoWidth: false,
            info: true,
            JQueryUI: true,
            ordering: true,
            paging: true,
            responsive: true,
            pageLength: 25,
            lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "All"]],
            dom: "Bfrtip",
            buttons: ["copy", "csv", "excel", "pdf", "print"],
            language: {
              search: "Search transactions:",
              lengthMenu: "Show _MENU_ transactions per page",
              info: "Showing _START_ to _END_ of _TOTAL_ transactions",
              infoEmpty: "No transactions found",
              infoFiltered: "(filtered from _MAX_ total transactions)",
              zeroRecords: "No matching transactions found",
              paginate: {
                first: "First",
                last: "Last",
                next: "Next",
                previous: "Previous"
              }
            },
            columnDefs: [
              { targets: [2, 3, 4], className: 'text-right' },
              { targets: [5, 6, 8], className: 'text-center' },
              { targets: [0], className: 'font-weight-bold' }
            ]
          });
        }
      });
    } else {
      $("#transaction_list").empty();
      if ($.fn.DataTable.isDataTable('#transactionList')) {
        $("#transactionList").DataTable().clear().draw();
      }
      // Still compute and show inventory-based losses even when there are no transactions in range
      try {
        let lossPartialExpiry = 0;
        let lossTotalExpired = 0;
        allProducts.forEach((p) => {
          const qty = parseInt(p.quantity || 0);
          let buy = parseFloat(p.actualPrice || p.purchasePrice || p.buy_price || p.buyPrice || 0);
          if ((isNaN(buy) || buy <= 0) && Array.isArray(sold_items) && sold_items.length) {
            const match = sold_items.find(si => parseInt(si.id) === parseInt(p._id) && !isNaN(parseFloat(si.purchasePrice)));
            if (match) buy = parseFloat(match.purchasePrice);
          }
          if (isNaN(qty) || qty <= 0 || isNaN(buy) || buy <= 0) return;
          if (isExpired(p.expirationDate)) {
            lossTotalExpired += qty * buy;
            return;
          }
          const days = daysToExpire(p.expirationDate);
          if (days > 0 && days <= 90) {
            lossPartialExpiry += 0.5 * qty * buy;
          }
        });
        const overallLoss = lossPartialExpiry + lossTotalExpired;
        const netProfit = 0 - overallLoss;
        $("#total_sales_profit #sales_profit_counter").text(validator.unescape(settings.symbol) + moneyFormat((0).toFixed(2)));
        $("#loss_partial_expiry #loss_partial_counter").text(validator.unescape(settings.symbol) + moneyFormat(lossPartialExpiry.toFixed(2)));
        $("#loss_total_expired #loss_expired_counter").text(validator.unescape(settings.symbol) + moneyFormat(lossTotalExpired.toFixed(2)));
        $("#loss_overall #loss_overall_counter").text(validator.unescape(settings.symbol) + moneyFormat(overallLoss.toFixed(2)));
        $("#net_profit #net_profit_counter").text(validator.unescape(settings.symbol) + moneyFormat(netProfit.toFixed(2)));
      } catch (e) {
        // ignore
      }
    }
    
    function showEmptyState() {
      console.log('Showing empty state');
      // Clear statistics when no transactions found
      $("#sales_counter").text("0");
      $("#cost_counter").text("0");
      $("#profit_counter").text("0");
      $("#transactions_counter").text("0");
      $("#items_counter").text("0");
      $("#products_counter").text("0");
      $("#sales_profit_counter").text("0");
      $("#loss_partial_counter").text("0");
      $("#loss_expired_counter").text("0");
      $("#loss_overall_counter").text("0");
      $("#net_profit_counter").text("0");
      
      // Clear transaction list
      $("#transaction_list").empty();
      if ($.fn.DataTable.isDataTable('#transactionList')) {
        $("#transactionList").DataTable().destroy();
      }
      $("#transaction_count").text("0 transactions");
      $("#transactionList").DataTable({
        order: [[1, "desc"]],
        autoWidth: false,
        info: true,
        JQueryUI: true,
        responsive: true,
        pageLength: 25,
        lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "All"]],
        dom: 'Bfrtip',
        buttons: [
          'copy', 'csv', 'excel', 'pdf', 'print'
        ],
        language: {
          search: "Search transactions:",
          lengthMenu: "Show _MENU_ transactions per page",
          info: "Showing _START_ to _END_ of _TOTAL_ transactions",
          infoEmpty: "No transactions found",
          infoFiltered: "(filtered from _MAX_ total transactions)",
          zeroRecords: "No matching transactions found",
          paginate: {
            first: "First",
            last: "Last",
            next: "Next",
            previous: "Previous"
          }
        },
        columnDefs: [
          { targets: [2, 3, 4], className: 'text-right' },
          { targets: [5, 6, 8], className: 'text-center' },
          { targets: [0], className: 'font-weight-bold' }
        ]
      });
      
      // Show helpful message
      $("#transaction_list").html(`
        <tr>
          <td colspan="9" class="text-center text-muted">
            <i class="fa fa-info-circle"></i> No transactions found
            <br><small>Try adjusting the date range or create some transactions first</small>
          </td>
        </tr>
      `);
    }
    }
  }).fail(function(xhr, status, error) {
    console.error('Failed to load transactions:', error);
    notiflix.Report.failure("Error Loading Transactions", "Failed to load transaction data. Please try again.<br><small>Press ESC to close this message</small>", "Ok");
  });
}

function sortDesc(a, b) {
  if (a.qty > b.qty) {
    return -1;
  }
  if (a.qty < b.qty) {
    return 1;
  }
  return 0;
}

function loadSoldProducts() {
  sold.sort(sortDesc);

  let counter = 0;
  let sold_list = "";
  let items = 0;
  let products = 0;
  let totalSalesAll = 0;
  let totalCostAll = 0;
  let totalProfitAll = 0;
  let salesMinusProfitAll = 0;
  let lossPartialExpiry = 0;
  let lossTotalExpired = 0;
  let overallLoss = 0;
  let netProfit = 0;
  $("#product_sales").empty();

  sold.forEach((item, index) => {
    items = items + parseInt(item.qty);
    products++;

    let product = allProducts.filter(function (selected) {
      return selected._id == item.id;
    });

    counter++;

    const hasProduct = product.length > 0;
    const stockCell = hasProduct
      ? (product[0].stock == 1 ? product[0].quantity : "N/A")
      : "";

    const salesVal = item.sales || (item.qty * parseFloat(item.price));
    const costVal = item.cost || 0;
    const profitVal = item.profit || (item.sales ? (item.sales - (item.cost || 0)) : 0);
    totalSalesAll += salesVal;
    totalCostAll += costVal;
    totalProfitAll += profitVal;
    salesMinusProfitAll += (salesVal - profitVal);

    sold_list += `<tr>
            <td>${item.product}</td>
            <td>${item.qty}</td>
            <td>${stockCell}</td>
            <td>${validator.unescape(settings.symbol)}${moneyFormat((item.sales || (item.qty * parseFloat(item.price))).toFixed(2))}</td>
            <td>${validator.unescape(settings.symbol)}${moneyFormat((item.cost || 0).toFixed(2))}</td>
            <td>${validator.unescape(settings.symbol)}${moneyFormat((item.profit || ((item.sales || 0) - (item.cost || 0))).toFixed(2))}</td>
            </tr>`;

    if (counter == sold.length) {
      $("#total_items #items_counter").text(items);
      $("#total_products #products_counter").text(products);
      $("#product_sales").html(sold_list);
      $("#total_cost #cost_counter").text(validator.unescape(settings.symbol) + moneyFormat(totalCostAll.toFixed(2)));
      $("#total_profit #profit_counter").text(validator.unescape(settings.symbol) + moneyFormat(totalProfitAll.toFixed(2)));

      // Compute expiry-based losses and net profit using current inventory snapshot
      try {
        lossPartialExpiry = 0;
        lossTotalExpired = 0;
        allProducts.forEach((p) => {
          const qty = parseInt(p.quantity || 0);
          let buy = parseFloat(p.actualPrice || p.purchasePrice || p.buy_price || p.buyPrice || 0);
          if ((isNaN(buy) || buy <= 0) && Array.isArray(sold_items) && sold_items.length) {
            const match = sold_items.find(si => parseInt(si.id) === parseInt(p._id) && !isNaN(parseFloat(si.purchasePrice)));
            if (match) buy = parseFloat(match.purchasePrice);
          }
          if (isNaN(qty) || qty <= 0 || isNaN(buy) || buy <= 0) return;

          let expired = isExpired(p.expirationDate);
          if (!expired) {
            const m = moment(p.expirationDate);
            if (m.isValid() && m.isSameOrBefore(moment(), 'day')) expired = true;
          }
          if (expired) {
            lossTotalExpired += qty * buy;
            return;
          }

          let days = daysToExpire(p.expirationDate);
          if (days === 0) {
            const m = moment(p.expirationDate);
            if (m.isValid() && m.isAfter(moment(), 'day')) days = m.diff(moment(), 'days');
          }
          if (days > 0 && days <= 90) {
            // Partial expiry window (<= 3 months): provision 50% cost
            lossPartialExpiry += 0.5 * qty * buy;
          }
        });

        overallLoss = lossPartialExpiry + lossTotalExpired;
        netProfit = totalProfitAll - overallLoss;

        $("#total_sales_profit #sales_profit_counter").text(validator.unescape(settings.symbol) + moneyFormat(totalProfitAll.toFixed(2)));
        $("#loss_partial_expiry #loss_partial_counter").text(validator.unescape(settings.symbol) + moneyFormat(lossPartialExpiry.toFixed(2)));
        $("#loss_total_expired #loss_expired_counter").text(validator.unescape(settings.symbol) + moneyFormat(lossTotalExpired.toFixed(2)));
        $("#loss_overall #loss_overall_counter").text(validator.unescape(settings.symbol) + moneyFormat(overallLoss.toFixed(2)));
        $("#net_profit #net_profit_counter").text(validator.unescape(settings.symbol) + moneyFormat(netProfit.toFixed(2)));
      } catch (e) {
        // ignore calculation errors to avoid blocking UI
      }
    }
  });
}

function userFilter(users) {
  $("#users").empty();
  $("#users").append(`<option value="0">All</option>`);

  users.forEach((user) => {
    let u = allUsers.filter(function (usr) {
      return usr._id == user;
    });

    if (u.length > 0 && u[0] && u[0].fullname) {
    $("#users").append(`<option value="${user}">${u[0].fullname}</option>`);
    } else {
      $("#users").append(`<option value="${user}">User ${user}</option>`);
    }
  });
}

function tillFilter(tills) {
  $("#tills").empty();
  $("#tills").append(`<option value="0">All</option>`);
  tills.forEach((till) => {
    $("#tills").append(`<option value="${till}">${till}</option>`);
  });
}

$.fn.viewTransaction = function (index) {
  transaction_index = index;

  let discount = allTransactions[index].discount;
  let customer =
    allTransactions[index].customer == 0
      ? "Walk in Customer"
      : allTransactions[index].customer.username;
  let refNumber =
    allTransactions[index].ref_number != ""
      ? allTransactions[index].ref_number
      : allTransactions[index].order;
  let orderNumber = allTransactions[index].order;
  let paymentMethod = "";
  let tax_row = "";
  let items = "";
  let products = allTransactions[index].items;

  products.forEach((item) => {
    const meta = [];
    if (item.genericName) meta.push(`<small class="text-muted">${DOMPurify.sanitize(item.genericName)}</small>`);
    if (item.manufacturer) meta.push(`<small class="text-muted">${DOMPurify.sanitize(item.manufacturer)}</small>`);
    if (item.supplier) meta.push(`<small class="text-muted">Supplier: ${DOMPurify.sanitize(item.supplier)}</small>`);
    if (item.batchNumber) meta.push(`<small class="text-muted">Batch: ${DOMPurify.sanitize(item.batchNumber)}</small>`);
    items += `<tr><td>${DOMPurify.sanitize(item.product_name)}${meta.length ? `<div>${meta.join('<br>')}</div>` : ''}</td><td>${
      DOMPurify.sanitize(item.quantity)
    } </td><td class="text-right"> ${DOMPurify.sanitize(validator.unescape(settings.symbol))} ${moneyFormat(
      Math.abs(item.price).toFixed(2),
    )} </td></tr>`;
  });

  paymentMethod = allTransactions[index].payment_type;
 

  if (allTransactions[index].paid != "") {
    payment = `<tr>
                    <td>Paid</td>
                    <td>:</td>
                    <td class="text-right">${validator.unescape(settings.symbol)} ${moneyFormat(
                      Math.abs(allTransactions[index].paid).toFixed(2),
                    )}</td>
                </tr>
                <tr>
                    <td>Change</td>
                    <td>:</td>
                    <td class="text-right">${validator.unescape(settings.symbol)} ${moneyFormat(
                      Math.abs(allTransactions[index].change).toFixed(2),
                    )}</td>
                </tr>
                <tr>
                    <td>Method</td>
                    <td>:</td>
                    <td class="text-right">${paymentMethod}</td>
                </tr>`;
  }

  if (settings.charge_tax) {
    tax_row = `<tr>
                <td>Vat(${validator.unescape(settings.percentage)})% </td>
                <td>:</td>
                <td class="text-right">${validator.unescape(settings.symbol)}${parseFloat(
                  allTransactions[index].tax,
                ).toFixed(2)}</td>
            </tr>`;
  }

    logo = path.join(img_path, validator.unescape(settings.img));
      
      receipt = `<div style="font-size: 10px">                            
        <p style="text-align: center;">
        ${
          checkFileExists(logo)
            ? `<img style='max-width: 50px' src='${logo}' /><br>`
            : ``
        }
            <span style="font-size: 22px;">${validator.unescape(settings.store)}</span> <br>
            ${validator.unescape(settings.address_one)} <br>
            ${validator.unescape(settings.address_two)} <br>
            ${
              validator.unescape(settings.contact) != "" ? "Tel: " + validator.unescape(settings.contact) + "<br>" : ""
            } 
            ${validator.unescape(settings.tax) != "" ? "Vat No: " + validator.unescape(settings.tax) + "<br>" : ""} 
    </p>
    <hr>
    <left>
        <p>
        Order No : ${orderNumber} <br>
        Ref No : ${refNumber == "" ? orderNumber : _.escape(refNumber)} <br>
        Customer : ${
          allTransactions[index].customer == 0
            ? "Walk in customer"
            : _.escape(allTransactions[index].customer.name)
        } <br>
        Cashier : ${allTransactions[index].user} <br>
        Date : ${moment(allTransactions[index].date).format(
          "DD MMM YYYY HH:mm:ss",
        )}<br>
        </p>

    </left>
    <hr>
    <table width="90%">
        <thead>
        <tr>
            <th>Item</th>
            <th>Qty</th>
            <th class="text-right">Price</th>
        </tr>
        </thead>
        <tbody>
        ${items}                
        <tr><td colspan="3"><hr></td></tr>
        <tr>                        
            <td><b>Subtotal</b></td>
            <td>:</td>
            <td class="text-right"><b>${validator.unescape(settings.symbol)}${moneyFormat(
              allTransactions[index].subtotal,
            )}</b></td>
        </tr>
        <tr>
            <td>Discount</td>
            <td>:</td>
            <td class="text-right">${
              discount > 0
                ? validator.unescape(settings.symbol) +
                  moneyFormat(
                    parseFloat(allTransactions[index].discount).toFixed(2),
                  )
                : ""
            }</td>
        </tr>
        
        ${tax_row}
    
        <tr>
            <td><h5>Total</h5></td>
            <td><h5>:</h5></td>
            <td class="text-right">
                <h5>${validator.unescape(settings.symbol)} ${moneyFormat(
                  parseFloat(allTransactions[index].total).toFixed(2),
                )}</h5>
            </td>
        </tr>
        ${payment == 0 ? "" : payment}
        </tbody>
        </table>
        <br>
        <hr>
        <br>
        <p style="text-align: center;">
         ${validator.unescape(settings.footer)}
         </p>
        </div>`;

        //prevent DOM XSS; allow windows paths in img src
        receipt = DOMPurify.sanitize(receipt,{ ALLOW_UNKNOWN_PROTOCOLS: true });

  $("#viewTransaction").html("");
  $("#viewTransaction").html(receipt);

  $("#orderModal").modal("show");
};

$("#status").on("change", function () {
  by_status = $(this).find("option:selected").val();
  loadTransactions();
});

$("#tills").on("change", function () {
  by_till = $(this).find("option:selected").val();
  loadTransactions();
});

$("#users").on("change", function () {
  by_user = $(this).find("option:selected").val();
  loadTransactions();
});

$("#reportrange").on("apply.daterangepicker", function (ev, picker) {
  start = picker.startDate.format("DD MMM YYYY hh:mm A");
  end = picker.endDate.format("DD MMM YYYY hh:mm A");

  start_date = picker.startDate.toDate().toJSON();
  end_date = picker.endDate.toDate().toJSON();

  loadTransactions();
});

function authenticate() {
  $(".loading").hide();
  $("body").attr("class", "login-page");
  $("#login").show();
}

$("body").on("submit", "#account", function (e) {
  e.preventDefault();
  let formData = $(this).serializeObject();

  if (formData.username == "" || formData.password == "") {
    notiflix.Report.warning("Incomplete form!", auth_empty, "Ok");
  } else {
    $.ajax({
      url: api + "users/login",
      type: "POST",
      data: JSON.stringify(formData),
      contentType: "application/json; charset=utf-8",
      cache: false,
      processData: false,
      success: function (data) {
        if (data.auth === true) {
          storage.set("auth", { auth: true });
          storage.set("user", data);
          ipcRenderer.send("app-reload", "");
          $("#login").hide();
        } else {
          notiflix.Report.warning("Oops!", auth_error, "Ok");
        }
      },
      error: function (data) {
        console.log(data);
      },
    });
  }
});

$("#quit").on("click", function () {
  const diagOptions = {
    title: "Are you sure?",
    text: "You are about to close the application.",
    icon: "warning",
    okButtonText: "Close Application",
    cancelButtonText: "Cancel"
  };

  notiflix.Confirm.show(
    diagOptions.title,
    diagOptions.text,
    diagOptions.okButtonText,
    diagOptions.cancelButtonText,
    () => {
      ipcRenderer.send("app-quit", "");
    },
  );
});

ipcRenderer.on("click-element", (event, elementId) => {
  document.getElementById(elementId).click();
});

// Enhanced keyboard navigation and focus management
function enhanceKeyboardNavigation() {
  // Tab navigation enhancement
  $(document).on('keydown', function(e) {
    // Enhanced Tab navigation with Shift+Tab for reverse
    if (e.keyCode === 9) { // Tab key
      const activeElement = document.activeElement;
      const focusableElements = getFocusableElements();
      
      if (focusableElements.length === 0) return;
      
      let currentIndex = focusableElements.indexOf(activeElement);
      if (currentIndex === -1) currentIndex = 0;
      
      if (e.shiftKey) {
        // Shift+Tab: Move backwards
        currentIndex = currentIndex > 0 ? currentIndex - 1 : focusableElements.length - 1;
      } else {
        // Tab: Move forwards
        currentIndex = currentIndex < focusableElements.length - 1 ? currentIndex + 1 : 0;
      }
      
      focusableElements[currentIndex].focus();
      e.preventDefault();
    }
    
    // Arrow key navigation in tables and lists
    if (e.keyCode >= 37 && e.keyCode <= 40) { // Arrow keys
      const activeElement = document.activeElement;
      if (activeElement.tagName === 'TD' || activeElement.tagName === 'TR' || 
          activeElement.closest('.table') || activeElement.closest('.dataTable')) {
        navigateWithArrows(e, activeElement);
      }
    }
    
    // Enter key to activate buttons and links
    if (e.keyCode === 13) { // Enter key
      const activeElement = document.activeElement;
      if (activeElement.tagName === 'BUTTON' || activeElement.tagName === 'A' || 
          activeElement.closest('button') || activeElement.closest('a')) {
        activeElement.click();
        e.preventDefault();
      }
    }
    
    // Space key to toggle checkboxes and buttons
    if (e.keyCode === 32) { // Space key
      const activeElement = document.activeElement;
      if (activeElement.type === 'checkbox' || activeElement.type === 'radio') {
        activeElement.checked = !activeElement.checked;
        $(activeElement).trigger('change');
        e.preventDefault();
      }
    }
  });
  
  // Focus management for modals
  $(document).on('shown.bs.modal', function(e) {
    const modal = $(e.target);
    const firstFocusable = modal.find(getFocusableSelector()).first();
    if (firstFocusable.length > 0) {
      firstFocusable.focus();
    }
  });
  
  // Trap focus within modals
  $(document).on('keydown', function(e) {
    if (e.keyCode === 9) { // Tab key
      const activeModal = $('.modal.in');
      if (activeModal.length > 0) {
        const focusableElements = activeModal.find(getFocusableSelector());
        if (focusableElements.length > 0) {
          const firstElement = focusableElements.first()[0];
          const lastElement = focusableElements.last()[0];
          
          if (e.shiftKey && document.activeElement === firstElement) {
            // Shift+Tab on first element: focus last element
            lastElement.focus();
            e.preventDefault();
          } else if (!e.shiftKey && document.activeElement === lastElement) {
            // Tab on last element: focus first element
            firstElement.focus();
            e.preventDefault();
          }
        }
      }
    }
  });
  
  // Quick navigation between major sections
  $(document).on('keydown', function(e) {
    if (e.altKey) {
      switch(e.keyCode) {
        case 49: // Alt+1: Quick jump to Products
          $('#productModal').focus();
          break;
        case 50: // Alt+2: Quick jump to Categories
          $('#categoryModal').focus();
          break;
        case 51: // Alt+3: Quick jump to Transactions
          $('#viewRefOrders').focus();
          break;
        case 52: // Alt+4: Quick jump to Settings
          $('#settings').focus();
          break;
        case 53: // Alt+5: Quick jump to Users
          $('#usersModal').focus();
          break;
        case 73: // Alt+I: Quick Inventory Actions
          if ($('#Products').hasClass('in')) {
            // If Products modal is open, show quick actions
            showQuickInventoryActions();
          }
          break;
        case 83: // Alt+S: Quick Search
          const activeModal = $('.modal.in');
          if (activeModal.length > 0) {
            const searchField = activeModal.find('input[type="search"], input[placeholder*="search"], input[placeholder*="Search"]').first();
            if (searchField.length > 0) {
              searchField.focus();
            }
          }
          break;
        case 78: // Alt+N: Quick New Item
          const activeModal2 = $('.modal.in');
          if (activeModal2.length > 0) {
            const modalId = activeModal2.attr('id');
            switch(modalId) {
              case 'Products':
                $('#newProductModal').click();
                break;
              case 'Categories':
                $('#newCategoryModal').click();
                break;
              case 'Users':
                $('#add-user').click();
                break;
            }
          }
          break;
        case 67: // Alt+C: Quick Close Modal
          const activeModal3 = $('.modal.in');
          if (activeModal3.length > 0) {
            activeModal3.modal('hide');
          }
          break;
      }
    }
  });
}

// Get all focusable elements
function getFocusableElements() {
  const selector = getFocusableSelector();
  return Array.from(document.querySelectorAll(selector)).filter(el => {
    return !el.disabled && el.offsetParent !== null;
  });
}

// Get focusable selector
function getFocusableSelector() {
  return 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
}

// Navigate with arrow keys in tables
function navigateWithArrows(e, activeElement) {
  const table = activeElement.closest('table');
  if (!table) return;
  
  const rows = Array.from(table.querySelectorAll('tr'));
  const cells = Array.from(table.querySelectorAll('td, th'));
  const currentIndex = cells.indexOf(activeElement);
  
  if (currentIndex === -1) return;
  
  let nextIndex = currentIndex;
  const cols = table.querySelector('tr').children.length;
  
  switch(e.keyCode) {
    case 37: // Left arrow
      if (currentIndex % cols > 0) nextIndex = currentIndex - 1;
      break;
    case 38: // Up arrow
      if (currentIndex >= cols) nextIndex = currentIndex - cols;
      break;
    case 39: // Right arrow
      if (currentIndex % cols < cols - 1) nextIndex = currentIndex + 1;
      break;
    case 40: // Down arrow
      if (currentIndex < cells.length - cols) nextIndex = currentIndex + cols;
      break;
  }
  
  if (nextIndex !== currentIndex && cells[nextIndex]) {
    cells[nextIndex].focus();
    e.preventDefault();
  }
}

// Initialize enhanced keyboard navigation
enhanceKeyboardNavigation();
    
    // Quick Actions Menu
    function showQuickInventoryActions() {
      const quickActions = `
        <div class="modal fade" id="quickActionsModal" tabindex="-1" role="dialog">
          <div class="modal-dialog modal-sm" role="document">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Quick Inventory Actions</h5>
                <button type="button" class="close" data-dismiss="modal">&times;</button>
              </div>
              <div class="modal-body">
                <div class="list-group">
                  <button type="button" class="list-group-item list-group-item-action" data-action="new-product">
                    <i class="fa fa-plus"></i> New Product
                  </button>
                  <button type="button" class="list-group-item list-group-item-action" data-action="bulk-import">
                    <i class="fa fa-upload"></i> Bulk Import
                  </button>
                  <button type="button" class="list-group-item list-group-item-action" data-action="bulk-remove">
                    <i class="fa fa-trash"></i> Bulk Remove
                  </button>
                  <button type="button" class="list-group-item list-group-item-action" data-action="export">
                    <i class="fa fa-download"></i> Export Products
                  </button>
                  <button type="button" class="list-group-item list-group-item-action" data-action="search">
                    <i class="fa fa-search"></i> Search Products
                  </button>
                </div>
              </div>
              <div class="modal-footer">
                <small class="text-muted">Use number keys 1-6 to select actions quickly</small>
              </div>
            </div>
          </div>
        </div>
      `;
      
      // Remove existing modal if present
      $('#quickActionsModal').remove();
      
      // Add new modal to body
      $('body').append(quickActions);
      
      // Show the modal
      $('#quickActionsModal').modal('show');
      
      // Add keyboard shortcuts for quick actions
      $(document).on('keydown', '#quickActionsModal', function(e) {
        if (e.keyCode >= 49 && e.keyCode <= 54) { // Number keys 1-6
          const actionIndex = e.keyCode - 49;
          const actionButtons = $('#quickActionsModal .list-group-item');
          if (actionButtons[actionIndex]) {
            actionButtons[actionIndex].click();
          }
        }
      });
      
      // Handle quick action clicks
      $(document).on('click', '#quickActionsModal .list-group-item', function() {
        const action = $(this).data('action');
        $('#quickActionsModal').modal('hide');
        
        switch(action) {
          case 'new-product':
            $('#newProductModal').click();
            break;
          case 'bulk-import':
            $('#bulkImportModal').click();
            break;
          case 'bulk-remove':
            $('#bulkRemoveModal').click();
            break;
          case 'export':
            exportProducts();
            break;
          case 'search':
            const searchField = $('#Products input[type="search"], #Products input[placeholder*="search"]').first();
            if (searchField.length > 0) {
              searchField.focus();
            }
            break;
        }
      });
    }
    
    // Export products function
    function exportProducts() {
      // Implementation for exporting products
      notiflix.Report.info(
        "Export Feature",
        "Product export functionality will be implemented here.",
        "OK"
      );
    }
    
    // Enhanced form navigation and auto-completion
    function enhanceFormNavigation() {
      // Auto-focus first input in forms when modals open
      $(document).on('shown.bs.modal', function(e) {
        const modal = $(e.target);
        const firstInput = modal.find('input:visible, select:visible, textarea:visible').first();
        if (firstInput.length > 0) {
          firstInput.focus();
        }
      });
      
      // Enter key to move to next field in forms
      $(document).on('keydown', 'input, select, textarea', function(e) {
        if (e.keyCode === 13) { // Enter key
          e.preventDefault();
          const currentField = $(this);
          const form = currentField.closest('form');
          const fields = form.find('input:visible, select:visible, textarea:visible');
          const currentIndex = fields.index(currentField);
          const nextField = fields.eq(currentIndex + 1);
          
          if (nextField.length > 0) {
            nextField.focus();
          } else {
            // If it's the last field, submit the form
            const submitBtn = form.find('button[type="submit"], .btn-primary, .btn-success').first();
            if (submitBtn.length > 0) {
              submitBtn.click();
            }
          }
        }
      });
      
      // Shift+Enter to move to previous field
      $(document).on('keydown', 'input, select, textarea', function(e) {
        if (e.keyCode === 13 && e.shiftKey) { // Shift+Enter
          e.preventDefault();
          const currentField = $(this);
          const form = currentField.closest('form');
          const fields = form.find('input:visible, select:visible, textarea:visible');
          const currentIndex = fields.index(currentField);
          const prevField = fields.eq(currentIndex - 1);
          
          if (prevField.length > 0) {
            prevField.focus();
          }
        }
      });
      
      // Auto-complete for common fields
      $(document).on('input', 'input[name*="name"], input[name*="Name"]', function() {
        const input = $(this);
        const value = input.val().toLowerCase();
        
        // Auto-complete for product names
        if (input.attr('name') === 'productName' && allProducts.length > 0) {
          const matches = allProducts.filter(product => 
            product.name.toLowerCase().includes(value)
          );
          
          if (matches.length > 0 && value.length > 2) {
            showAutoComplete(input, matches.map(m => m.name));
          }
        }
        
        // Auto-complete for category names
        if (input.attr('name') === 'categoryName' && allCategories.length > 0) {
          const matches = allCategories.filter(category => 
            category.name.toLowerCase().includes(value)
          );
          
          if (matches.length > 0 && value.length > 2) {
            showAutoComplete(input, matches.map(m => m.name));
          }
        }
      });
      
      // Auto-complete for usernames
      $(document).on('input', 'input[name*="username"], input[name*="Username"]', function() {
        const input = $(this);
        const value = input.val().toLowerCase();
        
        if (allUsers.length > 0) {
          const matches = allUsers.filter(user => 
            user.username.toLowerCase().includes(value)
          );
          
          if (matches.length > 0 && value.length > 2) {
            showAutoComplete(input, matches.map(m => m.username));
          }
        }
      });
    }
    
    // Show auto-complete dropdown
    function showAutoComplete(input, suggestions) {
      // Remove existing auto-complete
      input.siblings('.auto-complete-dropdown').remove();
      
      if (suggestions.length === 0) return;
      
      const dropdown = $(`
        <div class="auto-complete-dropdown" style="
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: white;
          border: 1px solid #ddd;
          border-top: none;
          max-height: 200px;
          overflow-y: auto;
          z-index: 1000;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        ">
          ${suggestions.map(suggestion => `
            <div class="auto-complete-item" style="
              padding: 8px 12px;
              cursor: pointer;
              border-bottom: 1px solid #eee;
            " data-value="${suggestion}">
              ${suggestion}
            </div>
          `).join('')}
        </div>
      `);
      
      input.after(dropdown);
      
      // Handle auto-complete item selection
      dropdown.on('click', '.auto-complete-item', function() {
        const value = $(this).data('value');
        input.val(value);
        dropdown.remove();
        input.focus();
      });
      
      // Handle keyboard navigation in auto-complete
      let selectedIndex = -1;
      input.on('keydown', function(e) {
        const items = dropdown.find('.auto-complete-item');
        
        switch(e.keyCode) {
          case 38: // Up arrow
            e.preventDefault();
            selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : items.length - 1;
            updateAutoCompleteSelection(items, selectedIndex);
            break;
          case 40: // Down arrow
            e.preventDefault();
            selectedIndex = selectedIndex < items.length - 1 ? selectedIndex + 1 : 0;
            updateAutoCompleteSelection(items, selectedIndex);
            break;
          case 13: // Enter
            e.preventDefault();
            if (selectedIndex >= 0 && items.eq(selectedIndex).length > 0) {
              items.eq(selectedIndex).click();
            }
            break;
          case 27: // Escape
            dropdown.remove();
            break;
        }
      });
      
      // Remove auto-complete when input loses focus
      input.on('blur', function() {
        setTimeout(() => dropdown.remove(), 200);
      });
    }
    
    // Update auto-complete selection
    function updateAutoCompleteSelection(items, selectedIndex) {
      items.removeClass('bg-primary text-white');
      if (selectedIndex >= 0 && items.eq(selectedIndex).length > 0) {
        items.eq(selectedIndex).addClass('bg-primary text-white');
      }
    }
    
    // Initialize form navigation enhancements
    enhanceFormNavigation();
    
    // Enhanced POS (Point of Sale) Keyboard Navigation
    function enhancePOSNavigation() {
      // POS Product Search and Selection
      $(document).on('keydown', '#skuCode', function(e) {
        if (e.keyCode === 13) { // Enter key
          e.preventDefault();
          barcodeSearch(e);
        }
      });
      
      // POS Cart Navigation
      $(document).on('keydown', '#cartTable', function(e) {
        const cartItems = $('#cartTable .row');
        let currentIndex = -1;
        
        // Find currently focused cart item
        cartItems.each(function(index) {
          if ($(this).find(':focus').length > 0) {
            currentIndex = index;
          }
        });
        
        if (currentIndex === -1) {
          // If no item focused, focus first item
          currentIndex = 0;
          cartItems.eq(0).find('input, button').first().focus();
        }
        
        switch(e.keyCode) {
          case 38: // Up arrow - Previous cart item
            e.preventDefault();
            if (currentIndex > 0) {
              cartItems.eq(currentIndex - 1).find('input, button').first().focus();
            }
            break;
          case 40: // Down arrow - Next cart item
            e.preventDefault();
            if (currentIndex < cartItems.length - 1) {
              cartItems.eq(currentIndex + 1).find('input, button').first().focus();
            }
            break;
          case 37: // Left arrow - Previous field in current item
            e.preventDefault();
            const currentItem = cartItems.eq(currentIndex);
            const fields = currentItem.find('input, button');
            const currentFieldIndex = fields.index(document.activeElement);
            if (currentFieldIndex > 0) {
              fields.eq(currentFieldIndex - 1).focus();
            }
            break;
          case 39: // Right arrow - Next field in current item
            e.preventDefault();
            const currentItem2 = cartItems.eq(currentIndex);
            const fields2 = currentItem2.find('input, button');
            const currentFieldIndex2 = fields2.index(document.activeElement);
            if (currentFieldIndex2 < fields2.length - 1) {
              fields.eq(currentFieldIndex2 + 1).focus();
            }
            break;
        }
      });
      
      // POS Quantity Controls
      $(document).on('keydown', '#cartTable input[readonly]', function(e) {
        const input = $(this);
        const row = input.closest('.row');
        const index = row.index();
        
        switch(e.keyCode) {
          case 38: // Up arrow - Increment quantity
            e.preventDefault();
            $(this).qtIncrement(index);
            break;
          case 40: // Down arrow - Decrement quantity
            e.preventDefault();
            $(this).qtDecrement(index);
            break;
          case 46: // Delete key - Remove item
            e.preventDefault();
            $(this).deleteFromCart(index);
            break;
          case 13: // Enter key - Edit quantity
            e.preventDefault();
            input.removeAttr('readonly').focus();
            break;
        }
      });
      
      // POS Payment Navigation
      $(document).on('keydown', '#paymentModel', function(e) {
        switch(e.keyCode) {
          case 27: // ESC key - Close payment modal
            e.preventDefault();
            $('#paymentModel').modal('hide');
            break;
          case 49: // 1 key - Cash payment
            e.preventDefault();
            $('.list-group-item[data-payment-type="1"]').click();
            break;
          case 50: // 2 key - Card payment
            e.preventDefault();
            $('.list-group-item[data-payment-type="2"]').click();
            break;
          case 67: // C key - Calculate change
            e.preventDefault();
            $('#payment').trigger('input');
            break;
          case 80: // P key - Process payment
            e.preventDefault();
            $('#confirmPayment').click();
            break;
          case 72: // H key - Hold order
            e.preventDefault();
            $('#hold').click();
            break;
        }
      });
      
      // Hold Order Modal Navigation
      $(document).on('keydown', '#dueModal', function(e) {
        switch(e.keyCode) {
          case 27: // ESC key - Close hold order modal
            e.preventDefault();
            $('#dueModal').modal('hide');
            break;
          case 13: // Enter key - Submit hold order (if reference is entered)
            e.preventDefault();
            if ($('#refNumber').val().trim() !== '') {
              $(this).submitDueOrder(0);
            }
            break;
        }
      });
      
      // POS Customer Selection
      $(document).on('keydown', '#customer', function(e) {
        if (e.keyCode === 13) { // Enter key
          e.preventDefault();
          $(this).trigger('chosen:open');
        }
      });
      
      // POS Reference Number
      $(document).on('keydown', '#refNumber', function(e) {
        if (e.keyCode === 13) { // Enter key
          e.preventDefault();
          $('#payment').focus();
        }
      });
      
      // POS Discount Input
      $(document).on('keydown', '#inputDiscount', function(e) {
        if (e.keyCode === 13) { // Enter key
          e.preventDefault();
          $('#payment').focus();
        }
      });
      
      // POS Payment Amount
      $(document).on('keydown', '#payment', function(e) {
        if (e.keyCode === 13) { // Enter key
          e.preventDefault();
          $('#confirmPayment').click();
        }
      });
      
      // POS Quick Actions
      $(document).on('keydown', function(e) {
        if (e.altKey) {
          switch(e.keyCode) {
            case 80: // Alt+P - Open POS
              e.preventDefault();
              $('#pointofsale').click();
              break;
            case 67: // Alt+C - Clear cart
              e.preventDefault();
              if (cart.length > 0) {
                $(this).cancelOrder();
              }
              break;
            case 72: // Alt+H - Hold order
              e.preventDefault();
              if (cart.length > 0) {
                $('#hold').click();
              }
              break;
            case 83: // Alt+S - Search products
              e.preventDefault();
              $('#skuCode').focus();
              break;
            case 78: // Alt+N - New transaction
              e.preventDefault();
              if (cart.length === 0) {
                cart = [];
                $(this).renderTable(cart);
                $('#skuCode').focus();
              }
              break;
          }
        }
      });
      
      // POS Product Grid Navigation
      $(document).on('keydown', '#parent', function(e) {
        const productBoxes = $('#parent .box');
        let currentIndex = -1;
        
        // Find currently focused product
        productBoxes.each(function(index) {
          if ($(this).find(':focus').length > 0) {
            currentIndex = index;
          }
        });
        
        if (currentIndex === -1) {
          // If no product focused, focus first product
          currentIndex = 0;
          productBoxes.eq(0).attr('tabindex', '0').focus();
        }
        
        const cols = 6; // Assuming 6 columns in the grid
        const rows = Math.ceil(productBoxes.length / cols);
        const currentRow = Math.floor(currentIndex / cols);
        const currentCol = currentIndex % cols;
        
        switch(e.keyCode) {
          case 37: // Left arrow
            e.preventDefault();
            if (currentCol > 0) {
              const newIndex = currentIndex - 1;
              productBoxes.eq(newIndex).attr('tabindex', '0').focus();
            }
            break;
          case 39: // Right arrow
            e.preventDefault();
            if (currentCol < cols - 1 && currentIndex < productBoxes.length - 1) {
              const newIndex = currentIndex + 1;
              productBoxes.eq(newIndex).attr('tabindex', '0').focus();
            }
            break;
          case 38: // Up arrow
            e.preventDefault();
            if (currentRow > 0) {
              const newIndex = currentIndex - cols;
              if (newIndex >= 0) {
                productBoxes.eq(newIndex).attr('tabindex', '0').focus();
              }
            }
            break;
          case 40: // Down arrow
            e.preventDefault();
            if (currentRow < rows - 1) {
              const newIndex = currentIndex + cols;
              if (newIndex < productBoxes.length) {
                productBoxes.eq(newIndex).attr('tabindex', '0').focus();
              }
            }
            break;
          case 13: // Enter key - Add to cart
            e.preventDefault();
            const productId = productBoxes.eq(currentIndex).attr('onclick').match(/\d+/)[0];
            const quantity = productBoxes.eq(currentIndex).attr('onclick').match(/\d+/)[1];
            const stock = productBoxes.eq(currentIndex).attr('onclick').match(/\d+/)[2];
            $(this).addToCart(productId, quantity, stock);
            break;
          case 32: // Space key - Add to cart
            e.preventDefault();
            const productId2 = productBoxes.eq(currentIndex).attr('onclick').match(/\d+/)[0];
            const quantity2 = productBoxes.eq(currentIndex).attr('onclick').match(/\d+/)[1];
            const stock2 = productBoxes.eq(currentIndex).attr('onclick').match(/\d+/)[2];
            $(this).addToCart(productId2, quantity2, stock2);
            break;
        }
      });
      
      // Make product boxes focusable
      $('#parent .box').attr('tabindex', '0');
      
      // POS Quick Product Search
      $(document).on('keydown', function(e) {
        if (e.altKey && e.keyCode === 81) { // Alt+Q - Quick product search
          e.preventDefault();
          $('#skuCode').focus();
        }
      });
      
      // Enhanced Search Field Functionality
      function enhanceSearchFields() {
        // Add loading state to search fields
        $('#search').on('input', function() {
          const $this = $(this);
          const $container = $this.closest('.pos-product-search');
          
          // Add loading animation
          $container.addClass('pos-search-loading');
          
          // Clear loading after a short delay (simulating search)
          setTimeout(() => {
            $container.removeClass('pos-search-loading');
          }, 300);
        });
        
        // DISABLED: JavaScript focus class management - CSS handles focus styles now
        // Enhanced barcode search field
        // $('#skuCode').on('focus', function() {
        //   const $container = $(this).closest('.pos-search-container');
        //   $container.addClass('focused');
        // }).on('blur', function() {
        //   const $container = $(this).closest('.pos-search-container');
        //   $container.removeClass('focused');
        // });
        
        // Enhanced product search field
        // $('#search').on('focus', function() {
        //   const $container = $(this).closest('.pos-product-search');
        //   $container.addClass('focused');
        // }).on('blur', function() {
        //   $container.removeClass('focused');
        // });
        
        // Filter dropdown enhancements
        $('.pos-filter-row select').on('change', function() {
          const $this = $(this);
          const $container = $this.closest('.pos-search-container');
          
          // Add highlight effect when filters change
          $container.addClass('pos-search-highlight');
          setTimeout(() => {
            $container.removeClass('pos-search-highlight');
          }, 2000);
        });
        
        // Clear filters button enhancement
        $('#clearFilters').on('click', function() {
          const $this = $(this);
          const $container = $this.closest('.pos-search-container');
          
          // Add click animation
          $this.addClass('clicked');
          setTimeout(() => {
            $this.removeClass('clicked');
          }, 200);
          
          // Add success highlight
          $container.addClass('pos-search-highlight');
          setTimeout(() => {
            $container.removeClass('pos-search-highlight');
          }, 1500);
        });
        
        // Add keyboard shortcuts for search fields
        $(document).on('keydown', function(e) {
          // Ctrl/Cmd + K to focus product search
          if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            $('#search').focus();
          }
          
          // Ctrl/Cmd + L to focus barcode search
          if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
            e.preventDefault();
            $('#skuCode').focus();
          }
          
          // Escape to clear search fields
          if (e.key === 'Escape') {
            if ($('#search').is(':focus')) {
              $('#search').val('').blur();
            } else if ($('#skuCode').is(':focus')) {
              $('#skuCode').val('').blur();
            }
          }
        });
        
        // Add search field hints
        addSearchFieldHints();
      }
      
      // Add helpful hints to search fields
      function addSearchFieldHints() {
        // Barcode search hints
        if (!$('#skuCodeHint').length) {
          $('#skuCode').after(`
            <div class="search-hints" style="margin-top: 8px; font-size: 12px; color: #6c757d;">
              <i class="fa fa-info-circle"></i> 
              <strong>Shortcuts:</strong> Enter to search • Ctrl+L to focus • Esc to clear
            </div>
          `);
        }
        
        // Product search hints
        if (!$('#searchHint').length) {
          
        }
      }
      
      // Initialize enhanced search fields
      enhanceSearchFields();
      
      // POS Category Filter
      $(document).on('keydown', function(e) {
        if (e.altKey && e.keyCode >= 49 && e.keyCode <= 57) { // Alt+1-9 for categories
          e.preventDefault();
          const categoryIndex = e.keyCode - 49;
          const categories = ['all', 'Medicines', 'Personal Care', 'First Aid', 'Supplements'];
          if (categories[categoryIndex]) {
            filterProductsByCategory(categories[categoryIndex]);
          }
        }
      });
    }
    
    // Filter products by category
    function filterProductsByCategory(category) {
      if (category === 'all') {
        $('#parent .box').show();
      } else {
        $('#parent .box').hide();
        $(`#parent .box.${category}`).show();
      }
      
      // Focus first visible product
      const firstVisible = $('#parent .box:visible').first();
      if (firstVisible.length > 0) {
        firstVisible.attr('tabindex', '0').focus();
      }
      
      // Show notification
      notiflix.Notify.info(`Filtered by: ${category}`);
    }
    
    // Initialize POS navigation enhancements
    enhancePOSNavigation();

    // Navigation button hover effects (JavaScript-based to bypass CSS conflicts)
    $(document).ready(function() {
        // Add hover effects to navigation buttons (excluding specific buttons)
        $('.nav-btn-icon').each(function() {
            const $button = $(this);
            const title = $button.attr('title');
            const buttonId = $button.attr('id');
            
            // Skip specific buttons that shouldn't have hover effects
            if (buttonId === 'newProductModal' || 
                buttonId === 'newCategoryModal' || 
                buttonId === 'newManufacturerModal' || 
                buttonId === 'newSupplierModal' || 
                buttonId === 'add-user' ||
                buttonId === 'settings' ||
                buttonId === 'keyboardHelp' ||
                buttonId === 'clearAlerts' ||
                buttonId === 'log-out') {
                return; // Skip this button
            }
            
            // Create text label element
            const $label = $('<span class="nav-hover-label"></span>')
                .text(title)
                .css({
                    'position': 'absolute',
                    'right': '8px',
                    'top': '50%',
                    'transform': 'translateY(-50%) translateX(100%)',
                    'color': 'white',
                    'font-size': '12px',
                    'font-weight': '500',
                    'white-space': 'nowrap',
                    'opacity': '0',
                    'transition': 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    'pointer-events': 'none',
                    'text-shadow': '0 1px 2px rgba(0, 0, 0, 0.3)',
                    'z-index': '1000'
                });
            
            // Append label to button
            $button.append($label);
            
            // Mouse enter event
            $button.on('mouseenter', function() {
                // Calculate dynamic padding based on label text length
                const labelWidth = $label.outerWidth();
                const dynamicPadding = Math.max(60, labelWidth + 20); // Minimum 60px, or label width + 20px
                
                $button.css({
                    'width': 'auto',
                    'min-width': '40px',
                    'padding-right': dynamicPadding + 'px'
                });
                $label.css({
                    'opacity': '1',
                    'transform': 'translateY(-50%) translateX(0)'
                });
            });
            
            // Mouse leave event
            $button.on('mouseleave', function() {
                $button.css({
                    'width': '40px',
                    'padding-right': '8px'
                });
                $label.css({
                    'opacity': '0',
                    'transform': 'translateY(-50%) translateX(100%)'
                });
            });
        });
    });

    // Enhanced Focus Management and Keyboard Navigation
    // ================================================
    
    // Add focus indicators and keyboard hints
    $.fn.enhanceFocusVisibility = function() {
      // Add focus indicators to all interactive elements
      $('input, select, textarea, button, a, [tabindex]').each(function() {
        const $el = $(this);
        
        // DISABLED: JavaScript focus class addition - CSS handles focus styles now
        // Add focus class for enhanced styling
        // $el.on('focus', function() {
        //   $(this).addClass('element-focused');
        //   
        //   // Add visual focus indicator
        //   if (!$(this).hasClass('focus-indicator')) {
        //     $(this).addClass('focus-indicator');
        //   }
        // });
        
        // DISABLED: JavaScript focus class removal - CSS handles focus styles now
        // $el.on('blur', function() {
        //   $(this).removeClass('element-focused focus-indicator');
        // });
      });
      
      // Enhanced table row focus
      $('.table tbody tr').each(function() {
        $(this).attr('tabindex', '0');
        // DISABLED: JavaScript focus class addition - CSS handles focus styles now
        // $(this).on('focus', function() {
        //   $(this).addClass('row-focused');
        // });
        // DISABLED: JavaScript focus class removal - CSS handles focus styles now
        // $(this).on('blur', function() {
        //   $(this).removeClass('row-focused');
        // });
      });
      
      // Enhanced product grid focus
      $('#parent .widget-panel').each(function() {
        $(this).attr('tabindex', '0');
        // DISABLED: JavaScript focus class addition - CSS handles focus styles now
        // $(this).on('focus', function() {
        //   $(this).addClass('product-focused');
        // });
        // DISABLED: JavaScript focus class removal - CSS handles focus styles now
        // $(this).on('blur', function() {
        //   $(this).removeClass('product-focused');
        // });
      });
    };
    
    // Enhanced keyboard navigation for tables
    $.fn.enhanceTableNavigation = function() {
      $('.table tbody tr').on('keydown', function(e) {
        const $currentRow = $(this);
        const $rows = $('.table tbody tr');
        const currentIndex = $rows.index($currentRow);
        
        switch(e.key) {
          case 'ArrowDown':
            e.preventDefault();
            if (currentIndex < $rows.length - 1) {
              $rows.eq(currentIndex + 1).focus();
            }
            break;
          case 'ArrowUp':
            e.preventDefault();
            if (currentIndex > 0) {
              $rows.eq(currentIndex - 1).focus();
            }
            break;
          case 'Enter':
          case ' ':
            e.preventDefault();
            $currentRow.trigger('dblclick');
            break;
        }
      });
    };
    
    // Enhanced keyboard navigation for product grid
    $.fn.enhanceProductGridNavigation = function() {
      $('#parent .widget-panel').on('keydown', function(e) {
        const $currentProduct = $(this);
        const $products = $('#parent .widget-panel');
        const currentIndex = $products.index($currentProduct);
        const colsPerRow = 6; // Assuming 6 columns per row
        
        switch(e.key) {
          case 'ArrowRight':
            e.preventDefault();
            if (currentIndex < $products.length - 1) {
              $products.eq(currentIndex + 1).focus();
            }
            break;
          case 'ArrowLeft':
            e.preventDefault();
            if (currentIndex > 0) {
              $products.eq(currentIndex - 1).focus();
            }
            break;
          case 'ArrowDown':
            e.preventDefault();
            const nextRowIndex = currentIndex + colsPerRow;
            if (nextRowIndex < $products.length) {
              $products.eq(nextRowIndex).focus();
            }
            break;
          case 'ArrowUp':
            e.preventDefault();
            const prevRowIndex = currentIndex - colsPerRow;
            if (prevRowIndex >= 0) {
              $products.eq(prevRowIndex).focus();
            }
            break;
          case 'Enter':
          case ' ':
            e.preventDefault();
            $currentProduct.trigger('click');
            break;
        }
      });
    };
    
    // Initialize enhanced focus management
    $(document).ready(function() {
      $.fn.enhanceFocusVisibility();
      $.fn.enhanceTableNavigation();
      $.fn.enhanceProductGridNavigation();
      
      // Add CSS for focus indicators
      $('<style>')
        .prop('type', 'text/css')
        .html(`
          .element-focused { 
            position: relative !important; 
            z-index: 1000 !important; 
          }

          .row-focused { 
            background-color: #e3f2fd !important; 
            box-shadow: inset 0 0 0 2px #17a2b8 !important; 
          }
          .product-focused { 
            transform: scale(1.05) !important; 
            z-index: 10 !important; 
          }

        `)
        .appendTo('head');
    });