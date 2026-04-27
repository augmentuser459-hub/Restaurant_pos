import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, Search, X, Barcode } from 'lucide-react'

interface Branch {
  id: string
  name_ar: string
  code: string
  is_main_warehouse: boolean
}

interface Item {
  id: string
  code: string
  name_ar: string
}

interface ReturnItem {
  item_id: string
  quantity: number
  reason: string
  notes: string
}

export default function BranchReturnForm() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [mainWarehouse, setMainWarehouse] = useState<Branch | null>(null)

  const [formData, setFormData] = useState({
    from_branch_id: '',
    return_reason: '',
    notes: '',
  })

  const [returnItems, setReturnItems] = useState<ReturnItem[]>([
    { item_id: '', quantity: 1, reason: '', notes: '' },
  ])
  const [searchTerm, setSearchTerm] = useState<{ [key: number]: string }>({})

  // Get user role
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userRole = typeof user?.role === 'object' ? (user.role as any)?.name : user?.role
  const isBranchSupervisor = userRole === 'branch_supervisor'

  useEffect(() => {
    fetchData()
  }, [user])

  const fetchData = async () => {
    const [branchesRes, itemsRes] = await Promise.all([
      supabase.from('branches').select('id, name_ar, code, is_main_warehouse').eq('status', 'active').order('name_ar'),
      supabase.from('items').select('id, code, name_ar').eq('status', 'active').order('name_ar'),
    ])
    
    const branchList = fixEncodingInData(branchesRes.data) as Branch[] || []
    
    // Set main warehouse
    const mainWh = branchList.find(b => b.is_main_warehouse)
    if (mainWh) {
      setMainWarehouse(mainWh)
    }
    
    // Filter out main warehouse from branch list (only show actual branches)
    const actualBranches = branchList.filter(b => !b.is_main_warehouse)
    setBranches(actualBranches)
    
    // Auto-select branch for branch supervisor
    if (isBranchSupervisor && user?.branch_id) {
      setFormData(prev => ({ ...prev, from_branch_id: user.branch_id as string }))
    }
    
    setItems(fixEncodingInData(itemsRes.data) as Item[] || [])
  }

  const generateReturnNumber = () => {
    const date = new Date()
    const year = date.getFullYear()
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
    return `BRT-${year}-${month}-${random}`
  }

  const addItem = () => {
    setReturnItems([...returnItems, { item_id: '', quantity: 1, reason: '', notes: '' }])
  }

  const filteredItems = (index: number) => {
    const term = searchTerm[index]?.toLowerCase() || ''
    if (!term) return items
    return items.filter(item => 
      item.name_ar.toLowerCase().includes(term) ||
      item.code.toLowerCase().includes(term) ||
      ((item as Item & { barcode?: string }).barcode && (item as Item & { barcode?: string }).barcode!.toLowerCase().includes(term))
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
    setReturnItems(updated)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!user?.id) {
      setError('يرجى تسجيل الدخول أولاً')
      setLoading(false)
      return
    }

    if (!formData.from_branch_id) {
      setError('يرجى اختيار الفرع المصدر')
      setLoading(false)
      return
    }

    if (!mainWarehouse) {
      setError('لم يتم تحديد المخزن الرئيسي')
      setLoading(false)
      return
    }

    if (!formData.return_reason || formData.return_reason.trim() === '') {
      setError('يرجى إدخال سبب الإرجاع')
      setLoading(false)
      return
    }

    const validItems = returnItems.filter(item => item.item_id && item.quantity > 0)
    console.log('Return items before submit:', returnItems)
    console.log('Valid items:', validItems)
    
    if (validItems.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل')
      setLoading(false)
      return
    }

    // Create branch return
    const returnNumber = generateReturnNumber()
    console.log('Creating branch return:', {
      return_number: returnNumber,
      from_branch_id: formData.from_branch_id,
      to_branch_id: mainWarehouse.id,
      return_reason: formData.return_reason,
      requested_by: user.id,
    })

    const { data: returnData, error: returnError } = await supabase
      .from('branch_returns')
      .insert({
        return_number: returnNumber,
        return_date: new Date().toISOString(),
        from_branch_id: formData.from_branch_id,
        to_branch_id: mainWarehouse.id,
        status: 'pending',
        return_reason: formData.return_reason.trim(),
        total_items: validItems.length,
        total_quantity: validItems.reduce((sum, item) => sum + item.quantity, 0),
        notes: formData.notes || '',
        requested_by: user.id,
        requested_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (returnError) {
      console.error('Error creating branch return:', returnError)
      setError('فشل في حفظ المرتجع: ' + returnError.message)
      setLoading(false)
      return
    }

    console.log('Branch return created:', returnData)

    // Create return items
    const itemsToInsert = validItems.map(item => ({
      return_id: returnData.id,
      item_id: item.item_id,
      requested_quantity: item.quantity,
      item_reason: item.reason || '',
      notes: item.notes || '',
    }))

    console.log('Creating return items:', itemsToInsert)

    const { error: itemsError } = await supabase
      .from('branch_return_items')
      .insert(itemsToInsert)

    if (itemsError) {
      console.error('Error creating return items:', itemsError)
      setError('فشل في حفظ الأصناف: ' + itemsError.message)
    } else {
      console.log('Return items created successfully')
      navigate('/returns')
    }
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto">
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
          <h1 className="text-2xl font-bold text-gray-900">مرتجع جديد للرئيسي</h1>
          <p className="text-gray-600">إضافة مرتجع من الفرع للمخزن الرئيسي</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Branch Selection */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات التحويل</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label htmlFor="from_branch" className="block text-sm font-medium text-gray-700 mb-2">
                من الفرع <span className="text-red-500">*</span>
              </label>
              <select
                id="from_branch"
                value={formData.from_branch_id}
                onChange={(e) => setFormData({ ...formData, from_branch_id: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                aria-label="من الفرع"
                disabled={isBranchSupervisor}
              >
                <option value="">اختر الفرع</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name_ar} ({branch.code})
                  </option>
                ))}
              </select>
              {isBranchSupervisor && (
                <p className="text-xs text-gray-500 mt-1">يتم تحديد الفرع تلقائياً بناءً على فرعك</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                إلى المخزن الرئيسي
              </label>
              <div className="px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 font-medium">
                {mainWarehouse?.name_ar || 'جاري التحميل...'} ({mainWarehouse?.code})
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="return_reason" className="block text-sm font-medium text-gray-700 mb-2">
                سبب الإرجاع <span className="text-red-500">*</span>
              </label>
              <input
                id="return_reason"
                type="text"
                value={formData.return_reason}
                onChange={(e) => setFormData({ ...formData, return_reason: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="مثال: فائض مخزون، قرب انتهاء الصلاحية..."
                required
              />
            </div>

            <div>
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

          <div className="space-y-4">
            {returnItems.map((item, index) => {
              const selectedItem = items.find(i => i.id === item.item_id)
              const searchResults = filteredItems(index)
              const showResults = searchTerm[index] && searchResults.length > 0
              
              return (
                <div key={index} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="space-y-3">
                    {/* Search Input */}
                    <div className="relative">
                      <div className="flex items-center gap-2 bg-purple-50 rounded-lg p-2">
                        <div className="bg-purple-600 text-white p-2 rounded-lg">
                          <Search className="w-5 h-5" />
                        </div>
                        <input
                          type="text"
                          placeholder="امسح الباركود أو أدخل الكود أو اسم الصنف"
                          value={searchTerm[index] || ''}
                          onChange={(e) => {
                            setSearchTerm({ ...searchTerm, [index]: e.target.value })
                            const results = items.filter(i => 
                              i.name_ar.toLowerCase().includes(e.target.value.toLowerCase()) ||
                              i.code.toLowerCase().includes(e.target.value.toLowerCase()) ||
                              ((i as Item & { barcode?: string }).barcode && (i as Item & { barcode?: string }).barcode!.toLowerCase().includes(e.target.value.toLowerCase()))
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
                      
                      {/* Search Results */}
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
                              className="w-full text-right px-4 py-3 hover:bg-purple-50 border-b border-gray-100 last:border-0"
                            >
                              <div className="font-medium text-gray-900">{i.name_ar}</div>
                              <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                                <span>الكود: {i.code}</span>
                                {(i as Item & { barcode?: string }).barcode && (
                                  <>
                                    <span>•</span>
                                    <span>الباركود: {(i as Item & { barcode?: string }).barcode}</span>
                                  </>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      
                      {/* Selected Item */}
                      {selectedItem && (
                        <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-green-900">{selectedItem.name_ar}</p>
                              <p className="text-sm text-green-700">
                                الكود: {selectedItem.code}
                                {(selectedItem as Item & { barcode?: string }).barcode && 
                                  ` | الباركود: ${(selectedItem as Item & { barcode?: string }).barcode}`}
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
                      
                      {!selectedItem && !searchTerm[index] && (
                        <p className="text-sm text-purple-600 mt-2 flex items-center gap-2">
                          <Barcode className="w-4 h-4" />
                          استخدم قارئ الباركود أو أدخل الكود يدوياً ثم اضغط Enter
                        </p>
                      )}
                    </div>

                    {/* Quantity, Reason, Notes */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">الكمية</label>
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={item.quantity}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value)
                            updateItem(index, 'quantity', isNaN(val) ? 0.001 : val)
                          }}
                          onFocus={(e) => e.target.select()}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                          placeholder="مثال: 19.200"
                          dir="ltr"
                          aria-label="الكمية"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">السبب</label>
                        <input
                          type="text"
                          value={item.reason}
                          onChange={(e) => updateItem(index, 'reason', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                          placeholder="السبب"
                          aria-label="السبب"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">ملاحظات</label>
                        <input
                          type="text"
                          value={item.notes}
                          onChange={(e) => updateItem(index, 'notes', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                          placeholder="ملاحظات"
                          aria-label="ملاحظات"
                        />
                      </div>
                      <div className="flex items-end">
                        {returnItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(index)}
                            className="w-full p-2 text-red-500 hover:bg-red-50 rounded-lg"
                            title="حذف"
                          >
                            <Trash2 className="w-4 h-4 mx-auto" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
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
