import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

export default function RoleBasedRedirect() {
  const { user } = useAuth()

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Handle role as object (from join) or string
  const userRole = typeof user.role === 'object' && user.role !== null
    ? (user.role as { name: string }).name
    : user.role

  // Redirect based on role
  switch (userRole) {
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
      return <Navigate to="/dashboard" replace />
  }
}
