import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { dailyCountService, CreateDailyCountData } from '../../services/dailyCount.service'
import { branchesService } from '../../services/branches.service'
import { inventoryService, InventoryWithDetails } from '../../services/inventory.service'
import { useAuth } from '../../contexts/AuthContext'
import { Branch } from '../../types/database.types'
import { Save, ArrowRight, AlertCircle, ClipboardList } from 'lucide-react'

interface CountItem {
  item_id: string
  item_name: string
  item_code: string
  unit: string
  system_quantity: number
  actual_quantity: number
  variance_reason: string
}

export default function DailyCountForm() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(true)
  const [error, setError] = useState('')

  const [branches, setBranches] = useState<Branch[]>([])
  const [countItems, setCountItems] = useState<CountItem[]>([])

  const [formData, setFormData] = useState({
    branch_id: user?.branch_id || '',
    count_date: new Date().toISOString().split('T')[0],
    count_type: 'opening' as 'opening' | 'closing',
    notes: '',
  })

  useEffect(() => {
    fetchBranches()
  }, [])

  useEffect(() => {
    if (formData.branch_id) {
      fetchInventory(formData.branch_id)
    }
  }, [formData.branch_id])

  const fetchBranches = async () => {
    const { data } = await branchesService.getActive()
    setBranches(data || [])
    setFetchLoading(false)
  }

  const fetchInventory = async (branchId: string) => {
    setFetchLoading(true)
    const { data } = await inventoryService.getStockByBranch(branchId)
    if (data) {
      setCountItems(data.map((inv: InventoryWithDetails) => ({
        item_id: inv.item.id,
        item_name: inv.item.name_ar,
        item_code: inv.item.code,
        unit: inv.item.unit,
        system_quantity: inv.quantity,
        actual_quantity: inv.quantity,
        variance_reason: '',
      })))
    }
    setFetchLoading(false)
  }


  const handleItemChange = (index: number, field: keyof CountItem, value: string | number) => {
    const updated = [...countItems]
    updated[index] = { ...updated[index], [field]: value }
    setCountItems(updated)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (countItems.length === 0) {
      setError('لا توجد أصناف للجرد')
      return
    }

    setLoading(true)

    const countData: CreateDailyCountData = {
      branch_id: formData.branch_id,
      count_date: formData.count_date,
      count_type: formData.count_type,
      counted_by: user?.id || '',
      notes: formData.notes || undefined,
      items: countItems.map(item => ({
        item_id: item.item_id,
        system_quantity: item.system_quantity,
        actual_quantity: item.actual_quantity,
        variance_reason: item.variance_reason || undefined,
      }))
    }

    const { error: submitError } = await dailyCountService.create(countData)

    if (submitError) {
      setError('فشل في حفظ الجرد')
    } else {
      navigate('/inventory/daily-count')
    }
    setLoading(false)
  }

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const totalVariance = countItems.reduce((sum, item) => sum + (item.actual_quantity - item.system_quantity), 0)
  const itemsWithVariance = countItems.filter(item => item.actual_quantity !== item.system_quantity).length

  if (fetchLoading && !formData.branch_id) {
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

      <form onSubmit={handleSubmit} className="space-y-6">
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
              <input type="date" value={formData.count_date} onChange={(e) => handleChange('count_date', e.target.value)} required
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
              {totalVariance > 0 ? '+' : ''}{totalVariance} فرق إجمالي
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
                      const variance = item.actual_quantity - item.system_quantity
                      return (
                        <tr key={item.item_id} className={`border-b border-gray-100 ${variance !== 0 ? 'bg-yellow-50' : ''}`}>
                          <td className="py-3 px-2 text-sm text-gray-600">{item.item_code}</td>
                          <td className="py-3 px-2 font-medium text-gray-900">{item.item_name}</td>
                          <td className="py-3 px-2 text-sm text-gray-600">{item.unit}</td>
                          <td className="py-3 px-2 text-sm text-gray-600">{item.system_quantity}</td>
                          <td className="py-3 px-2">
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              value={item.actual_quantity}
                              onChange={(e) => handleItemChange(index, 'actual_quantity', Number(e.target.value))}
                              aria-label="الكمية الفعلية"
                              placeholder="مثال: 19.200"
                              className="w-24 px-3 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                              dir="ltr"
                            />
                          </td>
                          <td className={`py-3 px-2 text-sm font-medium ${variance === 0 ? 'text-green-600' : variance > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                            {variance > 0 ? '+' : ''}{variance}
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
          <button type="submit" disabled={loading || countItems.length === 0}
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
