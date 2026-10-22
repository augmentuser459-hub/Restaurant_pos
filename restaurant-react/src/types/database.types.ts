// Database Types for Restaurant Management System
//
// Hand-written to match the live Supabase schema (checked against information_schema on staging, 2026-10-21).
// Conventions:
// - A nullable column is an optional field. PostgREST returns null (not undefined) for it; the fields added in the
//   schema check say so explicitly (`field?: T | null`), the older ones are kept as `field?: T`.
//   Nullable columns that have a DEFAULT (status, created_at, ...) are typed as required: the default fills them.
// - Embedded relations (e.g. `unit:units(...)`, `role:roles(...)`) are optional fields typed with the
//   columns the app selects.
// - Every field that is not an embedded relation is a real column. Columns that do NOT exist (supplies.supply_date,
//   items.unit, transfers.transfer_date, ...) are listed in database/SCHEMA_VERIFICATION.md; using them fails with
//   error 42703.
// - users.password_hash is deliberately not typed: never select it (list user columns explicitly).

// Enums
export type BranchStatus = 'active' | 'inactive' | 'maintenance'
export type SupplierStatus = 'active' | 'inactive'
export type ItemStatus = 'active' | 'inactive'
export type PaymentStatus = 'paid' | 'pending' | 'partial'
export type PaymentMethod = 'cash' | 'credit'
export type OrderPaymentMethod = 'cash' | 'visa' | 'instapay' | 'wallet'
export type OrderStatus = 'new' | 'pending_payment' | 'paid' | 'in_kitchen' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
export type TransferStatus = 'pending' | 'approved' | 'rejected' | 'received' | 'cancelled'
export type DamageStatus = 'pending' | 'approved' | 'rejected'
export type ReturnStatus = 'pending' | 'approved' | 'rejected' | 'received'
export type BranchReturnStatus = 'pending' | 'approved' | 'rejected' | 'in_transit' | 'received' | 'cancelled'
export type PurchaseRequestStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'ordered' | 'partially_received' | 'completed' | 'cancelled'
export type UserRole = 'admin' | 'warehouse_manager' | 'branch_supervisor' | 'chef' | 'cashier' | 'purchase_manager'
export type UserStatus = 'active' | 'inactive' | 'suspended'
export type InventoryOperation = 'supply' | 'transfer_out' | 'transfer_in' | 'consumption' | 'damage' | 'return' | 'adjustment' | 'sale' | 'production'
// daily_inventory_counts.count_type is varchar; 'morning' is written by the chef consumption form
export type DailyCountType = 'opening' | 'closing' | 'morning'
export type ShiftStatus = 'open' | 'closed'

// Branch
export interface Branch {
  id: string
  code: string
  name: string
  name_ar: string
  address?: string
  phone?: string
  email?: string
  status: BranchStatus
  is_main_warehouse: boolean
  opening_time?: string
  closing_time?: string
  created_at: string
  updated_at: string
}

// Role (roles table)
export interface Role {
  id: string
  name: UserRole
  name_ar: string
  description?: string | null
  permissions?: unknown
  is_system_role?: boolean | null
  created_at?: string
  updated_at?: string
}

// User (users table). After go-live users.id = auth.users.id (Supabase Auth).
export interface User {
  id: string
  employee_code?: string | null
  username: string
  email: string
  full_name: string
  full_name_ar?: string
  phone?: string
  role_id: string
  branch_id?: string
  status: UserStatus
  last_login?: string | null
  password_changed_at?: string | null
  failed_login_attempts?: number | null
  locked_until?: string | null
  created_at: string
  updated_at: string
  created_by?: string | null
  // Embedded `role:roles(...)`. The database has only role_id; the role name lives in roles.name.
  // A plain string is accepted for sessions cached by older builds.
  role?: Role | UserRole
  branch?: Branch
}

// Unit (units table)
export interface Unit {
  id: string
  code: string
  name: string
  name_ar: string
  is_active?: boolean | null
  // Unit conversion: one of this unit = factor_to_base of base_unit_id (no base_unit_id = it is its own base)
  base_unit_id?: string | null
  factor_to_base: number
  created_at?: string
}

// Embedded unit as the app selects it (`unit:units(id, name_ar, code)`)
export type UnitRef = Pick<Unit, 'name_ar'> & Partial<Pick<Unit, 'id' | 'code' | 'name'>>

// Category
export interface Category {
  id: string
  code: string
  name: string
  name_ar: string
  description?: string
  parent_id?: string
  sort_order: number
  is_active: boolean
  // true = items of this category are prepared in the kitchen (kitchen screen filter)
  is_kitchen?: boolean | null
  created_at: string
  updated_at: string
}

