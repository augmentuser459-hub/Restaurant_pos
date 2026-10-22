import { supabase, fixEncodingInData } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import type { PurchaseRequest, PurchaseRequestItem, PurchaseOrder, PurchaseOrderItem, PurchaseOrderPayment } from '../types/database.types'

// Every write goes through a database function (050_purchasing.sql): it checks the role, locks the document,
// checks its status and moves stock / supplier money in the same transaction.

export interface CreatePurchaseRequestData {
  branch_id: string
  priority?: number
  notes?: string
  items: {
    item_id: string
    supplier_id?: string
    requested_quantity: number
    estimated_unit_price?: number
    notes?: string
  }[]
}

export interface CreatePurchaseOrderData {
  supplier_id: string
  branch_id: string
  payment_type: 'cash' | 'credit'
  expected_delivery_date?: string
  notes?: string
  request_id?: string
  items: {
    item_id: string
    quantity: number
    unit_price: number
    notes?: string
    request_item_id?: string
  }[]
}

export interface AddOrderPaymentData {
  amount: number
  payment_method: string
  reference_number?: string
  notes?: string
}

type ItemRef = { id: string; name_ar: string; code: string; unit?: { name_ar: string } | null }
type UserRef = { id: string; full_name: string; full_name_ar?: string | null } | null

export type PurchaseRequestItemWithDetails = Omit<PurchaseRequestItem, 'item' | 'supplier'> & {
  item: ItemRef | null
  supplier?: { id: string; name_ar: string } | null
}

export interface PurchaseRequestWithDetails extends Omit<PurchaseRequest, 'branch' | 'items'> {
  branch: { id: string; name_ar: string; code: string } | null
  requester?: UserRef
  items: PurchaseRequestItemWithDetails[]
}

// One line of the flat request-items list.
export interface PurchaseRequestListItem {
  id: string
  request_id: string
  item_id: string
  supplier_id: string | null
  requested_quantity: number
  notes: string | null
  item_status: string | null
  created_at: string
  request: {
    id: string
    request_number: string
    request_date: string
    status: string
    branch: { name_ar: string } | null
  } | null
  item: { id: string; code: string; name_ar: string } | null
  supplier: { id: string; name_ar: string } | null
}

export interface PurchaseOrderWithDetails extends Omit<PurchaseOrder, 'supplier' | 'branch' | 'items'> {
  supplier: { id: string; name_ar: string; code: string } | null
  branch: { id: string; name_ar: string; code: string } | null
  items: (Omit<PurchaseOrderItem, 'item'> & { item: ItemRef | null })[]
  rejection_reason?: string | null
  rejected_at?: string | null
  cancellation_reason?: string | null
  cancelled_at?: string | null
  received_at?: string | null
}

const ORDER_SELECT = '*, supplier:suppliers(id, name_ar, code), branch:branches(id, name_ar, code)'

