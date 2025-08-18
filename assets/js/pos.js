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
let start = moment().startOf("month");
let end = moment();
let start_date = moment(start).toDate().toJSON();
let end_date = moment(end).toDate().toJSON();
let by_till = 0;
let by_user = 0;
let by_status = 1;
const default_item_img = path.join("assets","images","default.jpg");
const permissions = [
  "perm_products",
  "perm_categories",
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

// Dismiss all stacked notifications (expiry/low-stock, etc.)
$(document).on('click', '#clearAlerts', function() {
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
    loadProducts();
    loadCustomers();

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
          case 51: // Ctrl+3: Transactions
            $('#viewRefOrders').click();
            break;
          case 52: // Ctrl+4: Settings
            $('#settings').click();
            break;
          case 53: // Ctrl+5: Users
            $('#usersModal').click();
            break;
          case 54: // Ctrl+6: Point of Sale (Orders)
            $('#viewCustomerOrders').click();
            break;
          case 55: // Ctrl+7: Open Tabs (Hold Orders)
            $('#viewRefOrders').click();
            break;
          case 56: // Ctrl+8: Orders
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
                      <li><kbd>Ctrl+3</kbd> Transactions</li>
                      <li><kbd>Ctrl+4</kbd> Settings</li>
                      <li><kbd>Ctrl+5</kbd> Users</li>
                      <li><kbd>Ctrl+6</kbd> Point of Sale</li>
                      <li><kbd>Ctrl+7</kbd> Open Tabs</li>
                      <li><kbd>Ctrl+8</kbd> Orders</li>
                    </ul>
                  </div>
                  <div class="col-md-6">
                    <h5>Actions</h5>
                    <ul class="list-unstyled">
                      <li><kbd>Ctrl+9</kbd> Bulk Import</li>
                      <li><kbd>Alt+0</kbd> Bulk Remove</li>
                      <li><kbd>Alt+N</kbd> New Product</li>
                      <li><kbd>Alt+C</kbd> New Category</li>
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
                                        <div class="name" id="product_name"><span class="${
                                          item_isExpired ? "text-danger" : ""
                                        }">${item.name}</span></div> 
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
      });
    }

    function loadCategories() {
      $.get(api + "categories/all", function (data) {
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
                  class: "form-control",
                  type: "text",
                  readonly: "",
                  value: data.quantity,
                  min: "1",
                  onInput: "$(this).qtInput(" + index + ")",
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
      item = cart[i];
      item.quantity = $(this).val();
      $(this).renderTable(cart);
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
        case 3:
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
          $("#orderModal").modal("show");
          loadProducts();
          loadCustomers();
          $(".loading").hide();
          $("#dueModal").modal("hide");
          $("#paymentModel").modal("hide");
          $(this).getHoldOrders();
          $(this).getCustomerOrders();
          $(this).renderTable(cart);
        },

        error: function (data) {
          $(".loading").hide();
          $("#dueModal").modal("toggle");
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
          "Nope!",
          "Please enter the amount that was paid!",
          "Ok",
        );
      } else {
        $(this).submitDueOrder(1);
      }
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
    });

    $("#saveProduct").submit(function (e) {
      e.preventDefault();

      $(this).attr("action", api + "inventory/product");
      $(this).attr("method", "POST");

      $(this).ajaxSubmit({
        contentType: "application/json",
        success: function (response) {
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
          $("#saveCategory").get(0).reset();
          loadCategories();
          loadProducts();
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

    $.fn.editProduct = function (index) {
      $("#Products").modal("hide");

      $("#category option")
        .filter(function () {
          return $(this).val() == allProducts[index].category;
        })
        .prop("selected", true);

      $("#productName").val(allProducts[index].name);
      $("#product_price").val(allProducts[index].price);
      $("#quantity").val(allProducts[index].quantity);
      $("#barcode").val(allProducts[index].barcode || allProducts[index]._id);
      $("#expirationDate").val(allProducts[index].expirationDate);
      $("#minStock").val(allProducts[index].minStock || 1);
      $("#product_id").val(allProducts[index]._id);
      $("#img").val(allProducts[index].img);

      if (allProducts[index].img != "") {
        $("#imagename").hide();
        $("#current_img").html(
          `<img src="${img_path + allProducts[index].img}" alt="">`,
        );
        $("#rmv_img").show();
      }

      if (allProducts[index].stock == 0) {
        $("#stock").prop("checked", true);
      }

      $("#newProduct").modal("show");
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
              notiflix.Report.success("Done!", "Product deleted", "Ok");
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
              notiflix.Report.success("Done!", "Category deleted", "Ok");
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
      const csvContent = "Name,Barcode,Price,Category,Quantity,MinStock,ExpirationDate\nParacetamol 500mg,123456789,5.99,Medicines,100,10,31/12/2025\nIbuprofen 400mg,987654321,4.99,Medicines,50,5,30/06/2025\nAspirin 100mg,456789123,3.99,,75,8,31/03/2026";
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
      
      // Get the selected default category value
      const defaultCategory = $("#defaultCategory").val();
      if (defaultCategory) {
        formData.append('defaultCategory', defaultCategory);
      }
      
      console.log("Bulk import parameters:");
      console.log("- Skip Duplicates:", $("#skipDuplicates").is(':checked'));
      console.log("- Update Existing:", $("#updateExisting").is(':checked'));
      console.log("- Default Category:", defaultCategory);
      
      $("#submitBulkImport").prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Importing...');
      $("#importProgress").show();
      $("#importStatus").text("Starting import...");
      
      $.ajax({
        url: api + "inventory/bulk-import",
        type: "POST",
        data: formData,
        processData: false,
        contentType: false,
        success: function (response) {
          $("#submitBulkImport").prop('disabled', false).html('<i class="fa fa-upload"></i> Import Products');
          $("#importProgress").hide();
          
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
            
                         // Refresh products list
             loadProducts();
             
             // Close modal
             $("#bulkImport").modal("hide");
             
             // Reopen Products modal to show updated list
             $("#Products").modal("show");
          }
        },
        error: function (jqXHR, textStatus, errorThrown) {
          $("#submitBulkImport").prop('disabled', false).html('<i class="fa fa-upload"></i> Import Products');
          $("#importProgress").hide();
          
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
            <td>${product.name}
            ${product.expiryAlert}</td>
            <td>${validator.unescape(settings.symbol)}${product.price}</td>
            <td>${product.stock == 1 ? product.quantity : "N/A"}
            ${product.stockAlert}
            </td>
            <td>${product.expirationDate}</td>
            <td>${category.length > 0 ? category[0].name : ""}</td>
            <td class="nobr"><span class="btn-group"><button onClick="$(this).editProduct(${index})" class="btn btn-warning btn-sm"><i class="fa fa-edit"></i></button><button onClick="$(this).deleteProduct(${
              product._id
            })" class="btn btn-danger btn-sm"><i class="fa fa-trash"></i></button></span></td></tr>`;

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
    if (transactions.length > 0) {
      $("#transaction_list").empty();
      $("#transactionList").DataTable().destroy();

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
        transaction_list += `<tr>
                                <td>${trans.order}</td>
                                <td class="nobr">${moment(trans.date).format(
                                  "DD-MMM-YYYY HH:mm:ss",
                                )}</td>
                                <td>${
                                  validator.unescape(settings.symbol) + moneyFormat(trans.total)
                                }</td>
                                <td>${
                                  trans.paid == ""
                                    ? ""
                                    : validator.unescape(settings.symbol) + moneyFormat(trans.paid)
                                }</td>
                                <td>${
                                  trans.change
                                    ? validator.unescape(settings.symbol) +
                                      moneyFormat(
                                        Math.abs(trans.change).toFixed(2),
                                      )
                                    : ""
                                }</td>
                                <td>${
                                  trans.paid == ""
                                    ? ""
                                    : trans.payment_type
                                }</td>
                                <td>${trans.till}</td>
                                <td>${trans.user}</td>
                                <td>${
                                  trans.paid == ""
                                    ? '<button class="btn btn-dark"><i class="fa fa-search-plus"></i></button>'
                                    : '<button onClick="$(this).viewTransaction(' +
                                      index +
                                      ')" class="btn btn-info"><i class="fa fa-search-plus"></i></button></td>'
                                }</tr>
                    `;

        if (counter == transactions.length) {
          $("#total_sales #counter").text(
            validator.unescape(settings.symbol) + moneyFormat(parseFloat(sales).toFixed(2)),
          );
          $("#total_transactions #counter").text(transact);

          const result = {};

          for (const { product_name, price, quantity, id } of sold_items) {
            if (!result[product_name]) result[product_name] = [];
            result[product_name].push({ id, price, quantity });
          }

          for (item in result) {
            let price = 0;
            let quantity = 0;
            let id = 0;

            result[item].forEach((i) => {
              id = i.id;
              price = i.price;
              quantity = quantity + parseInt(i.quantity);
            });

            sold.push({
              id: id,
              product: item,
              qty: quantity,
              price: price,
            });
          }

          loadSoldProducts();

          if (by_user == 0 && by_till == 0) {
            userFilter(users);
            tillFilter(tills);
          }

          $("#transaction_list").html(transaction_list);
          $("#transactionList").DataTable({
            order: [[1, "desc"]],
            autoWidth: false,
            info: true,
            JQueryUI: true,
            ordering: true,
            paging: true,
            dom: "Bfrtip",
            buttons: ["csv", "excel", "pdf"],
          });
        }
      });
    } else {
      notiflix.Report.warning(
        "No data!",
        "No transactions available within the selected criteria",
        "Ok",
      );
    }
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

    sold_list += `<tr>
            <td>${item.product}</td>
            <td>${item.qty}</td>
            <td>${stockCell}</td>
            <td>${
              validator.unescape(settings.symbol) +
              moneyFormat((item.qty * parseFloat(item.price)).toFixed(2))
            }</td>
            </tr>`;

    if (counter == sold.length) {
      $("#total_items #counter").text(items);
      $("#total_products #counter").text(products);
      $("#product_sales").html(sold_list);
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

    $("#users").append(`<option value="${user}">${u[0].fullname}</option>`);
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
    items += `<tr><td>${item.product_name}</td><td>${
      item.quantity
    } </td><td class="text-right"> ${validator.unescape(settings.symbol)} ${moneyFormat(
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
        Invoice : ${orderNumber} <br>
        Ref No : ${refNumber} <br>
        Customer : ${
          allTransactions[index].customer == 0
            ? "Walk in Customer"
            : allTransactions[index].customer.name
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
                <h5>${validator.unescape(settings.symbol)}${moneyFormat(
                  allTransactions[index].total,
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
          case 49: // 1 key - Cash payment
            e.preventDefault();
            $('.list-group-item[data-payment-type="1"]').click();
            break;
          case 50: // 2 key - Card payment
            e.preventDefault();
            $('.list-group-item[data-payment-type="3"]').click();
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