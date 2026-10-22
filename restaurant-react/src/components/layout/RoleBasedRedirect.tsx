import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getUserRole } from './roleAccess'

export default function RoleBasedRedirect() {
  const { user } = useAuth()

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Redirect based on role
  switch (getUserRole(user)) {
    case 'admin':
      return <Navigate to="/dashboard" replace />
    case 'chef':
      return <Navigate to="/pos/kitchen" replace />
    case 'cashier':
      return <Navigate to="/pos/cashier" replace />
    case 'branch_supervisor':
      return <Navigate to="/transfers" replace />
    case 'warehouse_manager':
      return <Navigate to="/transfers" replace />
    case 'purchase_manager':
      return <Navigate to="/purchase" replace />
    default:
      // A role without a home page (e.g. a role added in the database later): don't bounce to an admin page
      return (
        <div className="bg-white rounded-lg shadow-sm p-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">لا توجد صفحة متاحة</h1>
          <p className="text-gray-600">لم يتم تحديد صلاحيات لدورك الوظيفي، تواصل مع مدير النظام</p>
        </div>
      )
  }
}
