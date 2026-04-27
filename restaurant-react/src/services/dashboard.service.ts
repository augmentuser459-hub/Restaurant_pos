import { supabase, fixEncodingInData } from '../lib/supabase'

export interface DashboardStats {
  totalBranches: number
  totalSuppliers: number
  totalItems: number
  totalOrders: number
  todayOrders: number
  todayRevenue: number
  pendingTransfers: number
  pendingDamages: number
  lowStockItems: number
  pendingPurchaseRequests: number
}

export const dashboardService = {
  async getStats(branchId?: string): Promise<{ data: DashboardStats | null; error: Error | null }> {
    try {
      const today = new Date().toISOString().split('T')[0]

      // Get counts in parallel
      const [
        branchesRes,
        suppliersRes,
        itemsRes,
        ordersRes,
        todayOrdersRes,
        pendingTransfersRes,
        pendingDamagesRes,
        lowStockRes,
        pendingPurchaseRes,
      ] = await Promise.all([
        supabase.from('branches').select('id', { count: 'exact', head: true }),
        supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('items').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        branchId
          ? supabase.from('orders').select('id', { count: 'exact', head: true }).eq('branch_id', branchId)
          : supabase.from('orders').select('id', { count: 'exact', head: true }),
        branchId
          ? supabase.from('orders').select('id, total_amount').eq('branch_id', branchId).gte('created_at', today)
          : supabase.from('orders').select('id, total_amount').gte('created_at', today),
        supabase.from('transfers').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('damages').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('inventory').select('id', { count: 'exact', head: true }).lt('quantity', 10),
        supabase.from('purchase_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ])

      // Calculate today's revenue
      const todayRevenue = todayOrdersRes.data?.reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0

      const stats: DashboardStats = {
        totalBranches: branchesRes.count || 0,
        totalSuppliers: suppliersRes.count || 0,
        totalItems: itemsRes.count || 0,
        totalOrders: ordersRes.count || 0,
        todayOrders: todayOrdersRes.data?.length || 0,
        todayRevenue,
        pendingTransfers: pendingTransfersRes.count || 0,
        pendingDamages: pendingDamagesRes.count || 0,
        lowStockItems: lowStockRes.count || 0,
        pendingPurchaseRequests: pendingPurchaseRes.count || 0,
      }

      return { data: stats, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },

  async getRecentOrders(limit = 5, branchId?: string) {
    let query = supabase
      .from('orders')
      .select('*, branch:branches(name_ar), cashier:users(full_name_ar)')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (branchId) {
      query = query.eq('branch_id', branchId)
    }

    const { data, error } = await query
    return { data: fixEncodingInData(data), error }
  },

  async getLowStockItems(limit = 10) {
    const { data, error } = await supabase
      .from('inventory')
      .select('*, item:items(name_ar, code, unit), branch:branches(name_ar)')
      .lt('quantity', 10)
      .order('quantity', { ascending: true })
      .limit(limit)
    
    return { data: fixEncodingInData(data), error }
  },
}
