import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { ordersService, OrderWithDetails } from '../../services/orders.service'
import { supabase } from '../../lib/supabase'
import { formatTime } from '../../lib/utils'
import { ChefHat, Clock, CheckCircle, PlayCircle, Package, Printer } from 'lucide-react'

export default function POSKitchen() {
  const { user } = useAuth()
  const [orders, setOrders] = useState<OrderWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user?.branch_id) {
      fetchOrders()
      setupRealtime()
    }
  }, [user?.branch_id])

  const fetchOrders = async () => {
    if (!user?.branch_id) return
    const { data } = await ordersService.getKitchenOrders(user.branch_id)
    setOrders(data || [])
    setLoading(false)
  }

  const setupRealtime = () => {
    const channel = supabase
      .channel('kitchen-orders')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `branch_id=eq.${user?.branch_id}`,
        },
        () => {
          fetchOrders()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }

  const handleStatusChange = async (orderId: string, newStatus: 'in_kitchen' | 'preparing' | 'ready') => {
    await ordersService.updateStatus(orderId, newStatus)
    fetchOrders()
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-yellow-100 border-yellow-300'
      case 'in_kitchen':
        return 'bg-blue-100 border-blue-300'
      case 'preparing':
        return 'bg-orange-100 border-orange-300'
      case 'ready':
        return 'bg-green-100 border-green-300'
      default:
        return 'bg-gray-100 border-gray-300'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid':
        return 'جديد'
      case 'in_kitchen':
        return 'في المطبخ'
      case 'preparing':
        return 'قيد التحضير'
      case 'ready':
        return 'جاهز'
      default:
        return status
    }
  }

  const getTimeSince = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'الآن'
    if (minutes < 60) return `${minutes} دقيقة`
    const hours = Math.floor(minutes / 60)
    return `${hours} ساعة`
  }

  const handlePrint = (order: OrderWithDetails) => {
    const printWindow = window.open('', '_blank', 'width=400,height=600')
    if (!printWindow) return

    const items = order.items?.map(item => {
      const itemData = item as unknown as { menu_item?: { name_ar: string }, item?: { name_ar: string } }
      const itemName = itemData.item?.name_ar || itemData.menu_item?.name_ar || 'صنف'
      return `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${itemName}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
          ${item.notes ? `<td style="padding: 8px; border-bottom: 1px solid #eee; color: #f97316; font-size: 12px;">${item.notes}</td>` : '<td></td>'}
        </tr>
      `
    }).join('')

    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>طلب ${order.order_number}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; direction: rtl; }
          .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 15px; margin-bottom: 15px; }
          .order-number { font-size: 24px; font-weight: bold; }
          .time { color: #666; margin-top: 5px; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th { background: #f3f4f6; padding: 10px; text-align: right; }
          .footer { text-align: center; margin-top: 20px; padding-top: 15px; border-top: 2px dashed #000; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="order-number">طلب #${order.order_number.split('-').pop()}</div>
          <div class="time">${formatTime(order.created_at)}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>الصنف</th>
              <th>الكمية</th>
              <th>ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            ${items}
          </tbody>
        </table>
        ${order.notes ? `<div style="background: #fef3c7; padding: 10px; border-radius: 5px; margin-top: 10px;"><strong>ملاحظات:</strong> ${order.notes}</div>` : ''}
        <div class="footer">
          <p>شكراً لكم</p>
        </div>
        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `)
    printWindow.document.close()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
            <ChefHat className="w-6 h-6 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">شاشة المطبخ</h1>
            <p className="text-gray-600">الطلبات النشطة: {orders.length}</p>
          </div>
        </div>
        <button
          onClick={fetchOrders}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
        >
          تحديث
        </button>
      </div>

      {/* Orders Grid */}
      {orders.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-100">
          <ChefHat className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-900 mb-2">لا توجد طلبات</h3>
          <p className="text-gray-600">ستظهر الطلبات الجديدة هنا تلقائياً</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {orders.map(order => (
            <div
              key={order.id}
              className={`rounded-lg border-2 overflow-hidden ${getStatusColor(order.status)}`}
            >
              {/* Order Header */}
              <div className="p-4 bg-white/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-lg text-gray-900">
                    #{order.order_number.split('-').pop()}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handlePrint(order)}
                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="طباعة"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      order.status === 'paid' ? 'bg-yellow-200 text-yellow-800' :
                      order.status === 'in_kitchen' ? 'bg-blue-200 text-blue-800' :
                      order.status === 'preparing' ? 'bg-orange-200 text-orange-800' :
                      'bg-green-200 text-green-800'
                    }`}>
                      {getStatusLabel(order.status)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Clock className="w-4 h-4" />
                  <span>{formatTime(order.created_at)}</span>
                  <span className="text-gray-400">•</span>
                  <span className="text-orange-600 font-medium">{getTimeSince(order.created_at)}</span>
                </div>
              </div>

              {/* Order Items */}
              <div className="p-4 bg-white space-y-2">
                {order.items && order.items.length > 0 ? (
                  order.items.map(item => {
                    const itemData = item as unknown as { menu_item?: { name_ar: string }, item?: { name_ar: string } }
                    const itemName = itemData.item?.name_ar || itemData.menu_item?.name_ar || 'صنف غير معروف'
                    return (
                      <div key={item.id} className="flex items-center gap-3">
                        <span className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-sm">
                          {item.quantity}
                        </span>
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">
                            {itemName}
                          </p>
                          {item.notes && (
                            <p className="text-sm text-orange-600">{item.notes}</p>
                          )}
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <p className="text-gray-500 text-sm text-center py-2">لا توجد أصناف</p>
                )}
              </div>

              {/* Order Actions */}
              <div className="p-4 bg-white border-t border-gray-100">
                {order.status === 'paid' && (
                  <button
                    onClick={() => handleStatusChange(order.id, 'in_kitchen')}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <PlayCircle className="w-5 h-5" />
                    بدء التحضير
                  </button>
                )}
                {order.status === 'in_kitchen' && (
                  <button
                    onClick={() => handleStatusChange(order.id, 'preparing')}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                  >
                    <Package className="w-5 h-5" />
                    قيد التحضير
                  </button>
                )}
                {order.status === 'preparing' && (
                  <button
                    onClick={() => handleStatusChange(order.id, 'ready')}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <CheckCircle className="w-5 h-5" />
                    جاهز للتسليم
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
