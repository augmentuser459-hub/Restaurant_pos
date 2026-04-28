-- Fix RLS policies for cashier_category_permissions table
-- Disable RLS completely since app handles authorization

-- Drop existing policies
DROP POLICY IF EXISTS "Admins and managers can view all category permissions" ON cashier_category_permissions;
DROP POLICY IF EXISTS "Cashiers can view their own category permissions" ON cashier_category_permissions;
DROP POLICY IF EXISTS "Only admins can manage category permissions" ON cashier_category_permissions;
DROP POLICY IF EXISTS "Authenticated users can view category permissions" ON cashier_category_permissions;
DROP POLICY IF EXISTS "Authenticated users can manage category permissions" ON cashier_category_permissions;

-- Disable RLS on the table
ALTER TABLE cashier_category_permissions DISABLE ROW LEVEL SECURITY;
