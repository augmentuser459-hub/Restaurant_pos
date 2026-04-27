-- Fix supplier_returns table to make supply_id optional
-- This allows creating returns without linking to a specific supply

-- Make supply_id nullable (optional)
ALTER TABLE supplier_returns 
ALTER COLUMN supply_id DROP NOT NULL;

-- Add comment to explain the change
COMMENT ON COLUMN supplier_returns.supply_id IS 'Optional reference to the original supply. Can be NULL if return is not linked to a specific supply.';
