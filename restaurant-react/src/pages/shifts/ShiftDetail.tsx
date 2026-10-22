import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { shiftsService, CashierShift, cashierName } from '../../services/shifts.service';
import { ordersService, OrderWithDetails, isPaidOrder } from '../../services/orders.service';
import { APP_TIME_ZONE } from '../../lib/dates';
import { formatNumber, roundMoney } from '../../lib/utils';
import { toUserMessage } from '../../lib/errors';
import { orderStatusColor, orderStatusLabel, paymentMethodColor, paymentMethodLabel } from '../orders/orderLabels';
import {
  ArrowRight,
  Clock,
  User,
  Building2,
  DollarSign,
  CreditCard,
  Banknote,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  RefreshCw,
} from 'lucide-react';

interface ShiftTotals {
  cash: number;
  visa: number;
  instapay: number;
  wallet: number;
  nonCash: number;
  total: number;
  count: number;
  /** false = old closed shift without a per-method breakdown */
  hasBreakdown: boolean;
}

// Same rule as the database: only paid, non-cancelled orders count.
function liveTotals(orders: OrderWithDetails[]): ShiftTotals {
  const paid = orders.filter(isPaidOrder);
  const sum = (method?: string) =>
    roundMoney(paid.filter(o => !method || o.payment_method === method).reduce((s, o) => s + (Number(o.total_amount) || 0), 0));
  const visa = sum('visa');
  const instapay = sum('instapay');
  const wallet = sum('wallet');
  return {
    cash: sum('cash'), visa, instapay, wallet,
    nonCash: roundMoney(visa + instapay + wallet),
    total: sum(),
    count: paid.length,
    hasBreakdown: true,
  };
}

function storedTotals(shift: CashierShift): ShiftTotals {
  return {
    cash: Number(shift.cash_sales) || 0,
    visa: Number(shift.visa_sales) || 0,
    instapay: Number(shift.instapay_sales) || 0,
    wallet: Number(shift.wallet_sales) || 0,
    nonCash: Number(shift.card_sales) || 0,
    total: Number(shift.total_sales) || 0,
    count: shift.orders_count || 0,
    hasBreakdown: shift.visa_sales != null,
  };
}

