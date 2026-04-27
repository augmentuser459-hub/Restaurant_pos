# Quick Start Guide: POS Inventory Deduction

## 🚀 Quick Setup (2 Steps)

### Step 1: Run SQL Migration ⚡
1. Open Supabase Dashboard → SQL Editor
2. Copy all content from `database/add_inventory_deduction_trigger.sql`
3. Click "Run" button
4. ✅ Done! Trigger installed

### Step 2: Test It 🧪
1. Go to POS Cashier page
2. Add items to cart
3. Complete a sale
4. Check Inventory page → Stock should be reduced!

---

## 📊 Visual Flow

### Before: Manual Inventory ❌
```
Cashier sells 5 items
    ↓
Inventory stays at 10 (not updated)
    ↓
Manager manually adjusts inventory
    ↓
Time wasted, errors possible
```

### After: Automatic Deduction ✅
```
Cashier sells 5 items
    ↓
Payment completed
    ↓
Database trigger fires automatically
    ↓
Inventory: 10 → 5 (instant update)
    ↓
No manual work needed!
```

---

## 🛡️ Overselling Prevention

### Scenario: Only 3 Items Left

#### What Cashier Sees:
```
┌─────────────────────┐
│   Coca-Cola         │
│   50.00 ج.م         │
│   متاح: 3.00        │  ← Shows available quantity
└─────────────────────┘
```

#### What Happens:
1. Cashier adds 3 to cart ✅
2. Tries to add 1 more ❌
3. Alert appears:
   ```
   ⚠️ لا يمكن إضافة المزيد
   الكمية المتاحة: 3
   ```
4. Cannot proceed ✅

---

## 🍕 Recipe Items (Special Case)

Recipe items = Prepared meals (made on demand)

### Example: Pizza
- **Regular Item**: Limited by stock (flour, cheese, etc.)
- **Recipe Item**: Can sell unlimited (ingredients deducted separately)

```
Regular Item (Coca-Cola):
  Stock: 5 bottles
  Can sell: Maximum 5 ✓

Recipe Item (Pizza):
  Stock: N/A (made fresh)
  Can sell: Unlimited ✓
```

---

## 📝 Real Example

### Initial State:
```
Branch: الفرع الأول
Item: كوكاكولا
Stock: 10 bottles
```

### Cashier Action:
```
1. Add 5 Coca-Cola to cart
2. Click "نقدي" (Cash payment)
3. Order completed ✓
```

### Result:
```
Branch: الفرع الأول
Item: كوكاكولا
Stock: 5 bottles (10 - 5 = 5) ✓
```

### Try to Oversell:
```
1. Add 5 to cart (now 5 in cart)
2. Try to add 1 more
3. Alert: "لا يمكن إضافة المزيد. الكمية المتاحة: 5"
4. Cannot add ✓
```

---

## 🔍 Verification

### Check Trigger Installed:
```sql
SELECT trigger_name 
FROM information_schema.triggers
WHERE trigger_name = 'trigger_deduct_inventory_on_payment';
```
**Expected:** 1 row returned ✓

### Check Stock Before Sale:
```sql
SELECT i.name_ar, inv.quantity
FROM inventory inv
JOIN items i ON i.id = inv.item_id
WHERE i.name_ar = 'كوكاكولا';
```
**Example:** كوكاكولا | 10

### Make a Sale (sell 5)

### Check Stock After Sale:
```sql
SELECT i.name_ar, inv.quantity
FROM inventory inv
JOIN items i ON i.id = inv.item_id
WHERE i.name_ar = 'كوكاكولا';
```
**Expected:** كوكاكولا | 5 ✓

---

## ⚠️ Common Issues

### Issue 1: Stock Not Deducting
**Solution:** Run the SQL migration file first!

### Issue 2: Can Still Oversell
**Solution:** Clear browser cache and refresh page

### Issue 3: Recipe Items Blocked
**Solution:** Check `is_recipe` field in items table

---

## 🎯 Key Features

| Feature | Status | Description |
|---------|--------|-------------|
| Auto Deduction | ✅ | Inventory deducted on payment |
| Overselling Block | ✅ | Cannot sell more than stock |
| Recipe Exception | ✅ | Recipes have no limits |
| Real-time Update | ✅ | Stock refreshes after sale |
| Arabic Alerts | ✅ | User-friendly messages |

---

## 📱 User Interface Changes

### Item Card (Before):
```
┌─────────────────────┐
│   Coca-Cola         │
│   50.00 ج.م         │
└─────────────────────┘
```

### Item Card (After):
```
┌─────────────────────┐
│   Coca-Cola         │
│   50.00 ج.م         │
│   متاح: 10.00       │  ← NEW: Shows stock
└─────────────────────┘
```

### Out of Stock:
```
┌─────────────────────┐
│   Coca-Cola         │  (Grayed out)
│   50.00 ج.م         │
│   غير متاح          │  ← Shows unavailable
└─────────────────────┘
```

---

## 🎓 Training Cashiers

### What They Need to Know:

1. **Stock Display**
   - Green "متاح: X" = Available quantity
   - Red "غير متاح" = Out of stock

2. **Adding Items**
   - Click item to add 1 to cart
   - Use +/- buttons to adjust quantity
   - Cannot exceed available stock

3. **Alerts**
   - If alert appears, stock limit reached
   - Remove items or proceed with current quantity

4. **After Sale**
   - Stock automatically updates
   - No manual adjustments needed

---

## ✅ Success Checklist

- [ ] SQL migration executed in Supabase
- [ ] Trigger verified (query returns 1 row)
- [ ] Test sale completed
- [ ] Inventory deducted correctly
- [ ] Overselling blocked (tested)
- [ ] Recipe items work (no limits)
- [ ] Cashiers trained

---

## 🆘 Need Help?

1. **Check trigger installed:** Run verification query
2. **Check browser console:** F12 → Console tab
3. **Check order status:** Should be 'paid'
4. **Check item_id:** Should be populated in order_items

---

## 🎉 You're Done!

The system now:
- ✅ Automatically deducts inventory
- ✅ Prevents overselling
- ✅ Updates in real-time
- ✅ Handles recipes correctly

**No more manual inventory adjustments needed!**
