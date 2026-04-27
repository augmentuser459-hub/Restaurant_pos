import { Link } from 'react-router-dom'
import { BarChart3, ShoppingCart, Package, Truck, AlertTriangle, ArrowLeftRight, TrendingUp, Users, FileText } from 'lucide-react'

const reports = [
  {
    title: 'تقرير المبيعات',
    description: 'عرض إجمالي المبيعات والإيرادات حسب الفترة',
    icon: ShoppingCart,
    href: '/reports/sales',
    color: 'blue',
  },
  {
    title: 'تقرير المخزون',
    description: 'عرض أرصدة المخزون والحركات',
    icon: Package,
    href: '/reports/inventory',
    color: 'purple',
  },
  {
    title: 'تقرير الموردين',
    description: 'عرض التوريدات والمدفوعات للموردين',
    icon: Truck,
    href: '/reports/suppliers',
    color: 'green',
  },
  {
    title: 'كشف حساب مورد',
    description: 'عرض كشف حساب تفصيلي لمورد معين',
    icon: FileText,
    href: '/reports/supplier-statement',
    color: 'emerald',
  },
  {
    title: 'تقرير التحويلات',
    description: 'عرض تحويلات المخزون بين الفروع',
    icon: ArrowLeftRight,
    href: '/reports/transfers',
    color: 'indigo',
  },
  {
    title: 'تقرير التالف',
    description: 'عرض سجلات التالف والهالك',
    icon: AlertTriangle,
    href: '/reports/damages',
    color: 'red',
  },
  {
    title: 'تقرير الأداء',
    description: 'عرض مؤشرات الأداء الرئيسية',
    icon: TrendingUp,
    href: '/reports/performance',
    color: 'yellow',
  },
  {
    title: 'تقرير الكاشير',
    description: 'عرض إيرادات ومبيعات كل كاشير',
    icon: Users,
    href: '/reports/cashier',
    color: 'teal',
  },
]

const colorClasses: Record<string, string> = {
  blue: 'bg-blue-100 text-blue-600',
  purple: 'bg-purple-100 text-purple-600',
  green: 'bg-green-100 text-green-600',
  emerald: 'bg-emerald-100 text-emerald-600',
  indigo: 'bg-indigo-100 text-indigo-600',
  red: 'bg-red-100 text-red-600',
  yellow: 'bg-yellow-100 text-yellow-600',
  teal: 'bg-teal-100 text-teal-600',
}

export default function ReportsIndex() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
          <BarChart3 className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">التقارير</h1>
          <p className="text-gray-600">عرض وتحليل بيانات النظام</p>
        </div>
      </div>

      {/* Reports Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.map(report => (
          <Link
            key={report.href}
            to={report.href}
            className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow"
          >
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${colorClasses[report.color]}`}>
              <report.icon className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">{report.title}</h3>
            <p className="text-sm text-gray-600">{report.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
