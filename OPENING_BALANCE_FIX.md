# Opening Balance Fix - Using Proper Field

## Problem
Previously, "رصيد أول المدة" (Opening Balance) was incorrectly mapped to `min_quantity` field, which is meant for minimum stock alerts.

## Solution
Now using the proper `opening_balance` field that already exists in the database.

## Database Schema

The `inventory` table has these fields:

```sql
CREATE TABLE inventory (
    id UUID PRIMARY KEY,
    branch_id UUID REFERENCES branches(id),
    item_id UUID REFERENCES items(id),
    quantity NUMERIC DEFAULT 0,              -- Current stock
    min_quantity NUMERIC DEFAULT 0,          -- Minimum stock alert level
    opening_balance NUMERIC DEFAULT 0,       -- Opening balance (start of period)
    ...
);
```

## Field Meanings

| Field | Arabic | Purpose | Example |
|-------|--------|---------|---------|
| `opening_balance` | رصيد أول المدة | Starting quantity for the period | 12 items at start |
| `quantity` | الكمية | Current stock quantity | 25 items now |
| `min_quantity` | الحد الأدنى | Minimum stock alert threshold | Alert when < 5 |

## Changes Made

### 1. Inventory Service
**File:** `restaurant-react/src/services/inventory.service.ts`

Updated `updateStock()` function:
```typescript
async updateStock(
  branchId: string, 
  itemId: string, 
  quantity: number, 
  openingBalance?: number  // Now updates opening_balance field
)
```

### 2. Excel Export
**File:** `restaurant-react/src/pages/inventory/StockList.tsx`

```typescript
// Before (WRONG):
opening_balance: inv.min_quantity || 0

// After (CORRECT):
opening_balance: inv.opening_balance || 0
```

### 3. Table Display
**File:** `restaurant-react/src/pages/inventory/StockList.tsx`

```typescript
// Before (WRONG):
<td>{formatNumber(inv.min_quantity || 0)}</td>

// After (CORRECT):
<td>{formatNumber(inv.opening_balance || 0)}</td>
```

## How It Works Now

### Excel Import Example:
```csv
كود الصنف,اسم الصنف,الفرع,الكمية,الوحدة,الحد الأدنى,رصيد أول المدة,سعر الشراء,سعر البيع
ITEM001,كوكاكولا,المخزن الرئيسي,25,قطعة,5,12,5.00,10.00
```

**Result in Database:**
- `opening_balance` = 12 (starting quantity)
- `quantity` = 25 (current stock)
- `min_quantity` = 5 (alert threshold)

### Meaning:
- Started the period with **12 items** (رصيد أول المدة)
- Currently have **25 items** (الكمية)
- Alert when stock falls below **5 items** (الحد الأدنى)
- Difference: 25 - 12 = **13 items added** during the period

## Use Cases

### Case 1: New Item with Opening Balance
```csv
كود الصنف,اسم الصنف,الفرع,الكمية,الوحدة,الحد الأدنى,رصيد أول المدة,سعر الشراء,سعر البيع
NEW001,منتج جديد,المخزن الرئيسي,50,قطعة,10,20,15.00,25.00
```

**Database:**
- `opening_balance` = 20 (started with 20)
- `quantity` = 50 (now have 50)
- `min_quantity` = 10 (alert at 10)

**Analysis:**
- Started with 20 items
- Added 30 items (50 - 20 = 30)
- Still above minimum (50 > 10) ✓

### Case 2: Period-End Reporting
```csv
كود الصنف,اسم الصنف,الفرع,الكمية,الوحدة,الحد الأدنى,رصيد أول المدة,سعر الشراء,سعر البيع
ITEM002,دقيق,المخزن الرئيسي,100,كيلوجرام,50,200,10.00,15.00
```

**Database:**
- `opening_balance` = 200 kg (started with)
- `quantity` = 100 kg (now have)
- `min_quantity` = 50 kg (alert threshold)

**Analysis:**
- Started with 200 kg
- Used 100 kg (200 - 100 = 100 kg consumed)
- Still above minimum (100 > 50) ✓

### Case 3: Low Stock Alert
```csv
كود الصنف,اسم الصنف,الفرع,الكمية,الوحدة,الحد الأدنى,رصيد أول المدة,سعر الشراء,سعر البيع
ITEM003,سكر,المخزن الرئيسي,3,كيلوجرام,10,50,8.00,12.00
```

**Database:**
- `opening_balance` = 50 kg (started with)
- `quantity` = 3 kg (now have)
- `min_quantity` = 10 kg (alert threshold)

**Analysis:**
- Started with 50 kg
- Used 47 kg (50 - 3 = 47 kg consumed)
- **ALERT**: Below minimum (3 < 10) ⚠️

## UI Display

### Inventory Page (Main Warehouse):
```
┌────────────────────────────────────────────────────────────────┐
│ كود │ اسم الصنف │ رصيد أول المدة │ الوارد │ الرصيد إجمالي │ ... │
├─────┼───────────┼───────────────┼────────┼──────────────┼─────┤
│ 001 │ كوكاكولا  │      12       │   -    │      25      │ ... │
│ 002 │ دقيق      │     200       │   -    │     100      │ ... │
│ 003 │ سكر       │      50       │   -    │       3      │ ... │
└────────────────────────────────────────────────────────────────┘
```

## Benefits

1. **Accurate Tracking**: Opening balance is separate from minimum stock
2. **Period Analysis**: Can calculate consumption (opening - current)
3. **Proper Alerts**: Minimum stock alerts work independently
4. **Audit Trail**: Know starting quantities for each period
5. **Variance Reports**: Compare opening vs closing quantities

## Testing

### Test 1: Import with Opening Balance
```csv
كود الصنف,اسم الصنف,الفرع,الكمية,الوحدة,الحد الأدنى,رصيد أول المدة,سعر الشراء,سعر البيع
TEST001,Test Item,المخزن الرئيسي,100,قطعة,10,50,5.00,10.00
```

**Expected:**
- `opening_balance` = 50 ✓
- `quantity` = 100 ✓
- `min_quantity` = 10 ✓

### Test 2: Export and Verify
1. Import the above item
2. Export to Excel
3. Check "رصيد أول المدة" column = 50 ✓

### Test 3: Display in UI
1. Go to Inventory page
2. Find TEST001
3. "رصيد أول المدة" column shows 50 ✓

## Migration Note

**No database migration needed!** The `opening_balance` field already exists in the database. This is just a code fix to use the correct field.

## Summary

✅ **Before:** رصيد أول المدة was incorrectly using `min_quantity`
✅ **After:** رصيد أول المدة correctly uses `opening_balance`

Now when you import:
- **رصيد أول المدة** = 12 → Sets `opening_balance` = 12
- **الكمية** = 25 → Sets `quantity` = 25
- **الحد الأدنى** = 5 → Sets `min_quantity` = 5

Each field has its proper purpose and meaning!
