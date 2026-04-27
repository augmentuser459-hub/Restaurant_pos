import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { Plus, Edit2, Trash2, FolderOpen, Package, ChefHat } from 'lucide-react'

interface Category {
  id: string
  code: string
  name: string
  name_ar: string
  description?: string
  is_active: boolean
  sort_order: number
  item_count?: number
}

type TabType = 'items' | 'recipes'

export default function CategoriesList() {
  const [activeTab, setActiveTab] = useState<TabType>('items')
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCategories()
  }, [activeTab])

  const fetchCategories = async () => {
    setLoading(true)
    
    if (activeTab === 'items') {
      // Fetch item categories with item count
      const { data, error } = await supabase
        .from('categories')
        .select(`
          *,
          items:items(count)
        `)
        .order('sort_order')
        .order('name_ar')

      if (!error && data) {
        const categoriesWithCount = data.map(cat => ({
          ...cat,
          item_count: cat.items?.[0]?.count || 0
        }))
        setCategories(fixEncodingInData(categoriesWithCount) as Category[])
      }
    } else {
      // Fetch recipe categories (items where is_recipe = true)
      const { data, error } = await supabase
        .from('categories')
        .select(`
          *,
          items:items!items_category_id_fkey(count)
        `)
        .eq('items.is_recipe', true)
        .order('sort_order')
        .order('name_ar')

      if (!error && data) {
        const categoriesWithCount = data.map(cat => ({
          ...cat,
          item_count: cat.items?.[0]?.count || 0
        }))
        setCategories(fixEncodingInData(categoriesWithCount) as Category[])
      }
    }
    
    setLoading(false)
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`هل أنت متأكد من حذف المجموعة "${name}"؟`)) return

    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id)

    if (error) {
      alert('فشل في حذف المجموعة: ' + error.message)
    } else {
      fetchCategories()
    }
  }

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from('categories')
      .update({ is_active: !currentStatus })
      .eq('id', id)

    if (error) {
      alert('فشل في تحديث الحالة')
    } else {
      fetchCategories()
    }
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
          <h1 className="text-2xl font-bold text-gray-900">المجموعات</h1>
          <p className="text-gray-600">إدارة مجموعات الأصناف والوصفات</p>
        </div>
        <Link
          to={`/categories/new?type=${activeTab}`}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-5 h-5" />
          مجموعة جديدة
        </Link>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="border-b border-gray-200">
          <div className="flex">
            <button
              type="button"
              onClick={() => setActiveTab('items')}
              className={`flex items-center gap-2 px-6 py-4 font-medium border-b-2 transition-colors ${
                activeTab === 'items'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Package className="w-5 h-5" />
              مجموعات الأصناف
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('recipes')}
              className={`flex items-center gap-2 px-6 py-4 font-medium border-b-2 transition-colors ${
                activeTab === 'recipes'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <ChefHat className="w-5 h-5" />
              مجموعات الوصفات
            </button>
          </div>
        </div>

        {/* Categories List */}
        <div className="p-6">
          {categories.length === 0 ? (
            <div className="text-center py-12">
              <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">لا توجد مجموعات</p>
              <Link
                to={`/categories/new?type=${activeTab}`}
                className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg"
              >
                <Plus className="w-4 h-4" />
                إضافة مجموعة جديدة
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {categories.map((category) => (
                <div
                  key={category.id}
                  className={`bg-white border rounded-lg p-4 hover:shadow-md transition-shadow ${
                    category.is_active ? 'border-gray-200' : 'border-gray-300 bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-bold text-gray-900">{category.name_ar}</h3>
                      <p className="text-sm text-gray-500">{category.code}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Link
                        to={`/categories/${category.id}/edit?type=${activeTab}`}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                        title="تعديل"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(category.id, category.name_ar)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                        title="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {category.description && (
                    <p className="text-sm text-gray-600 mb-3">{category.description}</p>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                    <div className="flex items-center gap-2 text-sm">
                      {activeTab === 'items' ? (
                        <Package className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChefHat className="w-4 h-4 text-gray-400" />
                      )}
                      <span className="text-gray-600">
                        {category.item_count || 0} {activeTab === 'items' ? 'صنف' : 'وصفة'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(category.id, category.is_active)}
                      className={`px-3 py-1 text-xs font-medium rounded-full ${
                        category.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {category.is_active ? 'نشط' : 'غير نشط'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
