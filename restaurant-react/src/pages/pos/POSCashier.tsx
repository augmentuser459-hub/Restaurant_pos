import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { ordersService } from '../../services/orders.service'
import { posManagementService } from '../../services/posManagement.service'
import { shiftsService, CashierShift } from '../../services/shifts.service'
import { useCart } from '../../hooks/useCart'
import { MenuItem, MenuCategory, OrderPaymentMethod } from '../../types/database.types'
import { formatCurrency } from '../../lib/utils'
import { ShoppingCart, Plus, Minus, Trash2, CreditCard, Banknote, Smartphone, Wallet, X, Printer, Play, Square, Clock, DollarSign, Search, Package, ChefHat } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface Category {
  id: string
  name: string
  name_ar: string
  code: string
}

export default function POSCashier() {
  const { user } = useAuth()
  const cart = useCart()
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'items' | 'recipes'>('items')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [paidAmount, setPaidAmount] = useState<string>('')
  const [lastOrder, setLastOrder] = useState<{ orderNumber: string; items: typeof cart.items; total: number; paid: number; change: number } | null>(null)
  const changeAmount = paidAmount ? parseFloat(paidAmount) - cart.total : 0

  // Shift state
  const [currentShift, setCurrentShift] = useState<CashierShift | null>(null)
  const [showStartShift, setShowStartShift] = useState(false)
  const [showEndShift, setShowEndShift] = useState(false)
  const [openingAmount, setOpeningAmount] = useState<string>('0')
  const [closingAmount, setClosingAmount] = useState<string>('')
  const [shiftNotes, setShiftNotes] = useState('')

  useEffect(() => {
    fetchData()
    checkOpenShift()
  }, [])

  const fetchData = async () => {
    // Get POS items from inventory
    if (user?.branch_id) {
      const { data } = await posManagementService.getPOSItemsForCashier(user.branch_id)
      if (data) {
        // Transform to MenuItem format with stock info
        const items = data.map((posItem: any) => ({
          id: posItem.item_id,
          code: posItem.item?.code || '',
          barcode: posItem.item?.barcode || '',
          name: posItem.item?.name || '',
          name_ar: posItem.item?.name_ar || '',
          price: parseFloat(posItem.price) || 0,
          is_available: posItem.is_available && posItem.in_stock,
          image_url: posItem.item?.image_url,
          category_id: posItem.item?.category_id || null,
          stock_quantity: parseFloat(posItem.stock_quantity) || 0,
          in_stock: posItem.in_stock,
          is_recipe: posItem.item?.is_recipe || false
        }))
        setMenuItems(items)
      }
      
      // Fetch categories accessible by this cashier
      if (user?.id) {
        const { data: categoriesData } = await supabase.rpc('get_cashier_categories', {
          p_user_id: user.id
        })
        
        if (categoriesData) {
          setCategories(categoriesData)
        }
      }
    }
    
    setLoading(false)
  }

  // Add item to cart with stock validation
  const handleAddToCart = (item: MenuItem) => {
    const stockQty = (item as any).stock_quantity || 0
    const isRecipe = (item as any).is_recipe || false
    
    // Recipes don't need stock validation (they're produced on demand)
    if (isRecipe) {
      cart.addItem(item)
      return
    }
    
    // Check current quantity in cart
    const cartItem = cart.items.find(ci => ci.item.id === item.id)
    const currentCartQty = cartItem ? cartItem.quantity : 0
    
    // Prevent adding if it would exceed stock
    if (currentCartQty >= stockQty) {
      alert(`لا يمكن إضافة المزيد. الكمية المتاحة: ${stockQty.toFixed(2)}`)
      return
    }
    
    cart.addItem(item)
  }

  // Update quantity with stock validation
  const handleUpdateQuantity = (itemId: string, newQuantity: number) => {
    const cartItem = cart.items.find(ci => ci.id === itemId)
    if (!cartItem) return
    
    const menuItem = menuItems.find(mi => mi.id === cartItem.item.id)
    if (!menuItem) return
    
    const stockQty = (menuItem as any).stock_quantity || 0
    const isRecipe = (menuItem as any).is_recipe || false
    
    // Recipes don't need stock validation
    if (!isRecipe && newQuantity > stockQty) {
      alert(`الكمية المتاحة فقط: ${stockQty.toFixed(2)}`)
      return
    }
    
    cart.updateQuantity(itemId, newQuantity)
  }

  const checkOpenShift = async () => {
    if (!user?.id || !user?.branch_id) return
    const { data } = await shiftsService.getOpenShift(user.id, user.branch_id)
    setCurrentShift(data)
  }

  const handleStartShift = async () => {
    if (!user?.id || !user?.branch_id) return
    setProcessing(true)
    const { data, error } = await shiftsService.startShift(user.id, user.branch_id, parseFloat(openingAmount) || 0)
    if (error) {
      alert('فشل في بدء الشيفت')
    } else {
      setCurrentShift(data)
      setShowStartShift(false)
      setOpeningAmount('0')
    }
    setProcessing(false)
  }

  const handleEndShift = async () => {
    if (!currentShift || !user?.id) return
    setProcessing(true)
    const { error } = await shiftsService.closeShift(
      currentShift.id,
      parseFloat(closingAmount) || 0,
      user.id,
      shiftNotes || undefined
    )
    if (error) {
      alert('فشل في إنهاء الشيفت')
    } else {
      alert('تم إنهاء الشيفت بنجاح')
      setCurrentShift(null)
      setShowEndShift(false)
      setClosingAmount('')
      setShiftNotes('')
    }
    setProcessing(false)
  }

  const formatShiftTime = (time: string) => {
    return new Date(time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
  }

  const filteredItems = menuItems.filter(item => {
    // Filter by view mode (items vs recipes)
    if (viewMode === 'items' && item.is_recipe) return false
    if (viewMode === 'recipes' && !item.is_recipe) return false
    
    // Filter by search term (including barcode) - BYPASSES category filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      return (
        item.name_ar?.toLowerCase().includes(term) ||
        item.name?.toLowerCase().includes(term) ||
        item.code?.toLowerCase().includes(term) ||
        (item as any).barcode?.toLowerCase().includes(term)
      )
    }
    
    // Filter by category if selected
    if (selectedCategory) {
      return item.category_id === selectedCategory
    }
    
    // If no category selected and categories exist, only show items that belong to accessible categories
    // Items without category are hidden unless "الكل" is selected
    if (!selectedCategory && categories.length > 0) {
      return item.category_id && categories.some(cat => cat.id === item.category_id)
    }
    
    return true
  })

  // Print receipt function
  const printReceipt = (orderNumber: string, items: typeof cart.items, total: number, paid: number) => {
    const change = paid - total
    const now = new Date()
    const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`
    const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
    
    const receiptContent = `
      <html dir="rtl">
      <head>
        <title>فاتورة - ${orderNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 300px; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 20px; }
          .header h1 { margin: 0; font-size: 18px; }
          .header p { margin: 5px 0; font-size: 12px; color: #666; }
          .divider { border-top: 1px dashed #000; margin: 10px 0; }
          .items { margin: 10px 0; }
          .item { display: flex; justify-content: space-between; margin: 5px 0; font-size: 14px; }
          .item-name { flex: 1; }
          .item-qty { width: 30px; text-align: center; }
          .item-price { width: 70px; text-align: left; }
          .totals { margin-top: 10px; }
          .total-row { display: flex; justify-content: space-between; margin: 5px 0; font-size: 14px; }
          .total-row.grand { font-weight: bold; font-size: 16px; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>فاتورة مبيعات</h1>
          <p>رقم الطلب: ${orderNumber}</p>
          <p>${dateStr} - ${timeStr}</p>
        </div>
        <div class="divider"></div>
        <div class="items">
          ${items.map(item => `
            <div class="item">
              <span class="item-name">${item.item.name_ar}</span>
              <span class="item-qty">x${item.quantity}</span>
              <span class="item-price">${(item.item.price * item.quantity).toFixed(2)} ج.م</span>
            </div>
          `).join('')}
        </div>
        <div class="divider"></div>
        <div class="totals">
          <div class="total-row grand">
            <span>الإجمالي</span>
            <span>${total.toFixed(2)} ج.م</span>
          </div>
          <div class="total-row">
            <span>المدفوع</span>
            <span>${paid.toFixed(2)} ج.م</span>
          </div>
          <div class="total-row">
            <span>الباقي</span>
            <span>${change.toFixed(2)} ج.م</span>
          </div>
        </div>
        <div class="divider"></div>
        <div class="footer">
          <p>شكراً لزيارتكم</p>
        </div>
        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `
    
    const printWindow = window.open('', '_blank', 'width=400,height=600')
    if (printWindow) {
      printWindow.document.write(receiptContent)
      printWindow.document.close()
    }
  }

  // Print last order
  const handlePrintLastOrder = () => {
    if (lastOrder) {
      printReceipt(lastOrder.orderNumber, lastOrder.items, lastOrder.total, lastOrder.paid)
    }
  }

  const handlePayment = async (method: OrderPaymentMethod) => {
    if (!user?.branch_id || cart.items.length === 0) return

    setProcessing(true)
    
    console.log('Creating order with data:', {
      branch_id: user.branch_id,
      cashier_id: user.id,
      shift_id: currentShift?.id,
      items: cart.items
    })
    
    // Create order with shift
    const { data: order, error } = await ordersService.createWithShift({
      branch_id: user.branch_id,
      cashier_id: user.id,
      shift_id: currentShift?.id,
      items: cart.items.map(item => ({
        item_id: item.item.id,
        quantity: item.quantity,
        unit_price: item.item.price,
        notes: item.notes,
      })),
    })

    console.log('Order creation result:', { order, error })

    if (error || !order) {
      console.error('Order creation failed:', error)
      alert('فشل في إنشاء الطلب: ' + (error?.message || 'خطأ غير معروف'))
      setProcessing(false)
      return
    }

    // Process payment
    const { error: paymentError } = await ordersService.processPayment(order.id, method)
    
    if (paymentError) {
      alert('فشل في معالجة الدفع')
    } else {
      // Save order info for printing
      const paid = parseFloat(paidAmount) || cart.total
      setLastOrder({
        orderNumber: order.order_number,
        items: [...cart.items],
        total: cart.total,
        paid: paid,
        change: paid - cart.total,
      })
      cart.clearCart()
      setShowPayment(false)
      setPaidAmount('')
      
      // Refresh menu items to update stock quantities
      await fetchData()
      
      // Ask to print
      if (confirm(`تم إنشاء الطلب رقم ${order.order_number} بنجاح\n\nهل تريد طباعة الفاتورة؟`)) {
        printReceipt(order.order_number, [...cart.items], cart.total, paid)
      }
    }
    
    setProcessing(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] -m-4 lg:-m-6">
      {/* Shift Bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        {currentShift ? (
          <>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-green-600">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                <span className="font-medium">الشيفت مفتوح</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <Clock className="w-4 h-4" />
                <span>بدأ: {formatShiftTime(currentShift.start_time)}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <DollarSign className="w-4 h-4" />
                <span>رصيد الافتتاح: {formatCurrency(currentShift.opening_amount)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowEndShift(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              <Square className="w-4 h-4" />
              إنهاء الشيفت
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-orange-600">
              <div className="w-3 h-3 bg-orange-500 rounded-full" />
              <span className="font-medium">لا يوجد شيفت مفتوح</span>
            </div>
            <button
              type="button"
              onClick={() => setShowStartShift(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              <Play className="w-4 h-4" />
              بدء شيفت جديد
            </button>
          </>
        )}
      </div>

      <div className="flex flex-1 gap-4 p-4">
      {/* Menu Section */}
      <div className="flex-1 flex flex-col bg-gray-50 rounded-lg p-4">
        {/* View Mode Switcher */}
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setViewMode('items')
              setSelectedCategory(null)
              setSearchTerm('')
            }}
            className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
              viewMode === 'items'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Package className="w-5 h-5" />
            الأصناف
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode('recipes')
              setSelectedCategory(null)
              setSearchTerm('')
            }}
            className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
              viewMode === 'recipes'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            <ChefHat className="w-5 h-5" />
            الوصفات
          </button>
        </div>

        {/* Search */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="بحث بالاسم، الكود، أو الباركود..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setSelectedCategory(null) // Clear category when searching
              }}
              className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>

        {/* Categories Grid - Only show when not searching */}
        {!searchTerm && categories.length > 0 && (
          <div className="mb-4">
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-2">
              <button
                type="button"
                onClick={() => setSelectedCategory(null)}
                className={`py-3 px-4 rounded-lg font-medium text-sm transition-colors ${
                  selectedCategory === null
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                الكل
              </button>
              {categories.map(category => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategory(category.id)}
                  className={`py-3 px-4 rounded-lg font-medium text-sm transition-colors ${
                    selectedCategory === category.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                  }`}
                >
                  {category.name_ar}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Menu Items Grid */}
        <div className="flex-1 overflow-y-auto">
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Package className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-lg">لا توجد عناصر</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredItems.map(item => {
                  const stockQty = (item as any).stock_quantity || 0
                  const inStock = (item as any).in_stock || false
                  const isRecipe = (item as any).is_recipe || false
                  
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => inStock && handleAddToCart(item)}
                      disabled={!inStock}
                      className={`bg-white rounded-lg p-4 text-right transition-shadow border ${
                        inStock 
                          ? 'border-gray-100 hover:shadow-md cursor-pointer' 
                          : 'border-red-200 bg-red-50 opacity-60 cursor-not-allowed'
                      }`}
                    >
                      {item.image_url && (
                        <img
                          src={item.image_url}
                          alt={item.name_ar}
                          className="w-full h-24 object-cover rounded-lg mb-2"
                        />
                      )}
                      <h3 className="font-medium text-gray-900 mb-1">{item.name_ar}</h3>
                      <p className="text-blue-600 font-bold mb-1">{formatCurrency(item.price)}</p>
                      <div className="flex items-center justify-between">
                        <div className={`text-xs font-medium ${inStock ? 'text-green-600' : 'text-red-600'}`}>
                          {isRecipe ? 'وصفة' : inStock ? `متاح: ${stockQty.toFixed(2)}` : 'غير متاح'}
                        </div>
                        {isRecipe && <ChefHat className="w-4 h-4 text-orange-500" />}
                      </div>
                    </button>
                  )
                })}
            </div>
          )}
        </div>
      </div>

      {/* Cart Section */}
      <div className="w-80 lg:w-96 bg-white border-r border-gray-200 flex flex-col">
        {/* Cart Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-600" />
            <h2 className="font-bold text-gray-900">السلة</h2>
            <span className="mr-auto bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full text-sm">
              {cart.itemCount}
            </span>
          </div>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.items.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <ShoppingCart className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>السلة فارغة</p>
            </div>
          ) : (
            cart.items.map(item => (
              <div key={item.id} className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-medium text-gray-900">{item.item.name_ar}</h4>
                    <p className="text-sm text-blue-600">{formatCurrency(item.item.price)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => cart.removeItem(item.id)}
                    className="p-1 text-red-500 hover:bg-red-50 rounded"
                    title="حذف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleUpdateQuantity(item.id, item.quantity - 1)}
                    className="p-1 bg-white rounded border border-gray-200 hover:bg-gray-100"
                    title="تقليل"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-8 text-center font-medium">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)}
                    className="p-1 bg-white rounded border border-gray-200 hover:bg-gray-100"
                    title="زيادة"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <span className="mr-auto font-bold text-gray-900">
                    {formatCurrency(item.item.price * item.quantity)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Cart Footer */}
        <div className="p-4 border-t border-gray-200 space-y-3">
          <div className="flex justify-between text-lg font-bold text-gray-900">
            <span>الإجمالي</span>
            <span className="text-blue-600">{formatCurrency(cart.total)}</span>
          </div>
          <div className="flex gap-2">
            {lastOrder && (
              <button
                type="button"
                onClick={handlePrintLastOrder}
                className="flex-1 py-3 bg-gray-600 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors flex items-center justify-center gap-2"
                title="طباعة آخر فاتورة"
              >
                <Printer className="w-5 h-5" />
                طباعة
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowPayment(true)}
              disabled={cart.items.length === 0}
              className={`${lastOrder ? 'flex-1' : 'w-full'} py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              الدفع
            </button>
          </div>
        </div>
      </div>

      </div>

      {/* Start Shift Modal */}
      {showStartShift && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-900">بدء شيفت جديد</h3>
              <button type="button" onClick={() => setShowStartShift(false)} className="p-2 hover:bg-gray-100 rounded-lg" title="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">رصيد الافتتاح (الدرج)</label>
              <input
                type="number"
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
                placeholder="0"
                className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                aria-label="رصيد الافتتاح"
                min="0"
              />
            </div>
            <button
              type="button"
              onClick={handleStartShift}
              disabled={processing}
              className="w-full py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {processing ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Play className="w-5 h-5" />}
              بدء الشيفت
            </button>
          </div>
        </div>
      )}

      {/* End Shift Modal */}
      {showEndShift && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-900">إنهاء الشيفت</h3>
              <button type="button" onClick={() => setShowEndShift(false)} className="p-2 hover:bg-gray-100 rounded-lg" title="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mb-4 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600 mb-1">رصيد الافتتاح</p>
              <p className="text-lg font-bold">{formatCurrency(currentShift?.opening_amount || 0)}</p>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">المبلغ الفعلي في الدرج</label>
              <input
                type="number"
                value={closingAmount}
                onChange={(e) => setClosingAmount(e.target.value)}
                placeholder="أدخل المبلغ الفعلي"
                className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                aria-label="المبلغ الفعلي"
                min="0"
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات (اختياري)</label>
              <textarea
                value={shiftNotes}
                onChange={(e) => setShiftNotes(e.target.value)}
                placeholder="أي ملاحظات..."
                rows={2}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <button
              type="button"
              onClick={handleEndShift}
              disabled={processing || !closingAmount}
              className="w-full py-3 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {processing ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Square className="w-5 h-5" />}
              إنهاء الشيفت
            </button>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-900">اختر طريقة الدفع</h3>
              <button
                type="button"
                onClick={() => {
                  setShowPayment(false)
                  setPaidAmount('')
                }}
                className="p-2 hover:bg-gray-100 rounded-lg"
                title="إغلاق"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Order Total */}
            <div className="mb-4 p-4 bg-blue-50 rounded-lg">
              <div className="flex justify-between text-lg font-bold">
                <span>المبلغ المطلوب</span>
                <span className="text-blue-600">{formatCurrency(cart.total)}</span>
              </div>
            </div>

            {/* Paid Amount Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                المبلغ المدفوع
              </label>
              <input
                type="number"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder="أدخل المبلغ المدفوع"
                className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                aria-label="المبلغ المدفوع"
                min="0"
                step="0.01"
              />
            </div>

            {/* Change Amount */}
            {paidAmount && parseFloat(paidAmount) > 0 && (
              <div className={`mb-4 p-4 rounded-lg ${changeAmount >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                <div className="flex justify-between text-lg font-bold">
                  <span>{changeAmount >= 0 ? 'الباقي' : 'المتبقي على العميل'}</span>
                  <span className={changeAmount >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatCurrency(Math.abs(changeAmount))}
                  </span>
                </div>
              </div>
            )}

            {/* Quick Amount Buttons */}
            <div className="mb-4 grid grid-cols-4 gap-2">
              {[10, 20, 50, 100, 200, 500, 1000].map(amount => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setPaidAmount(String(amount))}
                  className="py-2 px-3 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium"
                >
                  {amount}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPaidAmount(String(cart.total))}
                className="py-2 px-3 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg text-sm font-medium"
              >
                بالضبط
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <PaymentButton
                icon={Banknote}
                label="نقدي"
                onClick={() => handlePayment('cash')}
                disabled={processing}
              />
              <PaymentButton
                icon={CreditCard}
                label="فيزا"
                onClick={() => handlePayment('visa')}
                disabled={processing}
              />
              <PaymentButton
                icon={Smartphone}
                label="انستاباي"
                onClick={() => handlePayment('instapay')}
                disabled={processing}
              />
              <PaymentButton
                icon={Wallet}
                label="محفظة"
                onClick={() => handlePayment('wallet')}
                disabled={processing}
              />
            </div>

            {processing && (
              <div className="mt-4 text-center text-gray-600">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                جاري معالجة الدفع...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface PaymentButtonProps {
  icon: React.ElementType
  label: string
  onClick: () => void
  disabled?: boolean
}

function PaymentButton({ icon: Icon, label, onClick, disabled }: PaymentButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-2 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
    >
      <Icon className="w-8 h-8 text-blue-600" />
      <span className="font-medium text-gray-900">{label}</span>
    </button>
  )
}
