import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getUserRole } from '../../components/layout/roleAccess';
import { suppliersService } from '../../services/suppliers.service';
import { reportsService, SupplierStatementData, dateRangeError, monthsAgoLocal } from '../../services/reports.service';
import { todayLocal } from '../../lib/dates';
import { toUserMessage } from '../../lib/errors';
import { formatDate, formatCurrency } from '../../lib/utils';
import { Supplier } from '../../types/database.types';
import { ArrowRight, FileText, Printer, TrendingUp, TrendingDown, DollarSign, AlertCircle } from 'lucide-react';

interface StatementView extends SupplierStatementData {
  period: { from: string; to: string };
}

export default function SupplierStatement() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<string>(() => searchParams.get('supplier') || '');
  const [startDate, setStartDate] = useState(() => searchParams.get('from') || monthsAgoLocal(1));
  const [endDate, setEndDate] = useState(() => searchParams.get('to') || todayLocal());
  const [data, setData] = useState<StatementView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  // The purchase manager doesn't get the print button (role names are the English codes, see roleAccess)
  const isPurchaseManager = getUserRole(user) === 'purchase_manager';

  useEffect(() => {
    fetchSuppliers();
    // Opened from the supplier page / suppliers report: show the statement right away
    if (searchParams.get('supplier')) fetchStatement();
  }, []);

  const fetchSuppliers = async () => {
    const { data, error } = await suppliersService.getAll();
    if (error) setError(toUserMessage(error));
    setSuppliers(data || []);
  };

  // Opening balance, every movement with its running balance and the closing balance come from one database
  // ledger (same formula as the supplier list and the suppliers report).
  const fetchStatement = async () => {
    if (!selectedSupplier) return;
    const rangeError = dateRangeError(startDate, endDate);
    if (rangeError) {
      setData(null);
      setError(rangeError);
      return;
    }

    const id = ++requestId.current;
    const period = { from: startDate, to: endDate };
    setLoading(true);
    setError('');
    try {
      const { data: statement, error } = await reportsService.getSupplierStatement(selectedSupplier, period.from, period.to);
      if (id !== requestId.current) return;
      if (error || !statement) {
        setData(null);
        setError(toUserMessage(error));
      } else {
        setData({ ...statement, period });
      }
    } catch (err) {
      if (id !== requestId.current) return;
      setData(null);
      setError(toUserMessage(err));
    }
    setLoading(false);
  };

  const handlePrint = () => {
    // Hide headers and footers by using CSS
    const style = document.createElement('style');
    style.innerHTML = `
      @media print {
        @page { margin: 0; }
        body { margin: 1cm; }
      }
    `;
    document.head.appendChild(style);

    window.print();

    // Remove the style after printing
    setTimeout(() => {
      document.head.removeChild(style);
    }, 1000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <button
            onClick={() => window.history.back()}
            className="p-2 hover:bg-gray-100 rounded-lg"
            type="button"
            title="رجوع"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-6 h-6 text-green-600" />
              كشف حساب مورد
            </h1>
            <p className="text-gray-600">عرض تفاصيل حساب المورد</p>
          </div>
        </div>
        {data && !isPurchaseManager && (
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          >
            <Printer className="w-4 h-4" />
            طباعة
          </button>
        )}
      </div>

      {/* Print Header - Only visible when printing */}
      {data && (
        <div className="hidden print:block text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">كشف حساب مورد</h1>
          <p className="text-gray-600">نظام إدارة المطعم</p>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">المورد</label>
            <select
              value={selectedSupplier}
              onChange={(e) => setSelectedSupplier(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              aria-label="المورد"
            >
              <option value="">اختر المورد...</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name_ar}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">من تاريخ</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              aria-label="من تاريخ"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              aria-label="إلى تاريخ"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={fetchStatement}
              disabled={!selectedSupplier || loading}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'جاري التحميل...' : 'عرض الكشف'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 print:hidden">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Statement */}
      {data && (
        <div className="print:space-y-4">
          {/* Supplier Info */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{data.supplier.name_ar || data.supplier.name}</h2>
                <p className="text-gray-600">كود: {data.supplier.code}</p>
                {data.supplier.phone && <p className="text-gray-600">هاتف: {data.supplier.phone}</p>}
              </div>
              <div className="text-left">
                <p className="text-sm text-gray-500">الفترة</p>
                <p className="font-medium">{formatDate(data.period.from)} - {formatDate(data.period.to)}</p>
              </div>
            </div>

            {/* Summary Cards: opening + purchases + manual debts - payments - returns = amount due */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 print:gap-2">
              <div className="bg-gray-50 rounded-lg p-4 print:border print:border-gray-300 print:rounded-none">
                <div className="flex items-center gap-2 text-gray-600 mb-1">
                  <DollarSign className="w-4 h-4 print:hidden" />
                  <span className="text-sm">رصيد أول المدة</span>
                </div>
                <p className={`text-xl font-bold ${data.openingBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatCurrency(data.openingBalance)}
                </p>
              </div>
              <div className="bg-red-50 rounded-lg p-4 print:border print:border-gray-300 print:rounded-none">
                <div className="flex items-center gap-2 text-red-600 mb-1">
                  <TrendingUp className="w-4 h-4 print:hidden" />
                  <span className="text-sm">إجمالي المشتريات</span>
                </div>
                <p className="text-xl font-bold text-red-600">{formatCurrency(data.totalPurchases)}</p>
                <p className="text-xs text-gray-500 mt-1">المشتريات الآجلة بعد خصم الأوامر الملغاة</p>
                {data.manualDebtTotal !== 0 && (
                  <p className="text-xs text-gray-600 mt-1">+ مديونيات يدوية: {formatCurrency(data.manualDebtTotal)}</p>
                )}
              </div>
              <div className="bg-green-50 rounded-lg p-4 print:border print:border-gray-300 print:rounded-none">
                <div className="flex items-center gap-2 text-green-600 mb-1">
                  <TrendingDown className="w-4 h-4 print:hidden" />
                  <span className="text-sm">إجمالي المدفوعات</span>
                </div>
                <p className="text-xl font-bold text-green-600">{formatCurrency(data.totalPayments)}</p>
                {data.totalReturns !== 0 && (
                  <p className="text-xs text-gray-600 mt-1">+ مرتجعات للمورد: {formatCurrency(data.totalReturns)}</p>
                )}
              </div>
              <div className={`rounded-lg p-4 print:border print:border-gray-300 print:rounded-none ${data.closingBalance > 0 ? 'bg-red-100' : 'bg-green-100'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 print:hidden" />
                  <span className="text-sm">المبلغ المستحق</span>
                </div>
                <p className={`text-xl font-bold ${data.closingBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatCurrency(data.closingBalance)}
                </p>
                <p className="text-xs text-gray-500 mt-1">في {formatDate(data.period.to)}</p>
              </div>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden print:shadow-none print:border print:rounded-none">
            <div className="overflow-x-auto">
              <table className="w-full print:border-collapse">
                <thead className="bg-green-600 text-white print:bg-gray-200 print:text-black">
                  <tr>
                    <th className="px-4 py-3 text-right text-sm font-medium print:border print:border-gray-300">التاريخ</th>
                    <th className="px-4 py-3 text-right text-sm font-medium print:border print:border-gray-300">المرجع</th>
                    <th className="px-4 py-3 text-right text-sm font-medium print:border print:border-gray-300">البيان</th>
                    <th className="px-4 py-3 text-right text-sm font-medium print:border print:border-gray-300">مدين (له)</th>
                    <th className="px-4 py-3 text-right text-sm font-medium print:border print:border-gray-300">دائن (منه)</th>
                    <th className="px-4 py-3 text-right text-sm font-medium print:border print:border-gray-300">الرصيد</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {/* Opening Balance Row */}
                  <tr className="bg-gray-100 font-medium">
                    <td className="px-4 py-3 print:border print:border-gray-300">{formatDate(data.period.from)}</td>
                    <td className="px-4 py-3 print:border print:border-gray-300">-</td>
                    <td className="px-4 py-3 print:border print:border-gray-300">رصيد أول المدة</td>
                    <td className="px-4 py-3 print:border print:border-gray-300">-</td>
                    <td className="px-4 py-3 print:border print:border-gray-300">-</td>
                    <td className={`px-4 py-3 print:border print:border-gray-300 ${data.openingBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {formatCurrency(data.openingBalance)}
                    </td>
                  </tr>
                  {/* Transactions */}
                  {data.transactions.map((t, i) => (
                    <tr key={t.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 print:border print:border-gray-300">{formatDate(t.date)}</td>
                      <td className="px-4 py-3 font-mono text-sm print:border print:border-gray-300">{t.reference}</td>
                      <td className="px-4 py-3 print:border print:border-gray-300">
                        <span className={`inline-flex items-center gap-1 ${
                          t.type === 'supply' ? 'text-blue-600' :
                          t.type === 'payment' ? 'text-green-600' : 'text-orange-600'
                        }`}>
                          {t.description}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-red-600 print:border print:border-gray-300">{t.debit > 0 ? formatCurrency(t.debit) : '-'}</td>
                      <td className="px-4 py-3 text-green-600 print:border print:border-gray-300">{t.credit > 0 ? formatCurrency(t.credit) : '-'}</td>
                      <td className={`px-4 py-3 font-medium print:border print:border-gray-300 ${t.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatCurrency(t.balance)}
                      </td>
                    </tr>
                  ))}
                  {/* Closing Balance Row */}
                  <tr className="bg-gray-200 font-bold">
                    <td className="px-4 py-3 print:border print:border-gray-300" colSpan={3}>رصيد آخر المدة</td>
                    <td className="px-4 py-3 text-red-600 print:border print:border-gray-300">{formatCurrency(data.totalDebit)}</td>
                    <td className="px-4 py-3 text-green-600 print:border print:border-gray-300">{formatCurrency(data.totalCredit)}</td>
                    <td className={`px-4 py-3 print:border print:border-gray-300 ${data.closingBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {formatCurrency(data.closingBalance)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {data.transactions.length === 0 && (
              <div className="text-center py-12 text-gray-500 print:py-6">لا توجد حركات في هذه الفترة</div>
            )}
          </div>
        </div>
      )}

      {!data && !loading && !error && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-12 text-center">
          <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">اختر المورد والفترة ثم اضغط "عرض الكشف"</p>
        </div>
      )}
    </div>
  );
}
