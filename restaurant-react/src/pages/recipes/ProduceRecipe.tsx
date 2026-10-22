import { useState, useEffect, useRef, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { recipeService, RecipeWithIngredients, AvailabilityDetail, ingredientStockQuantity, newRequestId } from '../../services/recipe.service'
import { branchesService } from '../../services/branches.service'
import { Branch, Item } from '../../types/database.types'
import { toUserMessage } from '../../lib/errors'
import { formatQuantity, parseDecimal, roundQuantity } from '../../lib/utils'
import { Factory, ArrowRight, AlertCircle, CheckCircle, Package } from 'lucide-react'

export default function ProduceRecipe() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [recipes, setRecipes] = useState<Item[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeWithIngredients | null>(null)

  const [formData, setFormData] = useState({
    recipe_item_id: searchParams.get('recipe') || '',
    branch_id: '',
    quantity: 1,
    notes: ''
  })
  // One id per intended production: a retry after a lost response is recognised by the database and not produced
  // twice. A new id is taken after a success and whenever the recipe, branch or quantity changes.
  const [requestId, setRequestId] = useState(() => newRequestId())

  const [availability, setAvailability] = useState<{
    available: boolean
    details: AvailabilityDetail[]
  } | null>(null)
  // Bumped after a production so availability is re-read from the database with the current form values
  const [stockVersion, setStockVersion] = useState(0)
  // Only the latest request may set the recipe / availability (an older, slower response is ignored)
  const recipeRequest = useRef('')
  const availabilitySeq = useRef(0)

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    setRequestId(newRequestId())
  }, [formData.recipe_item_id, formData.branch_id, formData.quantity])

  useEffect(() => {
    recipeRequest.current = formData.recipe_item_id
    if (formData.recipe_item_id) {
      loadRecipeDetails(formData.recipe_item_id)
    } else {
      setSelectedRecipe(null)
      setAvailability(null)
    }
  }, [formData.recipe_item_id])

  useEffect(() => {
    if (selectedRecipe && selectedRecipe.id === formData.recipe_item_id && formData.branch_id && formData.quantity > 0) {
      checkAvailability(selectedRecipe, formData.branch_id, formData.quantity)
    } else {
      availabilitySeq.current++ // drop any check still running
      setAvailability(null)
    }
  }, [selectedRecipe, formData.recipe_item_id, formData.branch_id, formData.quantity, stockVersion])

  const fetchData = async () => {
    const [recipesRes, branchesRes] = await Promise.all([
      recipeService.getAllRecipes(),
      branchesService.getActive()
    ])
    if (recipesRes.error || branchesRes.error) {
      setError('تعذر تحميل البيانات: ' + toUserMessage(recipesRes.error || branchesRes.error))
    }
    setRecipes(recipesRes.data || [])
    setBranches(branchesRes.data || [])
    setFetchLoading(false)
  }

  const loadRecipeDetails = async (recipeId: string) => {
    const { data, error } = await recipeService.getRecipeWithIngredients(recipeId)
    if (recipeRequest.current !== recipeId) return // another recipe was chosen meanwhile
    if (error) setError('تعذر تحميل مكونات الريسبي: ' + toUserMessage(error))
    setSelectedRecipe(data)
  }

  // Takes the branch and quantity explicitly (not the render's formData), so a result always matches its inputs
  const checkAvailability = async (recipe: RecipeWithIngredients, branchId: string, quantity: number) => {
    const seq = ++availabilitySeq.current
    const result = await recipeService.checkIngredientAvailability(recipe.ingredients, branchId, quantity)
    if (seq !== availabilitySeq.current) return // a newer check (other recipe, branch or quantity) is running
    if (result.error) setError('تعذر التحقق من المخزون: ' + toUserMessage(result.error))
    setAvailability({ available: result.available, details: result.details })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')
    setSuccess('')

    if (!formData.recipe_item_id || !formData.branch_id || !(formData.quantity > 0)) {
      setError('يرجى ملء جميع الحقول المطلوبة')
      return
    }

    if (!availability?.available) {
      setError('المكونات غير كافية في المخزون')
      return
    }

    setLoading(true)

    const { error: produceError } = await recipeService.produceRecipe({
      recipe_item_id: formData.recipe_item_id,
      branch_id: formData.branch_id,
      quantity: roundQuantity(formData.quantity),
      notes: formData.notes,
      request_id: requestId,
    })

    if (produceError) {
      setError('فشل في إضافة الريسبي للمخزون: ' + toUserMessage(produceError))
      setStockVersion(v => v + 1) // stock may have changed since the last check (e.g. a shortage): show it again
    } else {
      setSuccess(`تم إضافة ${formatQuantity(formData.quantity)} ${selectedRecipe?.name_ar || ''} للمخزون بنجاح`)
      // Reset form with a new request id; the availability effect then re-reads stock for the reset quantity
      setFormData(prev => ({ ...prev, quantity: 1, notes: '' }))
      setRequestId(newRequestId())
      setStockVersion(v => v + 1)
    }

    setLoading(false)
  }

  if (fetchLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button type="button" onClick={() => navigate('/recipes')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Factory className="w-6 h-6 text-green-600" />
            إضافة ريسبي للمخزون
          </h1>
          <p className="text-gray-600">تصنيع الريسبي وإضافته للمخزون مع خصم المكونات</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700 whitespace-pre-line">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
          <p className="text-green-700">{success}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Selection */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">اختيار الريسبي والفرع</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الريسبي <span className="text-red-500">*</span></label>
              <select
                value={formData.recipe_item_id}
                onChange={(e) => setFormData({ ...formData, recipe_item_id: e.target.value })}
                required
                aria-label="الريسبي"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              >
                <option value="">اختر الريسبي</option>
                {recipes.map(r => <option key={r.id} value={r.id}>{r.name_ar} ({r.code})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الفرع <span className="text-red-500">*</span></label>
              <select
                value={formData.branch_id}
                onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                required
                aria-label="الفرع"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              >
                <option value="">اختر الفرع</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name_ar}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الكمية <span className="text-red-500">*</span></label>
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={formData.quantity}
                onChange={(e) => {
                  const qty = parseDecimal(e.target.value)
                  setFormData({ ...formData, quantity: qty !== null && qty > 0 ? roundQuantity(qty) : 0 })
                }}
                required
                aria-label="الكمية"
                placeholder="مثال: 19.200"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                dir="ltr"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              placeholder="ملاحظات إضافية..."
            />
          </div>
        </div>

        {/* Ingredients Preview */}
        {selectedRecipe && selectedRecipe.ingredients?.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Package className="w-5 h-5 text-gray-500" />
              المكونات المطلوبة
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">المكون</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">لكل وحدة</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">المطلوب</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">المتوفر</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRecipe.ingredients.map((ing, index) => {
                    const ingredientName = ing.ingredient?.name_ar || ''
                    const detail = availability?.details.find(d => d.item_id === ing.ingredient_item_id)
                    // Required amount in the ingredient's stock unit (e.g. 200 g per unit of a kg item = 0.2 kg)
                    const stockUnit = ing.ingredient?.unit?.name_ar || ''
                    const required = roundQuantity(ingredientStockQuantity(ing) * formData.quantity)
                    return (
                      <tr key={ing.id || index} className="border-b border-gray-100">
                        <td className="py-3 px-2 font-medium">{ingredientName}</td>
                        <td className="py-3 px-2 text-gray-600">{formatQuantity(ing.quantity)} {ing.unit?.name_ar || stockUnit}</td>
                        <td className="py-3 px-2 font-medium text-blue-600">{formatQuantity(required)} {stockUnit}</td>
                        <td className="py-3 px-2">
                          {detail ? `${formatQuantity(detail.available)} ${stockUnit}` : '-'}
                        </td>
                        <td className="py-3 px-2">
                          {detail ? (
                            detail.sufficient ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                                <CheckCircle className="w-3 h-3" />
                                متوفر
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full">
                                <AlertCircle className="w-3 h-3" />
                                غير كافي
                              </span>
                            )
                          ) : (
                            <span className="text-gray-400 text-sm">اختر الفرع</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Summary */}
            {availability && (
              <div className={`mt-4 p-4 rounded-lg ${availability.available ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <div className="flex items-center gap-2">
                  {availability.available ? (
                    <>
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <span className="font-medium text-green-700">جميع المكونات متوفرة - يمكن التصنيع</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-5 h-5 text-red-600" />
                      <span className="font-medium text-red-700">بعض المكونات غير كافية</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {selectedRecipe && selectedRecipe.ingredients?.length === 0 && (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
            لا توجد مكونات لهذا الريسبي
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={loading || !availability?.available}
            className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />جاري التصنيع...</>
            ) : (
              <><Factory className="w-5 h-5" />إضافة للمخزون</>
            )}
          </button>
          <button type="button" onClick={() => navigate('/recipes')} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">إلغاء</button>
        </div>
      </form>
    </div>
  )
}
