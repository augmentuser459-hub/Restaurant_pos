import { NavLink } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  LayoutDashboard,
  Building2,
  Users,
  Package,
  ArrowLeftRight,
  AlertTriangle,
  ShoppingCart,
  ChefHat,
  BarChart3,
  ClipboardList,
  ClipboardCheck,
  Truck,
  Undo2,
  UtensilsCrossed,
  X,
  CookingPot,
  Clock,
  Receipt,
  Store,
  FolderOpen,
} from 'lucide-react'
import { UserRole } from '../../types/database.types'
import { ACCESS, getUserRole } from './roleAccess'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

interface NavItem {
  name: string
  href: string
  icon: React.ElementType
  roles?: UserRole[]
}

// Link roles come from the same lists that guard the routes (roleAccess.ts). A few links are hidden from
// the admin on purpose (the admin reaches those pages another way); those lists are a subset of the route's.
const navigation: NavItem[] = [
  { name: 'لوحة التحكم', href: '/dashboard', icon: LayoutDashboard, roles: ACCESS.dashboard },
  { name: 'الفروع', href: '/branches', icon: Building2, roles: ACCESS.branches },
  { name: 'الموردين', href: '/suppliers', icon: Truck, roles: ACCESS.suppliers },
  { name: 'المخزون', href: '/inventory', icon: Package, roles: ACCESS.inventory },
  { name: 'المجموعات', href: '/categories', icon: FolderOpen, roles: ACCESS.categories },
  // The admin adds items from the inventory screen
  { name: 'إضافة صنف', href: '/inventory/items/new', icon: Package, roles: ['warehouse_manager'] },
  { name: 'الجرد اليومي', href: '/inventory/daily-count', icon: ClipboardCheck, roles: ACCESS.dailyCount },
  { name: 'الريسبيات', href: '/recipes', icon: CookingPot, roles: ACCESS.recipes },
  { name: 'التحويلات', href: '/transfers', icon: ArrowLeftRight, roles: ACCESS.stockMovements },
  { name: 'المرتجعات', href: '/returns', icon: Undo2, roles: ACCESS.stockMovements },
  { name: 'التالف', href: '/damages', icon: AlertTriangle, roles: ACCESS.stockMovements },
  { name: 'استهلاك الطباخ', href: '/inventory/chef-consumption', icon: UtensilsCrossed, roles: ACCESS.chefConsumption },
  // POS screens work on the signed-in user's branch, so they are listed only for cashiers / chefs
  { name: 'نقطة البيع', href: '/pos/cashier', icon: ShoppingCart, roles: ['cashier'] },
  { name: 'إدارة نقاط البيع', href: '/pos/management', icon: Store, roles: ACCESS.posManagement },
  { name: 'المطبخ', href: '/pos/kitchen', icon: ChefHat, roles: ['chef'] },
  { name: 'الأوردرات', href: '/orders', icon: Receipt, roles: ACCESS.orders },
  { name: 'الشيفتات', href: '/shifts', icon: Clock, roles: ACCESS.shifts },
  { name: 'التقارير', href: '/reports', icon: BarChart3, roles: ACCESS.reports },
  // Admin and warehouse manager open the statement from the reports page
  { name: 'كشف حساب المورد', href: '/reports/supplier-statement', icon: BarChart3, roles: ['purchase_manager'] },
  { name: 'طلبات الشراء', href: '/purchase', icon: ClipboardList, roles: ACCESS.purchase },
  { name: 'المستخدمين', href: '/users', icon: Users, roles: ACCESS.users },
]

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user } = useAuth()
  const userRole = getUserRole(user)

  const filteredNavigation = navigation.filter((item) => {
    if (!item.roles) return true
    return userRole !== null && item.roles.includes(userRole)
  })

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 right-0 h-full w-64 bg-gray-900 text-white z-50 transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-800">
          <h1 className="text-lg font-bold">نظام إدارة المطاعم</h1>
          <button
            type="button"
            onClick={onClose}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-800 transition-colors"
            title="إغلاق القائمة"
            aria-label="إغلاق القائمة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-1 overflow-y-auto h-[calc(100%-4rem)]">
          {filteredNavigation.map((item) => {
            // Use 'end' prop for routes that have sub-routes to prevent multiple active states
            const needsExactMatch = item.href === '/inventory' || item.href === '/pos/cashier' || item.href === '/dashboard'
            return (
              <NavLink
                key={item.href}
                to={item.href}
                end={needsExactMatch}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                <item.icon className="w-5 h-5" />
                <span>{item.name}</span>
              </NavLink>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
