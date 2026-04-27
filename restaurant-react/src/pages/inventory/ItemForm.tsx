import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { inventoryService } from '../../services/inventory.service'
import { Category, ItemStatus } from '../../types/database.types'
import { Save, ArrowRight, AlertCircle, Barcode } from 'lucide-react'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface Unit {
  id: string
  code: string
  name_ar: string
}

interface ItemFormData {
  code: string
  barcode: string
  name: string
  name_ar: string
  description?: string
  unit_id: string
  category_id?: string
  min_stock_level: number
  max_stock_level?: number
  reorder_level?: number
  purchase_price?: number
  selling_price?: number
  status?: ItemStatus
}

export default function ItemForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isEdit = Boolean(id)

  // Get user role
  const userRole = typeof user?.role === 'object' && user?.role !== null 
    ? (user.role as { name: string }).name 
    : user?.role

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
    min_stock_level: 10,
    max_stock_level: 100,
    reorder_level: 20,
    purchase_price: 0,
    selling_price: 0,
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
    setCategories(categoriesRes.data || [])
    setUnits(fixEncodingInData(unitsRes.data) as Unit[] || [])
  }

  const fetchItem = async (itemId: string) => {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('id', itemId)
      .single()
    
    if (error) {
      setError('فشل في تحميل بيانات الصنف')
    } else if (data) {
      setFormData({
        code: data.code,
        barcode: data.barcode || '',
        name: data.name,
        name_ar: data.name_ar,
        description: data.description || '',
        unit_id: data.unit_id || '',
        category_id: data.category_id || '',
        min_stock_level: data.min_stock_level || 10,
        max_stock_level: data.max_stock_level || 100,
        reorder_level: data.reorder_level || 20,
        purchase_price: data.purchase_price || 0,
        selling_price: data.selling_price || 0,
        status: data.status || 'active',
      })
    }
    setFetchLoading(false)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Check if code exists
    const { exists } = await inventoryService.itemCodeExists(formData.code, id)
    if (exists) {
      setError(`كود الصنف "${formData.code}" موجود مسبقاً. يمكنك مشاهدة جميع الأصناف من قائمة الأصناف أو استخدام كود مختلف.`)
      setLoading(false)
      return
    }

    const itemData = {
      ...formData,
      category_id: formData.category_id || null,
    }

    let result
    if (isEdit && id) {
      result = await supabase
        .from('items')
        .update({ ...itemData, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
    } else {
      result = await supabase
        .from('items')
        .insert(itemData)
        .select()
        .single()
    }

    if (result.error) {
      setError('فشل في حفظ البيانات: ' + result.error.message)
    } else {
      // If creating new item, add inventory record for main warehouse with quantity 0
      if (!isEdit && result.data) {
        // Get main warehouse (المخزن الرئيسي)
        const { data: mainBranch } = await supabase
          .from('branches')
          .select('id')
          .eq('is_main_warehouse', true)
          .single()

        if (mainBranch) {
          // Create inventory record with 0 quantity
          await supabase
            .from('inventory')
            .insert({
              branch_id: mainBranch.id,
              item_id: result.data.id,
              quantity: 0,
              min_quantity: formData.min_stock_level || 0
            })
        }
      }
      navigate(backPath)
    }
    setLoading(false)
  }

  const handleChange = (field: keyof ItemFormData, value: string | number) => {
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
              step="0.01"
              value={formData.purchase_price}
              onChange={(e) => handleChange('purchase_price', Number(e.target.value))}
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
              step="0.01"
              value={formData.selling_price}
              onChange={(e) => handleChange('selling_price', Number(e.target.value))}
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
              onChange={(e) => handleChange('min_stock_level', Number(e.target.value))}
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
              onChange={(e) => handleChange('max_stock_level', Number(e.target.value))}
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
