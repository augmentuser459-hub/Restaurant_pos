import { useState, useEffect, useRef, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { suppliersService, SupplyRecord, supplyOutstanding } from '../../services/suppliers.service'
import { Supplier } from '../../types/database.types'
import { formatCurrency, formatDate, parseDecimal, roundMoney } from '../../lib/utils'
import { todayLocal } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { Save, ArrowRight, AlertCircle, CreditCard } from 'lucide-react'

export default function PaymentForm() {
  const { supplierId } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(true)
  const [error, setError] = useState('')
  const submittingRef = useRef(false)
  const supplierRef = useRef('')

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplies, setSupplies] = useState<SupplyRecord[]>([])
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)

  const [formData, setFormData] = useState({
    supplier_id: supplierId || '',
    supply_id: '',
    amount: '',
    payment_date: todayLocal(),
    payment_method: 'cash',
    reference_number: '',
    notes: '',
  })

  useEffect(() => {
    fetchSuppliers()
  }, [])

  useEffect(() => {
    supplierRef.current = formData.supplier_id
    setSelectedSupplier(null)
    setSupplies([])
    setFormData(prev => ({ ...prev, supply_id: '' }))
    if (formData.supplier_id) {
      fetchSupplierData(formData.supplier_id)
    }
  }, [formData.supplier_id])

  const fetchSuppliers = async () => {
    const { data, error } = await suppliersService.getActive()
    if (error) setError('فشل في تحميل الموردين: ' + toUserMessage(error))
    if (data) setSuppliers(data)
    setFetchLoading(false)
  }

  const fetchSupplierData = async (id: string) => {
    const [supplierRes, suppliesRes] = await Promise.all([
      suppliersService.getById(id),
      suppliersService.getSupplies(id)
    ])
    if (supplierRef.current !== id) return // another supplier was picked meanwhile
    const loadError = supplierRes.error || suppliesRes.error
    if (loadError) setError('فشل في تحميل بيانات المورد: ' + toUserMessage(loadError))
    if (supplierRes.data) setSelectedSupplier(supplierRes.data)
    if (suppliesRes.data) {
      // Supplies with something left to pay (approved returns already deducted)
      setSupplies(suppliesRes.data.filter(s => supplyOutstanding(s) > 0))
    }
  }

  const balance = roundMoney(Number(selectedSupplier?.current_balance || 0))
  const selectedSupply = supplies.find(s => s.id === formData.supply_id)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submittingRef.current) return
    setError('')

    const amount = parseDecimal(formData.amount)
    if (amount === null || amount <= 0) {
      setError('يجب أن يكون المبلغ أكبر من صفر')
      return
    }
    const value = roundMoney(amount)
    if (selectedSupply && value > supplyOutstanding(selectedSupply)) {
      setError(`المبلغ أكبر من المتبقي على التوريد (${formatCurrency(supplyOutstanding(selectedSupply))})`)
      return
    }
    if (selectedSupplier && value > balance) {
      setError(`المبلغ أكبر من مديونية المورد الحالية (${formatCurrency(balance)})`)
      return
    }

    submittingRef.current = true
    setLoading(true)

    // Saved to supplier_payments; the supply's paid amount and the supplier balance change in the same transaction
    const { error: submitError } = await suppliersService.createPayment({
      supplier_id: formData.supplier_id,
      supply_id: formData.supply_id || undefined,
      amount: value,
      payment_date: formData.payment_date,
      payment_method: formData.payment_method,
      reference_number: formData.reference_number || undefined,
      notes: formData.notes || undefined,
    })

    if (submitError) {
      setError('فشل في حفظ الدفعة: ' + toUserMessage(submitError))
      setLoading(false)
      submittingRef.current = false
      return
    }
    alert('تم تسجيل الدفعة بنجاح')
    navigate(`/suppliers/${formData.supplier_id}`)
  }

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSupplySelect = (supplyId: string) => {
    setFormData(prev => ({ ...prev, supply_id: supplyId }))
    if (supplyId) {
      const supply = supplies.find(s => s.id === supplyId)
      if (supply) {
        // Prefill what can actually be paid: never more than the supplier's current balance
        const suggested = selectedSupplier ? Math.min(supplyOutstanding(supply), Math.max(balance, 0)) : supplyOutstanding(supply)
        setFormData(prev => ({ ...prev, supply_id: supplyId, amount: suggested > 0 ? String(roundMoney(suggested)) : '' }))
      }
    }
  }

  if (fetchLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button type="button" onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">دفعة جديدة</h1>
          <p className="text-gray-600">تسجيل دفعة للمورد</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات الدفعة</h2>

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
              <label className="block text-sm font-medium text-gray-700 mb-2">تاريخ الدفع <span className="text-red-500">*</span></label>
              <input type="date" value={formData.payment_date} max={todayLocal()} onChange={(e) => handleChange('payment_date', e.target.value)} required
                aria-label="تاريخ الدفع" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" dir="ltr" />
            </div>

            {selectedSupplier && (
              <div className="md:col-span-2 bg-blue-50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-blue-600" />
                  <div>
                    <p className="text-sm text-gray-600">الرصيد الحالي للمورد</p>
                    <p className="text-xl font-bold text-blue-600">{balance.toLocaleString('ar-EG')} ج.م</p>
                  </div>
                </div>
              </div>
            )}

            {supplies.length > 0 && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">ربط بتوريد (اختياري)</label>
                <select value={formData.supply_id} onChange={(e) => handleSupplySelect(e.target.value)}
                  aria-label="ربط بتوريد" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                  <option value="">دفعة عامة (بدون ربط)</option>
                  {supplies.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.supply_number} - {formatDate(s.invoice_date || s.created_at)} - متبقي: {formatCurrency(supplyOutstanding(s))}
                    </option>
                  ))}
                </select>
              </div>
            )}


            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">المبلغ <span className="text-red-500">*</span></label>
              <input type="text" inputMode="decimal" value={formData.amount} onChange={(e) => handleChange('amount', e.target.value)} required
                aria-label="المبلغ" placeholder="0.00" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" dir="ltr" />
              {selectedSupply && (
                <p className="text-xs text-gray-500 mt-1">
                  المتبقي على التوريد: {formatCurrency(supplyOutstanding(selectedSupply))}
                  {Number(selectedSupply.returned_amount || 0) > 0 && ` (بعد خصم مرتجعات ${formatCurrency(selectedSupply.returned_amount || 0)})`}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">طريقة الدفع</label>
              <select value={formData.payment_method} onChange={(e) => handleChange('payment_method', e.target.value)}
                aria-label="طريقة الدفع" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="cash">نقدي</option>
                <option value="bank_transfer">تحويل بنكي</option>
                <option value="check">شيك</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">رقم المرجع</label>
              <input type="text" value={formData.reference_number} onChange={(e) => handleChange('reference_number', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="رقم الشيك / التحويل" dir="ltr" />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
              <textarea value={formData.notes} onChange={(e) => handleChange('notes', e.target.value)} rows={2}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="ملاحظات إضافية..." />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            {loading ? (
              <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />جاري الحفظ...</>
            ) : (
              <><Save className="w-5 h-5" />تسجيل الدفعة</>
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
