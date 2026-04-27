import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { recipeService, RecipeWithIngredients } from '../../services/recipe.service'
import { Item, ProductionLog } from '../../types/database.types'
import { ArrowRight, Edit, Factory, ChefHat, Package, History } from 'lucide-react'

export default function RecipeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState<RecipeWithIngredients | null>(null)
  const [productionLogs, setProductionLogs] = useState<ProductionLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) fetchData(id)
  }, [id])

  const fetchData = async (recipeId: string) => {
    const [recipeRes, logsRes] = await Promise.all([
      recipeService.getRecipeWithIngredients(recipeId),
      recipeService.getProductionLogs(undefined, 10)
    ])
    setRecipe(recipeRes.data)
    // Filter logs for this recipe
    setProductionLogs((logsRes.data || []).filter(log => log.recipe_item_id === recipeId))
    setLoading(false)
  }

  // Calculate recipe cost from ingredients
  const calculateRecipeCost = () => {
    if (!recipe?.ingredients) return 0
    return recipe.ingredients.reduce((total, ing) => {
      const ingredient = ing.ingredient as Item
      const cost = (ingredient?.purchase_price || 0) * (ing.quantity || 0)
      return total + cost
    }, 0)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-orange-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!recipe) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">الريسبي غير موجود</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => navigate('/recipes')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <ChefHat className="w-6 h-6 text-orange-600" />
              {recipe.name_ar}
            </h1>
            <p className="text-gray-600">{recipe.code}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Link
            to={`/recipes/produce?recipe=${recipe.id}`}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            <Factory className="w-5 h-5" />
            إضافة للمخزون
          </Link>
          <Link
            to={`/recipes/${recipe.id}/edit`}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Edit className="w-5 h-5" />
            تعديل
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recipe Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات الريسبي</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">الكود</p>
                <p className="font-medium">{recipe.code}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">الاسم</p>
                <p className="font-medium">{recipe.name_ar}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">سعر التكلفة (محسوب من المكونات)</p>
                <p className="font-medium text-orange-600 flex items-center gap-1">
                  🧮 {calculateRecipeCost().toFixed(2)} ج.م
                </p>
              </div>
              {recipe.description && (
                <div className="col-span-2">
                  <p className="text-sm text-gray-500">الوصف</p>
                  <p className="font-medium">{recipe.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Ingredients */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Package className="w-5 h-5 text-gray-500" />
              المكونات
            </h2>
            {recipe.ingredients?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">المكون</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الكمية</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الوحدة</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipe.ingredients.map((ing, index) => (
                      <tr key={index} className="border-b border-gray-100">
                        <td className="py-3 px-2 font-medium">{(ing.ingredient as Item)?.name_ar}</td>
                        <td className="py-3 px-2">{ing.quantity}</td>
                        <td className="py-3 px-2">{ing.unit?.name_ar || '-'}</td>
                        <td className="py-3 px-2 text-gray-500">{ing.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">لا توجد مكونات</p>
            )}
          </div>
        </div>

        {/* Production History */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <History className="w-5 h-5 text-gray-500" />
              سجل الإنتاج
            </h2>
            {productionLogs.length > 0 ? (
              <div className="space-y-3">
                {productionLogs.map((log) => (
                  <div key={log.id} className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-green-600">+{log.quantity}</p>
                        <p className="text-sm text-gray-500">{(log.branch as { name_ar: string })?.name_ar}</p>
                      </div>
                      <p className="text-xs text-gray-400">
                        {new Date(log.produced_at).toLocaleDateString('ar-EG')}
                      </p>
                    </div>
                    {log.notes && <p className="text-xs text-gray-500 mt-1">{log.notes}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4 text-sm">لا يوجد سجل إنتاج</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
