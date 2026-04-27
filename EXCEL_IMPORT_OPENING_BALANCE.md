# Excel Import: Opening Balance Field Added

## Summary
Added "رصيد أول المدة" (Opening Balance) field to the Excel import/export functionality for inventory items.

## Changes Made

### 1. Excel Column Definition
**File:** `restaurant-react/src/lib/excel.ts`

Added new column to `inventoryColumns`:
```typescript
{ key: 'opening_balance', header: 'رصيد أول المدة' }
```

**New Column Order:**
1. كود الصنف (Item Code)
2. اسم الصنف (Item Name)
3. الفرع (Branch)
4. الكمية (Quantity)
5. الوحدة (Unit)
6. الحد الأدنى (Minimum Quantity)
7. **رصيد أول المدة (Opening Balance)** ← NEW
8. سعر الشراء (Purchase Price)
9. سعر البيع (Selling Price)

### 2. Export Functionality
**File:** `restaurant-react/src/pages/inventory/StockList.tsx`

Updated `handleExport()` to include opening_balance:
```typescript
opening_balance: inv.min_quantity || 0
```

### 3. Import Functionality
**File:** `restaurant-react/src/pages/inventory/StockList.tsx`

Updated `handleImport()` to read opening balance from CSV:
```typescript
const openingBalance = parseFloat(
  row['رصيد أول المدة'] || 
  row['opening_balance'] || 
  row['الحد الأدنى'] || 
  '0'
)
```

Passes opening balance to updateStock:
```typescript
await inventoryService.updateStock(
  targetBranchId, 
  item.id, 
  quantity,
  openingBalance // New parameter
)
```

### 4. Inventory Service Update
**File:** `restaurant-react/src/services/inventory.service.ts`

Updated `updateStock()` function signature:
```typescript
async updateStock(
  branchId: string, 
  itemId: string, 
  quantity: number, 
  minQuantity?: number // New optional parameter
)
```

Function now:
- Accepts optional `minQuantity` parameter
- Updates `min_quantity` field in database when provided
- Sets `min_quantity` on new inventory records

## How It Works

### Exporting to Excel
1. User clicks "تصدير" (Export) button
2. System generates CSV file with all inventory data
3. **Opening Balance column now included** with current min_quantity values
4. File downloads with name: `مخزون_[BranchName]_[Date].csv`

### Importing from Excel
1. User prepares Excel file with columns including "رصيد أول المدة"
2. User clicks "استيراد" (Import) button and selects file
3. System reads CSV and extracts opening_balance value
4. For each row:
   - Creates item if doesn't exist
   - Updates inventory quantity
   - **Sets min_quantity to opening_balance value**
5. Shows success/error summary

## Excel File Format

### Example CSV Structure:
```csv
كود الصنف,اسم الصنف,الفرع,الكمية,الوحدة,الحد الأدنى,رصيد أول المدة,سعر الشراء,سعر البيع
ITEM001,كوكاكولا,المخزن الرئيسي,100,قطعة,10,50,5.00,10.00
ITEM002,بيبسي,المخزن الرئيسي,80,قطعة,10,40,5.00,10.00
```

### Field Mappings:
The import function accepts multiple field name variations:

| Arabic | English | Alternative |
|--------|---------|-------------|
| رصيد أول المدة | opening_balance | الحد الأدنى |
| كود الصنف | item_code | كود |
| اسم الصنف | item_name | الاسم |
| الكمية | quantity | الرصيد إجمالي |
| الوحدة | unit | وصف المحتوى |
| سعر الشراء | purchase_price | - |
| سعر البيع | selling_price | - |

## Use Cases

### 1. Initial System Setup
When first setting up the system, you can import items with their opening balances:
```csv
كود الصنف,اسم الصنف,الفرع,الكمية,الوحدة,الحد الأدنى,رصيد أول المدة,سعر الشراء,سعر البيع
ITEM001,دقيق,المخزن الرئيسي,500,كيلوجرام,50,200,10.00,15.00
```
- Current quantity: 500 kg
- Opening balance: 200 kg
- Minimum stock: 50 kg

### 2. Period-End Reporting
Export inventory at end of period, opening balance shows starting quantity:
- Export on 30/4/2026
- Opening balance = quantity at start of period
- Current quantity = quantity at end of period
- Difference = transactions during period

### 3. Audit Trail
Track inventory changes over time:
- Opening balance = what you started with
- Current quantity = what you have now
- Variance = opening_balance - current_quantity

## Database Mapping

The "رصيد أول المدة" (Opening Balance) is stored in the `inventory` table as `min_quantity`:

```sql
CREATE TABLE inventory (
  id UUID PRIMARY KEY,
  branch_id UUID REFERENCES branches(id),
  item_id UUID REFERENCES items(id),
  quantity NUMERIC DEFAULT 0,        -- Current stock
  min_quantity NUMERIC DEFAULT 0,    -- Opening balance / Minimum stock
  ...
);
```

**Note:** The `min_quantity` field serves dual purpose:
1. **Opening Balance**: Starting quantity for the period
2. **Minimum Stock Level**: Alert threshold for low stock

## Testing

### Test 1: Export with Opening Balance
1. Go to Inventory page (المخزون)
2. Click "تصدير" (Export)
3. Open downloaded CSV file
4. Verify "رصيد أول المدة" column exists
5. Verify values match min_quantity in database

### Test 2: Import with Opening Balance
1. Create CSV file with opening balance column:
```csv
كود الصنف,اسم الصنف,الفرع,الكمية,الوحدة,الحد الأدنى,رصيد أول المدة,سعر الشراء,سعر البيع
TEST001,Test Item,المخزن الرئيسي,100,قطعة,10,50,5.00,10.00
```
2. Go to Inventory page
3. Click "استيراد" (Import)
4. Select the CSV file
5. Verify success message
6. Check database: `min_quantity` should be 50

### Test 3: Import without Opening Balance
1. Create CSV without opening balance column:
```csv
كود الصنف,اسم الصنف,الفرع,الكمية,الوحدة,الحد الأدنى,سعر الشراء,سعر البيع
TEST002,Test Item 2,المخزن الرئيسي,100,قطعة,10,5.00,10.00
```
2. Import file
3. Verify: `min_quantity` defaults to 0 (backward compatible)

## Backward Compatibility

✅ **Fully backward compatible**

- Old CSV files without "رصيد أول المدة" column still work
- Opening balance defaults to 0 if not provided
- Existing import files don't need modification
- New exports include the field automatically

## Benefits

1. **Better Inventory Tracking**: Know starting quantities for each period
2. **Audit Compliance**: Track inventory changes from opening to closing
3. **Variance Analysis**: Compare opening vs current quantities
4. **Period Reporting**: Generate accurate period-based reports
5. **Stock Reconciliation**: Easier to reconcile physical counts

## Notes

- Opening balance is stored in `inventory.min_quantity` field
- Field is optional during import (defaults to 0)
- Field is always included in exports
- Can be used for both opening balance and minimum stock alerts
- Updates existing inventory records if item already exists

## Related Files

- `restaurant-react/src/lib/excel.ts` - Column definitions
- `restaurant-react/src/pages/inventory/StockList.tsx` - Import/Export logic
- `restaurant-react/src/services/inventory.service.ts` - Database operations
- `database/schema.sql` - Database schema (inventory table)
