import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ordersService, OrderWithDetails } from '../../services/orders.service';
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

const STATUS_LABELS: Record<string, string> = {
  new: 'جديد',
  pending_payment: 'في انتظار الدفع',
  paid: 'مدفوع',
  in_kitchen: 'في المطبخ',
  preparing: 'قيد التحضير',
  ready: 'جاهز',
  delivered: 'تم التسليم',
  completed: 'مكتمل',
  cancelled: 'ملغي',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  pending_payment: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-green-100 text-green-700',
  in_kitchen: 'bg-orange-100 text-orange-700',
  preparing: 'bg-purple-100 text-purple-700',
  ready: 'bg-teal-100 text-teal-700',
  delivered: 'bg-gray-100 text-gray-700',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderWithDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) fetchOrder(id);
  }, [id]);

  const fetchOrder = async (orderId: string) => {
    const { data } = await ordersService.getById(orderId);
    setOrder(data);
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

  const formatCurrency = (amount: number) => (amount || 0).toLocaleString('ar-EG') + ' ج.م';

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
        <p className="text-gray-500">الأوردر غير موجود</p>
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
          <Link to={`/orders/${id}/edit`} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Edit className="w-4 h-4" />
            تعديل
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Status */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">حالة الأوردر</h2>
              <span className={`px-4 py-2 rounded-lg text-sm font-medium ${STATUS_COLORS[order.status] || 'bg-gray-100'}`}>
                {STATUS_LABELS[order.status] || order.status}
              </span>
            </div>
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
                {order.items?.map((item, index) => (
                  <tr key={index} className="border-b border-gray-100">
                    <td className="py-3">
                      <p className="font-medium">{item.menu_item?.name_ar || '-'}</p>
                      {item.notes && <p className="text-sm text-gray-500">{item.notes}</p>}
                    </td>
                    <td className="py-3 text-center">{item.quantity}</td>
                    <td className="py-3">{formatCurrency(item.unit_price)}</td>
                    <td className="py-3 font-medium">{formatCurrency(item.total_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Notes */}
          {(order.notes || (order as unknown as Record<string, string>).kitchen_notes) && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">ملاحظات</h2>
              {order.notes && (
                <div className="mb-4">
                  <p className="text-sm text-gray-500 mb-1">ملاحظات عامة</p>
                  <p className="text-gray-700">{order.notes}</p>
                </div>
              )}
              {(order as unknown as Record<string, string>).kitchen_notes && (
                <div>
                  <p className="text-sm text-gray-500 mb-1">ملاحظات المطبخ</p>
                  <p className="text-gray-700">{(order as unknown as Record<string, string>).kitchen_notes}</p>
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

              {order.discount_amount > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>الخصم</span>
                  <span>-{formatCurrency(order.discount_amount)}</span>
                </div>
              )}
              <div className="border-t pt-3 flex justify-between font-bold text-lg">
                <span>الإجمالي</span>
                <span className="text-green-600">{formatCurrency(order.total_amount)}</span>
              </div>
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
                  <p className="font-medium">
                    {order.payment_method === 'cash' ? 'كاش' : 
                     order.payment_method === 'visa' ? 'فيزا' : 
                     order.payment_method || '-'}
                  </p>
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
