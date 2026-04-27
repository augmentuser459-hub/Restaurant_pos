import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { dashboardService, DashboardStats } from '../../services/dashboard.service'
import StatCard from '../../components/ui/StatCard'
import { formatCurrency } from '../../lib/utils'
import {
  Building2,
  Truck,
  Package,
  ShoppingCart,
  ArrowLeftRight,
  AlertTriangle,
  TrendingDown,
  ClipboardList,
} from 'lucide-react'

export default function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        // Handle role as object (from join) or string
        const userRole =
          typeof user?.role === 'object' && user?.role !== null
            ? (user.role as { name: string }).name
            : user?.role
        const branchId = userRole !== 'admin' ? user?.branch_id : undefined
        const { data, error: fetchError } = await dashboardService.getStats(branchId)
        if (fetchError) {
          setError(fetchError.message)
        } else {
          setStats(data)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'حدث خطأ')
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [user])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        خطأ: {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">لوحة التحكم</h1>
        <p className="text-gray-600">مرحباً {user?.full_name_ar || user?.full_name}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="الفروع"
          value={stats?.totalBranches || 0}
          icon={Building2}
          color="blue"
        />
        <StatCard
          title="الموردين"
          value={stats?.totalSuppliers || 0}
          icon={Truck}
          color="green"
        />
        <StatCard
          title="الأصناف"
          value={stats?.totalItems || 0}
          icon={Package}
          color="purple"
        />
        <StatCard
          title="إيرادات اليوم"
          value={formatCurrency(stats?.todayRevenue || 0)}
          icon={ShoppingCart}
          color="indigo"
        />
      </div>

      {/* Second Row Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="طلبات اليوم"
          value={stats?.todayOrders || 0}
          icon={ShoppingCart}
          color="blue"
        />
        <StatCard
          title="تحويلات معلقة"
          value={stats?.pendingTransfers || 0}
          icon={ArrowLeftRight}
          color="yellow"
        />
        <StatCard
          title="تالف معلق"
          value={stats?.pendingDamages || 0}
          icon={AlertTriangle}
          color="red"
        />
        <StatCard
          title="مخزون منخفض"
          value={stats?.lowStockItems || 0}
          icon={TrendingDown}
          color="red"
        />
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">إجراءات سريعة</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <QuickAction to="/pos/cashier" icon={ShoppingCart} label="نقطة البيع" color="blue" />
          <QuickAction to="/transfers/new" icon={ArrowLeftRight} label="تحويل جديد" color="green" />
          <QuickAction to="/damages/new" icon={AlertTriangle} label="تسجيل تالف" color="red" />
          <QuickAction to="/inventory" icon={Package} label="المخزون" color="purple" />
          <QuickAction to="/purchase" icon={ClipboardList} label="طلبات الشراء" color="indigo" />
          <QuickAction to="/reports" icon={Building2} label="التقارير" color="yellow" />
        </div>
      </div>
    </div>
  )
}

interface QuickActionProps {
  to: string
  icon: React.ElementType
  label: string
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'indigo'
}

const colorClasses = {
  blue: 'bg-blue-50 text-blue-600 hover:bg-blue-100',
  green: 'bg-green-50 text-green-600 hover:bg-green-100',
  yellow: 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100',
  red: 'bg-red-50 text-red-600 hover:bg-red-100',
  purple: 'bg-purple-50 text-purple-600 hover:bg-purple-100',
  indigo: 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100',
}

function QuickAction({ to, icon: Icon, label, color }: QuickActionProps) {
  return (
    <Link
      to={to}
      className={`flex flex-col items-center justify-center p-4 rounded-lg transition-colors ${colorClasses[color]}`}
    >
      <Icon className="w-6 h-6 mb-2" />
      <span className="text-sm font-medium">{label}</span>
    </Link>
  )
}
