-- ============================================
-- CASHIER CATEGORY PERMISSIONS
-- ============================================
-- This table controls which categories a cashier can see in POS

CREATE TABLE IF NOT EXISTS cashier_category_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    UNIQUE(user_id, category_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_cashier_category_permissions_user_id 
    ON cashier_category_permissions(user_id);

CREATE INDEX IF NOT EXISTS idx_cashier_category_permissions_category_id 
    ON cashier_category_permissions(category_id);

-- Add comment
COMMENT ON TABLE cashier_category_permissions IS 'Controls which categories each cashier can see in POS Cashier';
COMMENT ON COLUMN cashier_category_permissions.user_id IS 'The cashier user';
COMMENT ON COLUMN cashier_category_permissions.category_id IS 'The category the cashier can access';

-- Function to check if a cashier has access to a category
CREATE OR REPLACE FUNCTION cashier_has_category_access(
    p_user_id UUID,
    p_category_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
    -- If no permissions are set for this user, they can see all categories
    IF NOT EXISTS (
        SELECT 1 FROM cashier_category_permissions WHERE user_id = p_user_id
    ) THEN
        RETURN TRUE;
    END IF;
    
    -- Otherwise, check if they have permission for this specific category
    RETURN EXISTS (
        SELECT 1 
        FROM cashier_category_permissions 
        WHERE user_id = p_user_id 
        AND category_id = p_category_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get categories accessible by a cashier
CREATE OR REPLACE FUNCTION get_cashier_categories(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    code VARCHAR,
    name VARCHAR,
    name_ar VARCHAR,
    sort_order INTEGER
) AS $$
BEGIN
    -- If no permissions are set, return all active categories
    IF NOT EXISTS (
        SELECT 1 FROM cashier_category_permissions WHERE user_id = p_user_id
    ) THEN
        RETURN QUERY
        SELECT c.id, c.code, c.name, c.name_ar, c.sort_order
        FROM categories c
        WHERE c.is_active = TRUE
        ORDER BY c.sort_order;
    ELSE
        -- Return only permitted categories
        RETURN QUERY
        SELECT c.id, c.code, c.name, c.name_ar, c.sort_order
        FROM categories c
        INNER JOIN cashier_category_permissions ccp ON c.id = ccp.category_id
        WHERE ccp.user_id = p_user_id
        AND c.is_active = TRUE
        ORDER BY c.sort_order;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on the table
ALTER TABLE cashier_category_permissions ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all authenticated users to read
CREATE POLICY "Authenticated users can view category permissions"
    ON cashier_category_permissions
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy: Allow all authenticated users to insert/update/delete
-- (Your app handles authorization at the application level)
CREATE POLICY "Authenticated users can manage category permissions"
    ON cashier_category_permissions
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON cashier_category_permissions TO authenticated;
