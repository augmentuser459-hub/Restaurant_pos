import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { notificationsService, Notification } from '../../services/notifications.service'
import { toUserMessage } from '../../lib/errors'
import ChangePasswordModal from '../../pages/auth/ChangePasswordModal'
import { getUserRole } from './roleAccess'
import { Menu, Bell, User, LogOut, Info, ChevronDown, Check, CheckCheck, KeyRound } from 'lucide-react'

interface NavbarProps {
  onMenuClick: () => void
}

export default function Navbar({ onMenuClick }: NavbarProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  // The list holds only unread notifications (getUnread, realtime additions, minus the ones marked read)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const unreadCount = notifications.length
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [markingRead, setMarkingRead] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const notificationsRef = useRef<HTMLDivElement>(null)

  // Fetch notifications and subscribe to realtime updates
  useEffect(() => {
    if (user?.id) {
      fetchNotifications()

      // Realtime: only notifications this user sees in the bell (same rule as getUnread)
      // (the 30 s poll may already have loaded it, so it is added only once)
      const unsubscribe = notificationsService.subscribeToNew(user.id, user.branch_id, n => {
        setNotifications(prev => (prev.some(p => p.id === n.id) ? prev : [n, ...prev]))
      })

      // Also refresh every 30 seconds as backup
      const interval = setInterval(fetchNotifications, 30000)

      return () => {
        clearInterval(interval)
        unsubscribe()
      }
    }
  }, [user?.id, user?.branch_id])

  const fetchNotifications = async () => {
    if (!user?.id) return
    const { data, error } = await notificationsService.getUnread(user.id, user.branch_id || undefined)
    if (error) {
      // Background refresh (every 30 s): keep the last list instead of interrupting the user
      console.error('Failed to load notifications:', error)
      return
    }
    if (data) {
      setNotifications(data)
    }
  }

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleMarkAsRead = async (notificationId: string) => {
    if (markingRead) return
    setMarkingRead(true)
    try {
      const { error } = await notificationsService.markAsRead(notificationId)
      if (error) {
        alert(toUserMessage(error, 'تعذر تحديث الإشعار، حاول مرة أخرى'))
        return
      }
      setNotifications(prev => prev.filter(n => n.id !== notificationId))
    } finally {
      setMarkingRead(false)
    }
  }

  const handleMarkAllAsRead = async () => {
    if (!user?.id || markingRead) return
    setMarkingRead(true)
    try {
      const { error } = await notificationsService.markAllAsRead(user.id)
      if (error) {
        alert(toUserMessage(error, 'تعذر تحديث الإشعارات، حاول مرة أخرى'))
        return
      }
      setNotifications([])
    } finally {
      setMarkingRead(false)
    }
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'transfer': return '🔄'
      case 'return': return '↩️'
      case 'damage': return '⚠️'
      case 'low_stock': return '📦'
      case 'order': return '🛒'
      default: return '🔔'
    }
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    
    if (minutes < 1) return 'الآن'
    if (minutes < 60) return `منذ ${minutes} دقيقة`
    if (hours < 24) return `منذ ${hours} ساعة`
    return `منذ ${days} يوم`
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const getRoleLabel = (role: string) => {
    const roles: Record<string, string> = {
      admin: 'مدير النظام',
      warehouse_manager: 'مدير المخزن',
      branch_supervisor: 'مشرف الفرع',
      chef: 'شيف',
      cashier: 'كاشير',
      purchase_manager: 'مدير المشتريات',
    }
    return roles[role] || role
  }

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6">
      {/* Left side - Menu button */}
      <button
        type="button"
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
        title="فتح القائمة"
        aria-label="فتح القائمة"
      >
        <Menu className="w-6 h-6 text-gray-600" />
      </button>

      {/* Right side - Notifications and User menu */}
      <div className="flex items-center gap-4 mr-auto">
        {/* Notifications */}
        <div className="relative" ref={notificationsRef}>
          <button 
            type="button"
            onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
            className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
            title="الإشعارات"
            aria-label="الإشعارات"
          >
            <Bell className="w-5 h-5 text-gray-600" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 rounded-full text-white text-xs flex items-center justify-center px-1">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Notifications dropdown */}
          {isNotificationsOpen && (
            <div className="absolute left-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-96 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                <h3 className="font-semibold text-gray-900">الإشعارات</h3>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllAsRead}
                    disabled={markingRead}
                    className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 disabled:opacity-50"
                  >
                    <CheckCheck className="w-3 h-3" />
                    قراءة الكل
                  </button>
                )}
              </div>
              
              <div className="overflow-y-auto max-h-72">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-gray-500">
                    <Bell className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    <p>لا توجد إشعارات جديدة</p>
                  </div>
                ) : (
                  notifications.map(notification => (
                    <div
                      key={notification.id}
                      className={`px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                        notification.priority === 'high' || notification.type === 'low_stock' ? 'bg-red-50' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-lg">{getNotificationIcon(notification.type)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {notification.title}
                          </p>
                          <p className="text-xs text-gray-600 line-clamp-2">
                            {notification.message}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {formatTime(notification.created_at)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleMarkAsRead(notification.id)}
                          disabled={markingRead}
                          className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
                          title="تحديد كمقروء"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-100 transition-colors"
            title="قائمة المستخدم"
            aria-label="قائمة المستخدم"
            aria-expanded={isDropdownOpen}
            aria-haspopup="menu"
          >
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-white" />
            </div>
            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium text-gray-900">
                {user?.full_name_ar || user?.full_name || 'مستخدم'}
              </p>
              <p className="text-xs text-gray-500">
                {user ? getRoleLabel(getUserRole(user) || '') : ''}
              </p>
            </div>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown menu */}
          {isDropdownOpen && (
            <div className="absolute left-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-900">
                  {user?.full_name_ar || user?.full_name}
                </p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsDropdownOpen(false)
                  navigate('/about')
                }}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <Info className="w-4 h-4" />
                حول التطبيق
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsDropdownOpen(false)
                  setShowChangePassword(true)
                }}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <KeyRound className="w-4 h-4" />
                تغيير كلمة المرور
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                تسجيل الخروج
              </button>
            </div>
          )}
        </div>
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </header>
  )
}
