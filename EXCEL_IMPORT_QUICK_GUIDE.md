# Quick Guide: Excel Import with Opening Balance

## ✅ What Changed

Added **"رصيد أول المدة"** (Opening Balance) field to Excel import/export.

## 📊 Excel File Format

### Before (Old Format):
```
كود الصنف | اسم الصنف | الفرع | الكمية | الوحدة | الحد الأدنى | سعر الشراء | سعر البيع
```

### After (New Format):
```
كود الصنف | اسم الصنف | الفرع | الكمية | الوحدة | الحد الأدنى | رصيد أول المدة | سعر الشراء | سعر البيع
                                                              ↑ NEW FIELD
```

## 📝 Example Excel File

```csv
كود الصنف,اسم الصنف,الفرع,الكمية,الوحدة,الحد الأدنى,رصيد أول المدة,سعر الشراء,سعر البيع
ITEM001,كوكاكولا,المخزن الرئيسي,100,قطعة,10,50,5.00,10.00
ITEM002,بيبسي,المخزن الرئيسي,80,قطعة,10,40,5.00,10.00
ITEM003,دقيق,المخزن الرئيسي,500,كيلوجرام,50,200,10.00,15.00
```

### Explanation:
- **كود الصنف**: ITEM001
- **اسم الصنف**: كوكاكولا
- **الكمية**: 100 (current stock)
- **رصيد أول المدة**: 50 (opening balance - what you started with)
- **الحد الأدنى**: 10 (minimum stock alert level)

## 🎯 How to Use

### Exporting:
1. Go to Inventory page (المخزون)
2. Click "تصدير" (Export) button
3. Excel file downloads with **رصيد أول المدة** column included
4. Open in Excel/Google Sheets

### Importing:
1. Prepare Excel file with the new format
2. Include **رصيد أول المدة** column (optional but recommended)
3. Go to Inventory page
4. Click "استيراد" (Import) button
5. Select your Excel file
6. System imports all data including opening balance

## 💡 Use Cases

### Case 1: New Item with Opening Balance
```csv
كود الصنف,اسم الصنف,الفرع,الكمية,الوحدة,الحد الأدنى,رصيد أول المدة,سعر الشراء,سعر البيع
NEW001,منتج جديد,المخزن الرئيسي,200,قطعة,20,100,15.00,25.00
```
**Result:**
- Item created
- Current stock: 200
- Opening balance: 100
- Minimum: 20

### Case 2: Update Existing Item
```csv
كود الصنف,اسم الصنف,الفرع,الكمية,الوحدة,الحد الأدنى,رصيد أول المدة,سعر الشراء,سعر البيع
ITEM001,كوكاكولا,المخزن الرئيسي,150,قطعة,10,50,5.50,11.00
```
**Result:**
- Item updated
- Current stock: 150 (updated)
- Opening balance: 50 (updated)
- Prices updated

### Case 3: Without Opening Balance (Backward Compatible)
```csv
كود الصنف,اسم الصنف,الفرع,الكمية,الوحدة,الحد الأدنى,سعر الشراء,سعر البيع
OLD001,منتج قديم,المخزن الرئيسي,100,قطعة,10,5.00,10.00
```
**Result:**
- Still works! ✓
- Opening balance defaults to 0
- Everything else imports normally

## 🔍 Field Variations

The system accepts multiple names for the same field:

| Field | Arabic Names | English Names |
|-------|-------------|---------------|
| Opening Balance | رصيد أول المدة, الحد الأدنى | opening_balance |
| Item Code | كود الصنف, كود | item_code |
| Item Name | اسم الصنف, الاسم | item_name |
| Quantity | الكمية, الرصيد إجمالي | quantity |
| Unit | الوحدة, وصف المحتوى | unit |

## ⚠️ Important Notes

1. **Opening Balance is Optional**
   - If not provided, defaults to 0
   - Old Excel files still work

2. **Stored as min_quantity**
   - Database field: `inventory.min_quantity`
   - Can be used for low stock alerts

3. **Always Exported**
   - New exports always include this field
   - Shows current min_quantity value

4. **Updates Existing Records**
   - If item exists, opening balance is updated
   - If item doesn't exist, new record created

## ✅ Testing Checklist

- [ ] Export inventory to Excel
- [ ] Verify "رصيد أول المدة" column exists
- [ ] Modify opening balance values
- [ ] Import the modified file
- [ ] Check inventory page - values updated
- [ ] Test without opening balance column (should still work)

## 📱 User Interface

### Inventory Page Display:
```
┌─────────────────────────────────────────────────────────────┐
│ م │ كود │ اسم الصنف │ رصيد أول المدة │ الرصيد إجمالي │ ...  │
├───┼─────┼───────────┼───────────────┼──────────────┼─────┤
│ 1 │ 001 │ كوكاكولا  │      50       │     100      │ ... │
│ 2 │ 002 │ بيبسي     │      40       │      80      │ ... │
└─────────────────────────────────────────────────────────────┘
```

The "رصيد أول المدة" column shows in the main warehouse view (blue header).

## 🎓 Example Workflow

### Monthly Inventory Process:

**Day 1 (Start of Month):**
1. Export current inventory
2. Note: Current quantity becomes opening balance for next month

**Day 30 (End of Month):**
1. Export inventory again
2. Compare:
   - Opening balance (start of month)
   - Current quantity (end of month)
   - Difference = transactions during month

**Day 31 (New Month):**
1. Update opening balance to last month's closing quantity
2. Import updated file
3. New period begins with correct opening balance

## 🆘 Troubleshooting

### Issue: Opening balance not importing
**Solution:** Check column header spelling: "رصيد أول المدة"

### Issue: Old files not working
**Solution:** They should work! Opening balance defaults to 0

### Issue: Values not updating
**Solution:** Make sure item code matches exactly (case-sensitive)

## 📞 Support

For questions or issues:
1. Check column headers match exactly
2. Verify CSV file encoding is UTF-8
3. Ensure item codes are unique
4. Check for special characters in data

---

**Summary:** You can now track opening balances for inventory items through Excel import/export. The field is optional and backward compatible with existing files.
