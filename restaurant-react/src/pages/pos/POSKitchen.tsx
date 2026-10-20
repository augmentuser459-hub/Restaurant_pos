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
  const [kitchenCategoryIds, setKitchenCategoryIds] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(30)
  const [printedOrderIds, setPrintedOrderIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (user?.branch_id) {
      fetchKitchenCategories()
      fetchOrders()
      
      // Setup realtime subscription
      console.log('🔌 Setting up real-time subscription for branch:', user.branch_id)
      
      const channel = supabase
        .channel(`kitchen-orders-${user.branch_id}`, {
          config: {
            broadcast: { self: true },
            presence: { key: user.branch_id },
          },
        })
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'orders',
            filter: `branch_id=eq.${user.branch_id}`,
          },
          (payload) => {
            console.log('🆕 New order inserted:', payload.new)
            // Immediate fetch on new order
            fetchOrders()
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'orders',
            filter: `branch_id=eq.${user.branch_id}`,
          },
          (payload) => {
            console.log('📝 Order updated:', payload.new)
            fetchOrders()
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'order_items',
          },
          (payload) => {
            console.log('🍽️ Order item inserted:', payload.new)
            // Fetch orders when items are added - small delay for batch inserts
            setTimeout(() => fetchOrders(), 500)
          }
        )
        .subscribe((status) => {
          console.log('📡 Subscription status:', status)
          if (status === 'SUBSCRIBED') {
            console.log('✅ Real-time connected successfully')
          }
          if (status === 'CHANNEL_ERROR') {
            console.error('❌ Real-time connection error')
          }
          if (status === 'TIMED_OUT') {
            console.error('⏱️ Real-time connection timed out')
          }
        })

      // Polling fallback - check every 10 seconds
      console.log('⏰ Setting up polling fallback (every 10 seconds)')
      const pollingInterval = setInterval(() => {
        console.log('🔄 Polling for new orders...')
        fetchOrders()
      }, 10000) // 10 seconds

      // Cleanup function
      return () => {
        console.log('🧹 Cleaning up real-time subscription and polling')
        supabase.removeChannel(channel)
        clearInterval(pollingInterval)
      }
    }
  }, [user?.branch_id])

  // Fetch categories marked as kitchen categories
  const fetchKitchenCategories = async () => {
    const { data } = await supabase
      .from('categories')
      .select('id')
      .eq('is_kitchen', true)
    
    if (data) {
      setKitchenCategoryIds(data.map(c => c.id))
    }
  }

  const fetchOrders = async () => {
    if (!user?.branch_id) return
    console.log('📥 Fetching orders for branch:', user.branch_id)
    const previousOrders = orders
    const { data } = await ordersService.getKitchenOrders(user.branch_id)
    const newOrders = data || []
    console.log('📦 Received orders:', newOrders.length)
    setOrders(newOrders)
    setLoading(false)
    // Reset to first page when orders update
    setCurrentPage(1)

    // Auto-print new orders that haven't been printed yet
    if (previousOrders.length > 0) {
      const previousIds = new Set(previousOrders.map(o => o.id))
      const newOrdersToAdd = newOrders.filter(order => !previousIds.has(order.id))
      
      if (newOrdersToAdd.length > 0) {
        console.log(`🆕 ${newOrdersToAdd.length} new order(s) detected:`, newOrdersToAdd.map(o => o.order_number))
        
        // Print immediately on next tick to ensure UI is updated
        setTimeout(() => {
          console.log('⏰ Print timeout triggered')
          newOrdersToAdd.forEach(order => {
            console.log(`🔍 Checking order ${order.order_number} - Already printed?`, printedOrderIds.has(order.id))
            if (!printedOrderIds.has(order.id)) {
              console.log(`✅ Order ${order.order_number} NOT printed yet - printing now`)
              setPrintedOrderIds(prev => {
                const newSet = new Set(prev).add(order.id)
                console.log('📝 Updated printed IDs:', Array.from(newSet))
                return newSet
              })
              
              const kitchenItems = getKitchenItems(order)
              console.log(`🍽️ Kitchen items for order ${order.order_number}:`, kitchenItems.length, 'items')
              
              const orderWithKitchen = { ...order, kitchenItems }
              console.log(`🖨️ Calling handlePrint for order ${order.order_number}`)
              
              try {
                handlePrint(orderWithKitchen)
                console.log(`✅ handlePrint called successfully for ${order.order_number}`)
              } catch (error) {
                console.error(`❌ Error calling handlePrint for ${order.order_number}:`, error)
              }
            } else {
              console.log(`⏭️ Order ${order.order_number} already printed - skipping`)
            }
          })
        }, 100) // Small delay to ensure state is ready
      } else {
        console.log('ℹ️ No new orders detected')
      }
    } else {
      console.log('ℹ️ First load - not checking for new orders')
    }
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
      case 'paid': return 'bg-yellow-100 border-yellow-300'
      case 'in_kitchen': return 'bg-blue-100 border-blue-300'
      case 'preparing': return 'bg-orange-100 border-orange-300'
      case 'ready': return 'bg-green-100 border-green-300'
      default: return 'bg-gray-100 border-gray-300'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'جديد'
      case 'in_kitchen': return 'في المطبخ'
      case 'preparing': return 'قيد التحضير'
      case 'ready': return 'جاهز'
      default: return status
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

  // Filter order items: only show items from kitchen categories
  const getKitchenItems = (order: OrderWithDetails) => {
    if (!order.items || order.items.length === 0) return []
    if (kitchenCategoryIds.length === 0) return order.items // No filter if no categories loaded yet
    
    return order.items.filter(item => {
      const itemData = item as unknown as { 
        item?: { category_id?: string }, 
        menu_item?: { category_id?: string } 
      }
      const categoryId = itemData.item?.category_id || itemData.menu_item?.category_id
      if (!categoryId) return true // Show items without category (safety)
      return kitchenCategoryIds.includes(categoryId)
    })
  }

  // Orders with at least one kitchen item
  const kitchenOrders = orders
    .map(order => ({
      ...order,
      kitchenItems: getKitchenItems(order)
    }))
    .filter(order => order.kitchenItems.length > 0)

  // Pagination
  const totalPages = Math.ceil(kitchenOrders.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedOrders = kitchenOrders.slice(startIndex, endIndex)

  const handlePrint = (order: OrderWithDetails & { kitchenItems?: any[] }) => {
    console.log('🖨️ handlePrint called for order:', order.order_number)
    console.log('📋 Order data:', {
      id: order.id,
      order_number: order.order_number,
      items: order.items?.length || 0,
      kitchenItems: order.kitchenItems?.length || 0
    })
    
    const items = (order.kitchenItems || order.items || []).map(item => {
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

    console.log('📄 Opening print window for order:', order.order_number)
    const printWindow = window.open('', '_blank', 'width=400,height=600')
    
    if (!printWindow) {
      console.error('❌ Failed to open print window - pop-ups may be blocked!')
      alert('Pop-ups are blocked! Please allow pop-ups for this site to enable auto-print.')
      return
    }
    
    console.log('✅ Print window opened successfully')

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
            <tr><th>الصنف</th><th>الكمية</th><th>ملاحظات</th></tr>
          </thead>
          <tbody>${items}</tbody>
        </table>
        ${order.notes ? `<div style="background: #fef3c7; padding: 10px; border-radius: 5px; margin-top: 10px;"><strong>ملاحظات:</strong> ${order.notes}</div>` : ''}
        <div class="footer"><p>شكراً لكم</p></div>
        <script>
          console.log('🖨️ Print window loaded - triggering print dialog');
          window.onload = function() { 
            console.log('📄 Calling window.print()');
            window.print();
            console.log('✅ Print dialog opened');
          }
        </script>
      </body>
      </html>
    `)
    printWindow.document.close()
    console.log('✅ Print window document written and closed')
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
            <p className="text-gray-600">الطلبات النشطة: {kitchenOrders.length}</p>
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
      {kitchenOrders.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-100">
          <ChefHat className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-900 mb-2">لا توجد طلبات</h3>
          <p className="text-gray-600">ستظهر الطلبات الجديدة هنا تلقائياً</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paginatedOrders.map(order => (
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

              {/* Order Items - Kitchen items only */}
              <div className="p-4 bg-white space-y-2">
                {order.kitchenItems.map(item => {
                  const itemData = item as unknown as { menu_item?: { name_ar: string }, item?: { name_ar: string } }
                  const itemName = itemData.item?.name_ar || itemData.menu_item?.name_ar || 'صنف غير معروف'
                  return (
                    <div key={item.id} className="flex items-center gap-3">
                      <span className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-sm">
                        {item.quantity}
                      </span>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{itemName}</p>
                        {item.notes && (
                          <p className="text-sm text-orange-600">{item.notes}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
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

      {/* Pagination */}
      {kitchenOrders.length > itemsPerPage && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              عرض {startIndex + 1} - {Math.min(endIndex, kitchenOrders.length)} من {kitchenOrders.length} طلب
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                الأولى
              </button>
              <button
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                السابق
              </button>
              
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum
                  if (totalPages <= 5) {
                    pageNum = i + 1
                  } else if (currentPage <= 3) {
                    pageNum = i + 1
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i
                  } else {
                    pageNum = currentPage - 2 + i
                  }
                  
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`px-3 py-1 rounded-lg ${
                        currentPage === pageNum
                          ? 'bg-blue-600 text-white'
                          : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {pageNum}
                    </button>
                  )
                })}
              </div>

              <button
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                التالي
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                الأخيرة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
