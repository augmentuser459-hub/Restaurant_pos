import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import MainLayout from './components/layout/MainLayout'
import RoleBasedRedirect from './components/layout/RoleBasedRedirect'

// Auth
import Login from './pages/auth/Login'

// Dashboard
import Dashboard from './pages/dashboard/Dashboard'

// Branches
import BranchList from './pages/branches/BranchList'
import BranchForm from './pages/branches/BranchForm'

// Suppliers
import SupplierList from './pages/suppliers/SupplierList'
import SupplierForm from './pages/suppliers/SupplierForm'
import SupplyForm from './pages/suppliers/SupplyForm'
import PaymentForm from './pages/suppliers/PaymentForm'

// Inventory
import ItemList from './pages/inventory/ItemList'
import ItemForm from './pages/inventory/ItemForm'
import CategoriesList from './pages/categories/CategoriesList'
import CategoryForm from './pages/categories/CategoryForm'
import StockList from './pages/inventory/StockList'
import BranchStock from './pages/inventory/BranchStock'
import DailyCountList from './pages/inventory/DailyCountList'
import DailyCountForm from './pages/inventory/DailyCountForm'
import ChefConsumption from './pages/inventory/ChefConsumption'
import ChefConsumptionForm from './pages/inventory/ChefConsumptionForm'

// Transfers
import TransferList from './pages/transfers/TransferList'
import TransferForm from './pages/transfers/TransferForm'
import TransferDetail from './pages/transfers/TransferDetail'

// Damages
import DamageList from './pages/damages/DamageList'
import DamageForm from './pages/damages/DamageForm'
import DamageDetail from './pages/damages/DamageDetail'

// Returns
import ReturnsList from './pages/returns/ReturnsList'
import SupplierReturnForm from './pages/returns/SupplierReturnForm'
import BranchReturnForm from './pages/returns/BranchReturnForm'
import SupplierReturnDetail from './pages/returns/SupplierReturnDetail'
import BranchReturnDetail from './pages/returns/BranchReturnDetail'

// POS
import POSCashier from './pages/pos/POSCashier'
import POSKitchen from './pages/pos/POSKitchen'
import POSManagement from './pages/pos/POSManagement'

// Reports
import ReportsIndex from './pages/reports/ReportsIndex'
import SalesReport from './pages/reports/SalesReport'
import InventoryReport from './pages/reports/InventoryReport'
import TransfersReport from './pages/reports/TransfersReport'
import DamagesReport from './pages/reports/DamagesReport'
import SuppliersReport from './pages/reports/SuppliersReport'
import SupplierStatement from './pages/reports/SupplierStatement'
import PerformanceReport from './pages/reports/PerformanceReport'
import CashierReport from './pages/reports/CashierReport'

// Purchase
import PurchaseDashboard from './pages/purchase/PurchaseDashboard'
import PurchaseRequestList from './pages/purchase/PurchaseRequestList'
import PurchaseRequestForm from './pages/purchase/PurchaseRequestForm'
import PurchaseOrderList from './pages/purchase/PurchaseOrderList'
import PurchaseOrderForm from './pages/purchase/PurchaseOrderForm'
import PurchaseOrderDetail from './pages/purchase/PurchaseOrderDetail'

// Recipes
import RecipeList from './pages/recipes/RecipeList'
import RecipeForm from './pages/recipes/RecipeForm'
import RecipeDetail from './pages/recipes/RecipeDetail'
import ProduceRecipe from './pages/recipes/ProduceRecipe'
import RecipeImport from './pages/recipes/RecipeImport'

// Orders
import OrdersList from './pages/orders/OrdersList'
import OrderDetail from './pages/orders/OrderDetail'
import OrderEdit from './pages/orders/OrderEdit'

// Shifts
import ShiftsList from './pages/shifts/ShiftsList'
import ShiftDetail from './pages/shifts/ShiftDetail'

// Users
import UserList from './pages/users/UserList'

// About
import About from './pages/settings/About'

// Placeholder for routes not yet implemented
const PlaceholderPage = ({ title }: { title: string }) => (
  <div className="bg-white rounded-lg shadow-sm p-8 text-center">
    <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
    <p className="text-gray-600">هذه الصفحة قيد التطوير</p>
  </div>
)

