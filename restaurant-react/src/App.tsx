import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import MainLayout from './components/layout/MainLayout'
import RoleBasedRedirect from './components/layout/RoleBasedRedirect'
import { ACCESS } from './components/layout/roleAccess'

// Auth (loaded up front: the first screen of every visit)
import Login from './pages/auth/Login'
import NotFound from './pages/auth/NotFound'

// Every page is its own chunk, downloaded the first time it is opened (MainLayout shows a spinner meanwhile),
// so a cashier or kitchen tablet doesn't download the admin, report and Excel pages.

// Dashboard
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'))

// Branches
const BranchList = lazy(() => import('./pages/branches/BranchList'))
const BranchForm = lazy(() => import('./pages/branches/BranchForm'))

// Suppliers
const SupplierList = lazy(() => import('./pages/suppliers/SupplierList'))
const SupplierDetail = lazy(() => import('./pages/suppliers/SupplierDetail'))
const SupplierForm = lazy(() => import('./pages/suppliers/SupplierForm'))
const SupplyForm = lazy(() => import('./pages/suppliers/SupplyForm'))
const PaymentForm = lazy(() => import('./pages/suppliers/PaymentForm'))

// Inventory
const ItemList = lazy(() => import('./pages/inventory/ItemList'))
const ItemForm = lazy(() => import('./pages/inventory/ItemForm'))
const CategoriesList = lazy(() => import('./pages/categories/CategoriesList'))
const CategoryForm = lazy(() => import('./pages/categories/CategoryForm'))
const StockList = lazy(() => import('./pages/inventory/StockList'))
const BranchStock = lazy(() => import('./pages/inventory/BranchStock'))
const DailyCountList = lazy(() => import('./pages/inventory/DailyCountList'))
const DailyCountForm = lazy(() => import('./pages/inventory/DailyCountForm'))
const DailyCountDetail = lazy(() => import('./pages/inventory/DailyCountDetail'))
const ChefConsumption = lazy(() => import('./pages/inventory/ChefConsumption'))
const ChefConsumptionForm = lazy(() => import('./pages/inventory/ChefConsumptionForm'))

// Transfers
const TransferList = lazy(() => import('./pages/transfers/TransferList'))
const TransferForm = lazy(() => import('./pages/transfers/TransferForm'))
const TransferDetail = lazy(() => import('./pages/transfers/TransferDetail'))

// Damages
const DamageList = lazy(() => import('./pages/damages/DamageList'))
const DamageForm = lazy(() => import('./pages/damages/DamageForm'))
const DamageDetail = lazy(() => import('./pages/damages/DamageDetail'))

// Returns
const ReturnsList = lazy(() => import('./pages/returns/ReturnsList'))
const SupplierReturnForm = lazy(() => import('./pages/returns/SupplierReturnForm'))
const BranchReturnForm = lazy(() => import('./pages/returns/BranchReturnForm'))
const SupplierReturnDetail = lazy(() => import('./pages/returns/SupplierReturnDetail'))
const BranchReturnDetail = lazy(() => import('./pages/returns/BranchReturnDetail'))

// POS
const POSCashier = lazy(() => import('./pages/pos/POSCashier'))
const POSKitchen = lazy(() => import('./pages/pos/POSKitchen'))
const POSManagement = lazy(() => import('./pages/pos/POSManagement'))

// Reports
const ReportsIndex = lazy(() => import('./pages/reports/ReportsIndex'))
const SalesReport = lazy(() => import('./pages/reports/SalesReport'))
const InventoryReport = lazy(() => import('./pages/reports/InventoryReport'))
const TransfersReport = lazy(() => import('./pages/reports/TransfersReport'))
const DamagesReport = lazy(() => import('./pages/reports/DamagesReport'))
const SuppliersReport = lazy(() => import('./pages/reports/SuppliersReport'))
const SupplierStatement = lazy(() => import('./pages/reports/SupplierStatement'))
const PerformanceReport = lazy(() => import('./pages/reports/PerformanceReport'))
const CashierReport = lazy(() => import('./pages/reports/CashierReport'))

// Purchase
const PurchaseDashboard = lazy(() => import('./pages/purchase/PurchaseDashboard'))
const PurchaseRequestList = lazy(() => import('./pages/purchase/PurchaseRequestList'))
const PurchaseRequestForm = lazy(() => import('./pages/purchase/PurchaseRequestForm'))
const PurchaseRequestDetail = lazy(() => import('./pages/purchase/PurchaseRequestDetail'))
const PurchaseOrderList = lazy(() => import('./pages/purchase/PurchaseOrderList'))
const PurchaseOrderForm = lazy(() => import('./pages/purchase/PurchaseOrderForm'))
const PurchaseOrderDetail = lazy(() => import('./pages/purchase/PurchaseOrderDetail'))

