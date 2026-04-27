import { useEffect, useState } from 'react'
import { reportsService, InventoryReportData } from '../../services/reports.service'
import { branchesService } from '../../services/branches.service'
import { Branch } from '../../types/database.types'
import { formatCurrency, formatNumber } from '../../lib/utils'
import { Package, AlertTriangle, XCircle, DollarSign, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function InventoryReport() {
  const [data, setData] = useState<InventoryReportData | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBranch, setSelectedBranch] = useState<string>('')

  useEffect(() => {
    fetchBranches()
  }, [])

  useEffect(() => {
    fetchReport()
  }, [selectedBranch])

  const fetchBranches = async () => {
    const { data } = await branchesService.getActive()
    setBranches(data || [])
  }

  const fetchReport = async () => {
    setLoading(true)
    const { data } = await reportsService.getInventoryReport(selectedBranch || undefined)
    setData(data)
    setLoading(false)
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
          <h1 className="text-2xl font-bold text-gray-900">تقرير المخزون</h1>
          <p className="text-gray-600">تحليل المخزون والأصناف</p>
        </div>
      </div>


      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap gap-4">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">إجمالي الأصناف</p>
              <p className="text-2xl font-bold text-gray-900">{formatNumber(data?.totalItems || 0)}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Package className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">أصناف منخفضة</p>
              <p className="text-2xl font-bold text-yellow-600">{formatNumber(data?.lowStockItems || 0)}</p>
            </div>
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-yellow-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">نفذت من المخزون</p>
              <p className="text-2xl font-bold text-red-600">{formatNumber(data?.outOfStockItems || 0)}</p>
            </div>
            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
              <XCircle className="w-6 h-6 text-red-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">قيمة المخزون</p>
              <p className="text-2xl font-bold text-green-600">{formatCurrency(data?.totalValue || 0)}</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Items by Category */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">الأصناف حسب التصنيف</h3>
        {data?.itemsByCategory && data.itemsByCategory.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">التصنيف</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">عدد الأصناف</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">القيمة</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">النسبة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.itemsByCategory.map(cat => (
                  <tr key={cat.category} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{cat.category}</td>
                    <td className="px-4 py-3 text-gray-600">{formatNumber(cat.count)}</td>
                    <td className="px-4 py-3 text-gray-900">{formatCurrency(cat.value)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${data.totalValue > 0 ? (cat.value / data.totalValue) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-sm text-gray-500">
                          {data.totalValue > 0 ? ((cat.value / data.totalValue) * 100).toFixed(1) : 0}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">لا توجد بيانات</p>
        )}
      </div>

      {/* Summary */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg p-6 text-white">
        <h3 className="text-lg font-semibold mb-4">ملخص المخزون</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-blue-100 text-sm">نسبة الأصناف المنخفضة</p>
            <p className="text-3xl font-bold">
              {data?.totalItems ? ((data.lowStockItems / data.totalItems) * 100).toFixed(1) : 0}%
            </p>
          </div>
          <div>
            <p className="text-blue-100 text-sm">نسبة الأصناف النافذة</p>
            <p className="text-3xl font-bold">
              {data?.totalItems ? ((data.outOfStockItems / data.totalItems) * 100).toFixed(1) : 0}%
            </p>
          </div>
          <div>
            <p className="text-blue-100 text-sm">متوسط قيمة الصنف</p>
            <p className="text-3xl font-bold">
              {formatCurrency(data?.totalItems ? data.totalValue / data.totalItems : 0)}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
