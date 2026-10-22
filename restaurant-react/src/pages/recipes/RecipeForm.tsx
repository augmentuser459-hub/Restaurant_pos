import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { recipeService, RecipeUnit, unitFactor } from '../../services/recipe.service'
import { fetchPickerItems, PickerItem } from '../../services/transfers.service'
import { toUserMessage } from '../../lib/errors'
import { parseDecimal, roundQuantity } from '../../lib/utils'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, ChefHat } from 'lucide-react'
import BarcodeItemSelector from '../../components/ui/BarcodeItemSelector'

interface IngredientRow {
  ingredient_item_id: string
  quantity: number
  unit_id: string
  notes: string
}

interface Category {
  id: string
  code: string
  name_ar: string
}

export default function RecipeForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(true)
  const [error, setError] = useState('')
  const [allItems, setAllItems] = useState<PickerItem[]>([])
  const [units, setUnits] = useState<RecipeUnit[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    name_ar: '',
    description: '',
    unit_id: '',
    category_id: '',
    min_stock_level: 0,
  })

  const [ingredients, setIngredients] = useState<IngredientRow[]>([
    { ingredient_item_id: '', quantity: 1, unit_id: '', notes: '' }
  ])

  useEffect(() => {
    fetchData()
  }, [id])

  const fetchData = async () => {
    const [itemsRes, unitsRes, categoriesRes, recipeCategoryId] = await Promise.all([
      fetchPickerItems(),
      recipeService.getUnits(),
      recipeService.getCategories(),
      recipeService.getRecipeCategoryId(),
    ])
    const loadError = itemsRes.error || unitsRes.error || categoriesRes.error
    if (loadError) setError('تعذر تحميل البيانات: ' + toUserMessage(loadError))
    setAllItems(itemsRes.data)
    setUnits(unitsRes.data)
    setCategories(categoriesRes.data)
    // New recipes default to the recipe category when it exists
    setFormData(prev => ({ ...prev, category_id: prev.category_id || recipeCategoryId || '' }))

    // If editing, load recipe data
    if (id) {
      const { data: recipe, error: recipeError } = await recipeService.getRecipeWithIngredients(id)
      if (recipeError) setError('تعذر تحميل الريسبي: ' + toUserMessage(recipeError))
      if (recipe) {
        setFormData({
          code: recipe.code,
          name: recipe.name,
          name_ar: recipe.name_ar,
          description: recipe.description || '',
          unit_id: recipe.unit_id || '',
          category_id: recipe.category_id || recipeCategoryId || '',
          min_stock_level: Number(recipe.min_stock_level) || 0,
        })
        if (recipe.ingredients?.length > 0) {
          setIngredients(recipe.ingredients.map(ing => ({
            ingredient_item_id: ing.ingredient_item_id,
            quantity: Number(ing.quantity),
            unit_id: ing.unit_id || '',
            notes: ing.notes || ''
          })))
        }
      }
    }

    setFetchLoading(false)
  }

  // Ingredients are active, non-recipe items other than this recipe; lines already saved stay selectable
  const savedIngredientIds = new Set(ingredients.map(i => i.ingredient_item_id))
  const items = allItems.filter(i =>
    i.id !== id && ((!i.is_recipe && i.status === 'active') || savedIngredientIds.has(i.id)))

  const unitById = (unitId: string | null | undefined) => units.find(u => u.id === unitId)

  // Units an ingredient line can use: its stock unit and the units convertible to it (g <-> kg, ml <-> L ...)
  const unitOptionsFor = (itemId: string) => {
    const item = allItems.find(i => i.id === itemId)
    const stockUnit = unitById(item?.unit_id)
    if (!stockUnit) return units
    return units.filter(u => unitFactor(u, stockUnit) !== null)
  }

  const handleAddIngredient = () => {
    setIngredients([...ingredients, { ingredient_item_id: '', quantity: 1, unit_id: '', notes: '' }])
  }

  const handleRemoveIngredient = (index: number) => {
    if (ingredients.length > 1) {
      setIngredients(ingredients.filter((_, i) => i !== index))
    }
  }

  const handleIngredientChange = (index: number, field: keyof IngredientRow, value: string | number) => {
    const updated = [...ingredients]
    updated[index] = { ...updated[index], [field]: value }

    // A new ingredient starts in its own stock unit
    if (field === 'ingredient_item_id' && typeof value === 'string') {
      const item = allItems.find(i => i.id === value)
      updated[index].unit_id = item?.unit_id || ''
    }

    setIngredients(updated)
  }

  // Handle item selection from BarcodeItemSelector
  const handleItemSelect = (selected: { id: string; unit?: { id: string } | null }) => {
    const item = allItems.find(i => i.id === selected.id)
    if (selected.id === id) {
      setError('لا يمكن أن يكون الريسبي مكوناً لنفسه')
      return
    }
    if (item?.is_recipe) {
      setError(`الصنف "${item.name_ar}" ريسبي ولا يمكن استخدامه كمكون`)
      return
    }
    setError('')
    const existingIndex = ingredients.findIndex(ing => ing.ingredient_item_id === selected.id)

    if (existingIndex >= 0) {
      // Item exists, increase quantity
      const updated = [...ingredients]
      updated[existingIndex] = { ...updated[existingIndex], quantity: roundQuantity(updated[existingIndex].quantity + 1) }
      setIngredients(updated)
    } else {
      // Add new item in its stock unit
      const newIng: IngredientRow = {
        ingredient_item_id: selected.id,
        quantity: 1,
        unit_id: item?.unit_id || selected.unit?.id || '',
        notes: ''
      }

      // Find first empty row or add new row
      const emptyIndex = ingredients.findIndex(ing => !ing.ingredient_item_id)
      if (emptyIndex >= 0) {
        const updated = [...ingredients]
        updated[emptyIndex] = newIng
        setIngredients(updated)
      } else {
        setIngredients([...ingredients, newIng])
      }
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')

    if (!formData.category_id) {
      setError('يرجى اختيار مجموعة الريسبي')
      return
    }

    const chosen = ingredients.filter(ing => ing.ingredient_item_id)
    if (chosen.length === 0) {
      setError('يجب إضافة مكون واحد على الأقل')
      return
    }
    const itemName = (itemId: string) => allItems.find(i => i.id === itemId)?.name_ar || ''
    const badQty = chosen.find(ing => !(ing.quantity > 0))
    if (badQty) {
      setError(`يرجى إدخال كمية أكبر من صفر للمكون ${itemName(badQty.ingredient_item_id)}`)
      return
    }
    const seen = new Set<string>()
    const duplicate = chosen.find(ing => (seen.has(ing.ingredient_item_id) ? true : (seen.add(ing.ingredient_item_id), false)))
    if (duplicate) {
      setError(`المكون ${itemName(duplicate.ingredient_item_id)} مكرر، اجمع كميته في سطر واحد`)
      return
    }

    // Validate form data
    if (!formData.unit_id) {
      setError('يرجى اختيار وحدة القياس للريسبي')
      return
    }
    if (!(formData.min_stock_level >= 0)) {
      setError('الحد الأدنى للمخزون لا يمكن أن يكون سالباً')
      return
    }

    setLoading(true)

    // The recipe item and all its ingredients are saved in one database transaction
    // (an edit replaces the ingredient list completely or not at all)
    const { error: saveError } = await recipeService.saveRecipe(isEdit && id ? id : null, {
      code: formData.code.trim(),
      name: formData.name.trim(),
      name_ar: formData.name_ar.trim(),
      description: formData.description,
      unit_id: formData.unit_id,
      category_id: formData.category_id,
      min_stock_level: formData.min_stock_level,
      ingredients: chosen.map(ing => ({
        ingredient_item_id: ing.ingredient_item_id,
        quantity: roundQuantity(ing.quantity),
        unit_id: ing.unit_id || null,
        notes: ing.notes
      })),
    })

    if (saveError) {
      setError((isEdit ? 'فشل في تحديث الريسبي: ' : 'فشل في إنشاء الريسبي: ') + toUserMessage(saveError))
      setLoading(false)
      return
    }

    navigate('/recipes')
  }

  if (fetchLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-orange-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button type="button" onClick={() => navigate('/recipes')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ChefHat className="w-6 h-6 text-orange-600" />
            {isEdit ? 'تعديل الريسبي' : 'ريسبي جديد'}
          </h1>
          <p className="text-gray-600">{isEdit ? 'تعديل بيانات ومكونات الريسبي' : 'إضافة ريسبي جديد مع مكوناته'}</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات الريسبي</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الكود <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                placeholder="RCP001"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الوحدة <span className="text-red-500">*</span></label>
              <select
                value={formData.unit_id}
                onChange={(e) => setFormData({ ...formData, unit_id: e.target.value })}
                required
                aria-label="الوحدة"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
              >
                <option value="">اختر الوحدة</option>
                {units.map(u => <option key={u.id} value={u.id}>{u.name_ar} ({u.code})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الاسم (إنجليزي) <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                placeholder="Zinger Sandwich"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الاسم (عربي) <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.name_ar}
                onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                placeholder="ساندوتش زنجر"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">المجموعة <span className="text-red-500">*</span></label>
              <select
                value={formData.category_id}
                onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                required
                aria-label="المجموعة"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
              >
                <option value="">اختر المجموعة</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الحد الأدنى للمخزون</label>
              <input
                type="number"
                min="0"
                step="0.001"
                value={formData.min_stock_level}
                onChange={(e) => {
                  const value = parseDecimal(e.target.value)
                  setFormData({ ...formData, min_stock_level: value !== null && value >= 0 ? roundQuantity(value) : 0 })
                }}
                aria-label="الحد الأدنى للمخزون"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                dir="ltr"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">الوصف</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                placeholder="وصف الريسبي..."
              />
            </div>
            <div className="md:col-span-2 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>ملاحظة:</strong> سعر التكلفة يُحسب تلقائياً من مجموع تكلفة المكونات. سعر البيع يتم تحديده في إدارة نقاط البيع لكل فرع.
              </p>
            </div>
          </div>
        </div>

        {/* Ingredients */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">المكونات</h2>
            <button type="button" onClick={handleAddIngredient} className="flex items-center gap-2 px-4 py-2 text-orange-600 hover:bg-orange-50 rounded-lg">
              <Plus className="w-4 h-4" />
              إضافة مكون
            </button>
          </div>

          {/* Smart Item Selector */}
          <div className="mb-4">
            <BarcodeItemSelector
              onItemSelect={handleItemSelect}
              excludeRecipes
              className="w-full"
            />
          </div>

          {/* Ingredients Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">المكون</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الكمية</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الوحدة</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">ملاحظات</th>
                  <th className="py-3 px-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {ingredients.map((ing, index) => (
                  <tr key={index} className="border-b border-gray-100">
                    <td className="py-3 px-2">
                      <select
                        value={ing.ingredient_item_id}
                        onChange={(e) => handleIngredientChange(index, 'ingredient_item_id', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        aria-label="المكون"
                      >
                        <option value="">اختر المكون</option>
                        {items.map(i => <option key={i.id} value={i.id}>{i.name_ar} ({i.code})</option>)}
                      </select>
                    </td>
                    <td className="py-3 px-2">
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={ing.quantity}
                        onChange={(e) => {
                          const qty = parseDecimal(e.target.value)
                          handleIngredientChange(index, 'quantity', qty !== null && qty > 0 ? roundQuantity(qty) : 0)
                        }}
                        className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        dir="ltr"
                        aria-label="الكمية"
                      />
                    </td>
                    <td className="py-3 px-2">
                      <select
                        value={ing.unit_id}
                        onChange={(e) => handleIngredientChange(index, 'unit_id', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        aria-label="الوحدة"
                      >
                        <option value="">الوحدة</option>
                        {(ing.ingredient_item_id ? unitOptionsFor(ing.ingredient_item_id) : units).map(u => <option key={u.id} value={u.id}>{u.name_ar}</option>)}
                      </select>
                    </td>
                    <td className="py-3 px-2">
                      <input
                        type="text"
                        value={ing.notes}
                        onChange={(e) => handleIngredientChange(index, 'notes', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        placeholder="ملاحظات"
                      />
                    </td>
                    <td className="py-3 px-2">
                      <button
                        type="button"
                        onClick={() => handleRemoveIngredient(index)}
                        disabled={ingredients.length === 1}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30"
                        title="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button type="submit" disabled={loading} className="flex items-center gap-2 px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
            {loading ? (
              <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />جاري الحفظ...</>
            ) : (
              <><Save className="w-5 h-5" />حفظ الريسبي</>
            )}
          </button>
          <button type="button" onClick={() => navigate('/recipes')} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">إلغاء</button>
        </div>
      </form>
    </div>
  )
}
