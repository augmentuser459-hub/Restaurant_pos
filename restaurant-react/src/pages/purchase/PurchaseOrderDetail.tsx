import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { purchaseService, PurchaseOrderWithDetails } from '../../services/purchase.service'
import { useAuth } from '../../contexts/AuthContext'
import { getUserRole } from '../../components/layout/roleAccess'
import { formatDate, formatCurrency, formatNumber, formatQuantity, parseDecimal, roundMoney, roundQuantity } from '../../lib/utils'
import { toUserMessage } from '../../lib/errors'
import { ArrowRight, Package, CheckCircle, XCircle, Clock, Truck, FileText, DollarSign, Plus, X } from 'lucide-react'
import type { PurchaseOrderPayment } from '../../types/database.types'

const paymentMethodLabels: Record<string, string> = {
  cash: 'كاش',
  bank_transfer: 'تحويل بنكي',
  check: 'شيك',
}

// Statuses in which goods can still be received / a credit order can be paid
const RECEIVABLE = ['approved', 'sent', 'partially_received']
const PAYABLE = ['approved', 'sent', 'partially_received', 'received']

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [order, setOrder] = useState<PurchaseOrderWithDetails | null>(null)
  const [payments, setPayments] = useState<PurchaseOrderPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const processingRef = useRef(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentData, setPaymentData] = useState({
    amount: '',
    payment_method: 'cash',
    reference_number: '',
    notes: ''
  })
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({})

  useEffect(() => {
    if (id) fetchOrder()
  }, [id])

  const fetchOrder = async () => {
    if (!id) return
    const { data, error } = await purchaseService.getOrderById(id)
    if (error) {
      alert('فشل في تحميل أمر الشراء: ' + toUserMessage(error))
    } else if (data) {
      setOrder(data)
      await fetchPayments(id)
    }
    setLoading(false)
  }

  const fetchPayments = async (orderId: string) => {
    const { data, error } = await purchaseService.getOrderPayments(orderId)
    if (error) {
      alert('فشل في تحميل الدفعات: ' + toUserMessage(error))
      return
    }
    setPayments(data)
  }

  // Runs one action at a time (a double click cannot apply it twice; the database also checks the status).
  const runAction = async (action: () => Promise<{ error: unknown }>, successMessage: string, failurePrefix: string) => {
    if (processingRef.current) return false
    processingRef.current = true
    setProcessing(true)
    let ok = false
    try {
      const { error } = await action()
      if (error) {
        alert(failurePrefix + toUserMessage(error))
      } else {
        ok = true
        alert(successMessage)
      }
    } catch (err) {
      alert(failurePrefix + toUserMessage(err))
    }
    await fetchOrder()
    processingRef.current = false
    setProcessing(false)
    return ok
  }

  const remaining = order ? roundMoney(Number(order.total_amount || 0) - Number(order.paid_amount || 0)) : 0

  const handleAddPayment = async () => {
    if (!id || !user || !order) return

    const amount = parseDecimal(paymentData.amount)
    if (amount === null || amount <= 0) {
      alert('يجب إدخال مبلغ صحيح')
      return
    }
    if (roundMoney(amount) > remaining) {
      alert('المبلغ المدخل أكبر من المبلغ المتبقي')
      return
    }

    // Payment, the order's paid / remaining / status and the supplier balance are updated together
    const ok = await runAction(
      () => purchaseService.addPayment(id, {
        amount: roundMoney(amount),
        payment_method: paymentData.payment_method,
        reference_number: paymentData.reference_number || undefined,
        notes: paymentData.notes || undefined,
      }),
      'تمت إضافة الدفعة بنجاح',
      'فشل في إضافة الدفعة: '
    )
    if (ok) {
      setShowPaymentModal(false)
      setPaymentData({ amount: '', payment_method: 'cash', reference_number: '', notes: '' })
    }
  }

  const handleApprove = async () => {
    if (!id || !user || !order) return
    if (order.created_by === user.id && getUserRole(user) !== 'admin') return
    if (!confirm('هل تريد الموافقة على أمر الشراء؟')) return
    await runAction(() => purchaseService.approveOrder(id), 'تمت الموافقة بنجاح', 'فشل في الموافقة: ')
  }

  const handleReject = async () => {
    if (!id || !user) return
    const reason = prompt('سبب الرفض:')
    if (!reason || !reason.trim()) return
    await runAction(() => purchaseService.rejectOrder(id, reason.trim()), 'تم الرفض', 'فشل في الرفض: ')
  }

  const handleCancel = async () => {
    if (!id || !user) return
    const reason = prompt('سبب إلغاء أمر الشراء:')
    if (!reason || !reason.trim()) return
    await runAction(() => purchaseService.cancelOrder(id, reason.trim()), 'تم إلغاء أمر الشراء', 'فشل في الإلغاء: ')
  }

  const openReceiveModal = () => {
    if (!order) return
    const initial: Record<string, string> = {}
    for (const line of order.items || []) {
      initial[line.id] = String(roundQuantity(Number(line.quantity) - Number(line.received_quantity || 0)))
    }
    setReceiveQty(initial)
    setShowReceiveModal(true)
  }

  const handleReceive = async () => {
    if (!id || !user || !order) return

    const lines: { id: string; quantity: number }[] = []
    for (const line of order.items || []) {
      const outstanding = roundQuantity(Number(line.quantity) - Number(line.received_quantity || 0))
      if (outstanding <= 0) continue
      const qty = parseDecimal(receiveQty[line.id] ?? '0')
      if (qty === null || qty < 0) {
        alert(`الكمية غير صحيحة للصنف "${line.item?.name_ar || '-'}"`)
        return
      }
      if (roundQuantity(qty) > outstanding) {
        alert(`الكمية المستلمة للصنف "${line.item?.name_ar || '-'}" أكبر من المتبقي (${formatQuantity(outstanding)})`)
        return
      }
      lines.push({ id: line.id, quantity: roundQuantity(qty) })
    }
    if (!lines.some(l => l.quantity > 0)) {
      alert('أدخل كمية مستلمة لصنف واحد على الأقل')
      return
    }
    if (!confirm('هل تم استلام البضاعة؟ سيتم إضافة الكميات إلى المخزون')) return

    // Stock is added in the database (stock_adjust), only while the order is approved / partially received
    const ok = await runAction(() => purchaseService.receiveOrder(id, lines), 'تم تسجيل الاستلام بنجاح', 'فشل في تسجيل الاستلام: ')
    if (ok) setShowReceiveModal(false)
  }

  const getStatusBadge = (status: string) => {
    const config: Record<string, { bg: string; text: string; icon: typeof Clock; label: string }> = {
      draft: { bg: 'bg-gray-100', text: 'text-gray-800', icon: FileText, label: 'مسودة' },
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: Clock, label: 'في انتظار الموافقة' },
      approved: { bg: 'bg-blue-100', text: 'text-blue-800', icon: CheckCircle, label: 'موافق عليه' },
      sent: { bg: 'bg-purple-100', text: 'text-purple-800', icon: Truck, label: 'تم الإرسال للمورد' },
      partially_received: { bg: 'bg-purple-100', text: 'text-purple-800', icon: Package, label: 'استلام جزئي' },
      received: { bg: 'bg-green-100', text: 'text-green-800', icon: Package, label: 'تم الاستلام' },
      rejected: { bg: 'bg-red-100', text: 'text-red-800', icon: XCircle, label: 'مرفوض' },
      cancelled: { bg: 'bg-gray-100', text: 'text-gray-800', icon: XCircle, label: 'ملغي' },
    }
    const c = config[status] || { bg: 'bg-gray-100', text: 'text-gray-800', icon: FileText, label: status }
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

  // Approve / reject / cancel / pay are for the admin and the purchase manager (the database refuses everyone
  // else); receiving the goods stays available to the warehouse manager.
  const userRole = getUserRole(user)
  const canManage = userRole === 'admin' || userRole === 'purchase_manager'
  // Separation of duties (also enforced in purchase_approve_order): only an admin may approve their own order
  const isOwnOrder = !!user?.id && order.created_by === user.id
  const canApprove = canManage && (userRole === 'admin' || !isOwnOrder)
  const anyReceived = (order.items || []).some(i => Number(i.received_quantity || 0) > 0)
  const canPay = canManage && order.payment_type === 'credit' && PAYABLE.includes(order.status) && remaining > 0
  const canCancel = canManage && ['draft', 'pending', 'approved', 'sent'].includes(order.status) && !anyReceived && payments.length === 0

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
              <span className="font-medium">{order.payment_type === 'cash' ? 'كاش (يدفع عند الاستلام)' : 'آجل'}</span>
            </div>
            {order.received_at && (
              <div className="flex justify-between">
                <span className="text-gray-500">تاريخ الاستلام</span>
                <span className="font-medium">{formatDate(order.received_at)}</span>
              </div>
            )}
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
              <span className="font-medium">{formatQuantity(roundQuantity(order.items?.reduce((sum, i) => sum + Number(i.quantity || 0), 0) || 0))}</span>
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
                  <span className="font-medium">{formatCurrency(remaining)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Rejection / cancellation reason (kept apart from the order notes) */}
      {order.status === 'rejected' && order.rejection_reason && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-medium text-red-800">سبب الرفض</p>
          <p className="text-red-700">{order.rejection_reason}</p>
          {order.rejected_at && <p className="text-xs text-red-500 mt-1">{formatDate(order.rejected_at)}</p>}
        </div>
      )}
      {order.status === 'cancelled' && order.cancellation_reason && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-sm font-medium text-gray-800">سبب الإلغاء</p>
          <p className="text-gray-700">{order.cancellation_reason}</p>
          {order.cancelled_at && <p className="text-xs text-gray-500 mt-1">{formatDate(order.cancelled_at)}</p>}
        </div>
      )}

      {/* Payment Section - Only show for credit orders */}
      {order.payment_type === 'credit' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              الدفعات
            </h3>
            {canPay && (
              <button
                type="button"
                onClick={() => setShowPaymentModal(true)}
                disabled={processing}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                إضافة دفعة
              </button>
            )}
          </div>
          {['draft', 'pending'].includes(order.status) && (
            <p className="text-sm text-gray-500 mb-3">يمكن تسجيل الدفعات بعد اعتماد أمر الشراء</p>
          )}

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
                      <td className="px-4 py-3 text-sm">{paymentMethodLabels[payment.payment_method] || payment.payment_method}</td>
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
                {anyReceived && <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">المستلم</th>}
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
                  <td className="px-4 py-3">{formatQuantity(item.quantity)} {item.item?.unit?.name_ar || ''}</td>
                  {anyReceived && <td className="px-4 py-3">{formatQuantity(item.received_quantity || 0)}</td>}
                  <td className="px-4 py-3">{formatCurrency(item.unit_price || 0)}</td>
                  <td className="px-4 py-3 font-medium">{formatCurrency(item.total_price || roundMoney(item.quantity * (item.unit_price || 0)))}</td>
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
        {canCancel && order.status !== 'pending' && order.status !== 'draft' && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={processing}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
          >
            إلغاء الأمر
          </button>
        )}
        {canManage && (order.status === 'pending' || order.status === 'draft') && (
          <>
            <button
              type="button"
              onClick={handleReject}
              disabled={processing}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              رفض
            </button>
            {canApprove ? (
              <button
                type="button"
                onClick={handleApprove}
                disabled={processing}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                موافقة
              </button>
            ) : (
              <span className="self-center text-sm text-gray-500">لا يمكن اعتماد أمر شراء أنشأته بنفسك</span>
            )}
          </>
        )}
        {RECEIVABLE.includes(order.status) && (
          <button
            type="button"
            onClick={openReceiveModal}
            disabled={processing}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            تأكيد الاستلام
          </button>
        )}
      </div>

      {/* Receive Modal */}
      {showReceiveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4">
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="text-lg font-semibold">تأكيد استلام البضاعة</h3>
              <button type="button" onClick={() => setShowReceiveModal(false)} className="p-1 hover:bg-gray-100 rounded" title="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              <p className="text-sm text-gray-500 mb-3">عدّل الكمية إذا كان المستلم أقل من المطلوب، ويمكن استلام الباقي لاحقاً</p>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-right text-sm font-medium text-gray-700">الصنف</th>
                    <th className="px-3 py-2 text-right text-sm font-medium text-gray-700">المتبقي</th>
                    <th className="px-3 py-2 text-right text-sm font-medium text-gray-700">الكمية المستلمة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {order.items?.map(line => {
                    const outstanding = roundQuantity(Number(line.quantity) - Number(line.received_quantity || 0))
                    if (outstanding <= 0) return null
                    return (
                      <tr key={line.id}>
                        <td className="px-3 py-2 text-sm">{line.item?.name_ar || '-'}</td>
                        <td className="px-3 py-2 text-sm">{formatQuantity(outstanding)}</td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={receiveQty[line.id] ?? ''}
                            onChange={(e) => setReceiveQty({ ...receiveQty, [line.id]: e.target.value })}
                            aria-label="الكمية المستلمة"
                            className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                            dir="ltr"
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex gap-3 p-6 border-t">
              <button
                type="button"
                onClick={handleReceive}
                disabled={processing}
                className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {processing ? 'جاري الحفظ...' : 'تأكيد الاستلام'}
              </button>
              <button
                type="button"
                onClick={() => setShowReceiveModal(false)}
                className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

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
                  type="text"
                  inputMode="decimal"
                  value={paymentData.amount}
                  onChange={(e) => setPaymentData({ ...paymentData, amount: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                  dir="ltr"
                />
                <p className="text-sm text-gray-500 mt-1">المتبقي: {formatCurrency(remaining)}</p>
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
                disabled={processing || !paymentData.amount.trim()}
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
