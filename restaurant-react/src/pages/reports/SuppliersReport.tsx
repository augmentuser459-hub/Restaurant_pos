import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatDate, formatNumber, formatCurrency } from '../../lib/utils'
import { ArrowRight, Truck, DollarSign, CreditCard, TrendingUp, Package } from 'lucide-react'

interface SupplierReportData {
  totalSupplies: number
  totalSuppliesValue: number
  totalPayments: number
  totalPaymentsValue: number
  balance: number
  supplies: {
    id: string
    supply_number: string
    supplier: string
    total_amount: number
    supply_date: string
    status: string
  }[]
  payments: {
    id: string
    payment_number: string
    supplier: string
    amount: number
    payment_date: string
    payment_method: string
  }[]
  bySupplier: { supplier: string; supplies: number; payments: number; balance: number }[]
}

export default function SuppliersReport() {
  const [data, setData] = useState<SupplierReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'supplies' | 'payments'>('supplies')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => {
    fetchReport()
  }, [startDate, endDate])

  const fetchReport = async () => {
    setLoading(true)
    
    // Fetch supplies
    const { data: supplies } = await supabase
      .from('supplies')
      .select(`id, supply_number, total_amount, created_at, payment_status, supplier:suppliers(name_ar)`)
      .gte('created_at', startDate)
      .lte('created_at', endDate + 'T23:59:59')
      .order('created_at', { ascending: false })

    // Fetch payments
    const { data: payments } = await supabase
      .from('supplier_payments')
      .select(`id, payment_number, amount, payment_date, payment_method, supplier:suppliers(name_ar)`)
      .gte('payment_date', startDate)
      .lte('payment_date', endDate + 'T23:59:59')
      .order('payment_date', { ascending: false })

    // Calculate by supplier
    const supplierStats: Record<string, { supplies: number; payments: number }> = {}
    
    supplies?.forEach(s => {
      const name = (s.supplier as unknown as { name_ar: string })?.name_ar || 'غير محدد'
      if (!supplierStats[name]) supplierStats[name] = { supplies: 0, payments: 0 }
      supplierStats[name].supplies += Number(s.total_amount) || 0
    })

    payments?.forEach(p => {
      const name = (p.supplier as unknown as { name_ar: string })?.name_ar || 'غير محدد'
      if (!supplierStats[name]) supplierStats[name] = { supplies: 0, payments: 0 }
      supplierStats[name].payments += Number(p.amount) || 0
    })

    const totalSuppliesValue = supplies?.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0) || 0
    const totalPaymentsValue = payments?.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) || 0

    const reportData: SupplierReportData = {
      totalSupplies: supplies?.length || 0,
      totalSuppliesValue,
      totalPayments: payments?.length || 0,
      totalPaymentsValue,
      balance: totalSuppliesValue - totalPaymentsValue,
      supplies: supplies?.map(s => ({
        id: s.id,
        supply_number: s.supply_number,
        supplier: (s.supplier as unknown as { name_ar: string })?.name_ar || '-',
        total_amount: Number(s.total_amount) || 0,
        supply_date: s.created_at,
        status: s.payment_status || 'pending',
      })) || [],
      payments: payments?.map(p => ({
        id: p.id,
        payment_number: p.payment_number,
        supplier: (p.supplier as unknown as { name_ar: string })?.name_ar || '-',
        amount: Number(p.amount) || 0,
        payment_date: p.payment_date,
        payment_method: p.payment_method || '-',
      })) || [],
      bySupplier: Object.entries(supplierStats).map(([supplier, stats]) => ({
        supplier,
        supplies: stats.supplies,
        payments: stats.payments,
        balance: stats.supplies - stats.payments,
      })),
    }
    setData(reportData)
    setLoading(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/reports" className="p-2 hover:bg-gray-100 rounded-lg"><ArrowRight className="w-5 h-5" /></Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">تقرير الموردين</h1>
          <p className="text-gray-600">تحليل التوريدات والمدفوعات</p>
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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <Package className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">عدد التوريدات</p>
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
              <p className="text-sm text-gray-500">قيمة التوريدات</p>
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
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">التوريدات</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">المدفوعات</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">الرصيد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.bySupplier.map(s => (
                  <tr key={s.supplier} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{s.supplier}</td>
                    <td className="px-4 py-3 text-blue-600">{formatCurrency(s.supplies)}</td>
                    <td className="px-4 py-3 text-green-600">{formatCurrency(s.payments)}</td>
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
          التوريدات
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
                  <th className="px-4 py-3 text-right text-sm font-medium">رقم التوريد</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">المورد</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">المبلغ</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">التاريخ</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data?.supplies.map((s, i) => (
                  <tr key={s.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 font-medium">{s.supply_number}</td>
                    <td className="px-4 py-3">{s.supplier}</td>
                    <td className="px-4 py-3 text-blue-600">{formatCurrency(s.total_amount)}</td>
                    <td className="px-4 py-3">{formatDate(s.supply_date)}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">{s.status}</span>
                    </td>
                  </tr>
                ))}
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
                    <td className="px-4 py-3">{p.payment_method}</td>
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
    </div>
  )
}
