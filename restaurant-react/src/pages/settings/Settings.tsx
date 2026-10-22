import { useAuth } from '../../contexts/AuthContext'
import { Settings as SettingsIcon, User, Building2, Bell, Shield, Palette } from 'lucide-react'
import { translations } from '../../lib/translations'
import { APP_VERSION } from './appInfo'

export default function Settings() {
  const { user } = useAuth()

  // user.role is the embedded roles row; older cached sessions may hold the plain role name
  const roleLabel = user?.role
    ? typeof user.role === 'object'
      ? user.role.name_ar || translations.roles[user.role.name] || user.role.name
      : translations.roles[user.role] || user.role
    : ''

  // These sections are not available yet: they are shown as "coming soon", not as clickable cards
  const settingsSections = [
    {
      title: 'الملف الشخصي',
      description: 'إدارة معلومات حسابك الشخصي',
      icon: User,
      color: 'blue',
    },
    {
      title: 'إعدادات الفرع',
      description: 'إعدادات الفرع الحالي',
      icon: Building2,
      color: 'green',
    },
    {
      title: 'الإشعارات',
      description: 'إدارة تفضيلات الإشعارات',
      icon: Bell,
      color: 'yellow',
    },
    {
      title: 'الأمان',
      description: 'إعدادات كلمة المرور والأمان',
      icon: Shield,
      color: 'red',
    },
    {
      title: 'المظهر',
      description: 'تخصيص مظهر التطبيق',
      icon: Palette,
      color: 'purple',
    },
  ]

  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    red: 'bg-red-100 text-red-600',
    purple: 'bg-purple-100 text-purple-600',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">الإعدادات</h1>
        <p className="text-gray-600">إدارة إعدادات النظام والحساب</p>
      </div>

      {/* User Info Card */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
            <User className="w-8 h-8 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">{user?.full_name_ar || user?.full_name}</h2>
            <p className="text-gray-600">{user?.email}</p>
            <p className="text-sm text-gray-500">
              {roleLabel}
              {user?.branch?.name_ar ? ` - ${user.branch.name_ar}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Settings Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {settingsSections.map((section) => {
          const Icon = section.icon
          return (
            <div
              key={section.title}
              className="bg-white rounded-lg shadow-sm border border-gray-100 p-6"
              aria-disabled="true"
            >
              <div className="flex items-start justify-between mb-4">
                <div className={`w-12 h-12 rounded-lg ${colorClasses[section.color]} flex items-center justify-center`}>
                  <Icon className="w-6 h-6" />
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-500">قريباً</span>
              </div>
              <h3 className="font-bold text-gray-900 mb-1">{section.title}</h3>
              <p className="text-sm text-gray-600">{section.description}</p>
            </div>
          )
        })}
      </div>

      {/* System Info */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-4">
          <SettingsIcon className="w-5 h-5 text-gray-400" />
          <h3 className="font-bold text-gray-900">معلومات النظام</h3>
        </div>
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">إصدار النظام:</span>
            <span className="mr-2 text-gray-900">{APP_VERSION}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
