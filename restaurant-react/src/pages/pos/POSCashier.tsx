import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { ordersService, PosSellableItem, CashierCategory, OrderSummary } from '../../services/orders.service'
import { shiftsService, CashierShift } from '../../services/shifts.service'
import { useCart } from '../../hooks/useCart'
import { OrderPaymentMethod } from '../../types/database.types'
import { formatCurrency, formatDateTime, formatNumber, parseDecimal, roundMoney, roundQuantity } from '../../lib/utils'
import { toUserMessage, isInsufficientStock } from '../../lib/errors'
import { paymentMethodLabel } from '../orders/orderLabels'
import { findItemsByScan } from '../inventory/stockHelpers'
import { ShoppingCart, Plus, Minus, Trash2, Truck, Banknote, Smartphone, Wallet, X, Printer, Play, Square, Clock, DollarSign, Search, Package, ChefHat } from 'lucide-react'

const hasHint = (error: unknown, hint: string) => (error as { hint?: string } | null)?.hint === hint

// Quantity per item, to compare a retried checkout with the order an earlier attempt saved
const quantitiesByItem = (lines: { item_id: string | null; quantity: number }[]) => {
  const byItem = new Map<string, number>()
  for (const line of lines) {
    if (line.item_id) byItem.set(line.item_id, (byItem.get(line.item_id) ?? 0) + Number(line.quantity))
  }
  return byItem
}
const sameQuantities = (a: Map<string, number>, b: Map<string, number>) =>
  a.size === b.size && [...a].every(([itemId, qty]) => b.get(itemId) === qty)

// Every value placed in the receipt HTML is escaped (item names and notes are user-entered).
const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

