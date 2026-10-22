import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { purchaseService, PurchaseRequestWithDetails } from '../../services/purchase.service'
import { useAuth } from '../../contexts/AuthContext'
import { getUserRole } from '../../components/layout/roleAccess'
import { formatDate, formatCurrency, formatNumber, formatQuantity, roundMoney } from '../../lib/utils'
import { toUserMessage } from '../../lib/errors'
import { requestStatusConfig } from './requestStatus'
import { ArrowRight, ShoppingCart } from 'lucide-react'

const priorityLabels: Record<number, string> = { 1: 'عادي', 2: 'متوسط', 3: 'عاجل' }

const itemStatusLabels: Record<string, string> = {
  pending: 'بانتظار الموافقة',
  approved: 'معتمد (لم يُطلب بعد)',
  rejected: 'مرفوض',
  ordered: 'تم الطلب',
}

// A request can be bought with several purchase orders (e.g. one per supplier) while it has approved lines
// that no order covers yet.
const ORDERABLE_REQUEST_STATUSES = ['approved', 'ordered', 'partially_received']

type RequestLine = PurchaseRequestWithDetails['items'][number]

const lineStatusLabel = (line: RequestLine) => {
  if (line.item_status === 'ordered') {
    const ordered = Number(line.ordered_quantity || 0)
    const received = Number(line.received_quantity || 0)
    if (ordered > 0 && received >= ordered) return 'تم الاستلام'
    if (received > 0) return 'استلام جزئي'
  }
  return itemStatusLabels[line.item_status || ''] || line.item_status || '-'
}

export default function PurchaseRequestDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const userRole = getUserRole(user)
  // Approve / reject: admin and purchase manager; creating the purchase order: also the warehouse manager
  // (the same roles the database functions allow).
  const canApprove = userRole === 'admin' || userRole === 'purchase_manager'
  const canOrder = canApprove || userRole === 'warehouse_manager'
  const [request, setRequest] = useState<PurchaseRequestWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const processingRef = useRef(false)

  useEffect(() => {
    if (id) fetchRequest()
  }, [id])

  const fetchRequest = async () => {
    if (!id) return
    const { data, error } = await purchaseService.getRequestById(id)
    if (error) {
      alert('فشل في تحميل طلب الشراء: ' + toUserMessage(error))
    } else {
      setRequest(data)
    }
    setLoading(false)
  }

  // One action at a time; the database also re-checks the status (a stale page cannot approve twice)
  const runAction = async (action: () => Promise<{ error: unknown }>, successMessage: string, failurePrefix: string) => {
    if (processingRef.current) return
    processingRef.current = true
    setProcessing(true)
    try {
      const { error } = await action()
      if (error) alert(failurePrefix + toUserMessage(error))
      else alert(successMessage)
    } catch (err) {
      alert(failurePrefix + toUserMessage(err))
    }
    await fetchRequest()
    processingRef.current = false
    setProcessing(false)
  }

  const handleApprove = async () => {
    if (!id) return
    if (!confirm('هل تريد اعتماد طلب الشراء؟')) return
    await runAction(() => purchaseService.approveRequest(id), 'تم اعتماد الطلب', 'فشل في الاعتماد: ')
  }

  const handleReject = async () => {
    if (!id) return
    const reason = prompt('سبب الرفض:')
    if (!reason || !reason.trim()) return
    await runAction(() => purchaseService.rejectRequest(id, reason.trim()), 'تم رفض الطلب', 'فشل في الرفض: ')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!request) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">طلب الشراء غير موجود</p>
        <Link to="/purchase/requests" className="text-blue-600 hover:underline mt-2 inline-block">
          العودة للقائمة
        </Link>
      </div>
    )
  }

  const status = requestStatusConfig[request.status] || { label: request.status, color: 'bg-gray-100 text-gray-700' }
  const items = request.items || []
  const openLines = items.filter(i => i.item_status === 'approved').length
  const canCreateOrder = canOrder && ORDERABLE_REQUEST_STATUSES.includes(request.status) && openLines > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/purchase/requests" className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
            <ArrowRight className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">طلب شراء #{request.request_number}</h1>
            <p className="text-gray-600">تفاصيل طلب الشراء</p>
          </div>
        </div>
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${status.color}`}>
          {status.label}
        </span>
      </div>

      {/* Request Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">معلومات الطلب</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-500">رقم الطلب</span>
              <span className="font-medium">{request.request_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">تاريخ الطلب</span>
              <span className="font-medium">{formatDate(request.request_date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">الفرع</span>
              <span className="font-medium">{request.branch?.name_ar || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">الأولوية</span>
              <span className="font-medium">{priorityLabels[request.priority] || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">مقدم الطلب</span>
              <span className="font-medium">{request.requester?.full_name_ar || request.requester?.full_name || '-'}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">ملخص</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-500">عدد الأصناف</span>
              <span className="font-medium">{formatNumber(items.length)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">إجمالي الكمية</span>
              <span className="font-medium">{formatQuantity(request.total_quantity)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold pt-2 border-t">
              <span>التكلفة التقديرية</span>
              <span className="text-blue-600">{formatCurrency(request.estimated_cost || 0)}</span>
            </div>
          </div>
        </div>
      </div>

      {request.status === 'rejected' && request.rejection_reason && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-medium text-red-800">سبب الرفض</p>
          <p className="text-red-700">{request.rejection_reason}</p>
          {request.rejected_at && <p className="text-xs text-red-500 mt-1">{formatDate(request.rejected_at)}</p>}
        </div>
      )}

      {/* Items */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">الأصناف المطلوبة</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الصنف</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">المورد المقترح</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الكمية المطلوبة</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">السعر التقديري</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الإجمالي</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">المطلوب بأمر شراء</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">المستلم</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item, index) => (
                <tr key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{item.item?.name_ar || '-'}</p>
                    <p className="text-sm text-gray-500">{item.item?.code || '-'}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.supplier?.name_ar || '-'}</td>
                  <td className="px-4 py-3">{formatQuantity(item.requested_quantity)} {item.item?.unit?.name_ar || ''}</td>
                  <td className="px-4 py-3">{item.estimated_unit_price ? formatCurrency(item.estimated_unit_price) : '-'}</td>
                  <td className="px-4 py-3">
                    {formatCurrency(item.estimated_total ?? roundMoney(item.requested_quantity * (item.estimated_unit_price || 0)))}
                  </td>
                  <td className="px-4 py-3">{item.ordered_quantity ? formatQuantity(item.ordered_quantity) : '-'}</td>
                  <td className="px-4 py-3">{formatQuantity(item.received_quantity || 0)}</td>
                  <td className="px-4 py-3 text-sm">{lineStatusLabel(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Notes */}
      {request.notes && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">ملاحظات</h3>
          <p className="text-gray-600">{request.notes}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        {canApprove && (request.status === 'pending' || request.status === 'draft') && (
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
              اعتماد
            </button>
          </>
        )}
        {canCreateOrder && (
          <Link
            to={`/purchase/orders/new?request=${request.id}`}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <ShoppingCart className="w-4 h-4" />
            {openLines < items.filter(i => i.item_status !== 'rejected').length
              ? `إنشاء أمر شراء للأصناف المتبقية (${formatNumber(openLines)})`
              : 'إنشاء أمر شراء'}
          </Link>
        )}
      </div>
    </div>
  )
}
