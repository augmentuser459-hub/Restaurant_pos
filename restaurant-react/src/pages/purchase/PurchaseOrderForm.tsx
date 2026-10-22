import { useState, useEffect, useRef, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { branchesService } from '../../services/branches.service'
import { inventoryService } from '../../services/inventory.service'
import { suppliersService } from '../../services/suppliers.service'
import { purchaseService } from '../../services/purchase.service'
import { useAuth } from '../../contexts/AuthContext'
import { Branch, Item, Supplier } from '../../types/database.types'
import { formatCurrency, parseDecimal, roundMoney, roundQuantity } from '../../lib/utils'
import { todayLocal } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, Search, X, Barcode } from 'lucide-react'

// Quantities and prices are kept as typed (Arabic digits allowed) and parsed with parseDecimal.
interface OrderItem {
  // Stable id of the row in this form (React key and search-text key), so removing a row
  // doesn't shift another row's search text or input state onto its neighbour
  row_id: string
  item_id: string
  quantity: string
  unit_price: string
  notes: string
  // The purchase request line this row was copied from (with its item)
  request_line?: { id: string; item_id: string }
}

let lastRowId = 0
const newRowId = () => `row-${++lastRowId}`

const emptyRow = (): OrderItem => ({ row_id: newRowId(), item_id: '', quantity: '1', unit_price: '', notes: '' })

// A row stays linked to its request line only while it still has that line's item
const linkedRequestItemId = (row: OrderItem) =>
  row.request_line && row.request_line.item_id === row.item_id ? row.request_line.id : undefined

// Request statuses that can still get a purchase order for their approved, not yet ordered lines
const ORDERABLE_REQUEST_STATUSES = ['approved', 'ordered', 'partially_received']

// Line total of a row (0 while the inputs are not valid numbers)
const lineTotal = (row: OrderItem) => {
  const qty = parseDecimal(row.quantity)
  const price = parseDecimal(row.unit_price)
  if (qty === null || price === null || qty <= 0 || price <= 0) return 0
  return roundMoney(roundQuantity(qty) * roundMoney(price))
}

