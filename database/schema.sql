-- ============================================
-- Restaurant Management System - Production Schema
-- For Supabase PostgreSQL Database
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- CUSTOM TYPES (ENUMS)
-- ============================================

CREATE TYPE branch_status AS ENUM ('active', 'inactive', 'maintenance');
CREATE TYPE branch_return_status AS ENUM ('pending', 'approved', 'rejected', 'in_transit', 'received', 'cancelled');
CREATE TYPE damage_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE inventory_operation AS ENUM ('supply', 'transfer_out', 'transfer_in', 'consumption', 'damage', 'return', 'adjustment');
CREATE TYPE item_status AS ENUM ('active', 'inactive');
CREATE TYPE order_payment_method AS ENUM ('cash', 'visa', 'instapay', 'wallet');
CREATE TYPE order_status AS ENUM ('new', 'pending_payment', 'paid', 'in_kitchen', 'preparing', 'ready', 'delivered', 'cancelled');
CREATE TYPE payment_status AS ENUM ('paid', 'pending', 'partial');
CREATE TYPE purchase_request_status AS ENUM ('draft', 'pending', 'approved', 'rejected', 'ordered', 'partially_received', 'completed', 'cancelled');
CREATE TYPE return_status AS ENUM ('pending', 'approved', 'rejected', 'received');
CREATE TYPE supplier_payment_method AS ENUM ('cash', 'credit');
CREATE TYPE supplier_status AS ENUM ('active', 'inactive');
CREATE TYPE transfer_status AS ENUM ('pending', 'approved', 'rejected', 'received', 'cancelled');
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended');

-- ============================================
-- BRANCHES TABLE
-- ============================================
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(255),
    status branch_status DEFAULT 'active',
    is_main_warehouse BOOLEAN DEFAULT false,
    opening_time TIME,
    closing_time TIME,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- ROLES TABLE
-- ============================================
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    description TEXT,
    permissions JSONB DEFAULT '{}'::jsonb,
    is_system_role BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_code VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    full_name_ar VARCHAR(255),
    phone VARCHAR(50),
    role_id UUID NOT NULL REFERENCES roles(id),
    branch_id UUID REFERENCES branches(id),
    status user_status DEFAULT 'active',
    last_login TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- ============================================
-- CATEGORIES TABLE
-- ============================================
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES categories(id),
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- UNITS TABLE
-- ============================================
CREATE TABLE units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- ITEMS TABLE
-- ============================================
CREATE TABLE items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(255) UNIQUE NOT NULL,
    barcode VARCHAR(255) UNIQUE,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    description TEXT,
    category_id UUID REFERENCES categories(id),
    unit_id UUID NOT NULL REFERENCES units(id),
    purchase_price NUMERIC DEFAULT 0,
    selling_price NUMERIC DEFAULT 0,
    min_stock_level NUMERIC DEFAULT 0,
    max_stock_level NUMERIC,
    reorder_level NUMERIC,
    is_perishable BOOLEAN DEFAULT false,
    shelf_life_days INTEGER,
    storage_conditions TEXT,
    status item_status DEFAULT 'active',
    image_url TEXT,
    is_recipe BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- ============================================
-- RECIPE INGREDIENTS TABLE
-- ============================================
CREATE TABLE recipe_ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    ingredient_item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity NUMERIC NOT NULL,
    unit_id UUID REFERENCES units(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- PRODUCTION LOGS TABLE
-- ============================================
CREATE TABLE production_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_number VARCHAR(50) UNIQUE NOT NULL,
    recipe_item_id UUID NOT NULL REFERENCES items(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    quantity NUMERIC NOT NULL,
    notes TEXT,
    produced_by UUID REFERENCES users(id),
    produced_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- SUPPLIERS TABLE
-- ============================================
CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    contact_person VARCHAR(255),
    phone VARCHAR(50) NOT NULL,
    phone_alt VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    city VARCHAR(255),
    tax_number VARCHAR(255),
    commercial_register VARCHAR(255),
    payment_terms supplier_payment_method DEFAULT 'cash',
    credit_limit NUMERIC DEFAULT 0,
    credit_period_days INTEGER DEFAULT 0,
    current_balance NUMERIC DEFAULT 0,
    status supplier_status DEFAULT 'active',
    notes TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id)
);

