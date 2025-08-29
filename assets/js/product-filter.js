$(document).ready(function () {
  // Debounce function to prevent excessive calls
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Only category filter remains - simplified
  $("#categories").on("change", function () {
    filterProducts();
  });

  // Clear filters button
  $("#clearFilters").on("click", function () {
    $("#categories").val("0");
    $("#search").val("");
    filterProducts();
  });

  // Main filtering function - simplified
  function filterProducts() {
    let selectedCategory = $("#categories option:selected").val();
    let searchTerm = $("#search").val().toLowerCase().trim();
    
    // Show all products first
    $(".box").show();
    
    // Apply category filter
    if (selectedCategory && selectedCategory !== "0") {
      $(".box").not("." + selectedCategory).hide();
    }
    
    // Apply search filter if there's a search term
    if (searchTerm) {
      $(".box:visible").each(function() {
        let $product = $(this);
        let productText = $product.find(".name, .sku").text().toLowerCase();
        
        if (!productText.includes(searchTerm)) {
          $product.hide();
        }
      });
    }
    
    // Update product count display
    let visibleCount = $(".box:visible").length;
    let totalCount = $(".box").length;
    
    // Optional: Update a product count display if it exists
    if ($("#productCount").length) {
      $("#productCount").text(`${visibleCount} of ${totalCount} products`);
    }
  }

  // Debounced search function
  const debouncedSearch = debounce(function() {
    filterProducts();
  }, 300);

  // Search input handler with debouncing
  $("#search").on("input", function () {
    debouncedSearch();
  });

  // Clear search on escape key
  $("#search").on("keydown", function(e) {
    if (e.key === "Escape") {
      $(this).val("");
      filterProducts();
    }
  });

  // Keyboard navigation for search
  $("body").on("click", "#jq-keyboard button", function (e) {
    if ($("#search").is(":focus")) {
      debouncedSearch();
    }
  });

  // Search open orders functionality
  function searchOpenOrders() {
    var matcher = new RegExp($("#holdOrderInput").val(), "gi");
    $(".order")
      .show()
      .not(function () {
        return matcher.test($(this).find(".ref_number").text());
      })
      .hide();
  }

  var $searchHoldOrder = $("#holdOrderInput").on("input", function () {
    searchOpenOrders();
  });

  $("body").on("click", ".holdOrderKeyboard .key", function () {
    if ($("#holdOrderInput").is(":focus")) {
      searchOpenOrders();
    }
  });

  // Search customer orders functionality
  function searchCustomerOrders() {
    var matcher = new RegExp($("#holdCustomerOrderInput").val(), "gi");
    $(".customer-order")
      .show()
      .not(function () {
        return matcher.test($(this).find(".customer_name").text());
      })
      .hide();
  }

  $("#holdCustomerOrderInput").on("input", function () {
    searchCustomerOrders();
  });

  $("body").on("click", ".customerOrderKeyboard .key", function () {
    if ($("#holdCustomerOrderInput").is(":focus")) {
      searchCustomerOrders();
    }
  });

  // Don't initialize immediately - wait for products to load
  // filterProducts() will be called from loadProducts() after products are loaded
});