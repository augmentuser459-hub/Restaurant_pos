import { useState, useEffect, useRef, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { dailyCountService, CreateDailyCountData } from '../../services/dailyCount.service'
import { branchesService } from '../../services/branches.service'
import { inventoryService, InventoryWithDetails } from '../../services/inventory.service'
import { useAuth } from '../../contexts/AuthContext'
import { Branch } from '../../types/database.types'
import { Save, ArrowRight, AlertCircle, ClipboardList } from 'lucide-react'
import { todayLocal } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { formatQuantity, parseDecimal, roundQuantity } from '../../lib/utils'
import { canAccessAllBranches, displayCode, unitLabel } from './stockHelpers'

interface CountItem {
  item_id: string
  item_name: string
  item_code: string
  unit: string
  system_quantity: number
  actual_quantity: string // as typed; validated on save
  variance_reason: string
}

/** Counted quantity, or null while the input is empty/invalid */
const actualValue = (item: CountItem) => {
  const value = parseDecimal(item.actual_quantity)
  return value === null || value < 0 ? null : roundQuantity(value)
}

export default function DailyCountForm() {
  const navigate = useNavigate()
  const { user } = useAuth()
  // Admin / warehouse manager count any branch; everyone else counts their own branch
  const allBranches = canAccessAllBranches(user?.role)

  const [loading, setLoading] = useState(false)
  const [branchesLoading, setBranchesLoading] = useState(true)
  const [fetchLoading, setFetchLoading] = useState(false) // the selected branch's items
  const [error, setError] = useState('')

  const [branches, setBranches] = useState<Branch[]>([])
  const [countItems, setCountItems] = useState<CountItem[]>([])
  const inventoryRequestRef = useRef(0) // ignores a late stock response for a previously selected branch
  // branch the lines in countItems were loaded for (saved with the count, never the dropdown's value)
  const [itemsBranchId, setItemsBranchId] = useState('')

  const [formData, setFormData] = useState({
    branch_id: user?.branch_id || '',
    count_date: todayLocal(), // Cairo date (the UTC date is still "yesterday" after local midnight)
    count_type: 'opening' as 'opening' | 'closing',
    notes: '',
  })

  useEffect(() => {
    fetchBranches()
  }, [])

  useEffect(() => {
    // the previous branch's lines must never stay on screen (or be saved) for the new branch
    setCountItems([])
    setItemsBranchId('')
    if (formData.branch_id) {
      fetchInventory(formData.branch_id)
    } else {
      inventoryRequestRef.current++ // drop a response still on its way for the previous branch
      setFetchLoading(false)
    }
  }, [formData.branch_id])

  const fetchBranches = async () => {
    const { data, error: branchesError } = await branchesService.getActive()
    if (branchesError) setError('تعذر تحميل الفروع: ' + toUserMessage(branchesError))
    const list = data || []
    setBranches(allBranches ? list : list.filter(b => b.id === user?.branch_id))
    setBranchesLoading(false)
  }

  const fetchInventory = async (branchId: string) => {
    const request = ++inventoryRequestRef.current
    setFetchLoading(true)
    const { data, error: stockError } = await inventoryService.getStockByBranch(branchId)
    // a newer branch was selected meanwhile: its own request fills the list
    if (request !== inventoryRequestRef.current) return
    if (stockError) {
      setError('تعذر تحميل أصناف الفرع: ' + toUserMessage(stockError))
      setCountItems([])
      setItemsBranchId('')
    } else {
      setItemsBranchId(branchId)
      setCountItems((data || []).filter((inv: InventoryWithDetails) => inv.item).map((inv: InventoryWithDetails) => ({
        item_id: inv.item.id,
        item_name: inv.item.name_ar,
        item_code: displayCode(inv.item.code),
        // the embedded units row ({ id, name_ar, code }), rendered as its name
        unit: unitLabel(inv.item.unit),
        system_quantity: Number(inv.quantity ?? 0),
        actual_quantity: String(inv.quantity ?? 0),
        variance_reason: '',
      })))
    }
    setFetchLoading(false)
  }


  const handleItemChange = (index: number, field: 'actual_quantity' | 'variance_reason', value: string) => {
    setCountItems(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')

    if (countItems.length === 0) {
      setError('لا توجد أصناف للجرد')
      return
    }
    if (fetchLoading || itemsBranchId !== formData.branch_id) {
      setError('جاري تحميل أصناف الفرع المختار، انتظر حتى يكتمل التحميل')
      return
    }
    const invalid = countItems.find(item => actualValue(item) === null)
    if (invalid) {
      setError(`أدخل كمية فعلية صحيحة (صفر أو أكثر) للصنف "${invalid.item_name}"`)
      return
    }
    if (formData.count_date > todayLocal()) {
      setError('لا يمكن تسجيل جرد بتاريخ مستقبلي')
      return
    }

    setLoading(true)

    const countData: CreateDailyCountData = {
      branch_id: itemsBranchId, // the branch these lines and system quantities belong to
      count_date: formData.count_date,
      count_type: formData.count_type,
      notes: formData.notes.trim() || undefined,
      items: countItems.map(item => ({
        item_id: item.item_id,
        system_quantity: item.system_quantity,
        actual_quantity: actualValue(item) as number,
        variance_reason: item.variance_reason.trim() || undefined,
      }))
    }

    // Saved as a draft in one database call; submit and approve happen on the count's page
    const { data: countId, error: submitError } = await dailyCountService.create(countData)

    if (submitError || !countId) {
      setError('فشل في حفظ الجرد: ' + toUserMessage(submitError))
      setLoading(false)
      return
    }
    navigate(`/inventory/daily-count/${countId}`)
  }

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const variances = countItems.map(item => {
    const actual = actualValue(item)
    return actual === null ? 0 : roundQuantity(actual - item.system_quantity)
  })
  const totalVariance = roundQuantity(variances.reduce((sum, v) => sum + v, 0))
  const itemsWithVariance = variances.filter(v => v !== 0).length

  if (branchesLoading && !formData.branch_id) {
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
          <h1 className="text-2xl font-bold text-gray-900">جرد يومي جديد</h1>
          <p className="text-gray-600">تسجيل جرد المخزون اليومي</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        // Enter in a quantity field must not save a half-entered count
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault() }}
        className="space-y-6"
      >
        {/* Basic Info */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات الجرد</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الفرع <span className="text-red-500">*</span></label>
              <select value={formData.branch_id} onChange={(e) => handleChange('branch_id', e.target.value)} required
                aria-label="الفرع" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="">اختر الفرع</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name_ar}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">التاريخ <span className="text-red-500">*</span></label>
              <input type="date" value={formData.count_date} max={todayLocal()} onChange={(e) => handleChange('count_date', e.target.value)} required
                aria-label="التاريخ" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" dir="ltr" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">نوع الجرد <span className="text-red-500">*</span></label>
              <select value={formData.count_type} onChange={(e) => handleChange('count_type', e.target.value as 'opening' | 'closing')} required
                aria-label="نوع الجرد" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="opening">جرد افتتاحي</option>
                <option value="closing">جرد ختامي</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
              <input type="text" value={formData.notes} onChange={(e) => handleChange('notes', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="ملاحظات..." />
            </div>
          </div>
        </div>


        {/* Summary */}
        {countItems.length > 0 && (
          <div className="bg-blue-50 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ClipboardList className="w-6 h-6 text-blue-600" />
              <div>
                <p className="font-medium text-gray-900">{countItems.length} صنف</p>
                <p className="text-sm text-gray-600">{itemsWithVariance} صنف بفرق</p>
              </div>
            </div>
            <div className={`text-lg font-bold ${totalVariance === 0 ? 'text-green-600' : totalVariance > 0 ? 'text-blue-600' : 'text-red-600'}`}>
              {totalVariance > 0 ? '+' : ''}{formatQuantity(totalVariance)} فرق إجمالي
            </div>
          </div>
        )}

        {/* Count Items */}
        {formData.branch_id && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">الأصناف</h2>
            {fetchLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : countItems.length === 0 ? (
              <p className="text-gray-500 text-center py-8">لا توجد أصناف في هذا الفرع</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الكود</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الصنف</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الوحدة</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الكمية بالنظام</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الكمية الفعلية</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الفرق</th>
                      <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">سبب الفرق</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countItems.map((item, index) => {
                      const variance = variances[index]
                      const invalid = actualValue(item) === null
                      return (
                        <tr key={item.item_id} className={`border-b border-gray-100 ${variance !== 0 || invalid ? 'bg-yellow-50' : ''}`}>
                          <td className="py-3 px-2 text-sm text-gray-600" dir="ltr">{item.item_code}</td>
                          <td className="py-3 px-2 font-medium text-gray-900">{item.item_name}</td>
                          <td className="py-3 px-2 text-sm text-gray-600">{item.unit}</td>
                          <td className="py-3 px-2 text-sm text-gray-600">{formatQuantity(item.system_quantity)}</td>
                          <td className="py-3 px-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={item.actual_quantity}
                              onChange={(e) => handleItemChange(index, 'actual_quantity', e.target.value)}
                              aria-label="الكمية الفعلية"
                              placeholder="مثال: 19.200"
                              className={`w-24 px-3 py-1 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm ${invalid ? 'border-red-400' : 'border-gray-300'}`}
                              dir="ltr"
                            />
                          </td>
                          <td className={`py-3 px-2 text-sm font-medium ${variance === 0 ? 'text-green-600' : variance > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                            {variance > 0 ? '+' : ''}{formatQuantity(variance)}
                          </td>
                          <td className="py-3 px-2">
                            {variance !== 0 && (
                              <input
                                type="text"
                                value={item.variance_reason}
                                onChange={(e) => handleItemChange(index, 'variance_reason', e.target.value)}
                                placeholder="سبب الفرق"
                                className="w-full px-3 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                              />
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button type="submit" disabled={loading || fetchLoading || countItems.length === 0}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? (
              <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />جاري الحفظ...</>
            ) : (
              <><Save className="w-5 h-5" />حفظ الجرد</>
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