// Recipes
const RecipeList = lazy(() => import('./pages/recipes/RecipeList'))
const RecipeForm = lazy(() => import('./pages/recipes/RecipeForm'))
const RecipeDetail = lazy(() => import('./pages/recipes/RecipeDetail'))
const ProduceRecipe = lazy(() => import('./pages/recipes/ProduceRecipe'))
const RecipeImport = lazy(() => import('./pages/recipes/RecipeImport'))

// Orders
const OrdersList = lazy(() => import('./pages/orders/OrdersList'))
const OrderDetail = lazy(() => import('./pages/orders/OrderDetail'))
const OrderEdit = lazy(() => import('./pages/orders/OrderEdit'))

// Shifts
const ShiftsList = lazy(() => import('./pages/shifts/ShiftsList'))
const ShiftDetail = lazy(() => import('./pages/shifts/ShiftDetail'))

// Users
const UserList = lazy(() => import('./pages/users/UserList'))

// About
const About = lazy(() => import('./pages/settings/About'))

// Fallback for anything that suspends outside the main layout
const AppLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-100">
    <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
  </div>
)

function App() {
  // Always use root path for Cloudflare Pages
  const basename = '/'

  return (
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <Suspense fallback={<AppLoader />}>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />

            {/* Signed-in area. Every page is also guarded by role (lists in components/layout/roleAccess.ts,
                shared with the Sidebar); typing a URL the role may not open shows "غير مصرح". */}
            <Route
              element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<RoleBasedRedirect />} />
              <Route path="/about" element={<About />} />

              <Route element={<ProtectedRoute allowedRoles={ACCESS.dashboard} />}>
                <Route path="/dashboard" element={<Dashboard />} />
              </Route>

              {/* Branches */}
              <Route element={<ProtectedRoute allowedRoles={ACCESS.branches} />}>
                <Route path="/branches" element={<BranchList />} />
                <Route path="/branches/new" element={<BranchForm />} />
                <Route path="/branches/:id/edit" element={<BranchForm />} />
              </Route>

              {/* Suppliers */}
              <Route element={<ProtectedRoute allowedRoles={ACCESS.suppliers} />}>
                <Route path="/suppliers" element={<SupplierList />} />
                <Route path="/suppliers/new" element={<SupplierForm />} />
                <Route path="/suppliers/:id" element={<SupplierDetail />} />
                <Route path="/suppliers/:id/edit" element={<SupplierForm />} />
                <Route path="/suppliers/:supplierId/supply" element={<SupplyForm />} />
                <Route path="/supplies/new" element={<SupplyForm />} />
                <Route path="/suppliers/:supplierId/payment" element={<PaymentForm />} />
                <Route path="/payments/new" element={<PaymentForm />} />
              </Route>

              {/* Inventory (the stock list is the same admin screen at /inventory and /inventory/stock) */}
              <Route element={<ProtectedRoute allowedRoles={ACCESS.inventory} />}>
                <Route path="/inventory" element={<StockList />} />
                <Route path="/inventory/stock" element={<StockList />} />
                <Route path="/inventory/items" element={<ItemList />} />
                <Route path="/inventory/items/:id/edit" element={<ItemForm />} />
              </Route>
              <Route element={<ProtectedRoute allowedRoles={ACCESS.itemCreate} />}>
                <Route path="/inventory/items/new" element={<ItemForm />} />
              </Route>
              <Route element={<ProtectedRoute allowedRoles={ACCESS.branchStock} />}>
                <Route path="/inventory/branch" element={<BranchStock />} />
                <Route path="/inventory/branch/:branchId" element={<BranchStock />} />
              </Route>
              <Route element={<ProtectedRoute allowedRoles={ACCESS.dailyCount} />}>
                <Route path="/inventory/daily-count" element={<DailyCountList />} />
                <Route path="/inventory/daily-count/new" element={<DailyCountForm />} />
                <Route path="/inventory/daily-count/:id" element={<DailyCountDetail />} />
              </Route>
              <Route element={<ProtectedRoute allowedRoles={ACCESS.chefConsumption} />}>
                <Route path="/inventory/chef-consumption" element={<ChefConsumption />} />
                <Route path="/inventory/chef-consumption/new" element={<ChefConsumptionForm />} />
              </Route>

              {/* Categories */}
              <Route element={<ProtectedRoute allowedRoles={ACCESS.categories} />}>
                <Route path="/categories" element={<CategoriesList />} />
                <Route path="/categories/new" element={<CategoryForm />} />
                <Route path="/categories/:id/edit" element={<CategoryForm />} />
              </Route>

              {/* Transfers, damages, returns */}
              <Route element={<ProtectedRoute allowedRoles={ACCESS.stockMovements} />}>
                <Route path="/transfers" element={<TransferList />} />
                <Route path="/transfers/new" element={<TransferForm />} />
                <Route path="/transfers/:id" element={<TransferDetail />} />

                <Route path="/damages" element={<DamageList />} />
                <Route path="/damages/new" element={<DamageForm />} />
                <Route path="/damages/:id" element={<DamageDetail />} />

                <Route path="/returns" element={<ReturnsList />} />
                <Route path="/returns/supplier/new" element={<SupplierReturnForm />} />
                <Route path="/returns/supplier/:id" element={<SupplierReturnDetail />} />
                <Route path="/returns/branch/new" element={<BranchReturnForm />} />
                <Route path="/returns/branch/:id" element={<BranchReturnDetail />} />
              </Route>

              {/* Recipes */}
              <Route element={<ProtectedRoute allowedRoles={ACCESS.recipes} />}>
                <Route path="/recipes" element={<RecipeList />} />
                <Route path="/recipes/new" element={<RecipeForm />} />
                <Route path="/recipes/import" element={<RecipeImport />} />
                <Route path="/recipes/produce" element={<ProduceRecipe />} />
                <Route path="/recipes/:id" element={<RecipeDetail />} />
                <Route path="/recipes/:id/edit" element={<RecipeForm />} />
              </Route>

              {/* POS */}
              <Route element={<ProtectedRoute allowedRoles={ACCESS.posCashier} />}>
                <Route path="/pos/cashier" element={<POSCashier />} />
              </Route>
              <Route element={<ProtectedRoute allowedRoles={ACCESS.posKitchen} />}>
                <Route path="/pos/kitchen" element={<POSKitchen />} />
              </Route>
              <Route element={<ProtectedRoute allowedRoles={ACCESS.posManagement} />}>
                <Route path="/pos/management" element={<POSManagement />} />
              </Route>

              {/* Orders (Admin) */}
              <Route element={<ProtectedRoute allowedRoles={ACCESS.orders} />}>
                <Route path="/orders" element={<OrdersList />} />
                <Route path="/orders/:id" element={<OrderDetail />} />
                <Route path="/orders/:id/edit" element={<OrderEdit />} />
              </Route>

              {/* Shifts */}
              <Route element={<ProtectedRoute allowedRoles={ACCESS.shifts} />}>
                <Route path="/shifts" element={<ShiftsList />} />
                <Route path="/shifts/:id" element={<ShiftDetail />} />
              </Route>

              {/* Reports */}
              <Route element={<ProtectedRoute allowedRoles={ACCESS.reports} />}>
                <Route path="/reports" element={<ReportsIndex />} />
                <Route path="/reports/sales" element={<SalesReport />} />
                <Route path="/reports/inventory" element={<InventoryReport />} />
                <Route path="/reports/suppliers" element={<SuppliersReport />} />
                <Route path="/reports/transfers" element={<TransfersReport />} />
                <Route path="/reports/damages" element={<DamagesReport />} />
                <Route path="/reports/performance" element={<PerformanceReport />} />
                <Route path="/reports/cashier" element={<CashierReport />} />
              </Route>
              <Route element={<ProtectedRoute allowedRoles={ACCESS.supplierStatement} />}>
                <Route path="/reports/supplier-statement" element={<SupplierStatement />} />
              </Route>

              {/* Purchase */}
              <Route element={<ProtectedRoute allowedRoles={ACCESS.purchase} />}>
                <Route path="/purchase" element={<PurchaseDashboard />} />
                <Route path="/purchase/requests" element={<PurchaseRequestList />} />
                <Route path="/purchase/requests/new" element={<PurchaseRequestForm />} />
                <Route path="/purchase/requests/:id" element={<PurchaseRequestDetail />} />
                <Route path="/purchase/orders" element={<PurchaseOrderList />} />
                <Route path="/purchase/orders/new" element={<PurchaseOrderForm />} />
                <Route path="/purchase/orders/:id" element={<PurchaseOrderDetail />} />
              </Route>

              {/* Users: /users/new and /users/:id/edit open the add / edit form on the users screen */}
              <Route element={<ProtectedRoute allowedRoles={ACCESS.users} />}>
                <Route path="/users" element={<UserList />} />
                <Route path="/users/new" element={<UserList />} />
                <Route path="/users/:id/edit" element={<UserList />} />
              </Route>

              {/* Any other address (signed-out visitors are sent to the login page first) */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
