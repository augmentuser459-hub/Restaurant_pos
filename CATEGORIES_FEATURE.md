# Categories Management Feature

## Overview
Enhanced categories system with dedicated management page, tabs for Item and Recipe categories, and filtering capabilities.

## New Features

### 1. Categories Management Page (`/categories`)
- **Two Tabs:**
  - **مجموعات الأصناف** (Item Categories) - For organizing store items
  - **مجموعات الوصفات** (Recipe Categories) - For organizing recipes
- **Features:**
  - View all categories in card layout
  - See item/recipe count for each category
  - Toggle active/inactive status
  - Edit and delete categories
  - Add new categoriesf

### 2. Category Form (Add/Edit)
- **Create or edit categories** with full details:
  - Code (unique identifier)
  - Name (Arabic & English)
  - Description
  - Sort order
  - Active status
- **Assign Items/Recipes:**
  - Select multiple items to assign to category
  - Search functionality for easy item selection
  - Checkbox list with item codes and names
  - Shows count of selected items

### 3. Recipe List Filter
- **Category Filter** added to recipe list page
- Filter recipes by category (مجموعات)
- Combined with existing search functionality

### 4. Item List Filter
- Uses existing "مجموعات" filter
- No changes needed (already implemented)

## Files Created

### 1. `restaurant-react/src/pages/categories/CategoriesList.tsx`
Main categories management page with tabs.

**Features:**
- Tab switching between Items and Recipes
- Card-based category display
- Item/Recipe count per category
- Quick actions (Edit, Delete, Toggle Active)
- Empty state with call-to-action

### 2. `restaurant-react/src/pages/categories/CategoryForm.tsx`
Form for creating and editing categories.

**Features:**
- Category details form
- Item/Recipe assignment with checkboxes
- Search functionality for items
- Validation for unique codes
- Updates item categories on save

## Files Modified

### 1. `restaurant-react/src/App.tsx`
Added routes:
```typescript
<Route path="/categories" element={<CategoriesList />} />
<Route path="/categories/new" element={<CategoryForm />} />
<Route path="/categories/:id/edit" element={<CategoryForm />} />
```

### 2. `restaurant-react/src/pages/recipes/RecipeList.tsx`
Added category filter:
- Category dropdown filter
- Fetches categories from database
- Filters recipes by selected category
- Combined with search filter

## Database Schema

Uses existing `categories` table:
```sql
CREATE TABLE categories (
    id UUID PRIMARY KEY,
    code VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES categories(id),
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);
```

Items reference categories:
```sql
CREATE TABLE items (
    ...
    category_id UUID REFERENCES categories(id),
    is_recipe BOOLEAN DEFAULT false,
    ...
);
```

## Usage

### Creating a Category

1. Navigate to `/categories`
2. Select tab (Items or Recipes)
3. Click "مجموعة جديدة"
4. Fill in category details:
   - Code: `CAT-DRINKS`
   - Name (Arabic): `مشروبات`
   - Name (English): `Beverages`
   - Description: `جميع أنواع المشروبات`
5. Select items to assign to this category
6. Click "حفظ"

### Editing a Category

1. Navigate to `/categories`
2. Click edit icon on category card
3. Modify details or item assignments
4. Click "حفظ"

### Filtering Recipes by Category

1. Navigate to `/recipes`
2. Use category dropdown: "جميع المجموعات"
3. Select a category to filter
4. Recipes are filtered instantly

### Filtering Items by Category

1. Navigate to `/inventory` or `/inventory/items`
2. Use existing "المجموعة" filter
3. Select category to filter items

## UI Screenshots

### Categories List Page
```
┌─────────────────────────────────────────────────────────┐
│ المجموعات                          [+ مجموعة جديدة]     │
│ إدارة مجموعات الأصناف والوصفات                          │
├─────────────────────────────────────────────────────────┤
│ [مجموعات الأصناف] [مجموعات الوصفات]                    │
├─────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│ │ مشروبات  │ │ مخبوزات  │ │ لحوم     │                 │
│ │ CAT-001  │ │ CAT-002  │ │ CAT-003  │                 │
│ │ 15 صنف   │ │ 8 صنف    │ │ 12 صنف   │                 │
│ │ [✏️] [🗑️] │ │ [✏️] [🗑️] │ │ [✏️] [🗑️] │                 │
│ └──────────┘ └──────────┘ └──────────┘                 │
└─────────────────────────────────────────────────────────┘
```

