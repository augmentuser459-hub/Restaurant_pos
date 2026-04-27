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
  Settings,
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

const navigation: NavItem[] = [
  { name: 'لوحة التحكم', href: '/dashboard', icon: LayoutDashboard, roles: ['admin'] },
  { name: 'الفروع', href: '/branches', icon: Building2, roles: ['admin', 'warehouse_manager'] },
  { name: 'الموردين', href: '/suppliers', icon: Truck, roles: ['admin', 'purchase_manager'] },
  { name: 'المخزون', href: '/inventory', icon: Package, roles: ['admin'] },
  { name: 'المجموعات', href: '/categories', icon: FolderOpen, roles: ['admin'] },
  { name: 'إضافة صنف', href: '/inventory/items/new', icon: Package, roles: ['warehouse_manager'] },
  { name: 'الريسبيات', href: '/recipes', icon: CookingPot, roles: ['admin'] },
  { name: 'التحويلات', href: '/transfers', icon: ArrowLeftRight, roles: ['admin', 'warehouse_manager', 'branch_supervisor'] },
  { name: 'المرتجعات', href: '/returns', icon: Undo2, roles: ['admin', 'warehouse_manager', 'branch_supervisor'] },
  { name: 'التالف', href: '/damages', icon: AlertTriangle, roles: ['admin', 'warehouse_manager', 'branch_supervisor'] },
  { name: 'استهلاك الطباخ', href: '/inventory/chef-consumption', icon: UtensilsCrossed, roles: ['admin', 'warehouse_manager'] },
  { name: 'نقطة البيع', href: '/pos/cashier', icon: ShoppingCart, roles: ['cashier'] },
  { name: 'إدارة نقاط البيع', href: '/pos/management', icon: Store, roles: ['admin'] },
  { name: 'المطبخ', href: '/pos/kitchen', icon: ChefHat, roles: ['chef'] },
  { name: 'الأوردرات', href: '/orders', icon: Receipt, roles: ['admin'] },
  { name: 'الشيفتات', href: '/shifts', icon: Clock, roles: ['admin'] },
  { name: 'التقارير', href: '/reports', icon: BarChart3, roles: ['admin', 'warehouse_manager'] },
  { name: 'كشف حساب المورد', href: '/reports/supplier-statement', icon: BarChart3, roles: ['purchase_manager'] },
  { name: 'طلبات الشراء', href: '/purchase', icon: ClipboardList, roles: ['admin', 'purchase_manager', 'warehouse_manager'] },
  { name: 'المستخدمين', href: '/users', icon: Users, roles: ['admin'] },
]

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user } = useAuth()

  const filteredNavigation = navigation.filter((item) => {
    if (!item.roles) return true
    if (!user) return false
    // Handle role as object (from join) or string
    const userRole = typeof user.role === 'object' && user.role !== null 
      ? (user.role as { name: string }).name 
      : user.role
    return item.roles.includes(userRole as UserRole)
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
