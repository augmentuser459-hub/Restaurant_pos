-- Add Recipe Category
-- Run this in Supabase SQL Editor

INSERT INTO categories (code, name, name_ar, description, is_active, sort_order)
VALUES (
  'CAT-RECIPE',
  'Recipes',
  'الريسبيهات',
  'Category for recipe items',
  true,
  999
)
ON CONFLICT (code) DO NOTHING;

-- Verify it was created
SELECT id, code, name, name_ar FROM categories WHERE code = 'CAT-RECIPE';
