# Bulk Import Feature for PharmaSpot

## Overview
The bulk import feature allows users to import multiple products at once from a CSV file, making it easy to populate the inventory with large numbers of products efficiently.

## Features

### 1. CSV Import
- Import products from CSV files
- Support for all product fields including categories
- Automatic validation of required fields
- Error reporting for failed imports

### 2. Import Options
- **Skip Duplicates**: Skip products with existing barcodes
- **Update Existing**: Update existing products instead of skipping them
- **Default Category**: Set a default category for products without category specification

### 3. User Interface
- Dedicated bulk import button in the main interface
- Modal with clear instructions and form
- Progress tracking during import
- Downloadable CSV template

### 4. Keyboard Shortcut
- **Ctrl+9**: Quick access to bulk import modal

## CSV Format

The CSV file should have the following columns:

| Column | Required | Description | Example |
|--------|----------|-------------|---------|
| Name | Yes | Product name | Paracetamol 500mg |
| Barcode | Yes | Product barcode (numeric) | 123456789 |
| Price | Yes | Product price (numeric) | 5.99 |
| Category | Yes | Product category | Medicines |
| Quantity | No | Initial stock quantity (default: 0) | 100 |
| MinStock | No | Minimum stock level (default: 1) | 10 |
| ExpirationDate | No | Expiry date (DD/MM/YYYY format) | 31/12/2025 |

### Sample CSV Content
```csv
Name,Barcode,Price,Category,Quantity,MinStock,ExpirationDate
Paracetamol 500mg,123456789,5.99,Medicines,100,10,31/12/2025
Ibuprofen 400mg,987654321,4.99,Medicines,50,5,30/06/2025
```

## Usage Instructions

### 1. Access Bulk Import
- Click the "Bulk Import" button in the main interface
- Or use the keyboard shortcut **Ctrl+9**

### 2. Prepare CSV File
- Create a CSV file with the required columns
- Ensure the first row contains column headers
- Use the downloadable template as a reference

### 3. Configure Import Options
- Select your CSV file
- Choose a default category (if needed)
- Set import preferences:
  - Skip duplicate barcodes
  - Update existing products

### 4. Execute Import
- Click "Import Products"
- Monitor progress in the progress bar
- Review results and any error messages

## Error Handling

The system provides detailed error reporting for:
- Missing required fields
- Invalid data formats
- Duplicate barcodes (when skip option is enabled)
- Database errors during import

## Permissions

The bulk import feature respects user permissions:
- Users with `perm_products` permission can access bulk import
- Users without this permission will not see the bulk import button

## Technical Details

### API Endpoint
- **POST** `/api/inventory/bulk-import`
- Accepts multipart form data with CSV file
- Returns detailed import results

### File Processing
- Uses `csv-parser` library for CSV parsing
- Automatic file cleanup after processing
- Progress tracking for large files

### Database Operations
- Supports both insert and update operations
- Maintains data integrity with validation
- Preserves existing product IDs when updating

## Troubleshooting

### Common Issues
1. **CSV Format Errors**: Ensure proper comma separation and column headers
2. **Permission Denied**: Check user permissions for product management
3. **Import Failures**: Review error messages for specific row issues
4. **File Size**: Large CSV files may take longer to process

### Best Practices
1. Always test with a small CSV file first
2. Use the provided template as a starting point
3. Validate data before importing
4. Keep backup of existing data before bulk operations

## Future Enhancements

Potential improvements for future versions:
- Excel file support (.xlsx, .xls)
- Batch processing for very large files
- Import scheduling for off-peak hours
- Advanced validation rules
- Import history and rollback functionality
