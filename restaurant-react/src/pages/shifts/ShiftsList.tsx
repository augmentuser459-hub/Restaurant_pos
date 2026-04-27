import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { shiftsService, CashierShift } from '../../services/shifts.service';
import { branchesService } from '../../services/branches.service';
import { Branch } from '../../types/database.types';
import {
  Clock,
  DollarSign,
  User,
  Building2,
  Eye,
  Filter,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';

export default function ShiftsList() {
  const [shifts, setShifts] = useState<CashierShift[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    branchId: '',
    status: '',
    dateFrom: '',
    dateTo: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    fetchShifts();
  }, [filters]);

  const fetchData = async () => {
    const { data: branchesData } = await branchesService.getAll();
    setBranches(branchesData || []);
    await fetchShifts();
  };

  const fetchShifts = async () => {
    setLoading(true);
    const { data } = await shiftsService.getAllShifts({
      branchId: filters.branchId || undefined,
      status: filters.status || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
    });
    setShifts(data || []);
    setLoading(false);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number) => {
    return amount?.toLocaleString('ar-EG') + ' ج.م';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clock className="w-6 h-6 text-blue-600" />
            إدارة الشيفتات
          </h1>
          <p className="text-gray-600">عرض ومتابعة شيفتات الكاشير</p>
        </div>
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
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg"
            aria-label="الحالة"
          >
            <option value="">كل الحالات</option>
            <option value="open">مفتوح</option>
            <option value="closed">مغلق</option>
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
        </div>
      </div>

      {/* Shifts Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : shifts.length === 0 ? (
          <div className="text-center py-12">
            <Clock className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">لا توجد شيفتات</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">رقم الشيفت</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">الكاشير</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">الفرع</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">البداية</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">النهاية</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">المبيعات</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">الأوردرات</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">الفرق</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">الحالة</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((shift) => (
                  <tr key={shift.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-mono text-sm">{shift.shift_number}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400" />
                        {shift.cashier?.full_name || '-'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-gray-400" />
                        {shift.branch?.name_ar || '-'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm">{formatDate(shift.start_time)}</td>
                    <td className="py-3 px-4 text-sm">{shift.end_time ? formatDate(shift.end_time) : '-'}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1 text-green-600 font-medium">
                        <DollarSign className="w-4 h-4" />
                        {formatCurrency(shift.total_sales)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">{shift.orders_count}</td>
                    <td className="py-3 px-4">
                      {shift.status === 'closed' && (
                        <span className={`font-medium ${(shift.difference || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {(shift.difference || 0) >= 0 ? '+' : ''}{formatCurrency(shift.difference || 0)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {shift.status === 'open' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                          <AlertCircle className="w-3 h-3" />
                          مفتوح
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">
                          <CheckCircle className="w-3 h-3" />
                          مغلق
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        to={`/shifts/${shift.id}`}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg inline-flex"
                        title="عرض التفاصيل"
                      >
                        <Eye className="w-4 h-4" />
                      </Link>
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
