import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { transfersService, TransferWithDetails } from '../../services/transfers.service'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate } from '../../lib/utils'
import { Plus, ArrowLeftRight, Eye, Building2, Download } from 'lucide-react'
import { exportToExcel, transferColumns, statusTranslations, formatDateForExcel } from '../../lib/excel'

export default function TransferList() {
  const { user } = useAuth()
  const [transfers, setTransfers] = useState<TransferWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'received'>('all')

  useEffect(() => {
    fetchTransfers()
  }, [user])

  const fetchTransfers = async () => {
    // Get role name - handle both string and object formats
    const roleName = typeof user?.role === 'object' && user?.role !== null 
      ? (user.role as { name: string }).name 
      : user?.role
    
    const branchId = roleName !== 'admin' && roleName !== 'warehouse_manager' 
      ? user?.branch_id 
      : undefined
    const { data } = await transfersService.getAll(branchId)
    setTransfers(data || [])
    setLoading(false)
  }

  const filteredTransfers = transfers.filter(t => 
    filter === 'all' || t.status === filter
  )

  // Export to Excel
  const handleExport = () => {
    // Flatten transfers with items
    const exportData: Record<string, unknown>[] = []
    filteredTransfers.forEach(t => {
      const items = Array.isArray(t.items) ? t.items : []
      if (items.length === 0) {
        exportData.push({
          transfer_number: t.transfer_number || '',
          transfer_date: t.transfer_date ? formatDateForExcel(t.transfer_date) : '',
          from_branch: t.from_branch?.name_ar || '',
          to_branch: t.to_branch?.name_ar || '',
          item_code: '',
          item_name: '',
          quantity: 0,
          status: statusTranslations[t.status] || t.status,
        })
      } else {
        items.forEach(item => {
          exportData.push({
            transfer_number: t.transfer_number || '',
            transfer_date: t.transfer_date ? formatDateForExcel(t.transfer_date) : '',
            from_branch: t.from_branch?.name_ar || '',
            to_branch: t.to_branch?.name_ar || '',
            item_code: item.item?.code || '',
            item_name: item.item?.name_ar || '',
            quantity: item.requested_quantity || 0,
            status: statusTranslations[t.status] || t.status,
          })
        })
      }
    })
    exportToExcel(exportData, transferColumns, 'التحويلات')
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-blue-100 text-blue-800',
      rejected: 'bg-red-100 text-red-800',
      received: 'bg-green-100 text-green-800',
      cancelled: 'bg-gray-100 text-gray-800',
    }
    const labels: Record<string, string> = {
      pending: 'معلق',
      approved: 'موافق عليه',
      rejected: 'مرفوض',
      received: 'مستلم',
      cancelled: 'ملغي',
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
          <h1 className="text-2xl font-bold text-gray-900">التحويلات</h1>
          <p className="text-gray-600">إدارة تحويلات المخزون بين الفروع</p>
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
            to="/transfers/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            تحويل جديد
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {(['all', 'pending', 'approved', 'received'] as const).map((status) => (
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
             status === 'approved' ? 'موافق عليه' : 'مستلم'}
          </button>
        ))}
      </div>

      {/* Transfers Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">رقم التحويل</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">من</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">إلى</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">التاريخ</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">عدد الأصناف</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الحالة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredTransfers.map((transfer) => (
                <tr key={transfer.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                        <ArrowLeftRight className="w-5 h-5 text-indigo-600" />
                      </div>
                      <span className="font-medium text-gray-900">{transfer.transfer_number}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Building2 className="w-4 h-4" />
                      <span>{transfer.from_branch?.name_ar}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Building2 className="w-4 h-4" />
                      <span>{transfer.to_branch?.name_ar}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{transfer.created_at ? formatDate(transfer.created_at) : '-'}</td>
                  <td className="px-6 py-4 text-gray-600">{Array.isArray(transfer.items) ? transfer.items.length : 0}</td>
                  <td className="px-6 py-4">{getStatusBadge(transfer.status)}</td>
                  <td className="px-6 py-4">
                    <Link
                      to={`/transfers/${transfer.id}`}
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

        {filteredTransfers.length === 0 && (
          <div className="text-center py-12">
            <ArrowLeftRight className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">لا توجد تحويلات</h3>
            <p className="text-gray-600 mb-4">ابدأ بإنشاء تحويل جديد</p>
            <Link
              to="/transfers/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              تحويل جديد
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
