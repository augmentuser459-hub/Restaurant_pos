import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { suppliersService } from '../../services/suppliers.service'
import { Supplier } from '../../types/database.types'
import { formatCurrency, parseDecimal, roundMoney } from '../../lib/utils'
import { toUserMessage } from '../../lib/errors'
import { Plus, Edit, Trash2, Truck, Phone, Mail, User, CreditCard, DollarSign, X, PackagePlus, Wallet, FileText, AlertCircle } from 'lucide-react'

export default function SupplierList() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  // All-time manual debt per supplier (for the "base + manual" display)
  const [manualDebts, setManualDebts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showDebtModal, setShowDebtModal] = useState(false)
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [debtAmount, setDebtAmount] = useState('')
  const [debtNotes, setDebtNotes] = useState('')
  const [processing, setProcessing] = useState(false)
  const processingRef = useRef(false)

  useEffect(() => {
    fetchSuppliers()
  }, [])

  const fetchSuppliers = async () => {
    const [suppliersRes, debtsRes] = await Promise.all([
      suppliersService.getAll(),
      suppliersService.getManualDebts(),
    ])
    const loadError = suppliersRes.error || debtsRes.error
    setError(loadError ? 'فشل في تحميل الموردين: ' + toUserMessage(loadError) : '')
    setSuppliers(suppliersRes.data || [])

    const totals: Record<string, number> = {}
    for (const d of debtsRes.data || []) {
      if (Number(d.amount) > 0) totals[d.supplier_id] = roundMoney((totals[d.supplier_id] || 0) + Number(d.amount))
    }
    setManualDebts(totals)
    setLoading(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا المورد؟')) return

    setDeleteId(id)
    const { error } = await suppliersService.delete(id)
    if (error) {
      alert('فشل في حذف المورد: ' + toUserMessage(error))
    } else {
      setSuppliers(suppliers.filter(s => s.id !== id))
    }
    setDeleteId(null)
  }

  const handleOpenDebtModal = (supplier: Supplier) => {
    setSelectedSupplier(supplier)
    setDebtAmount('')
    setDebtNotes('')
    setShowDebtModal(true)
  }

  const parsedDebt = parseDecimal(debtAmount)
  const debtValue = parsedDebt !== null && parsedDebt > 0 ? roundMoney(parsedDebt) : 0

  const handleAddDebt = async () => {
    if (processingRef.current) return
    if (!selectedSupplier || debtValue <= 0) {
      alert('يجب إدخال مبلغ صحيح')
      return
    }

    processingRef.current = true
    setProcessing(true)

    // The balance is increased in the database (current_balance + amount, under a row lock) together with
    // the manual-debt record, so a payment made meanwhile is never overwritten.
    const { error } = await suppliersService.addManualDebt(selectedSupplier.id, debtValue, debtNotes || undefined)

    if (error) {
      alert('فشل في إضافة المديونية: ' + toUserMessage(error))
    } else {
      alert('تمت إضافة المديونية بنجاح')
      setShowDebtModal(false)
      await fetchSuppliers()
    }
    processingRef.current = false
    setProcessing(false)
  }

  const getStatusBadge = (status: string) => {
    const styles = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
    }
    const labels = {
      active: 'نشط',
      inactive: 'غير نشط',
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status as keyof typeof styles]}`}>
        {labels[status as keyof typeof labels]}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">الموردين</h1>
          <p className="text-gray-600">إدارة الموردين والتوريدات</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/supplies/new"
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <PackagePlus className="w-5 h-5" />
            توريد جديد
          </Link>
          <Link
            to="/payments/new"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Wallet className="w-5 h-5" />
            دفعة جديدة
          </Link>
          <Link
            to="/suppliers/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            مورد جديد
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Suppliers Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">المورد</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">التواصل</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">المديونية</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الحالة</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {suppliers.map((supplier) => {
                const balance = roundMoney(Number(supplier.current_balance || 0))
                const manualDebtTotal = manualDebts[supplier.id] || 0
                const baseDebt = roundMoney(balance - manualDebtTotal)
                return (
                <tr key={supplier.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <Link to={`/suppliers/${supplier.id}`} className="flex items-center gap-3 group">
                      <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                        <Truck className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 group-hover:text-blue-600">{supplier.name_ar}</p>
                        <p className="text-sm text-gray-500">{supplier.code}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1 text-sm">
                      {supplier.contact_person && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <User className="w-4 h-4" />
                          <span>{supplier.contact_person}</span>
                        </div>
                      )}
                      {supplier.phone && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <Phone className="w-4 h-4" />
                          <span dir="ltr">{supplier.phone}</span>
                        </div>
                      )}
                      {supplier.email && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <Mail className="w-4 h-4" />
                          <span dir="ltr">{supplier.email}</span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {manualDebtTotal > 0 && balance > 0 && baseDebt >= 0 ? (
                      // Show: 500 + 140 (base + manual additions); a negative base (payments above the
                      // other purchases) would be misleading, so then only the balance is shown
                      <div>
                        <div className="flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-red-500" />
                          <span className="font-medium text-lg text-red-600">
                            {formatCurrency(baseDebt)} + {formatCurrency(manualDebtTotal)}
                          </span>
                        </div>
                        <p className="text-xs text-red-500 mt-1">
                          = {formatCurrency(balance)} مستحق للمورد
                        </p>
                      </div>
                    ) : (
                      // Show simple balance
                      <div>
                        <div className="flex items-center gap-2">
                          <CreditCard className={`w-4 h-4 ${balance > 0 ? 'text-red-500' : 'text-green-500'}`} />
                          <span className={`font-medium text-lg ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {formatCurrency(Math.abs(balance))}
                          </span>
                        </div>
                        {balance > 0 && (
                          <p className="text-xs text-red-500 mt-1">مستحق للمورد</p>
                        )}
                        {balance < 0 && (
                          <p className="text-xs text-green-500 mt-1">مدفوع زيادة</p>
                        )}
                        {balance === 0 && (
                          <p className="text-xs text-gray-500 mt-1">لا يوجد مديونية</p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {getStatusBadge(supplier.status)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/suppliers/${supplier.id}/supply`}
                        className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                        title="توريد جديد"
                      >
                        <PackagePlus className="w-4 h-4" />
                      </Link>
                      <Link
                        to={`/suppliers/${supplier.id}/payment`}
                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="دفعة جديدة"
                      >
                        <Wallet className="w-4 h-4" />
                      </Link>
                      <Link
                        to={`/reports/supplier-statement?supplier=${supplier.id}`}
                        className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="كشف حساب"
                      >
                        <FileText className="w-4 h-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleOpenDebtModal(supplier)}
                        className="p-1.5 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                        title="إضافة مديونية"
                      >
                        <DollarSign className="w-4 h-4" />
                      </button>
                      <Link
                        to={`/suppliers/${supplier.id}/edit`}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="تعديل"
                      >
                        <Edit className="w-4 h-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(supplier.id)}
                        disabled={deleteId === supplier.id}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {suppliers.length === 0 && !error && (
          <div className="text-center py-12">
            <Truck className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">لا يوجد موردين</h3>
            <p className="text-gray-600 mb-4">ابدأ بإضافة مورد جديد</p>
            <Link
              to="/suppliers/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              إضافة مورد
            </Link>
          </div>
        )}
      </div>

      {/* Add Debt Modal */}
      {showDebtModal && selectedSupplier && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="text-lg font-semibold">إضافة مديونية - {selectedSupplier.name_ar}</h3>
              <button type="button" onClick={() => setShowDebtModal(false)} className="p-1 hover:bg-gray-100 rounded" title="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">المبلغ المضاف <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={debtAmount}
                  onChange={(e) => setDebtAmount(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                  dir="ltr"
                />
              </div>

              {/* Calculation Display */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-2">الحساب:</p>
                <div className="flex items-center justify-center gap-3 text-lg font-medium">
                  <span className="text-gray-900">{formatCurrency(Number(selectedSupplier.current_balance || 0))}</span>
                  <span className="text-blue-600">+</span>
                  <span className="text-orange-600">{formatCurrency(debtValue)}</span>
                  <span className="text-gray-400">=</span>
                  <span className="text-red-600 font-bold">{formatCurrency(roundMoney(Number(selectedSupplier.current_balance || 0) + debtValue))}</span>
                </div>
                <p className="text-xs text-gray-500 text-center mt-2">
                  المديونية الحالية + المبلغ المضاف = المديونية الجديدة
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
                <textarea
                  value={debtNotes}
                  onChange={(e) => setDebtNotes(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="سبب إضافة المديونية..."
                />
              </div>
            </div>
            <div className="flex gap-3 p-6 border-t">
              <button
                type="button"
                onClick={handleAddDebt}
                disabled={processing || debtValue <= 0}
                className="flex-1 px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                {processing ? 'جاري الحفظ...' : 'إضافة المديونية'}
              </button>
              <button
                type="button"
                onClick={() => setShowDebtModal(false)}
                className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
