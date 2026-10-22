import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ordersService, OrderWithDetails } from '../../services/orders.service';
import { APP_TIME_ZONE } from '../../lib/dates';
import { toUserMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/utils';
import { orderStatusColor, orderStatusLabel, paymentMethodLabel } from './orderLabels';
import {
  ArrowRight,
  ShoppingCart,
  Building2,
  User,
  Clock,
  DollarSign,
  CreditCard,
  Edit,
  Package,
} from 'lucide-react';

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id) fetchOrder(id);
  }, [id]);

  const fetchOrder = async (orderId: string) => {
    const { data, error: fetchError } = await ordersService.getById(orderId);
    if (fetchError) setError(toUserMessage(fetchError, 'تعذر تحميل الأوردر'));
    setOrder(data);
    setLoading(false);
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

  const formatCurrency = (amount: number | null | undefined) => (Number(amount) || 0).toLocaleString('ar-EG') + ' ج.م';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="text-center py-12">
        <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <p className={error ? 'text-red-600' : 'text-gray-500'}>{error || 'الأوردر غير موجود'}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => navigate('/orders')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <ShoppingCart className="w-6 h-6 text-blue-600" />
              تفاصيل الأوردر
            </h1>
            <p className="text-gray-600 font-mono">{order.order_number}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {order.status !== 'cancelled' && (
            <Link to={`/orders/${id}/edit`} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <Edit className="w-4 h-4" />
              تعديل
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Status */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">حالة الأوردر</h2>
              <span className={`px-4 py-2 rounded-lg text-sm font-medium ${orderStatusColor(order.status)}`}>
                {orderStatusLabel(order.status)}
              </span>
            </div>
            {order.status === 'cancelled' && order.cancellation_reason && (
              <p className="mt-3 text-sm text-red-600">سبب الإلغاء: {order.cancellation_reason}</p>
            )}
          </div>

          {/* Order Items */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Package className="w-5 h-5 text-gray-500" />
              الأصناف
            </h2>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-right py-3 text-sm font-medium text-gray-700">الصنف</th>
                  <th className="text-center py-3 text-sm font-medium text-gray-700">الكمية</th>
                  <th className="text-right py-3 text-sm font-medium text-gray-700">السعر</th>
                  <th className="text-right py-3 text-sm font-medium text-gray-700">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {order.items?.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="py-3">
                      <p className="font-medium">{item.item?.name_ar ?? item.menu_item?.name_ar ?? '-'}</p>
                      {item.notes && <p className="text-sm text-gray-500">{item.notes}</p>}
                    </td>
                    <td className="py-3 text-center">{formatNumber(item.quantity)}</td>
                    <td className="py-3">{formatCurrency(item.unit_price)}</td>
                    <td className="py-3 font-medium">{formatCurrency(item.total_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Notes */}
          {(order.notes || order.kitchen_notes) && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">ملاحظات</h2>
              {order.notes && (
                <div className="mb-4">
                  <p className="text-sm text-gray-500 mb-1">ملاحظات عامة</p>
                  <p className="text-gray-700">{order.notes}</p>
                </div>
              )}
              {order.kitchen_notes && (
                <div>
                  <p className="text-sm text-gray-500 mb-1">ملاحظات المطبخ</p>
                  <p className="text-gray-700">{order.kitchen_notes}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Order Summary */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">ملخص الأوردر</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">المجموع الفرعي</span>
                <span>{formatCurrency(order.subtotal)}</span>
              </div>

              {Number(order.discount_amount) > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>الخصم{order.discount_reason ? ` (${order.discount_reason})` : ''}</span>
                  <span>-{formatCurrency(order.discount_amount)}</span>
                </div>
              )}
              <div className="border-t pt-3 flex justify-between font-bold text-lg">
                <span>الإجمالي</span>
                <span className="text-green-600">{formatCurrency(order.total_amount)}</span>
              </div>
              {order.payment_method === 'cash' && order.paid_amount != null && (
                <>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>المدفوع</span>
                    <span>{formatCurrency(order.paid_amount)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>الباقي</span>
                    <span>{formatCurrency(order.change_amount)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Order Info */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات الأوردر</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">الفرع</p>
                  <p className="font-medium">{order.branch?.name_ar || '-'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">الكاشير</p>
                  <p className="font-medium">{order.cashier?.full_name_ar || '-'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">طريقة الدفع</p>
                  <p className="font-medium">{paymentMethodLabel(order.payment_method)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">تاريخ الإنشاء</p>
                  <p className="font-medium">{formatDate(order.created_at)}</p>
                </div>
              </div>
              {order.paid_at && (
                <div className="flex items-center gap-3">
                  <DollarSign className="w-5 h-5 text-green-500" />
                  <div>
                    <p className="text-sm text-gray-500">تاريخ الدفع</p>
                    <p className="font-medium">{formatDate(order.paid_at)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
