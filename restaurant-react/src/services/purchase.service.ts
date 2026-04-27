import { supabase, fixEncodingInData } from '../lib/supabase'
import type { PurchaseRequest, PurchaseRequestItem, PurchaseOrder, PurchaseOrderItem } from '../types/database.types'

export interface CreatePurchaseRequestData {
  branch_id: string
  priority?: number
  notes?: string
  requested_by: string
  items: {
    item_id: string
    supplier_id?: string
    requested_quantity: number
    estimated_unit_price?: number
    notes?: string
  }[]
}

export interface PurchaseRequestWithDetails extends Omit<PurchaseRequest, 'branch' | 'items'> {
  branch: { id: string; name_ar: string; code: string }
  items: (PurchaseRequestItem & { 
    item: { id: string; name_ar: string; code: string; unit: string }
    supplier?: { id: string; name_ar: string }
  })[]
}

export interface PurchaseOrderWithDetails extends Omit<PurchaseOrder, 'supplier' | 'branch' | 'items'> {
  supplier: { id: string; name_ar: string; code: string }
  branch: { id: string; name_ar: string; code: string }
  items: (PurchaseOrderItem & { item: { id: string; name_ar: string; code: string; unit: string } })[]
  payment_type?: 'cash' | 'credit'
  paid_amount?: number
  remaining_amount?: number
  payment_status?: 'pending' | 'partial' | 'paid'
}

const purchaseService = {
  async getRequests(branchId?: string) {
    let query = supabase
      .from('purchase_requests')
      .select('*, branch:branches(id, name_ar, code)')
      .order('created_at', { ascending: false })

    if (branchId) {
      query = query.eq('branch_id', branchId)
    }

    const { data, error } = await query
    return { data: fixEncodingInData(data) as PurchaseRequestWithDetails[], error }
  },

  // Get all request items (flat list for the table view)
  async getRequestItems() {
    const { data, error } = await supabase
      .from('purchase_request_items')
      .select(`
        *,
        request:purchase_requests(id, request_number, request_date),
        item:items(id, code, name_ar),
        supplier:suppliers(id, name_ar)
      `)
      .order('created_at', { ascending: false })

    return { data: fixEncodingInData(data), error }
  },

  async getRequestById(id: string) {
    const { data, error } = await supabase
      .from('purchase_requests')
      .select('*, branch:branches(id, name_ar, code), items:purchase_request_items(*, item:items(id, name_ar, code, unit), supplier:suppliers(id, name_ar))')
      .eq('id', id)
      .single()

    return { data: fixEncodingInData(data) as PurchaseRequestWithDetails, error }
  },

  async createRequest(requestData: CreatePurchaseRequestData) {
    const requestNumber = `PR-${Date.now()}`
    const totalQuantity = requestData.items.reduce((sum, item) => sum + item.requested_quantity, 0)
    const estimatedCost = requestData.items.reduce(
      (sum, item) => sum + (item.requested_quantity * (item.estimated_unit_price || 0)), 0
    )

    const { data: request, error: requestError } = await supabase
      .from('purchase_requests')
      .insert({
        request_number: requestNumber,
        request_date: new Date().toISOString(),
        branch_id: requestData.branch_id,
        status: 'pending',
        priority: requestData.priority || 1,
        notes: requestData.notes,
        total_items: requestData.items.length,
        total_quantity: totalQuantity,
        estimated_cost: estimatedCost,
        requested_by: requestData.requested_by,
        requested_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (requestError) return { data: null, error: requestError }

    const requestItems = requestData.items.map(item => ({
      request_id: request.id,
      item_id: item.item_id,
      supplier_id: item.supplier_id,
      requested_quantity: item.requested_quantity,
      estimated_unit_price: item.estimated_unit_price,
      estimated_total: item.requested_quantity * (item.estimated_unit_price || 0),
      notes: item.notes,
    }))

    const { error: itemsError } = await supabase
      .from('purchase_request_items')
      .insert(requestItems)

    if (itemsError) return { data: null, error: itemsError }

    return { data: request as PurchaseRequest, error: null }
  },

  async getOrders(supplierId?: string) {
    let query = supabase
      .from('purchase_orders')
      .select('*, supplier:suppliers(id, name_ar, code), branch:branches(id, name_ar, code)')
      .order('created_at', { ascending: false })

    if (supplierId) {
      query = query.eq('supplier_id', supplierId)
    }

    const { data, error } = await query
    return { data: fixEncodingInData(data) as PurchaseOrderWithDetails[], error }
  },

  async getOrderById(id: string) {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('*, supplier:suppliers(id, name_ar, code), branch:branches(id, name_ar, code), items:purchase_order_items(*, item:items(id, name_ar, code))')
      .eq('id', id)
      .single()

    console.log('getOrderById result:', { data, error })
    return { data: fixEncodingInData(data) as PurchaseOrderWithDetails, error }
  },

  async getPendingRequestsCount() {
    const { count, error } = await supabase
      .from('purchase_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')

    return { count, error }
  },

  async approveOrder(orderId: string, userId: string) {
    const { data, error } = await supabase
      .from('purchase_orders')
      .update({
        status: 'approved',
        approved_by: userId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .select()
      .single()

    return { data, error }
  },

  async rejectOrder(orderId: string, _userId: string, reason: string) {
    const { data, error } = await supabase
      .from('purchase_orders')
      .update({
        status: 'rejected',
        notes: reason, // Store rejection reason in notes
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .select()
      .single()

    return { data, error }
  },

  async receiveOrder(orderId: string, _userId: string) {
    // Update order status - the trigger will handle inventory updates automatically
    const { data, error } = await supabase
      .from('purchase_orders')
      .update({
        status: 'received',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .select()
      .single()

    return { data, error }
  },

  async approveRequest(requestId: string, userId: string) {
    const { data, error } = await supabase
      .from('purchase_requests')
      .update({
        status: 'approved',
        approved_by: userId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single()

    return { data, error }
  },

  async rejectRequest(requestId: string, userId: string, reason: string) {
    const { data, error } = await supabase
      .from('purchase_requests')
      .update({
        status: 'rejected',
        rejected_by: userId,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single()

    return { data, error }
  },
}

export { purchaseService }
