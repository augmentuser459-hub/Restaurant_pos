-- Fix RLS policies for cashier_category_permissions table
-- This allows authenticated users to manage permissions
-- (Your app handles authorization at the application level)

-- Drop existing policies
DROP POLICY IF EXISTS "Admins and managers can view all category permissions" ON cashier_category_permissions;
DROP POLICY IF EXISTS "Cashiers can view their own category permissions" ON cashier_category_permissions;
DROP POLICY IF EXISTS "Only admins can manage category permissions" ON cashier_category_permissions;
DROP POLICY IF EXISTS "Authenticated users can view category permissions" ON cashier_category_permissions;
DROP POLICY IF EXISTS "Authenticated users can manage category permissions" ON cashier_category_permissions;

-- Create simple policies that allow all authenticated users
CREATE POLICY "Authenticated users can view category permissions"
    ON cashier_category_permissions
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can manage category permissions"
    ON cashier_category_permissions
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
