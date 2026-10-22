import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { returnsService } from '../../services/returns.service'
import { fetchPickerItems, PickerItem } from '../../services/transfers.service'
import { toUserMessage } from '../../lib/errors'
import { parseDecimal, roundQuantity } from '../../lib/utils'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, Search, X, Barcode } from 'lucide-react'

interface Branch {
  id: string
  name_ar: string
  code: string
  is_main_warehouse: boolean
}

interface ReturnItem {
  key: string // stable row id (React key), so a row's search text never moves to another row
  item_id: string
  quantity: number
  reason: string
  notes: string
  search: string
}

let rowSeq = 0
const newRow = (): ReturnItem => ({ key: `row-${++rowSeq}`, item_id: '', quantity: 1, reason: '', notes: '', search: '' })

const matchesTerm = (item: PickerItem, term: string) =>
  item.name_ar.toLowerCase().includes(term) ||
  item.code.toLowerCase().includes(term) ||
  Boolean(item.barcode && item.barcode.toLowerCase().includes(term))

export default function BranchReturnForm() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState<PickerItem[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [mainWarehouse, setMainWarehouse] = useState<Branch | null>(null)

  const [formData, setFormData] = useState({
    from_branch_id: '',
    return_reason: '',
    notes: '',
  })

  const [returnItems, setReturnItems] = useState<ReturnItem[]>(() => [newRow()])

  // Get user role
  const userRole = typeof user?.role === 'object' && user?.role !== null
    ? (user.role as { name: string }).name
    : user?.role
  const isBranchSupervisor = userRole === 'branch_supervisor'

  useEffect(() => {
    fetchData()
  }, [user])

  const fetchData = async () => {
    const [branchesRes, itemsRes] = await Promise.all([
      supabase.from('branches').select('id, name_ar, code, is_main_warehouse').eq('status', 'active').order('name_ar'),
      fetchPickerItems(),
    ])
    if (branchesRes.error || itemsRes.error) {
      setError('تعذر تحميل البيانات: ' + toUserMessage(branchesRes.error || itemsRes.error))
    }

    const branchList = (fixEncodingInData(branchesRes.data) as Branch[]) || []

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

  const updateRow = (key: string, changes: Partial<ReturnItem>) => {
    setReturnItems(rows => rows.map(r => (r.key === key ? { ...r, ...changes } : r)))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')

    if (!user?.id) {
      setError('يرجى تسجيل الدخول أولاً')
      return
    }

    if (!formData.from_branch_id) {
      setError('يرجى اختيار الفرع المصدر')
      return
    }

    if (!mainWarehouse) {
      setError('لم يتم تحديد المخزن الرئيسي')
      return
    }

    if (!formData.return_reason || formData.return_reason.trim() === '') {
      setError('يرجى إدخال سبب الإرجاع')
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

    // Header and lines are saved together; the database checks the branch stock and merges repeated items
    setLoading(true)
    const { error: saveError } = await returnsService.createBranchReturn({
      from_branch_id: formData.from_branch_id,
      return_reason: formData.return_reason.trim(),
      notes: formData.notes,
      items: chosen.map(i => ({ item_id: i.item_id, quantity: roundQuantity(i.quantity), reason: i.reason, notes: i.notes })),
    })

    if (saveError) {
      setError('فشل في حفظ المرتجع: ' + toUserMessage(saveError))
      setLoading(false)
    } else {
      navigate('/returns')
    }
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
          <p className="text-red-700 whitespace-pre-line">{error}</p>
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
            {returnItems.map((item) => {
              const selectedItem = items.find(i => i.id === item.item_id)
              const searchResults = filteredItems(item.search)
              const showResults = item.search && searchResults.length > 0

              return (
                <div key={item.key} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
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
                          value={item.search}
                          onChange={(e) => {
                            const value = e.target.value
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

                      {/* Search Results */}
                      {showResults && (
                        <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto mt-1">
                          {searchResults.map(i => (
                            <button
                              key={i.id}
                              type="button"
                              onClick={() => updateRow(item.key, { item_id: i.id, search: '' })}
                              className="w-full text-right px-4 py-3 hover:bg-purple-50 border-b border-gray-100 last:border-0"
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

                      {/* Selected Item */}
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
                              onClick={() => updateRow(item.key, { item_id: '', search: '' })}
                              className="text-red-500 hover:text-red-700"
                              title="إلغاء الاختيار"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      )}

                      {!selectedItem && !item.search && (
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
                            const val = parseDecimal(e.target.value)
                            updateRow(item.key, { quantity: val !== null && val > 0 ? roundQuantity(val) : 0 })
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
                          onChange={(e) => updateRow(item.key, { reason: e.target.value })}
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
                          onChange={(e) => updateRow(item.key, { notes: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                          placeholder="ملاحظات"
                          aria-label="ملاحظات"
                        />
                      </div>
                      <div className="flex items-end">
                        {returnItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(item.key)}
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
