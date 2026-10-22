import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { branchesService, CreateBranchData } from '../../services/branches.service'
import { BranchStatus } from '../../types/database.types'
import { Save, ArrowRight, AlertCircle } from 'lucide-react'
import { toUserMessage } from '../../lib/errors'

export default function BranchForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(isEdit)
  const [error, setError] = useState('')
  // this branch is the main warehouse now (it can only be moved by ticking another branch)
  const [wasMain, setWasMain] = useState(false)

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
      setError('فشل في تحميل بيانات الفرع: ' + toUserMessage(error))
    } else if (data) {
      setWasMain(Boolean(data.is_main_warehouse))
      setFormData({
        code: data.code,
        name: data.name,
        name_ar: data.name_ar,
        address: data.address || '',
        phone: data.phone || '',
        email: data.email || '',
        status: data.status,
        is_main_warehouse: data.is_main_warehouse,
        // NULL times load as '' for the time inputs and are saved back as NULL
        opening_time: data.opening_time ? data.opening_time.slice(0, 5) : '',
        closing_time: data.closing_time ? data.closing_time.slice(0, 5) : '',
      })
    }
    setFetchLoading(false)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')
    if (formData.is_main_warehouse && formData.status !== 'active') {
      setError('المخزن الرئيسي يجب أن يكون نشطاً')
      return
    }
    setLoading(true)

    // Ticking another branch moves the main warehouse (there is exactly one): ask before unticking the current one
    let replaceMain = false
    if (formData.is_main_warehouse && !wasMain) {
      const { data: currentMain, error: mainError } = await branchesService.getMainWarehouse()
      if (mainError) {
        setError('تعذر التحقق من المخزن الرئيسي: ' + toUserMessage(mainError))
        setLoading(false)
        return
      }
      if (currentMain && currentMain.id !== id) {
        if (!confirm(`المخزن الرئيسي حالياً هو "${currentMain.name_ar}".\nهل تريد نقل المخزن الرئيسي إلى هذا الفرع؟ سيُلغى تحديد "${currentMain.name_ar}" كمخزن رئيسي.`)) {
          setLoading(false)
          return
        }
        replaceMain = true
      }
    }

    // One database call. It checks the code is unique and that exactly one active branch is the main warehouse;
    // empty optional fields and times are saved as NULL ('' is not a valid TIME)
    const { error: saveError } = await branchesService.save(isEdit && id ? id : null, {
      ...formData,
      code: formData.code.trim(),
      name: formData.name.trim(),
      name_ar: formData.name_ar.trim(),
      ...(replaceMain ? { replace_main_warehouse: true } : {}),
    })

    if (saveError) {
      setError('فشل في حفظ البيانات: ' + toUserMessage(saveError))
      setLoading(false)
      return
    }
    navigate('/branches')
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
          type="button"
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
                disabled={wasMain}
                className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-60"
              />
              <span className="text-sm font-medium text-gray-700">هذا هو المخزن الرئيسي</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 mr-8">
              {wasMain
                ? 'هذا الفرع هو المخزن الرئيسي. لنقله افتح الفرع الآخر وحدده كمخزن رئيسي'
                : 'يوجد مخزن رئيسي واحد فقط؛ تحديد هذا الفرع ينقل المخزن الرئيسي إليه بعد التأكيد'}
            </p>
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
