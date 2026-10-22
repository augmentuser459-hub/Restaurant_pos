import { useEffect, useRef, useState } from 'react'
import { reportsService, SalesReportData, dateRangeError } from '../../services/reports.service'
import { branchesService } from '../../services/branches.service'
import { Branch } from '../../types/database.types'
import { formatCurrency, formatNumber, formatQuantity } from '../../lib/utils'
import { addDays, todayLocal } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { useDebouncedValue } from './useDebouncedValue'
import { ShoppingCart, DollarSign, TrendingUp, ArrowRight, AlertCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function SalesReport() {
  const [data, setData] = useState<SalesReportData | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchesError, setBranchesError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [startDate, setStartDate] = useState(() => addDays(todayLocal(), -30))
  const [endDate, setEndDate] = useState(() => todayLocal())
  const requestId = useRef(0)
  // Query only once the filters stop changing (typing a date fires onChange per digit)
  const filterKey = useDebouncedValue(`${startDate}|${endDate}|${selectedBranch}`)

  useEffect(() => {
    fetchBranches()
  }, [])

  useEffect(() => {
    const [from, to, branchId] = filterKey.split('|')
    const id = ++requestId.current
    const rangeError = dateRangeError(from, to)
    if (rangeError) {
      setData(null)
      setError(rangeError)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    reportsService.getSalesReport(from, to, branchId || undefined)
      .then(({ data, error }) => {
        if (id !== requestId.current) return // a newer filter is already loading
        if (error) {
          setData(null)
          setError(toUserMessage(error))
        } else {
          setData(data)
        }
      })
      .catch(err => {
        if (id !== requestId.current) return
        setData(null)
        setError(toUserMessage(err))
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false)
      })
  }, [filterKey])

  const fetchBranches = async () => {
    const { data, error } = await branchesService.getActive()
    if (error) setBranchesError(toUserMessage(error))
    setBranches(data || [])
  }

  const paymentMethodLabels: Record<string, string> = {
    cash: 'نقدي',
    visa: 'فيزا',
    instapay: 'انستاباي',
    wallet: 'محفظة',
    unknown: 'غير محدد',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/reports" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowRight className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">تقرير المبيعات</h1>
          <p className="text-gray-600">تحليل المبيعات والإيرادات</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">من تاريخ</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="من تاريخ"
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="إلى تاريخ"
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">الفرع</label>
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              aria-label="الفرع"
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">جميع الفروع</option>
              {branches.map(branch => (
                <option key={branch.id} value={branch.id}>{branch.name_ar}</option>
              ))}
            </select>
            {branchesError && <p className="text-xs text-red-600 mt-1">{branchesError}</p>}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 mb-1">إجمالي الطلبات</p>
                  <p className="text-2xl font-bold text-gray-900">{formatNumber(data?.totalOrders || 0)}</p>
                </div>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <ShoppingCart className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 mb-1">إجمالي الإيرادات</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(data?.totalRevenue || 0)}</p>
                </div>
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-green-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 mb-1">متوسط قيمة الطلب</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(data?.averageOrderValue || 0)}</p>
                </div>
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-purple-600" />
                </div>
              </div>
            </div>
          </div>

          {/* Orders left out of the revenue */}
          {((data?.cancelledOrders.count || 0) > 0 || (data?.unpaidOrders.count || 0) > 0) && (
            <p className="text-sm text-gray-500">
              لا تشمل الإيرادات:
              {(data?.cancelledOrders.count || 0) > 0 && ` ${formatNumber(data!.cancelledOrders.count)} طلب ملغي (${formatCurrency(data!.cancelledOrders.total)})`}
              {(data?.cancelledOrders.count || 0) > 0 && (data?.unpaidOrders.count || 0) > 0 && ' و'}
              {(data?.unpaidOrders.count || 0) > 0 && ` ${formatNumber(data!.unpaidOrders.count)} طلب غير مدفوع (${formatCurrency(data!.unpaidOrders.total)})`}
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Payment Methods */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">طرق الدفع</h3>
              <div className="space-y-3">
                {data?.ordersByPaymentMethod.map(item => (
                  <div key={item.method} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="font-medium text-gray-900">{paymentMethodLabels[item.method] || item.method}</span>
                    <div className="text-left">
                      <p className="font-bold text-gray-900">{formatCurrency(item.total)}</p>
                      <p className="text-sm text-gray-500">{formatNumber(item.count)} طلب</p>
                    </div>
                  </div>
                ))}
                {data?.ordersByPaymentMethod.length === 0 && (
                  <p className="text-gray-500 text-center py-4">لا توجد مبيعات في هذه الفترة</p>
                )}
              </div>
            </div>

            {/* Top Items */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">الأصناف الأكثر مبيعاً</h3>
              <div className="space-y-3">
                {data?.topItems.slice(0, 5).map((item, index) => (
                  <div key={item.item_id || index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-sm">
                        {index + 1}
                      </span>
                      <span className="font-medium text-gray-900">{item.name_ar}</span>
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-gray-900">{formatCurrency(item.revenue)}</p>
                      <p className="text-sm text-gray-500">{formatQuantity(item.quantity)} وحدة</p>
                    </div>
                  </div>
                ))}
                {data?.topItems.length === 0 && (
                  <p className="text-gray-500 text-center py-4">لا توجد مبيعات في هذه الفترة</p>
                )}
              </div>
            </div>
          </div>

          {/* Daily Sales */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">المبيعات اليومية</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">التاريخ</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">عدد الطلبات</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">الإيرادات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data?.dailySales.map(day => (
                    <tr key={day.date} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">{day.date}</td>
                      <td className="px-4 py-3 text-gray-600">{formatNumber(day.orders)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(day.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
