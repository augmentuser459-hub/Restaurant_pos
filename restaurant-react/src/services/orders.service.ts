import { supabase, fixEncodingInData } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { localDayStartISO, localDayEndExclusiveISO } from '../lib/dates'
import { Order, OrderItem, OrderStatus, OrderPaymentMethod } from '../types/database.types'

// Sales are written only through database functions (020_pos.sql): pos_checkout for the till, order_* for
// admin edits. They keep stock, totals and shift totals consistent in one transaction.

/** An item the cashier may sell, at the server price (pos_sellable_items). */
export interface PosSellableItem {
  item_id: string
  code: string
  barcode: string | null
  name: string
  name_ar: string
  category_id: string | null
  is_recipe: boolean
  image_url: string | null
  unit_cost: number | null
  price: number
  /** false = the branch has no stock row for it: sold without stock tracking */
  has_stock_row: boolean
  stock_quantity: number
  in_stock: boolean
  display_order: number
  is_managed: boolean
}

export interface CashierCategory {
  id: string
  code: string
  name: string
  name_ar: string
  sort_order: number
}

export interface CashierCategories {
  /** true = the cashier may only sell from `categories` */
  restricted: boolean
  categories: CashierCategory[]
}

export interface CheckoutLine {
  item_id: string
  quantity: number
  notes?: string
}

export interface CheckoutInput {
  shiftId: string
  items: CheckoutLine[]
  paymentMethod: OrderPaymentMethod
  /** cash only: what the customer handed over (default: the exact total) */
  paidAmount?: number | null
  /** same key for retries of the same checkout, so it is never sold twice */
  clientRequestId: string
  /** the total the cashier's screen showed; the server refuses if its prices differ */
  expectedTotal: number
  notes?: string
}

/** The saved order as returned by pos_checkout / order_* functions. */
export interface OrderSummary {
  id: string
  order_number: string
  status: OrderStatus
  branch_id: string
  shift_id: string | null
  subtotal: number
  discount_amount: number
  total_amount: number
  payment_method: OrderPaymentMethod | null
  paid_amount: number | null
  change_amount: number | null
  created_at: string
  paid_at: string | null
  /** true = this checkout had already been saved (a retry); no second sale was made */
  duplicate: boolean
  items: {
    id: string
    item_id: string | null
    name_ar: string | null
    quantity: number
    unit_price: number
    total_price: number
    notes: string | null
  }[]
}

export interface OrderItemWithMenu extends Omit<OrderItem, 'item' | 'notes'> {
  notes?: string | null
  stock_deducted_qty?: number | null
  item?: { id: string; name_ar: string; code: string } | null
  menu_item?: { id: string; name_ar: string; code: string } | null
}

export interface OrderWithDetails extends Omit<Order,
  'branch' | 'cashier' | 'items' | 'notes' | 'kitchen_notes' | 'discount_reason' | 'cancellation_reason' | 'payment_method' | 'paid_at'> {
  branch?: { id: string; name_ar: string; code: string } | null
  cashier?: { id: string; full_name_ar: string } | null
  items?: OrderItemWithMenu[]
  payment_method?: OrderPaymentMethod | null
  paid_at?: string | null
  notes?: string | null
  kitchen_notes?: string | null
  discount_reason?: string | null
  cancellation_reason?: string | null
  paid_amount?: number | null
  change_amount?: number | null
  stock_deducted_at?: string | null
}

export interface OrderListFilters {
  branchId?: string
  status?: OrderStatus
  paymentMethod?: OrderPaymentMethod
  /** Cairo calendar dates, YYYY-MM-DD, inclusive */
  startDate?: string
  endDate?: string
}

export interface OrderUpdateInput {
  /** null = keep the current status (so a kitchen move made meanwhile is not undone) */
  status: OrderStatus | null
  /** null = keep the current method; unpaid orders must send null (they never get a payment method) */
  payment_method: OrderPaymentMethod | null
  discount_amount: number
  discount_reason?: string
  notes?: string
  kitchen_notes?: string
  cancellation_reason?: string
}

/** A paid order holds money and stock; 'new' / 'pending_payment' orders were never paid. */
export function isPaidOrder(order: { paid_at?: string | null; status: OrderStatus }): boolean {
  return !!order.paid_at && order.status !== 'new' && order.status !== 'pending_payment' && order.status !== 'cancelled'
}

const ORDER_DETAIL_SELECT = `
  *,
  branch:branches!orders_branch_id_fkey(id, name_ar, code),
  cashier:users!orders_cashier_id_fkey(id, full_name_ar),
  items:order_items(*, item:items(id, name_ar, code), menu_item:menu_items(id, name_ar, code))
`

function sortLines(order: OrderWithDetails | null) {
  order?.items?.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
  return order
}

