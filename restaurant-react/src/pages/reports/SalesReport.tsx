import { useEffect, useState } from 'react'
import { reportsService, SalesReportData } from '../../services/reports.service'
import { branchesService } from '../../services/branches.service'
import { Branch } from '../../types/database.types'
import { formatCurrency, formatNumber } from '../../lib/utils'
import { ShoppingCart, DollarSign, TrendingUp, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function SalesReport() {
  const [data, setData] = useState<SalesReportData | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 30)
    return date.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => {
    fetchBranches()
  }, [])

  useEffect(() => {
    fetchReport()
  }, [startDate, endDate, selectedBranch])

  const fetchBranches = async () => {
    const { data } = await branchesService.getActive()
    setBranches(data || [])
  }

  const fetchReport = async () => {
    setLoading(true)
    const { data } = await reportsService.getSalesReport(startDate, endDate, selectedBranch || undefined)
    setData(data)
    setLoading(false)
  }

  const paymentMethodLabels: Record<string, string> = {
    cash: 'نقدي',
    visa: 'فيزا',
    instapay: 'انستاباي',
    wallet: 'محفظة',
    unknown: 'غير محدد',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
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
          </div>
        </div>
      </div>

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
                  <p className="text-sm text-gray-500">{item.count} طلب</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Items */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">الأصناف الأكثر مبيعاً</h3>
          <div className="space-y-3">
            {data?.topItems.slice(0, 5).map((item, index) => (
              <div key={item.item_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-sm">
                    {index + 1}
                  </span>
                  <span className="font-medium text-gray-900">{item.name_ar}</span>
                </div>
                <div className="text-left">
                  <p className="font-bold text-gray-900">{formatCurrency(item.revenue)}</p>
                  <p className="text-sm text-gray-500">{item.quantity} وحدة</p>
                </div>
              </div>
            ))}
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
                  <td className="px-4 py-3 text-gray-600">{day.orders}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(day.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
