import { useState, useEffect, FormEvent, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { purchaseService, CreatePurchaseRequestData } from '../../services/purchase.service'
import { branchesService } from '../../services/branches.service'
import { inventoryService } from '../../services/inventory.service'
import { suppliersService } from '../../services/suppliers.service'
import { useAuth } from '../../contexts/AuthContext'
import { Branch, Item, Supplier } from '../../types/database.types'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, Barcode, Search } from 'lucide-react'

interface RequestItem {
  item_id: string
  supplier_id: string
  requested_quantity: number
  estimated_unit_price: number
  notes: string
}

export default function PurchaseRequestForm() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(true)
  const [error, setError] = useState('')

  const [branches, setBranches] = useState<Branch[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  const [formData, setFormData] = useState({
    branch_id: user?.branch_id || '',
    priority: 1,
    notes: '',
  })

  const [requestItems, setRequestItems] = useState<RequestItem[]>([
    { item_id: '', supplier_id: '', requested_quantity: 1, estimated_unit_price: 0, notes: '' }
  ])
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeError, setBarcodeError] = useState('')
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const [branchesRes, itemsRes, suppliersRes] = await Promise.all([
      branchesService.getActive(),
      inventoryService.getAllItems(),
      suppliersService.getActive()
    ])
    if (branchesRes.data) setBranches(branchesRes.data)
    if (itemsRes.data) setItems(itemsRes.data.filter(i => i.status === 'active'))
    if (suppliersRes.data) setSuppliers(suppliersRes.data)
    setFetchLoading(false)
  }


  const calculateTotal = () => {
    return requestItems.reduce((sum, item) => sum + (item.requested_quantity * item.estimated_unit_price), 0)
  }

  const handleAddItem = () => {
    setRequestItems([...requestItems, { item_id: '', supplier_id: '', requested_quantity: 1, estimated_unit_price: 0, notes: '' }])
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
      const existingIndex = requestItems.findIndex(ri => ri.item_id === item.id)
      if (existingIndex >= 0) {
        // Increment quantity
        const updated = [...requestItems]
        updated[existingIndex].requested_quantity += 1
        setRequestItems(updated)
      } else {
        // Add new item with purchase price
        const newItem: RequestItem = {
          item_id: item.id,
          supplier_id: '',
          requested_quantity: 1,
          estimated_unit_price: item.purchase_price || 0,
          notes: ''
        }
        // Replace empty item or add new
        const emptyIndex = requestItems.findIndex(ri => !ri.item_id)
        if (emptyIndex >= 0) {
          const updated = [...requestItems]
          updated[emptyIndex] = newItem
          setRequestItems(updated)
        } else {
          setRequestItems([...requestItems, newItem])
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
    if (requestItems.length > 1) {
      setRequestItems(requestItems.filter((_, i) => i !== index))
    }
  }

  const handleItemChange = (index: number, field: keyof RequestItem, value: string | number) => {
    const updated = [...requestItems]
    updated[index] = { ...updated[index], [field]: value }
    setRequestItems(updated)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    const validItems = requestItems.filter(item => item.item_id && item.requested_quantity > 0)
    if (validItems.length === 0) {
      setError('يجب إضافة صنف واحد على الأقل')
      return
    }

    setLoading(true)

    const requestData: CreatePurchaseRequestData = {
      branch_id: formData.branch_id,
      priority: formData.priority,
      notes: formData.notes || undefined,
      requested_by: user?.id || '',
      items: validItems.map(item => ({
        item_id: item.item_id,
        supplier_id: item.supplier_id || undefined,
        requested_quantity: item.requested_quantity,
        estimated_unit_price: item.estimated_unit_price || undefined,
        notes: item.notes || undefined,
      }))
    }

    const { error: submitError } = await purchaseService.createRequest(requestData)

    if (submitError) {
      setError('فشل في حفظ طلب الشراء')
    } else {
      navigate('/purchase/requests')
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

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button type="button" onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">طلب شراء جديد</h1>
          <p className="text-gray-600">إنشاء طلب شراء جديد</p>
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
          <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات الطلب</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الفرع <span className="text-red-500">*</span></label>
              <select value={formData.branch_id} onChange={(e) => handleChange('branch_id', e.target.value)} required
                aria-label="الفرع" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="">اختر الفرع</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name_ar}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الأولوية</label>
              <select value={formData.priority} onChange={(e) => handleChange('priority', Number(e.target.value))}
                aria-label="الأولوية" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value={1}>عادي</option>
                <option value={2}>متوسط</option>
                <option value={3}>عاجل</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
              <input type="text" value={formData.notes} onChange={(e) => handleChange('notes', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="ملاحظات..." />
            </div>
          </div>
        </div>


        {/* Request Items */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">الأصناف المطلوبة</h2>
            <button type="button" onClick={handleAddItem}
              className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg">
              <Plus className="w-4 h-4" />
              إضافة صنف
            </button>
          </div>

          {/* Barcode Scanner Input */}
          <div className="mb-4 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
            <label className="flex items-center gap-2 text-sm font-medium text-indigo-800 mb-2">
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
                className="flex-1 px-4 py-2 border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                dir="ltr"
              />
              <button
                type="button"
                onClick={handleBarcodeSearch}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                title="بحث بالباركود"
                aria-label="بحث بالباركود"
              >
                <Search className="w-5 h-5" />
              </button>
            </div>
            {barcodeError && <p className="text-red-600 text-sm mt-2">{barcodeError}</p>}
            <p className="text-xs text-indigo-600 mt-1">استخدم قارئ الباركود أو أدخل الكود يدوياً ثم اضغط Enter</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الصنف</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">المورد المقترح</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الكمية</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">السعر التقديري</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الإجمالي</th>
                  <th className="py-3 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {requestItems.map((item, index) => (
                  <tr key={index} className="border-b border-gray-100">
                    <td className="py-3 px-2">
                      <select value={item.item_id} onChange={(e) => handleItemChange(index, 'item_id', e.target.value)}
                        aria-label="اختر الصنف" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm">
                        <option value="">اختر الصنف</option>
                        {items.map(i => <option key={i.id} value={i.id}>{i.name_ar} ({i.code})</option>)}
                      </select>
                    </td>
                    <td className="py-3 px-2">
                      <select value={item.supplier_id} onChange={(e) => handleItemChange(index, 'supplier_id', e.target.value)}
                        aria-label="اختر المورد" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm">
                        <option value="">اختر المورد</option>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
                      </select>
                    </td>
                    <td className="py-3 px-2">
                      <input type="number" min="0.001" step="0.001" value={item.requested_quantity} onChange={(e) => handleItemChange(index, 'requested_quantity', Number(e.target.value))}
                        aria-label="الكمية" placeholder="مثال: 19.200" className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" dir="ltr" />
                    </td>
                    <td className="py-3 px-2">
                      <input type="number" min="0" step="0.01" value={item.estimated_unit_price} onChange={(e) => handleItemChange(index, 'estimated_unit_price', Number(e.target.value))}
                        aria-label="السعر التقديري" className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" dir="ltr" />
                    </td>
                    <td className="py-3 px-2 text-sm font-medium text-gray-900">
                      {(item.requested_quantity * item.estimated_unit_price).toLocaleString('ar-EG')} ج.م
                    </td>
                    <td className="py-3 px-2">
                      <button type="button" onClick={() => handleRemoveItem(index)} disabled={requestItems.length === 1}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed" title="حذف">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex justify-between gap-8">
                <span className="text-gray-600">التكلفة التقديرية الإجمالية:</span>
                <span className="font-bold text-lg text-gray-900">{calculateTotal().toLocaleString('ar-EG')} ج.م</span>
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
              <><Save className="w-5 h-5" />إرسال الطلب</>
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
