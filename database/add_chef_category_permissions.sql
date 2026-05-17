-- ============================================
-- CHEF CATEGORY PERMISSIONS
-- ============================================
-- This table controls which categories a chef can see in Kitchen Display
-- Only items belonging to these categories will show up in orders for the chef
-- Example: A chef assigned to "Sandwiches" and "Pizza" categories won't see
-- "Cans" or "Water" items in orders even if the cashier included them

CREATE TABLE IF NOT EXISTS chef_category_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    UNIQUE(user_id, category_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_chef_category_permissions_user_id 
    ON chef_category_permissions(user_id);

CREATE INDEX IF NOT EXISTS idx_chef_category_permissions_category_id 
    ON chef_category_permissions(category_id);

-- Add comment
COMMENT ON TABLE chef_category_permissions IS 'Controls which categories each chef can see in Kitchen Display. Orders are filtered to show only items from these categories.';
COMMENT ON COLUMN chef_category_permissions.user_id IS 'The chef user';
COMMENT ON COLUMN chef_category_permissions.category_id IS 'The category the chef handles (e.g. Sandwiches, Pizza, etc.)';

-- Function to get categories accessible by a chef
CREATE OR REPLACE FUNCTION get_chef_categories(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    code VARCHAR,
    name VARCHAR,
    name_ar VARCHAR,
    sort_order INTEGER
) AS $$
BEGIN
    -- If no permissions are set, return all active categories (backwards compatible)
    IF NOT EXISTS (
        SELECT 1 FROM chef_category_permissions WHERE user_id = p_user_id
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
        INNER JOIN chef_category_permissions ccp ON c.id = ccp.category_id
        WHERE ccp.user_id = p_user_id
        AND c.is_active = TRUE
        ORDER BY c.sort_order;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Disable RLS for simplicity (authorization handled at app level)
ALTER TABLE chef_category_permissions DISABLE ROW LEVEL SECURITY;
