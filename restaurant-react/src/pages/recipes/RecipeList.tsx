import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { recipeService } from '../../services/recipe.service'
import { Item } from '../../types/database.types'
import { Plus, Search, ChefHat, Eye, Edit, Factory, DollarSign, Upload, Filter } from 'lucide-react'
import { toUserMessage } from '../../lib/errors'

interface RecipeWithCost extends Item {
  calculated_cost?: number
}

interface Category {
  id: string
  name_ar: string
}

export default function RecipeList() {
  const [recipes, setRecipes] = useState<RecipeWithCost[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    const [recipesRes, categoriesRes] = await Promise.all([
      recipeService.getAllRecipesWithCost(),
      recipeService.getCategories()
    ])
    const loadError = recipesRes.error || categoriesRes.error
    setError(loadError ? 'تعذر تحميل الريسبيات: ' + toUserMessage(loadError) : '')
    setRecipes(recipesRes.data || [])
    setCategories(categoriesRes.data as Category[])
    setLoading(false)
  }

  const filteredRecipes = recipes.filter(recipe => {
    const matchesSearch = recipe.name_ar.toLowerCase().includes(searchTerm.toLowerCase()) ||
      recipe.code.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory = !selectedCategory || recipe.category_id === selectedCategory
    return matchesSearch && matchesCategory
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ChefHat className="w-7 h-7 text-orange-600" />
            الريسبيات
          </h1>
          <p className="text-gray-600">إدارة الريسبيات والمنتجات المصنعة</p>
        </div>
        <div className="flex gap-3">
          <Link
            to="/recipes/import"
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            <Upload className="w-5 h-5" />
            استيراد من Excel
          </Link>
          <Link
            to="/recipes/produce"
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            <Factory className="w-5 h-5" />
            إضافة للمخزون
          </Link>
          <Link
            to="/recipes/new"
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
          >
            <Plus className="w-5 h-5" />
            ريسبي جديد
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
      )}

      {/* Search and Filter */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-5 h-5 text-gray-400" />
          <span className="font-medium text-gray-700">بحث وتصفية</span>
        </div>
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="بحث بالاسم أو الكود..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
          >
            <option value="">جميع المجموعات</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name_ar}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Recipes Grid */}
      {filteredRecipes.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-12 text-center">
          <ChefHat className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">لا توجد ريسبيات</h3>
          <p className="text-gray-500 mb-4">ابدأ بإضافة ريسبي جديد</p>
          <Link
            to="/recipes/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
          >
            <Plus className="w-5 h-5" />
            إضافة ريسبي
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRecipes.map((recipe) => (
            <div
              key={recipe.id}
              className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{recipe.name_ar}</h3>
                  <p className="text-sm text-gray-500">{recipe.code}</p>
                </div>
                <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded-full">
                  ريسبي
                </span>
              </div>
              
              {recipe.description && (
                <p className="text-sm text-gray-600 mb-3 line-clamp-2">{recipe.description}</p>
              )}

              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  <div className="text-sm">
                    <span className="text-gray-500">التكلفة: </span>
                    <span className="font-semibold text-green-700">
                      {recipe.calculated_cost 
                        ? `${recipe.calculated_cost.toFixed(2)} ج.م`
                        : 'غير محسوبة'
                      }
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    to={`/recipes/${recipe.id}`}
                    className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                    title="عرض"
                  >
                    <Eye className="w-4 h-4" />
                  </Link>
                  <Link
                    to={`/recipes/${recipe.id}/edit`}
                    className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"
                    title="تعديل"
                  >
                    <Edit className="w-4 h-4" />
                  </Link>
                  <Link
                    to={`/recipes/produce?recipe=${recipe.id}`}
                    className="p-2 text-green-500 hover:bg-green-50 rounded-lg"
                    title="إضافة للمخزون"
                  >
                    <Factory className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
