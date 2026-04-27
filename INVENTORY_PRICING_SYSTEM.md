# Inventory & Pricing System - Complete Guide

## Overview
This document explains how the inventory pricing system works and how changes propagate across different pages.

## System Flow

### 1. Purchase Order Creation → Item Price Update
**Location:** `/purchase/orders/new`

When you create a purchase order:
1. You select items and set their **unit price** (سعر الوحدة)
2. Upon saving the purchase order, the system automatically updates the `purchase_price` field in the `items` table
3. This ensures the item's cost reflects the latest purchase price

**Code Reference:** `restaurant-react/src/pages/purchase/PurchaseOrderForm.tsx` (lines 195-207)

```typescript
// Update purchase prices in items table
for (const item of validItems) {
  await supabase
    .from('items')
    .update({ 
      purchase_price: item.unit_price,
      updated_at: new Date().toISOString()
    })
    .eq('id', item.item_id)
}
```

---

### 2. Inventory Page - View & Edit Items
**Location:** `/inventory`

The inventory page now supports **inline editing** of item details:

#### Editable Fields:
- ✅ **Item Name (Arabic)** - اسم الصنف
- ✅ **Item Code** - كود الصنف
- ✅ **Purchase Price** - سعر الشراء
- ✅ **Selling Price** - سعر البيع

#### How to Edit:
1. Navigate to the Inventory page (`/inventory`)
2. Find the item you want to edit
3. Click the **Edit** button (✏️) in the "إجراءات" column
4. The row becomes editable with input fields
5. Make your changes
6. Click **Save** (💾) to save or **Cancel** (❌) to discard

#### What Happens When You Save:
- The `items` table is updated with new values
- Changes are immediately reflected on the Inventory page
- Changes automatically propagate to the POS Management page

**Code Reference:** `restaurant-react/src/pages/inventory/StockList.tsx`

---

### 3. POS Management Page - Automatic Updates
**Location:** `/pos/management`

The POS Management page displays:
- **Cost Price (سعر التكلفة)**: Pulled from `items.purchase_price`
- **Selling Price (سعر البيع)**: Stored in `branch_pos_items.price`
- **Profit Calculation**: Automatically calculated as `selling_price - cost_price`

#### How Updates Work:
1. When you update `purchase_price` on the Inventory page, it updates the `items` table
2. The POS Management page reads from the `items` table for cost prices
3. Changes are reflected immediately when you refresh or navigate to the page

#### Special Cases:
- **Regular Items**: Cost = `items.purchase_price`
- **Recipe Items**: Cost = Calculated from ingredients (cannot be edited manually)

**Code Reference:** `restaurant-react/src/pages/pos/POSManagement.tsx` (lines 186-190)

```typescript
const isRecipe = item.item?.is_recipe || false
const editedCost = editedCosts[item.item_id]
const baseCost = isRecipe 
  ? (item.item?.calculated_cost ?? 0)
  : (item.item?.purchase_price ?? 0)
const currentCost = editedCost ?? baseCost
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Purchase Order Form                       │
│                  /purchase/orders/new                        │
│                                                              │
│  User sets unit_price for items                             │
│  ↓                                                           │
│  On Save: Updates items.purchase_price                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                      Items Table                             │
│                   (Database: items)                          │
│                                                              │
│  Fields:                                                     │
│  - code                                                      │
│  - name_ar                                                   │
│  - purchase_price  ← Updated from Purchase Order            │
│  - selling_price                                             │
│  - unit_id                                                   │
│  - category_id                                               │
└──────────────────┬───────────────────────┬──────────────────┘
                   │                       │
                   ↓                       ↓
┌──────────────────────────────┐  ┌──────────────────────────┐
│    Inventory Page            │  │   POS Management Page    │
│    /inventory                │  │   /pos/management        │
│                              │  │                          │
│  Displays & Edits:           │  │  Displays:               │
│  - name_ar                   │  │  - Cost (purchase_price) │
│  - code                      │  │  - Selling Price         │
│  - purchase_price            │  │  - Profit Calculation    │
│  - selling_price             │  │                          │
│                              │  │  User can edit:          │
│  On Save: Updates items      │  │  - Selling Price         │
│  table directly              │  │  - Cost (regular items)  │
└──────────────────────────────┘  └──────────────────────────┘
```

---

## Key Features

### ✅ Automatic Price Synchronization
- Purchase orders automatically update item costs
- Inventory page edits propagate to POS Management
- No manual synchronization needed

