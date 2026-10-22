import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { damagesService } from '../../services/damages.service'
import { branchesService } from '../../services/branches.service'
import { fetchPickerItems, PickerItem } from '../../services/transfers.service'
import { useAuth } from '../../contexts/AuthContext'
import { Branch, DamageReason } from '../../types/database.types'
import { toUserMessage } from '../../lib/errors'
import { formatCurrency, parseDecimal, roundMoney, roundQuantity } from '../../lib/utils'
import { Save, ArrowRight, AlertCircle, Barcode, Search, X } from 'lucide-react'

const matchesTerm = (item: PickerItem, term: string) =>
  item.name_ar.toLowerCase().includes(term) ||
  item.code.toLowerCase().includes(term) ||
  Boolean(item.barcode && item.barcode.toLowerCase().includes(term))

export default function DamageForm() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [items, setItems] = useState<PickerItem[]>([])
  const [reasons, setReasons] = useState<DamageReason[]>([])

  // Get branch_id - handle both direct and nested formats
  const userObj = user as unknown as { branch_id?: string; branch?: { id?: string } } | null
  const userBranchId = userObj?.branch_id || userObj?.branch?.id || ''
  const [branchId, setBranchId] = useState(userBranchId)
  const [itemId, setItemId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [unitCost, setUnitCost] = useState(0)
  const [reasonId, setReasonId] = useState('')
  const [description, setDescription] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const [branchesRes, itemsRes, reasonsRes] = await Promise.all([
      branchesService.getActive(),
      fetchPickerItems(),
      damagesService.getReasons(),
    ])
    const loadError = branchesRes.error || itemsRes.error || reasonsRes.error
    if (loadError) setError('تعذر تحميل البيانات: ' + toUserMessage(loadError))
    setBranches(branchesRes.data || [])
    setItems(itemsRes.data.filter(i => i.status === 'active'))
    setReasons(reasonsRes.data || [])
  }

  const filteredItems = () => {
    const term = searchTerm.toLowerCase()
    if (!term) return items
    return items.filter(item => matchesTerm(item, term))
  }

  const handleItemChange = (id: string) => {
    setItemId(id)
    const item = items.find(i => i.id === id)
    // The new item's purchase price (0 when it has none: never keep the previous item's cost)
    setUnitCost(item?.purchase_price != null ? Number(item.purchase_price) : 0)
    setSearchTerm('')
  }

  const selectedItem = items.find(i => i.id === itemId)
  const totalCost = roundMoney(quantity * unitCost)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')

    if (!branchId || !itemId || !reasonId) {
      setError('يرجى ملء جميع الحقول المطلوبة')
      return
    }
    if (!(quantity > 0)) {
      setError('يرجى إدخال كمية أكبر من صفر')
      return
    }
    if (!(unitCost >= 0)) {
      setError('تكلفة الوحدة لا يمكن أن تكون سالبة')
      return
    }

    setLoading(true)
    const { error } = await damagesService.create({
      branch_id: branchId,
      item_id: itemId,
      quantity: roundQuantity(quantity),
      unit_cost: unitCost,
      reason_id: reasonId,
      description,
    })

    if (error) {
      setError('فشل في تسجيل التالف: ' + toUserMessage(error))
      setLoading(false)
    } else {
      navigate('/damages')
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button type="button" onClick={() => navigate('/damages')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">تسجيل تالف</h1>
          <p className="text-gray-600">تسجيل صنف تالف أو هالك</p>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">الفرع <span className="text-red-500">*</span></label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required
              aria-label="الفرع"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">اختر الفرع</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name_ar}</option>)}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">الصنف <span className="text-red-500">*</span></label>
            <div className="relative">
              {/* Search Input with Icon */}
              <div className="flex items-center gap-2 bg-blue-50 rounded-lg p-2 mb-2">
                <div className="bg-blue-600 text-white p-2 rounded-lg">
                  <Search className="w-5 h-5" />
                </div>
                <input
                  type="text"
                  placeholder="امسح الباركود أو أدخل الكود أو اسم الصنف"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value)
                    // Auto-select if only one result
                    const results = items.filter(i => matchesTerm(i, e.target.value.toLowerCase()))
                    if (results.length === 1 && e.target.value.length > 2) {
                      handleItemChange(results[0].id)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      // A scanner sends Enter after every code: pick the item, never submit the form
                      e.preventDefault()
                      const results = filteredItems()
                      if (results.length > 0) {
                        handleItemChange(results[0].id)
                      }
                    }
                  }}
                  className="flex-1 px-3 py-2 border-0 bg-transparent focus:outline-none text-gray-700 placeholder-gray-500"
                />
              </div>

              {/* Search Results Dropdown */}
              {searchTerm && filteredItems().length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {filteredItems().map(i => (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => handleItemChange(i.id)}
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
                        {selectedItem.unit?.name_ar && ` | الوحدة: ${selectedItem.unit.name_ar}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setItemId('')
                        setUnitCost(0)
                        setSearchTerm('')
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
              {!itemId && !searchTerm && (
                <p className="text-sm text-blue-600 mt-2 flex items-center gap-2">
                  <Barcode className="w-4 h-4" />
                  استخدم قارئ الباركود أو أدخل الكود يدوياً ثم اضغط Enter
                </p>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">الكمية <span className="text-red-500">*</span></label>
            <input type="number" min="0.001" step="0.001" value={quantity}
              onChange={(e) => {
                const qty = parseDecimal(e.target.value)
                setQuantity(qty !== null && qty > 0 ? roundQuantity(qty) : 0)
              }}
              required
              aria-label="الكمية"
              placeholder="مثال: 19.200"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">تكلفة الوحدة</label>
            <input type="number" min="0" step="any" value={unitCost}
              onChange={(e) => {
                const cost = parseDecimal(e.target.value)
                setUnitCost(cost !== null && cost >= 0 ? cost : 0)
              }}
              aria-label="تكلفة الوحدة"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" dir="ltr" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">سبب التلف <span className="text-red-500">*</span></label>
            <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} required
              aria-label="سبب التلف"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">اختر السبب</option>
              {reasons.map(r => <option key={r.id} value={r.id}>{r.name_ar}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">وصف إضافي</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="وصف تفصيلي للتلف..." />
          </div>
        </div>

        {quantity > 0 && unitCost > 0 && (
          <div className="p-4 bg-red-50 rounded-lg">
            <p className="text-sm text-gray-600">إجمالي التكلفة المقدرة:</p>
            <p className="text-xl font-bold text-red-600">{formatCurrency(totalCost)}</p>
          </div>
        )}

        <div className="flex items-center gap-4 pt-6 border-t border-gray-100">
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
            {loading ? <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />جاري التسجيل...</> : <><Save className="w-5 h-5" />تسجيل التالف</>}
          </button>
          <button type="button" onClick={() => navigate('/damages')} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">إلغاء</button>
        </div>
      </form>
    </div>
  )
}
