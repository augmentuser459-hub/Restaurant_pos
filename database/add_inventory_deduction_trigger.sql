-- ============================================
-- Inventory Deduction on POS Sales
-- This trigger automatically deducts inventory when orders are paid
-- Run this in Supabase SQL Editor
-- ============================================

-- Function to deduct inventory when order status changes to 'paid'
CREATE OR REPLACE FUNCTION deduct_inventory_on_payment()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process when status changes to 'paid'
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
    -- Deduct inventory for all items in this order
    UPDATE inventory inv
    SET 
      quantity = inv.quantity - oi.quantity,
      updated_at = NOW()
    FROM order_items oi
    WHERE 
      inv.branch_id = NEW.branch_id 
      AND inv.item_id = oi.item_id
      AND oi.order_id = NEW.id
      AND oi.item_id IS NOT NULL; -- Only deduct for items (not menu_items)
    
    -- Log if any items don't have inventory records
    PERFORM 1
    FROM order_items oi
    LEFT JOIN inventory inv ON inv.branch_id = NEW.branch_id AND inv.item_id = oi.item_id
    WHERE oi.order_id = NEW.id 
      AND oi.item_id IS NOT NULL
      AND inv.id IS NULL;
    
    IF FOUND THEN
      RAISE WARNING 'Some items in order % do not have inventory records', NEW.order_number;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on orders update
DROP TRIGGER IF EXISTS trigger_deduct_inventory_on_payment ON orders;
CREATE TRIGGER trigger_deduct_inventory_on_payment
  AFTER UPDATE ON orders
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND OLD.status != 'paid')
  EXECUTE FUNCTION deduct_inventory_on_payment();

-- ============================================
-- Test the trigger
-- ============================================
-- This query shows current inventory levels
SELECT 
  b.name_ar as branch,
  i.name_ar as item,
  inv.quantity as current_stock
FROM inventory inv
JOIN branches b ON b.id = inv.branch_id
JOIN items i ON i.id = inv.item_id
WHERE inv.quantity > 0
ORDER BY b.name_ar, i.name_ar
LIMIT 10;

-- After creating an order and marking it as paid, 
-- run the above query again to see the inventory deducted

-- ============================================
-- Verification: Check if trigger exists
-- ============================================
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'trigger_deduct_inventory_on_payment';

