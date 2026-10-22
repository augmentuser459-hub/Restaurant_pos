import { supabase, fixEncodingInData } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import type { OrderStatus } from '../types/database.types'

// Statuses an order has while the kitchen still has to work on it.
export const KITCHEN_STATUSES: OrderStatus[] = ['paid', 'in_kitchen', 'preparing']

export type KitchenNextStatus = 'in_kitchen' | 'preparing' | 'ready'

interface KitchenLineItem {
  id: string
  name_ar: string
  code: string
  category_id: string | null
}

export interface KitchenOrderItem {
  id: string
  order_id: string
  quantity: number
  notes: string | null
  item: KitchenLineItem | null
  menu_item: KitchenLineItem | null
}

export interface KitchenOrder {
  id: string
  order_number: string
  branch_id: string
  status: OrderStatus
  notes: string | null
  created_at: string
  updated_at: string
  items: KitchenOrderItem[]
}

// The client has no generated database types (embedded many-to-one rows are typed as arrays), so the
// rows below are cast to KitchenOrder: item / menu_item really come back as single objects or null.
const ORDER_SELECT = `
  id, order_number, branch_id, status, notes, created_at, updated_at,
  items:order_items(
    id, order_id, quantity, notes,
    item:items(id, name_ar, code, category_id),
    menu_item:menu_items(id, name_ar, code, category_id)
  )
`

export const kitchenService = {
  // IDs of the categories marked 'مطبخ' (categories.is_kitchen)
  async getKitchenCategoryIds() {
    try {
      const rows = await fetchAll<{ id: string }>((from, to) =>
        supabase.from('categories').select('id').eq('is_kitchen', true).order('id').range(from, to))
      return { data: rows.map(c => c.id), error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  // Every order of the branch that is still in the kitchen and was created since windowStart (newest first)
  async getActiveOrders(branchId: string, windowStart: string) {
    try {
      const rows = await fetchAll((from, to) =>
        supabase
          .from('orders')
          .select(ORDER_SELECT)
          .eq('branch_id', branchId)
          .in('status', KITCHEN_STATUSES)
          .gte('created_at', windowStart)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to))
      return { data: fixEncodingInData(rows) as unknown as KitchenOrder[], error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  // Orders of the branch (any status) changed since changedSince, so the screen can add, update or drop them
  async getOrdersChangedSince(branchId: string, changedSince: string, windowStart: string) {
    try {
      const rows = await fetchAll((from, to) =>
        supabase
          .from('orders')
          .select(ORDER_SELECT)
          .eq('branch_id', branchId)
          .gte('updated_at', changedSince)
          .gte('created_at', windowStart)
          .order('updated_at')
          .order('id')
          .range(from, to))
      return { data: fixEncodingInData(rows) as unknown as KitchenOrder[], error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  // Orders in a kitchen status with no kitchen line never show on this screen: mark them delivered
  // (status only, stock is not touched). Returns how many were moved.
  async releaseNonKitchenOrders(branchId: string) {
    const { data, error } = await supabase.rpc('kitchen_release_non_kitchen_orders', { p_branch_id: branchId })
    return { data: (data as number | null) ?? 0, error }
  },

  // Moves an order to the next kitchen status (checked and row-locked in the database; stock is not touched)
  async setOrderStatus(orderId: string, status: KitchenNextStatus) {
    const { error } = await supabase.rpc('kitchen_set_order_status', {
      p_order_id: orderId,
      p_status: status,
    })
    return { error }
  },
}
