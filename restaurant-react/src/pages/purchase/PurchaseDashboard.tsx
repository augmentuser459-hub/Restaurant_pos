import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { purchaseService } from '../../services/purchase.service'
import { formatNumber } from '../../lib/utils'
import { toUserMessage } from '../../lib/errors'
import { ShoppingCart, Clock, Plus, ArrowLeft, Package, ClipboardList, AlertCircle } from 'lucide-react'

interface Stats {
  totalOrders: number
  pendingOrders: number
  receivedOrders: number
  pendingRequests: number
}

export default function PurchaseDashboard() {
  const [stats, setStats] = useState<Stats>({
    totalOrders: 0,
    pendingOrders: 0,
    receivedOrders: 0,
    pendingRequests: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    // Counted in the database (no row cap)
    const { data, error } = await purchaseService.getCounts()
    if (error || !data) {
      setError(toUserMessage(error))
    } else {
      setStats(data)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">إدارة المشتريات</h1>
        <p className="text-gray-600">لوحة تحكم طلبات وأوامر الشراء</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="أوامر الشراء"
          value={formatNumber(stats.totalOrders)}
          icon={ShoppingCart}
          color="blue"
        />
        <StatCard
          title="أوامر معلقة"
          value={formatNumber(stats.pendingOrders)}
          icon={Clock}
          color="yellow"
        />
        <StatCard
          title="أوامر مستلمة"
          value={formatNumber(stats.receivedOrders)}
          icon={Package}
          color="green"
        />
        <StatCard
          title="طلبات شراء بانتظار الموافقة"
          value={formatNumber(stats.pendingRequests)}
          icon={ClipboardList}
          color="yellow"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Purchase orders */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">أوامر الشراء</h2>
            <Link
              to="/purchase/orders/new"
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              <Plus className="w-4 h-4" />
              أمر جديد
            </Link>
          </div>
          <p className="text-gray-600 mb-4">
            إنشاء ومتابعة واستلام أوامر الشراء من الموردين
          </p>
          <Link
            to="/purchase/orders"
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium"
          >
            عرض جميع الأوامر
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </div>

        {/* Purchase requests */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">طلبات الشراء</h2>
            <Link
              to="/purchase/requests/new"
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              <Plus className="w-4 h-4" />
              طلب جديد
            </Link>
          </div>
          <p className="text-gray-600 mb-4">
            طلبات الفروع والمخزن، اعتمادها أو رفضها وتحويلها إلى أوامر شراء
          </p>
          <Link
            to="/purchase/requests"
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium"
          >
            عرض جميع الطلبات
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}

interface StatCardProps {
  title: string
  value: string
  icon: React.ElementType
  color: 'blue' | 'yellow' | 'green'
}

function StatCard({ title, value, icon: Icon, color }: StatCardProps) {
  const colors = {
    blue: 'bg-blue-100 text-blue-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    green: 'bg-green-100 text-green-600',
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
      <div className={`w-10 h-10 rounded-lg ${colors[color]} flex items-center justify-center mb-3`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
    </div>
  )
}