// Item
export interface Item {
  id: string
  code: string
  barcode?: string
  name: string
  name_ar: string
  description?: string
  unit_id: string
  category_id?: string
  min_stock_level: number
  max_stock_level?: number
  reorder_level?: number | null
  purchase_price?: number
  selling_price?: number
  is_perishable?: boolean | null
  shelf_life_days?: number | null
  storage_conditions?: string | null
  status: ItemStatus
  is_recipe?: boolean
  image_url?: string
  created_by?: string | null
  created_at: string
  updated_at: string
  category?: Category
  // Embedded `unit:units(...)`; items have no text unit column (use unit_id)
  unit?: UnitRef | null
}

// Recipe Ingredient
export interface RecipeIngredient {
  id: string
  recipe_item_id: string
  ingredient_item_id: string
  quantity: number
  unit_id?: string
  notes?: string
  created_at: string
  updated_at: string
  ingredient?: Item
  unit?: { id: string; name_ar: string; code: string }
}

// Production Log
export interface ProductionLog {
  id: string
  production_number: string
  recipe_item_id: string
  branch_id: string
  quantity: number
  notes?: string
  produced_by?: string
  produced_at: string
  // idempotency key of the production request (a retried request returns the first result)
  request_id?: string | null
  created_at: string
  recipe?: Item
  branch?: Branch
}

// Supplier
export interface Supplier {
  id: string
  code: string
  name: string
  name_ar?: string | null
  contact_person?: string
  phone: string
  phone_alt?: string | null
  email?: string
  address?: string
  city?: string | null
  tax_number?: string | null
  commercial_register?: string | null
  payment_terms?: PaymentMethod
  credit_limit?: number
  credit_period_days?: number | null
  // > 0 = we owe the supplier
  current_balance: number
  status: SupplierStatus
  notes?: string
  rating?: number | null
  created_by?: string | null
  created_at: string
  updated_at: string
}

// Inventory (stock of one item in one branch)
export interface Inventory {
  id: string
  branch_id: string
  item_id: string
  quantity: number
  reserved_quantity?: number | null
  min_quantity: number
  partial_quantity?: number
  content_quantity?: number
  total_quantity?: number
  content_description?: string | null
  opening_balance?: number
  incoming_quantity?: number
  consumption_quantity?: number
  consumption_description?: string | null
  period_start_date?: string | null
  period_end_date?: string | null
  entry_date?: string | null
  document_number?: string | null
  last_restock_date?: string
  last_count_date?: string | null
  created_at: string
  updated_at: string
  branch?: Branch
  item?: Item
}

// Inventory Transaction (stock movement log, written only by stock_adjust)
export interface InventoryTransaction {
  id: string
  branch_id: string
  item_id: string
  operation_type: InventoryOperation
  // signed change: > 0 adds stock, < 0 removes it
  quantity: number
  quantity_before: number
  quantity_after: number
  unit_cost?: number | null
  reference_type?: string | null
  reference_id?: string | null
  batch_id?: string | null
  notes?: string | null
  created_by: string
  created_at: string
}

// Supply
export interface Supply {
  id: string
  supply_number: string
  supplier_id: string
  branch_id: string
  invoice_number?: string
  invoice_date?: string | null
  subtotal: number
  tax_amount?: number | null
  discount_amount?: number | null
  total_amount: number
  paid_amount: number
  // amount paid on delivery (later payments are supplier_payments rows)
  upfront_paid_amount?: number | null
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  due_date?: string | null
  notes?: string
  received_by: string
  received_at: string
  approved_by?: string | null
  approved_at?: string | null
  created_at: string
  updated_at: string
  supplier?: Supplier
  branch?: Branch
  items?: SupplyItem[]
  // There is no supply_date or created_by column: use invoice_date / received_at and received_by.
}

// Supply Item
export interface SupplyItem {
  id: string
  supply_id: string
  item_id: string
  quantity: number
  received_quantity: number
  unit_price: number
  discount_percent?: number | null
  tax_percent?: number | null
  total_price: number
  batch_number?: string
  production_date?: string | null
  expiry_date?: string
  notes?: string
  created_at: string
  item?: Item
}

// Transfer
export interface Transfer {
  id: string
  transfer_number: string
  from_branch_id: string
  to_branch_id: string
  status: TransferStatus
  priority?: number | null
  notes?: string
  requested_by: string
  requested_at: string
  approved_by?: string
  approved_at?: string
  rejected_by?: string | null
  rejected_at?: string | null
  rejection_reason?: string | null
  shipped_at?: string | null
  received_by?: string
  received_at?: string
  created_at: string
  updated_at: string
  from_branch?: Branch
  to_branch?: Branch
  items?: TransferItem[]
}

