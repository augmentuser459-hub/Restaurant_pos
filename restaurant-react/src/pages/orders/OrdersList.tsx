import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ordersService, OrderWithDetails } from '../../services/orders.service';
import { branchesService } from '../../services/branches.service';
import { Branch, OrderStatus } from '../../types/database.types';
import {
  ShoppingCart,
  Filter,
  Eye,
  Edit,
  Building2,
  DollarSign,
  Clock,
} from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  new: 'جديد',
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
  paid: 'bg-green-100 text-green-700',
  in_kitchen: 'bg-yellow-100 text-yellow-700',
  preparing: 'bg-orange-100 text-orange-700',
  ready: 'bg-purple-100 text-purple-700',
  delivered: 'bg-teal-100 text-teal-700',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function OrdersList() {
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    branchId: '',
    status: '' as OrderStatus | '',
    paymentMethod: '',
    startDate: '',
    endDate: '',
  });

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [filters]);

  const fetchBranches = async () => {
    const { data } = await branchesService.getAll();
    setBranches(data || []);
  };

  const fetchOrders = async () => {
    setLoading(true);
    const { data } = await ordersService.getAll(
      filters.branchId || undefined,
      filters.status || undefined
    );
    
    // Apply client-side filters for payment method and date
    let filteredData = data || [];
    
    if (filters.paymentMethod) {
      filteredData = filteredData.filter(order => order.payment_method === filters.paymentMethod);
    }
    
    if (filters.startDate) {
      filteredData = filteredData.filter(order => 
        new Date(order.created_at) >= new Date(filters.startDate)
      );
    }
    
    if (filters.endDate) {
      filteredData = filteredData.filter(order => 
        new Date(order.created_at) <= new Date(filters.endDate + 'T23:59:59')
      );
    }
    
    setOrders(filteredData);
    setLoading(false);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('ar-EG', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number) => {
    return (amount || 0).toLocaleString('ar-EG') + ' ج.م';
  };

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
            onChange={(e) => setFilters({ ...filters, branchId: e.target.value })}
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
            onChange={(e) => setFilters({ ...filters, status: e.target.value as OrderStatus | '' })}
            className="px-4 py-2 border border-gray-300 rounded-lg"
            aria-label="الحالة"
          >
            <option value="">كل الحالات</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <select
            value={filters.paymentMethod}
            onChange={(e) => setFilters({ ...filters, paymentMethod: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg"
            aria-label="طريقة الدفع"
          >
            <option value="">كل طرق الدفع</option>
            <option value="cash">كاش</option>
            <option value="visa">فيزا</option>
            <option value="instapay">إنستاباي</option>
            <option value="vodafone_cash">فودافون كاش</option>
          </select>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg"
            placeholder="من تاريخ"
            aria-label="من تاريخ"
          />
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg"
            placeholder="إلى تاريخ"
            aria-label="إلى تاريخ"
          />
        </div>
        <div className="mt-4">
          <button
            onClick={() => setFilters({ branchId: '', status: '', paymentMethod: '', startDate: '', endDate: '' })}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            إعادة تعيين الفلاتر
          </button>
        </div>
      </div>

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
                        {(order.branch as { name_ar?: string } | null)?.name_ar || '-'}
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
                      <span className={`px-2 py-1 text-xs rounded ${
                        order.payment_method === 'cash' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {order.payment_method === 'cash' ? 'كاش' : order.payment_method === 'visa' ? 'فيزا' : order.payment_method || '-'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 text-xs rounded ${STATUS_COLORS[order.status] || 'bg-gray-100'}`}>
                        {STATUS_LABELS[order.status] || order.status}
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
      </div>
    </div>
  );
}
