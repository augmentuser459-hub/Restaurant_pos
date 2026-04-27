import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { dailyCountService, DailyCountWithDetails } from '../../services/dailyCount.service'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate, translateStatus, getStatusColor } from '../../lib/utils'
import { Plus, ClipboardList, Eye, Building2 } from 'lucide-react'

export default function DailyCountList() {
  const { user } = useAuth()
  const [counts, setCounts] = useState<DailyCountWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCounts()
  }, [user])

  const fetchCounts = async () => {
    const branchId = user?.role !== 'admin' ? user?.branch_id : undefined
    const { data } = await dailyCountService.getAll(branchId)
    setCounts(data || [])
    setLoading(false)
  }

  const getCountTypeBadge = (type: string) => {
    return type === 'opening' 
      ? <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">افتتاحي</span>
      : <span className="px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">ختامي</span>
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">الجرد اليومي</h1>
          <p className="text-gray-600">سجلات الجرد اليومي للمخزون</p>
        </div>
        <Link to="/inventory/daily-count/new" className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <Plus className="w-5 h-5" /> جرد جديد
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">التاريخ</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الفرع</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">النوع</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الحالة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {counts.map((count) => (
                <tr key={count.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                        <ClipboardList className="w-5 h-5 text-purple-600" />
                      </div>
                      <span className="font-medium text-gray-900">{formatDate(count.count_date)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Building2 className="w-4 h-4" />
                      <span>{count.branch?.name_ar}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">{getCountTypeBadge(count.count_type)}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(count.status)}`}>
                      {translateStatus(count.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <Link to={`/inventory/daily-count/${count.id}`} className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg">
                      <Eye className="w-4 h-4" /> عرض
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {counts.length === 0 && (
          <div className="text-center py-12">
            <ClipboardList className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">لا توجد سجلات جرد</h3>
            <p className="text-gray-600 mb-4">ابدأ بإنشاء جرد يومي جديد</p>
            <Link to="/inventory/daily-count/new" className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <Plus className="w-5 h-5" /> جرد جديد
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
