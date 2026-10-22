import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { reportsService, PerformanceData, monthsAgoLocal } from '../../services/reports.service'
import { formatNumber, formatCurrency } from '../../lib/utils'
import { addDays, todayLocal } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { ArrowRight, ShoppingCart, Package, Users, AlertTriangle, ArrowLeftRight, Truck, AlertCircle } from 'lucide-react'

export default function PerformanceReport() {
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month')
  const requestId = useRef(0)

  useEffect(() => {
    fetchReport()
  }, [period])

  // Cairo calendar days, today included
  const getDateRange = () => {
    const end = todayLocal()
    if (period === 'week') return { start: addDays(end, -7), end }
    if (period === 'month') return { start: monthsAgoLocal(1), end }
    return { start: monthsAgoLocal(12), end }
  }

  const fetchReport = async () => {
    const id = ++requestId.current
    setLoading(true)
    setError('')
    const { start, end } = getDateRange()
    try {
      // Every figure is aggregated in the database: revenue = paid, not cancelled orders; damages value =
      // approved records; suppliers = the same ledger as the supplier statement.
      const { data, error } = await reportsService.getPerformanceReport(start, end)
      if (id !== requestId.current) return
      if (error) {
        setData(null)
        setError(toUserMessage(error))
      } else {
        setData(data)
      }
    } catch (err) {
      if (id !== requestId.current) return
      setData(null)
      setError(toUserMessage(err))
    }
    setLoading(false)
  }

  const share = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0)

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
            <button key={p} type="button" onClick={() => setPeriod(p)} disabled={loading && period === p}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${period === p ? 'bg-yellow-500 text-white' : 'bg-gray-100 text-gray-700'}`}>
              {p === 'week' ? 'أسبوع' : p === 'month' ? 'شهر' : 'سنة'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-yellow-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      ) : (
        <>
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
                <div className="flex justify-between"><span className="text-gray-500">إجمالي الأصناف</span><span className="font-medium">{formatNumber(data?.inventory.totalItems || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">منخفض المخزون</span><span className="font-medium text-yellow-600">{formatNumber(data?.inventory.lowStock || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">نفذ من المخزون</span><span className="font-medium text-red-600">{formatNumber(data?.inventory.outOfStock || 0)}</span></div>
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
                <div className="flex justify-between"><span className="text-gray-500">إجمالي التحويلات</span><span className="font-medium">{formatNumber(data?.transfers.total || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">معلقة</span><span className="font-medium text-yellow-600">{formatNumber(data?.transfers.pending || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">مكتملة</span><span className="font-medium text-green-600">{formatNumber(data?.transfers.completed || 0)}</span></div>
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
                <div className="flex justify-between"><span className="text-gray-500">عدد السجلات</span><span className="font-medium">{formatNumber(data?.damages.total || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">إجمالي الخسائر (المعتمد)</span><span className="font-medium text-red-600">{formatCurrency(data?.damages.value || 0)}</span></div>
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
                <div className="flex justify-between"><span className="text-gray-500">المشتريات الآجلة</span><span className="font-medium text-blue-600">{formatCurrency(data?.suppliers.totalSupplies || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">المدفوعات</span><span className="font-medium text-green-600">{formatCurrency(data?.suppliers.totalPayments || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">الرصيد المستحق</span><span className={`font-medium ${(data?.suppliers.balance || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(data?.suppliers.balance || 0)}</span></div>
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
                              <div className="h-full bg-yellow-500 rounded-full" style={{ width: `${share(b.revenue, data.sales.total)}%` }} />
                            </div>
                            <span className="text-sm text-gray-500">{share(b.revenue, data.sales.total).toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
