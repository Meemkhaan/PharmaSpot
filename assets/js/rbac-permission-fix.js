/**
 * RBAC Permission Checkbox Fix
 * This file enables permission checkboxes when adding new users
 * Load this AFTER pos.js in index.html
 */

(function () {
    'use strict';

    console.log('[RBAC Fix] Permission checkbox enabler loaded');

    // Wait for DOM to be ready
    $(document).ready(function () {
        console.log('[RBAC Fix] Initializing permission checkbox fix');

        // Function to enable all permission checkboxes
        function enablePermissionCheckboxes() {
            $('.perms input[type="checkbox"]').each(function () {
                const $checkbox = $(this);
                const checkboxId = $checkbox.attr('id');
                
                // Enable all checkboxes except settings (which is handled separately)
                if (checkboxId !== 'perm_settings') {
                    $checkbox.prop('disabled', false);
                    console.log('[RBAC Fix] Enabled checkbox:', checkboxId);
                }
            });
        }

        // Override the "Add New User" button click handler (#add-user)
        $(document).off('click', '#add-user').on('click', '#add-user', function (e) {
            console.log('[RBAC Fix] Add New User clicked (#add-user)');

            // Show permissions if not network terminal
            if (typeof platform !== 'undefined' && platform.app != "Network Point of Sale Terminal") {
                $(".perms").show();
            }

            // Enable all permission checkboxes
            enablePermissionCheckboxes();

            // Hide settings permission by default
            $('#settingsPermGroup').hide();
            $('#perm_settings').prop('checked', false).prop('disabled', true);

            console.log('[RBAC Fix] Modal shown with enabled checkboxes');
        });

        // Also handle the newUserBtn button
        $(document).off('click', '#newUserBtn').on('click', '#newUserBtn', function (e) {
            console.log('[RBAC Fix] New User button clicked (#newUserBtn)');
            
            // Enable all permission checkboxes
            enablePermissionCheckboxes();
        });

        // Handle when user modal is shown (for both new and edit)
        $('#userModal').on('shown.bs.modal', function () {
            console.log('[RBAC Fix] User modal shown, ensuring checkboxes are enabled');
            enablePermissionCheckboxes();
        });

        console.log('[RBAC Fix] Permission checkbox fix initialized successfully');
    });

})();
