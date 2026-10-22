import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { transfersService, fetchPickerItems, PickerItem } from '../../services/transfers.service'
import { branchesService } from '../../services/branches.service'
import { useAuth } from '../../contexts/AuthContext'
import { Branch } from '../../types/database.types'
import { toUserMessage } from '../../lib/errors'
import { formatQuantity, parseDecimal, roundQuantity } from '../../lib/utils'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, Barcode, Search, X } from 'lucide-react'


interface TransferItem {
  key: string // stable row id (React key), so a row's search text never moves to another row
  item_id: string
  requested_quantity: number
  search: string
  notes?: string
}

let rowSeq = 0
const newRow = (): TransferItem => ({ key: `row-${++rowSeq}`, item_id: '', requested_quantity: 1, search: '' })

const matchesTerm = (item: PickerItem, term: string) =>
  item.name_ar.toLowerCase().includes(term) ||
  item.code.toLowerCase().includes(term) ||
  Boolean(item.barcode && item.barcode.toLowerCase().includes(term))

export default function TransferForm() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [items, setItems] = useState<PickerItem[]>([])

  const [fromBranch, setFromBranch] = useState('')
  const [toBranch, setToBranch] = useState('')
  const [notes, setNotes] = useState('')
  const [transferItems, setTransferItems] = useState<TransferItem[]>(() => [newRow()])
  const [sourceStock, setSourceStock] = useState<Record<string, number>>({})

  const userRole = typeof user?.role === 'object' && user?.role !== null
    ? (user.role as { name: string }).name
    : user?.role

  useEffect(() => {
    fetchData()
  }, [])

  // Fetch source branch stock when fromBranch changes
  useEffect(() => {
    if (fromBranch) {
      fetchSourceStock(fromBranch)
    } else {
      setSourceStock({})
    }
  }, [fromBranch])

  const fetchSourceStock = async (branchId: string) => {
    const { data, error } = await transfersService.getBranchStock(branchId)
    if (error) setError('تعذر تحميل رصيد الفرع المرسل: ' + toUserMessage(error))
    setSourceStock(data)
  }

  // Get available quantity for an item in source branch
  const getAvailableQty = (itemId: string): number => sourceStock[itemId] || 0

  const fetchData = async () => {
    const [branchesRes, itemsRes] = await Promise.all([
      branchesService.getActive(),
      fetchPickerItems(),
    ])
    if (branchesRes.error || itemsRes.error) {
      setError('تعذر تحميل البيانات: ' + toUserMessage(branchesRes.error || itemsRes.error))
    }
    setBranches(branchesRes.data || [])
    setItems(itemsRes.data.filter(i => i.status === 'active'))
  }

  const filteredItems = (search: string) => {
    const term = search.toLowerCase()
    if (!term) return items
    return items.filter(item => matchesTerm(item, term))
  }

  // Total requested per item over all rows (the same item may be on two rows)
  const requestedTotal = (itemId: string) =>
    roundQuantity(transferItems.filter(i => i.item_id === itemId).reduce((sum, i) => sum + (i.requested_quantity || 0), 0))

  const handleAddItem = () => {
    setTransferItems(rows => [...rows, newRow()])
  }

  const handleRemoveItem = (key: string) => {
    setTransferItems(rows => rows.filter(r => r.key !== key))
  }

  const updateRow = (key: string, changes: Partial<TransferItem>) => {
    setTransferItems(rows => rows.map(r => (r.key === key ? { ...r, ...changes } : r)))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')

    if (!fromBranch || !toBranch) {
      setError('يرجى اختيار الفرع المرسل والمستلم')
      return
    }
    if (fromBranch === toBranch) {
      setError('لا يمكن التحويل لنفس الفرع')
      return
    }
    if (userRole === 'branch_supervisor' && user?.branch_id !== fromBranch && user?.branch_id !== toBranch) {
      setError('يمكنك إنشاء تحويلات من فرعك أو إليه فقط')
      return
    }
    const chosen = transferItems.filter(i => i.item_id)
    if (chosen.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل')
      return
    }
    const badQty = chosen.find(i => !(i.requested_quantity > 0))
    if (badQty) {
      const itemName = items.find(i => i.id === badQty.item_id)?.name_ar || ''
      setError(`يرجى إدخال كمية أكبر من صفر للصنف ${itemName}`)
      return
    }

    // Merge rows of the same item, then check the summed quantity against the source stock
    const merged = new Map<string, number>()
    chosen.forEach(i => merged.set(i.item_id, roundQuantity((merged.get(i.item_id) || 0) + i.requested_quantity)))
    const insufficientItems: string[] = []
    merged.forEach((qty, itemId) => {
      const availableQty = getAvailableQty(itemId)
      if (qty > availableQty) {
        const itemName = items.find(i => i.id === itemId)?.name_ar || ''
        insufficientItems.push(`${itemName}: متوفر ${formatQuantity(availableQty)} - مطلوب ${formatQuantity(qty)}`)
      }
    })
    if (insufficientItems.length > 0) {
      setError(`الكمية غير متوفرة في المخزن المصدر:\n${insufficientItems.join('\n')}`)
      return
    }

    setLoading(true)
    const { error } = await transfersService.create({
      from_branch_id: fromBranch,
      to_branch_id: toBranch,
      notes,
      items: [...merged.entries()].map(([item_id, requested_quantity]) => ({ item_id, requested_quantity })),
    })

    if (error) {
      setError('فشل في إنشاء التحويل: ' + toUserMessage(error))
      setLoading(false)
    } else {
      navigate('/transfers')
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button type="button" onClick={() => navigate('/transfers')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
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
          <p className="text-red-700 whitespace-pre-line">{error}</p>
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
            {transferItems.map((item) => {
              const selectedItem = items.find(i => i.id === item.item_id)
              const searchResults = filteredItems(item.search)
              const showResults = item.search && searchResults.length > 0
              const availableQty = item.item_id ? getAvailableQty(item.item_id) : 0
              const isInsufficient = Boolean(item.item_id) && requestedTotal(item.item_id) > availableQty
              const isDuplicate = Boolean(item.item_id) && transferItems.filter(r => r.item_id === item.item_id).length > 1

              return (
                <div key={item.key} className={`p-4 rounded-lg border ${isInsufficient ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
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
                              updateRow(item.key, { search: value, item_id: results[0].id })
                            } else {
                              updateRow(item.key, { search: value })
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              // A scanner sends Enter after every code: pick the item, never submit the form
                              e.preventDefault()
                              if (searchResults.length > 0) {
                                updateRow(item.key, { item_id: searchResults[0].id, search: '' })
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
                              onClick={() => updateRow(item.key, { item_id: i.id, search: '' })}
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
                              {isDuplicate && (
                                <p className="text-xs text-orange-600 mt-1">هذا الصنف مكرر في أكثر من سطر وسيتم جمع الكميات</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => updateRow(item.key, { item_id: '', search: '' })}
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

                    {/* Quantity and Available Stock */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">الكمية المطلوبة</label>
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={item.requested_quantity}
                          onChange={(e) => {
                            const qty = parseDecimal(e.target.value)
                            updateRow(item.key, { requested_quantity: qty !== null && qty > 0 ? roundQuantity(qty) : 0 })
                          }}
                          aria-label="الكمية"
                          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm ${isInsufficient ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                          placeholder="مثال: 19.200"
                        />
                      </div>
                      {item.item_id && fromBranch && (
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-600 mb-1">المتوفر في المخزن</label>
                          <div className={`px-3 py-2 rounded-lg text-sm font-medium ${isInsufficient ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                            {formatQuantity(availableQty)} {isInsufficient && '⚠️ غير كافي'}
                          </div>
                        </div>
                      )}
                      {transferItems.length > 1 && (
                        <div className="pt-5">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.key)}
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
