import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { purchaseService, PurchaseRequestListItem } from '../../services/purchase.service'
import { suppliersService } from '../../services/suppliers.service'
import { Supplier } from '../../types/database.types'
import { formatNumber, formatQuantity, roundQuantity } from '../../lib/utils'
import { toUserMessage } from '../../lib/errors'
import { Plus, FileText, Filter, AlertCircle } from 'lucide-react'
import { requestStatusConfig } from './requestStatus'

export default function PurchaseRequestList() {
  const [items, setItems] = useState<PurchaseRequestListItem[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedSupplier, setSelectedSupplier] = useState<string>('')
  const [dateFilter, setDateFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const [itemsRes, suppliersRes] = await Promise.all([
      purchaseService.getRequestItems(),
      suppliersService.getActive(),
    ])
    const loadError = itemsRes.error || suppliersRes.error
    if (loadError) setError('فشل في تحميل طلبات الشراء: ' + toUserMessage(loadError))
    setItems(itemsRes.data || [])
    setSuppliers(suppliersRes.data || [])
    setLoading(false)
  }

  const filteredItems = items.filter(item => {
    if (selectedSupplier && item.supplier_id !== selectedSupplier) return false
    // request_date is a DATE (YYYY-MM-DD): compare it as is
    if (dateFilter && item.request?.request_date !== dateFilter) return false
    if (statusFilter && item.request?.status !== statusFilter) return false
    return true
  })

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">طلبات الشراء</h1>
          <p className="text-gray-600">قائمة الأصناف المطلوبة للشراء</p>
        </div>
        <Link
          to="/purchase/requests/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          طلب جديد
        </Link>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-5 h-5 text-gray-400" />
          <span className="font-medium text-gray-700">تصفية</span>
        </div>
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">التاريخ</label>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="التاريخ"
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">المورد</label>
            <select
              value={selectedSupplier}
              onChange={(e) => setSelectedSupplier(e.target.value)}
              aria-label="المورد"
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">جميع الموردين</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name_ar}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">حالة الطلب</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="حالة الطلب"
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">جميع الحالات</option>
              {Object.entries(requestStatusConfig).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setDateFilter('')
                setSelectedSupplier('')
                setStatusFilter('')
              }}
              className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              إعادة تعيين
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">إجمالي الأصناف</p>
          <p className="text-2xl font-bold text-gray-900">{formatNumber(filteredItems.length)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">إجمالي الكمية</p>
          <p className="text-2xl font-bold text-blue-600">
            {formatQuantity(roundQuantity(filteredItems.reduce((sum, i) => sum + Number(i.requested_quantity || 0), 0)))}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">عدد الموردين</p>
          <p className="text-2xl font-bold text-green-600">
            {formatNumber(new Set(filteredItems.filter(i => i.supplier_id).map(i => i.supplier_id)).size)}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">عدد الطلبات</p>
          <p className="text-2xl font-bold text-purple-600">
            {formatNumber(new Set(filteredItems.map(i => i.request_id)).size)}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">لا توجد طلبات شراء</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-green-100">
                <tr>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">م</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">التاريخ</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">رقم المستند</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الفرع</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">كود الصنف</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">اسم الصنف</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">اسم الشركة / المورد</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الكمية</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الحالة</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map((item, index) => {
                  const status = item.request?.status ? requestStatusConfig[item.request.status] : undefined
                  return (
                    <tr key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 text-gray-900">{index + 1}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {item.request?.request_date
                          ? new Date(item.request.request_date).toLocaleDateString('ar-EG')
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-900 font-medium">
                        {item.request ? (
                          <Link to={`/purchase/requests/${item.request.id}`} className="text-blue-600 hover:underline">
                            {item.request.request_number}
                          </Link>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{item.request?.branch?.name_ar || '-'}</td>
                      <td className="px-4 py-3 text-gray-600">{item.item?.code || '-'}</td>
                      <td className="px-4 py-3 text-gray-900">{item.item?.name_ar || '-'}</td>
                      <td className="px-4 py-3 text-gray-600">{item.supplier?.name_ar || '-'}</td>
                      <td className="px-4 py-3 text-gray-900 font-medium">
                        {formatQuantity(item.requested_quantity)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${status?.color || 'bg-gray-100 text-gray-700'}`}>
                          {status?.label || item.request?.status || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{item.notes || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