const purchaseService = {
  async getRequests(branchId?: string) {
    try {
      const data = await fetchAll((from, to) => {
        let query = supabase
          .from('purchase_requests')
          .select('*, branch:branches(id, name_ar, code)')
          .order('created_at', { ascending: false })
          .order('id')
        if (branchId) query = query.eq('branch_id', branchId)
        return query.range(from, to)
      })
      return { data: fixEncodingInData(data) as PurchaseRequestWithDetails[], error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  // All request lines (flat list for the table view), with the request's status.
  async getRequestItems() {
    try {
      const data = await fetchAll((from, to) =>
        supabase
          .from('purchase_request_items')
          .select(`
            id, request_id, item_id, supplier_id, requested_quantity, notes, item_status, created_at,
            request:purchase_requests(id, request_number, request_date, status, branch:branches(name_ar)),
            item:items(id, code, name_ar),
            supplier:suppliers(id, name_ar)
          `)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to)
      )
      return { data: fixEncodingInData(data) as unknown as PurchaseRequestListItem[], error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  async getRequestById(id: string) {
    const { data, error } = await supabase
      .from('purchase_requests')
      .select(`
        *,
        branch:branches(id, name_ar, code),
        requester:users!purchase_requests_requested_by_fkey(id, full_name, full_name_ar),
        items:purchase_request_items(*, item:items(id, name_ar, code, unit:units(name_ar)), supplier:suppliers(id, name_ar))
      `)
      .eq('id', id)
      .single()

    return { data: fixEncodingInData(data) as PurchaseRequestWithDetails | null, error }
  },

  async createRequest(requestData: CreatePurchaseRequestData) {
    const { data, error } = await supabase.rpc('purchase_create_request', {
      p_branch_id: requestData.branch_id,
      p_priority: requestData.priority ?? 1,
      p_notes: requestData.notes ?? null,
      p_items: requestData.items,
    })
    return { data: data as { id: string; request_number: string } | null, error }
  },

  async approveRequest(requestId: string) {
    const { error } = await supabase.rpc('purchase_approve_request', { p_request_id: requestId })
    return { error }
  },

  async rejectRequest(requestId: string, reason: string) {
    const { error } = await supabase.rpc('purchase_reject_request', { p_request_id: requestId, p_reason: reason })
    return { error }
  },

  async getOrders(supplierId?: string) {
    try {
      const data = await fetchAll((from, to) => {
        let query = supabase
          .from('purchase_orders')
          .select(ORDER_SELECT)
          .order('created_at', { ascending: false })
          .order('id')
        if (supplierId) query = query.eq('supplier_id', supplierId)
        return query.range(from, to)
      })
      return { data: fixEncodingInData(data) as PurchaseOrderWithDetails[], error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  async getOrderById(id: string) {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select(`${ORDER_SELECT}, items:purchase_order_items(*, item:items(id, name_ar, code, unit:units(name_ar)))`)
      .eq('id', id)
      .single()

    const order = fixEncodingInData(data) as PurchaseOrderWithDetails | null
    order?.items?.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    return { data: order, error }
  },

  async getOrderPayments(orderId: string) {
    const { data, error } = await supabase
      .from('purchase_order_payments')
      .select('*')
      .eq('order_id', orderId)
      .order('payment_date', { ascending: false })
      .order('created_at', { ascending: false })
    return { data: (data || []) as PurchaseOrderPayment[], error }
  },

  // Counters for the purchasing dashboard (counted in the database, no row cap).
  async getCounts() {
    const count = (table: 'purchase_orders' | 'purchase_requests', status?: string) => {
      let query = supabase.from(table).select('id', { count: 'exact', head: true })
      if (status) query = query.eq('status', status)
      return query
    }
    const results = await Promise.all([
      count('purchase_orders'),
      count('purchase_orders', 'pending'),
      count('purchase_orders', 'received'),
      count('purchase_requests', 'pending'),
    ])
    const error = results.find(r => r.error)?.error ?? null
    return {
      data: error ? null : {
        totalOrders: results[0].count ?? 0,
        pendingOrders: results[1].count ?? 0,
        receivedOrders: results[2].count ?? 0,
        pendingRequests: results[3].count ?? 0,
      },
      error,
    }
  },

  async createOrder(orderData: CreatePurchaseOrderData) {
    const { data, error } = await supabase.rpc('purchase_create_order', {
      p_supplier_id: orderData.supplier_id,
      p_branch_id: orderData.branch_id,
      p_payment_type: orderData.payment_type,
      p_expected_delivery_date: orderData.expected_delivery_date || null,
      p_notes: orderData.notes ?? null,
      p_items: orderData.items,
      p_request_id: orderData.request_id ?? null,
    })
    return { data: data as { id: string; order_number: string } | null, error }
  },

  async approveOrder(orderId: string) {
    const { error } = await supabase.rpc('purchase_approve_order', { p_order_id: orderId })
    return { error }
  },

  async rejectOrder(orderId: string, reason: string) {
    const { error } = await supabase.rpc('purchase_reject_order', { p_order_id: orderId, p_reason: reason })
    return { error }
  },

  async cancelOrder(orderId: string, reason: string) {
    const { error } = await supabase.rpc('purchase_cancel_order', { p_order_id: orderId, p_reason: reason })
    return { error }
  },

  // lines: quantities received now per order line; omit to receive everything still outstanding.
  async receiveOrder(orderId: string, lines?: { id: string; quantity: number }[]) {
    const { data, error } = await supabase.rpc('purchase_receive_order', {
      p_order_id: orderId,
      p_lines: lines ?? null,
    })
    return { data: data as { status: string } | null, error }
  },

  async addPayment(orderId: string, payment: AddOrderPaymentData) {
    const { data, error } = await supabase.rpc('purchase_add_payment', {
      p_order_id: orderId,
      p_amount: payment.amount,
      p_payment_method: payment.payment_method,
      p_reference_number: payment.reference_number ?? null,
      p_notes: payment.notes ?? null,
    })
    return { data, error }
  },
}

export { purchaseService }
