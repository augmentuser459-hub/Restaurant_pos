import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { suppliersService, CreateSupplierData } from '../../services/suppliers.service'
import { SupplierStatus, PaymentMethod } from '../../types/database.types'
import { Save, ArrowRight, AlertCircle } from 'lucide-react'

export default function SupplierForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(isEdit)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState<CreateSupplierData>({
    code: '',
    name: '',
    name_ar: '',
    phone: '',
    email: '',
    address: '',
    contact_person: '',
    payment_terms: 'cash',
    credit_limit: 0,
    status: 'active',
    notes: '',
  })

  useEffect(() => {
    if (isEdit && id) {
      fetchSupplier(id)
    }
  }, [id, isEdit])

  const fetchSupplier = async (supplierId: string) => {
    const { data, error } = await suppliersService.getById(supplierId)
    if (error) {
      setError('فشل في تحميل بيانات المورد')
    } else if (data) {
      setFormData({
        code: data.code,
        name: data.name,
        name_ar: data.name_ar,
        phone: data.phone || '',
        email: data.email || '',
        address: data.address || '',
        contact_person: data.contact_person || '',
        payment_terms: data.payment_terms || 'cash',
        credit_limit: data.credit_limit || 0,
        status: data.status,
        notes: data.notes || '',
      })
    }
    setFetchLoading(false)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { exists } = await suppliersService.codeExists(formData.code, id)
    if (exists) {
      setError('كود المورد موجود مسبقاً')
      setLoading(false)
      return
    }

    const result = isEdit && id
      ? await suppliersService.update(id, formData)
      : await suppliersService.create(formData)

    if (result.error) {
      setError('فشل في حفظ البيانات')
    } else {
      navigate('/suppliers')
    }
    setLoading(false)
  }

  const handleChange = (field: keyof CreateSupplierData, value: string | number) => {
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
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/suppliers')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'تعديل المورد' : 'مورد جديد'}</h1>
          <p className="text-gray-600">{isEdit ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">كود المورد <span className="text-red-500">*</span></label>
            <input type="text" value={formData.code} onChange={(e) => handleChange('code', e.target.value)} required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="SUP001" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">الحالة</label>
            <select value={formData.status} onChange={(e) => handleChange('status', e.target.value as SupplierStatus)}
              aria-label="الحالة"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">الاسم (إنجليزي) <span className="text-red-500">*</span></label>
            <input type="text" value={formData.name} onChange={(e) => handleChange('name', e.target.value)} required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="Supplier Name" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">الاسم (عربي) <span className="text-red-500">*</span></label>
            <input type="text" value={formData.name_ar} onChange={(e) => handleChange('name_ar', e.target.value)} required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="اسم المورد" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">جهة الاتصال</label>
            <input type="text" value={formData.contact_person} onChange={(e) => handleChange('contact_person', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="اسم المسؤول" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">رقم الهاتف</label>
            <input type="tel" value={formData.phone} onChange={(e) => handleChange('phone', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="+20 123 456 7890" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">البريد الإلكتروني</label>
            <input type="email" value={formData.email} onChange={(e) => handleChange('email', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="supplier@example.com" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">شروط الدفع</label>
            <select value={formData.payment_terms} onChange={(e) => handleChange('payment_terms', e.target.value as PaymentMethod)}
              aria-label="شروط الدفع"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="cash">نقدي</option>
              <option value="credit">آجل</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">العنوان</label>
            <input type="text" value={formData.address} onChange={(e) => handleChange('address', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="عنوان المورد" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">حد الائتمان</label>
            <input type="number" value={formData.credit_limit} onChange={(e) => handleChange('credit_limit', Number(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="0" dir="ltr" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
            <textarea value={formData.notes} onChange={(e) => handleChange('notes', e.target.value)} rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="ملاحظات إضافية..." />
          </div>
        </div>

        <div className="flex items-center gap-4 pt-6 border-t border-gray-100">
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />جاري الحفظ...</> : <><Save className="w-5 h-5" />حفظ</>}
          </button>
          <button type="button" onClick={() => navigate('/suppliers')} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">إلغاء</button>
        </div>
      </form>
    </div>
  )
}
