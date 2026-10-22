import { UserRole } from '../../types/database.types'

// Which roles may open each part of the app. App.tsx guards every route with these lists and the Sidebar
// shows its links from the same lists, so a page is never reachable by URL for a role the menu hides it from.
// The admin may open everything. The database functions enforce the same rules on the server.
const access = {
  dashboard: ['admin'],
  branches: ['admin', 'warehouse_manager'],
  suppliers: ['admin', 'purchase_manager'],
  inventory: ['admin'], // stock list (/inventory, /inventory/stock), item list and item edit
  itemCreate: ['admin', 'warehouse_manager'],
  categories: ['admin'],
  branchStock: ['admin', 'warehouse_manager'],
  dailyCount: ['admin', 'warehouse_manager', 'branch_supervisor'],
  chefConsumption: ['admin', 'warehouse_manager'],
  stockMovements: ['admin', 'warehouse_manager', 'branch_supervisor'], // transfers, returns, damages
  recipes: ['admin'],
  posCashier: ['admin', 'cashier'],
  posKitchen: ['admin', 'chef'],
  posManagement: ['admin'],
  orders: ['admin'],
  shifts: ['admin'],
  reports: ['admin', 'warehouse_manager'],
  supplierStatement: ['admin', 'warehouse_manager', 'purchase_manager'],
  purchase: ['admin', 'purchase_manager', 'warehouse_manager'],
  users: ['admin'],
} satisfies Record<string, UserRole[]>

export const ACCESS: Record<keyof typeof access, UserRole[]> = access

/** The role name of a user object (the role is embedded as `role:roles(...)`; older code may hold a plain string). */
export function getUserRole(user: { role?: unknown } | null | undefined): UserRole | null {
  const role = user?.role
  if (role && typeof role === 'object') {
    return ((role as { name?: string }).name ?? null) as UserRole | null
  }
  return typeof role === 'string' ? (role as UserRole) : null
}
