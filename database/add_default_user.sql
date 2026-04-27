-- Add default admin user for testing
-- Password: 1234 (hashed using pgcrypto)

-- First, ensure we have a default branch
INSERT INTO branches (id, code, name, name_ar, status, is_main_warehouse)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'MAIN',
    'Main Warehouse',
    'المخزن الرئيسي',
    'active',
    true
)
ON CONFLICT (id) DO NOTHING;

-- Ensure we have an admin role
INSERT INTO roles (id, name, name_ar, description, is_system_role, permissions)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'admin',
    'مدير النظام',
    'صلاحيات كاملة لإدارة النظام',
    true,
    '{"all": true}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Add default admin user
-- Password is "1234" hashed with bcrypt
INSERT INTO users (
    id,
    employee_code,
    username,
    email,
    password_hash,
    full_name,
    full_name_ar,
    role_id,
    branch_id,
    status
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'ADMIN001',
    'admin',
    'admin@restaurant.com',
    crypt('1234', gen_salt('bf')),
    'System Administrator',
    'مدير النظام',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'active'
)
ON CONFLICT (id) DO UPDATE SET
    password_hash = crypt('1234', gen_salt('bf')),
    status = 'active';

-- Add a manager role
INSERT INTO roles (id, name, name_ar, description, is_system_role, permissions)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    'manager',
    'مدير',
    'صلاحيات إدارية',
    true,
    '{"inventory": true, "reports": true, "users": false}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Add a cashier role
INSERT INTO roles (id, name, name_ar, description, is_system_role, permissions)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    'cashier',
    'كاشير',
    'صلاحيات نقطة البيع',
    true,
    '{"pos": true, "orders": true}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE users IS 'Default admin user created with email: admin@restaurant.com, password: 1234';