// Transfer Item
export interface TransferItem {
  id: string
  transfer_id: string
  item_id: string
  requested_quantity: number
  approved_quantity?: number
  shipped_quantity?: number | null
  received_quantity?: number
  notes?: string
  created_at: string
  item?: Item
}

// Damage
export interface Damage {
  id: string
  damage_number: string
  branch_id: string
  item_id: string
  quantity: number
  unit_cost?: number
  total_cost?: number
  reason_id: string
  description?: string
  image_url?: string
  batch_id?: string | null
  status: DamageStatus
  registered_by: string
  registered_at: string
  approved_by?: string
  approved_at?: string
  rejected_by?: string
  rejected_at?: string
  rejection_reason?: string
  created_at: string
  updated_at: string
  branch?: Branch
  item?: Item
  reason?: DamageReason
}

// Damage Reason
export interface DamageReason {
  id: string
  code: string
  name: string
  name_ar: string
  description?: string
  is_active: boolean
  sort_order: number
  created_at: string
}

// Cashier Shift
export interface CashierShift {
  id: string
  shift_number: string
  cashier_id: string
  branch_id: string
  start_time: string
  end_time?: string | null
  opening_amount: number
  closing_amount?: number | null
  expected_amount?: number | null
  cash_sales?: number | null
  // all non-cash sales (visa + instapay + wallet)
  card_sales?: number | null
  visa_sales?: number | null
  instapay_sales?: number | null
  wallet_sales?: number | null
  total_sales?: number | null
  orders_count?: number | null
  difference?: number | null
  status: ShiftStatus
  notes?: string | null
  closed_by?: string | null
  created_at: string
  updated_at: string
}

// Order
export interface Order {
  id: string
  order_number: string
  branch_id: string
  order_type?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  subtotal: number
  tax_amount: number
  discount_amount: number
  discount_reason?: string | null
  total_amount: number
  payment_method?: OrderPaymentMethod
  payment_reference?: string | null
  // amount the customer handed over (cash) or the total (other methods), and the change given back
  paid_amount?: number | null
  change_amount?: number | null
  // idempotency key of the checkout request (a retry returns the same order)
  client_request_id?: string | null
  // when the sale took its stock; null = holds no stock
  stock_deducted_at?: string | null
  status: OrderStatus
  notes?: string
  kitchen_notes?: string | null
  cashier_id: string
  chef_id?: string | null
  shift_id?: string | null
  created_at: string
  paid_at?: string
  sent_to_kitchen_at?: string | null
  preparation_started_at?: string | null
  ready_at?: string | null
  delivered_at?: string
  cancelled_at?: string | null
  cancelled_by?: string | null
  cancellation_reason?: string | null
  updated_at: string
  branch?: Branch
  cashier?: User
  items?: OrderItem[]
}

// Order Item. POS lines reference items (item_id); menu_item_id is only set by the old menu flow,
// so either one can be null.
export interface OrderItem {
  id: string
  order_id: string
  menu_item_id?: string | null
  item_id: string | null
  quantity: number
  unit_price: number
  discount_amount?: number | null
  total_price: number
  notes?: string
  status?: string | null
  // quantity of this line currently taken from stock (0 = untracked or given back; null = old line)
  stock_deducted_qty?: number | null
  created_at: string
  item?: Item
}

// Branch POS Item (what a branch sells at the POS, and at which price)
export interface BranchPosItem {
  id: string
  branch_id: string
  item_id: string
  price: number
  is_available?: boolean | null
  display_order?: number | null
  // set when the item was removed from this branch's POS (never auto-added back while set)
  removed_at?: string | null
  created_at: string
  updated_at: string
  item?: Item
}

// Menu Category
export interface MenuCategory {
  id: string
  code: string
  name: string
  name_ar: string
  description?: string
  parent_id?: string
  sort_order: number
  is_active: boolean
  image_url?: string
  created_at: string
  updated_at: string
}

// Menu Item
export interface MenuItem {
  id: string
  code: string
  name: string
  name_ar: string
  description?: string
  description_ar?: string | null
  category_id?: string | null
  price: number
  cost?: number
  tax_percent?: number | null
  is_available: boolean
  is_active?: boolean | null
  preparation_time_minutes?: number | null
  calories?: number | null
  image_url?: string
  sort_order: number
  created_at: string
  updated_at: string
  category?: MenuCategory
}

