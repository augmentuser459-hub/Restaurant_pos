import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { suppliersService, SupplyRecord, SupplierPaymentRecord, supplyPaymentStatus } from '../../services/suppliers.service'
import { purchaseService, PurchaseOrderWithDetails } from '../../services/purchase.service'
import { Supplier } from '../../types/database.types'
import { formatCurrency, formatDate, roundMoney } from '../../lib/utils'
import { toUserMessage } from '../../lib/errors'
import { ArrowRight, Edit, PackagePlus, Wallet, FileText, Truck, Phone, Mail, User, MapPin, AlertCircle } from 'lucide-react'

const orderStatusLabels: Record<string, string> = {
  draft: 'مسودة',
  pending: 'قيد الانتظار',
  approved: 'معتمد',
  sent: 'تم الإرسال',
  partially_received: 'استلام جزئي',
  received: 'تم الاستلام',
  rejected: 'مرفوض',
  cancelled: 'ملغي',
}

const paymentStatusLabels: Record<string, string> = {
  pending: 'غير مدفوع',
  partial: 'مدفوع جزئياً',
  paid: 'مدفوع',
}

const paymentMethodLabels: Record<string, string> = {
  cash: 'نقدي',
  bank_transfer: 'تحويل بنكي',
  check: 'شيك',
}

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>()
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [orders, setOrders] = useState<PurchaseOrderWithDetails[]>([])
  const [supplies, setSupplies] = useState<SupplyRecord[]>([])
  const [payments, setPayments] = useState<SupplierPaymentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'orders' | 'supplies' | 'payments'>('orders')

  useEffect(() => {
    if (id) fetchData(id)
  }, [id])

  const fetchData = async (supplierId: string) => {
    setLoading(true)
    const [supplierRes, ordersRes, suppliesRes, paymentsRes] = await Promise.all([
      suppliersService.getById(supplierId),
      purchaseService.getOrders(supplierId),
      suppliersService.getSupplies(supplierId),
      suppliersService.getPayments(supplierId),
    ])
    const loadError = supplierRes.error || ordersRes.error || suppliesRes.error || paymentsRes.error
    setError(loadError ? 'فشل في تحميل بيانات المورد: ' + toUserMessage(loadError) : '')
    setSupplier(supplierRes.data)
    setOrders(ordersRes.data || [])
    setSupplies(suppliesRes.data || [])
    setPayments(paymentsRes.data || [])
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!supplier) {
    return (
      <div className="text-center py-12">
        {error && <p className="text-red-600 mb-2">{error}</p>}
        <p className="text-gray-500">المورد غير موجود</p>
        <Link to="/suppliers" className="text-blue-600 hover:underline mt-2 inline-block">
          العودة للقائمة
        </Link>
      </div>
    )
  }

  const balance = roundMoney(Number(supplier.current_balance || 0))
  const creditLimit = roundMoney(Number(supplier.credit_limit || 0))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/suppliers" className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
            <ArrowRight className="w-5 h-5" />
          </Link>
          <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
            <Truck className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{supplier.name_ar}</h1>
            <p className="text-gray-600">
              {supplier.code}
              <span className={`mr-2 px-2 py-0.5 rounded-full text-xs font-medium ${supplier.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                {supplier.status === 'active' ? 'نشط' : 'غير نشط'}
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/suppliers/${supplier.id}/supply`}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
            <PackagePlus className="w-4 h-4" />
            توريد جديد
          </Link>
          <Link to={`/suppliers/${supplier.id}/payment`}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            <Wallet className="w-4 h-4" />
            دفعة جديدة
          </Link>
          <Link to={`/reports/supplier-statement?supplier=${supplier.id}`}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
            <FileText className="w-4 h-4" />
            كشف حساب
          </Link>
          <Link to={`/suppliers/${supplier.id}/edit`}
            className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg">
            <Edit className="w-4 h-4" />
            تعديل
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 md:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">بيانات المورد</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-gray-600"><User className="w-4 h-4" />{supplier.contact_person || '-'}</div>
            <div className="flex items-center gap-2 text-gray-600"><Phone className="w-4 h-4" /><span dir="ltr">{supplier.phone || '-'}</span></div>
            <div className="flex items-center gap-2 text-gray-600"><Mail className="w-4 h-4" /><span dir="ltr">{supplier.email || '-'}</span></div>
            <div className="flex items-center gap-2 text-gray-600"><MapPin className="w-4 h-4" />{supplier.address || '-'}</div>
            <div className="text-gray-600">شروط الدفع: <span className="font-medium">{supplier.payment_terms === 'credit' ? 'آجل' : 'نقدي'}</span></div>
            <div className="text-gray-600">حد الائتمان: <span className="font-medium">{creditLimit > 0 ? formatCurrency(creditLimit) : 'بدون حد'}</span></div>
          </div>
          {supplier.notes && <p className="text-gray-600 text-sm mt-4">{supplier.notes}</p>}
        </div>
        <div className={`rounded-lg shadow-sm border p-6 ${balance > 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
          <p className="text-sm text-gray-600 mb-1">المديونية الحالية</p>
          <p className={`text-3xl font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(Math.abs(balance))}</p>
          <p className="text-sm mt-1 text-gray-600">
            {balance > 0 ? 'مستحق للمورد' : balance < 0 ? 'مدفوع زيادة' : 'لا يوجد مديونية'}
          </p>
          {creditLimit > 0 && (
            <p className="text-xs text-gray-500 mt-2">المتاح من حد الائتمان: {formatCurrency(roundMoney(Math.max(creditLimit - balance, 0)))}</p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {([
          ['orders', `أوامر الشراء (${orders.length})`],
          ['supplies', `التوريدات (${supplies.length})`],
          ['payments', `المدفوعات (${payments.length})`],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === key ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          {activeTab === 'orders' && (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">رقم الأمر</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">التاريخ</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الفرع</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">القيمة</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الدفع</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map(o => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/purchase/orders/${o.id}`} className="text-blue-600 hover:underline">{o.order_number}</Link>
                    </td>
                    <td className="px-4 py-3">{formatDate(o.order_date)}</td>
                    <td className="px-4 py-3">{o.branch?.name_ar || '-'}</td>
                    <td className="px-4 py-3">{formatCurrency(o.total_amount)}</td>
                    <td className="px-4 py-3">{o.payment_type === 'cash' ? 'كاش' : (paymentStatusLabels[o.payment_status || 'pending'] || o.payment_status)}</td>
                    <td className="px-4 py-3">{orderStatusLabels[o.status] || o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {activeTab === 'supplies' && (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">رقم التوريد</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">التاريخ</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الفرع</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">رقم الفاتورة</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الإجمالي</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">المدفوع</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {supplies.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{s.supply_number}</td>
                    <td className="px-4 py-3">{formatDate(s.invoice_date || s.created_at)}</td>
                    <td className="px-4 py-3">{s.branch?.name_ar || '-'}</td>
                    <td className="px-4 py-3">{s.invoice_number || '-'}</td>
                    <td className="px-4 py-3">{formatCurrency(s.total_amount)}</td>
                    <td className="px-4 py-3 text-green-600">
                      {formatCurrency(s.paid_amount || 0)}
                      {Number(s.returned_amount || 0) > 0 && (
                        <p className="text-xs text-orange-600">مرتجعات: {formatCurrency(s.returned_amount || 0)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">{paymentStatusLabels[supplyPaymentStatus(s)] || supplyPaymentStatus(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {activeTab === 'payments' && (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">رقم الدفعة</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">التاريخ</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">المبلغ</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">طريقة الدفع</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">رقم المرجع</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payments.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{p.payment_number}</td>
                    <td className="px-4 py-3">{formatDate(p.payment_date)}</td>
                    <td className="px-4 py-3 text-green-600">{formatCurrency(p.amount)}</td>
                    <td className="px-4 py-3">{paymentMethodLabels[p.payment_method] || p.payment_method}</td>
                    <td className="px-4 py-3">{p.reference_number || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{p.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {((activeTab === 'orders' && orders.length === 0) ||
          (activeTab === 'supplies' && supplies.length === 0) ||
          (activeTab === 'payments' && payments.length === 0)) && (
          <div className="text-center py-12 text-gray-500">لا توجد بيانات</div>
        )}
      </div>
      <p className="text-xs text-gray-400">دفعات أوامر الشراء تظهر في صفحة كل أمر وفي كشف الحساب</p>
    </div>
  )
}
