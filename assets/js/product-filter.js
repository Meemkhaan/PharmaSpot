$(document).ready(function () {
  $("#categories").on("change", function () {
    filterProducts();
  });

  $("#manufacturers").on("change", function () {
    filterProducts();
  });

  $("#suppliers").on("change", function () {
    filterProducts();
  });

  $("#clearFilters").on("click", function () {
    $("#categories").val("0");
    $("#manufacturers").val("");
    $("#suppliers").val("");
    $("#search").val("");
    filterProducts();
    searchProducts();
  });

  function filterProducts() {
    let selectedCategory = $("#categories option:selected").val();
    let selectedManufacturer = $("#manufacturers option:selected").val();
    let selectedSupplier = $("#suppliers option:selected").val();
    
    console.log("Filtering products:", {
      category: selectedCategory,
      manufacturer: selectedManufacturer,
      supplier: selectedSupplier,
      totalProducts: $(".box").length
    });
    
    // Show all products first
    $(".box").show();
    
    // Apply category filter
    if (selectedCategory != "0") {
      let categoryProducts = $(".box." + selectedCategory);
      console.log("Category filter:", selectedCategory, "Products found:", categoryProducts.length);
      $(".box").not("." + selectedCategory).hide();
    }
    
    // Apply manufacturer filter if a manufacturer is selected
    if (selectedManufacturer) {
      let visibleProducts = $(".box:visible");
      let manufacturerMatches = 0;
      
      console.log("Checking manufacturer filter for:", selectedManufacturer);
      console.log("Visible products to check:", visibleProducts.length);
      
      visibleProducts.each(function() {
        let $product = $(this);
        let productText = $product.find(".name").text();
        
        console.log("Product text:", productText);
        console.log("Looking for:", selectedManufacturer);
        
        // Check if the product contains the selected manufacturer
        if (!productText.toLowerCase().includes(selectedManufacturer.toLowerCase())) {
          $product.hide();
        } else {
          manufacturerMatches++;
        }
      });
      
      console.log("Manufacturer filter:", selectedManufacturer, "Products matching:", manufacturerMatches);
    }
    
    // Apply supplier filter if a supplier is selected
    if (selectedSupplier) {
      let visibleProducts = $(".box:visible");
      let supplierMatches = 0;
      
      console.log("Checking supplier filter for:", selectedSupplier);
      console.log("Visible products to check:", visibleProducts.length);
      
      visibleProducts.each(function() {
        let $product = $(this);
        let productText = $product.find(".name").text();
        
        console.log("Product text:", productText);
        console.log("Looking for:", selectedSupplier);
        
        // Check if the product contains the selected supplier
        if (!productText.toLowerCase().includes(selectedSupplier.toLowerCase())) {
          $product.hide();
    } else {
          supplierMatches++;
        }
      });
      
      console.log("Supplier filter:", selectedSupplier, "Products matching:", supplierMatches);
    }
    
    let finalVisible = $(".box:visible").length;
    console.log("Final visible products:", finalVisible);
  }

  function searchProducts() {
    var matcher = new RegExp($("#search").val(), "gi");
    
    $(".box").each(function() {
      let $product = $(this);
      let productText = $product.find(".name, .sku").text();
      let matchesSearch = matcher.test(productText);
      
      // Show product only if it matches search
      if (matchesSearch) {
        $product.show();
      } else {
        $product.hide();
      }
    });
    
    // After search, apply category and manufacturer filters
    filterProducts();
  }

  let $search = $("#search").on("input", function () {
    searchProducts();
  });

  $("body").on("click", "#jq-keyboard button", function (e) {
    if ($("#search").is(":focus")) {
      searchProducts();
    }
  });

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
    }
  );

  $("body").on("click", ".customerOrderKeyboard .key", function () {
    if ($("#holdCustomerOrderInput").is(":focus")) {
      searchCustomerOrders();
    }
  });

});