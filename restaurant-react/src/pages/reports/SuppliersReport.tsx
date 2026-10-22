import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { reportsService, SuppliersSummaryData, dateRangeError, monthsAgoLocal } from '../../services/reports.service'
import { todayLocal } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { formatDate, formatNumber, formatCurrency } from '../../lib/utils'
import { useDebouncedValue } from './useDebouncedValue'
import { ArrowRight, Truck, DollarSign, CreditCard, TrendingUp, Package, AlertCircle } from 'lucide-react'

const paymentMethodLabels: Record<string, string> = {
  cash: 'نقدي',
  bank_transfer: 'تحويل بنكي',
  check: 'شيك',
}

const kindLabels: Record<string, string> = {
  purchase_order: 'أمر شراء آجل',
  purchase_order_cancel: 'إلغاء أمر شراء',
  supply: 'توريد',
}

// Payment status of a purchase document (a supply's approved returns count as settled)
const paymentStatusConfig: Record<string, { label: string; color: string }> = {
  paid: { label: 'مدفوع', color: 'bg-green-100 text-green-800' },
  partial: { label: 'مدفوع جزئياً', color: 'bg-yellow-100 text-yellow-800' },
  pending: { label: 'غير مدفوع', color: 'bg-red-100 text-red-800' },
  cancelled: { label: 'ملغي', color: 'bg-gray-100 text-gray-700' },
}

