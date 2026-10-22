import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { inventoryService } from '../../services/inventory.service'
import { Category, ItemStatus } from '../../types/database.types'
import { Save, ArrowRight, AlertCircle, Barcode } from 'lucide-react'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toUserMessage } from '../../lib/errors'
import { parseDecimal, roundMoney, roundQuantity } from '../../lib/utils'
import { roleName } from './stockHelpers'

interface Unit {
  id: string
  code: string
  name_ar: string
}

// Number fields are kept as typed text and validated on save
interface ItemFormData {
  code: string
  barcode: string
  name: string
  name_ar: string
  description: string
  unit_id: string
  category_id: string
  min_stock_level: string
  max_stock_level: string
  reorder_level: string
  purchase_price: string
  selling_price: string
  status: ItemStatus
}

const numberText = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value))

export default function ItemForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isEdit = Boolean(id)

  // Get user role
  const userRole = roleName(user?.role)

  // Determine back path based on role
  const backPath = userRole === 'warehouse_manager' ? '/transfers' : '/inventory'

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(isEdit)
  const [error, setError] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [units, setUnits] = useState<Unit[]>([])

  const [formData, setFormData] = useState<ItemFormData>({
    code: '',
    barcode: '',
    name: '',
    name_ar: '',
    description: '',
    unit_id: '',
    category_id: '',
    min_stock_level: '10',
    max_stock_level: '100',
    reorder_level: '20',
    purchase_price: '0',
    selling_price: '0',
    status: 'active',
  })

  useEffect(() => {
    fetchData()
    if (isEdit && id) fetchItem(id)
  }, [id, isEdit])

  const fetchData = async () => {
    const [categoriesRes, unitsRes] = await Promise.all([
      inventoryService.getCategories(),
      supabase.from('units').select('id, code, name_ar').eq('is_active', true).order('name_ar'),
    ])
    if (categoriesRes.error || unitsRes.error) {
      setError('تعذر تحميل المجموعات أو الوحدات: ' + toUserMessage(categoriesRes.error || unitsRes.error))
    }
    setCategories(categoriesRes.data || [])
    setUnits((fixEncodingInData(unitsRes.data) as Unit[]) || [])
  }

  const fetchItem = async (itemId: string) => {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('id', itemId)
      .single()

    if (error) {
      setError('فشل في تحميل بيانات الصنف: ' + toUserMessage(error))
    } else if (data) {
      // ?? keeps a stored 0 (|| would replace it with the defaults and write them back on save)
      setFormData({
        code: data.code,
        barcode: data.barcode ?? '',
        name: data.name ?? '',
        name_ar: data.name_ar ?? '',
        description: data.description ?? '',
        unit_id: data.unit_id ?? '',
        category_id: data.category_id ?? '',
        min_stock_level: numberText(data.min_stock_level ?? 0),
        max_stock_level: numberText(data.max_stock_level),
        reorder_level: numberText(data.reorder_level),
        purchase_price: numberText(data.purchase_price ?? 0),
        selling_price: numberText(data.selling_price ?? 0),
        status: data.status ?? 'active',
      })
    }
    setFetchLoading(false)
  }

  /** Empty -> null; invalid or negative -> error message. */
  const readNumber = (value: string, label: string): { value: number | null; error?: string } => {
    if (value.trim() === '') return { value: null }
    const parsed = parseDecimal(value)
    if (parsed === null) return { value: null, error: `قيمة "${label}" غير صحيحة` }
    if (parsed < 0) return { value: null, error: `قيمة "${label}" لا يمكن أن تكون سالبة` }
    return { value: parsed }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')

    const purchase = readNumber(formData.purchase_price, 'سعر الشراء')
    const selling = readNumber(formData.selling_price, 'سعر البيع')
    const minLevel = readNumber(formData.min_stock_level, 'الحد الأدنى')
    const maxLevel = readNumber(formData.max_stock_level, 'الحد الأقصى')
    const reorder = readNumber(formData.reorder_level, 'حد إعادة الطلب')
    const numberError = [purchase, selling, minLevel, maxLevel, reorder].find(n => n.error)?.error
    if (numberError) {
      setError(numberError)
      return
    }

    setLoading(true)

    // One database call: code/barcode uniqueness checked there; empty barcode saved as NULL
    // (items.barcode is UNIQUE, so '' could be stored only once); a new item also gets its main-warehouse stock row
    const { error: saveError } = await inventoryService.saveItem(isEdit && id ? id : null, {
      code: formData.code.trim(),
      barcode: formData.barcode.trim() || null,
      name: formData.name.trim(),
      name_ar: formData.name_ar.trim(),
      description: formData.description.trim() || null,
      unit_id: formData.unit_id,
      category_id: formData.category_id || null,
      purchase_price: roundMoney(purchase.value ?? 0),
      selling_price: roundMoney(selling.value ?? 0),
      min_stock_level: roundQuantity(minLevel.value ?? 0),
      max_stock_level: maxLevel.value === null ? null : roundQuantity(maxLevel.value),
      reorder_level: reorder.value === null ? null : roundQuantity(reorder.value),
      status: formData.status,
    })

    if (saveError) {
      setError('فشل في حفظ البيانات: ' + toUserMessage(saveError))
      setLoading(false)
      return
    }
    navigate(backPath)
  }

  const handleChange = (field: keyof ItemFormData, value: string) => {
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
        <button
          type="button"
          onClick={() => navigate(backPath)}
          className="p-2 hover:bg-gray-100 rounded-lg"
          title="رجوع"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isEdit ? 'تعديل الصنف' : 'صنف جديد'}
          </h1>
          <p className="text-gray-600">
            {isEdit ? 'تعديل بيانات الصنف' : 'إضافة صنف جديد للمخزن'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-700">{error}</p>
              {error.includes('موجود مسبقاً') && (
                <Link
                  to="/inventory/items"
                  className="inline-flex items-center gap-1 mt-2 text-sm text-red-600 hover:text-red-700 underline"
                >
                  عرض قائمة الأصناف
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Code */}
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-2">
              كود الصنف <span className="text-red-500">*</span>
            </label>
            <input
              id="code"
              type="text"
              value={formData.code}
              onChange={(e) => handleChange('code', e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="ITM001"
              dir="ltr"
            />
          </div>

          {/* Barcode */}
          <div>
            <label htmlFor="barcode" className="block text-sm font-medium text-gray-700 mb-2">
              <span className="flex items-center gap-2">
                <Barcode className="w-4 h-4" />
                الباركود
              </span>
            </label>
            <input
              id="barcode"
              type="text"
              value={formData.barcode}
              onChange={(e) => handleChange('barcode', e.target.value)}
              onKeyDown={(e) => {
                // a scanner's Enter must not save the form before the rest is filled in
                if (e.key === 'Enter') e.preventDefault()
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="1234567890123"
              dir="ltr"
            />
            <p className="text-xs text-gray-500 mt-1">امسح الباركود أو أدخله يدوياً</p>
          </div>

          {/* Status */}
          <div>
            <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-2">
              الحالة
            </label>
            <select
              id="status"
              value={formData.status}
              onChange={(e) => handleChange('status', e.target.value as ItemStatus)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
            </select>
          </div>

          {/* Name English */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
              الاسم (إنجليزي) <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Item Name"
              dir="ltr"
            />
          </div>

          {/* Name Arabic */}
          <div>
            <label htmlFor="name_ar" className="block text-sm font-medium text-gray-700 mb-2">
              الاسم (عربي) <span className="text-red-500">*</span>
            </label>
            <input
              id="name_ar"
              type="text"
              value={formData.name_ar}
              onChange={(e) => handleChange('name_ar', e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="اسم الصنف"
            />
          </div>

          {/* Unit */}
          <div>
            <label htmlFor="unit_id" className="block text-sm font-medium text-gray-700 mb-2">
              الوحدة <span className="text-red-500">*</span>
            </label>
            <select
              id="unit_id"
              value={formData.unit_id}
              onChange={(e) => handleChange('unit_id', e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">اختر الوحدة</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name_ar} ({unit.code})
                </option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div>
            <label htmlFor="category_id" className="block text-sm font-medium text-gray-700 mb-2">
              التصنيف
            </label>
            <select
              id="category_id"
              value={formData.category_id}
              onChange={(e) => handleChange('category_id', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">بدون تصنيف</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name_ar}
                </option>
              ))}
            </select>
          </div>

          {/* Purchase Price */}
          <div>
            <label htmlFor="purchase_price" className="block text-sm font-medium text-gray-700 mb-2">
              سعر الشراء
            </label>
            <input
              id="purchase_price"
              type="number"
              min="0"
              step="0.01"
              value={formData.purchase_price}
              onChange={(e) => handleChange('purchase_price', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="0.00"
              dir="ltr"
            />
          </div>

          {/* Selling Price */}
          <div>
            <label htmlFor="selling_price" className="block text-sm font-medium text-gray-700 mb-2">
              سعر البيع
            </label>
            <input
              id="selling_price"
              type="number"
              min="0"
              step="0.01"
              value={formData.selling_price}
              onChange={(e) => handleChange('selling_price', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="0.00"
              dir="ltr"
            />
          </div>

          {/* Min Stock */}
          <div>
            <label htmlFor="min_stock_level" className="block text-sm font-medium text-gray-700 mb-2">
              الحد الأدنى
            </label>
            <input
              id="min_stock_level"
              type="number"
              min="0"
              step="0.001"
              value={formData.min_stock_level}
              onChange={(e) => handleChange('min_stock_level', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="10"
              dir="ltr"
            />
          </div>

          {/* Max Stock */}
          <div>
            <label htmlFor="max_stock_level" className="block text-sm font-medium text-gray-700 mb-2">
              الحد الأقصى
            </label>
            <input
              id="max_stock_level"
              type="number"
              min="0"
              step="0.001"
              value={formData.max_stock_level}
              onChange={(e) => handleChange('max_stock_level', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="100"
              dir="ltr"
            />
          </div>

          {/* Description */}
          <div className="md:col-span-2">
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
              الوصف
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              rows={2}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="وصف الصنف..."
            />
          </div>
        </div>

        <div className="flex items-center gap-4 pt-6 border-t border-gray-100">
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
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
            onClick={() => navigate(backPath)}
            className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            إلغاء
          </button>
        </div>
      </form>
    </div>
  )
}
