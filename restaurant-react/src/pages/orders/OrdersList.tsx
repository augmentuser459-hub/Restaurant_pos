import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ordersService, OrderWithDetails } from '../../services/orders.service';
import { branchesService } from '../../services/branches.service';
import { Branch, OrderStatus, OrderPaymentMethod } from '../../types/database.types';
import { APP_TIME_ZONE } from '../../lib/dates';
import { toUserMessage } from '../../lib/errors';
import {
  ORDER_STATUS_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  orderStatusColor,
  orderStatusLabel,
  paymentMethodColor,
  paymentMethodLabel,
} from './orderLabels';
import {
  ShoppingCart,
  Filter,
  Eye,
  Edit,
  Building2,
  DollarSign,
  Clock,
} from 'lucide-react';

const PAGE_SIZE = 50;

export default function OrdersList() {
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Kept apart from `error`, so loading the orders does not hide a failed branch list
  const [branchesError, setBranchesError] = useState('');
  const [filters, setFilters] = useState({
    branchId: '',
    status: '' as OrderStatus | '',
    paymentMethod: '' as OrderPaymentMethod | '',
    startDate: '',
    endDate: '',
  });
  // Only the newest request may update the table (filters can change faster than responses arrive)
  const requestId = useRef(0);

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [filters, page]);

  const fetchBranches = async () => {
    const { data, error: branchesError } = await branchesService.getAll();
    setBranchesError(branchesError ? toUserMessage(branchesError, 'تعذر تحميل الفروع') : '');
    setBranches(data || []);
  };

  const updateFilters = (next: Partial<typeof filters>) => {
    setPage(0);
    setFilters({ ...filters, ...next });
  };

  const fetchOrders = async () => {
    const current = ++requestId.current;
    setLoading(true);
    // All filters run in the database, so every matching order is reachable page by page
    const { data, count, error: ordersError } = await ordersService.getPage(
      {
        branchId: filters.branchId || undefined,
        status: filters.status || undefined,
        paymentMethod: filters.paymentMethod || undefined,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
      },
      page,
      PAGE_SIZE,
    );
    if (current !== requestId.current) return;

    if (ordersError) {
      setError(toUserMessage(ordersError, 'تعذر تحميل الأوردرات'));
      setOrders([]);
      setTotalCount(0);
    } else {
      setError('');
      setOrders(data);
      setTotalCount(count);
    }
    setLoading(false);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('ar-EG', {
      timeZone: APP_TIME_ZONE,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number) => {
    return (Number(amount) || 0).toLocaleString('ar-EG') + ' ج.م';
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const firstRow = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastRow = Math.min((page + 1) * PAGE_SIZE, totalCount);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-blue-600" />
            إدارة الأوردرات
          </h1>
          <p className="text-gray-600">عرض وتعديل جميع الأوردرات</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-gray-500" />
          <span className="font-medium">فلترة</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <select
            value={filters.branchId}
            onChange={(e) => updateFilters({ branchId: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg"
            aria-label="الفرع"
          >
            <option value="">كل الفروع</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name_ar}</option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(e) => updateFilters({ status: e.target.value as OrderStatus | '' })}
            className="px-4 py-2 border border-gray-300 rounded-lg"
            aria-label="الحالة"
          >
            <option value="">كل الحالات</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <select
            value={filters.paymentMethod}
            onChange={(e) => updateFilters({ paymentMethod: e.target.value as OrderPaymentMethod | '' })}
            className="px-4 py-2 border border-gray-300 rounded-lg"
            aria-label="طريقة الدفع"
          >
            <option value="">كل طرق الدفع</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>{PAYMENT_METHOD_LABELS[method]}</option>
            ))}
          </select>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => updateFilters({ startDate: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg"
            placeholder="من تاريخ"
            aria-label="من تاريخ"
          />
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => updateFilters({ endDate: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg"
            placeholder="إلى تاريخ"
            aria-label="إلى تاريخ"
          />
        </div>
        <div className="mt-4">
          <button
            onClick={() => updateFilters({ branchId: '', status: '', paymentMethod: '', startDate: '', endDate: '' })}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            إعادة تعيين الفلاتر
          </button>
        </div>
      </div>

      {branchesError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{branchesError}</div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
      )}

      {/* Orders Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12">
            <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">لا توجد أوردرات</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">رقم الأوردر</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">الفرع</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">التاريخ</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">المبلغ</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">الدفع</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">الحالة</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-mono text-sm">{order.order_number}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-gray-400" />
                        {order.branch?.name_ar || '-'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Clock className="w-4 h-4" />
                        {formatDate(order.created_at)}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1 font-medium text-green-600">
                        <DollarSign className="w-4 h-4" />
                        {formatCurrency(order.total_amount)}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 text-xs rounded ${paymentMethodColor(order.payment_method)}`}>
                        {paymentMethodLabel(order.payment_method)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 text-xs rounded ${orderStatusColor(order.status)}`}>
                        {orderStatusLabel(order.status)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/orders/${order.id}`}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                          title="عرض"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        <Link
                          to={`/orders/${order.id}/edit`}
                          className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg"
                          title="تعديل"
                        >
                          <Edit className="w-4 h-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && totalCount > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-gray-100">
            <div className="text-sm text-gray-600">
              عرض {firstRow.toLocaleString('ar-EG')} - {lastRow.toLocaleString('ar-EG')} من {totalCount.toLocaleString('ar-EG')} أوردر
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(page - 1)}
                disabled={page === 0}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                السابق
              </button>
              <span className="text-sm text-gray-600">
                صفحة {(page + 1).toLocaleString('ar-EG')} من {totalPages.toLocaleString('ar-EG')}
              </span>
              <button
                type="button"
                onClick={() => setPage(page + 1)}
                disabled={page + 1 >= totalPages}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