-- ============================================
-- INVENTORY TABLE
-- ============================================
CREATE TABLE inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    item_id UUID NOT NULL REFERENCES items(id),
    quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved_quantity NUMERIC DEFAULT 0,
    min_quantity NUMERIC DEFAULT 0,
    last_restock_date TIMESTAMPTZ,
    last_count_date TIMESTAMPTZ,
    opening_balance NUMERIC DEFAULT 0,
    incoming_quantity NUMERIC DEFAULT 0,
    consumption_quantity NUMERIC DEFAULT 0,
    consumption_description TEXT,
    period_start_date DATE,
    period_end_date DATE,
    entry_date DATE DEFAULT CURRENT_DATE,
    document_number VARCHAR(255),
    partial_quantity NUMERIC DEFAULT 0,
    content_quantity NUMERIC DEFAULT 0,
    total_quantity NUMERIC DEFAULT 0,
    content_description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(branch_id, item_id)
);

-- ============================================
-- SUPPLIES TABLE
-- ============================================
CREATE TABLE supplies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supply_number VARCHAR(50) UNIQUE NOT NULL,
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    invoice_number VARCHAR(255),
    invoice_date DATE,
    subtotal NUMERIC NOT NULL DEFAULT 0,
    tax_amount NUMERIC DEFAULT 0,
    discount_amount NUMERIC DEFAULT 0,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    payment_method supplier_payment_method NOT NULL,
    payment_status payment_status DEFAULT 'pending',
    paid_amount NUMERIC DEFAULT 0,
    due_date DATE,
    notes TEXT,
    received_by UUID NOT NULL REFERENCES users(id),
    received_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INVENTORY BATCHES TABLE
