import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { transfersService, TransferWithDetails } from '../../services/transfers.service'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate, formatQuantity, translateStatus, getStatusColor } from '../../lib/utils'
import { toUserMessage } from '../../lib/errors'
import { ArrowRight, Building2, Package, Check, X, Truck, Printer } from 'lucide-react'

export default function TransferDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [transfer, setTransfer] = useState<TransferWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const busy = useRef(false) // blocks a second click before the button re-renders as disabled

  useEffect(() => {
    if (id) fetchTransfer(id)
  }, [id])

  const fetchTransfer = async (transferId: string) => {
    const { data, error } = await transfersService.getById(transferId)
    setLoadError(error && error.code !== 'PGRST116' ? toUserMessage(error) : '')
    setTransfer(data)
    setLoading(false)
  }

  // Runs one status action; the database refuses it when the transfer was already processed elsewhere,
  // so the page is always reloaded afterwards to show the real status.
  const runAction = async (action: () => Promise<{ error: unknown }>, failMessage: string) => {
    if (!transfer || busy.current) return
    busy.current = true
    setActionLoading(true)
    try {
      const { error } = await action()
      if (error) alert(`${failMessage}: ${toUserMessage(error)}`)
    } catch (err) {
      alert(`${failMessage}: ${toUserMessage(err)}`)
    }
    await fetchTransfer(transfer.id)
    setActionLoading(false)
    busy.current = false
  }

  const handleApprove = () => {
    if (!transfer || !user) return
    runAction(() => transfersService.approve(transfer.id), 'تعذرت الموافقة على التحويل')
  }

  const handleReject = () => {
    if (!transfer || !user) return
    const reason = prompt('سبب الرفض:')
    if (reason === null) return
    runAction(() => transfersService.reject(transfer.id, reason), 'تعذر رفض التحويل')
  }

  const handleReceive = () => {
    if (!transfer || !user) return
    runAction(() => transfersService.receive(transfer.id), 'حدث خطأ أثناء تأكيد الاستلام')
  }

  const handlePrint = () => {
    // Hide headers and footers by using CSS
    const style = document.createElement('style');
    style.innerHTML = `
      @media print {
        @page { margin: 0; }
        body { margin: 1cm; }
      }
    `;
    document.head.appendChild(style);

    window.print();

    // Remove the style after printing
    setTimeout(() => {
      document.head.removeChild(style);
    }, 1000);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  if (!transfer) {
    return <div className="text-center py-12"><p className="text-gray-600">{loadError || 'التحويل غير موجود'}</p></div>
  }

  // Get user role name (handle both string and object)
  const userRole = typeof user?.role === 'object' && user?.role !== null
    ? (user.role as { name: string }).name
    : user?.role

  // Get branch IDs from the transfer object
  const toBranchId = (transfer as unknown as { to_branch_id?: string }).to_branch_id || transfer.to_branch?.id
  const fromBranchId = (transfer as unknown as { from_branch_id?: string }).from_branch_id || transfer.from_branch?.id

  // Approval belongs to the SOURCE side: admin, warehouse manager, or the source branch's supervisor
  // when somebody else made the request (the database enforces the same rule)
  const canApprove = transfer.status === 'pending' && (
    userRole === 'admin' ||
    userRole === 'warehouse_manager' ||
    (userRole === 'branch_supervisor' && Boolean(user?.branch_id) && user?.branch_id === fromBranchId && transfer.requested_by !== user?.id)
  )

  // Receipt belongs to the DESTINATION side: admin, warehouse manager, or the destination branch's supervisor
  const canReceive = transfer.status === 'approved' && (
    userRole === 'admin' ||
    userRole === 'warehouse_manager' ||
    (userRole === 'branch_supervisor' && Boolean(user?.branch_id) && user?.branch_id === toBranchId)
  )

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4 print:hidden">
        <button type="button" onClick={() => navigate('/transfers')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">تفاصيل التحويل</h1>
          <p className="text-gray-600">{transfer.transfer_number}</p>
        </div>
        <button
          type="button"
          onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          title="طباعة"
        >
          <Printer className="w-4 h-4" />
          طباعة
        </button>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(transfer.status)}`}>
          {translateStatus(transfer.status)}
        </span>
      </div>

      {/* Print Header - Only visible when printing */}
      <div className="hidden print:block text-center mb-6">
        <h1 className="text-2xl font-bold">تفاصيل التحويل</h1>
        <p className="text-lg text-gray-600 mt-2">{transfer.transfer_number}</p>
        <p className="text-sm text-gray-500 mt-1">تاريخ الطباعة: {formatDate(new Date().toISOString())}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 print:hidden" /> من فرع
          </h3>
          <p className="text-lg font-medium">{transfer.from_branch?.name_ar}</p>
          <p className="text-sm text-gray-500">{transfer.from_branch?.code}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Truck className="w-5 h-5 print:hidden" /> إلى فرع
          </h3>
          <p className="text-lg font-medium">{transfer.to_branch?.name_ar}</p>
          <p className="text-sm text-gray-500">{transfer.to_branch?.code}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Package className="w-5 h-5 print:hidden" /> الأصناف ({transfer.items?.length || 0})
        </h3>
        {(!transfer.items || transfer.items.length === 0) ? (
          <p className="text-gray-500 text-center py-4">لا توجد أصناف</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full print:border-collapse">
              <thead className="bg-gray-50 print:bg-gray-200">
                <tr>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 print:border print:border-gray-300 print:text-black">الصنف</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 print:border print:border-gray-300 print:text-black">الكمية المطلوبة</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 print:border print:border-gray-300 print:text-black">الكمية الموافق عليها</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 print:border print:border-gray-300 print:text-black">الكمية المستلمة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transfer.items.map(item => {
                  // Handle nested unit object
                  const unitName = typeof item.item?.unit === 'object' && item.item?.unit !== null
                    ? (item.item.unit as { name_ar?: string }).name_ar || ''
                    : item.item?.unit || ''
                  const hasApproved = item.approved_quantity !== null && item.approved_quantity !== undefined
                  const hasReceived = item.received_quantity !== null && item.received_quantity !== undefined
                  return (
                    <tr key={item.id}>
                      <td className="px-4 py-3 print:border print:border-gray-300">{item.item?.name_ar || 'غير معروف'} <span className="text-gray-500">({item.item?.code || '-'})</span></td>
                      <td className="px-4 py-3 print:border print:border-gray-300">{formatQuantity(item.requested_quantity)} {unitName}</td>
                      <td className="px-4 py-3 print:border print:border-gray-300">{hasApproved ? `${formatQuantity(item.approved_quantity)} ${unitName}` : '-'}</td>
                      <td className="px-4 py-3 print:border print:border-gray-300">{hasReceived ? `${formatQuantity(item.received_quantity)} ${unitName}` : '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
        <h3 className="font-semibold text-gray-900 mb-4">معلومات إضافية</h3>
        <div className="grid grid-cols-2 gap-4 text-sm print:gap-2">
          <div><span className="text-gray-500">تاريخ الطلب:</span> <span className="font-medium">{formatDate((transfer as unknown as { requested_at?: string }).requested_at || (transfer as unknown as { created_at?: string }).created_at || '')}</span></div>
          <div><span className="text-gray-500">عدد الأصناف:</span> <span className="font-medium">{transfer.items?.length || 0}</span></div>
          <div><span className="text-gray-500">الحالة:</span> <span className="font-medium">{translateStatus(transfer.status)}</span></div>
          {transfer.notes && <div className="col-span-2"><span className="text-gray-500">ملاحظات:</span> <span className="font-medium">{transfer.notes}</span></div>}
          {transfer.rejection_reason && <div className="col-span-2"><span className="text-gray-500">سبب الرفض:</span> <span className="font-medium text-red-600">{transfer.rejection_reason}</span></div>}
        </div>
      </div>

      {(canApprove || canReceive) && (
        <div className="flex gap-3 print:hidden">
          {canApprove && (
            <>
              <button type="button" onClick={handleApprove} disabled={actionLoading}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                <Check className="w-5 h-5" /> موافقة
              </button>
              <button type="button" onClick={handleReject} disabled={actionLoading}
                className="flex items-center gap-2 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                <X className="w-5 h-5" /> رفض
              </button>
            </>
          )}
          {canReceive && (
            <button type="button" onClick={handleReceive} disabled={actionLoading}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <Truck className="w-5 h-5" /> تأكيد الاستلام
            </button>
          )}
        </div>
      )}
    </div>
  )
}
