const utils = require("./utils");

/** CheckOut Functions **/
$(document).ready(function () {
  /**
   * handle keypad button pressed.
   * @param {string} value - The keypad value to be processed.
   * @param {boolean} isDueInput - Indicates whether the input is for due payment.
   */
  $.fn.keypadBtnPressed = function (value, isDueInput) {
    let paymentAmount = $("#payment").val();
    if (isDueInput) {
      $("#refNumber").val($("#refNumber").val() + "" + value);
    } else {
      paymentAmount = paymentAmount + "" + value;
      // Update both fields - paymentText shows formatted, payment stores raw value
      $("#paymentText").val(paymentAmount);
      $("#payment").val(paymentAmount);
      $(this).calculateChange();
    }
  };

  /**
   * Format payment amount with commas when a point is pressed
   */
  $.fn.digits = function () {
    let paymentAmount = $("#payment").val();
    // Only add decimal point if there isn't one already
    if (paymentAmount.indexOf('.') === -1) {
      paymentAmount = paymentAmount + ".";
      $("#paymentText").val(paymentAmount);
      $("#payment").val(paymentAmount);
      $(this).calculateChange();
    }
  };

  /**
   * Calculate and display the balance due.
   */
  $.fn.calculateChange = function () {
    var payablePrice = parseFloat($("#payablePrice").val().replace(",", "")) || 0;
    var payment = parseFloat($("#payment").val().replace(",", "")) || 0;
    var change = payment - payablePrice;
    
    // Update change display with better formatting
    if (change >= 0) {
      $("#change").text(utils.moneyFormat(change.toFixed(2)));
      $("#confirmPayment").show().removeClass("btn-warning").addClass("btn-success");
      $("#confirmPayment").html('<i class="fa fa-check"></i> Confirm Payment');
    } else {
      var shortfall = Math.abs(change);
      $("#change").text(utils.moneyFormat(shortfall.toFixed(2)));
      $("#confirmPayment").show().removeClass("btn-success").addClass("btn-warning");
      $("#confirmPayment").html('<i class="fa fa-exclamation-triangle"></i> Insufficient Payment');
    }
    
    // Update change display styling
    if (change >= 0) {
      $("#change").parent().removeClass("alert-warning").addClass("alert-success");
      $("#change").parent().find("strong").text("Change Due:");
    } else {
      $("#change").parent().removeClass("alert-success").addClass("alert-warning");
      $("#change").parent().find("strong").text("Amount Short:");
    }
  };

  var $keypadBtn = $(".keypad-btn").on("click", function () {
    const key = $(this).data("val");
    const isdue = $(this).data("isdue");
    switch(key)
    {
    case "del" : { 
      if(isdue)
      {
        $('#refNumber').val((i, val) => val.slice(0, -1));
      }
      else
      {
        let currentValue = $("#payment").val();
        let newValue = currentValue.slice(0, -1);
        $("#payment").val(newValue);
        $("#paymentText").val(newValue);
      }
      $(this).calculateChange()
    }; break;

    case "ac":{
      if(isdue)
      {
          $('#refNumber').val('');
      }
      else
      {
        $('#payment,#paymentText').val('');
        $(this).calculateChange();
      }
       
    };break;

  case "point": {
    $(this).digits()
    };break;

   default: $(this).keypadBtnPressed(key, isdue); break;
  }
});

  /** Switch Views for Payment Options **/
  var $list = $(".list-group-item").on("click", function () {
    $list.removeClass("active");
    $(this).addClass("active");
    var paymentType = $(this).data("payment-type");
    if (paymentType == 2) { // Card payment
      $("#cardInfo").show();
      $("#cardInfo .input-group-addon").text("Card Info");
    } else if (paymentType == 1) { // Cash payment
      $("#cardInfo").hide();
    }
  });

  /** Handle direct keyboard input in payment field **/
  $("#paymentText").on("input", function () {
    let value = $(this).val();
    // Remove any non-numeric characters except decimal point
    value = value.replace(/[^0-9.]/g, '');
    // Ensure only one decimal point
    let parts = value.split('.');
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }
    // Update both fields
    $(this).val(value);
    $("#payment").val(value);
    $(this).calculateChange();
  });

  /** Handle keydown events for payment field **/
  $("#paymentText").on("keydown", function (e) {
    // Allow: backspace, delete, tab, escape, enter
    if ([8, 9, 27, 13, 46].indexOf(e.keyCode) !== -1 ||
        // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
        (e.keyCode === 65 && e.ctrlKey === true) ||
        (e.keyCode === 67 && e.ctrlKey === true) ||
        (e.keyCode === 86 && e.ctrlKey === true) ||
        (e.keyCode === 88 && e.ctrlKey === true) ||
        // Allow: home, end, left, right
        (e.keyCode >= 35 && e.keyCode <= 40)) {
      return;
    }
    // Ensure that it is a number and stop the keypress
    if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105) && e.keyCode !== 190) {
      e.preventDefault();
    }
  });

  /** Handle paste events for payment field **/
  $("#paymentText").on("paste", function (e) {
    setTimeout(() => {
      let value = $(this).val();
      // Remove any non-numeric characters except decimal point
      value = value.replace(/[^0-9.]/g, '');
      // Ensure only one decimal point
      let parts = value.split('.');
      if (parts.length > 2) {
        value = parts[0] + '.' + parts.slice(1).join('');
      }
      // Update both fields
      $(this).val(value);
      $("#payment").val(value);
      $(this).calculateChange();
    }, 0);
  });

  /** Handle keyboard input for reference number field **/
  $("#refNumber").on("input", function() {
    let value = $(this).val();
    // Allow alphanumeric characters, spaces, and common reference characters
    value = value.replace(/[^a-zA-Z0-9\s\-_]/g, '');
    $(this).val(value);
  });

  /** Handle Enter key for hold order submission **/
  $("#refNumber").on("keydown", function(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if ($(this).val().trim() !== "") {
        $(this).submitDueOrder(0);
      } else {
        notiflix.Report.warning(
          "Reference Required!",
          "Please enter a reference number for the hold order.<br><small>Press ESC to close this message</small>",
          "Ok"
        );
      }
    }
  });

  /** Handle Enter key for payment processing **/
  $("#paymentText").on("keydown", function(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if ($(this).val().trim() !== "") {
        $("#confirmPayment").click();
      } else {
        notiflix.Report.warning(
          "Payment Required!",
          "Please enter the payment amount.<br><small>Press ESC to close this message</small>",
          "Ok"
        );
      }
    }
  });
});