import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { purchaseService, PurchaseOrderWithDetails } from '../../services/purchase.service'
import { suppliersService } from '../../services/suppliers.service'
import { Supplier } from '../../types/database.types'
import { formatCurrency, formatNumber } from '../../lib/utils'
import { Plus, Eye, FileText, Clock, CheckCircle, Package, Truck } from 'lucide-react'

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'مسودة', color: 'bg-gray-100 text-gray-700', icon: FileText },
  pending: { label: 'قيد الانتظار', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  approved: { label: 'معتمد', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  sent: { label: 'تم الإرسال', color: 'bg-blue-100 text-blue-700', icon: Truck },
  partially_received: { label: 'استلام جزئي', color: 'bg-purple-100 text-purple-700', icon: Package },
  received: { label: 'تم الاستلام', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  cancelled: { label: 'ملغي', color: 'bg-red-100 text-red-700', icon: FileText },
}

export default function PurchaseOrderList() {
  const [orders, setOrders] = useState<PurchaseOrderWithDetails[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSupplier, setSelectedSupplier] = useState<string>('')
  const [selectedStatus, setSelectedStatus] = useState<string>('')

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    fetchOrders()
  }, [selectedSupplier])

  const fetchData = async () => {
    const { data } = await suppliersService.getActive()
    setSuppliers(data || [])
  }

  const fetchOrders = async () => {
    setLoading(true)
    const { data } = await purchaseService.getOrders(selectedSupplier || undefined)
    setOrders(data || [])
    setLoading(false)
  }

  const filteredOrders = selectedStatus
    ? orders.filter(o => o.status === selectedStatus)
    : orders

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
          <h1 className="text-2xl font-bold text-gray-900">أوامر الشراء</h1>
          <p className="text-gray-600">إدارة أوامر الشراء</p>
        </div>
        <Link to="/purchase/orders/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="w-5 h-5" />
          أمر جديد
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">المورد</label>
            <select value={selectedSupplier} onChange={(e) => setSelectedSupplier(e.target.value)}
              aria-label="المورد" className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">جميع الموردين</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">الحالة</label>
            <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}
              aria-label="الحالة" className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">جميع الحالات</option>
              {Object.entries(statusConfig).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">إجمالي الأوامر</p>
          <p className="text-2xl font-bold text-gray-900">{formatNumber(orders.length)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">قيد الانتظار</p>
          <p className="text-2xl font-bold text-yellow-600">{formatNumber(orders.filter(o => o.status === 'pending').length)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">تم الاستلام</p>
          <p className="text-2xl font-bold text-green-600">{formatNumber(orders.filter(o => o.status === 'received').length)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">إجمالي القيمة</p>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(orders.reduce((sum, o) => sum + (o.total_amount || 0), 0))}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {filteredOrders.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">لا توجد أوامر شراء</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">رقم الأمر</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">المورد</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">الفرع</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">التاريخ</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">القيمة</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">حالة الدفع</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">الحالة</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredOrders.map(order => {
                  const status = statusConfig[order.status] || statusConfig.pending
                  const StatusIcon = status.icon
                  return (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{order.order_number}</td>
                      <td className="px-4 py-3 text-gray-600">{order.supplier?.name_ar}</td>
                      <td className="px-4 py-3 text-gray-600">{order.branch?.name_ar}</td>
                      <td className="px-4 py-3 text-gray-600">{new Date(order.order_date).toLocaleDateString('ar-EG')}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(order.total_amount)}</td>
                      <td className="px-4 py-3">
                        {order.payment_type === 'cash' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            كاش
                          </span>
                        ) : (
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                            order.payment_status === 'paid' ? 'bg-green-100 text-green-700' :
                            order.payment_status === 'partial' ? 'bg-blue-100 text-blue-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {order.payment_status === 'paid' ? 'مدفوع' :
                             order.payment_status === 'partial' ? 'جزئي' : 'آجل'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/purchase/orders/${order.id}`}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg inline-flex" title="عرض">
                          <Eye className="w-4 h-4" />
                        </Link>
                      </td>
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
