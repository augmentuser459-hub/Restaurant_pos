-- ============================================
-- Reset Data Script - Keep Suppliers
-- ============================================
-- This script deletes:
-- - All items and inventory
-- - All purchase orders and related data
-- - All supplier transactions and debt history
-- But KEEPS the suppliers themselves
-- ============================================

BEGIN;

-- 1. Delete Order Items (references items)
DELETE FROM order_items;

-- 2. Delete Orders
DELETE FROM orders;

-- 3. Delete Cashier Shifts
DELETE FROM cashier_shifts;

-- 4. Delete Branch POS Items (references items)
DELETE FROM branch_pos_items;

-- 5. Delete Menu Item Ingredients (references items)
DELETE FROM menu_item_ingredients;

-- 6. Delete Menu Items
DELETE FROM menu_items;

-- 7. Delete Menu Categories
DELETE FROM menu_categories;

-- 8. Delete Purchase Order Items (references items)
DELETE FROM purchase_order_items;

-- 9. Delete Purchase Order Payments
DELETE FROM purchase_order_payments;

-- 10. Delete Purchase Orders
DELETE FROM purchase_orders;

-- 11. Delete Purchase Request Items (references items)
DELETE FROM purchase_request_items;

-- 12. Delete Purchase Requests
DELETE FROM purchase_requests;

-- 13. Delete Supplier Returns (references items)
DELETE FROM supplier_returns;

-- 14. Delete Supplier Items (references items)
DELETE FROM supplier_items;

-- 15. Delete Branch Return Items (references items)
DELETE FROM branch_return_items;

-- 16. Delete Branch Returns
DELETE FROM branch_returns;

-- 17. Delete Supplier Debt Transactions
DELETE FROM supplier_debt_transactions;

-- 18. Delete Supply Items (references items)
DELETE FROM supply_items;

-- 19. Delete Supplies
DELETE FROM supplies;

-- 20. Reset Supplier Balances to Zero
UPDATE suppliers SET current_balance = 0, updated_at = CURRENT_TIMESTAMP;

-- 21. Delete Damages (references items directly)
DELETE FROM damages;

-- 22. Delete Transfer Items (references items)
DELETE FROM transfer_items;

-- 23. Delete Transfers
DELETE FROM transfers;

-- 24. Delete Daily Inventory Count Items (references items)
DELETE FROM daily_inventory_count_items;

-- 25. Delete Daily Inventory Counts
DELETE FROM daily_inventory_counts;

-- 26. Delete Recipe Ingredients (references items)
DELETE FROM recipe_ingredients;

-- 27. Delete Production Logs (references items)
DELETE FROM production_logs;

-- 28. Delete Inventory Transactions (references items)
DELETE FROM inventory_transactions;

-- 29. Delete Inventory (references items)
DELETE FROM inventory;

-- 30. Finally, Delete Items (all references should be gone now)
DELETE FROM items;

COMMIT;

-- ============================================
-- Summary
-- ============================================
SELECT 
    'Data Reset Complete!' as status,
    (SELECT COUNT(*) FROM items) as remaining_items,
    (SELECT COUNT(*) FROM inventory) as remaining_inventory,
    (SELECT COUNT(*) FROM purchase_orders) as remaining_purchase_orders,
    (SELECT COUNT(*) FROM orders) as remaining_orders,
    (SELECT COUNT(*) FROM suppliers) as remaining_suppliers,
    (SELECT SUM(current_balance) FROM suppliers) as total_supplier_balance;
