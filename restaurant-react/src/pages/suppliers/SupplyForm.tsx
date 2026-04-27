import { useState, useEffect, FormEvent, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { suppliersService, CreateSupplyData } from '../../services/suppliers.service'
import { branchesService } from '../../services/branches.service'
import { inventoryService } from '../../services/inventory.service'
import { useAuth } from '../../contexts/AuthContext'
import { Supplier, Branch, Item, PaymentMethod, PaymentStatus } from '../../types/database.types'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, Barcode, Search } from 'lucide-react'

interface SupplyItemForm {
  item_id: string
  quantity: number
  unit_price: number
  expiry_date?: string
  batch_number?: string
}

export default function SupplyForm() {
  const { supplierId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(true)
  const [error, setError] = useState('')

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [items, setItems] = useState<Item[]>([])

  const [formData, setFormData] = useState({
    supplier_id: supplierId || '',
    branch_id: '',
    supply_date: new Date().toISOString().split('T')[0],
    payment_method: 'cash' as PaymentMethod,
    payment_status: 'pending' as PaymentStatus,
    paid_amount: 0,
    invoice_number: '',
    notes: '',
  })

  const [supplyItems, setSupplyItems] = useState<SupplyItemForm[]>([
    { item_id: '', quantity: 1, unit_price: 0 }
  ])
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

    if (suppliersRes.data) setSuppliers(suppliersRes.data)
    if (branchesRes.data) setBranches(branchesRes.data)
    if (itemsRes.data) setItems(itemsRes.data.filter(i => i.status === 'active'))

    setFetchLoading(false)
  }


  const calculateTotal = () => {
    return supplyItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0)
  }

  const handleAddItem = () => {
    setSupplyItems([...supplyItems, { item_id: '', quantity: 1, unit_price: 0 }])
  }

  // Barcode search function
  const handleBarcodeSearch = () => {
    if (!barcodeInput.trim()) return
    setBarcodeError('')

    // Search by barcode or code
    const item = items.find(i => 
      (i as Item & { barcode?: string }).barcode === barcodeInput.trim() || 
      i.code === barcodeInput.trim()
    )

    if (item) {
      // Check if item already exists in list
      const existingIndex = supplyItems.findIndex(si => si.item_id === item.id)
      if (existingIndex >= 0) {
        // Increment quantity
        const updated = [...supplyItems]
        updated[existingIndex].quantity += 1
        setSupplyItems(updated)
      } else {
        // Add new item with purchase price
        const newItem: SupplyItemForm = {
          item_id: item.id,
          quantity: 1,
          unit_price: item.purchase_price || 0
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

  const handleItemChange = (index: number, field: keyof SupplyItemForm, value: string | number) => {
    const updated = [...supplyItems]
    updated[index] = { ...updated[index], [field]: value }
    setSupplyItems(updated)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate items
    const validItems = supplyItems.filter(item => item.item_id && item.quantity > 0)
    if (validItems.length === 0) {
      setError('يجب إضافة صنف واحد على الأقل')
      return
    }

    // Check for duplicate items
    const itemIds = validItems.map(i => i.item_id)
    if (new Set(itemIds).size !== itemIds.length) {
      setError('لا يمكن تكرار نفس الصنف')
      return
    }

    setLoading(true)

    const totalAmount = calculateTotal()
    const supplyData: CreateSupplyData = {
      supplier_id: formData.supplier_id,
      branch_id: formData.branch_id,
      supply_date: formData.supply_date,
      total_amount: totalAmount,
      paid_amount: formData.paid_amount,
      payment_method: formData.payment_method,
      payment_status: formData.paid_amount >= totalAmount ? 'paid' : formData.paid_amount > 0 ? 'partial' : 'pending',
      invoice_number: formData.invoice_number || undefined,
      notes: formData.notes || undefined,
      created_by: user?.id || '',
      items: validItems.map(item => ({
        item_id: item.item_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        expiry_date: item.expiry_date || undefined,
        batch_number: item.batch_number || undefined,
      }))
    }

    const { error: submitError } = await suppliersService.createSupply(supplyData)

    if (submitError) {
      setError('فشل في حفظ التوريد')
    } else {
      navigate(supplierId ? `/suppliers/${supplierId}` : '/suppliers')
    }
    setLoading(false)
  }

  const handleChange = (field: string, value: string | number) => {
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
  const remainingAmount = totalAmount - formData.paid_amount

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
              <input type="date" value={formData.supply_date} onChange={(e) => handleChange('supply_date', e.target.value)} required
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
                onKeyPress={handleBarcodeKeyPress}
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
                      <input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                        aria-label="الكمية" placeholder="مثال: 19.200" className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" dir="ltr" />
                    </td>
                    <td className="py-3 px-2">
                      <input type="number" min="0" step="0.01" value={item.unit_price} onChange={(e) => handleItemChange(index, 'unit_price', Number(e.target.value))}
                        aria-label="سعر الوحدة" className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" dir="ltr" />
                    </td>
                    <td className="py-3 px-2 text-sm font-medium text-gray-900">
                      {(item.quantity * item.unit_price).toLocaleString('ar-EG')} ج.م
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
              <input type="number" min="0" step="0.01" value={formData.paid_amount} onChange={(e) => handleChange('paid_amount', Number(e.target.value))}
                aria-label="المبلغ المدفوع" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" dir="ltr" />
            </div>
            <div className="flex flex-col justify-end">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-600">الإجمالي:</span>
                  <span className="font-medium">{totalAmount.toLocaleString('ar-EG')} ج.م</span>
                </div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-600">المدفوع:</span>
                  <span className="font-medium text-green-600">{formData.paid_amount.toLocaleString('ar-EG')} ج.م</span>
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
