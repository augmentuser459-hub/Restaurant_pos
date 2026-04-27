import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { branchesService } from '../../services/branches.service'
import { Branch } from '../../types/database.types'
import { Plus, Edit, Trash2, Building2, MapPin, Phone, Mail } from 'lucide-react'

export default function BranchList() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  useEffect(() => {
    fetchBranches()
  }, [])

  const fetchBranches = async () => {
    const { data } = await branchesService.getAll()
    setBranches(data || [])
    setLoading(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا الفرع؟')) return
    
    setDeleteId(id)
    const { error } = await branchesService.delete(id)
    if (!error) {
      setBranches(branches.filter(b => b.id !== id))
    }
    setDeleteId(null)
  }

  const getStatusBadge = (status: string) => {
    const styles = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
      maintenance: 'bg-yellow-100 text-yellow-800',
    }
    const labels = {
      active: 'نشط',
      inactive: 'غير نشط',
      maintenance: 'صيانة',
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status as keyof typeof styles]}`}>
        {labels[status as keyof typeof labels]}
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
          <h1 className="text-2xl font-bold text-gray-900">الفروع</h1>
          <p className="text-gray-600">إدارة فروع المطعم والمخازن</p>
        </div>
        <Link
          to="/branches/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          فرع جديد
        </Link>
      </div>

      {/* Branches Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {branches.map((branch) => (
          <div key={branch.id} className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${branch.is_main_warehouse ? 'bg-purple-100' : 'bg-blue-100'}`}>
                  <Building2 className={`w-5 h-5 ${branch.is_main_warehouse ? 'text-purple-600' : 'text-blue-600'}`} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{branch.name_ar}</h3>
                  <p className="text-sm text-gray-500">{branch.code}</p>
                </div>
              </div>
              {getStatusBadge(branch.status)}
            </div>

            {branch.is_main_warehouse && (
              <div className="mb-3 px-2 py-1 bg-purple-50 text-purple-700 text-xs font-medium rounded inline-block">
                المخزن الرئيسي
              </div>
            )}

            <div className="space-y-2 text-sm text-gray-600">
              {branch.address && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  <span>{branch.address}</span>
                </div>
              )}
              {branch.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  <span dir="ltr">{branch.phone}</span>
                </div>
              )}
              {branch.email && (
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  <span dir="ltr">{branch.email}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100">
              <Link
                to={`/branches/${branch.id}/edit`}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                <Edit className="w-4 h-4" />
                تعديل
              </Link>
              <button
                onClick={() => handleDelete(branch.id)}
                disabled={deleteId === branch.id || branch.is_main_warehouse}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                {deleteId === branch.id ? 'جاري الحذف...' : 'حذف'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {branches.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-100">
          <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">لا توجد فروع</h3>
          <p className="text-gray-600 mb-4">ابدأ بإضافة فرع جديد</p>
          <Link
            to="/branches/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            إضافة فرع
          </Link>
        </div>
      )}
    </div>
  )
}
