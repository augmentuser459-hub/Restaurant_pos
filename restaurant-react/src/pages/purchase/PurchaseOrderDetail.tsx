import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { purchaseService, PurchaseOrderWithDetails } from '../../services/purchase.service'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate, formatCurrency, formatNumber } from '../../lib/utils'
import { ArrowRight, Package, CheckCircle, XCircle, Clock, Truck, FileText, DollarSign, Plus, X } from 'lucide-react'
import type { PurchaseOrderPayment } from '../../types/database.types'

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [order, setOrder] = useState<PurchaseOrderWithDetails | null>(null)
  const [payments, setPayments] = useState<PurchaseOrderPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentData, setPaymentData] = useState({
    amount: 0,
    payment_method: 'cash',
    reference_number: '',
    notes: ''
  })

  useEffect(() => {
    if (id) fetchOrder()
  }, [id])

  const fetchOrder = async () => {
    if (!id) return
    const { data, error } = await purchaseService.getOrderById(id)
    if (error) {
      alert('فشل في تحميل أمر الشراء: ' + error.message)
    } else if (data) {
      setOrder(data)
      await fetchPayments(id)
    }
    setLoading(false)
  }

  const fetchPayments = async (orderId: string) => {
    const { data, error } = await supabase
      .from('purchase_order_payments')
      .select('*')
      .eq('order_id', orderId)
      .order('payment_date', { ascending: false })
    
    if (!error && data) {
      setPayments(data)
    }
  }

  const handleAddPayment = async () => {
    if (!id || !user || !order) return
    
    if (paymentData.amount <= 0) {
      alert('يجب إدخال مبلغ صحيح')
      return
    }

    if (paymentData.amount > (order.remaining_amount || 0)) {
      alert('المبلغ المدخل أكبر من المبلغ المتبقي')
      return
    }

    setProcessing(true)
    const paymentNumber = `PAY-${Date.now()}`

    const { error } = await supabase
      .from('purchase_order_payments')
      .insert({
        order_id: id,
        payment_number: paymentNumber,
        payment_date: new Date().toISOString(),
        amount: paymentData.amount,
        payment_method: paymentData.payment_method,
        reference_number: paymentData.reference_number || null,
        notes: paymentData.notes || null,
        created_by: user.id
      })

    if (error) {
      alert('فشل في إضافة الدفعة: ' + error.message)
    } else {
      // Update supplier balance - reduce debt when payment is made
      if (order.supplier?.id) {
        const { data: supplier } = await supabase
          .from('suppliers')
          .select('current_balance')
          .eq('id', order.supplier.id)
          .single()
        
        if (supplier) {
          const newBalance = (supplier.current_balance || 0) - paymentData.amount
          await supabase
            .from('suppliers')
            .update({ 
              current_balance: newBalance,
              updated_at: new Date().toISOString()
            })
            .eq('id', order.supplier.id)
          
          console.log(`✅ Reduced supplier balance from ${supplier.current_balance} to ${newBalance} (-${paymentData.amount})`)
        }
      }
      
      alert('تمت إضافة الدفعة بنجاح')
      setShowPaymentModal(false)
      setPaymentData({ amount: 0, payment_method: 'cash', reference_number: '', notes: '' })
      fetchOrder()
    }
    setProcessing(false)
  }

  const handleApprove = async () => {
    if (!id || !user) return
    if (!confirm('هل تريد الموافقة على أمر الشراء؟')) return
    
    setProcessing(true)
    const { error } = await purchaseService.approveOrder(id, user.id)
    if (error) {
      alert('فشل في الموافقة: ' + error.message)
    } else {
      alert('تمت الموافقة بنجاح')
      fetchOrder()
    }
    setProcessing(false)
  }

  const handleReject = async () => {
    if (!id || !user) return
    const reason = prompt('سبب الرفض:')
    if (!reason) return
    
    setProcessing(true)
    const { error } = await purchaseService.rejectOrder(id, user.id, reason)
    if (error) {
      alert('فشل في الرفض: ' + error.message)
    } else {
      alert('تم الرفض')
      fetchOrder()
    }
    setProcessing(false)
  }

  const handleReceive = async () => {
    if (!id || !user) return
    if (!confirm('هل تم استلام البضاعة؟')) return
    
    setProcessing(true)
    const { error } = await purchaseService.receiveOrder(id, user.id)
    if (error) {
      alert('فشل في تسجيل الاستلام: ' + error.message)
    } else {
      alert('تم تسجيل الاستلام بنجاح')
      fetchOrder()
    }
    setProcessing(false)
  }

  const getStatusBadge = (status: string) => {
    const config: Record<string, { bg: string; text: string; icon: typeof Clock; label: string }> = {
      draft: { bg: 'bg-gray-100', text: 'text-gray-800', icon: FileText, label: 'مسودة' },
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: Clock, label: 'في انتظار الموافقة' },
      approved: { bg: 'bg-blue-100', text: 'text-blue-800', icon: CheckCircle, label: 'موافق عليه' },
      sent: { bg: 'bg-purple-100', text: 'text-purple-800', icon: Truck, label: 'تم الإرسال للمورد' },
      received: { bg: 'bg-green-100', text: 'text-green-800', icon: Package, label: 'تم الاستلام' },
      rejected: { bg: 'bg-red-100', text: 'text-red-800', icon: XCircle, label: 'مرفوض' },
      cancelled: { bg: 'bg-gray-100', text: 'text-gray-800', icon: XCircle, label: 'ملغي' },
    }
    const c = config[status] || config.pending
    const Icon = c.icon
    return (
      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${c.bg} ${c.text}`}>
        <Icon className="w-4 h-4" />
        {c.label}
      </span>
    )
  }

  const getPaymentStatusBadge = (status: string) => {
    const config: Record<string, { bg: string; text: string; label: string }> = {
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'لم يتم الدفع' },
      partial: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'دفع جزئي' },
      paid: { bg: 'bg-green-100', text: 'text-green-800', label: 'مدفوع بالكامل' },
    }
    const c = config[status] || config.pending
    return (
      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${c.bg} ${c.text}`}>
        {c.label}
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

  if (!order) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">أمر الشراء غير موجود</p>
        <Link to="/purchase/orders" className="text-blue-600 hover:underline mt-2 inline-block">
          العودة للقائمة
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/purchase/orders" className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowRight className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">أمر شراء #{order.order_number}</h1>
            <p className="text-gray-600">تفاصيل أمر الشراء</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {getStatusBadge(order.status)}
          {getPaymentStatusBadge(order.payment_status || 'pending')}
        </div>
      </div>

      {/* Order Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">معلومات الأمر</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-500">رقم الأمر</span>
              <span className="font-medium">{order.order_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">تاريخ الأمر</span>
              <span className="font-medium">{formatDate(order.order_date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">المورد</span>
              <span className="font-medium">{order.supplier?.name_ar || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">الفرع</span>
              <span className="font-medium">{order.branch?.name_ar || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">تاريخ التسليم المتوقع</span>
              <span className="font-medium">{order.expected_delivery_date ? formatDate(order.expected_delivery_date) : '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">طريقة الدفع</span>
              <span className="font-medium">{order.payment_type === 'cash' ? 'كاش' : 'آجل'}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">ملخص مالي</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-500">عدد الأصناف</span>
              <span className="font-medium">{formatNumber(order.items?.length || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">إجمالي الكمية</span>
              <span className="font-medium">{formatNumber(order.items?.reduce((sum, i) => sum + (i.quantity || 0), 0) || 0)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold pt-2 border-t">
              <span>الإجمالي</span>
              <span className="text-blue-600">{formatCurrency(order.total_amount || 0)}</span>
            </div>
            {order.payment_type === 'credit' && (
              <>
                <div className="flex justify-between text-green-600">
                  <span>المدفوع</span>
                  <span className="font-medium">{formatCurrency(order.paid_amount || 0)}</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>المتبقي</span>
                  <span className="font-medium">{formatCurrency(order.remaining_amount || 0)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Payment Section - Only show for credit orders */}
      {order.payment_type === 'credit' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              الدفعات
            </h3>
            {order.payment_status !== 'paid' && (
              <button
                type="button"
                onClick={() => setShowPaymentModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
                إضافة دفعة
              </button>
            )}
          </div>

          {payments.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">رقم الدفعة</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">التاريخ</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">المبلغ</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">طريقة الدفع</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">رقم المرجع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="px-4 py-3 text-sm">{payment.payment_number}</td>
                      <td className="px-4 py-3 text-sm">{formatDate(payment.payment_date)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-green-600">{formatCurrency(payment.amount)}</td>
                      <td className="px-4 py-3 text-sm">{payment.payment_method}</td>
                      <td className="px-4 py-3 text-sm">{payment.reference_number || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">لا توجد دفعات مسجلة</p>
          )}
        </div>
      )}

      {/* Items Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">الأصناف</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الصنف</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الكمية</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">سعر الوحدة</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الإجمالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {order.items?.map((item, index) => (
                <tr key={item.id || index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-gray-900">{item.item?.name_ar || '-'}</p>
                      <p className="text-sm text-gray-500">{item.item?.code || '-'}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">{formatNumber(item.quantity)}</td>
                  <td className="px-4 py-3">{formatCurrency(item.unit_price || 0)}</td>
                  <td className="px-4 py-3 font-medium">{formatCurrency(item.total_price || (item.quantity * (item.unit_price || 0)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Notes */}
      {order.notes && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">ملاحظات</h3>
          <p className="text-gray-600">{order.notes}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        {order.status === 'pending' && (
          <>
            <button
              type="button"
              onClick={handleReject}
              disabled={processing}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              رفض
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={processing}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              موافقة
            </button>
          </>
        )}
        {(order.status === 'approved' || order.status === 'sent') && (
          <button
            type="button"
            onClick={handleReceive}
            disabled={processing}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            تأكيد الاستلام
          </button>
        )}
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="text-lg font-semibold">إضافة دفعة جديدة</h3>
              <button type="button" onClick={() => setShowPaymentModal(false)} className="p-1 hover:bg-gray-100 rounded" title="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">المبلغ <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max={order.remaining_amount || 0}
                  value={paymentData.amount}
                  onChange={(e) => setPaymentData({ ...paymentData, amount: Number(e.target.value) })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
                <p className="text-sm text-gray-500 mt-1">المتبقي: {formatCurrency(order.remaining_amount || 0)}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">طريقة الدفع</label>
                <select
                  value={paymentData.payment_method}
                  onChange={(e) => setPaymentData({ ...paymentData, payment_method: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  aria-label="طريقة الدفع"
                >
                  <option value="cash">كاش</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                  <option value="check">شيك</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">رقم المرجع</label>
                <input
                  type="text"
                  value={paymentData.reference_number}
                  onChange={(e) => setPaymentData({ ...paymentData, reference_number: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="رقم الشيك أو التحويل..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
                <textarea
                  value={paymentData.notes}
                  onChange={(e) => setPaymentData({ ...paymentData, notes: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="ملاحظات..."
                />
              </div>
            </div>
            <div className="flex gap-3 p-6 border-t">
              <button
                type="button"
                onClick={handleAddPayment}
                disabled={processing || paymentData.amount <= 0}
                className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {processing ? 'جاري الحفظ...' : 'حفظ الدفعة'}
              </button>
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
