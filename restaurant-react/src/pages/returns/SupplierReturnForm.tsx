import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { returnsService } from '../../services/returns.service'
import { fetchPickerItems, PickerItem } from '../../services/transfers.service'
import { toUserMessage } from '../../lib/errors'
import { formatCurrency, parseDecimal, roundMoney, roundQuantity } from '../../lib/utils'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, Search, X, Barcode } from 'lucide-react'

interface Supplier {
  id: string
  name_ar: string
  code: string
}

interface ReturnItem {
  key: string // stable row id (React key), so a row's search text never moves to another row
  item_id: string
  quantity: number
  unit_price: number
  reason: string
  notes: string
  search: string
}

let rowSeq = 0
const newRow = (): ReturnItem => ({ key: `row-${++rowSeq}`, item_id: '', quantity: 1, unit_price: 0, reason: '', notes: '', search: '' })

const matchesTerm = (item: PickerItem, term: string) =>
  item.name_ar.toLowerCase().includes(term) ||
  item.code.toLowerCase().includes(term) ||
  Boolean(item.barcode && item.barcode.toLowerCase().includes(term))

export default function SupplierReturnForm() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [items, setItems] = useState<PickerItem[]>([])

  const [formData, setFormData] = useState({
    supplier_id: '',
    return_reason: '',
    notes: '',
  })

  const [returnItems, setReturnItems] = useState<ReturnItem[]>(() => [newRow()])

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const [suppliersRes, itemsRes] = await Promise.all([
      supabase.from('suppliers').select('id, name_ar, code').eq('status', 'active').order('name_ar'),
      fetchPickerItems(),
    ])
    if (suppliersRes.error || itemsRes.error) {
      setError('تعذر تحميل البيانات: ' + toUserMessage(suppliersRes.error || itemsRes.error))
    }
    setSuppliers((fixEncodingInData(suppliersRes.data) as Supplier[]) || [])
    setItems(itemsRes.data.filter(i => i.status === 'active'))
  }

  const addItem = () => {
    setReturnItems(rows => [...rows, newRow()])
  }

  const filteredItems = (search: string) => {
    const term = search.toLowerCase()
    if (!term) return items
    return items.filter(item => matchesTerm(item, term))
  }

  const removeItem = (key: string) => {
    setReturnItems(rows => (rows.length > 1 ? rows.filter(r => r.key !== key) : rows))
  }

  // Selecting an item also fills its purchase price (0 when it has none: never keep the previous item's price)
  const selectItem = (key: string, itemId: string, extra: Partial<ReturnItem> = {}) => {
    const item = items.find(i => i.id === itemId)
    setReturnItems(rows => rows.map(r => (r.key === key
      ? { ...r, ...extra, item_id: itemId, unit_price: item?.purchase_price != null ? Number(item.purchase_price) : 0 }
      : r)))
  }

  const updateRow = (key: string, changes: Partial<ReturnItem>) => {
    setReturnItems(rows => rows.map(r => (r.key === key ? { ...r, ...changes } : r)))
  }

  const lineTotal = (item: ReturnItem) => roundMoney(item.quantity * item.unit_price)

  // Calculate totals
  const calculateTotal = () => roundMoney(returnItems.filter(i => i.item_id).reduce((sum, item) => sum + lineTotal(item), 0))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')

    if (!formData.supplier_id) {
      setError('يرجى اختيار المورد')
      return
    }

    if (!user?.id) {
      setError('يرجى تسجيل الدخول مرة أخرى')
      return
    }

    const chosen = returnItems.filter(item => item.item_id)
    if (chosen.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل')
      return
    }
    const badQty = chosen.find(i => !(i.quantity > 0))
    if (badQty) {
      const itemName = items.find(i => i.id === badQty.item_id)?.name_ar || ''
      setError(`يرجى إدخال كمية أكبر من صفر للصنف ${itemName}`)
      return
    }
    if (chosen.some(i => !(i.unit_price >= 0))) {
      setError('سعر الوحدة لا يمكن أن يكون سالباً')
      return
    }

    // All lines are saved in one database transaction (stock is checked there; nothing is half-saved)
    setLoading(true)
    const { error: saveError } = await returnsService.createSupplierReturn({
      supplier_id: formData.supplier_id,
      reason: formData.return_reason,
      notes: formData.notes,
      items: chosen.map(i => ({
        item_id: i.item_id,
        quantity: roundQuantity(i.quantity),
        unit_price: i.unit_price,
        reason: i.reason,
        notes: i.notes,
      })),
    })

    if (saveError) {
      setError('فشل في حفظ المرتجع: ' + toUserMessage(saveError))
      setLoading(false)
      return
    }

    navigate('/returns')
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button
          type="button"
          onClick={() => navigate('/returns')}
          className="p-2 hover:bg-gray-100 rounded-lg"
          title="رجوع"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">مرتجع جديد للمورد</h1>
          <p className="text-gray-600">إضافة مرتجع من المخزن الرئيسي للمورد</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700 whitespace-pre-line">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Supplier Selection */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات المرتجع</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="supplier_id" className="block text-sm font-medium text-gray-700 mb-2">
                المورد <span className="text-red-500">*</span>
              </label>
              <select
                id="supplier_id"
                value={formData.supplier_id}
                onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">اختر المورد</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name_ar} ({s.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="return_reason" className="block text-sm font-medium text-gray-700 mb-2">
                سبب الإرجاع العام
              </label>
              <input
                id="return_reason"
                type="text"
                value={formData.return_reason}
                onChange={(e) => setFormData({ ...formData, return_reason: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="مثال: انتهاء الصلاحية، تالف..."
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
                ملاحظات عامة
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
            <h2 className="text-lg font-semibold text-gray-900">الأصناف</h2>
            <button
              type="button"
              onClick={addItem}
              className="flex items-center gap-2 px-3 py-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
            >
              <Plus className="w-4 h-4" />
              إضافة صنف
            </button>
          </div>

          {/* Items Table */}
          <div className="space-y-4">
            {returnItems.map((item) => {
              const selectedItem = items.find(i => i.id === item.item_id)
              const searchResults = filteredItems(item.search)
              const showResults = item.search && searchResults.length > 0

              return (
                <div key={item.key} className="p-4 rounded-lg border bg-gray-50 border-gray-200">
                  <div className="space-y-3">
                    {/* Search Input with Icon */}
                    <div className="relative">
                      <div className="flex items-center gap-2 bg-blue-50 rounded-lg p-2">
                        <div className="bg-blue-600 text-white p-2 rounded-lg">
                          <Search className="w-5 h-5" />
                        </div>
                        <input
                          type="text"
                          placeholder="امسح الباركود أو أدخل الكود أو اسم الصنف"
                          value={item.search}
                          onChange={(e) => {
                            const value = e.target.value
                            // Auto-select if only one result
                            const results = items.filter(i => matchesTerm(i, value.toLowerCase()))
                            if (results.length === 1 && value.length > 2) {
                              selectItem(item.key, results[0].id, { search: value })
                            } else {
                              updateRow(item.key, { search: value })
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              // A scanner sends Enter after every code: pick the item, never submit the form
                              e.preventDefault()
                              if (searchResults.length > 0) {
                                selectItem(item.key, searchResults[0].id, { search: '' })
                              }
                            }
                          }}
                          className="flex-1 px-3 py-2 border-0 bg-transparent focus:outline-none text-gray-700 placeholder-gray-500"
                        />
                      </div>

                      {/* Search Results Dropdown */}
                      {showResults && (
                        <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto mt-1">
                          {searchResults.map(i => (
                            <button
                              key={i.id}
                              type="button"
                              onClick={() => selectItem(item.key, i.id, { search: '' })}
                              className="w-full text-right px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-0 transition-colors"
                            >
                              <div className="font-medium text-gray-900">{i.name_ar}</div>
                              <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                                <span>الكود: {i.code}</span>
                                {i.barcode && (
                                  <>
                                    <span>•</span>
                                    <span>الباركود: {i.barcode}</span>
                                  </>
                                )}
                                {i.purchase_price ? (
                                  <>
                                    <span>•</span>
                                    <span className="text-green-600">{i.purchase_price} ج.م</span>
                                  </>
                                ) : null}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Selected Item Display */}
                      {selectedItem && (
                        <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-green-900">{selectedItem.name_ar}</p>
                              <p className="text-sm text-green-700">
                                الكود: {selectedItem.code}
                                {selectedItem.barcode && ` | الباركود: ${selectedItem.barcode}`}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => updateRow(item.key, { item_id: '', search: '', unit_price: 0 })}
                              className="text-red-500 hover:text-red-700"
                              title="إلغاء الاختيار"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Helper Text */}
                      {!selectedItem && !item.search && (
                        <p className="text-sm text-blue-600 mt-2 flex items-center gap-2">
                          <Barcode className="w-4 h-4" />
                          استخدم قارئ الباركود أو أدخل الكود يدوياً ثم اضغط Enter
                        </p>
                      )}
                    </div>

                    {/* Item Details */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">الكمية</label>
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={item.quantity}
                          onChange={(e) => {
                            const qty = parseDecimal(e.target.value)
                            updateRow(item.key, { quantity: qty !== null && qty > 0 ? roundQuantity(qty) : 0 })
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                          placeholder="مثال: 19.200"
                          dir="ltr"
                          aria-label="الكمية"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">سعر الوحدة</label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.unit_price}
                          onChange={(e) => {
                            const price = parseDecimal(e.target.value)
                            updateRow(item.key, { unit_price: price !== null && price >= 0 ? price : 0 })
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                          dir="ltr"
                          aria-label="سعر الوحدة"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">الإجمالي</label>
                        <div className="px-3 py-2 bg-gray-100 rounded-lg text-sm font-medium text-gray-900">
                          {formatCurrency(lineTotal(item))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">السبب</label>
                        <input
                          type="text"
                          value={item.reason}
                          onChange={(e) => updateRow(item.key, { reason: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                          placeholder="السبب"
                          aria-label="السبب"
                        />
                      </div>
                    </div>

                    {/* Remove Button */}
                    {returnItems.length > 1 && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeItem(item.key)}
                          className="flex items-center gap-1 px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg text-sm"
                          title="حذف"
                        >
                          <Trash2 className="w-4 h-4" />
                          حذف الصنف
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Total */}
          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex justify-between gap-8">
                <span className="text-gray-600">إجمالي قيمة المرتجع:</span>
                <span className="font-bold text-lg text-red-600">
                  {formatCurrency(calculateTotal())}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                عدد الأصناف: {returnItems.filter(i => i.item_id).length}
              </p>
            </div>
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
                حفظ المرتجع
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate('/returns')}
            className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            إلغاء
          </button>
        </div>
      </form>
    </div>
  )
}
