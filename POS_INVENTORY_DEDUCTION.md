# POS Inventory Deduction System

## Overview
This document explains how the POS system automatically deducts inventory when sales are made and prevents overselling.

## Features Implemented

### 1. Automatic Inventory Deduction
When a cashier completes a sale (order status changes to 'paid'), the system automatically:
- Deducts the sold quantity from the branch inventory
- Updates the `inventory` table in real-time
- Example: Branch has 10 items → Cashier sells 5 → Branch now has 5 items

### 2. Overselling Prevention
The system prevents cashiers from selling more than available stock:
- **Frontend Validation**: Cashier cannot add more items to cart than available in stock
- **Real-time Stock Display**: Shows available quantity on each item card
- **Cart Quantity Limits**: Plus button disabled when cart quantity reaches stock limit
- **User Alerts**: Shows Arabic message when trying to exceed stock: "لا يمكن إضافة المزيد. الكمية المتاحة: X"

### 3. Recipe Items Exception
Recipe items (prepared items) are handled differently:
- **No Stock Limits**: Recipes can be sold without stock validation
- **Calculated Cost**: Recipe cost is calculated from ingredients
- **Always Available**: Recipes show as available if marked as such in POS Management

## Database Changes

### Trigger: `trigger_deduct_inventory_on_payment`
- **When**: Fires when order status changes to 'paid'
- **What**: Deducts quantities from inventory table for the order's branch
- **Location**: `database/add_inventory_deduction_trigger.sql`

```sql
-- Example: Order with 3 items of product A
-- Before: inventory.quantity = 10
-- After payment: inventory.quantity = 7
```

## Frontend Changes

### File: `restaurant-react/src/pages/pos/POSCashier.tsx`

#### New Functions:

1. **`handleAddToCart(item)`**
   - Validates stock before adding to cart
   - Checks if item is a recipe (no validation needed)
   - Compares cart quantity + 1 against available stock
   - Shows alert if stock exceeded

2. **`handleUpdateQuantity(itemId, newQuantity)`**
   - Validates stock when increasing quantity
   - Prevents setting quantity above available stock
   - Shows alert with available quantity

3. **Updated `handlePayment()`**
   - Refreshes menu items after successful payment
   - Updates stock quantities in real-time
   - Ensures UI reflects new inventory levels

## Installation Steps

### 1. Run Database Migration
```sql
-- Open Supabase SQL Editor
-- Copy and run: database/add_inventory_deduction_trigger.sql
```

This creates:
- Function: `deduct_inventory_on_payment()`
- Trigger: `trigger_deduct_inventory_on_payment`

### 2. Frontend Already Updated
The React components are already updated with stock validation.

### 3. Test the System

#### Test Case 1: Normal Sale
1. Check inventory: Item X has 10 units
2. Cashier adds 5 units to cart
3. Complete payment
4. Check inventory: Item X now has 5 units ✓

#### Test Case 2: Overselling Prevention
1. Item Y has 3 units in stock
2. Cashier adds 3 to cart
3. Try to add 1 more → Alert shown: "لا يمكن إضافة المزيد. الكمية المتاحة: 3" ✓
4. Cannot exceed stock limit ✓

#### Test Case 3: Recipe Items
1. Recipe item (e.g., prepared meal)
2. Can add any quantity to cart ✓
3. No stock validation ✓

## How It Works

### Flow Diagram
```
1. Cashier adds items to cart
   ↓
2. Frontend validates against stock (except recipes)
   ↓
3. Cashier clicks payment method
   ↓
4. Order created with status='new'
   ↓
5. Payment processed → status='paid'
   ↓
6. Database trigger fires
   ↓
7. Inventory quantities deducted
   ↓
8. Frontend refreshes stock display
```

### Stock Validation Logic
```javascript
// For regular items
if (currentCartQty >= stockQty) {
  alert("Cannot add more")
  return
}

// For recipes
if (isRecipe) {
  // No validation, add freely
  cart.addItem(item)
}
```

## Database Schema

### Tables Involved

#### `orders`
- `id`: Order UUID
- `branch_id`: Which branch made the sale
- `status`: 'new' → 'paid' (triggers inventory deduction)

#### `order_items`
- `order_id`: Links to orders
- `item_id`: Links to items (for inventory deduction)
- `quantity`: How many sold

#### `inventory`
- `branch_id`: Which branch
- `item_id`: Which item
- `quantity`: Current stock (gets deducted)

## Verification Queries

### Check Current Stock
```sql
SELECT 
  b.name_ar as branch,
  i.name_ar as item,
  inv.quantity as current_stock
FROM inventory inv
JOIN branches b ON b.id = inv.branch_id
JOIN items i ON i.id = inv.item_id
WHERE b.is_main_warehouse = false
ORDER BY b.name_ar, i.name_ar;
```

### Check Recent Orders and Deductions
```sql
SELECT 
  o.order_number,
  o.status,
  o.paid_at,
  b.name_ar as branch,
  i.name_ar as item,
  oi.quantity as sold_qty,
  inv.quantity as remaining_stock
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN branches b ON b.id = o.branch_id
JOIN items i ON i.id = oi.item_id
LEFT JOIN inventory inv ON inv.branch_id = o.branch_id AND inv.item_id = oi.item_id
WHERE o.status = 'paid'
ORDER BY o.paid_at DESC
LIMIT 20;
```

## Troubleshooting

### Issue: Stock not deducting
**Check:**
1. Is trigger installed? Run verification query in migration file
2. Is order status changing to 'paid'?
3. Does order_items have item_id populated?

### Issue: Can still oversell
**Check:**
1. Is frontend code updated?
2. Is `stock_quantity` field in menu items?
3. Check browser console for errors

### Issue: Recipes being blocked
**Check:**
1. Is `is_recipe` field set correctly in items table?
2. Is `is_recipe` being passed to frontend in POSCashier?

## Future Enhancements

1. **Low Stock Warnings**: Alert when stock falls below minimum
2. **Stock Reservation**: Reserve stock when added to cart (before payment)
3. **Negative Stock Prevention**: Database constraint to prevent negative quantities
4. **Audit Trail**: Log all inventory changes with timestamps
5. **Batch Operations**: Optimize trigger for large orders

## Support

For issues or questions:
1. Check database trigger is installed
2. Verify frontend code is updated
3. Test with verification queries
4. Check browser console for errors
