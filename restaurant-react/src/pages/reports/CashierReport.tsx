import { useState, useEffect } from 'react';
import { shiftsService } from '../../services/shifts.service';
import { branchesService } from '../../services/branches.service';
import { Branch } from '../../types/database.types';
import {
  Users,
  Filter,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Clock,
  ShoppingCart,
} from 'lucide-react';

interface CashierPerformance {
  cashier_id: string;
  cashier_name: string;
  total_sales: number;
  cash_sales: number;
  card_sales: number;
  orders_count: number;
  shifts_count: number;
  total_difference: number;
}

export default function CashierReport() {
  const [data, setData] = useState<CashierPerformance[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    branchId: '',
    dateFrom: '',
    dateTo: '',
  });

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchData();
  }, [filters]);

  const fetchBranches = async () => {
    const { data } = await branchesService.getAll();
    setBranches(data || []);
  };

  const fetchData = async () => {
    setLoading(true);
    const { data } = await shiftsService.getCashierPerformance(
      filters.branchId || undefined,
      filters.dateFrom || undefined,
      filters.dateTo || undefined
    );
    setData(data || []);
    setLoading(false);
  };

  const formatCurrency = (amount: number) => {
    return (amount || 0).toLocaleString('ar-EG') + ' ج.م';
  };

  const totals = data.reduce(
    (acc, item) => ({
      total_sales: acc.total_sales + item.total_sales,
      cash_sales: acc.cash_sales + item.cash_sales,
      card_sales: acc.card_sales + item.card_sales,
      orders_count: acc.orders_count + item.orders_count,
      shifts_count: acc.shifts_count + item.shifts_count,
      total_difference: acc.total_difference + item.total_difference,
    }),
    { total_sales: 0, cash_sales: 0, card_sales: 0, orders_count: 0, shifts_count: 0, total_difference: 0 }
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="w-6 h-6 text-blue-600" />
          تقرير أداء الكاشير
        </h1>
        <p className="text-gray-600">إيرادات ومبيعات كل كاشير</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-gray-500" />
          <span className="font-medium">فلترة</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg"
            aria-label="من تاريخ"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg"
            aria-label="إلى تاريخ"
          />
          <button
            onClick={() => setFilters({ branchId: '', dateFrom: '', dateTo: '' })}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            إعادة تعيين
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 text-green-600 mb-2">
            <DollarSign className="w-5 h-5" />
            <span className="text-sm">إجمالي المبيعات</span>
          </div>
          <p className="text-2xl font-bold text-green-700">{formatCurrency(totals.total_sales)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 text-blue-600 mb-2">
            <ShoppingCart className="w-5 h-5" />
            <span className="text-sm">إجمالي الأوردرات</span>
          </div>
          <p className="text-2xl font-bold text-blue-700">{totals.orders_count}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 text-purple-600 mb-2">
            <Clock className="w-5 h-5" />
            <span className="text-sm">إجمالي الشيفتات</span>
          </div>
          <p className="text-2xl font-bold text-purple-700">{totals.shifts_count}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
          <div className={`flex items-center gap-2 mb-2 ${totals.total_difference >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {totals.total_difference >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
            <span className="text-sm">إجمالي الفروقات</span>
          </div>
          <p className={`text-2xl font-bold ${totals.total_difference >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {totals.total_difference >= 0 ? '+' : ''}{formatCurrency(totals.total_difference)}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">لا توجد بيانات</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">الكاشير</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">الشيفتات</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">الأوردرات</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">مبيعات كاش</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">مبيعات كارت</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">إجمالي المبيعات</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">الفروقات</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item) => (
                  <tr key={item.cashier_id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium">{item.cashier_name}</td>
                    <td className="py-3 px-4">{item.shifts_count}</td>
                    <td className="py-3 px-4">{item.orders_count}</td>
                    <td className="py-3 px-4 text-green-600">{formatCurrency(item.cash_sales)}</td>
                    <td className="py-3 px-4 text-purple-600">{formatCurrency(item.card_sales)}</td>
                    <td className="py-3 px-4 font-bold text-blue-600">{formatCurrency(item.total_sales)}</td>
                    <td className="py-3 px-4">
                      <span className={`font-medium ${item.total_difference >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {item.total_difference >= 0 ? '+' : ''}{formatCurrency(item.total_difference)}
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
  );
}
