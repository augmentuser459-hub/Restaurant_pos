import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { recipeService, CreateRecipeData } from '../../services/recipe.service'
import { inventoryService } from '../../services/inventory.service'
import { Item } from '../../types/database.types'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, ChefHat } from 'lucide-react'
import BarcodeItemSelector from '../../components/ui/BarcodeItemSelector'

interface Unit {
  id: string
  code: string
  name_ar: string
}

interface IngredientRow {
  ingredient_item_id: string
  quantity: number
  unit_id: string
  notes: string
}

export default function RecipeForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(true)
  const [error, setError] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [recipeCategoryId, setRecipeCategoryId] = useState<string>('')

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    name_ar: '',
    description: '',
    unit_id: '',
    min_stock_level: 0,
  })

  const [ingredients, setIngredients] = useState<IngredientRow[]>([
    { ingredient_item_id: '', quantity: 1, unit_id: '', notes: '' }
  ])

  useEffect(() => {
    fetchData()
  }, [id])

  const fetchData = async () => {
    // Get items (non-recipe items only for ingredients)
    const { data: itemsData } = await inventoryService.getAllItems()
    const nonRecipeItems = (itemsData || []).filter(i => !i.is_recipe && i.status === 'active')
    setItems(nonRecipeItems)

    // Get units
    const { data: unitsData } = await supabase
      .from('units')
      .select('id, code, name_ar')
      .eq('is_active', true)
      .order('name_ar')
    setUnits(fixEncodingInData(unitsData) as Unit[] || [])

    // Get recipe category ID
    const categoryId = await recipeService.getRecipeCategoryId()
    setRecipeCategoryId(categoryId || '')

    // If editing, load recipe data
    if (id) {
      const { data: recipe } = await recipeService.getRecipeWithIngredients(id)
      if (recipe) {
        setFormData({
          code: recipe.code,
          name: recipe.name,
          name_ar: recipe.name_ar,
          description: recipe.description || '',
          unit_id: recipe.unit_id || '',
          min_stock_level: recipe.min_stock_level || 0,
        })
        if (recipe.ingredients?.length > 0) {
          setIngredients(recipe.ingredients.map(ing => ({
            ingredient_item_id: ing.ingredient_item_id,
            quantity: ing.quantity,
            unit_id: ing.unit_id || '',
            notes: ing.notes || ''
          })))
        }
      }
    }

    setFetchLoading(false)
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
    
    // Auto-fill unit when item is selected
    if (field === 'ingredient_item_id' && typeof value === 'string') {
      const item = items.find(i => i.id === value)
      if (item?.unit_id) {
        updated[index].unit_id = item.unit_id
      }
    }
    
    setIngredients(updated)
  }

  // Handle item selection from BarcodeItemSelector
  const handleItemSelect = (item: Item) => {
    const existingIndex = ingredients.findIndex(ing => ing.ingredient_item_id === item.id)
    
    if (existingIndex >= 0) {
      // Item exists, increase quantity
      const updated = [...ingredients]
      updated[existingIndex].quantity += 1
      setIngredients(updated)
    } else {
      // Add new item
      const newIng: IngredientRow = {
        ingredient_item_id: item.id,
        quantity: 1,
        unit_id: item.unit_id || '',
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
    setError('')

    if (!recipeCategoryId) {
      setError('لم يتم العثور على تصنيف الريسبي. يرجى تشغيل ملف recipe_system.sql أولاً')
      return
    }

    const validIngredients = ingredients.filter(ing => ing.ingredient_item_id && ing.quantity > 0)
    if (validIngredients.length === 0) {
      setError('يجب إضافة مكون واحد على الأقل')
      return
    }

    // Validate form data
    if (!formData.unit_id) {
      setError('يرجى اختيار وحدة القياس للريسبي')
      return
    }

    setLoading(true)

    if (isEdit && id) {
      // Update item
      const { error: updateError } = await supabase
        .from('items')
        .update({
          code: formData.code,
          name: formData.name,
          name_ar: formData.name_ar,
          description: formData.description,
          unit_id: formData.unit_id,
          min_stock_level: formData.min_stock_level,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)

      if (updateError) {
        setError('فشل في تحديث الريسبي: ' + updateError.message)
        setLoading(false)
        return
      }

      // Update ingredients - filter out empty unit_ids
      const ingredientsToUpdate = validIngredients.map(ing => ({
        ingredient_item_id: ing.ingredient_item_id,
        quantity: ing.quantity,
        unit_id: ing.unit_id || null,
        notes: ing.notes
      }))

      const { error: ingError } = await recipeService.updateRecipeIngredients(id, ingredientsToUpdate)
      if (ingError) {
        setError('فشل في تحديث المكونات: ' + ingError.message)
        setLoading(false)
        return
      }
    } else {
      // Create new recipe - filter out empty unit_ids
      const ingredientsToCreate = validIngredients.map(ing => ({
        ingredient_item_id: ing.ingredient_item_id,
        quantity: ing.quantity,
        unit_id: ing.unit_id || null,
        notes: ing.notes
      }))

      const recipeData: CreateRecipeData = {
        ...formData,
        category_id: recipeCategoryId,
        ingredients: ingredientsToCreate
      }

      const { error: createError } = await recipeService.createRecipe(recipeData)
      if (createError) {
        setError('فشل في إنشاء الريسبي: ' + createError.message)
        setLoading(false)
        return
      }
    }

    navigate('/recipes')
    setLoading(false)
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
                        onChange={(e) => handleIngredientChange(index, 'quantity', Number(e.target.value))}
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
                        {units.map(u => <option key={u.id} value={u.id}>{u.name_ar}</option>)}
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