export default function POSCashier() {
  const { user } = useAuth()
  const cart = useCart()
  const [menuItems, setMenuItems] = useState<PosSellableItem[]>([])
  const [categories, setCategories] = useState<CashierCategory[]>([])
  const [categoriesRestricted, setCategoriesRestricted] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [scanChoices, setScanChoices] = useState<{ term: string; ids: string[] } | null>(null)
  const [viewMode, setViewMode] = useState<'items' | 'recipes'>('items')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [paidAmount, setPaidAmount] = useState<string>('')
  const [lastOrder, setLastOrder] = useState<OrderSummary | null>(null)
  // One key per checkout attempt: a retry after a lost response returns the saved order instead of selling twice
  const checkoutKey = useRef<string | null>(null)
  // Set synchronously, so a double click cannot start a second request before `processing` re-renders
  const busy = useRef(false)
  const paidValue = paidAmount.trim() ? parseDecimal(paidAmount) : null
  const changeAmount = paidValue !== null ? roundMoney(paidValue - cart.total) : 0
  const cashUnderpaid = paidValue !== null && paidValue < cart.total

  // Shift state
  const [currentShift, setCurrentShift] = useState<CashierShift | null>(null)
  const [shiftError, setShiftError] = useState<string | null>(null)
  const [showStartShift, setShowStartShift] = useState(false)
  const [showEndShift, setShowEndShift] = useState(false)
  const [openingAmount, setOpeningAmount] = useState<string>('0')
  const [closingAmount, setClosingAmount] = useState<string>('')
  const [shiftNotes, setShiftNotes] = useState('')

  useEffect(() => {
    fetchData()
    checkOpenShift()
  }, [])

  // A new cart is a new checkout
  useEffect(() => {
    if (cart.items.length === 0) checkoutKey.current = null
  }, [cart.items.length])

  // Escape closes the open dialog
  useEffect(() => {
    if (!showPayment && !showStartShift && !showEndShift) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || processing) return
      setShowPayment(false)
      setShowStartShift(false)
      setShowEndShift(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showPayment, showStartShift, showEndShift, processing])

  // Loads what this cashier may sell (server prices, category limits applied by the server).
  // Any failure shows nothing rather than items the cashier may not sell.
  const fetchData = async (): Promise<PosSellableItem[] | null> => {
    if (!user?.branch_id) {
      setLoadError('لا يوجد فرع مرتبط بحسابك')
      setLoading(false)
      return null
    }
    const [itemsRes, categoriesRes] = await Promise.all([
      ordersService.getSellableItems(user.branch_id),
      ordersService.getCashierCategories(),
    ])
    const error = itemsRes.error || categoriesRes.error
    if (error) {
      setMenuItems([])
      setCategories([])
      setLoadError(toUserMessage(error, 'تعذر تحميل الأصناف'))
      setLoading(false)
      return null
    }
    setMenuItems(itemsRes.data)
    setCategories(categoriesRes.data.categories)
    setCategoriesRestricted(categoriesRes.data.restricted)
    setLoadError(null)
    setLoading(false)
    return itemsRes.data
  }

  // Add item to cart with stock validation (the server checks again at checkout)
  const handleAddToCart = (item: PosSellableItem) => {
    if (!item.in_stock) return

    if (item.has_stock_row) {
      const cartItem = cart.items.find(ci => ci.item.item_id === item.item_id)
      const currentCartQty = cartItem ? cartItem.quantity : 0
      if (currentCartQty + 1 > item.stock_quantity) {
        alert(`لا يمكن إضافة المزيد. الكمية المتاحة: ${formatNumber(roundQuantity(item.stock_quantity))}`)
        return
      }
    }

    cart.addItem(item)
  }

  // Update quantity with stock validation
  const handleUpdateQuantity = (itemId: string, newQuantity: number) => {
    const cartItem = cart.items.find(ci => ci.id === itemId)
    if (!cartItem) return

    const latest = menuItems.find(mi => mi.item_id === cartItem.item.item_id) ?? cartItem.item
    if (newQuantity > cartItem.quantity && latest.has_stock_row && newQuantity > latest.stock_quantity) {
      alert(`الكمية المتاحة فقط: ${formatNumber(roundQuantity(latest.stock_quantity))}`)
      return
    }

    cart.updateQuantity(itemId, newQuantity)
  }

  const checkOpenShift = async () => {
    if (!user?.id || !user?.branch_id) return
    const { data, error } = await shiftsService.getOpenShift(user.id, user.branch_id)
    if (error) {
      setShiftError(toUserMessage(error, 'تعذر التحقق من الشيفت المفتوح'))
      return
    }
    setShiftError(null)
    setCurrentShift(data)
  }

  const handleStartShift = async () => {
    if (!user?.id || !user?.branch_id || busy.current) return
    const amount = parseDecimal(openingAmount)
    if (amount === null || amount < 0) {
      alert('أدخل رصيد افتتاح صحيح (صفر أو أكثر)')
      return
    }
    busy.current = true
    setProcessing(true)
    const { data, error } = await shiftsService.startShift(user.branch_id, roundMoney(amount))
    if (error || !data) {
      alert(toUserMessage(error, 'فشل في بدء الشيفت'))
    } else {
      if (data.existing) alert('لديك شيفت مفتوح بالفعل، تم استكماله')
      setCurrentShift(data)
      setShiftError(null)
      setShowStartShift(false)
      setOpeningAmount('0')
    }
    busy.current = false
    setProcessing(false)
  }

  const handleEndShift = async () => {
    if (!currentShift || !user?.id || busy.current) return
    const amount = parseDecimal(closingAmount)
    if (amount === null || amount < 0) {
      alert('أدخل المبلغ الفعلي في الدرج (صفر أو أكثر)')
      return
    }
    busy.current = true
    setProcessing(true)
    const { data, error } = await shiftsService.closeShift(currentShift.id, roundMoney(amount), shiftNotes.trim() || undefined)
    if (error || !data) {
      alert(toUserMessage(error, 'فشل في إنهاء الشيفت'))
      if (hasHint(error, 'SHIFT_CLOSED')) await checkOpenShift()
    } else {
      const unpaid = data.unpaid_orders > 0 ? `\nتنبيه: ${formatNumber(data.unpaid_orders)} طلب غير مدفوع لم يُحسب في المبيعات` : ''
      alert(
        `تم إنهاء الشيفت بنجاح\n` +
        `إجمالي المبيعات: ${formatCurrency(Number(data.total_sales) || 0)}\n` +
        `المتوقع في الدرج: ${formatCurrency(Number(data.expected_amount) || 0)}\n` +
        `الفرق: ${formatCurrency(Number(data.difference) || 0)}${unpaid}`
      )
      setCurrentShift(null)
      setShowEndShift(false)
      setClosingAmount('')
      setShiftNotes('')
    }
    busy.current = false
    setProcessing(false)
  }

  const formatShiftTime = (time: string) => {
    return new Date(time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
  }

  const matchesSearch = (item: PosSellableItem, term: string) =>
    item.name_ar?.toLowerCase().includes(term) ||
    item.name?.toLowerCase().includes(term) ||
    item.code?.toLowerCase().includes(term) ||
    item.barcode?.toLowerCase().includes(term)

  // A scanned code that matches several items: the list shows exactly those items (in either view)
  // until the search text changes, and the cashier picks one. Nothing is picked silently.
  const activeScanChoices = scanChoices && scanChoices.term === searchTerm ? scanChoices.ids : null

  // The list holds every item the branch sells. Searching or scanning finds any of them (branches sell their
  // retail stock by barcode); the cashier's category permissions only limit what browsing shows.
  const allowedCategoryIds = new Set(categories.map(c => c.id))
  const filteredItems = activeScanChoices
    ? menuItems.filter(item => activeScanChoices.includes(item.item_id))
    : menuItems.filter(item => {
        // Filter by view mode (items vs recipes)
        if (viewMode === 'items' && item.is_recipe) return false
        if (viewMode === 'recipes' && !item.is_recipe) return false

        // Filter by search term (including barcode)
        const term = searchTerm.trim().toLowerCase()
        if (term) return matchesSearch(item, term)

        // Browsing: only the cashier's own categories
        if (categoriesRestricted && !(item.category_id && allowedCategoryIds.has(item.category_id))) return false

        // Filter by category if selected; "الكل" shows every item, including ones without a category
        if (selectedCategory) {
          return item.category_id === selectedCategory
        }
        return true
      })

  // Enter in the search box (or a barcode scanner). Codes are matched like the stock screens (barcode, then the
  // code with or without the literal quotes most imported codes carry): one match is added; several = the only
  // one in stock, else the cashier chooses from the list; no code match = a name search with a single result.
  const handleSearchEnter = () => {
    const text = searchTerm.trim()
    if (!text) return
    const scanned = findItemsByScan(menuItems, text)
    let target: PosSellableItem | undefined
    if (scanned.length === 1) {
      target = scanned[0]
    } else if (scanned.length > 1) {
      const inStock = scanned.filter(i => i.in_stock)
      if (inStock.length === 1) {
        target = inStock[0]
      } else {
        setScanChoices({ term: searchTerm, ids: scanned.map(i => i.item_id) })
        alert(`يوجد ${formatNumber(scanned.length)} أصناف تطابق الكود "${text}". اختر الصنف المطلوب من القائمة`)
        return
      }
    } else {
      const term = text.toLowerCase()
      const byName = menuItems.filter(item => matchesSearch(item, term))
      if (byName.length === 0) {
        alert(`لا يوجد صنف بهذا الكود أو الاسم: ${text}`)
        setSearchTerm('')
        return
      }
      // Results only in the other view (items / recipes): show them here instead of an empty list
      const visible = filteredItems.length > 0 ? filteredItems : byName
      if (visible.length !== 1) {
        if (filteredItems.length === 0) setScanChoices({ term: searchTerm, ids: byName.map(i => i.item_id) })
        return // several results: the cashier picks from the list
      }
      target = visible[0]
    }
    if (!target.in_stock) {
      alert(`الصنف "${target.name_ar}" غير متاح`)
      return
    }
    handleAddToCart(target)
    setSearchTerm('')
  }

  // Print receipt from the saved order (server prices, totals and change)
  const printReceipt = (order: OrderSummary) => {
    const lines = order.items.map(item => `
            <div class="item">
              <span class="item-name">${escapeHtml(item.name_ar || 'صنف')}</span>
              <span class="item-qty">×${escapeHtml(formatNumber(item.quantity))}</span>
              <span class="item-price">${escapeHtml(formatCurrency(Number(item.total_price) || 0))}</span>
            </div>
          `).join('')
    const isCash = order.payment_method === 'cash'

    const receiptContent = `
      <html dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>فاتورة - ${escapeHtml(order.order_number)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 300px; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 20px; }
          .header h1 { margin: 0; font-size: 18px; }
          .header p { margin: 5px 0; font-size: 12px; color: #666; }
          .divider { border-top: 1px dashed #000; margin: 10px 0; }
          .items { margin: 10px 0; }
          .item { display: flex; justify-content: space-between; margin: 5px 0; font-size: 14px; }
          .item-name { flex: 1; }
          .item-qty { width: 40px; text-align: center; }
          .item-price { width: 90px; text-align: left; }
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
          <p>رقم الطلب: ${escapeHtml(order.order_number)}</p>
          <p>${escapeHtml(formatDateTime(order.created_at))}</p>
        </div>
        <div class="divider"></div>
        <div class="items">${lines}</div>
        <div class="divider"></div>
        <div class="totals">
          ${Number(order.discount_amount) > 0 ? `
          <div class="total-row">
            <span>الخصم</span>
            <span>${escapeHtml(formatCurrency(Number(order.discount_amount)))}</span>
          </div>` : ''}
          <div class="total-row grand">
            <span>الإجمالي</span>
            <span>${escapeHtml(formatCurrency(Number(order.total_amount) || 0))}</span>
          </div>
          <div class="total-row">
            <span>طريقة الدفع</span>
            <span>${escapeHtml(paymentMethodLabel(order.payment_method))}</span>
          </div>
          ${isCash ? `
          <div class="total-row">
            <span>المدفوع</span>
            <span>${escapeHtml(formatCurrency(Number(order.paid_amount ?? order.total_amount) || 0))}</span>
          </div>
          <div class="total-row">
            <span>الباقي</span>
            <span>${escapeHtml(formatCurrency(Number(order.change_amount) || 0))}</span>
          </div>` : ''}
        </div>
        <div class="divider"></div>
        <div class="footer">
          <p>شكراً لزيارتكم</p>
        </div>
      </body>
      </html>
    `

    const printWindow = window.open('', '_blank', 'width=400,height=600')
    if (!printWindow) {
      alert('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع')
      return
    }
    printWindow.opener = null
    printWindow.document.write(receiptContent)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => printWindow.print(), 250)
  }

  // Print last order
  const handlePrintLastOrder = () => {
    if (lastOrder) {
      printReceipt(lastOrder)
    }
  }

  const handlePayment = async (method: OrderPaymentMethod) => {
    if (busy.current || !user?.branch_id || cart.items.length === 0) return
    if (!currentShift) {
      alert('لا يوجد شيفت مفتوح. ابدأ شيفت جديد قبل البيع')
      return
    }

    let paid: number | null = null
    if (method === 'cash' && paidAmount.trim() !== '') {
      if (paidValue === null || paidValue < 0) {
        alert('أدخل مبلغاً مدفوعاً صحيحاً')
        return
      }
      paid = roundMoney(paidValue)
      if (paid < cart.total) {
        alert(`المبلغ المدفوع أقل من الإجمالي. المتبقي على العميل: ${formatCurrency(roundMoney(cart.total - paid))}`)
        return
      }
    }

    if (!checkoutKey.current) checkoutKey.current = crypto.randomUUID()
    busy.current = true
    setProcessing(true)

    const submitted = cart.items.map(item => ({
      item_id: item.item.item_id,
      quantity: item.quantity,
      notes: item.notes,
    }))
    const expectedTotal = cart.total
    const { data: order, error } = await ordersService.checkout({
      shiftId: currentShift.id,
      items: submitted,
      paymentMethod: method,
      paidAmount: paid,
      clientRequestId: checkoutKey.current,
      expectedTotal,
    })

    busy.current = false
    if (error || !order) {
      setProcessing(false)
      const message = toUserMessage(error, 'فشل في إتمام البيع')
      if (hasHint(error, 'PRICE_CHANGED')) {
        // Prices changed since the screen loaded: reload them into the cart so the cashier sees the real total
        const fresh = await fetchData()
        const removed = fresh ? cart.refreshItems(fresh) : []
        alert(message + (removed.length ? `\nتم حذف أصناف لم تعد متاحة: ${removed.join('، ')}` : ''))
        return
      }
      if (hasHint(error, 'SHIFT_CLOSED')) await checkOpenShift()
      if (isInsufficientStock(error)) await fetchData()
      alert(message)
      return
    }

    checkoutKey.current = null
    setLastOrder(order)
    setShowPayment(false)
    setPaidAmount('')
    setProcessing(false)

    // Refresh menu items to update stock quantities
    fetchData()

    // A retry got back the order an earlier attempt saved (its answer was lost). If the cart was changed since,
    // that order is not what is on screen: keep the cart (it was NOT sold) and say exactly what was sold.
    if (order.duplicate &&
        (!sameQuantities(quantitiesByItem(order.items), quantitiesByItem(submitted)) ||
         roundMoney(Number(order.total_amount) || 0) !== expectedTotal)) {
      const sold = order.items.map(i => `- ${i.name_ar || 'صنف'} × ${formatNumber(i.quantity)}`).join('\n')
      alert(
        `تنبيه: محاولة دفع سابقة تم حفظها بالفعل كطلب رقم ${order.order_number}\n` +
        `(${formatCurrency(Number(order.total_amount) || 0)} - ${paymentMethodLabel(order.payment_method)}) وفيه:\n${sold}\n\n` +
        `السلة الحالية لم تُبَع. احذف منها ما بيع في الطلب السابق، ثم ادفع الباقي كطلب جديد.`
      )
      return
    }

    cart.clearCart()
    // For a retry, the change is for the amount entered now (the earlier attempt may have carried another)
    const changeDue = order.duplicate
      ? (method === 'cash' && paid !== null ? roundMoney(paid - expectedTotal) : 0)
      : (order.payment_method === 'cash' ? Number(order.change_amount) || 0 : 0)
    const changeText = changeDue > 0 ? `\nالباقي للعميل: ${formatCurrency(changeDue)}` : ''
    const methodNote = order.duplicate && order.payment_method !== method
      ? `\nمسجل بطريقة دفع: ${paymentMethodLabel(order.payment_method)} (يمكن للمدير تعديلها من شاشة الأوردرات)`
      : ''
    const title = order.duplicate
      ? `هذا الطلب مسجل بالفعل برقم ${order.order_number}${methodNote}`
      : `تم إنشاء الطلب رقم ${order.order_number} بنجاح`
    // The receipt prints straight away (no question), then the sale is confirmed
    printReceipt(order)
    alert(`${title}${changeText}`)
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
                <span>رصيد الافتتاح: {formatCurrency(Number(currentShift.opening_amount) || 0)}</span>
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
        ) : shiftError ? (
          <>
            <div className="flex items-center gap-2 text-red-600">
              <div className="w-3 h-3 bg-red-500 rounded-full" />
              <span className="font-medium">{shiftError}</span>
            </div>
            <button
              type="button"
              onClick={checkOpenShift}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              إعادة المحاولة
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-orange-600">
              <div className="w-3 h-3 bg-orange-500 rounded-full" />
              <span className="font-medium">لا يوجد شيفت مفتوح - ابدأ شيفت قبل البيع</span>
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSearchEnter()
                }
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
          {loadError ? (
            <div className="flex flex-col items-center justify-center h-full text-red-600 gap-3">
              <Package className="w-16 h-16 opacity-50" />
              <p className="text-lg">{loadError}</p>
              <button
                type="button"
                onClick={() => fetchData()}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                إعادة المحاولة
              </button>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Package className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-lg">لا توجد عناصر</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredItems.map(item => {
                  const inStock = item.in_stock
                  const stockText = item.has_stock_row ? `متاح: ${formatNumber(roundQuantity(item.stock_quantity))}` : ''

                  return (
                    <button
                      type="button"
                      key={item.item_id}
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
                          {!inStock ? 'غير متاح' : item.is_recipe ? (stockText ? `وصفة - ${stockText}` : 'وصفة') : stockText}
                        </div>
                        {item.is_recipe && <ChefHat className="w-4 h-4 text-orange-500" />}
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
              {formatNumber(cart.itemCount)}
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
                  <span className="w-8 text-center font-medium">{formatNumber(item.quantity)}</span>
                  <button
                    type="button"
                    onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)}
                    className="p-1 bg-white rounded border border-gray-200 hover:bg-gray-100"
                    title="زيادة"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <span className="mr-auto font-bold text-gray-900">
                    {formatCurrency(roundMoney(item.item.price * item.quantity))}
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
              disabled={cart.items.length === 0 || !currentShift}
              title={!currentShift ? 'ابدأ شيفت قبل البيع' : undefined}
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
                type="text"
                inputMode="decimal"
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleStartShift() }}
                placeholder="0"
                className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                aria-label="رصيد الافتتاح"
                autoFocus
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
              <p className="text-lg font-bold">{formatCurrency(Number(currentShift?.opening_amount) || 0)}</p>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">المبلغ الفعلي في الدرج</label>
              <input
                type="text"
                inputMode="decimal"
                value={closingAmount}
                onChange={(e) => setClosingAmount(e.target.value)}
                placeholder="أدخل المبلغ الفعلي"
                className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                aria-label="المبلغ الفعلي"
                autoFocus
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
              disabled={processing || !closingAmount.trim()}
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
                disabled={processing}
                className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-50"
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

            {/* Paid Amount Input (cash) */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                المبلغ المدفوع (نقدي)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handlePayment('cash')
                  }
                }}
                placeholder="أدخل المبلغ المدفوع (Enter = دفع نقدي)"
                className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                aria-label="المبلغ المدفوع"
                autoFocus
              />
            </div>

            {/* Change Amount */}
            {paidAmount.trim() !== '' && (
              paidValue === null || paidValue < 0 ? (
                <div className="mb-4 p-4 rounded-lg bg-red-50 text-red-600 font-medium">المبلغ المدخل غير صحيح</div>
              ) : paidValue > 0 && (
                <div className={`mb-4 p-4 rounded-lg ${changeAmount >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                  <div className="flex justify-between text-lg font-bold">
                    <span>{changeAmount >= 0 ? 'الباقي' : 'المتبقي على العميل'}</span>
                    <span className={changeAmount >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {formatCurrency(Math.abs(changeAmount))}
                    </span>
                  </div>
                </div>
              )
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
                  {formatNumber(amount)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPaidAmount(cart.total.toFixed(2))}
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
                disabled={processing || !currentShift || cashUnderpaid}
              />
              <PaymentButton
                icon={Truck}
                label="دليفري"
                onClick={() => handlePayment('visa')}
                disabled={processing || !currentShift}
              />
              <PaymentButton
                icon={Smartphone}
                label="انستاباي"
                onClick={() => handlePayment('instapay')}
                disabled={processing || !currentShift}
              />
              <PaymentButton
                icon={Wallet}
                label="محفظة"
                onClick={() => handlePayment('wallet')}
                disabled={processing || !currentShift}
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
