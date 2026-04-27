import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, Search, X, Barcode } from 'lucide-react'

interface Supplier {
  id: string
  name_ar: string
  code: string
}

interface Item {
  id: string
  code: string
  barcode: string | null
  name_ar: string
  purchase_price: number
}

interface ReturnItem {
  item_id: string
  quantity: number
  unit_price: number
  reason: string
  notes: string
}

export default function SupplierReturnForm() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [items, setItems] = useState<Item[]>([])

  const [formData, setFormData] = useState({
    supplier_id: '',
    return_reason: '',
    notes: '',
  })

  const [returnItems, setReturnItems] = useState<ReturnItem[]>([
    { item_id: '', quantity: 1, unit_price: 0, reason: '', notes: '' },
  ])

  const [searchTerm, setSearchTerm] = useState<{ [key: number]: string }>({})

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const [suppliersRes, itemsRes] = await Promise.all([
      supabase.from('suppliers').select('id, name_ar, code').eq('status', 'active').order('name_ar'),
      supabase.from('items').select('id, code, barcode, name_ar, purchase_price').eq('status', 'active').order('name_ar'),
    ])
    setSuppliers((fixEncodingInData(suppliersRes.data) as Supplier[]) || [])
    setItems((fixEncodingInData(itemsRes.data) as Item[]) || [])
  }

  const generateReturnNumber = () => {
    const date = new Date()
    const year = date.getFullYear()
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
    return `SRT-${year}-${month}-${random}`
  }

  const addItem = () => {
    setReturnItems([...returnItems, { item_id: '', quantity: 1, unit_price: 0, reason: '', notes: '' }])
  }

  const filteredItems = (index: number) => {
    const term = searchTerm[index]?.toLowerCase() || ''
    if (!term) return items
    return items.filter(item => 
      item.name_ar.toLowerCase().includes(term) ||
      item.code.toLowerCase().includes(term) ||
      (item.barcode && item.barcode.toLowerCase().includes(term))
    )
  }

  const removeItem = (index: number) => {
    if (returnItems.length > 1) {
      setReturnItems(returnItems.filter((_, i) => i !== index))
    }
  }

  const updateItem = (index: number, field: keyof ReturnItem, value: string | number) => {
    const updated = [...returnItems]
    updated[index] = { ...updated[index], [field]: value }
    
    // Auto-fill unit price when item is selected
    if (field === 'item_id' && typeof value === 'string') {
      const item = items.find(i => i.id === value)
      if (item?.purchase_price) {
        updated[index].unit_price = item.purchase_price
      }
    }
    
    setReturnItems(updated)
  }

  // Calculate totals
  const calculateTotal = () => {
    return returnItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!formData.supplier_id) {
      setError('يرجى اختيار المورد')
      setLoading(false)
      return
    }

    if (!user?.id) {
      setError('يرجى تسجيل الدخول مرة أخرى')
      setLoading(false)
      return
    }

    // Verify user exists in database
    const { data: userExists, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('id', user.id)
      .single()

    if (userError || !userExists) {
      setError('المستخدم غير موجود في قاعدة البيانات. يرجى تسجيل الدخول مرة أخرى.')
      setLoading(false)
      return
    }

    const validItems = returnItems.filter(item => item.item_id && item.quantity > 0)
    if (validItems.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل')
      setLoading(false)
      return
    }

    // Create multiple supplier returns (one per item as per current schema)
    const returnNumber = generateReturnNumber()
    
    for (let i = 0; i < validItems.length; i++) {
      const item = validItems[i]
      const itemReturnNumber = validItems.length > 1 ? `${returnNumber}-${i + 1}` : returnNumber
      
      const { error: insertError } = await supabase.from('supplier_returns').insert({
        return_number: itemReturnNumber,
        supplier_id: formData.supplier_id,
        item_id: item.item_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_amount: item.quantity * item.unit_price,
        reason: item.reason || formData.return_reason,
        description: item.notes || formData.notes,
        status: 'pending',
        registered_by: user.id,
        registered_at: new Date().toISOString(),
      })

      if (insertError) {
        setError('فشل في حفظ المرتجع: ' + insertError.message)
        setLoading(false)
        return
      }
    }

    navigate('/returns')
    setLoading(false)
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
          <p className="text-red-700">{error}</p>
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
            {returnItems.map((item, index) => {
              const selectedItem = items.find(i => i.id === item.item_id)
              const searchResults = filteredItems(index)
              const showResults = searchTerm[index] && searchResults.length > 0
              
              return (
                <div key={index} className="p-4 rounded-lg border bg-gray-50 border-gray-200">
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
                          value={searchTerm[index] || ''}
                          onChange={(e) => {
                            setSearchTerm({ ...searchTerm, [index]: e.target.value })
                            // Auto-select if only one result
                            const results = items.filter(i => 
                              i.name_ar.toLowerCase().includes(e.target.value.toLowerCase()) ||
                              i.code.toLowerCase().includes(e.target.value.toLowerCase()) ||
                              (i.barcode && i.barcode.toLowerCase().includes(e.target.value.toLowerCase()))
                            )
                            if (results.length === 1 && e.target.value.length > 2) {
                              updateItem(index, 'item_id', results[0].id)
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && searchResults.length > 0) {
                              updateItem(index, 'item_id', searchResults[0].id)
                              setSearchTerm({ ...searchTerm, [index]: '' })
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
                              onClick={() => {
                                updateItem(index, 'item_id', i.id)
                                setSearchTerm({ ...searchTerm, [index]: '' })
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
                                {i.purchase_price && (
                                  <>
                                    <span>•</span>
                                    <span className="text-green-600">{i.purchase_price} ج.م</span>
                                  </>
                                )}
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
                              onClick={() => {
                                updateItem(index, 'item_id', '')
                                setSearchTerm({ ...searchTerm, [index]: '' })
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
                      {!selectedItem && !searchTerm[index] && (
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
                          onChange={(e) => updateItem(index, 'quantity', Number(e.target.value))}
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
                          step="0.01"
                          value={item.unit_price}
                          onChange={(e) => updateItem(index, 'unit_price', Number(e.target.value))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                          dir="ltr"
                          aria-label="سعر الوحدة"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">الإجمالي</label>
                        <div className="px-3 py-2 bg-gray-100 rounded-lg text-sm font-medium text-gray-900">
                          {(item.quantity * item.unit_price).toLocaleString('ar-EG')} ج.م
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">السبب</label>
                        <input
                          type="text"
                          value={item.reason}
                          onChange={(e) => updateItem(index, 'reason', e.target.value)}
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
                          onClick={() => removeItem(index)}
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
                  {calculateTotal().toLocaleString('ar-EG')} ج.م
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
