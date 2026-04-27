import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { damagesService, DamageWithDetails } from '../../services/damages.service'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate, formatCurrency, getStatusColor, translateStatus } from '../../lib/utils'
import { ArrowRight, Building2, Package, AlertTriangle, Check, X, Printer } from 'lucide-react'

export default function DamageDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [damage, setDamage] = useState<DamageWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    if (id) fetchDamage(id)
  }, [id])

  const fetchDamage = async (damageId: string) => {
    const { data } = await damagesService.getById(damageId)
    setDamage(data)
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

  const handleApprove = async () => {
    if (!damage || !user) return
    setActionLoading(true)
    await damagesService.approve(damage.id, user.id)
    fetchDamage(damage.id)
    setActionLoading(false)
  }

  const handleReject = async () => {
    if (!damage || !user) return
    const reason = prompt('سبب الرفض:')
    if (reason === null) return
    setActionLoading(true)
    await damagesService.reject(damage.id, user.id, reason)
    fetchDamage(damage.id)
    setActionLoading(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  if (!damage) {
    return <div className="text-center py-12"><p className="text-gray-600">سجل التالف غير موجود</p></div>
  }

  // Get user role
  const userRole = typeof user?.role === 'object' && user?.role !== null 
    ? (user.role as { name: string }).name 
    : user?.role

  // Admin and warehouse_manager can approve any damage
  // Branch supervisor can approve damages in their branch
  const canApprove = damage.status === 'pending' && (
    userRole === 'admin' || 
    userRole === 'warehouse_manager' ||
    (userRole === 'branch_supervisor' && user?.branch_id === damage.branch_id)
  )

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4 print:hidden">
        <button type="button" onClick={() => navigate('/damages')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">تفاصيل التالف</h1>
          <p className="text-gray-600">{damage.damage_number}</p>
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
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(damage.status)}`}>
          {translateStatus(damage.status)}
        </span>
      </div>

      {/* Print Header - Only visible when printing */}
      <div className="hidden print:block text-center mb-6">
        <h1 className="text-2xl font-bold">تفاصيل التالف</h1>
        <p className="text-lg text-gray-600 mt-2">{damage.damage_number}</p>
        <p className="text-sm text-gray-500 mt-1">تاريخ الطباعة: {formatDate(new Date().toISOString())}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 print:hidden" /> الفرع
          </h3>
          <p className="text-lg font-medium">{damage.branch?.name_ar}</p>
          <p className="text-sm text-gray-500">{damage.branch?.code}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 print:hidden" /> الصنف
          </h3>
          <p className="text-lg font-medium">{damage.item?.name_ar}</p>
          <p className="text-sm text-gray-500">{damage.item?.code}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-500 print:hidden" /> تفاصيل التالف
        </h3>
        <div className="grid grid-cols-2 gap-4 text-sm print:gap-2">
          <div><span className="text-gray-500">التاريخ:</span> <span className="font-medium">{formatDate(damage.registered_at)}</span></div>
          <div><span className="text-gray-500">الكمية:</span> <span className="font-medium">{damage.quantity}</span></div>
          <div><span className="text-gray-500">تكلفة الوحدة:</span> <span className="font-medium">{damage.unit_cost ? formatCurrency(damage.unit_cost) : '-'}</span></div>
          <div><span className="text-gray-500">إجمالي التكلفة:</span> <span className="font-medium text-red-600">{damage.total_cost ? formatCurrency(damage.total_cost) : '-'}</span></div>
          <div><span className="text-gray-500">السبب:</span> <span className="font-medium">{damage.reason?.name_ar || '-'}</span></div>
          {damage.description && <div className="col-span-2"><span className="text-gray-500">الوصف:</span> <span className="font-medium">{damage.description}</span></div>}
        </div>
      </div>

      {canApprove && (
        <div className="flex gap-3 print:hidden">
          <button type="button" onClick={handleApprove} disabled={actionLoading}
            className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            <Check className="w-5 h-5" /> موافقة
          </button>
          <button type="button" onClick={handleReject} disabled={actionLoading}
            className="flex items-center gap-2 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
            <X className="w-5 h-5" /> رفض
          </button>
        </div>
      )}
    </div>
  )
}
