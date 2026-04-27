import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { branchesService, CreateBranchData } from '../../services/branches.service'
import { BranchStatus } from '../../types/database.types'
import { Save, ArrowRight, AlertCircle } from 'lucide-react'

export default function BranchForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(isEdit)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState<CreateBranchData>({
    code: '',
    name: '',
    name_ar: '',
    address: '',
    phone: '',
    email: '',
    status: 'active',
    is_main_warehouse: false,
    opening_time: '',
    closing_time: '',
  })

  useEffect(() => {
    if (isEdit && id) {
      fetchBranch(id)
    }
  }, [id, isEdit])

  const fetchBranch = async (branchId: string) => {
    const { data, error } = await branchesService.getById(branchId)
    if (error) {
      setError('فشل في تحميل بيانات الفرع')
    } else if (data) {
      setFormData({
        code: data.code,
        name: data.name,
        name_ar: data.name_ar,
        address: data.address || '',
        phone: data.phone || '',
        email: data.email || '',
        status: data.status,
        is_main_warehouse: data.is_main_warehouse,
        opening_time: data.opening_time || '',
        closing_time: data.closing_time || '',
      })
    }
    setFetchLoading(false)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Validate code uniqueness
    const { exists } = await branchesService.codeExists(formData.code, id)
    if (exists) {
      setError('كود الفرع موجود مسبقاً')
      setLoading(false)
      return
    }

    const result = isEdit && id
      ? await branchesService.update(id, formData)
      : await branchesService.create(formData)

    if (result.error) {
      setError('فشل في حفظ البيانات')
    } else {
      navigate('/branches')
    }
    setLoading(false)
  }

  const handleChange = (field: keyof CreateBranchData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  if (fetchLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/branches')}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="رجوع"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isEdit ? 'تعديل الفرع' : 'فرع جديد'}
          </h1>
          <p className="text-gray-600">
            {isEdit ? 'تعديل بيانات الفرع' : 'إضافة فرع جديد للنظام'}
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              كود الفرع <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => handleChange('code', e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="BR001"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              الحالة
            </label>
            <select
              value={formData.status}
              onChange={(e) => handleChange('status', e.target.value as BranchStatus)}
              aria-label="الحالة"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
              <option value="maintenance">صيانة</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              الاسم (إنجليزي) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Branch Name"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              الاسم (عربي) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name_ar}
              onChange={(e) => handleChange('name_ar', e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="اسم الفرع"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              العنوان
            </label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => handleChange('address', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="عنوان الفرع"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              رقم الهاتف
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="+20 123 456 7890"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              البريد الإلكتروني
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="branch@example.com"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              وقت الفتح
            </label>
            <input
              type="time"
              value={formData.opening_time}
              onChange={(e) => handleChange('opening_time', e.target.value)}
              aria-label="وقت الفتح"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              وقت الإغلاق
            </label>
            <input
              type="time"
              value={formData.closing_time}
              onChange={(e) => handleChange('closing_time', e.target.value)}
              aria-label="وقت الإغلاق"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="md:col-span-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_main_warehouse}
                onChange={(e) => handleChange('is_main_warehouse', e.target.checked)}
                className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">هذا هو المخزن الرئيسي</span>
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4 pt-6 border-t border-gray-100">
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <>
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                جاري الحفظ...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                حفظ
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate('/branches')}
            className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            إلغاء
          </button>
        </div>
      </form>
    </div>
  )
}
