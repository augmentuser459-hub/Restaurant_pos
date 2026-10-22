import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { returnsService, BranchReturn } from '../../services/returns.service'
import { formatDate, formatQuantity, getStatusColor, translateStatus } from '../../lib/utils'
import { toUserMessage } from '../../lib/errors'
import { ArrowRight, Building2, Package, Check, X, Truck, Printer } from 'lucide-react'

const statusLabel = (status: string) => (status === 'in_transit' ? 'قيد الشحن' : translateStatus(status))

export default function BranchReturnDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [returnData, setReturnData] = useState<BranchReturn | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const busy = useRef(false) // blocks a second click before the button re-renders as disabled

  useEffect(() => {
    if (id) fetchReturn(id)
  }, [id])

  const fetchReturn = async (returnId: string) => {
    const { data, error } = await returnsService.getBranchReturnById(returnId)
    setLoadError(error && error.code !== 'PGRST116' ? toUserMessage(error) : '')
    setReturnData(data)
    setLoading(false)
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

  // Each action is one database function that re-checks the status under a row lock (a stale page or a
  // double click is refused) and moves the stock all or nothing. The page always reloads afterwards.
  const runAction = async (action: () => Promise<{ error: unknown }>, failMessage: string) => {
    if (!returnData || busy.current) return
    busy.current = true
    setActionLoading(true)
    try {
      const { error } = await action()
      if (error) alert(`${failMessage}: ${toUserMessage(error)}`)
    } catch (err) {
      alert(`${failMessage}: ${toUserMessage(err)}`)
    }
    await fetchReturn(returnData.id)
    setActionLoading(false)
    busy.current = false
  }

  const handleApprove = () => {
    if (!returnData || !user) return
    runAction(() => returnsService.approveBranchReturn(returnData.id), 'تعذرت الموافقة على المرتجع')
  }

  const handleReject = () => {
    if (!returnData || !user) return
    const reason = prompt('سبب الرفض:')
    if (reason === null) return
    runAction(() => returnsService.rejectBranchReturn(returnData.id, reason), 'تعذر رفض المرتجع')
  }

  const handleShip = () => {
    if (!returnData || !user) return
    runAction(() => returnsService.shipBranchReturn(returnData.id), 'تعذر بدء الشحن')
  }

  const handleReceive = () => {
    if (!returnData || !user) return
    runAction(() => returnsService.receiveBranchReturn(returnData.id), 'تعذر تأكيد الاستلام')
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  if (!returnData) {
    return <div className="text-center py-12"><p className="text-gray-600">{loadError || 'المرتجع غير موجود'}</p></div>
  }

  // Get user role
  const userRole = typeof user?.role === 'object' && user?.role !== null
    ? (user.role as { name: string }).name
    : user?.role

  const isSourceSupervisor = userRole === 'branch_supervisor' && Boolean(user?.branch_id) && user?.branch_id === returnData.from_branch_id

  // Branch supervisor at source can approve/ship (the database enforces the same rules)
  const canApprove = returnData.status === 'pending' && (
    userRole === 'admin' ||
    userRole === 'warehouse_manager' ||
    isSourceSupervisor
  )

  const canShip = returnData.status === 'approved' && (
    userRole === 'admin' ||
    userRole === 'warehouse_manager' ||
    isSourceSupervisor
  )

  // Warehouse side receives at the main warehouse
  const canReceive = returnData.status === 'in_transit' && (
    userRole === 'admin' ||
    userRole === 'warehouse_manager' ||
    (userRole === 'branch_supervisor' && Boolean(user?.branch_id) && user?.branch_id === returnData.to_branch_id)
  )

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4 print:hidden">
        <button type="button" onClick={() => navigate('/returns')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">مرتجع للمخزن الرئيسي</h1>
          <p className="text-gray-600">{returnData.return_number}</p>
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
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(returnData.status)}`}>
          {statusLabel(returnData.status)}
        </span>
      </div>

      {/* Print Header - Only visible when printing */}
      <div className="hidden print:block text-center mb-6">
        <h1 className="text-2xl font-bold">مرتجع للمخزن الرئيسي</h1>
        <p className="text-lg text-gray-600 mt-2">{returnData.return_number}</p>
        <p className="text-sm text-gray-500 mt-1">تاريخ الطباعة: {formatDate(new Date().toISOString())}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 print:hidden" /> من فرع
          </h3>
          <p className="text-lg font-medium">{returnData.from_branch?.name_ar}</p>
          <p className="text-sm text-gray-500">{returnData.from_branch?.code}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Truck className="w-5 h-5 print:hidden" /> إلى
          </h3>
          <p className="text-lg font-medium">{returnData.to_branch?.name_ar}</p>
          <p className="text-sm text-gray-500">{returnData.to_branch?.code}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Package className="w-5 h-5 print:hidden" /> الأصناف
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full print:border-collapse">
            <thead className="bg-gray-50 print:bg-gray-200">
              <tr>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 print:border print:border-gray-300 print:text-black">الصنف</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 print:border print:border-gray-300 print:text-black">الكمية المطلوبة</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 print:border print:border-gray-300 print:text-black">الكمية المستلمة</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 print:border print:border-gray-300 print:text-black">السبب</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {returnData.items?.map(item => (
                <tr key={item.id}>
                  <td className="px-4 py-3 print:border print:border-gray-300">{item.item?.name_ar} <span className="text-gray-500">({item.item?.code})</span></td>
                  <td className="px-4 py-3 print:border print:border-gray-300">{formatQuantity(item.requested_quantity)} {item.item?.unit?.name_ar || ''}</td>
                  <td className="px-4 py-3 print:border print:border-gray-300">{item.received_quantity !== null ? `${formatQuantity(item.received_quantity)} ${item.item?.unit?.name_ar || ''}` : '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 print:border print:border-gray-300">{item.item_reason || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
        <h3 className="font-semibold text-gray-900 mb-4">معلومات إضافية</h3>
        <div className="grid grid-cols-2 gap-4 text-sm print:gap-2">
          <div><span className="text-gray-500">التاريخ:</span> <span className="font-medium">{formatDate(returnData.return_date)}</span></div>
          <div><span className="text-gray-500">إجمالي الكمية:</span> <span className="font-medium">{formatQuantity(returnData.total_quantity)}</span></div>
          {returnData.return_reason && <div><span className="text-gray-500">سبب الإرجاع:</span> <span className="font-medium">{returnData.return_reason}</span></div>}
          {returnData.notes && <div className="col-span-2"><span className="text-gray-500">ملاحظات:</span> <span className="font-medium">{returnData.notes}</span></div>}
          {returnData.rejection_reason && <div className="col-span-2"><span className="text-gray-500">سبب الرفض:</span> <span className="font-medium text-red-600">{returnData.rejection_reason}</span></div>}
        </div>
      </div>

      {(canApprove || canShip || canReceive) && (
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
          {canShip && (
            <button type="button" onClick={handleShip} disabled={actionLoading}
              className="flex items-center gap-2 px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
              <Truck className="w-5 h-5" /> بدء الشحن
            </button>
          )}
          {canReceive && (
            <button type="button" onClick={handleReceive} disabled={actionLoading}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <Check className="w-5 h-5" /> تأكيد الاستلام
            </button>
          )}
        </div>
      )}
    </div>
  )
}
