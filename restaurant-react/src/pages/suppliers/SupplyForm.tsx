import { useState, useEffect, FormEvent, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { suppliersService, CreateSupplyData } from '../../services/suppliers.service'
import { branchesService } from '../../services/branches.service'
import { inventoryService } from '../../services/inventory.service'
import { Supplier, Branch, Item, PaymentMethod } from '../../types/database.types'
import { parseDecimal, roundMoney, roundQuantity } from '../../lib/utils'
import { todayLocal } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { findItemsByScan } from '../inventory/stockHelpers'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, Barcode, Search } from 'lucide-react'

// Quantities and prices are kept as typed (Arabic digits allowed) and parsed with parseDecimal.
interface SupplyItemForm {
  item_id: string
  quantity: string
  unit_price: string
  expiry_date?: string
  batch_number?: string
}

const emptyRow = (): SupplyItemForm => ({ item_id: '', quantity: '1', unit_price: '' })

const lineTotal = (row: SupplyItemForm) => {
  const qty = parseDecimal(row.quantity)
  const price = parseDecimal(row.unit_price)
  if (qty === null || price === null || qty <= 0 || price < 0) return 0
  return roundMoney(roundQuantity(qty) * roundMoney(price))
}

export default function SupplyForm() {
  const { supplierId } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(true)
  const [error, setError] = useState('')
  const submittingRef = useRef(false)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [items, setItems] = useState<Item[]>([])

  const [formData, setFormData] = useState({
    supplier_id: supplierId || '',
    branch_id: '',
    supply_date: todayLocal(),
    payment_method: 'cash' as PaymentMethod,
    paid_amount: '',
    invoice_number: '',
    notes: '',
  })

  const [supplyItems, setSupplyItems] = useState<SupplyItemForm[]>([emptyRow()])
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeError, setBarcodeError] = useState('')
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const [suppliersRes, branchesRes, itemsRes] = await Promise.all([
      suppliersService.getActive(),
      branchesService.getActive(),
      inventoryService.getAllItems()
    ])

    const loadError = suppliersRes.error || branchesRes.error || itemsRes.error
    if (loadError) setError('فشل في تحميل البيانات: ' + toUserMessage(loadError))
    if (suppliersRes.data) setSuppliers(suppliersRes.data)
    if (branchesRes.data) setBranches(branchesRes.data)
    if (itemsRes.data) setItems(itemsRes.data.filter(i => i.status === 'active'))

    setFetchLoading(false)
  }


  // Only rows with a selected item are saved, so only they count in the total
  const calculateTotal = () => {
    return roundMoney(supplyItems.filter(row => row.item_id).reduce((sum, row) => sum + lineTotal(row), 0))
  }

  const handleAddItem = () => {
    setSupplyItems([...supplyItems, emptyRow()])
  }

  // Barcode search function
  const handleBarcodeSearch = () => {
    const code = barcodeInput.trim()
    if (!code) return
    setBarcodeError('')

    // Matched like the cashier: barcode, then code (also codes stored in quotes, e.g. "6223000123456"),
    // then the only partial match. Several matches = the user picks the item from the list.
    const matches = findItemsByScan(items, code)
    if (matches.length > 1) {
      setBarcodeError(`يوجد ${matches.length} أصناف تطابق "${code}". اكتب الكود كاملاً أو اختر الصنف من القائمة`)
      return
    }
    const item = matches[0]

    if (item) {
      // Check if item already exists in list
      const existingIndex = supplyItems.findIndex(si => si.item_id === item.id)
      if (existingIndex >= 0) {
        // Increment quantity
        const updated = [...supplyItems]
        const current = parseDecimal(updated[existingIndex].quantity) ?? 0
        updated[existingIndex] = { ...updated[existingIndex], quantity: String(roundQuantity(current + 1)) }
        setSupplyItems(updated)
      } else {
        // Add new item with purchase price
        const newItem: SupplyItemForm = {
          item_id: item.id,
          quantity: '1',
          unit_price: item.purchase_price ? String(item.purchase_price) : ''
        }
        // Replace empty item or add new
        const emptyIndex = supplyItems.findIndex(si => !si.item_id)
        if (emptyIndex >= 0) {
          const updated = [...supplyItems]
          updated[emptyIndex] = newItem
          setSupplyItems(updated)
        } else {
          setSupplyItems([...supplyItems, newItem])
        }
      }
      setBarcodeInput('')
      barcodeInputRef.current?.focus()
    } else {
      setBarcodeError(`لم يتم العثور على صنف بالباركود: ${barcodeInput}`)
    }
  }

  const handleBarcodeKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleBarcodeSearch()
    }
  }

  const handleRemoveItem = (index: number) => {
    if (supplyItems.length > 1) {
      setSupplyItems(supplyItems.filter((_, i) => i !== index))
    }
  }

  const handleItemChange = (index: number, field: keyof SupplyItemForm, value: string) => {
    const updated = [...supplyItems]
    updated[index] = { ...updated[index], [field]: value }
    if (field === 'item_id' && value && !updated[index].unit_price) {
      const selectedItem = items.find(i => i.id === value)
      if (selectedItem?.purchase_price) updated[index].unit_price = String(selectedItem.purchase_price)
    }
    setSupplyItems(updated)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submittingRef.current) return
    setError('')

    // Validate items
    const lines: CreateSupplyData['items'] = []
    for (let i = 0; i < supplyItems.length; i++) {
      const row = supplyItems[i]
      if (!row.item_id) {
        if (row.unit_price.trim() !== '' && parseDecimal(row.unit_price) !== 0) {
          setError(`السطر ${i + 1}: اختر الصنف أو احذف السطر`)
          return
        }
        continue
      }
      const name = items.find(it => it.id === row.item_id)?.name_ar || `السطر ${i + 1}`
      const qty = parseDecimal(row.quantity)
      const price = row.unit_price.trim() === '' ? 0 : parseDecimal(row.unit_price)
      if (qty === null || qty <= 0) {
        setError(`الكمية غير صحيحة للصنف "${name}"`)
        return
      }
      if (price === null || price < 0) {
        setError(`سعر الوحدة غير صحيح للصنف "${name}"`)
        return
      }
      lines.push({
        item_id: row.item_id,
        quantity: roundQuantity(qty),
        unit_price: roundMoney(price),
        expiry_date: row.expiry_date || undefined,
        batch_number: row.batch_number || undefined,
      })
    }
    if (lines.length === 0) {
      setError('يجب إضافة صنف واحد على الأقل')
      return
    }

    // Check for duplicate items
    const itemIds = lines.map(i => i.item_id)
    if (new Set(itemIds).size !== itemIds.length) {
      setError('لا يمكن تكرار نفس الصنف')
      return
    }

    const totalAmount = calculateTotal()
    // Cash supplies are paid in full on delivery; on credit the paid part is between 0 and the total
    let paidAmount = totalAmount
    if (formData.payment_method === 'credit') {
      const paid = formData.paid_amount.trim() === '' ? 0 : parseDecimal(formData.paid_amount)
      if (paid === null || paid < 0 || roundMoney(paid) > totalAmount) {
        setError('المبلغ المدفوع يجب أن يكون بين صفر وإجمالي التوريد')
        return
      }
      paidAmount = roundMoney(paid)
    }

    submittingRef.current = true
    setLoading(true)

    // Supply, lines, stock (+ expiry batches) and the unpaid part as supplier debt are saved in one transaction
    const { error: submitError } = await suppliersService.createSupply({
      supplier_id: formData.supplier_id,
      branch_id: formData.branch_id,
      invoice_date: formData.supply_date,
      payment_method: formData.payment_method,
      paid_amount: paidAmount,
      invoice_number: formData.invoice_number || undefined,
      notes: formData.notes || undefined,
      items: lines,
    })

    if (submitError) {
      setError('فشل في حفظ التوريد: ' + toUserMessage(submitError))
      setLoading(false)
      submittingRef.current = false
      return
    }
    alert('تم حفظ التوريد وإضافة الكميات إلى المخزون')
    navigate(`/suppliers/${formData.supplier_id}`)
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

  const totalAmount = calculateTotal()
  const paidInput = parseDecimal(formData.paid_amount)
  const paidAmount = formData.payment_method === 'cash' ? totalAmount : roundMoney(paidInput !== null && paidInput > 0 ? paidInput : 0)
  const remainingAmount = roundMoney(totalAmount - paidAmount)

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button type="button" onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">توريد جديد</h1>
          <p className="text-gray-600">تسجيل توريد من المورد</p>
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
          <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات التوريد</h2>
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
              <label className="block text-sm font-medium text-gray-700 mb-2">تاريخ التوريد <span className="text-red-500">*</span></label>
              <input type="date" value={formData.supply_date} max={todayLocal()} onChange={(e) => handleChange('supply_date', e.target.value)} required
                aria-label="تاريخ التوريد" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" dir="ltr" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">رقم الفاتورة</label>
              <input type="text" value={formData.invoice_number} onChange={(e) => handleChange('invoice_number', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="INV-001" dir="ltr" />
            </div>
          </div>
        </div>


        {/* Supply Items */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">الأصناف</h2>
            <button type="button" onClick={handleAddItem}
              className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg">
              <Plus className="w-4 h-4" />
              إضافة صنف
            </button>
          </div>

          {/* Barcode Scanner Input */}
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <label className="flex items-center gap-2 text-sm font-medium text-green-800 mb-2">
              <Barcode className="w-4 h-4" />
              إضافة صنف بالباركود
            </label>
            <div className="flex gap-2">
              <input
                ref={barcodeInputRef}
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={handleBarcodeKeyPress}
                placeholder="امسح الباركود أو أدخل كود الصنف"
                className="flex-1 px-4 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500"
                dir="ltr"
              />
              <button
                type="button"
                onClick={handleBarcodeSearch}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                title="بحث بالباركود"
                aria-label="بحث بالباركود"
              >
                <Search className="w-5 h-5" />
              </button>
            </div>
            {barcodeError && <p className="text-red-600 text-sm mt-2">{barcodeError}</p>}
            <p className="text-xs text-green-600 mt-1">استخدم قارئ الباركود أو أدخل الكود يدوياً ثم اضغط Enter</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الصنف</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الكمية</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">سعر الوحدة</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الإجمالي</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">تاريخ الصلاحية</th>
                  <th className="py-3 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {supplyItems.map((item, index) => (
                  <tr key={index} className="border-b border-gray-100">
                    <td className="py-3 px-2">
                      <select value={item.item_id} onChange={(e) => handleItemChange(index, 'item_id', e.target.value)}
                        aria-label="اختر الصنف" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm">
                        <option value="">اختر الصنف</option>
                        {items.map(i => <option key={i.id} value={i.id}>{i.name_ar} ({i.code})</option>)}
                      </select>
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
                      <input type="date" value={item.expiry_date || ''} onChange={(e) => handleItemChange(index, 'expiry_date', e.target.value)}
                        aria-label="تاريخ الصلاحية" className="w-36 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" dir="ltr" />
                    </td>
                    <td className="py-3 px-2">
                      <button type="button" onClick={() => handleRemoveItem(index)} disabled={supplyItems.length === 1}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed" title="حذف">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Payment Info */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات الدفع</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">طريقة الدفع</label>
              <select value={formData.payment_method} onChange={(e) => handleChange('payment_method', e.target.value as PaymentMethod)}
                aria-label="طريقة الدفع" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="cash">نقدي</option>
                <option value="credit">آجل</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">المبلغ المدفوع</label>
              {formData.payment_method === 'cash' ? (
                <input type="text" value={totalAmount.toLocaleString('ar-EG')} disabled
                  aria-label="المبلغ المدفوع" className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500" dir="ltr" />
              ) : (
                <input type="text" inputMode="decimal" value={formData.paid_amount} onChange={(e) => handleChange('paid_amount', e.target.value)}
                  aria-label="المبلغ المدفوع" placeholder="0.00" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" dir="ltr" />
              )}
              {formData.payment_method === 'cash' && <p className="text-xs text-gray-500 mt-1">التوريد النقدي يُدفع بالكامل عند الاستلام</p>}
            </div>
            <div className="flex flex-col justify-end">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-600">الإجمالي:</span>
                  <span className="font-medium">{totalAmount.toLocaleString('ar-EG')} ج.م</span>
                </div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-600">المدفوع:</span>
                  <span className="font-medium text-green-600">{paidAmount.toLocaleString('ar-EG')} ج.م</span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-gray-200">
                  <span className="text-gray-600">المتبقي:</span>
                  <span className={`font-bold ${remainingAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {remainingAmount.toLocaleString('ar-EG')} ج.م
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
            <textarea value={formData.notes} onChange={(e) => handleChange('notes', e.target.value)} rows={2}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="ملاحظات إضافية..." />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? (
              <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />جاري الحفظ...</>
            ) : (
              <><Save className="w-5 h-5" />حفظ التوريد</>
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