export default function SuppliersReport() {
  const [data, setData] = useState<SuppliersSummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'supplies' | 'payments'>('supplies')
  const [startDate, setStartDate] = useState(() => monthsAgoLocal(1))
  const [endDate, setEndDate] = useState(() => todayLocal())
  const requestId = useRef(0)
  const filterKey = useDebouncedValue(`${startDate}|${endDate}`)

  useEffect(() => {
    fetchReport(filterKey)
  }, [filterKey])

  // Same ledger as the supplier statement: credit purchase orders from approval, the unpaid part of supplies,
  // manual debts, minus payments and approved returns.
  const fetchReport = async (key: string) => {
    const [from, to] = key.split('|')
    const id = ++requestId.current
    const rangeError = dateRangeError(from, to)
    if (rangeError) {
      setData(null)
      setError(rangeError)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data, error } = await reportsService.getSuppliersSummary(from, to)
      if (id !== requestId.current) return
      if (error) {
        setData(null)
        setError(toUserMessage(error))
      } else {
        setData(data)
      }
    } catch (err) {
      if (id !== requestId.current) return
      setData(null)
      setError(toUserMessage(err))
    }
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/reports" className="p-2 hover:bg-gray-100 rounded-lg"><ArrowRight className="w-5 h-5" /></Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">تقرير الموردين</h1>
          <p className="text-gray-600">تحليل المشتريات الآجلة والمدفوعات والأرصدة المستحقة</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">من تاريخ</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} aria-label="من تاريخ" className="px-4 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">إلى تاريخ</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} aria-label="إلى تاريخ" className="px-4 py-2 border border-gray-300 rounded-lg" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <Package className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">عدد المشتريات</p>
                  <p className="text-xl font-bold">{formatNumber(data?.totalSupplies || 0)}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Truck className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">قيمة المشتريات الآجلة</p>
                  <p className="text-xl font-bold text-blue-600">{formatCurrency(data?.totalSuppliesValue || 0)}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">عدد المدفوعات</p>
                  <p className="text-xl font-bold">{formatNumber(data?.totalPayments || 0)}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">قيمة المدفوعات</p>
                  <p className="text-xl font-bold text-indigo-600">{formatCurrency(data?.totalPaymentsValue || 0)}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${(data?.balance || 0) > 0 ? 'bg-red-100' : 'bg-green-100'}`}>
                  <TrendingUp className={`w-5 h-5 ${(data?.balance || 0) > 0 ? 'text-red-600' : 'text-green-600'}`} />
                </div>
                <div>
                  <p className="text-sm text-gray-500">الرصيد المستحق</p>
                  <p className={`text-xl font-bold ${(data?.balance || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(data?.balance || 0)}
                  </p>
                  <p className="text-xs text-gray-400">في {formatDate(endDate)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* By Supplier */}
          {data?.bySupplier && data.bySupplier.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">ملخص حسب المورد</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">المورد</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">رصيد أول المدة</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">المشتريات</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">مديونيات يدوية</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">المدفوعات</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">المرتجعات</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">الرصيد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.bySupplier.map(s => (
                      <tr key={s.supplier_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">
                          <Link to={`/reports/supplier-statement?supplier=${s.supplier_id}&from=${startDate}&to=${endDate}`} className="hover:text-blue-600">
                            {s.supplier}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{formatCurrency(s.opening)}</td>
                        <td className="px-4 py-3 text-blue-600">{formatCurrency(s.supplies)}</td>
                        <td className="px-4 py-3 text-orange-600">{formatCurrency(s.manual_debts)}</td>
                        <td className="px-4 py-3 text-green-600">{formatCurrency(s.payments)}</td>
                        <td className="px-4 py-3 text-green-600">{formatCurrency(s.returns)}</td>
                        <td className={`px-4 py-3 font-medium ${s.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {formatCurrency(s.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setActiveTab('supplies')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'supplies' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
              المشتريات
            </button>
            <button type="button" onClick={() => setActiveTab('payments')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'payments' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
              المدفوعات
            </button>
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              {activeTab === 'supplies' ? (
                <table className="w-full">
                  <thead className="bg-green-600 text-white">
                    <tr>
                      <th className="px-4 py-3 text-right text-sm font-medium">رقم المستند</th>
                      <th className="px-4 py-3 text-right text-sm font-medium">المورد</th>
                      <th className="px-4 py-3 text-right text-sm font-medium">المبلغ</th>
                      <th className="px-4 py-3 text-right text-sm font-medium">التاريخ</th>
                      <th className="px-4 py-3 text-right text-sm font-medium">النوع</th>
                      <th className="px-4 py-3 text-right text-sm font-medium">حالة الدفع</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data?.supplies.map((s, i) => {
                      const payment = s.payment_status ? paymentStatusConfig[s.payment_status] : undefined
                      return (
                      <tr key={s.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-3 font-medium">{s.supply_number}</td>
                        <td className="px-4 py-3">{s.supplier}</td>
                        <td className={`px-4 py-3 ${s.total_amount < 0 ? 'text-green-600' : 'text-blue-600'}`}>{formatCurrency(s.total_amount)}</td>
                        <td className="px-4 py-3">{formatDate(s.supply_date)}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">{kindLabels[s.kind] || s.kind}</span>
                        </td>
                        <td className="px-4 py-3">
                          {payment ? (
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${payment.color}`}>{payment.label}</span>
                          ) : (s.payment_status || '-')}
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <table className="w-full">
                  <thead className="bg-green-600 text-white">
                    <tr>
                      <th className="px-4 py-3 text-right text-sm font-medium">رقم الدفعة</th>
                      <th className="px-4 py-3 text-right text-sm font-medium">المورد</th>
                      <th className="px-4 py-3 text-right text-sm font-medium">المبلغ</th>
                      <th className="px-4 py-3 text-right text-sm font-medium">التاريخ</th>
                      <th className="px-4 py-3 text-right text-sm font-medium">طريقة الدفع</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data?.payments.map((p, i) => (
                      <tr key={p.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-3 font-medium">{p.payment_number}</td>
                        <td className="px-4 py-3">{p.supplier}</td>
                        <td className="px-4 py-3 text-green-600">{formatCurrency(p.amount)}</td>
                        <td className="px-4 py-3">{formatDate(p.payment_date)}</td>
                        <td className="px-4 py-3">{paymentMethodLabels[p.payment_method] || p.payment_method}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {((activeTab === 'supplies' && (!data?.supplies || data.supplies.length === 0)) ||
              (activeTab === 'payments' && (!data?.payments || data.payments.length === 0))) && (
              <div className="text-center py-12 text-gray-500">لا توجد بيانات في هذه الفترة</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