export default function ShiftDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [shift, setShift] = useState<CashierShift | null>(null);
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recalculating, setRecalculating] = useState(false);

  useEffect(() => {
    if (id) fetchData(id);
  }, [id]);

  const fetchData = async (shiftId: string) => {
    const [shiftRes, ordersRes] = await Promise.all([
      shiftsService.getShiftById(shiftId),
      ordersService.getByShift(shiftId),
    ]);
    const fetchError = shiftRes.error || ordersRes.error;
    setError(fetchError ? toUserMessage(fetchError, 'تعذر تحميل بيانات الشيفت') : '');
    setShift(shiftRes.data);
    setOrders(ordersRes.data || []);
    setLoading(false);
  };

  const handleRecalculate = async () => {
    if (!shift || recalculating) return;
    if (!confirm('سيتم إعادة حساب مبيعات هذا الشيفت والمبلغ المتوقع والفرق من أوردراته المدفوعة. هل تريد المتابعة؟')) return;
    setRecalculating(true);
    const { error: recalcError } = await shiftsService.recalculateShift(shift.id);
    if (recalcError) {
      alert(toUserMessage(recalcError, 'فشل في إعادة حساب الشيفت'));
    } else {
      await fetchData(shift.id);
      alert('تمت إعادة حساب الشيفت');
    }
    setRecalculating(false);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('ar-EG', {
      timeZone: APP_TIME_ZONE,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number | null | undefined) => {
    return (Number(amount) || 0).toLocaleString('ar-EG') + ' ج.م';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!shift) {
    return (
      <div className="text-center py-12">
        <p className={error ? 'text-red-600' : 'text-gray-500'}>{error || 'الشيفت غير موجود'}</p>
      </div>
    );
  }

  // An open shift has no stored totals yet: show what its paid orders add up to so far
  const isOpen = shift.status === 'open';
  const totals = isOpen ? liveTotals(orders) : storedTotals(shift);
  const unpaidCount = orders.filter(o => o.status === 'new' || o.status === 'pending_payment').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/shifts')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clock className="w-6 h-6 text-blue-600" />
            تفاصيل الشيفت
          </h1>
          <p className="text-gray-600 font-mono">{shift.shift_number}</p>
        </div>
        <span className={`mr-auto px-3 py-1 rounded-full text-sm ${
          isOpen ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
        }`}>
          {isOpen ? 'مفتوح' : 'مغلق'}
        </span>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Shift Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات الشيفت</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">الكاشير</p>
                  <p className="font-medium">{cashierName(shift.cashier)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">الفرع</p>
                  <p className="font-medium">{shift.branch?.name_ar || '-'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">وقت البداية</p>
                  <p className="font-medium">{formatDate(shift.start_time)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">وقت النهاية</p>
                  <p className="font-medium">{shift.end_time ? formatDate(shift.end_time) : '-'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Financial Summary */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                الملخص المالي{isOpen ? ' (حتى الآن)' : ''}
              </h2>
              {!isOpen && (
                <button
                  type="button"
                  onClick={handleRecalculate}
                  disabled={recalculating}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-50"
                  title="إعادة حساب الإجماليات من الأوردرات المدفوعة"
                >
                  <RefreshCw className={`w-4 h-4 ${recalculating ? 'animate-spin' : ''}`} />
                  إعادة احتساب الإجماليات
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-2 text-blue-600 mb-2">
                  <Banknote className="w-5 h-5" />
                  <span className="text-sm">المبلغ الافتتاحي</span>
                </div>
                <p className="text-xl font-bold text-blue-700">{formatCurrency(shift.opening_amount)}</p>
              </div>
              <div className="p-4 bg-green-50 rounded-lg">
                <div className="flex items-center gap-2 text-green-600 mb-2">
                  <DollarSign className="w-5 h-5" />
                  <span className="text-sm">مبيعات كاش</span>
                </div>
                <p className="text-xl font-bold text-green-700">{formatCurrency(totals.cash)}</p>
              </div>
              <div className="p-4 bg-purple-50 rounded-lg">
                <div className="flex items-center gap-2 text-purple-600 mb-2">
                  <CreditCard className="w-5 h-5" />
                  <span className="text-sm">مبيعات غير نقدية</span>
                </div>
                <p className="text-xl font-bold text-purple-700">{formatCurrency(totals.nonCash)}</p>
              </div>
              <div className="p-4 bg-orange-50 rounded-lg">
                <div className="flex items-center gap-2 text-orange-600 mb-2">
                  <ShoppingCart className="w-5 h-5" />
                  <span className="text-sm">عدد الأوردرات المدفوعة</span>
                </div>
                <p className="text-xl font-bold text-orange-700">{formatNumber(totals.count)}</p>
              </div>
            </div>

            {totals.hasBreakdown && (
              <div className="mt-4 grid grid-cols-3 gap-4">
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">دليفري</p>
                  <p className="font-bold">{formatCurrency(totals.visa)}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">إنستاباي</p>
                  <p className="font-bold">{formatCurrency(totals.instapay)}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500">محفظة</p>
                  <p className="font-bold">{formatCurrency(totals.wallet)}</p>
                </div>
              </div>
            )}

            {unpaidCount > 0 && (
              <p className="mt-4 text-sm text-orange-600">
                يوجد {formatNumber(unpaidCount)} أوردر غير مدفوع في هذا الشيفت، ولا يدخل في المبيعات.
              </p>
            )}

            {!isOpen && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">المبلغ المتوقع</p>
                    <p className="text-lg font-bold">{formatCurrency(shift.expected_amount)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">المبلغ الفعلي</p>
                    <p className="text-lg font-bold">{shift.closing_amount != null ? formatCurrency(shift.closing_amount) : '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">الفرق</p>
                    {shift.difference != null ? (
                      <p className={`text-lg font-bold flex items-center gap-1 ${
                        (Number(shift.difference) || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {(Number(shift.difference) || 0) >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                        {(Number(shift.difference) || 0) >= 0 ? '+' : ''}{formatCurrency(shift.difference)}
                      </p>
                    ) : <p className="text-lg font-bold">-</p>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Orders */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">أوردرات الشيفت ({formatNumber(orders.length)})</h2>
            {orders.length === 0 ? (
              <p className="text-gray-500 text-center py-4">لا توجد أوردرات</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-right py-2 px-2 text-sm font-medium text-gray-700">رقم الأوردر</th>
                      <th className="text-right py-2 px-2 text-sm font-medium text-gray-700">الوقت</th>
                      <th className="text-right py-2 px-2 text-sm font-medium text-gray-700">المبلغ</th>
                      <th className="text-right py-2 px-2 text-sm font-medium text-gray-700">الدفع</th>
                      <th className="text-right py-2 px-2 text-sm font-medium text-gray-700">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id} className="border-b border-gray-100">
                        <td className="py-2 px-2 font-mono text-sm">{order.order_number}</td>
                        <td className="py-2 px-2 text-sm">{new Date(order.created_at).toLocaleTimeString('ar-EG', { timeZone: APP_TIME_ZONE })}</td>
                        <td className="py-2 px-2 font-medium">{formatCurrency(order.total_amount)}</td>
                        <td className="py-2 px-2">
                          <span className={`px-2 py-1 text-xs rounded ${paymentMethodColor(order.payment_method)}`}>
                            {paymentMethodLabel(order.payment_method)}
                          </span>
                        </td>
                        <td className="py-2 px-2">
                          <span className={`px-2 py-1 text-xs rounded ${orderStatusColor(order.status)}`}>
                            {orderStatusLabel(order.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Side Stats */}
        <div className="space-y-6">
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-6 text-white">
            <h3 className="text-lg font-semibold mb-4">إجمالي المبيعات{isOpen ? ' (حتى الآن)' : ''}</h3>
            <p className="text-3xl font-bold">{formatCurrency(totals.total)}</p>
          </div>

          {shift.notes && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">ملاحظات</h3>
              <p className="text-gray-600">{shift.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
