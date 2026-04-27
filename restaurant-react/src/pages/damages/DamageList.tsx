import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { damagesService, DamageWithDetails } from '../../services/damages.service'
import { useAuth } from '../../contexts/AuthContext'
import { formatCurrency } from '../../lib/utils'
import { Plus, AlertTriangle, Eye, Package, Building2, Download } from 'lucide-react'
import { exportToExcel, damageColumns, statusTranslations, formatDateForExcel } from '../../lib/excel'

export default function DamageList() {
  const { user } = useAuth()
  const [damages, setDamages] = useState<DamageWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')

  useEffect(() => {
    fetchDamages()
  }, [user])

  const fetchDamages = async () => {
    // Get role name - handle both string and object formats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userObj = user as any
    const roleName = typeof userObj?.role === 'object' && userObj?.role !== null 
      ? userObj.role.name 
      : userObj?.role
    
    // Get branch_id - handle both direct and nested formats
    const userBranchId = userObj?.branch_id || userObj?.branch?.id
    
    console.log('DamageList Debug:', { roleName, userBranchId, user: userObj })
    
    const branchId = roleName !== 'admin' && roleName !== 'warehouse_manager' 
      ? userBranchId 
      : undefined
    
    console.log('Fetching damages with branchId:', branchId)
    
    const { data, error } = await damagesService.getAll(branchId)
    console.log('Damages result:', { data, error })
    setDamages(data || [])
    setLoading(false)
  }

  const filteredDamages = damages.filter(d => 
    filter === 'all' || d.status === filter
  )

  // Export to Excel
  const handleExport = () => {
    const exportData = filteredDamages.map(d => ({
      damage_number: d.damage_number || '',
      date: d.registered_at ? formatDateForExcel(d.registered_at) : '',
      branch_name: d.branch?.name_ar || '',
      item_code: d.item?.code || '',
      item_name: d.item?.name_ar || '',
      quantity: d.quantity || 0,
      reason: d.reason?.name_ar || '',
      total_cost: d.total_cost || 0,
      status: statusTranslations[d.status] || d.status,
    }))
    exportToExcel(exportData, damageColumns, 'سجل_التالف')
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
    }
    const labels: Record<string, string> = {
      pending: 'معلق',
      approved: 'موافق عليه',
      rejected: 'مرفوض',
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
        {labels[status]}
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">التالف</h1>
          <p className="text-gray-600">إدارة سجلات التالف والهالك</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            title="تصدير إلى Excel"
          >
            <Download className="w-5 h-5" />
            تصدير
          </button>
          <Link
            to="/damages/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            تسجيل تالف
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {(['all', 'pending', 'approved', 'rejected'] as const).map((status) => (
          <button
            type="button"
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === status
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {status === 'all' ? 'الكل' : 
             status === 'pending' ? 'معلق' :
             status === 'approved' ? 'موافق عليه' : 'مرفوض'}
          </button>
        ))}
      </div>

      {/* Damages Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">رقم السجل</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الصنف</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الفرع</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الكمية</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">التكلفة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">السبب</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الحالة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredDamages.map((damage) => (
                <tr key={damage.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                        <AlertTriangle className="w-5 h-5 text-red-600" />
                      </div>
                      <span className="font-medium text-gray-900">{damage.damage_number}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Package className="w-4 h-4" />
                      <span>{damage.item?.name_ar}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Building2 className="w-4 h-4" />
                      <span>{damage.branch?.name_ar}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{damage.quantity}</td>
                  <td className="px-6 py-4 text-gray-600">
                    {damage.total_cost ? formatCurrency(damage.total_cost) : '-'}
                  </td>
                  <td className="px-6 py-4 text-gray-600">{damage.reason?.name_ar}</td>
                  <td className="px-6 py-4">{getStatusBadge(damage.status)}</td>
                  <td className="px-6 py-4">
                    <Link
                      to={`/damages/${damage.id}`}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Eye className="w-4 h-4" />
                      عرض
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredDamages.length === 0 && (
          <div className="text-center py-12">
            <AlertTriangle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">لا توجد سجلات تالف</h3>
            <p className="text-gray-600 mb-4">ابدأ بتسجيل تالف جديد</p>
            <Link
              to="/damages/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              تسجيل تالف
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