export const ordersService = {
  // One page of orders, newest first, filtered in the database (Cairo dates). `count` is the total match count.
  async getPage(filters: OrderListFilters, page: number, pageSize: number) {
    let query = supabase
      .from('orders')
      .select(`
        id, order_number, branch_id, created_at, paid_at, total_amount, payment_method, status,
        branch:branches!orders_branch_id_fkey(id, name_ar, code)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    if (filters.branchId) query = query.eq('branch_id', filters.branchId)
    if (filters.status) query = query.eq('status', filters.status)
    if (filters.paymentMethod) query = query.eq('payment_method', filters.paymentMethod)
    if (filters.startDate) query = query.gte('created_at', localDayStartISO(filters.startDate))
    if (filters.endDate) query = query.lt('created_at', localDayEndExclusiveISO(filters.endDate))

    const from = page * pageSize
    const { data, error, count } = await query.range(from, from + pageSize - 1)
    return { data: (fixEncodingInData(data ?? []) as unknown as OrderWithDetails[]), count: count ?? 0, error }
  },

  // Get order by ID (with its lines, in the order they were rung up)
  async getById(id: string) {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_DETAIL_SELECT)
      .eq('id', id)
      .maybeSingle()

    return { data: sortLines(fixEncodingInData(data) as OrderWithDetails | null), error }
  },

  // The whole sale in one database transaction: order, lines, stock, order number.
  async checkout(input: CheckoutInput) {
    const { data, error } = await supabase.rpc('pos_checkout', {
      p_shift_id: input.shiftId,
      p_items: input.items,
      p_payment_method: input.paymentMethod,
      p_paid_amount: input.paidAmount ?? null,
      p_client_request_id: input.clientRequestId,
      p_expected_total: input.expectedTotal,
      p_notes: input.notes ?? null,
    })
    return { data: error ? null : (fixEncodingInData(data) as OrderSummary), error }
  },

  // Items the logged-in user may sell in a branch, with server prices (cashier category limits applied).
  async getSellableItems(branchId: string) {
    try {
      const rows = await fetchAll<PosSellableItem>((from, to) =>
        supabase
          .rpc('pos_sellable_items', { p_branch_id: branchId })
          .order('display_order')
          .order('item_id')
          .range(from, to))
      const items = (fixEncodingInData(rows) as PosSellableItem[]).map(r => ({
        ...r,
        price: Number(r.price) || 0,
        stock_quantity: Number(r.stock_quantity) || 0,
        unit_cost: r.unit_cost === null ? null : Number(r.unit_cost),
      }))
      return { data: items, error: null }
    } catch (error) {
      return { data: [] as PosSellableItem[], error }
    }
  },

  // Categories the logged-in cashier may browse
  async getCashierCategories() {
    const { data, error } = await supabase.rpc('pos_cashier_categories')
    const value = (fixEncodingInData(data) as CashierCategories | null) ?? { restricted: true, categories: [] }
    return { data: value, error }
  },

  // All orders of a shift (no row cap), newest first
  async getByShift(shiftId: string) {
    try {
      const rows = await fetchAll((from, to) =>
        supabase
          .from('orders')
          .select('id, order_number, created_at, paid_at, total_amount, payment_method, status, shift_id')
          .eq('shift_id', shiftId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to))
      return { data: fixEncodingInData(rows) as unknown as OrderWithDetails[], error: null }
    } catch (error) {
      return { data: [] as OrderWithDetails[], error }
    }
  },

  // Admin: status, payment method, discount and notes. Cancelling gives the stock back.
  async updateOrder(id: string, updates: OrderUpdateInput) {
    const { data, error } = await supabase.rpc('order_update', {
      p_order_id: id,
      p_status: updates.status,
      p_payment_method: updates.payment_method,
      p_discount_amount: updates.discount_amount,
      p_discount_reason: updates.discount_reason ?? null,
      p_notes: updates.notes ?? null,
      p_kitchen_notes: updates.kitchen_notes ?? null,
      p_cancellation_reason: updates.cancellation_reason ?? null,
    })
    return { data: error ? null : (data as OrderSummary), error }
  },

  // Admin: change a line's quantity (whole units), price or note
  async updateOrderItem(itemId: string, updates: { quantity: number; unit_price: number; notes?: string | null }) {
    const { data, error } = await supabase.rpc('order_update_item', {
      p_order_item_id: itemId,
      p_quantity: updates.quantity,
      p_unit_price: updates.unit_price,
      p_notes: updates.notes ?? null,
    })
    return { data: error ? null : (data as OrderSummary), error }
  },

  // Admin: remove a line (not the last one)
  async deleteOrderItem(itemId: string) {
    const { data, error } = await supabase.rpc('order_remove_item', { p_order_item_id: itemId })
    return { data: error ? null : (data as OrderSummary), error }
  },

  // Admin: add a line; the price defaults to the branch price
  async addOrderItem(orderId: string, item: { item_id: string; quantity: number; unit_price?: number | null; notes?: string }) {
    const { data, error } = await supabase.rpc('order_add_item', {
      p_order_id: orderId,
      p_item_id: item.item_id,
      p_quantity: item.quantity,
      p_notes: item.notes ?? null,
      p_unit_price: item.unit_price ?? null,
    })
    return { data: error ? null : (data as OrderSummary), error }
  },
}