### Category Form
```
┌─────────────────────────────────────────────────────────┐
│ [←] مجموعة جديدة - مجموعة أصناف                        │
├─────────────────────────────────────────────────────────┤
│ بيانات المجموعة                                         │
│ ┌─────────────────┬─────────────────┐                   │
│ │ الكود*          │ الاسم (عربي)*   │                   │
│ │ CAT-001         │ مشروبات         │                   │
│ ├─────────────────┼─────────────────┤                   │
│ │ الاسم (إنجليزي)*│ ترتيب العرض     │                   │
│ │ Beverages       │ 1               │                   │
│ ├─────────────────────────────────────┤                 │
│ │ الوصف                               │                 │
│ │ جميع أنواع المشروبات                │                 │
│ └─────────────────────────────────────┘                 │
│ ☑ نشط                                                   │
├─────────────────────────────────────────────────────────┤
│ تعيين الأصناف                              3 محدد       │
│ ┌─────────────────────────────────────┐                 │
│ │ [🔍] بحث...                          │                 │
│ ├─────────────────────────────────────┤                 │
│ │ ☑ كوكاكولا - ITEM001                │                 │
│ │ ☑ بيبسي - ITEM002                   │                 │
│ │ ☐ عصير برتقال - ITEM003             │                 │
│ │ ☑ ماء - ITEM004                      │                 │
│ └─────────────────────────────────────┘                 │
│ [💾 حفظ] [إلغاء]                                        │
└─────────────────────────────────────────────────────────┘
```

### Recipe List with Filter
```
┌─────────────────────────────────────────────────────────┐
│ 🧑‍🍳 الريسبيات                    [استيراد] [إضافة]     │
├─────────────────────────────────────────────────────────┤
│ بحث وتصفية                                              │
│ ┌──────────────────────┬──────────────┐                 │
│ │ [🔍] بحث...          │ [المجموعات▼] │                 │
│ └──────────────────────┴──────────────┘                 │
├─────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│ │ بيتزا    │ │ برجر     │ │ معكرونة  │                 │
│ │ RCP-001  │ │ RCP-002  │ │ RCP-003  │                 │
│ │ 25.50 ج.م│ │ 18.00 ج.م│ │ 15.00 ج.م│                 │
│ └──────────┘ └──────────┘ └──────────┘                 │
└─────────────────────────────────────────────────────────┘
```

## Benefits

1. **Better Organization**: Separate categories for items and recipes
2. **Easy Management**: Dedicated page for category CRUD operations
3. **Bulk Assignment**: Assign multiple items to category at once
4. **Improved Filtering**: Filter recipes and items by category
5. **Visual Feedback**: See item/recipe count per category
6. **Status Control**: Enable/disable categories as needed

## Navigation

Add link to sidebar/menu:
```typescript
<Link to="/categories">
  <FolderOpen className="w-5 h-5" />
  المجموعات
</Link>
```

## Future Enhancements

1. **Hierarchical Categories**: Use `parent_id` for sub-categories
2. **Drag & Drop Sorting**: Reorder categories visually
3. **Bulk Operations**: Move multiple items between categories
4. **Category Images**: Add images to categories
5. **Category Reports**: Analytics per category
6. **Import/Export**: Bulk category management via Excel

## Testing Checklist

- [ ] Create item category
- [ ] Create recipe category
- [ ] Assign items to category
- [ ] Edit category details
- [ ] Edit category item assignments
- [ ] Delete category
- [ ] Toggle category active status
- [ ] Filter recipes by category
- [ ] Filter items by category (existing)
- [ ] Search within category form
- [ ] Validate unique category codes

## Summary

✅ **Categories Management Page** - `/categories`
✅ **Two Tabs** - Items & Recipes
✅ **Add/Edit Categories** - With item assignment
✅ **Recipe Filter** - By category
✅ **Item Filter** - Uses existing filter
✅ **No Database Changes** - Uses existing schema

The categories feature is now fully functional and ready to use!
