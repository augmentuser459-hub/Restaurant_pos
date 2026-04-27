-- ============================================
-- Fix POS In-Stock Issue
-- This adds the missing 'in_stock' field to the view
-- Run this in Supabase SQL Editor
-- ============================================

-- Drop and recreate the view with the in_stock field
DROP VIEW IF EXISTS v_branch_pos_items_with_stock;

CREATE OR REPLACE VIEW v_branch_pos_items_with_stock AS
SELECT 
  bpi.id,
  bpi.branch_id,
  bpi.item_id,
  bpi.price,
  bpi.is_available,
  bpi.display_order,
  bpi.created_at,
  bpi.updated_at,
  -- Item details as JSONB
  jsonb_build_object(
    'id', i.id,
    'code', i.code,
    'barcode', i.barcode,
    'name', i.name,
    'name_ar', i.name_ar,
    'description', i.description,
    'unit_id', i.unit_id,
    'category_id', i.category_id,
    'purchase_price', i.purchase_price,
    'selling_price', i.selling_price,
    'min_stock_level', i.min_stock_level,
    'is_recipe', i.is_recipe,
    'status', i.status,
    'image_url', i.image_url
  ) as item,
  -- Stock information
  COALESCE(inv.quantity, 0) as stock_quantity,
  COALESCE(inv.min_quantity, 0) as min_stock,
  -- In stock check (quantity > 0 OR is a recipe)
  CASE 
    WHEN i.is_recipe = true THEN true
    WHEN COALESCE(inv.quantity, 0) > 0 THEN true
    ELSE false
  END as in_stock,
  -- Branch details
  b.name as branch_name,
  b.name_ar as branch_name_ar,
  b.code as branch_code
FROM branch_pos_items bpi
JOIN items i ON i.id = bpi.item_id
JOIN branches b ON b.id = bpi.branch_id
LEFT JOIN inventory inv ON inv.item_id = bpi.item_id AND inv.branch_id = bpi.branch_id
WHERE i.status = 'active';

-- Grant access to the view
GRANT SELECT ON v_branch_pos_items_with_stock TO authenticated;
GRANT SELECT ON v_branch_pos_items_with_stock TO anon;

-- Test the view
SELECT 
  branch_name_ar,
  item->>'name_ar' as item_name,
  stock_quantity,
  in_stock,
  is_available
FROM v_branch_pos_items_with_stock
LIMIT 10;

-- ============================================
-- Verification Query
-- Run this to check if items are now showing as in stock
-- ============================================
SELECT 
  b.name_ar as branch,
  i.name_ar as item,
  inv.quantity as stock_qty,
  bpi.is_available,
  CASE 
    WHEN i.is_recipe = true THEN true
    WHEN COALESCE(inv.quantity, 0) > 0 THEN true
    ELSE false
  END as should_be_in_stock
FROM branch_pos_items bpi
JOIN items i ON i.id = bpi.item_id
JOIN branches b ON b.id = bpi.branch_id
LEFT JOIN inventory inv ON inv.item_id = bpi.item_id AND inv.branch_id = bpi.branch_id
WHERE i.status = 'active'
ORDER BY b.name_ar, i.name_ar;
