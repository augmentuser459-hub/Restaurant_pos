import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { recipeService } from '../../services/recipe.service'
import { readFileAsText, parseCSV } from '../../lib/excel'
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
  errors: string[]
}

export default function RecipeImport() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [preview, setPreview] = useState<RecipeRow[]>([])

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
    if (!file) return

    setLoading(true)
    setResult(null)

    try {
      const text = await readFileAsText(file)
      const rows = parseCSV(text) as unknown as RecipeRow[]

      const result: ImportResult = {
        success: 0,
        failed: 0,
        errors: []
      }

      // Group rows by recipe name
      const recipeGroups = new Map<string, RecipeRow[]>()
      
      for (const row of rows) {
        const recipeName = row['اسم الوصفة']?.trim()
        if (!recipeName) continue

        if (!recipeGroups.has(recipeName)) {
          recipeGroups.set(recipeName, [])
        }
        recipeGroups.get(recipeName)!.push(row)
      }

      // Create recipes
      for (const [recipeName, ingredients] of recipeGroups) {
        try {
          // Prepare ingredients
          const recipeIngredients = []
          
          for (const ing of ingredients) {
            const itemCode = ing['كود الصنف']?.trim()
            const quantity = parseFloat(ing['الكمية']?.trim() || '0')

            if (!itemCode || !quantity) {
              result.errors.push(`${recipeName}: بيانات غير كاملة للمكون`)
              continue
            }

            // Get item by code
            const { data: items } = await recipeService.searchItems(itemCode)
            const item = items?.find(i => i.code === itemCode)

            if (!item) {
              result.errors.push(`${recipeName}: الصنف ${itemCode} غير موجود`)
              continue
            }

            recipeIngredients.push({
              item_id: item.id,
              quantity: quantity
            })
          }

          if (recipeIngredients.length === 0) {
            result.errors.push(`${recipeName}: لا توجد مكونات صالحة`)
            result.failed++
            continue
          }

          // Create recipe
          const { error } = await recipeService.create({
            name_ar: recipeName,
            name_en: recipeName,
            category_id: null, // Will need to be set manually
            ingredients: recipeIngredients,
            notes: ingredients[0]['ملاحظات'] || ''
          })

          if (error) {
            result.errors.push(`${recipeName}: ${error.message}`)
            result.failed++
          } else {
            result.success++
          }
        } catch (error: any) {
          result.errors.push(`${recipeName}: ${error.message}`)
          result.failed++
        }
      }

      setResult(result)
    } catch (error: any) {
      alert('خطأ في الاستيراد: ' + error.message)
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

    const BOM = '\uFEFF'
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
          <li>كل صف يمثل مكون واحد في الوصفة</li>
          <li>الوصفات التي لها نفس الاسم سيتم دمج مكوناتها</li>
          <li>تأكد من أن أكواد الأصناف موجودة في النظام</li>
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
