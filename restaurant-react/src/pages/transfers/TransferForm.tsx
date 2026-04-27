import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { transfersService } from '../../services/transfers.service'
import { branchesService } from '../../services/branches.service'
import { inventoryService, InventoryWithDetails } from '../../services/inventory.service'
import { useAuth } from '../../contexts/AuthContext'
import { Branch, Item } from '../../types/database.types'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, Barcode, Search, X } from 'lucide-react'


interface TransferItem {
  item_id: string
  requested_quantity: number
  notes?: string
  availableQty?: number // Track available quantity
}

export default function TransferForm() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [items, setItems] = useState<Item[]>([])

  const [fromBranch, setFromBranch] = useState('')
  const [toBranch, setToBranch] = useState('')
  const [notes, setNotes] = useState('')
  const [transferItems, setTransferItems] = useState<TransferItem[]>([{ item_id: '', requested_quantity: 1 }])
  const [sourceInventory, setSourceInventory] = useState<InventoryWithDetails[]>([])
  const [searchTerm, setSearchTerm] = useState<{ [key: number]: string }>({})

  useEffect(() => {
    fetchData()
  }, [])

  // Fetch source branch inventory when fromBranch changes
  useEffect(() => {
    if (fromBranch) {
      fetchSourceInventory(fromBranch)
    } else {
      setSourceInventory([])
    }
  }, [fromBranch])

  const fetchSourceInventory = async (branchId: string) => {
    const { data } = await inventoryService.getStockByBranch(branchId)
    setSourceInventory(data || [])
  }

  // Get available quantity for an item in source branch
  const getAvailableQty = (itemId: string): number => {
    const inv = sourceInventory.find(i => i.item_id === itemId)
    return inv?.quantity || 0
  }

  const fetchData = async () => {
    const [branchesRes, itemsRes] = await Promise.all([
      branchesService.getActive(),
      inventoryService.getAllItems(),
    ])
    setBranches(branchesRes.data || [])
    setItems(itemsRes.data || [])
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

  const handleAddItem = () => {
    setTransferItems([...transferItems, { item_id: '', requested_quantity: 1 }])
  }

  const handleRemoveItem = (index: number) => {
    setTransferItems(transferItems.filter((_, i) => i !== index))
  }

  const handleItemChange = (index: number, field: keyof TransferItem, value: string | number) => {
    const updated = [...transferItems]
    updated[index] = { ...updated[index], [field]: value }
    // Update available quantity when item changes
    if (field === 'item_id' && typeof value === 'string') {
      updated[index].availableQty = getAvailableQty(value)
    }
    setTransferItems(updated)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (!fromBranch || !toBranch) {
      setError('يرجى اختيار الفرع المرسل والمستلم')
      return
    }
    if (fromBranch === toBranch) {
      setError('لا يمكن التحويل لنفس الفرع')
      return
    }
    const validItems = transferItems.filter(i => i.item_id && i.requested_quantity > 0)
    if (validItems.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل')
      return
    }

    // Check if all quantities are available
    const insufficientItems: string[] = []
    for (const item of validItems) {
      const availableQty = getAvailableQty(item.item_id)
      if (item.requested_quantity > availableQty) {
        const itemName = items.find(i => i.id === item.item_id)?.name_ar || ''
        insufficientItems.push(`${itemName}: متوفر ${availableQty} - مطلوب ${item.requested_quantity}`)
      }
    }
    if (insufficientItems.length > 0) {
      setError(`الكمية غير متوفرة في المخزن المصدر:\n${insufficientItems.join('\n')}`)
      return
    }

    setLoading(true)
    const { error } = await transfersService.create({
      from_branch_id: fromBranch,
      to_branch_id: toBranch,
      notes,
      requested_by: user?.id || '',
      items: validItems,
    })

    if (error) {
      setError('فشل في إنشاء التحويل')
    } else {
      navigate('/transfers')
    }
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/transfers')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">تحويل جديد</h1>
          <p className="text-gray-600">إنشاء طلب تحويل مخزون بين الفروع</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">من فرع <span className="text-red-500">*</span></label>
            <select value={fromBranch} onChange={(e) => setFromBranch(e.target.value)} required
              aria-label="من فرع"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">اختر الفرع</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name_ar}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">إلى فرع <span className="text-red-500">*</span></label>
            <select value={toBranch} onChange={(e) => setToBranch(e.target.value)} required
              aria-label="إلى فرع"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">اختر الفرع</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name_ar}</option>)}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <label className="text-sm font-medium text-gray-700">الأصناف <span className="text-red-500">*</span></label>
            <button type="button" onClick={handleAddItem} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
              <Plus className="w-4 h-4" /> إضافة صنف
            </button>
          </div>

          <div className="space-y-4">
            {transferItems.map((item, index) => {
              const selectedItem = items.find(i => i.id === item.item_id)
              const searchResults = filteredItems(index)
              const showResults = searchTerm[index] && searchResults.length > 0
              const availableQty = item.item_id ? getAvailableQty(item.item_id) : 0
              const isInsufficient = item.item_id && item.requested_quantity > availableQty
              
              return (
                <div key={index} className={`p-4 rounded-lg border ${isInsufficient ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
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
                              ((i as Item & { barcode?: string }).barcode && (i as Item & { barcode?: string }).barcode!.toLowerCase().includes(e.target.value.toLowerCase()))
                            )
                            if (results.length === 1 && e.target.value.length > 2) {
                              handleItemChange(index, 'item_id', results[0].id)
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && searchResults.length > 0) {
                              handleItemChange(index, 'item_id', searchResults[0].id)
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
                                handleItemChange(index, 'item_id', i.id)
                                setSearchTerm({ ...searchTerm, [index]: '' })
                              }}
                              className="w-full text-right px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-0 transition-colors"
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
                      
                      {/* Selected Item Display */}
                      {selectedItem && (
                        <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-green-900">{selectedItem.name_ar}</p>
                              <p className="text-sm text-green-700">
                                الكود: {selectedItem.code}
                                {(selectedItem as Item & { barcode?: string }).barcode && ` | الباركود: ${(selectedItem as Item & { barcode?: string }).barcode}`}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                handleItemChange(index, 'item_id', '')
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

                    {/* Quantity and Available Stock */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">الكمية المطلوبة</label>
                        <input 
                          type="number" 
                          min="0.001"
                          step="0.001"
                          value={item.requested_quantity}
                          onChange={(e) => handleItemChange(index, 'requested_quantity', Number(e.target.value))}
                          aria-label="الكمية"
                          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm ${isInsufficient ? 'border-red-400 bg-red-50' : 'border-gray-300'}`} 
                          placeholder="مثال: 19.200" 
                        />
                      </div>
                      {item.item_id && fromBranch && (
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-600 mb-1">المتوفر في المخزن</label>
                          <div className={`px-3 py-2 rounded-lg text-sm font-medium ${isInsufficient ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                            {availableQty} {isInsufficient && '⚠️ غير كافي'}
                          </div>
                        </div>
                      )}
                      {transferItems.length > 1 && (
                        <div className="pt-5">
                          <button 
                            type="button" 
                            onClick={() => handleRemoveItem(index)} 
                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg" 
                            title="حذف"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="ملاحظات إضافية..." />
        </div>

        <div className="flex items-center gap-4 pt-6 border-t border-gray-100">
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />جاري الإرسال...</> : <><Save className="w-5 h-5" />إرسال الطلب</>}
          </button>
          <button type="button" onClick={() => navigate('/transfers')} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">إلغاء</button>
        </div>
      </form>
    </div>
  )
}
