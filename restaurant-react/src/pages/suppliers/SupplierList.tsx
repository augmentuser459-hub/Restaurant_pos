import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { suppliersService } from '../../services/suppliers.service'
import { Supplier } from '../../types/database.types'
import { formatCurrency } from '../../lib/utils'
import { supabase } from '../../lib/supabase'
import { Plus, Edit, Trash2, Truck, Phone, Mail, User, CreditCard, DollarSign, X } from 'lucide-react'

export default function SupplierList() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [debtTransactions, setDebtTransactions] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showDebtModal, setShowDebtModal] = useState(false)
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [debtAmount, setDebtAmount] = useState(0)
  const [debtNotes, setDebtNotes] = useState('')
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    fetchSuppliers()
  }, [])

  const fetchSuppliers = async () => {
    const { data } = await suppliersService.getAll()
    setSuppliers(data || [])
    
    // Fetch debt transactions for all suppliers
    if (data && data.length > 0) {
      const { data: transactions } = await supabase
        .from('supplier_debt_transactions')
        .select('*')
        .in('supplier_id', data.map(s => s.id))
        .gt('amount', 0)
        .order('created_at', { ascending: true })
      
      if (transactions) {
        const grouped = transactions.reduce((acc, t) => {
          if (!acc[t.supplier_id]) acc[t.supplier_id] = []
          acc[t.supplier_id].push(t)
          return acc
        }, {} as Record<string, any[]>)
        setDebtTransactions(grouped)
      }
    }
    
    setLoading(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا المورد؟')) return
    
    setDeleteId(id)
    const { error } = await suppliersService.delete(id)
    if (!error) {
      setSuppliers(suppliers.filter(s => s.id !== id))
    }
    setDeleteId(null)
  }

  const handleOpenDebtModal = (supplier: Supplier) => {
    setSelectedSupplier(supplier)
    setDebtAmount(0)
    setDebtNotes('')
    setShowDebtModal(true)
  }

  const handleAddDebt = async () => {
    if (!selectedSupplier || debtAmount <= 0) {
      alert('يجب إدخال مبلغ صحيح')
      return
    }

    setProcessing(true)
    
    const newBalance = (selectedSupplier.current_balance || 0) + debtAmount
    
    // Update supplier balance
    const { error: balanceError } = await supabase
      .from('suppliers')
      .update({ 
        current_balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('id', selectedSupplier.id)

    if (balanceError) {
      alert('فشل في إضافة المديونية: ' + balanceError.message)
      setProcessing(false)
      return
    }

    // Record debt transaction
    const { error: transactionError } = await supabase
      .from('supplier_debt_transactions')
      .insert({
        supplier_id: selectedSupplier.id,
        transaction_type: 'manual_debt',
        amount: debtAmount,
        description: debtNotes || 'إضافة مديونية يدوية',
      })

    if (transactionError) {
      console.error('Failed to record transaction:', transactionError)
    }

    alert('تمت إضافة المديونية بنجاح')
    setShowDebtModal(false)
    fetchSuppliers()
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
        <Link
          to="/suppliers/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          مورد جديد
        </Link>
      </div>

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
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                        <Truck className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{supplier.name_ar}</p>
                        <p className="text-sm text-gray-500">{supplier.code}</p>
                      </div>
                    </div>
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
                    {(() => {
                      const transactions = debtTransactions[supplier.id] || []
                      const manualDebtTotal = transactions
                        .filter(t => t.transaction_type === 'manual_debt')
                        .reduce((sum, t) => sum + Number(t.amount), 0)
                      
                      const baseDebt = supplier.current_balance - manualDebtTotal
                      
                      if (manualDebtTotal > 0 && supplier.current_balance > 0) {
                        // Show: 500 + 140 (base + manual additions)
                        return (
                          <div>
                            <div className="flex items-center gap-2">
                              <CreditCard className="w-4 h-4 text-red-500" />
                              <span className="font-medium text-lg text-red-600">
                                {formatCurrency(baseDebt)} + {formatCurrency(manualDebtTotal)}
                              </span>
                            </div>
                            <p className="text-xs text-red-500 mt-1">
                              = {formatCurrency(supplier.current_balance)} مستحق للمورد
                            </p>
                          </div>
                        )
                      } else {
                        // Show simple balance
                        return (
                          <div>
                            <div className="flex items-center gap-2">
                              <CreditCard className={`w-4 h-4 ${supplier.current_balance > 0 ? 'text-red-500' : 'text-green-500'}`} />
                              <span className={`font-medium text-lg ${supplier.current_balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {formatCurrency(Math.abs(supplier.current_balance))}
                              </span>
                            </div>
                            {supplier.current_balance > 0 && (
                              <p className="text-xs text-red-500 mt-1">مستحق للمورد</p>
                            )}
                            {supplier.current_balance < 0 && (
                              <p className="text-xs text-green-500 mt-1">مدفوع زيادة</p>
                            )}
                            {supplier.current_balance === 0 && (
                              <p className="text-xs text-gray-500 mt-1">لا يوجد مديونية</p>
                            )}
                          </div>
                        )
                      }
                    })()}
                  </td>
                  <td className="px-6 py-4">
                    {getStatusBadge(supplier.status)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
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
              ))}
            </tbody>
          </table>
        </div>

        {suppliers.length === 0 && (
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
                  type="number"
                  min="0"
                  step="0.01"
                  value={debtAmount}
                  onChange={(e) => setDebtAmount(Number(e.target.value))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>
              
              {/* Calculation Display */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-2">الحساب:</p>
                <div className="flex items-center justify-center gap-3 text-lg font-medium">
                  <span className="text-gray-900">{formatCurrency(selectedSupplier.current_balance || 0)}</span>
                  <span className="text-blue-600">+</span>
                  <span className="text-orange-600">{formatCurrency(debtAmount)}</span>
                  <span className="text-gray-400">=</span>
                  <span className="text-red-600 font-bold">{formatCurrency((selectedSupplier.current_balance || 0) + debtAmount)}</span>
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
                disabled={processing || debtAmount <= 0}
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