### ✅ Inline Editing on Inventory Page
- Edit items directly in the table
- No need to navigate to separate edit forms
- Save or cancel changes with one click

### ✅ Real-time Profit Calculation
- POS Management page shows profit margins
- Automatically recalculates when prices change
- Displays both amount and percentage

### ✅ Recipe Cost Protection
- Recipe items have calculated costs (from ingredients)
- Cannot manually edit recipe costs
- Ensures accurate costing for prepared items

---

## Usage Examples

### Example 1: Update Item Cost from Purchase Order
1. Go to `/purchase/orders/new`
2. Create a purchase order with item "دجاج مشوي"
3. Set unit price to 50 ج.م
4. Save the purchase order
5. ✅ The item's purchase_price is now 50 ج.م
6. ✅ This is reflected on `/inventory` and `/pos/management`

### Example 2: Edit Item on Inventory Page
1. Go to `/inventory`
2. Find item "دجاج مشوي"
3. Click Edit button
4. Change purchase price to 55 ج.م
5. Change selling price to 80 ج.م
6. Click Save
7. ✅ Changes saved to database
8. ✅ POS Management page now shows new cost and profit

### Example 3: View Updated Prices on POS Management
1. Go to `/pos/management`
2. Select a branch
3. View the item "دجاج مشوي"
4. ✅ Cost Price: 55 ج.م (from items.purchase_price)
5. ✅ Selling Price: 80 ج.م (from branch_pos_items.price)
6. ✅ Profit: 25 ج.م (45.5%)

---

## Database Schema

### Items Table
```sql
CREATE TABLE items (
    id UUID PRIMARY KEY,
    code VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    unit_id UUID REFERENCES units(id),
    category_id UUID REFERENCES categories(id),
    purchase_price NUMERIC DEFAULT 0,  -- Updated from purchase orders & inventory edits
    selling_price NUMERIC DEFAULT 0,   -- Editable on inventory page
    is_recipe BOOLEAN DEFAULT false,
    status item_status DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

### Branch POS Items Table
```sql
CREATE TABLE branch_pos_items (
    id UUID PRIMARY KEY,
    branch_id UUID REFERENCES branches(id),
    item_id UUID REFERENCES items(id),
    price NUMERIC NOT NULL,           -- Selling price for this branch
    is_available BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(branch_id, item_id)
);
```

---

## Technical Implementation

### Files Modified
1. ✅ `restaurant-react/src/pages/inventory/StockList.tsx`
   - Added inline editing functionality
   - Added edit/save/cancel buttons
   - Added state management for editing

2. ✅ `restaurant-react/src/pages/purchase/PurchaseOrderForm.tsx`
   - Already updates purchase_price on save
   - No changes needed

3. ✅ `restaurant-react/src/pages/pos/POSManagement.tsx`
   - Already reads from items.purchase_price
   - No changes needed

### New Functions Added
```typescript
// In StockList.tsx
const handleEditItem = (inv: InventoryWithDetails) => { ... }
const handleCancelEdit = () => { ... }
const handleSaveEdit = async () => { ... }
```

---

## Best Practices

### ✅ DO:
- Update purchase prices through purchase orders for accurate tracking
- Use inventory page for quick price adjustments
- Review profit margins on POS Management page regularly
- Keep item codes unique and consistent

### ❌ DON'T:
- Manually edit recipe item costs (they're calculated)
- Change prices without checking current stock value
- Use duplicate item codes
- Edit prices during active sales periods

---

## Troubleshooting

### Issue: Changes not reflecting on POS Management
**Solution:** Refresh the page or re-select the branch

### Issue: Cannot edit recipe item cost
**Solution:** This is by design - recipe costs are calculated from ingredients

### Issue: Purchase price not updating from purchase order
**Solution:** Check that the purchase order was saved successfully

### Issue: Edit button not working
**Solution:** Make sure you're on the main warehouse view (المخزن الرئيسي)

---

## Future Enhancements

### Potential Improvements:
- [ ] Bulk edit multiple items at once
- [ ] Price history tracking
- [ ] Automatic price suggestions based on market data
- [ ] Price change notifications
- [ ] Export/import price lists
- [ ] Multi-currency support

---

## Support

For questions or issues, please refer to:
- Database schema: `database/schema.sql`
- Setup guide: `database/SETUP_GUIDE.md`
- Production schema: `database/PRODUCTION_SCHEMA_READY.md`

---

**Last Updated:** 2026-04-27
**Version:** 1.0
**Status:** ✅ Production Ready
