import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { recipeService } from '../../services/recipe.service'
import { readFileAsText, parseCSV } from '../../lib/excel'
import { toUserMessage } from '../../lib/errors'
import { parseDecimal, roundQuantity } from '../../lib/utils'
import { ArrowRight, Upload, FileSpreadsheet, CheckCircle, XCircle, AlertCircle } from 'lucide-react'

interface RecipeRow {
  'اسم الوصفة': string
  'كود الصنف': string
  'اسم الصنف': string
  'الكمية': string
  'ملاحظات'?: string
}

interface ImportResult {
  success: number
  failed: number
  // Data rows ignored because 'اسم الوصفة' is empty (listed in errors too)
  skipped: number
  errors: string[]
}

interface Category {
  id: string
  code: string
  name_ar: string
}

// Item codes are compared without surrounding spaces/quotes (many stored codes are wrapped in quotes)
const normalizeCode = (code: string | null | undefined) => (code || '').trim().replace(/^"+|"+$/g, '').trim()

export default function RecipeImport() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [preview, setPreview] = useState<RecipeRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState('')

  useEffect(() => {
    const loadCategories = async () => {
      const [categoriesRes, recipeCategoryId] = await Promise.all([
        recipeService.getCategories(),
        recipeService.getRecipeCategoryId(),
      ])
      if (categoriesRes.error) alert('تعذر تحميل المجموعات: ' + toUserMessage(categoriesRes.error))
      setCategories(categoriesRes.data)
      setCategoryId(recipeCategoryId || '')
    }
    loadCategories()
  }, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    setFile(selectedFile)
    setResult(null)

    try {
      const text = await readFileAsText(selectedFile)
      const data = parseCSV(text) as unknown as RecipeRow[]
      setPreview(data.slice(0, 5)) // Show first 5 rows
    } catch (error) {
      console.error('Error reading file:', error)
      alert('خطأ في قراءة الملف')
    }
  }

  const handleImport = async () => {
    if (!file || loading) return
    if (!categoryId) {
      alert('يرجى اختيار مجموعة الوصفات قبل الاستيراد')
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const text = await readFileAsText(file)
      const rows = parseCSV(text) as unknown as RecipeRow[]

      const result: ImportResult = {
        success: 0,
        failed: 0,
        skipped: 0,
        errors: []
      }

      // Everything needed for exact lookups, loaded once (all pages)
      const [itemsRes, unitsRes, recipesRes] = await Promise.all([
        recipeService.getItemsForImport(),
        recipeService.getUnits(),
        recipeService.getAllRecipes(),
      ])
      const loadError = itemsRes.error || unitsRes.error || recipesRes.error
      if (loadError) {
        alert('خطأ في الاستيراد: ' + toUserMessage(loadError))
        setLoading(false)
        return
      }
      type ImportItem = (typeof itemsRes.data)[number]
      const itemsByExactCode = new Map<string, ImportItem>()
      const itemsByCode = new Map<string, ImportItem[]>()
      itemsRes.data.forEach(item => {
        itemsByExactCode.set((item.code || '').trim(), item)
        const key = normalizeCode(item.code)
        itemsByCode.set(key, [...(itemsByCode.get(key) || []), item])
      })
      // Exact code first; otherwise the code without quotes, only when it identifies a single item
      const findItem = (rawCode: string): ImportItem | 'ambiguous' | undefined => {
        const exact = itemsByExactCode.get(rawCode.trim())
        if (exact) return exact
        const matches = itemsByCode.get(normalizeCode(rawCode)) || []
        if (matches.length > 1) return 'ambiguous'
        return matches[0]
      }
      const existingRecipeNames = new Set(recipesRes.data.map(r => r.name_ar.trim()))
      // Recipes are counted in pieces by default
      const recipeUnit = unitsRes.data.find(u => u.code === 'PC') || unitsRes.data[0]
      if (!recipeUnit) {
        alert('لا توجد وحدات قياس في النظام. يرجى إضافة وحدة قياس أولاً.')
        setLoading(false)
        return
      }

      // Group rows by recipe name
      const recipeGroups = new Map<string, RecipeRow[]>()

      if (rows.length === 0) {
        result.errors.push('الملف لا يحتوي على بيانات (يجب أن يحتوي على صف العناوين ثم صف بيانات واحد على الأقل)')
      }

      rows.forEach((row, index) => {
        const recipeName = row['اسم الوصفة']?.trim()
        if (recipeName) {
          if (!recipeGroups.has(recipeName)) {
            recipeGroups.set(recipeName, [])
          }
          recipeGroups.get(recipeName)!.push(row)
          return
        }
        // Not silently dropped: the user sees which rows were ignored
        result.skipped++
        const details = [
          row['كود الصنف'] ? `كود الصنف: ${row['كود الصنف']}` : '',
          row['اسم الصنف'] ? `اسم الصنف: ${row['اسم الصنف']}` : '',
          row['الكمية'] ? `الكمية: ${row['الكمية']}` : '',
        ].filter(Boolean).join('، ')
        result.errors.push(`صف البيانات رقم ${index + 1}${details ? ` (${details})` : ''}: اسم الوصفة فارغ، تم تخطي الصف`)
      })

      // Create recipes: a recipe is created only when ALL its lines are valid
      for (const [recipeName, ingredients] of recipeGroups) {
        if (existingRecipeNames.has(recipeName)) {
          result.errors.push(`${recipeName}: يوجد ريسبي بنفس الاسم بالفعل (لم يتم استيراده مرة أخرى)`)
          result.failed++
          continue
        }

        const lineErrors: string[] = []
        const quantities = new Map<string, number>() // item id -> quantity (repeated codes are summed)

        ingredients.forEach((ing, index) => {
          const itemCode = normalizeCode(ing['كود الصنف'])
          const quantity = parseDecimal(ing['الكمية'] ?? '')
          const line = `السطر ${index + 1}`

          if (!itemCode) {
            lineErrors.push(`${line}: كود الصنف فارغ`)
            return
          }
          if (quantity === null || quantity <= 0) {
            lineErrors.push(`${line}: الكمية "${ing['الكمية'] ?? ''}" غير صحيحة للصنف ${itemCode} (يجب أن تكون أكبر من صفر)`)
            return
          }

          const item = findItem(ing['كود الصنف'] || '')
          if (item === 'ambiguous') {
            lineErrors.push(`${line}: الكود ${itemCode} يطابق أكثر من صنف`)
            return
          }
          if (!item) {
            lineErrors.push(`${line}: الصنف ${itemCode} غير موجود`)
            return
          }
          if (item.is_recipe) {
            lineErrors.push(`${line}: الصنف ${itemCode} ريسبي ولا يمكن استخدامه كمكون`)
            return
          }
          if (item.status !== 'active') {
            lineErrors.push(`${line}: الصنف ${itemCode} غير نشط`)
            return
          }
          quantities.set(item.id, roundQuantity((quantities.get(item.id) || 0) + quantity))
        })

        if (lineErrors.length > 0 || quantities.size === 0) {
          result.errors.push(`${recipeName}: لم يتم الاستيراد - ${lineErrors.length > 0 ? lineErrors.join('، ') : 'لا توجد مكونات صالحة'}`)
          result.failed++
          continue
        }

        // Recipe item and ingredients are created in one database transaction (code generated: RCP-YYYYMM-00001)
        const { error } = await recipeService.saveRecipe(null, {
          code: null,
          name: recipeName,
          name_ar: recipeName,
          description: ingredients[0]['ملاحظات'] || '',
          unit_id: recipeUnit.id,
          category_id: categoryId,
          ingredients: [...quantities.entries()].map(([itemId, quantity]) => ({
            ingredient_item_id: itemId,
            quantity,
            unit_id: null, // the quantity is in the ingredient's own stock unit
          })),
        })

        if (error) {
          result.errors.push(`${recipeName}: ${toUserMessage(error)}`)
          result.failed++
        } else {
          result.success++
          existingRecipeNames.add(recipeName)
        }
      }

      setResult(result)
    } catch (error) {
      alert('خطأ في الاستيراد: ' + toUserMessage(error))
    }

    setLoading(false)
  }

  const downloadTemplate = () => {
    const template = `اسم الوصفة,كود الصنف,اسم الصنف,الكمية,ملاحظات
بيتزا مارجريتا,ITEM001,دقيق,0.5,
بيتزا مارجريتا,ITEM002,جبنة موتزاريلا,0.2,
بيتزا مارجريتا,ITEM003,صلصة طماطم,0.1,
برجر لحم,ITEM004,لحم مفروم,0.15,
برجر لحم,ITEM005,خبز برجر,1,
برجر لحم,ITEM006,خس,0.05,`

    const BOM = '﻿'
    const blob = new Blob([BOM + template], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'recipe_template.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => navigate('/recipes')}
          className="p-2 hover:bg-gray-100 rounded-lg"
          title="رجوع"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">استيراد وصفات من Excel</h1>
          <p className="text-gray-600">رفع ملف Excel لإضافة عدة وصفات مرة واحدة</p>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          تعليمات الاستيراد
        </h3>
        <ul className="text-sm text-blue-800 space-y-1 mr-6 list-disc">
          <li>قم بتحميل ملف النموذج أولاً</li>
          <li>املأ البيانات في الملف (اسم الوصفة، كود الصنف، الكمية)</li>
          <li>كل صف يمثل مكون واحد في الوصفة، والكمية بوحدة مخزون الصنف</li>
          <li>الوصفات التي لها نفس الاسم سيتم دمج مكوناتها</li>
          <li>تأكد من أن أكواد الأصناف موجودة في النظام؛ الوصفة التي بها سطر خاطئ لا يتم استيرادها</li>
          <li>الوصفات الموجودة بنفس الاسم لا يتم استيرادها مرة أخرى</li>
          <li>احفظ الملف بصيغة CSV (UTF-8)</li>
        </ul>
      </div>

      {/* Download Template */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">1. تحميل ملف النموذج</h3>
        <button
          type="button"
          onClick={downloadTemplate}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
          <FileSpreadsheet className="w-4 h-4" />
          تحميل ملف النموذج
        </button>
      </div>

      {/* Upload File */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">2. رفع ملف Excel</h3>
        <div className="mb-4 max-w-sm">
          <label className="block text-sm font-medium text-gray-700 mb-2">مجموعة الوصفات <span className="text-red-500">*</span></label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-label="مجموعة الوصفات"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="">اختر المجموعة</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
          </select>
        </div>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <input
            type="file"
            accept=".csv,.txt"
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium"
          >
            اختر ملف CSV
          </label>
          <p className="text-sm text-gray-500 mt-2">أو اسحب الملف هنا</p>
          {file && (
            <p className="text-sm text-gray-700 mt-4 font-medium">
              الملف المحدد: {file.name}
            </p>
          )}
        </div>
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">معاينة البيانات (أول 5 صفوف)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-right">اسم الوصفة</th>
                  <th className="px-4 py-2 text-right">كود الصنف</th>
                  <th className="px-4 py-2 text-right">اسم الصنف</th>
                  <th className="px-4 py-2 text-right">الكمية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.map((row, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">{row['اسم الوصفة']}</td>
                    <td className="px-4 py-2">{row['كود الصنف']}</td>
                    <td className="px-4 py-2">{row['اسم الصنف']}</td>
                    <td className="px-4 py-2">{row['الكمية']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import Button */}
      {file && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleImport}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Upload className="w-5 h-5" />
            {loading ? 'جاري الاستيراد...' : 'بدء الاستيراد'}
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">نتائج الاستيراد</h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-green-700 mb-1">
                <CheckCircle className="w-5 h-5" />
                <span className="font-semibold">نجح</span>
              </div>
              <p className="text-2xl font-bold text-green-900">{result.success}</p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-700 mb-1">
                <XCircle className="w-5 h-5" />
                <span className="font-semibold">فشل</span>
              </div>
              <p className="text-2xl font-bold text-red-900">{result.failed}</p>
            </div>
          </div>

          {result.skipped > 0 && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-2 text-yellow-800 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              تم تخطي {result.skipped} صف بدون اسم الوصفة (التفاصيل في قائمة الأخطاء)
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="mt-4">
              <h4 className="font-semibold text-red-900 mb-2">الأخطاء:</h4>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-h-60 overflow-y-auto">
                <ul className="text-sm text-red-800 space-y-1">
                  {result.errors.map((error, i) => (
                    <li key={i}>• {error}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {result.success > 0 && (
            <button
              type="button"
              onClick={() => navigate('/recipes')}
              className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              العودة لقائمة الوصفات
            </button>
          )}
        </div>
      )}
    </div>
  )
}
