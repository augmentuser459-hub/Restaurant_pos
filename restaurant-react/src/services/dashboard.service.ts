import { supabase } from '../lib/supabase'

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
  // All counters are computed in the database (report_dashboard_stats): today = the Cairo calendar day,
  // revenue = paid, not cancelled orders, low stock = below the branch/item minimum. Roles that work in a
  // single branch always get their own branch.
  async getStats(branchId?: string): Promise<{ data: DashboardStats | null; error: unknown }> {
    const { data, error } = await supabase.rpc('report_dashboard_stats', { p_branch_id: branchId ?? null })
    return { data: error ? null : (data as DashboardStats), error }
  },
}
