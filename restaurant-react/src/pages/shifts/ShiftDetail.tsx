import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { shiftsService, CashierShift } from '../../services/shifts.service';
import { ordersService, OrderWithDetails } from '../../services/orders.service';
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
} from 'lucide-react';

export default function ShiftDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [shift, setShift] = useState<CashierShift | null>(null);
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) fetchData(id);
  }, [id]);

  const fetchData = async (shiftId: string) => {
    const [shiftRes, ordersRes] = await Promise.all([
      shiftsService.getShiftById(shiftId),
      ordersService.getByShift(shiftId),
    ]);
    setShift(shiftRes.data);
    setOrders(ordersRes.data || []);
    setLoading(false);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number) => {
    return (amount || 0).toLocaleString('ar-EG') + ' ج.م';
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
        <p className="text-gray-500">الشيفت غير موجود</p>
      </div>
    );
  }

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
          shift.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
        }`}>
          {shift.status === 'open' ? 'مفتوح' : 'مغلق'}
        </span>
      </div>

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
                  <p className="font-medium">{shift.cashier?.full_name}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">الفرع</p>
                  <p className="font-medium">{shift.branch?.name_ar}</p>
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
            <h2 className="text-lg font-semibold text-gray-900 mb-4">الملخص المالي</h2>
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
                <p className="text-xl font-bold text-green-700">{formatCurrency(shift.cash_sales)}</p>
              </div>
              <div className="p-4 bg-purple-50 rounded-lg">
                <div className="flex items-center gap-2 text-purple-600 mb-2">
                  <CreditCard className="w-5 h-5" />
                  <span className="text-sm">مبيعات كارت</span>
                </div>
                <p className="text-xl font-bold text-purple-700">{formatCurrency(shift.card_sales)}</p>
              </div>
              <div className="p-4 bg-orange-50 rounded-lg">
                <div className="flex items-center gap-2 text-orange-600 mb-2">
                  <ShoppingCart className="w-5 h-5" />
                  <span className="text-sm">عدد الأوردرات</span>
                </div>
                <p className="text-xl font-bold text-orange-700">{shift.orders_count}</p>
              </div>
            </div>

            {shift.status === 'closed' && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">المبلغ المتوقع</p>
                    <p className="text-lg font-bold">{formatCurrency(shift.expected_amount || 0)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">المبلغ الفعلي</p>
                    <p className="text-lg font-bold">{formatCurrency(shift.closing_amount || 0)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">الفرق</p>
                    <p className={`text-lg font-bold flex items-center gap-1 ${
                      (shift.difference || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {(shift.difference || 0) >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                      {(shift.difference || 0) >= 0 ? '+' : ''}{formatCurrency(shift.difference || 0)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Orders */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">أوردرات الشيفت ({orders.length})</h2>
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
                        <td className="py-2 px-2 text-sm">{new Date(order.created_at).toLocaleTimeString('ar-EG')}</td>
                        <td className="py-2 px-2 font-medium">{formatCurrency(order.total_amount)}</td>
                        <td className="py-2 px-2">
                          <span className={`px-2 py-1 text-xs rounded ${
                            order.payment_method === 'cash' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                          }`}>
                            {order.payment_method === 'cash' ? 'كاش' : 'كارت'}
                          </span>
                        </td>
                        <td className="py-2 px-2">
                          <span className={`px-2 py-1 text-xs rounded ${
                            order.status === 'delivered' ? 'bg-green-100 text-green-700' :
                            order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {order.status}
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
            <h3 className="text-lg font-semibold mb-4">إجمالي المبيعات</h3>
            <p className="text-3xl font-bold">{formatCurrency(shift.total_sales)}</p>
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