-- ============================================
CREATE TABLE inventory_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id UUID NOT NULL REFERENCES inventory(id),
    batch_number VARCHAR(255),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    remaining_quantity NUMERIC NOT NULL CHECK (remaining_quantity >= 0),
    purchase_price NUMERIC,
    production_date DATE,
    expiry_date DATE,
    received_date DATE NOT NULL DEFAULT CURRENT_DATE,
    supply_id UUID REFERENCES supplies(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INVENTORY TRANSACTIONS TABLE
-- ============================================
CREATE TABLE inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    item_id UUID NOT NULL REFERENCES items(id),
    operation_type inventory_operation NOT NULL,
    quantity NUMERIC NOT NULL CHECK (quantity <> 0),
    quantity_before NUMERIC NOT NULL,
    quantity_after NUMERIC NOT NULL,
    unit_cost NUMERIC,
    reference_type VARCHAR(50),
    reference_id UUID,
    batch_id UUID REFERENCES inventory_batches(id),
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SUPPLY ITEMS TABLE
-- ============================================
CREATE TABLE supply_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supply_id UUID NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    received_quantity NUMERIC NOT NULL,
    unit_price NUMERIC NOT NULL,
    discount_percent NUMERIC DEFAULT 0,
    tax_percent NUMERIC DEFAULT 0,
    total_price NUMERIC NOT NULL,
    batch_number VARCHAR(255),
    production_date DATE,
    expiry_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TRANSFERS TABLE
-- ============================================
CREATE TABLE transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_number VARCHAR(50) UNIQUE NOT NULL,
    from_branch_id UUID NOT NULL REFERENCES branches(id),
    to_branch_id UUID NOT NULL REFERENCES branches(id),
    status transfer_status DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    notes TEXT,
    requested_by UUID NOT NULL REFERENCES users(id),
    requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES users(id),
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    shipped_at TIMESTAMPTZ,
    received_by UUID REFERENCES users(id),
    received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TRANSFER ITEMS TABLE
-- ============================================
CREATE TABLE transfer_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    requested_quantity NUMERIC NOT NULL CHECK (requested_quantity > 0),
    approved_quantity NUMERIC,
    shipped_quantity NUMERIC,
    received_quantity NUMERIC,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- DAMAGE REASONS TABLE
-- ============================================
CREATE TABLE damage_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- DAMAGES TABLE
-- ============================================
CREATE TABLE damages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    damage_number VARCHAR(50) UNIQUE NOT NULL,
    branch_id UUID NOT NULL REFERENCES branches(id),
    item_id UUID NOT NULL REFERENCES items(id),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC,
    total_cost NUMERIC,
    reason_id UUID NOT NULL REFERENCES damage_reasons(id),
    description TEXT,
    image_url TEXT,
    batch_id UUID REFERENCES inventory_batches(id),
    status damage_status DEFAULT 'pending',
    registered_by UUID NOT NULL REFERENCES users(id),
    registered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES users(id),
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- MENU CATEGORIES TABLE
-- ============================================
CREATE TABLE menu_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    description TEXT,
    image_url TEXT,
    parent_id UUID REFERENCES menu_categories(id),
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- MENU ITEMS TABLE
-- ============================================
CREATE TABLE menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    description TEXT,
    description_ar TEXT,
    category_id UUID REFERENCES menu_categories(id),
    price NUMERIC NOT NULL CHECK (price >= 0),
    cost NUMERIC DEFAULT 0,
    tax_percent NUMERIC DEFAULT 0,
    image_url TEXT,
    preparation_time_minutes INTEGER,
    calories INTEGER,
    is_available BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- MENU ITEM INGREDIENTS TABLE
-- ============================================
CREATE TABLE menu_item_ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_item_id UUID NOT NULL REFERENCES menu_items(id),
    item_id UUID NOT NULL REFERENCES items(id),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit_id UUID NOT NULL REFERENCES units(id),
    is_optional BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- CASHIER SHIFTS TABLE
-- ============================================
CREATE TABLE cashier_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_number VARCHAR(50) UNIQUE NOT NULL,
    cashier_id UUID NOT NULL REFERENCES users(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    end_time TIMESTAMPTZ,
    opening_amount NUMERIC NOT NULL DEFAULT 0,
    closing_amount NUMERIC,
    expected_amount NUMERIC,
    cash_sales NUMERIC DEFAULT 0,
    card_sales NUMERIC DEFAULT 0,
    total_sales NUMERIC DEFAULT 0,
    orders_count INTEGER DEFAULT 0,
    difference NUMERIC,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    notes TEXT,
    closed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ORDERS TABLE
-- ============================================
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(50) UNIQUE NOT NULL,
    branch_id UUID NOT NULL REFERENCES branches(id),
    order_type VARCHAR(50) DEFAULT 'takeaway',
    customer_name VARCHAR(255),
    customer_phone VARCHAR(50),
    subtotal NUMERIC NOT NULL DEFAULT 0,
    tax_amount NUMERIC DEFAULT 0,
    discount_amount NUMERIC DEFAULT 0,
    discount_reason TEXT,
    total_amount NUMERIC NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    payment_method order_payment_method,
    payment_reference VARCHAR(255),
    status order_status DEFAULT 'new',
    notes TEXT,
    kitchen_notes TEXT,
    cashier_id UUID NOT NULL REFERENCES users(id),
    chef_id UUID REFERENCES users(id),
    shift_id UUID REFERENCES cashier_shifts(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMPTZ,
    sent_to_kitchen_at TIMESTAMPTZ,
    preparation_started_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES users(id),
    cancellation_reason TEXT,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- ORDER ITEMS TABLE
-- ============================================
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id UUID REFERENCES menu_items(id),
    item_id UUID REFERENCES items(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC NOT NULL,
    discount_amount NUMERIC DEFAULT 0,
    total_price NUMERIC NOT NULL,
    notes TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- DAILY INVENTORY COUNTS TABLE
-- ============================================
CREATE TABLE daily_inventory_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    count_date DATE NOT NULL,
    count_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',
    notes TEXT,
    counted_by UUID NOT NULL REFERENCES users(id),
    submitted_at TIMESTAMPTZ,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- DAILY INVENTORY COUNT ITEMS TABLE
-- ============================================
CREATE TABLE daily_inventory_count_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    count_id UUID NOT NULL REFERENCES daily_inventory_counts(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    system_quantity NUMERIC NOT NULL,
    actual_quantity NUMERIC NOT NULL,
    variance_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- PURCHASE REQUESTS TABLE
-- ============================================
CREATE TABLE purchase_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number VARCHAR(50) UNIQUE NOT NULL,
    request_date DATE NOT NULL DEFAULT CURRENT_DATE,
    branch_id UUID NOT NULL REFERENCES branches(id),
    status purchase_request_status DEFAULT 'draft',
    priority INTEGER DEFAULT 0,
    notes TEXT,
    total_items INTEGER DEFAULT 0,
    total_quantity NUMERIC DEFAULT 0,
    estimated_cost NUMERIC DEFAULT 0,
    requested_by UUID NOT NULL REFERENCES users(id),
    requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES users(id),
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- PURCHASE REQUEST ITEMS TABLE
-- ============================================
CREATE TABLE purchase_request_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    supplier_id UUID REFERENCES suppliers(id),
    requested_quantity NUMERIC NOT NULL CHECK (requested_quantity > 0),
    approved_quantity NUMERIC,
    ordered_quantity NUMERIC,
    received_quantity NUMERIC DEFAULT 0,
    estimated_unit_price NUMERIC,
    estimated_total NUMERIC,
    notes TEXT,
    item_status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- PURCHASE ORDERS TABLE
-- ============================================
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(50) UNIQUE NOT NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    request_id UUID REFERENCES purchase_requests(id),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    subtotal NUMERIC NOT NULL DEFAULT 0,
    tax_amount NUMERIC DEFAULT 0,
    discount_amount NUMERIC DEFAULT 0,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    payment_type VARCHAR(20) DEFAULT 'cash' CHECK (payment_type IN ('cash', 'credit')),
    paid_amount NUMERIC DEFAULT 0,
    remaining_amount NUMERIC DEFAULT 0,
    payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid')),
    status VARCHAR(30) DEFAULT 'pending',
    expected_delivery_date DATE,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- PURCHASE ORDER ITEMS TABLE
-- ============================================
CREATE TABLE purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    request_item_id UUID REFERENCES purchase_request_items(id),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC NOT NULL,
    tax_percent NUMERIC DEFAULT 0,
    discount_percent NUMERIC DEFAULT 0,
    total_price NUMERIC NOT NULL,
    received_quantity NUMERIC DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- PURCHASE ORDER PAYMENTS TABLE
-- ============================================
CREATE TABLE purchase_order_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    payment_number VARCHAR(50) UNIQUE NOT NULL,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    amount NUMERIC NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50) NOT NULL,
    reference_number VARCHAR(100),
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SUPPLIER RETURNS TABLE
-- ============================================
CREATE TABLE supplier_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_number VARCHAR(50) UNIQUE NOT NULL,
    supply_id UUID REFERENCES supplies(id), -- Optional: can be NULL if not linked to specific supply
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    item_id UUID NOT NULL REFERENCES items(id),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC NOT NULL,
    total_amount NUMERIC NOT NULL,
    reason TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    status return_status DEFAULT 'pending',
    registered_by UUID NOT NULL REFERENCES users(id),
    registered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES users(id),
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    received_by_supplier_at TIMESTAMPTZ,
    credit_note_number VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SUPPLIER PAYMENTS TABLE
-- ============================================
CREATE TABLE supplier_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number VARCHAR(50) UNIQUE NOT NULL,
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    supply_id UUID REFERENCES supplies(id),
    amount NUMERIC NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50) NOT NULL,
    reference_number VARCHAR(100),
    bank_name VARCHAR(255),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SUPPLIER DEBT TRANSACTIONS TABLE
-- ============================================
CREATE TABLE supplier_debt_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('purchase_order', 'manual_debt', 'payment', 'return')),
    amount NUMERIC NOT NULL,
    reference_number VARCHAR(255),
    description TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SUPPLIER ITEMS TABLE
-- ============================================
CREATE TABLE supplier_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    item_id UUID NOT NULL REFERENCES items(id),
    supplier_item_code VARCHAR(255),
    unit_price NUMERIC,
    min_order_quantity NUMERIC,
    lead_time_days INTEGER,
    is_preferred BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- BRANCH RETURNS TABLE
-- ============================================
CREATE TABLE branch_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_number VARCHAR(50) UNIQUE NOT NULL,
    return_date DATE NOT NULL DEFAULT CURRENT_DATE,
    from_branch_id UUID NOT NULL REFERENCES branches(id),
    to_branch_id UUID NOT NULL REFERENCES branches(id),
    status branch_return_status DEFAULT 'pending',
    return_reason TEXT NOT NULL,
    total_items INTEGER DEFAULT 0,
    total_quantity NUMERIC DEFAULT 0,
    total_value NUMERIC DEFAULT 0,
    notes TEXT,
    requested_by UUID NOT NULL REFERENCES users(id),
    requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES users(id),
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    shipped_at TIMESTAMPTZ,
    received_by UUID REFERENCES users(id),
    received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- BRANCH RETURN ITEMS TABLE
-- ============================================
CREATE TABLE branch_return_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id UUID NOT NULL REFERENCES branch_returns(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id),
    requested_quantity NUMERIC NOT NULL CHECK (requested_quantity > 0),
    approved_quantity NUMERIC,
    shipped_quantity NUMERIC,
    received_quantity NUMERIC,
    unit_cost NUMERIC,
    total_value NUMERIC,
    item_reason TEXT,
    batch_id UUID REFERENCES inventory_batches(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- BRANCH RETURN REASONS TABLE
-- ============================================
CREATE TABLE branch_return_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id),
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'normal',
    reference_type VARCHAR(50),
    reference_id UUID,
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- BRANCH SETTINGS TABLE
-- ============================================
CREATE TABLE branch_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    key VARCHAR(255) NOT NULL,
    value TEXT,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SYSTEM SETTINGS TABLE
-- ============================================
CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT,
    value_type VARCHAR(50) DEFAULT 'string',
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- ALERT SETTINGS TABLE
-- ============================================
CREATE TABLE alert_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID REFERENCES branches(id),
    alert_type VARCHAR(255) NOT NULL,
    is_enabled BOOLEAN DEFAULT true,
    threshold_value NUMERIC,
    threshold_days INTEGER,
    notify_roles TEXT[],
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- AUDIT LOGS TABLE
-- ============================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(255) NOT NULL,
    table_name VARCHAR(255),
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- USER SESSIONS TABLE
-- ============================================
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    token_hash VARCHAR(255) NOT NULL,
    device_info TEXT,
    ip_address INET,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- BRANCH MENU PRICES TABLE
-- ============================================
CREATE TABLE branch_menu_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    menu_item_id UUID NOT NULL REFERENCES menu_items(id),
    price NUMERIC NOT NULL CHECK (price >= 0),
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- BRANCH POS ITEMS TABLE
-- ============================================
CREATE TABLE branch_pos_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id),
    item_id UUID NOT NULL REFERENCES items(id),
    price NUMERIC NOT NULL CHECK (price >= 0),
    is_available BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- USER MANAGEMENT FUNCTIONS
-- ============================================

-- Function to create a user with hashed password
CREATE OR REPLACE FUNCTION create_user(
  p_username VARCHAR,
  p_email VARCHAR,
  p_password VARCHAR,
  p_full_name VARCHAR,
  p_full_name_ar VARCHAR,
  p_employee_code VARCHAR,
  p_phone VARCHAR,
  p_role_id UUID,
  p_branch_id UUID,
  p_status user_status
)
RETURNS TABLE(id UUID) AS $$
DECLARE
  v_user_id UUID;
  v_password_hash VARCHAR;
BEGIN
  -- Generate password hash using pgcrypto
  v_password_hash := crypt(p_password, gen_salt('bf'));
  
  -- Insert the user
  INSERT INTO users (
    username,
    email,
    password_hash,
    full_name,
    full_name_ar,
    employee_code,
    phone,
    role_id,
    branch_id,
    status
  ) VALUES (
    p_username,
    p_email,
    v_password_hash,
    p_full_name,
    p_full_name_ar,
    COALESCE(p_employee_code, 'EMP-' || EXTRACT(EPOCH FROM NOW())::TEXT),
    p_phone,
    p_role_id,
    p_branch_id,
    COALESCE(p_status, 'active'::user_status)
  )
  RETURNING users.id INTO v_user_id;
  
  RETURN QUERY SELECT v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update a user with optional password change
CREATE OR REPLACE FUNCTION update_user(
  p_user_id UUID,
  p_email VARCHAR,
  p_password VARCHAR,
  p_full_name VARCHAR,
  p_full_name_ar VARCHAR,
  p_employee_code VARCHAR,
  p_phone VARCHAR,
  p_role_id UUID,
  p_branch_id UUID,
  p_status user_status
)
RETURNS TABLE(id UUID) AS $$
DECLARE
  v_password_hash VARCHAR;
BEGIN
  -- If password is provided, hash it
  IF p_password IS NOT NULL AND p_password != '' THEN
    v_password_hash := crypt(p_password, gen_salt('bf'));
  END IF;
  
  -- Update the user
  UPDATE users SET
    email = COALESCE(p_email, email),
    password_hash = COALESCE(v_password_hash, password_hash),
    full_name = COALESCE(p_full_name, full_name),
    full_name_ar = COALESCE(p_full_name_ar, full_name_ar),
    employee_code = COALESCE(p_employee_code, employee_code),
    phone = COALESCE(p_phone, phone),
    role_id = COALESCE(p_role_id, role_id),
    branch_id = CASE WHEN p_branch_id IS NOT NULL THEN p_branch_id ELSE branch_id END,
    status = COALESCE(p_status, status),
    updated_at = NOW()
  WHERE users.id = p_user_id;
  
  RETURN QUERY SELECT p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RECIPE COST CALCULATION FUNCTION
-- ============================================

-- Function to calculate recipe cost from ingredients
CREATE OR REPLACE FUNCTION calculate_recipe_cost(recipe_item_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  total_cost NUMERIC := 0;
BEGIN
  SELECT COALESCE(SUM(ri.quantity * COALESCE(i.purchase_price, 0)), 0)
  INTO total_cost
  FROM recipe_ingredients ri
  JOIN items i ON i.id = ri.ingredient_item_id
  WHERE ri.recipe_item_id = calculate_recipe_cost.recipe_item_id;
  
  RETURN total_cost;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- VIEWS
-- ============================================

-- View: Branch POS Items with Stock Information
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

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Branches
CREATE INDEX idx_branches_status ON branches(status);
CREATE INDEX idx_branches_is_main ON branches(is_main_warehouse);

-- Users
CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_users_branch ON users(branch_id);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);

-- Items
CREATE INDEX idx_items_category ON items(category_id);
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_barcode ON items(barcode);
CREATE INDEX idx_items_is_recipe ON items(is_recipe);

-- Inventory
CREATE INDEX idx_inventory_branch ON inventory(branch_id);
CREATE INDEX idx_inventory_item ON inventory(item_id);
CREATE INDEX idx_inventory_branch_item ON inventory(branch_id, item_id);

-- Suppliers
CREATE INDEX idx_suppliers_status ON suppliers(status);

-- Supplies
CREATE INDEX idx_supplies_supplier ON supplies(supplier_id);
CREATE INDEX idx_supplies_branch ON supplies(branch_id);
CREATE INDEX idx_supplies_status ON supplies(payment_status);

-- Transfers
CREATE INDEX idx_transfers_from_branch ON transfers(from_branch_id);
CREATE INDEX idx_transfers_to_branch ON transfers(to_branch_id);
CREATE INDEX idx_transfers_status ON transfers(status);

-- Damages
CREATE INDEX idx_damages_branch ON damages(branch_id);
CREATE INDEX idx_damages_item ON damages(item_id);
CREATE INDEX idx_damages_status ON damages(status);

-- Orders
CREATE INDEX idx_orders_branch ON orders(branch_id);
CREATE INDEX idx_orders_cashier ON orders(cashier_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_shift ON orders(shift_id);
CREATE INDEX idx_orders_created ON orders(created_at);

-- Purchase Requests
CREATE INDEX idx_purchase_requests_branch ON purchase_requests(branch_id);
CREATE INDEX idx_purchase_requests_status ON purchase_requests(status);

-- Purchase Orders
CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_branch ON purchase_orders(branch_id);
CREATE INDEX idx_purchase_orders_status ON purchase_orders(status);

-- Cashier Shifts
CREATE INDEX idx_cashier_shifts_branch ON cashier_shifts(branch_id);
CREATE INDEX idx_cashier_shifts_cashier ON cashier_shifts(cashier_id);
CREATE INDEX idx_cashier_shifts_status ON cashier_shifts(status);

-- Branch Returns
CREATE INDEX idx_branch_returns_from ON branch_returns(from_branch_id);
CREATE INDEX idx_branch_returns_to ON branch_returns(to_branch_id);
CREATE INDEX idx_branch_returns_status ON branch_returns(status);

-- Notifications
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_branch ON notifications(branch_id);
CREATE INDEX idx_notifications_read ON notifications(is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at);

-- Inventory Batches
CREATE INDEX idx_inventory_batches_inventory ON inventory_batches(inventory_id);
CREATE INDEX idx_inventory_batches_expiry ON inventory_batches(expiry_date);

-- Inventory Transactions
CREATE INDEX idx_inventory_transactions_branch ON inventory_transactions(branch_id);
CREATE INDEX idx_inventory_transactions_item ON inventory_transactions(item_id);
CREATE INDEX idx_inventory_transactions_created ON inventory_transactions(created_at);

-- ============================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON branches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_items_updated_at BEFORE UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON inventory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_supplies_updated_at BEFORE UPDATE ON supplies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transfers_updated_at BEFORE UPDATE ON transfers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_damages_updated_at BEFORE UPDATE ON damages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_purchase_requests_updated_at BEFORE UPDATE ON purchase_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cashier_shifts_updated_at BEFORE UPDATE ON cashier_shifts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_branch_returns_updated_at BEFORE UPDATE ON branch_returns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_menu_categories_updated_at BEFORE UPDATE ON menu_categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_menu_items_updated_at BEFORE UPDATE ON menu_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_supplier_returns_updated_at BEFORE UPDATE ON supplier_returns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_inventory_counts_updated_at BEFORE UPDATE ON daily_inventory_counts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- INVENTORY DEDUCTION TRIGGER
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
CREATE TRIGGER trigger_deduct_inventory_on_payment
  AFTER UPDATE ON orders
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND OLD.status != 'paid')
  EXECUTE FUNCTION deduct_inventory_on_payment();

-- ============================================
-- SEED DATA
-- ============================================

-- Insert default damage reasons
INSERT INTO damage_reasons (code, name, name_ar, is_active, sort_order) VALUES
('EXPIRED', 'Expired', 'منتهي الصلاحية', true, 1),
('DAMAGED', 'Damaged', 'تالف', true, 2),
('BROKEN', 'Broken', 'مكسور', true, 3),
('SPOILED', 'Spoiled', 'فاسد', true, 4),
('OTHER', 'Other', 'أخرى', true, 5);

-- Insert default units
INSERT INTO units (code, name, name_ar, is_active) VALUES
('KG', 'Kilogram', 'كيلوجرام', true),
('G', 'Gram', 'جرام', true),
('L', 'Liter', 'لتر', true),
('ML', 'Milliliter', 'مللي لتر', true),
('PC', 'Piece', 'قطعة', true),
('BOX', 'Box', 'علبة', true),
('PKT', 'Packet', 'باكت', true),
('BTL', 'Bottle', 'زجاجة', true),
('CAN', 'Can', 'علبة معدنية', true),
('BAG', 'Bag', 'كيس', true),
('DZ', 'Dozen', 'درزن', true),
('CTN', 'Carton', 'كرتونة', true);

-- Insert default categories
INSERT INTO categories (code, name, name_ar, description, is_active, sort_order) VALUES
('CAT-RECIPE', 'Recipes', 'الريسبيهات', 'Category for recipe items', true, 999),
('CAT-FOOD', 'Food Items', 'مواد غذائية', 'Food and ingredients', true, 1),
('CAT-BEVERAGE', 'Beverages', 'مشروبات', 'Drinks and beverages', true, 2),
('CAT-SUPPLIES', 'Supplies', 'مستلزمات', 'Restaurant supplies', true, 3);

-- Insert default roles
INSERT INTO roles (name, name_ar, description, is_system_role) VALUES
('admin', 'مدير النظام', 'Full system access', true),
('warehouse_manager', 'مدير المخزن', 'Warehouse management', true),
('branch_supervisor', 'مشرف الفرع', 'Branch supervision', true),
('chef', 'شيف', 'Kitchen operations', true),
('cashier', 'كاشير', 'POS operations', true),
('purchase_manager', 'مدير المشتريات', 'Purchase management', true);

-- ============================================
-- COMPLETION MESSAGE
-- ============================================
-- Schema created successfully!
-- Next steps:
-- 1. Run this SQL file in your Supabase SQL Editor
-- 2. Create your first admin user through Supabase Auth
-- 3. Link the auth user to the users table with admin role
-- 4. Configure your .env file with Supabase credentials
-- Last updated: 2026-04-09
-- ============================================
