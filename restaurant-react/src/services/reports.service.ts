import { supabase } from '../lib/supabase'
import { todayLocal } from '../lib/dates'

// Reports are aggregated in the database (report_* functions in 050_purchasing.sql): no 1000-row cap,
// Cairo calendar days with an inclusive end day, and revenue from paid, not cancelled orders only.
// Dates are passed as YYYY-MM-DD strings.

export interface SalesReportData {
  totalOrders: number
  totalRevenue: number
  averageOrderValue: number
  ordersByStatus: { status: string; count: number }[]
  ordersByPaymentMethod: { method: string; count: number; total: number }[]
  dailySales: { date: string; orders: number; revenue: number }[]
  topItems: { item_id: string; name_ar: string; quantity: number; revenue: number }[]
  cancelledOrders: { count: number; total: number }
  unpaidOrders: { count: number; total: number }
}

export interface InventoryReportData {
  totalItems: number
  lowStockItems: number
  outOfStockItems: number
  totalValue: number
  itemsByCategory: { category: string; count: number; value: number }[]
  stockMovements: { date: string; in: number; out: number }[]
}

export interface PerformanceData {
  sales: { total: number; count: number; avgOrder: number }
  inventory: { totalItems: number; lowStock: number; outOfStock: number; value: number }
  transfers: { total: number; pending: number; completed: number }
  damages: { total: number; value: number }
  suppliers: { totalSupplies: number; totalPayments: number; balance: number }
  branches: { id: string; name: string; orders: number; revenue: number }[]
}

export interface StatementTransaction {
  id: string
  date: string
  kind: string
  type: 'supply' | 'payment' | 'return'
  reference: string
  description: string
  debit: number  // مدين (مشتريات / مديونية)
  credit: number // دائن (مدفوعات / مرتجعات)
  balance: number
}

export interface SupplierStatementData {
  supplier: {
    id: string
    code: string
    name: string
    name_ar: string | null
    phone: string | null
    current_balance: number
    credit_limit: number
    status: string
  }
  openingBalance: number
  transactions: StatementTransaction[]
  totalDebit: number
  totalCredit: number
  closingBalance: number
  // Period totals per kind: opening + purchases + manual debts - payments - returns = closing
  manualDebtTotal: number
  totalPurchases: number // credit purchase orders (net of cancellations) + unpaid part of supplies
  totalPayments: number  // purchase-order payments + supplier payments
  totalReturns: number   // approved supplier returns
}

export interface SuppliersSummaryData {
  totalSupplies: number
  totalSuppliesValue: number
  totalPayments: number
  totalPaymentsValue: number
  totalReturnsValue: number
  totalManualDebts: number
  openingBalance: number
  balance: number
  supplies: {
    id: string
    supply_number: string
    supplier: string
    total_amount: number
    supply_date: string
    kind: string
    description: string
    payment_status: 'paid' | 'partial' | 'pending' | 'cancelled' | null
  }[]
  payments: {
    id: string
    payment_number: string
    supplier: string
    amount: number
    payment_date: string
    payment_method: string
    description: string
  }[]
  bySupplier: {
    supplier_id: string
    supplier: string
    opening: number
    supplies: number
    manual_debts: number
    payments: number
    returns: number
    balance: number
  }[]
}

/** Cairo date n months before today (YYYY-MM-DD), for default report ranges. */
export function monthsAgoLocal(months: number): string {
  const [y, m, d] = todayLocal().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 - months, d)).toISOString().slice(0, 10)
}

/** Returns an Arabic message when a report date range cannot be queried yet (e.g. while a date is being typed). */
export function dateRangeError(from: string, to: string): string | null {
  const valid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2000 && Number(v.slice(0, 4)) <= 2100
  if (!valid(from) || !valid(to)) return 'أدخل تاريخ البداية وتاريخ النهاية بشكل صحيح'
  if (from > to) return 'تاريخ البداية بعد تاريخ النهاية'
  return null
}

export const reportsService = {
  async getSalesReport(startDate: string, endDate: string, branchId?: string) {
    const { data, error } = await supabase.rpc('report_sales', {
      p_from: startDate,
      p_to: endDate,
      p_branch_id: branchId ?? null,
    })
    return { data: error ? null : (data as SalesReportData), error }
  },

  async getInventoryReport(branchId?: string) {
    const { data, error } = await supabase.rpc('report_inventory', { p_branch_id: branchId ?? null })
    return { data: error ? null : (data as InventoryReportData), error }
  },

  async getPerformanceReport(startDate: string, endDate: string) {
    const { data, error } = await supabase.rpc('report_performance', { p_from: startDate, p_to: endDate })
    return { data: error ? null : (data as PerformanceData), error }
  },

  async getSupplierStatement(supplierId: string, startDate: string, endDate: string) {
    const { data, error } = await supabase.rpc('report_supplier_statement', {
      p_supplier_id: supplierId,
      p_from: startDate,
      p_to: endDate,
    })
    return { data: error ? null : (data as SupplierStatementData), error }
  },

  async getSuppliersSummary(startDate: string, endDate: string) {
    const { data, error } = await supabase.rpc('report_suppliers_summary', { p_from: startDate, p_to: endDate })
    return { data: error ? null : (data as SuppliersSummaryData), error }
  },
}
