import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { Save, ArrowRight, Package, ChefHat, Search } from 'lucide-react'

interface CategoryFormData {
  code: string
  name: string
  name_ar: string
  description: string
  sort_order: number
  is_active: boolean
}

interface Item {
  id: string
  code: string
  name_ar: string
  is_recipe: boolean
  category_id: string | null
}

export default function CategoryForm() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const categoryType = searchParams.get('type') || 'items'

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(isEdit)
  const [error, setError] = useState('')
  
  const [formData, setFormData] = useState<CategoryFormData>({
    code: '',
    name: '',
    name_ar: '',
    description: '',
    sort_order: 0,
    is_active: true,
  })

  const [allItems, setAllItems] = useState<Item[]>([])
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetchItems()
    if (isEdit && id) fetchCategory(id)
  }, [id, isEdit, categoryType])

  const fetchItems = async () => {
    // Fetch items based on category type
    const { data, error } = await supabase
      .from('items')
      .select('id, code, name_ar, is_recipe, category_id')
      .eq('is_recipe', categoryType === 'recipes')
      .eq('status', 'active')
      .order('name_ar')

    if (!error && data) {
      setAllItems(fixEncodingInData(data) as Item[])
    }
  }

  const fetchCategory = async (categoryId: string) => {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('id', categoryId)
      .single()

    if (error) {
      setError('فشل في تحميل بيانات المجموعة')
    } else if (data) {
      setFormData({
        code: data.code,
        name: data.name,
        name_ar: data.name_ar,
        description: data.description || '',
        sort_order: data.sort_order || 0,
        is_active: data.is_active,
      })

      // Get items in this category
      const itemsInCategory = allItems
        .filter(item => item.category_id === categoryId)
        .map(item => item.id)
      setSelectedItems(new Set(itemsInCategory))
    }
    setFetchLoading(false)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Check if code exists
    const { data: existing } = await supabase
      .from('categories')
      .select('id')
      .eq('code', formData.code)
      .neq('id', id || '')
      .single()

    if (existing) {
      setError(`كود المجموعة "${formData.code}" موجود مسبقاً`)
      setLoading(false)
      return
    }

    let categoryId = id

    if (isEdit && id) {
      // Update category
      const { error: updateError } = await supabase
        .from('categories')
        .update({
          ...formData,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)

      if (updateError) {
        setError('فشل في تحديث المجموعة: ' + updateError.message)
        setLoading(false)
        return
      }
    } else {
      // Create category
      const { data: newCategory, error: createError } = await supabase
        .from('categories')
        .insert(formData)
        .select()
        .single()

      if (createError || !newCategory) {
        setError('فشل في إنشاء المجموعة: ' + (createError?.message || ''))
        setLoading(false)
        return
      }
      categoryId = newCategory.id
    }

    // Update item categories
    if (categoryId) {
      // Remove category from items not selected
      const itemsToRemove = allItems
        .filter(item => item.category_id === categoryId && !selectedItems.has(item.id))
        .map(item => item.id)

      if (itemsToRemove.length > 0) {
        await supabase
          .from('items')
          .update({ category_id: null })
          .in('id', itemsToRemove)
      }

      // Add category to selected items
      if (selectedItems.size > 0) {
        await supabase
          .from('items')
          .update({ category_id: categoryId })
          .in('id', Array.from(selectedItems))
      }
    }

    navigate('/categories')
    setLoading(false)
  }

  const handleChange = (field: keyof CategoryFormData, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const toggleItemSelection = (itemId: string) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev)
      if (newSet.has(itemId)) {
        newSet.delete(itemId)
      } else {
        newSet.add(itemId)
      }
      return newSet
    })
  }

  const filteredItems = allItems.filter(item =>
    item.name_ar.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.code.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (fetchLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button
          type="button"
          onClick={() => navigate('/categories')}
          className="p-2 hover:bg-gray-100 rounded-lg"
          title="رجوع"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            {categoryType === 'items' ? (
              <Package className="w-6 h-6 text-blue-600" />
            ) : (
              <ChefHat className="w-6 h-6 text-blue-600" />
            )}
            {isEdit ? 'تعديل المجموعة' : 'مجموعة جديدة'}
          </h1>
          <p className="text-gray-600">
            {categoryType === 'items' ? 'مجموعة أصناف' : 'مجموعة وصفات'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Category Details */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">بيانات المجموعة</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-2">
                الكود <span className="text-red-500">*</span>
              </label>
              <input
                id="code"
                type="text"
                value={formData.code}
                onChange={(e) => handleChange('code', e.target.value)}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="CAT-001"
                dir="ltr"
              />
            </div>

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
                placeholder="اسم المجموعة"
              />
            </div>

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
                placeholder="Category Name"
                dir="ltr"
              />
            </div>

            <div>
              <label htmlFor="sort_order" className="block text-sm font-medium text-gray-700 mb-2">
                ترتيب العرض
              </label>
              <input
                id="sort_order"
                type="number"
                value={formData.sort_order}
                onChange={(e) => handleChange('sort_order', Number(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                dir="ltr"
              />
            </div>

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
                placeholder="وصف المجموعة..."
              />
            </div>

            <div className="md:col-span-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => handleChange('is_active', e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">نشط</span>
              </label>
            </div>
          </div>
        </div>

        {/* Assign Items */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">
              تعيين {categoryType === 'items' ? 'الأصناف' : 'الوصفات'}
            </h2>
            <span className="text-sm text-gray-600">
              {selectedItems.size} محدد
            </span>
          </div>

          {/* Search */}
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="بحث..."
                className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Items List */}
          <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
            {filteredItems.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                لا توجد {categoryType === 'items' ? 'أصناف' : 'وصفات'}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredItems.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => toggleItemSelection(item.id)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{item.name_ar}</p>
                      <p className="text-sm text-gray-500">{item.code}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
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
            onClick={() => navigate('/categories')}
            className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            إلغاء
          </button>
        </div>
      </form>
    </div>
  )
}
