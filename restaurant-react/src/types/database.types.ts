// Database Types for Restaurant Management System

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
export type PurchaseRequestStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'ordered' | 'partially_received' | 'completed' | 'cancelled'
export type UserRole = 'admin' | 'warehouse_manager' | 'branch_supervisor' | 'chef' | 'cashier' | 'purchase_manager'

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

// User
export interface User {
  id: string
  email: string
  full_name: string
  full_name_ar?: string
  phone?: string
  role: UserRole
  branch_id?: string
  status: 'active' | 'inactive' | 'suspended'
  created_at: string
  updated_at: string
  branch?: Branch
}

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
  unit: string
  unit_id?: string
  category_id?: string
  min_stock_level: number
  max_stock_level?: number
  reorder_point?: number
  purchase_price?: number
  selling_price?: number
  status: ItemStatus
  is_menu_item: boolean
  is_recipe?: boolean
  image_url?: string
  created_at: string
  updated_at: string
  category?: Category
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
  created_at: string
  recipe?: Item
  branch?: Branch
}

// Supplier
export interface Supplier {
  id: string
  code: string
  name: string
  name_ar: string
  phone?: string
  email?: string
  address?: string
  contact_person?: string
  payment_terms?: PaymentMethod
  credit_limit?: number
  current_balance: number
  status: SupplierStatus
  notes?: string
  created_at: string
  updated_at: string
}

// Inventory
export interface Inventory {
  id: string
  branch_id: string
  item_id: string
  quantity: number
  min_quantity: number
  max_quantity?: number
  partial_quantity?: number
  content_quantity?: number
  total_quantity?: number
  opening_balance?: number
  incoming_quantity?: number
  consumption_quantity?: number
  last_restock_date?: string
  created_at: string
  updated_at: string
  branch?: Branch
  item?: Item
}

// Supply
export interface Supply {
  id: string
  supply_number: string
  supplier_id: string
  branch_id: string
  supply_date: string
  total_amount: number
  paid_amount: number
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  invoice_number?: string
  notes?: string
  created_by: string
  created_at: string
  updated_at: string
  supplier?: Supplier
  branch?: Branch
  items?: SupplyItem[]
}

// Supply Item
export interface SupplyItem {
  id: string
  supply_id: string
  item_id: string
  quantity: number
  received_quantity: number
  unit_price: number
  total_price: number
  expiry_date?: string
  batch_number?: string
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
  transfer_date: string
  status: TransferStatus
  total_items: number
  notes?: string
  requested_by: string
  requested_at: string
  approved_by?: string
  approved_at?: string
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

// Order
export interface Order {
  id: string
  order_number: string
  branch_id: string
  cashier_id: string
  subtotal: number
  tax_amount: number
  discount_amount: number
  total_amount: number
  payment_method?: OrderPaymentMethod
  status: OrderStatus
  notes?: string
  created_at: string
  paid_at?: string
  delivered_at?: string
  updated_at: string
  branch?: Branch
  cashier?: User
  items?: OrderItem[]
}

// Order Item
export interface OrderItem {
  id: string
  order_id: string
  item_id: string
  quantity: number
  unit_price: number
  total_price: number
  notes?: string
  created_at: string
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
  category_id: string
  price: number
  cost?: number
  is_available: boolean
  preparation_time?: number
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
  count_type: 'opening' | 'closing'
  status: 'draft' | 'completed' | 'approved'
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
  payment_type: 'cash' | 'credit'
  paid_amount: number
  remaining_amount: number
  payment_status: 'pending' | 'partial' | 'paid'
  status: string
  expected_delivery_date?: string
  notes?: string
  created_by: string
  created_at: string
  approved_by?: string
  approved_at?: string
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
  supply_id: string
  supplier_id: string
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
  received_at?: string
  created_at: string
  updated_at: string
  supplier?: Supplier
  item?: Item
}

// Payment
export interface Payment {
  id: string
  payment_number: string
  supplier_id: string
  supply_id?: string
  amount: number
  payment_date: string
  payment_method: string
  reference_number?: string
  notes?: string
  created_by: string
  created_at: string
  supplier?: Supplier
}
