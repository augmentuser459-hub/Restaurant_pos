import { supabase } from '../lib/supabase'

export interface SalesReportData {
  totalOrders: number
  totalRevenue: number
  averageOrderValue: number
  ordersByStatus: { status: string; count: number }[]
  ordersByPaymentMethod: { method: string; count: number; total: number }[]
  dailySales: { date: string; orders: number; revenue: number }[]
  topItems: { item_id: string; name_ar: string; quantity: number; revenue: number }[]
}

export interface InventoryReportData {
  totalItems: number
  lowStockItems: number
  outOfStockItems: number
  totalValue: number
  itemsByCategory: { category: string; count: number; value: number }[]
  stockMovements: { date: string; in: number; out: number }[]
}

export const reportsService = {
  // Sales Report
  async getSalesReport(startDate: string, endDate: string, branchId?: string) {
    // Get orders in date range
    let ordersQuery = supabase
      .from('orders')
      .select('*')
      .gte('created_at', startDate)
      .lte('created_at', endDate)

    if (branchId) {
      ordersQuery = ordersQuery.eq('branch_id', branchId)
    }

    const { data: orders } = await ordersQuery

    if (!orders) return { data: null, error: new Error('Failed to fetch orders') }

    // Calculate stats
    const totalOrders = orders.length
    const totalRevenue = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0)
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

    // Orders by status
    const statusCounts: Record<string, number> = {}
    orders.forEach(o => {
      statusCounts[o.status] = (statusCounts[o.status] || 0) + 1
    })
    const ordersByStatus = Object.entries(statusCounts).map(([status, count]) => ({ status, count }))

    // Orders by payment method
    const paymentCounts: Record<string, { count: number; total: number }> = {}
    orders.forEach(o => {
      const method = o.payment_method || 'unknown'
      if (!paymentCounts[method]) paymentCounts[method] = { count: 0, total: 0 }
      paymentCounts[method].count++
      paymentCounts[method].total += o.total_amount || 0
    })
    const ordersByPaymentMethod = Object.entries(paymentCounts).map(([method, data]) => ({
      method,
      count: data.count,
      total: data.total,
    }))

    // Daily sales
    const dailyData: Record<string, { orders: number; revenue: number }> = {}
    orders.forEach(o => {
      const date = o.created_at.split('T')[0]
      if (!dailyData[date]) dailyData[date] = { orders: 0, revenue: 0 }
      dailyData[date].orders++
      dailyData[date].revenue += o.total_amount || 0
    })
    const dailySales = Object.entries(dailyData)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Top items
    const orderIds = orders.map(o => o.id)
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('*, item:items(name_ar)')
      .in('order_id', orderIds)

    const itemStats: Record<string, { name_ar: string; quantity: number; revenue: number }> = {}
    orderItems?.forEach(item => {
      if (!itemStats[item.item_id]) {
        itemStats[item.item_id] = { name_ar: item.item?.name_ar || '', quantity: 0, revenue: 0 }
      }
      itemStats[item.item_id].quantity += item.quantity
      itemStats[item.item_id].revenue += item.total_price || 0
    })
    const topItems = Object.entries(itemStats)
      .map(([item_id, data]) => ({ item_id, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)

    const data: SalesReportData = {
      totalOrders,
      totalRevenue,
      averageOrderValue,
      ordersByStatus,
      ordersByPaymentMethod,
      dailySales,
      topItems,
    }

    return { data, error: null }
  },

  // Inventory Report
  async getInventoryReport(branchId?: string) {
    let inventoryQuery = supabase
      .from('inventory')
      .select('*, item:items(*, category:categories(name_ar))')

    if (branchId) {
      inventoryQuery = inventoryQuery.eq('branch_id', branchId)
    }

    const { data: inventory } = await inventoryQuery

    if (!inventory) return { data: null, error: new Error('Failed to fetch inventory') }

    const totalItems = inventory.length
    const lowStockItems = inventory.filter(i => i.quantity < (i.item?.min_stock_level || 10)).length
    const outOfStockItems = inventory.filter(i => i.quantity <= 0).length
    const totalValue = inventory.reduce((sum, i) => sum + (i.quantity * (i.item?.purchase_price || 0)), 0)

    // Items by category
    const categoryStats: Record<string, { count: number; value: number }> = {}
    inventory.forEach(i => {
      const category = i.item?.category?.name_ar || 'غير مصنف'
      if (!categoryStats[category]) categoryStats[category] = { count: 0, value: 0 }
      categoryStats[category].count++
      categoryStats[category].value += i.quantity * (i.item?.purchase_price || 0)
    })
    const itemsByCategory = Object.entries(categoryStats).map(([category, data]) => ({
      category,
      ...data,
    }))

    const data: InventoryReportData = {
      totalItems,
      lowStockItems,
      outOfStockItems,
      totalValue,
      itemsByCategory,
      stockMovements: [],
    }

    return { data, error: null }
  },

  // Supplier Report
  async getSupplierReport(startDate: string, endDate: string) {
    const { data: supplies } = await supabase
      .from('supplies')
      .select('*, supplier:suppliers(name_ar)')
      .gte('supply_date', startDate)
      .lte('supply_date', endDate)

    const { data: payments } = await supabase
      .from('payments')
      .select('*, supplier:suppliers(name_ar)')
      .gte('payment_date', startDate)
      .lte('payment_date', endDate)

    const totalSupplies = supplies?.reduce((sum, s) => sum + (s.total_amount || 0), 0) || 0
    const totalPayments = payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0

    return {
      data: {
        totalSupplies,
        totalPayments,
        suppliesCount: supplies?.length || 0,
        paymentsCount: payments?.length || 0,
        supplies: supplies || [],
        payments: payments || [],
      },
      error: null,
    }
  },
}