function App() {
  // Always use root path for Cloudflare Pages
  const basename = '/'

  return (
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />

          {/* Protected routes */}
          <Route
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<RoleBasedRedirect />} />
            <Route path="/dashboard" element={<Dashboard />} />

            {/* Branches */}
            <Route path="/branches" element={<BranchList />} />
            <Route path="/branches/new" element={<BranchForm />} />
            <Route path="/branches/:id/edit" element={<BranchForm />} />

            {/* Suppliers */}
            <Route path="/suppliers" element={<SupplierList />} />
            <Route path="/suppliers/new" element={<SupplierForm />} />
            <Route path="/suppliers/:id" element={<PlaceholderPage title="تفاصيل المورد" />} />
            <Route path="/suppliers/:id/edit" element={<SupplierForm />} />
            <Route path="/suppliers/:supplierId/supply" element={<SupplyForm />} />
            <Route path="/supplies/new" element={<SupplyForm />} />
            <Route path="/suppliers/:supplierId/payment" element={<PaymentForm />} />
            <Route path="/payments/new" element={<PaymentForm />} />

            {/* Inventory */}
            <Route path="/inventory" element={<ProtectedRoute allowedRoles={['admin']}><StockList /></ProtectedRoute>} />
            <Route path="/inventory/items" element={<ProtectedRoute allowedRoles={['admin']}><ItemList /></ProtectedRoute>} />
            <Route path="/inventory/items/new" element={<ItemForm />} />
            <Route path="/inventory/items/:id/edit" element={<ProtectedRoute allowedRoles={['admin']}><ItemForm /></ProtectedRoute>} />
            
            {/* Categories */}
            <Route path="/categories" element={<ProtectedRoute allowedRoles={['admin']}><CategoriesList /></ProtectedRoute>} />
            <Route path="/categories/new" element={<ProtectedRoute allowedRoles={['admin']}><CategoryForm /></ProtectedRoute>} />
            <Route path="/categories/:id/edit" element={<ProtectedRoute allowedRoles={['admin']}><CategoryForm /></ProtectedRoute>} />
            
            <Route path="/inventory/stock" element={<StockList />} />
            <Route path="/inventory/branch" element={<BranchStock />} />
            <Route path="/inventory/branch/:branchId" element={<BranchStock />} />
            <Route path="/inventory/daily-count" element={<DailyCountList />} />
            <Route path="/inventory/daily-count/new" element={<DailyCountForm />} />
            <Route path="/inventory/daily-count/:id" element={<PlaceholderPage title="تفاصيل الجرد" />} />
            <Route path="/inventory/chef-consumption" element={<ChefConsumption />} />
            <Route path="/inventory/chef-consumption/new" element={<ChefConsumptionForm />} />

            {/* Transfers */}
            <Route path="/transfers" element={<TransferList />} />
            <Route path="/transfers/new" element={<TransferForm />} />
            <Route path="/transfers/:id" element={<TransferDetail />} />

            {/* Damages */}
            <Route path="/damages" element={<DamageList />} />
            <Route path="/damages/new" element={<DamageForm />} />
            <Route path="/damages/:id" element={<DamageDetail />} />

            {/* Returns */}
            <Route path="/returns" element={<ReturnsList />} />
            <Route path="/returns/supplier/new" element={<SupplierReturnForm />} />
            <Route path="/returns/supplier/:id" element={<SupplierReturnDetail />} />
            <Route path="/returns/branch/new" element={<BranchReturnForm />} />
            <Route path="/returns/branch/:id" element={<BranchReturnDetail />} />

            {/* Recipes */}
            <Route path="/recipes" element={<RecipeList />} />
            <Route path="/recipes/new" element={<RecipeForm />} />
            <Route path="/recipes/import" element={<RecipeImport />} />
            <Route path="/recipes/produce" element={<ProduceRecipe />} />
            <Route path="/recipes/:id" element={<RecipeDetail />} />
            <Route path="/recipes/:id/edit" element={<RecipeForm />} />

            {/* POS */}
            <Route path="/pos/cashier" element={<POSCashier />} />
            <Route path="/pos/kitchen" element={<POSKitchen />} />
            <Route path="/pos/management" element={<POSManagement />} />

            {/* Orders (Admin) */}
            <Route path="/orders" element={<OrdersList />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/orders/:id/edit" element={<OrderEdit />} />

            {/* Shifts */}
            <Route path="/shifts" element={<ShiftsList />} />
            <Route path="/shifts/:id" element={<ShiftDetail />} />

            {/* Reports */}
            <Route path="/reports" element={<ReportsIndex />} />
            <Route path="/reports/sales" element={<SalesReport />} />
            <Route path="/reports/inventory" element={<InventoryReport />} />
            <Route path="/reports/suppliers" element={<SuppliersReport />} />
            <Route path="/reports/supplier-statement" element={<SupplierStatement />} />
            <Route path="/reports/transfers" element={<TransfersReport />} />
            <Route path="/reports/damages" element={<DamagesReport />} />
            <Route path="/reports/performance" element={<PerformanceReport />} />
            <Route path="/reports/cashier" element={<CashierReport />} />

            {/* Purchase */}
            <Route path="/purchase" element={<PurchaseDashboard />} />
            <Route path="/purchase/requests" element={<PurchaseRequestList />} />
            <Route path="/purchase/requests/new" element={<PurchaseRequestForm />} />
            <Route path="/purchase/requests/:id" element={<PlaceholderPage title="تفاصيل طلب الشراء" />} />
            <Route path="/purchase/orders" element={<PurchaseOrderList />} />
            <Route path="/purchase/orders/new" element={<PurchaseOrderForm />} />
            <Route path="/purchase/orders/:id" element={<PurchaseOrderDetail />} />

            {/* Users */}
            <Route path="/users" element={<UserList />} />
            <Route path="/users/new" element={<PlaceholderPage title="مستخدم جديد" />} />
            <Route path="/users/:id/edit" element={<PlaceholderPage title="تعديل المستخدم" />} />

            {/* About */}
            <Route path="/about" element={<About />} />

            {/* Catch all inside protected area - redirect to dashboard */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>

          {/* Public catch-all - redirect to login */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
