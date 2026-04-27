import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { inventoryService } from '../../services/inventory.service'
import { Item } from '../../types/database.types'
import { formatCurrency } from '../../lib/utils'
import { Plus, Edit, Trash2, Package, Search } from 'lucide-react'

export default function ItemList() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  useEffect(() => {
    fetchItems()
  }, [])

  const fetchItems = async () => {
    const { data } = await inventoryService.getAllItems()
    setItems(data || [])
    setLoading(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا الصنف؟')) return
    
    setDeleteId(id)
    const { error } = await inventoryService.deleteItem(id)
    if (!error) {
      setItems(items.filter(i => i.id !== id))
    }
    setDeleteId(null)
  }

  const filteredItems = items.filter(item =>
    item.name_ar.includes(search) ||
    item.name.toLowerCase().includes(search.toLowerCase()) ||
    item.code.toLowerCase().includes(search.toLowerCase())
  )

  const getStatusBadge = (status: string) => {
    const styles = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
    }
    const labels = {
      active: 'نشط',
      inactive: 'غير نشط',
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status as keyof typeof styles]}`}>
        {labels[status as keyof typeof labels]}
      </span>
    )
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">الأصناف</h1>
          <p className="text-gray-600">إدارة أصناف المخزون</p>
        </div>
        <Link
          to="/inventory/items/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          صنف جديد
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث بالاسم أو الكود..."
          className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Items Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الصنف</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الوحدة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">سعر الشراء</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">سعر البيع</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الحد الأدنى</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الحالة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredItems.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                        <Package className="w-5 h-5 text-purple-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{item.name_ar}</p>
                        <p className="text-sm text-gray-500">{item.code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {typeof item.unit === 'object' && item.unit?.name_ar ? item.unit.name_ar : item.unit}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {item.purchase_price ? formatCurrency(item.purchase_price) : '-'}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {item.selling_price ? formatCurrency(item.selling_price) : '-'}
                  </td>
                  <td className="px-6 py-4 text-gray-600">{item.min_stock_level}</td>
                  <td className="px-6 py-4">{getStatusBadge(item.status)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/inventory/items/${item.id}/edit`}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="تعديل"
                      >
                        <Edit className="w-4 h-4" />
                      </Link>
                      <button
                        onClick={() => handleDelete(item.id)}
                        disabled={deleteId === item.id}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredItems.length === 0 && (
          <div className="text-center py-12">
            <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">لا توجد أصناف</h3>
            <p className="text-gray-600 mb-4">ابدأ بإضافة صنف جديد</p>
            <Link
              to="/inventory/items/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              إضافة صنف
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
