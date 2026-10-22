import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { fetchAll } from '../../lib/fetchAll'
import { toUserMessage } from '../../lib/errors'
import { inventoryService } from '../../services/inventory.service'
import { Save, ArrowRight, Package, ChefHat, Search, X } from 'lucide-react'

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
  // Items that were in the category when the page loaded (to send only what changed)
  const [originalItems, setOriginalItems] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    loadData()
  }, [id, isEdit, categoryType])

  const loadData = async () => {
    setError('')
    let items: Item[] = []
    try {
      // All items of this type (more than the 1000 rows one request returns)
      const data = await fetchAll<Item>((from, to) =>
        supabase
          .from('items')
          .select('id, code, name_ar, is_recipe, category_id')
          .eq('is_recipe', categoryType === 'recipes')
          .eq('status', 'active')
          .order('name_ar')
          .order('id')
          .range(from, to)
      )
      items = fixEncodingInData(data) as Item[]
      setAllItems(items)
    } catch (itemsError) {
      setError('تعذر تحميل الأصناف: ' + toUserMessage(itemsError))
    }

    // If editing, fetch the category and mark the items already in it
    if (isEdit && id) {
      const { data: categoryData, error: categoryError } = await supabase
        .from('categories')
        .select('*')
        .eq('id', id)
        .single()

      if (categoryError) {
        setError('فشل في تحميل بيانات المجموعة: ' + toUserMessage(categoryError))
      } else if (categoryData) {
        setFormData({
          code: categoryData.code,
          name: categoryData.name,
          name_ar: categoryData.name_ar,
          description: categoryData.description || '',
          sort_order: categoryData.sort_order || 0,
          is_active: categoryData.is_active,
        })

        const itemIds = items.filter(item => item.category_id === id).map(item => item.id)
        setSelectedItems(new Set(itemIds))
        setOriginalItems(new Set(itemIds))
      }
    }
    setFetchLoading(false)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')

    if (!Number.isInteger(formData.sort_order) || formData.sort_order < 0) {
      setError('ترتيب العرض يجب أن يكون رقماً صحيحاً (صفر أو أكثر)')
      return
    }

    // Only the changes are sent: items added to / taken out of this category
    const addItemIds = [...selectedItems].filter(itemId => !originalItems.has(itemId))
    const removeItemIds = [...originalItems].filter(itemId => !selectedItems.has(itemId))

    setLoading(true)
    // One database call: the category (code uniqueness checked there) and its item assignments
    const { error: saveError } = await inventoryService.saveCategory(
      isEdit && id ? id : null,
      {
        code: formData.code.trim(),
        name: formData.name.trim(),
        name_ar: formData.name_ar.trim(),
        description: formData.description.trim() || null,
        sort_order: formData.sort_order,
        is_active: formData.is_active,
      },
      addItemIds,
      removeItemIds
    )

    if (saveError) {
      setError('فشل في حفظ المجموعة: ' + toUserMessage(saveError))
      setLoading(false)
      return
    }
    navigate('/categories')
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

  // Get assigned items for the sidebar
  const assignedItems = allItems.filter(item => selectedItems.has(item.id))

  // Handle removing an item from the category
  const handleRemoveItem = (itemId: string) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev)
      newSet.delete(itemId)
      return newSet
    })
  }

  return (
    <div className="max-w-7xl mx-auto">
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

      <div className="flex gap-6">
        {/* Main Form */}
        <form onSubmit={handleSubmit} className="flex-1 space-y-6">
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
                min={0}
                step={1}
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

        {/* Assigned Items Sidebar */}
        <div className="w-80 lg:w-96">
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 sticky top-4">
            {/* Header */}
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-bold text-gray-900">
                  {categoryType === 'items' ? 'الأصناف المعينة' : 'الوصفات المعينة'}
                </h3>
                <span className="bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full text-sm font-medium">
                  {assignedItems.length}
                </span>
              </div>
              <p className="text-sm text-gray-500">
                {categoryType === 'items' ? 'الأصناف' : 'الوصفات'} التي تنتمي لهذه المجموعة
              </p>
            </div>

            {/* Assigned Items List */}
            <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
              {assignedItems.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <Package className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">لا توجد عناصر معينة</p>
                  <p className="text-xs mt-1">حدد العناصر من القائمة الجانبية</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {assignedItems.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 hover:bg-gray-50 flex items-center gap-3 group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {item.name_ar}
                        </p>
                        <p className="text-sm text-gray-500 truncate">
                          {item.code}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        title="إزالة من المجموعة"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer Stats */}
            {assignedItems.length > 0 && (
              <div className="p-4 border-t border-gray-200 bg-gray-50">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">إجمالي العناصر</span>
                  <span className="font-bold text-gray-900">{assignedItems.length}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
