import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatNumber, formatCurrency } from '../../lib/utils'
import { ArrowRight, ShoppingCart, Package, Users, AlertTriangle, ArrowLeftRight, Truck } from 'lucide-react'

interface PerformanceData {
  sales: { total: number; count: number; avgOrder: number }
  inventory: { totalItems: number; lowStock: number; outOfStock: number; value: number }
  transfers: { total: number; pending: number; completed: number }
  damages: { total: number; value: number }
  suppliers: { totalSupplies: number; totalPayments: number; balance: number }
  branches: { id: string; name: string; orders: number; revenue: number }[]
}

export default function PerformanceReport() {
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month')

  useEffect(() => {
    fetchReport()
  }, [period])

  const getDateRange = () => {
    const end = new Date()
    const start = new Date()
    if (period === 'week') start.setDate(start.getDate() - 7)
    else if (period === 'month') start.setMonth(start.getMonth() - 1)
    else start.setFullYear(start.getFullYear() - 1)
    return { start: start.toISOString(), end: end.toISOString() }
  }

  const fetchReport = async () => {
    setLoading(true)
    const { start, end } = getDateRange()

    // Sales
    const { data: orders } = await supabase.from('orders').select('total_amount, branch_id').gte('created_at', start).lte('created_at', end)
    const salesTotal = orders?.reduce((sum, o) => sum + (o.total_amount || 0), 0) || 0
    const salesCount = orders?.length || 0

    // Inventory
    const { data: inventory } = await supabase.from('inventory').select('quantity, item:items(purchase_price, min_stock_level)')
    const totalItems = inventory?.length || 0
    const lowStock = inventory?.filter(i => i.quantity < ((i.item as { min_stock_level?: number })?.min_stock_level || 10)).length || 0
    const outOfStock = inventory?.filter(i => i.quantity <= 0).length || 0
    const invValue = inventory?.reduce((sum, i) => sum + (i.quantity * ((i.item as { purchase_price?: number })?.purchase_price || 0)), 0) || 0

    // Transfers
    const { data: transfers } = await supabase.from('transfers').select('status').gte('created_at', start).lte('created_at', end)
    const transfersTotal = transfers?.length || 0
    const transfersPending = transfers?.filter(t => t.status === 'pending').length || 0
    const transfersCompleted = transfers?.filter(t => t.status === 'received').length || 0

    // Damages
    const { data: damages } = await supabase.from('damages').select('estimated_value').gte('created_at', start).lte('created_at', end)
    const damagesTotal = damages?.length || 0
    const damagesValue = damages?.reduce((sum, d) => sum + (d.estimated_value || 0), 0) || 0

    // Suppliers
    const { data: supplies } = await supabase.from('supplies').select('total_amount').gte('supply_date', start.split('T')[0]).lte('supply_date', end.split('T')[0])
    const { data: payments } = await supabase.from('payments').select('amount').gte('payment_date', start.split('T')[0]).lte('payment_date', end.split('T')[0])
    const suppliesTotal = supplies?.reduce((sum, s) => sum + (s.total_amount || 0), 0) || 0
    const paymentsTotal = payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0

    // Branches performance
    const { data: branches } = await supabase.from('branches').select('id, name_ar')
    const branchStats = branches?.map(b => {
      const branchOrders = orders?.filter(o => o.branch_id === b.id) || []
      return {
        id: b.id,
        name: b.name_ar,
        orders: branchOrders.length,
        revenue: branchOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0),
      }
    }) || []

    setData({
      sales: { total: salesTotal, count: salesCount, avgOrder: salesCount > 0 ? salesTotal / salesCount : 0 },
      inventory: { totalItems, lowStock, outOfStock, value: invValue },
      transfers: { total: transfersTotal, pending: transfersPending, completed: transfersCompleted },
      damages: { total: damagesTotal, value: damagesValue },
      suppliers: { totalSupplies: suppliesTotal, totalPayments: paymentsTotal, balance: suppliesTotal - paymentsTotal },
      branches: branchStats,
    })
    setLoading(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-yellow-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/reports" className="p-2 hover:bg-gray-100 rounded-lg"><ArrowRight className="w-5 h-5" /></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">تقرير الأداء</h1>
          <p className="text-gray-600">مؤشرات الأداء الرئيسية</p>
        </div>
        <div className="flex gap-2">
          {(['week', 'month', 'year'] as const).map(p => (
            <button key={p} type="button" onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${period === p ? 'bg-yellow-500 text-white' : 'bg-gray-100 text-gray-700'}`}>
              {p === 'week' ? 'أسبوع' : p === 'month' ? 'شهر' : 'سنة'}
            </button>
          ))}
        </div>
      </div>

      {/* Sales KPIs */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg p-6 text-white">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><ShoppingCart className="w-5 h-5" /> المبيعات</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-blue-100 text-sm">إجمالي المبيعات</p>
            <p className="text-3xl font-bold">{formatCurrency(data?.sales.total || 0)}</p>
          </div>
          <div>
            <p className="text-blue-100 text-sm">عدد الطلبات</p>
            <p className="text-3xl font-bold">{formatNumber(data?.sales.count || 0)}</p>
          </div>
          <div>
            <p className="text-blue-100 text-sm">متوسط قيمة الطلب</p>
            <p className="text-3xl font-bold">{formatCurrency(data?.sales.avgOrder || 0)}</p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Inventory */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <Package className="w-5 h-5 text-purple-600" />
            </div>
            <h3 className="font-semibold">المخزون</h3>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">إجمالي الأصناف</span><span className="font-medium">{data?.inventory.totalItems}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">منخفض المخزون</span><span className="font-medium text-yellow-600">{data?.inventory.lowStock}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">نفذ من المخزون</span><span className="font-medium text-red-600">{data?.inventory.outOfStock}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">قيمة المخزون</span><span className="font-medium text-green-600">{formatCurrency(data?.inventory.value || 0)}</span></div>
          </div>
        </div>

        {/* Transfers */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <ArrowLeftRight className="w-5 h-5 text-indigo-600" />
            </div>
            <h3 className="font-semibold">التحويلات</h3>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">إجمالي التحويلات</span><span className="font-medium">{data?.transfers.total}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">معلقة</span><span className="font-medium text-yellow-600">{data?.transfers.pending}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">مكتملة</span><span className="font-medium text-green-600">{data?.transfers.completed}</span></div>
          </div>
        </div>

        {/* Damages */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <h3 className="font-semibold">التالف</h3>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">عدد السجلات</span><span className="font-medium">{data?.damages.total}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">إجمالي الخسائر</span><span className="font-medium text-red-600">{formatCurrency(data?.damages.value || 0)}</span></div>
          </div>
        </div>

        {/* Suppliers */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <Truck className="w-5 h-5 text-green-600" />
            </div>
            <h3 className="font-semibold">الموردين</h3>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">التوريدات</span><span className="font-medium text-blue-600">{formatCurrency(data?.suppliers.totalSupplies || 0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">المدفوعات</span><span className="font-medium text-green-600">{formatCurrency(data?.suppliers.totalPayments || 0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">الرصيد</span><span className={`font-medium ${(data?.suppliers.balance || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(data?.suppliers.balance || 0)}</span></div>
          </div>
        </div>
      </div>

      {/* Branches Performance */}
      {data?.branches && data.branches.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2"><Users className="w-5 h-5" /> أداء الفروع</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-yellow-500 text-white">
                <tr>
                  <th className="px-4 py-3 text-right text-sm font-medium">الفرع</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">عدد الطلبات</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">الإيرادات</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">النسبة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.branches.map((b, i) => (
                  <tr key={b.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 font-medium">{b.name}</td>
                    <td className="px-4 py-3">{formatNumber(b.orders)}</td>
                    <td className="px-4 py-3 text-green-600">{formatCurrency(b.revenue)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-yellow-500 rounded-full" style={{ width: `${data.sales.total > 0 ? (b.revenue / data.sales.total) * 100 : 0}%` }} />
                        </div>
                        <span className="text-sm text-gray-500">{data.sales.total > 0 ? ((b.revenue / data.sales.total) * 100).toFixed(1) : 0}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
