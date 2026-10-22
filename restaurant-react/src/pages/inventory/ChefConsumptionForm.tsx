import { useState, useEffect, FormEvent, useRef } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { fetchAll } from '../../lib/fetchAll'
import { inventoryService } from '../../services/inventory.service'
import { useAuth } from '../../contexts/AuthContext'
import { todayLocal } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { formatQuantity, parseDecimal, roundQuantity } from '../../lib/utils'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, Barcode, Search } from 'lucide-react'
import { displayCode, findItemsByScan, roleName, scanKey } from './stockHelpers'

interface Branch {
  id: string
  name_ar: string
}

interface Item {
  id: string
  code: string
  barcode: string | null
  name_ar: string
}

interface ConsumptionItem {
  item_id: string
  quantity: string // as typed; validated on save
  content: string
  notes: string
}

const emptyRow = (): ConsumptionItem => ({ item_id: '', quantity: '', content: '1', notes: '' })

export default function ChefConsumptionForm() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [stockByItem, setStockByItem] = useState<Map<string, number>>(new Map())
  const [stockLoaded, setStockLoaded] = useState(false)

  // Check if user has permission to access this page
  const userRole = roleName(user?.role)

  const [formData, setFormData] = useState({
    branch_id: '',
    count_date: todayLocal(), // Cairo date
    notes: '',
  })

  const [consumptionItems, setConsumptionItems] = useState<ConsumptionItem[]>([emptyRow()])
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeError, setBarcodeError] = useState('')
  const barcodeInputRef = useRef<HTMLInputElement>(null)
  const stockRequestRef = useRef(0) // ignores a late stock response for a previously selected branch

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (formData.branch_id) fetchBranchStock(formData.branch_id)
    else {
      stockRequestRef.current++ // drop a response still on its way for the previous branch
      setStockByItem(new Map())
      setStockLoaded(false)
    }
  }, [formData.branch_id])

  const fetchData = async () => {
    try {
      const [branchesRes, itemsData] = await Promise.all([
        supabase.from('branches').select('id, name_ar').order('name_ar'),
        // every active item (more than the 1000 rows one request returns), with its barcode for scanning
        fetchAll<Item>((from, to) =>
          supabase.from('items').select('id, code, barcode, name_ar').eq('status', 'active').order('name_ar').order('id').range(from, to)
        ),
      ])
      if (branchesRes.error) throw branchesRes.error
      setBranches((fixEncodingInData(branchesRes.data) as Branch[]) || [])
      setItems(fixEncodingInData(itemsData) as Item[])
    } catch (loadError) {
      setError('تعذر تحميل البيانات: ' + toUserMessage(loadError))
    }
  }

  const fetchBranchStock = async (branchId: string) => {
    const request = ++stockRequestRef.current
    setStockLoaded(false)
    setStockByItem(new Map())
    try {
      const rows = await fetchAll<{ item_id: string; quantity: number }>((from, to) =>
        supabase.from('inventory').select('item_id, quantity').eq('branch_id', branchId).order('id').range(from, to)
      )
      if (request !== stockRequestRef.current) return // another branch was selected meanwhile
      setStockByItem(new Map(rows.map(r => [r.item_id, Number(r.quantity)])))
      setStockLoaded(true)
    } catch (loadError) {
      if (request !== stockRequestRef.current) return
      setError('تعذر تحميل أرصدة الفرع: ' + toUserMessage(loadError))
    }
  }

  // Only admin and warehouse_manager can access chef consumption (checked after all hooks ran)
  if (userRole && !['admin', 'warehouse_manager'].includes(userRole)) {
    return <Navigate to="/dashboard" replace />
  }

  const addItem = () => {
    setConsumptionItems([...consumptionItems, emptyRow()])
  }

  // Barcode search function
  const handleBarcodeSearch = () => {
    const code = barcodeInput.trim()
    if (!code) return
    setBarcodeError('')

    // Barcode, then code (also codes stored in quotes, e.g. "6223000123456"), then the only partial match
    let matches = findItemsByScan(items, code)
    const key = scanKey(code)
    const hasStock = (m: Item) => (stockByItem.get(m.id) ?? 0) > 0
    if (matches.length === 1 && stockLoaded && key && !hasStock(matches[0])) {
      // the barcode found an item with no stock here, but the same product may also be stored under this code
      // (e.g. "6223000123456"): use the one with stock; several with stock -> the user chooses (message below)
      const single = matches[0]
      const inStock = items.filter(i => i.id !== single.id && (scanKey(i.code) === key || scanKey(i.barcode) === key) && hasStock(i))
      if (inStock.length > 0) matches = inStock
    } else if (matches.length > 1 && stockLoaded && matches.every(m => scanKey(m.code) === key)) {
      // duplicates of the same code (e.g. 6223000123456 and "6223000123456"): take the only one with stock here
      const inStock = matches.filter(hasStock)
      if (inStock.length === 1) matches = inStock
    }
    if (matches.length > 1) {
      setBarcodeError(`يوجد ${matches.length} أصناف تطابق "${code}". اكتب الكود كاملاً أو اختر الصنف من القائمة`)
      return
    }
    const item = matches[0]

    if (item) {
      // Check if item already exists in list
      const existingIndex = consumptionItems.findIndex(ci => ci.item_id === item.id)
      if (existingIndex >= 0) {
        // Increment quantity
        const updated = [...consumptionItems]
        const current = parseDecimal(updated[existingIndex].quantity) ?? 0
        updated[existingIndex] = { ...updated[existingIndex], quantity: String(roundQuantity(current + 1)) }
        setConsumptionItems(updated)
      } else {
        // Add new item
        const newItem: ConsumptionItem = { item_id: item.id, quantity: '1', content: '1', notes: '' }
        // Replace empty item or add new
        const emptyIndex = consumptionItems.findIndex(ci => !ci.item_id)
        if (emptyIndex >= 0) {
          const updated = [...consumptionItems]
          updated[emptyIndex] = newItem
          setConsumptionItems(updated)
        } else {
          setConsumptionItems([...consumptionItems, newItem])
        }
      }
      setBarcodeInput('')
      barcodeInputRef.current?.focus()
    } else {
      setBarcodeError(`لم يتم العثور على صنف بالباركود: ${code}`)
    }
  }

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleBarcodeSearch()
    }
  }

  const removeItem = (index: number) => {
    if (consumptionItems.length > 1) {
      setConsumptionItems(consumptionItems.filter((_, i) => i !== index))
    }
  }

  const updateItem = (index: number, field: keyof ConsumptionItem, value: string) => {
    const updated = [...consumptionItems]
    updated[index] = { ...updated[index], [field]: value }
    setConsumptionItems(updated)
  }

  const itemName = (itemId: string) => items.find(i => i.id === itemId)?.name_ar || 'صنف'

  // Total requested per item (the same item may be on several rows)
  const requestedByItem = new Map<string, number>()
  for (const row of consumptionItems) {
    const qty = parseDecimal(row.quantity)
    if (row.item_id && qty !== null && qty > 0) {
      requestedByItem.set(row.item_id, roundQuantity((requestedByItem.get(row.item_id) || 0) + qty))
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')

    if (!formData.branch_id) {
      setError('يرجى اختيار الفرع')
      return
    }
    if (formData.count_date > todayLocal()) {
      setError('لا يمكن تسجيل استهلاك بتاريخ مستقبلي')
      return
    }

    const selectedRows = consumptionItems.filter(row => row.item_id)
    if (selectedRows.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل')
      return
    }
    for (const row of selectedRows) {
      const qty = parseDecimal(row.quantity)
      if (qty === null || qty <= 0) {
        setError(`أدخل كمية أكبر من صفر للصنف "${itemName(row.item_id)}"`)
        return
      }
      const content = row.content.trim() === '' ? 1 : parseDecimal(row.content)
      if (content === null || content <= 0) {
        setError(`قيمة "المحتوى" غير صحيحة للصنف "${itemName(row.item_id)}"`)
        return
      }
    }

    // Show shortages instead of deducting less than recorded (the database refuses them too)
    if (stockLoaded) {
      const shortages = [...requestedByItem.entries()]
        .filter(([itemId, qty]) => qty > (stockByItem.get(itemId) ?? 0))
        .map(([itemId, qty]) => `${itemName(itemId)}: المتاح ${formatQuantity(stockByItem.get(itemId) ?? 0)} والمطلوب ${formatQuantity(qty)}`)
      if (shortages.length > 0) {
        setError('الكمية غير كافية:\n' + shortages.join('\n'))
        return
      }
    }

    setLoading(true)
    // One database call: saves the record and deducts each item (rows of the same item are added together)
    const { error: saveError } = await inventoryService.recordChefConsumption({
      branchId: formData.branch_id,
      date: formData.count_date,
      notes: formData.notes.trim() || undefined,
      items: selectedRows.map(row => ({
        item_id: row.item_id,
        quantity: roundQuantity(parseDecimal(row.quantity) as number),
        content: row.content.trim() === '' ? 1 : roundQuantity(parseDecimal(row.content) as number),
        notes: row.notes.trim() || undefined,
      })),
    })

    if (saveError) {
      setError('فشل في حفظ الاستهلاك ولم يتم خصم أي كمية: ' + toUserMessage(saveError))
      setLoading(false)
      return
    }
    navigate('/inventory/chef-consumption')
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button
          type="button"
          onClick={() => navigate('/inventory/chef-consumption')}
          className="p-2 hover:bg-gray-100 rounded-lg"
          title="رجوع"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">إضافة استهلاك</h1>
          <p className="text-gray-600">تسجيل استهلاك الطباخ للمواد</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700 whitespace-pre-line">{error}</p>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        // Enter (e.g. from a barcode scanner) in any field must not save and deduct stock before the list is complete
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault() }}
        className="space-y-6"
      >
        {/* Basic Info */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات الاستهلاك</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="branch_id" className="block text-sm font-medium text-gray-700 mb-2">
                الفرع <span className="text-red-500">*</span>
              </label>
              <select
                id="branch_id"
                value={formData.branch_id}
                onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">اختر الفرع</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name_ar}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="count_date" className="block text-sm font-medium text-gray-700 mb-2">
                التاريخ <span className="text-red-500">*</span>
              </label>
              <input
                id="count_date"
                type="date"
                value={formData.count_date}
                max={todayLocal()}
                onChange={(e) => setFormData({ ...formData, count_date: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
                ملاحظات
              </label>
              <textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={2}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="ملاحظات إضافية..."
              />
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">الأصناف المستهلكة</h2>
            <button
              type="button"
              onClick={addItem}
              className="flex items-center gap-2 px-3 py-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
            >
              <Plus className="w-4 h-4" />
              إضافة صنف
            </button>
          </div>

          {/* Barcode Scanner Input */}
          <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
            <label className="flex items-center gap-2 text-sm font-medium text-orange-800 mb-2">
              <Barcode className="w-4 h-4" />
              إضافة صنف بالباركود
            </label>
            <div className="flex gap-2">
              <input
                ref={barcodeInputRef}
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={handleBarcodeKeyDown}
                placeholder="امسح الباركود أو أدخل كود الصنف"
                className="flex-1 px-4 py-2 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                dir="ltr"
              />
              <button
                type="button"
                onClick={handleBarcodeSearch}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
                title="بحث بالباركود"
                aria-label="بحث بالباركود"
              >
                <Search className="w-5 h-5" />
              </button>
            </div>
            {barcodeError && <p className="text-red-600 text-sm mt-2">{barcodeError}</p>}
            <p className="text-xs text-orange-600 mt-1">استخدم قارئ الباركود أو أدخل الكود يدوياً ثم اضغط Enter</p>
          </div>

          <div className="space-y-4">
            {consumptionItems.map((item, index) => {
              const available = item.item_id ? stockByItem.get(item.item_id) : undefined
              const requested = item.item_id ? requestedByItem.get(item.item_id) ?? 0 : 0
              const short = stockLoaded && item.item_id !== '' && requested > (available ?? 0)
              return (
                <div key={index} className="flex gap-4 items-start p-4 bg-gray-50 rounded-lg">
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">الصنف</label>
                      <select
                        value={item.item_id}
                        onChange={(e) => updateItem(index, 'item_id', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        aria-label="الصنف"
                      >
                        <option value="">اختر</option>
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name_ar} ({displayCode(i.code)})
                          </option>
                        ))}
                      </select>
                      {item.item_id && stockLoaded && (
                        <p className={`text-xs mt-1 ${short ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                          {available === undefined ? 'غير موجود في مخزون هذا الفرع' : `المتاح: ${formatQuantity(available)}`}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">جزئي (الكمية)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                        className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 ${short ? 'border-red-400' : 'border-gray-300'}`}
                        dir="ltr"
                        placeholder="0"
                        aria-label="الكمية"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">المحتوى</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.content}
                        onChange={(e) => updateItem(index, 'content', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        dir="ltr"
                        aria-label="المحتوى"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">ملاحظات</label>
                      <input
                        type="text"
                        value={item.notes}
                        onChange={(e) => updateItem(index, 'notes', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        placeholder="ملاحظات"
                        aria-label="ملاحظات"
                      />
                    </div>
                  </div>
                  {consumptionItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                      title="حذف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )
            })}
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
            onClick={() => navigate('/inventory/chef-consumption')}
            className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            إلغاء
          </button>
        </div>
      </form>
    </div>
  )
}
