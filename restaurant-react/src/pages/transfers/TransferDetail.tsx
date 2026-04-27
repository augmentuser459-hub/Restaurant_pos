import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { transfersService, TransferWithDetails } from '../../services/transfers.service'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate, translateStatus, getStatusColor } from '../../lib/utils'
import { ArrowRight, Building2, Package, Check, X, Truck, Printer } from 'lucide-react'

export default function TransferDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [transfer, setTransfer] = useState<TransferWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    if (id) fetchTransfer(id)
  }, [id])

  const fetchTransfer = async (transferId: string) => {
    const { data } = await transfersService.getById(transferId)
    setTransfer(data)
    setLoading(false)
  }

  const handleApprove = async () => {
    if (!transfer || !user) return
    setActionLoading(true)
    const quantities = transfer.items.map(item => ({
      itemId: item.item_id,
      quantity: item.requested_quantity,
    }))
    await transfersService.approve(transfer.id, user.id, quantities)
    fetchTransfer(transfer.id)
    setActionLoading(false)
  }

  const handleReject = async () => {
    if (!transfer || !user) return
    const reason = prompt('سبب الرفض:')
    if (reason === null) return
    setActionLoading(true)
    await transfersService.reject(transfer.id, user.id, reason)
    fetchTransfer(transfer.id)
    setActionLoading(false)
  }

  const handleReceive = async () => {
    if (!transfer || !user) return
    setActionLoading(true)
    try {
      const quantities = transfer.items.map(item => ({
        itemId: item.item_id,
        quantity: item.approved_quantity || item.requested_quantity,
      }))
      const { error } = await transfersService.receive(transfer.id, user.id, quantities)
      if (error) {
        console.error('Receive error:', error)
        alert('حدث خطأ أثناء تأكيد الاستلام: ' + error.message)
      } else {
        fetchTransfer(transfer.id)
      }
    } catch (err) {
      console.error('Receive exception:', err)
      alert('حدث خطأ غير متوقع')
    }
    setActionLoading(false)
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
    return <div className="text-center py-12"><p className="text-gray-600">التحويل غير موجود</p></div>
  }

  // Get user role name (handle both string and object)
  const userRole = typeof user?.role === 'object' && user?.role !== null 
    ? (user.role as { name: string }).name 
    : user?.role

  // Get branch IDs from the transfer object
  const toBranchId = (transfer as unknown as { to_branch_id?: string }).to_branch_id || transfer.to_branch?.id
  const fromBranchId = (transfer as unknown as { from_branch_id?: string }).from_branch_id || transfer.from_branch?.id

  // Admin and warehouse_manager can approve any transfer
  // Branch supervisor can approve transfers TO their branch
  const canApprove = transfer.status === 'pending' && (
    userRole === 'admin' || 
    userRole === 'warehouse_manager' ||
    (userRole === 'branch_supervisor' && user?.branch_id === toBranchId)
  )
  
  // User can receive if transfer is approved
  // Admin and warehouse_manager can receive any transfer
  // Branch users can receive transfers TO their branch
  const canReceive = transfer.status === 'approved' && (
    userRole === 'admin' || 
    userRole === 'warehouse_manager' ||
    user?.branch_id === toBranchId
  )
  
  console.log('Transfer Debug:', { 
    status: transfer.status, 
    userRole, 
    userBranchId: user?.branch_id, 
    toBranchId,
    fromBranchId,
    canApprove, 
    canReceive,
    items: transfer.items
  })

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
                  return (
                    <tr key={item.id}>
                      <td className="px-4 py-3 print:border print:border-gray-300">{item.item?.name_ar || 'غير معروف'} <span className="text-gray-500">({item.item?.code || '-'})</span></td>
                      <td className="px-4 py-3 print:border print:border-gray-300">{item.requested_quantity} {unitName}</td>
                      <td className="px-4 py-3 print:border print:border-gray-300">{item.approved_quantity ?? '-'} {item.approved_quantity ? unitName : ''}</td>
                      <td className="px-4 py-3 print:border print:border-gray-300">{item.received_quantity ?? '-'} {item.received_quantity ? unitName : ''}</td>
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