// Daily Inventory Count
export interface DailyInventoryCount {
  id: string
  branch_id: string
  count_date: string
  count_type: DailyCountType
  status: 'draft' | 'completed' | 'approved' | 'rejected'
  notes?: string
  counted_by: string
  submitted_at?: string
  approved_by?: string
  approved_at?: string
  created_at: string
  updated_at: string
  branch?: Branch
  items?: DailyInventoryCountItem[]
}

// Daily Inventory Count Item
export interface DailyInventoryCountItem {
  id: string
  count_id: string
  item_id: string
  system_quantity: number
  actual_quantity: number
  variance_reason?: string
  created_at: string
  item?: Item
}

// Purchase Request
export interface PurchaseRequest {
  id: string
  request_number: string
  request_date: string
  branch_id: string
  status: PurchaseRequestStatus
  priority: number
  notes?: string
  total_items: number
  total_quantity: number
  estimated_cost: number
  requested_by: string
  requested_at: string
  approved_by?: string
  approved_at?: string
  rejected_by?: string
  rejected_at?: string
  rejection_reason?: string
  created_at: string
  updated_at: string
  branch?: Branch
  items?: PurchaseRequestItem[]
}

// Purchase Request Item
export interface PurchaseRequestItem {
  id: string
  request_id: string
  item_id: string
  supplier_id?: string
  requested_quantity: number
  approved_quantity?: number
  ordered_quantity?: number
  received_quantity?: number
  estimated_unit_price?: number
  estimated_total?: number
  notes?: string
  item_status?: string
  created_at: string
  item?: Item
  supplier?: Supplier
}

// Purchase Order
export interface PurchaseOrder {
  id: string
  order_number: string
  order_date: string
  request_id?: string
  supplier_id: string
  branch_id: string
  subtotal: number
  tax_amount?: number
  discount_amount?: number
  total_amount: number
  // nullable columns with defaults ('cash', 0, 0, 'pending')
  payment_type?: 'cash' | 'credit'
  paid_amount?: number
  remaining_amount?: number
  payment_status?: 'pending' | 'partial' | 'paid'
  status: string
  expected_delivery_date?: string
  notes?: string
  created_by: string
  created_at: string
  approved_by?: string
  approved_at?: string
  rejected_by?: string | null
  rejected_at?: string | null
  rejection_reason?: string | null
  cancelled_by?: string | null
  cancelled_at?: string | null
  cancellation_reason?: string | null
  received_by?: string | null
  received_at?: string | null
  updated_at: string
  supplier?: Supplier
  branch?: Branch
  request?: PurchaseRequest
  items?: PurchaseOrderItem[]
  payments?: PurchaseOrderPayment[]
}

// Purchase Order Payment
export interface PurchaseOrderPayment {
  id: string
  order_id: string
  payment_number: string
  payment_date: string
  amount: number
  payment_method: string
  reference_number?: string
  notes?: string
  created_by: string
  created_at: string
  updated_at: string
}

// Purchase Order Item
export interface PurchaseOrderItem {
  id: string
  order_id: string
  item_id: string
  request_item_id?: string
  quantity: number
  unit_price: number
  tax_percent?: number
  discount_percent?: number
  total_price: number
  received_quantity?: number
  notes?: string
  created_at: string
  item?: Item
}

// Supplier Return
export interface SupplierReturn {
  id: string
  return_number: string
  supply_id?: string
  supplier_id: string
  // branch the goods leave from (null on old rows = the main warehouse)
  branch_id?: string | null
  item_id: string
  quantity: number
  unit_price: number
  total_amount: number
  reason: string
  description?: string
  image_url?: string
  status: ReturnStatus
  registered_by: string
  registered_at: string
  approved_by?: string
  approved_at?: string
  rejected_by?: string | null
  rejected_at?: string | null
  rejection_reason?: string | null
  received_by_supplier_at?: string | null
  credit_note_number?: string | null
  created_at: string
  updated_at: string
  supplier?: Supplier
  item?: Item
}

// Supplier Payment (supplier_payments table; there is no `payments` table)
export interface SupplierPayment {
  id: string
  payment_number: string
  supplier_id: string
  supply_id?: string
  amount: number
  payment_date: string
  payment_method: string
  reference_number?: string
  bank_name?: string | null
  notes?: string
  created_by: string
  created_at: string
  supplier?: Supplier
}

// Notification
export interface Notification {
  id: string
  // null user_id / branch_id = broadcast
  user_id?: string | null
  branch_id?: string | null
  type: string
  title: string
  message: string
  priority?: string | null
  reference_type?: string | null
  reference_id?: string | null
  is_read?: boolean | null
  read_at?: string | null
  expires_at?: string | null
  created_at: string
}

/** @deprecated there is no `payments` table: this is a supplier_payments row (use SupplierPayment) */
export type Payment = SupplierPayment
