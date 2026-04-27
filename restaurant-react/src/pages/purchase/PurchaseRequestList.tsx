import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { purchaseService } from '../../services/purchase.service'
import { branchesService } from '../../services/branches.service'
import { suppliersService } from '../../services/suppliers.service'
import { Branch, Supplier } from '../../types/database.types'
import { formatNumber } from '../../lib/utils'
import { Plus, FileText, Filter } from 'lucide-react'

interface RequestItem {
  id: string
  request_id: string
  item_id: string
  supplier_id: string | null
  requested_quantity: number
  notes: string | null
  created_at: string
  request: {
    id: string
    request_number: string
    request_date: string
  }
  item: {
    id: string
    code: string
    name_ar: string
  }
  supplier: {
    id: string
    name_ar: string
  } | null
}

export default function PurchaseRequestList() {
  const [items, setItems] = useState<RequestItem[]>([])
  const [_branches, setBranches] = useState<Branch[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSupplier, setSelectedSupplier] = useState<string>('')
  const [dateFilter, setDateFilter] = useState<string>('')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const [itemsRes, branchesRes, suppliersRes] = await Promise.all([
      purchaseService.getRequestItems(),
      branchesService.getActive(),
      suppliersService.getActive(),
    ])
    setItems((itemsRes.data as RequestItem[]) || [])
    setBranches(branchesRes.data || [])
    setSuppliers(suppliersRes.data || [])
    setLoading(false)
  }

  const filteredItems = items.filter(item => {
    if (selectedSupplier && item.supplier_id !== selectedSupplier) return false
    if (dateFilter && item.request?.request_date) {
      const itemDate = new Date(item.request.request_date).toISOString().split('T')[0]
      if (itemDate !== dateFilter) return false
    }
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
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setDateFilter('')
                setSelectedSupplier('')
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
            {formatNumber(filteredItems.reduce((sum, i) => sum + (i.requested_quantity || 0), 0))}
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
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">كود الصنف</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">اسم الصنف</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">اسم الشركة / المورد</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الكمية</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map((item, index) => (
                  <tr key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 text-gray-900">{index + 1}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.request?.request_date
                        ? new Date(item.request.request_date).toLocaleDateString('ar-EG')
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-900 font-medium">
                      {item.request?.request_number || '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{item.item?.code || '-'}</td>
                    <td className="px-4 py-3 text-gray-900">{item.item?.name_ar || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{item.supplier?.name_ar || '-'}</td>
                    <td className="px-4 py-3 text-gray-900 font-medium">
                      {formatNumber(item.requested_quantity)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-sm">{item.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