export default function PurchaseOrderForm() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const requestId = searchParams.get('request')

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(true)
  const [error, setError] = useState('')
  const submittingRef = useRef(false)

  const [branches, setBranches] = useState<Branch[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [linkedRequest, setLinkedRequest] = useState<{ id: string; number: string } | null>(null)

  const [formData, setFormData] = useState({
    supplier_id: '',
    branch_id: user?.branch_id || '',
    expected_delivery_date: '',
    payment_type: 'cash' as 'cash' | 'credit',
    notes: '',
  })

  const [orderItems, setOrderItems] = useState<OrderItem[]>([emptyRow()])
  // Search text per row, keyed by the row's row_id
  const [searchTerm, setSearchTerm] = useState<Record<string, string>>({})

  const filteredItems = (rowId: string) => {
    const term = searchTerm[rowId]?.toLowerCase() || ''
    if (!term) return items
    return items.filter(item =>
      item.name_ar.toLowerCase().includes(term) ||
      item.code.toLowerCase().includes(term) ||
      (item.barcode && item.barcode.toLowerCase().includes(term))
    )
  }

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const [branchesRes, itemsRes, suppliersRes] = await Promise.all([
      branchesService.getActive(),
      inventoryService.getAllItems(),
      suppliersService.getActive()
    ])
    const loadError = branchesRes.error || itemsRes.error || suppliersRes.error
    if (loadError) setError('فشل في تحميل البيانات: ' + toUserMessage(loadError))
    if (branchesRes.data) setBranches(branchesRes.data)
    const activeItems = (itemsRes.data || []).filter(i => i.status === 'active')
    setItems(activeItems)
    if (suppliersRes.data) setSuppliers(suppliersRes.data)
    if (requestId) await prefillFromRequest(requestId, activeItems)
    setFetchLoading(false)
  }

  // "إنشاء أمر شراء" from an approved purchase request: copy its lines that no purchase order covers yet.
  // Lines removed here stay open on the request and can go on another order (e.g. for another supplier).
  const prefillFromRequest = async (id: string, activeItems: Item[]) => {
    const { data: request, error: requestError } = await purchaseService.getRequestById(id)
    if (requestError || !request) {
      setError('فشل في تحميل طلب الشراء: ' + toUserMessage(requestError))
      return
    }
    const lines = (request.items || []).filter(l => l.item_status === 'approved')
    if (!ORDERABLE_REQUEST_STATUSES.includes(request.status) || lines.length === 0) {
      setError(`لا يمكن إنشاء أمر شراء من الطلب ${request.request_number}: الطلب غير معتمد أو تم إصدار أوامر شراء لكل أصنافه`)
      return
    }
    const supplierIds = [...new Set(lines.map(l => l.supplier_id).filter(Boolean))]
    setFormData(prev => ({
      ...prev,
      branch_id: request.branch_id,
      supplier_id: supplierIds.length === 1 ? String(supplierIds[0]) : prev.supplier_id,
    }))
    setOrderItems(lines.map(l => {
      const price = l.estimated_unit_price || activeItems.find(i => i.id === l.item_id)?.purchase_price || 0
      return {
        row_id: newRowId(),
        item_id: l.item_id,
        quantity: String(l.approved_quantity ?? l.requested_quantity),
        unit_price: price > 0 ? String(price) : '',
        notes: l.notes || '',
        request_line: { id: l.id, item_id: l.item_id },
      }
    }))
    setLinkedRequest({ id: request.id, number: request.request_number })
  }

  // Only rows with a selected item are saved, so only they count in the total
  const calculateTotal = () => {
    return roundMoney(orderItems.filter(row => row.item_id).reduce((sum, row) => sum + lineTotal(row), 0))
  }

  const handleAddItem = () => {
    setOrderItems([...orderItems, emptyRow()])
  }

  const handleRemoveItem = (index: number) => {
    if (orderItems.length > 1) {
      const removedRowId = orderItems[index]?.row_id
      setOrderItems(orderItems.filter((_, i) => i !== index))
      if (removedRowId) {
        setSearchTerm(prev => {
          const next = { ...prev }
          delete next[removedRowId]
          return next
        })
      }
    }
  }

  const handleItemChange = (index: number, field: keyof OrderItem, value: string) => {
    const updated = [...orderItems]
    updated[index] = { ...updated[index], [field]: value }

    if (field === 'item_id') {
      if (value) {
        // If item is selected, auto-fill the price from item data
        const selectedItem = items.find(i => i.id === value)
        if (selectedItem && selectedItem.purchase_price) {
          updated[index].unit_price = String(selectedItem.purchase_price)
        }
      } else {
        // Clearing the item clears its price too, so the row cannot be saved half-filled
        updated[index].unit_price = ''
      }
    }

    setOrderItems(updated)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submittingRef.current) return
    setError('')

    // Check if user is logged in
    if (!user?.id) {
      setError('يجب تسجيل الدخول أولاً')
      return
    }

    const lines: { item_id: string; quantity: number; unit_price: number; notes?: string; request_item_id?: string }[] = []
    for (let i = 0; i < orderItems.length; i++) {
      const row = orderItems[i]
      if (!row.item_id) {
        // A row with a price but no item would silently be dropped: make the user fix it
        if (row.unit_price.trim() !== '' && parseDecimal(row.unit_price) !== 0) {
          setError(`السطر ${i + 1}: اختر الصنف أو احذف السطر`)
          return
        }
        continue
      }
      const name = items.find(it => it.id === row.item_id)?.name_ar || `السطر ${i + 1}`
      const qty = parseDecimal(row.quantity)
      const price = parseDecimal(row.unit_price)
      if (qty === null || qty <= 0) {
        setError(`الكمية غير صحيحة للصنف "${name}"`)
        return
      }
      if (price === null || price <= 0) {
        setError(`سعر الوحدة غير صحيح للصنف "${name}"`)
        return
      }
      lines.push({
        item_id: row.item_id,
        quantity: roundQuantity(qty),
        unit_price: roundMoney(price),
        notes: row.notes || undefined,
        // A row whose item was changed is a new line, not the request line it was copied from
        request_item_id: linkedRequestItemId(row),
      })
    }
    if (lines.length === 0) {
      setError('يجب إضافة صنف واحد على الأقل مع السعر')
      return
    }
    if (linkedRequest && !lines.some(l => l.request_item_id)) {
      setError('أمر الشراء لا يحتوي على أي صنف من طلب الشراء')
      return
    }

    submittingRef.current = true
    setLoading(true)

    // Header and lines are saved together. No money and no item price changes here: a credit order becomes
    // supplier debt when it is approved, and the purchase price is updated when the goods are received.
    const { error: saveError } = await purchaseService.createOrder({
      supplier_id: formData.supplier_id,
      branch_id: formData.branch_id,
      payment_type: formData.payment_type,
      expected_delivery_date: formData.expected_delivery_date || undefined,
      notes: formData.notes || undefined,
      request_id: linkedRequest?.id,
      items: lines,
    })

    if (saveError) {
      setError('فشل في حفظ أمر الشراء: ' + toUserMessage(saveError))
      setLoading(false)
      submittingRef.current = false
      return
    }

    navigate('/purchase/orders')
  }

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  if (fetchLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const total = calculateTotal()
  const selectedSupplier = suppliers.find(s => s.id === formData.supplier_id)
  const supplierBalance = roundMoney(Number(selectedSupplier?.current_balance || 0))
  const creditLimit = roundMoney(Number(selectedSupplier?.credit_limit || 0))
  const overLimit = formData.payment_type === 'credit' && creditLimit > 0 && roundMoney(supplierBalance + total) > creditLimit

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button type="button" onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">أمر شراء جديد</h1>
          <p className="text-gray-600">
            {linkedRequest ? `إنشاء أمر شراء من طلب الشراء ${linkedRequest.number}` : 'إنشاء أمر شراء جديد'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات الأمر</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">المورد <span className="text-red-500">*</span></label>
              <select value={formData.supplier_id} onChange={(e) => handleChange('supplier_id', e.target.value)} required
                aria-label="المورد" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="">اختر المورد</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name_ar} ({s.code})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الفرع <span className="text-red-500">*</span></label>
              <select value={formData.branch_id} onChange={(e) => handleChange('branch_id', e.target.value)} required
                aria-label="الفرع" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="">اختر الفرع</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name_ar}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">تاريخ التسليم المتوقع</label>
              <input type="date" value={formData.expected_delivery_date} min={todayLocal()} onChange={(e) => handleChange('expected_delivery_date', e.target.value)}
                aria-label="تاريخ التسليم المتوقع" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" dir="ltr" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">طريقة الدفع <span className="text-red-500">*</span></label>
              <select value={formData.payment_type} onChange={(e) => handleChange('payment_type', e.target.value as 'cash' | 'credit')} required
                aria-label="طريقة الدفع" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="cash">كاش (دفع فوري)</option>
                <option value="credit">آجل (دفع بالتقسيط)</option>
              </select>
              {formData.payment_type === 'credit' && selectedSupplier && (
                <p className={`text-xs mt-1 ${overLimit ? 'text-red-600' : 'text-gray-500'}`}>
                  مديونية المورد الحالية: {formatCurrency(supplierBalance)}
                  {creditLimit > 0 && ` — حد الائتمان: ${formatCurrency(creditLimit)}`}
                  {overLimit && ' (هذا الأمر يتجاوز حد الائتمان)'}
                </p>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
              <input type="text" value={formData.notes} onChange={(e) => handleChange('notes', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="ملاحظات..." />
            </div>
          </div>
        </div>


        {/* Order Items */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">الأصناف</h2>
            <button type="button" onClick={handleAddItem}
              className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg">
              <Plus className="w-4 h-4" />
              إضافة صنف
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الصنف</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الكمية</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">سعر الوحدة</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الإجمالي</th>
                  <th className="py-3 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {orderItems.map((item, index) => {
                  const selectedItem = items.find(i => i.id === item.item_id)
                  const searchResults = filteredItems(item.row_id)
                  const showResults = searchTerm[item.row_id] && searchResults.length > 0

                  return (
                    <tr key={item.row_id} className="border-b border-gray-100">
                      <td className="py-3 px-2">
                        <div className="relative">
                          {/* Search Input with Icon */}
                          <div className="flex items-center gap-2 mb-2 bg-blue-50 rounded-lg p-2">
                            <div className="bg-blue-600 text-white p-2 rounded-lg">
                              <Search className="w-5 h-5" />
                            </div>
                            <input
                              type="text"
                              placeholder="امسح الباركود أو أدخل الكود أو اسم الصنف"
                              value={searchTerm[item.row_id] || ''}
                              onChange={(e) => {
                                setSearchTerm({ ...searchTerm, [item.row_id]: e.target.value })
                                // Auto-select if only one result
                                const results = items.filter(i =>
                                  i.name_ar.toLowerCase().includes(e.target.value.toLowerCase()) ||
                                  i.code.toLowerCase().includes(e.target.value.toLowerCase()) ||
                                  (i.barcode && i.barcode.toLowerCase().includes(e.target.value.toLowerCase()))
                                )
                                if (results.length === 1 && e.target.value.length > 2) {
                                  handleItemChange(index, 'item_id', results[0].id)
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  if (searchResults.length > 0) {
                                    handleItemChange(index, 'item_id', searchResults[0].id)
                                    setSearchTerm({ ...searchTerm, [item.row_id]: '' })
                                  }
                                }
                              }}
                              className="flex-1 px-3 py-2 border-0 bg-transparent focus:outline-none text-gray-700 placeholder-gray-500"
                            />
                          </div>

                          {/* Search Results Dropdown */}
                          {showResults && (
                            <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                              {searchResults.map(i => (
                                <button
                                  key={i.id}
                                  type="button"
                                  onClick={() => {
                                    handleItemChange(index, 'item_id', i.id)
                                    setSearchTerm({ ...searchTerm, [item.row_id]: '' })
                                  }}
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
                                  {linkedRequest && linkedRequestItemId(item) && (
                                    <p className="text-xs text-blue-600 mt-1">من طلب الشراء {linkedRequest.number}</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleItemChange(index, 'item_id', '')
                                    setSearchTerm({ ...searchTerm, [item.row_id]: '' })
                                  }}
                                  className="text-red-500 hover:text-red-700"
                                  title="إلغاء الاختيار"
                                >
                                  <X className="w-5 h-5" />
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Helper Text */}
                          {!selectedItem && !searchTerm[item.row_id] && (
                            <p className="text-sm text-blue-600 mt-2 flex items-center gap-2">
                              <Barcode className="w-4 h-4" />
                              استخدم قارئ الباركود أو أدخل الكود يدوياً ثم اضغط Enter
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <input type="text" inputMode="decimal" value={item.quantity} onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                          aria-label="الكمية" placeholder="مثال: 19.200" className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" dir="ltr" />
                      </td>
                      <td className="py-3 px-2">
                        <input type="text" inputMode="decimal" value={item.unit_price} onChange={(e) => handleItemChange(index, 'unit_price', e.target.value)}
                          aria-label="سعر الوحدة" placeholder="0.00" className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" dir="ltr" />
                      </td>
                      <td className="py-3 px-2 text-sm font-medium text-gray-900">
                        {(item.item_id ? lineTotal(item) : 0).toLocaleString('ar-EG')} ج.م
                      </td>
                      <td className="py-3 px-2">
                        <button type="button" onClick={() => handleRemoveItem(index)} disabled={orderItems.length === 1}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed" title="حذف">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex justify-between gap-8">
                <span className="text-gray-600">الإجمالي:</span>
                <span className="font-bold text-lg text-gray-900">{total.toLocaleString('ar-EG')} ج.م</span>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? (
              <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />جاري الحفظ...</>
            ) : (
              <><Save className="w-5 h-5" />حفظ الأمر</>
            )}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">
            إلغاء
          </button>
        </div>
      </form>
    </div>
  )
}
