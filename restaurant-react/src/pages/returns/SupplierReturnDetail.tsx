import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { returnsService, SupplierReturn } from '../../services/returns.service'
import { formatCurrency, formatDate, formatQuantity, getStatusColor, translateStatus } from '../../lib/utils'
import { toUserMessage } from '../../lib/errors'
import { ArrowRight, Package, Truck, Check, X, Printer } from 'lucide-react'

export default function SupplierReturnDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [returnData, setReturnData] = useState<SupplierReturn | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const busy = useRef(false) // blocks a second click before the button re-renders as disabled

  useEffect(() => {
    if (id) fetchReturn(id)
  }, [id])

  const fetchReturn = async (returnId: string) => {
    const { data, error } = await returnsService.getSupplierReturnById(returnId)
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

  // Each action is one database function that re-checks the status under a row lock; the page always reloads afterwards
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

  // Approval deducts the stock and lowers the supplier balance by the return value, together
  const handleApprove = () => {
    if (!returnData || !user) return
    runAction(() => returnsService.approveSupplierReturn(returnData.id), 'تعذرت الموافقة على المرتجع')
  }

  const handleReject = () => {
    if (!returnData || !user) return
    const reason = prompt('سبب الرفض:')
    if (reason === null) return
    runAction(() => returnsService.rejectSupplierReturn(returnData.id, reason), 'تعذر رفض المرتجع')
  }

  // Marks the approved return as handed over to the supplier (stock and balance already changed on approval)
  const handleComplete = () => {
    if (!returnData || !user) return
    runAction(() => returnsService.completeSupplierReturn(returnData.id), 'تعذر تأكيد الإرجاع للمورد')
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

  const canApprove = returnData.status === 'pending' && (userRole === 'admin' || userRole === 'warehouse_manager')
  const canComplete = returnData.status === 'approved' && (userRole === 'admin' || userRole === 'warehouse_manager')

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4 print:hidden">
        <button type="button" onClick={() => navigate('/returns')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">مرتجع للمورد</h1>
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
          {translateStatus(returnData.status)}
        </span>
      </div>

      {/* Print Header - Only visible when printing */}
      <div className="hidden print:block text-center mb-6">
        <h1 className="text-2xl font-bold">مرتجع للمورد</h1>
        <p className="text-lg text-gray-600 mt-2">{returnData.return_number}</p>
        <p className="text-sm text-gray-500 mt-1">تاريخ الطباعة: {formatDate(new Date().toISOString())}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Truck className="w-5 h-5 print:hidden" /> المورد
          </h3>
          <p className="text-lg font-medium">{returnData.supplier?.name_ar}</p>
          <p className="text-sm text-gray-500">{returnData.supplier?.code}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 print:hidden" /> الصنف
          </h3>
          <p className="text-lg font-medium">{returnData.item?.name_ar}</p>
          <p className="text-sm text-gray-500">{returnData.item?.code}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
        <h3 className="font-semibold text-gray-900 mb-4">تفاصيل المرتجع</h3>
        <div className="grid grid-cols-2 gap-4 text-sm print:gap-2">
          <div><span className="text-gray-500">التاريخ:</span> <span className="font-medium">{formatDate(returnData.registered_at)}</span></div>
          <div><span className="text-gray-500">الكمية:</span> <span className="font-medium">{formatQuantity(returnData.quantity)} {returnData.item?.unit?.name_ar || ''}</span></div>
          <div><span className="text-gray-500">سعر الوحدة:</span> <span className="font-medium">{formatCurrency(Number(returnData.unit_price) || 0)}</span></div>
          <div><span className="text-gray-500">قيمة المرتجع:</span> <span className="font-medium text-red-600">{formatCurrency(Number(returnData.total_amount) || 0)}</span></div>
          <div><span className="text-gray-500">من:</span> <span className="font-medium">{returnData.branch?.name_ar || 'المخزن الرئيسي'}</span></div>
          <div><span className="text-gray-500">السبب:</span> <span className="font-medium">{returnData.reason || '-'}</span></div>
          {returnData.description && <div className="col-span-2"><span className="text-gray-500">ملاحظات:</span> <span className="font-medium">{returnData.description}</span></div>}
          {returnData.rejection_reason && <div className="col-span-2"><span className="text-gray-500">سبب الرفض:</span> <span className="font-medium text-red-600">{returnData.rejection_reason}</span></div>}
        </div>
      </div>

      {(canApprove || canComplete) && (
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
          {canComplete && (
            <button type="button" onClick={handleComplete} disabled={actionLoading}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <Check className="w-5 h-5" /> تأكيد الإرجاع للمورد
            </button>
          )}
        </div>
      )}
    </div>
  )
}
