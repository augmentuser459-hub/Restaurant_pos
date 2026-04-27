import { supabase, fixEncodingInData } from '../lib/supabase'
import { Order, OrderItem, OrderStatus, OrderPaymentMethod, MenuItem } from '../types/database.types'

export interface CreateOrderData {
  branch_id: string
  cashier_id: string
  items: {
    item_id: string
    quantity: number
    unit_price: number
    notes?: string
  }[]
  notes?: string
}

export interface OrderItemWithMenu extends OrderItem {
  menu_item?: { id: string; name_ar: string; code: string }
}

export interface OrderWithDetails extends Omit<Order, 'branch' | 'cashier' | 'items'> {
  branch?: { id: string; name_ar: string; code: string } | null
  cashier?: { id: string; full_name_ar: string } | null
  items?: OrderItemWithMenu[]
}

export const ordersService = {
  // Get all orders
  async getAll(branchId?: string, status?: OrderStatus) {
    let query = supabase
      .from('orders')
      .select(`
        *,
        branch:branches!orders_branch_id_fkey(id, name_ar, code),
        cashier:users!orders_cashier_id_fkey(id, full_name_ar),
        items:order_items(*, menu_item:menu_items(id, name_ar, code))
      `)
      .order('created_at', { ascending: false })

    if (branchId) {
      query = query.eq('branch_id', branchId)
    }
    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    return { data: fixEncodingInData(data) as OrderWithDetails[], error }
  },

  // Get order by ID
  async getById(id: string) {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        branch:branches!orders_branch_id_fkey(id, name_ar, code),
        cashier:users!orders_cashier_id_fkey(id, full_name_ar),
        items:order_items(*, menu_item:menu_items(id, name_ar, code))
      `)
      .eq('id', id)
      .single()

    return { data: fixEncodingInData(data) as OrderWithDetails, error }
  },

  // Create new order
  async create(orderData: CreateOrderData) {
    const orderNumber = `ORD-${Date.now()}`
    
    // Calculate totals (no tax)
    const subtotal = orderData.items.reduce(
      (sum, item) => sum + item.quantity * item.unit_price, 0
    )
    const totalAmount = subtotal

    // Insert order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        branch_id: orderData.branch_id,
        cashier_id: orderData.cashier_id,
        subtotal,
        tax_amount: 0,
        discount_amount: 0,
        total_amount: totalAmount,
        status: 'new',
        notes: orderData.notes,
      })
      .select()
      .single()

    if (orderError) return { data: null, error: orderError }

    // Insert order items
    const orderItems = orderData.items.map(item => ({
      order_id: order.id,
      menu_item_id: item.item_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.quantity * item.unit_price,
      notes: item.notes,
    }))

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems)

    if (itemsError) return { data: null, error: itemsError }

    return { data: order as Order, error: null }
  },

  // Update order status
  async updateStatus(id: string, status: OrderStatus) {
    const updates: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    }

    if (status === 'paid') {
      updates.paid_at = new Date().toISOString()
    } else if (status === 'delivered') {
      updates.delivered_at = new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    return { data: data as Order, error }
  },

  // Process payment
  async processPayment(id: string, paymentMethod: OrderPaymentMethod) {
    const { data, error } = await supabase
      .from('orders')
      .update({
        payment_method: paymentMethod,
        status: 'paid',
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    return { data: data as Order, error }
  },

  // Cancel order
  async cancel(id: string) {
    const { data, error } = await supabase
      .from('orders')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    return { data: data as Order, error }
  },

  // Get kitchen orders (for kitchen display)
  async getKitchenOrders(branchId: string) {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        items:order_items(
          *,
          menu_item:menu_items(id, name_ar, code),
          item:items(id, name_ar, code)
        )
      `)
      .eq('branch_id', branchId)
      .in('status', ['paid', 'in_kitchen', 'preparing'])
      .order('created_at', { ascending: true })

    return { data: fixEncodingInData(data) as OrderWithDetails[], error }
  },

  // Get menu items for POS
  async getMenuItems() {
    const { data, error } = await supabase
      .from('menu_items')
      .select('*, category:menu_categories(id, name_ar)')
      .eq('is_available', true)
      .order('sort_order')

    return { data: fixEncodingInData(data) as MenuItem[], error }
  },

  // Get menu categories
  async getMenuCategories() {
    const { data, error } = await supabase
      .from('menu_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')

    return { data: fixEncodingInData(data), error }
  },

  // Get today's orders count
  async getTodayOrdersCount(branchId?: string) {
    const today = new Date().toISOString().split('T')[0]
    
    let query = supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', today)

    if (branchId) {
      query = query.eq('branch_id', branchId)
    }

    const { count, error } = await query
    return { count, error }
  },

  // Get orders by shift
  async getByShift(shiftId: string) {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        branch:branches!orders_branch_id_fkey(id, name_ar, code),
        cashier:users!orders_cashier_id_fkey(id, full_name_ar),
        items:order_items(*, menu_item:menu_items(id, name_ar, code))
      `)
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: false })

    return { data: fixEncodingInData(data) as OrderWithDetails[], error }
  },

  // Update order (for admin)
  async updateOrder(id: string, updates: {
    status?: OrderStatus
    payment_method?: OrderPaymentMethod
    discount_amount?: number
    discount_reason?: string
    notes?: string
    kitchen_notes?: string
  }) {
    const { data, error } = await supabase
      .from('orders')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    return { data: data as Order, error }
  },

  // Update order item
  async updateOrderItem(itemId: string, updates: { quantity?: number; unit_price?: number; notes?: string }) {
    const totalPrice = (updates.quantity || 1) * (updates.unit_price || 0)
    const { data, error } = await supabase
      .from('order_items')
      .update({ ...updates, total_price: totalPrice })
      .eq('id', itemId)
      .select()
      .single()
    return { data, error }
  },

  // Delete order item
  async deleteOrderItem(itemId: string) {
    const { error } = await supabase
      .from('order_items')
      .delete()
      .eq('id', itemId)
    return { error }
  },

  // Add order item
  async addOrderItem(orderId: string, item: { menu_item_id: string; quantity: number; unit_price: number; notes?: string }) {
    const { data, error } = await supabase
      .from('order_items')
      .insert({
        order_id: orderId,
        menu_item_id: item.menu_item_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.quantity * item.unit_price,
        notes: item.notes,
      })
      .select('*, menu_item:menu_items(id, name_ar, code)')
      .single()
    return { data, error }
  },

  // Recalculate order totals (no tax)
  async recalculateOrderTotals(orderId: string) {
    // Get all items for this order
    const { data: items } = await supabase
      .from('order_items')
      .select('total_price')
      .eq('order_id', orderId)
    
    if (!items) return { error: new Error('Failed to get items') }
    
    const subtotal = items.reduce((sum, item) => sum + Number(item.total_price || 0), 0)
    const totalAmount = subtotal

    const { data, error } = await supabase
      .from('orders')
      .update({ subtotal, tax_amount: 0, total_amount: totalAmount, updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .select()
      .single()
    
    return { data, error }
  },

  // Create order with shift (no tax)
  async createWithShift(orderData: CreateOrderData & { shift_id?: string }) {
    const orderNumber = `ORD-${Date.now()}`
    
    const subtotal = orderData.items.reduce(
      (sum, item) => sum + item.quantity * item.unit_price, 0
    )
    const totalAmount = subtotal

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        branch_id: orderData.branch_id,
        cashier_id: orderData.cashier_id,
        shift_id: orderData.shift_id,
        subtotal,
        tax_amount: 0,
        discount_amount: 0,
        total_amount: totalAmount,
        status: 'new',
        notes: orderData.notes,
      })
      .select()
      .single()

    if (orderError) return { data: null, error: orderError }

    // Insert order items with item_id (for inventory deduction)
    const orderItems = orderData.items.map(item => ({
      order_id: order.id,
      item_id: item.item_id, // This will trigger inventory deduction
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.quantity * item.unit_price,
      notes: item.notes,
    }))

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems)

    if (itemsError) return { data: null, error: itemsError }

    return { data: order as Order, error: null }
  },
}
