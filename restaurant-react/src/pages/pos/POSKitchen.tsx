import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { kitchenService, KitchenOrder, KitchenOrderItem, KitchenNextStatus, KITCHEN_STATUSES } from '../../services/kitchen.service'
import { useRealtime } from '../../hooks/useRealtime'
import { formatTime } from '../../lib/utils'
import { localDayStartISO, todayLocal } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { ChefHat, Clock, CheckCircle, PlayCircle, Package, Printer } from 'lucide-react'

type RefreshMode = 'full' | 'changes'
type KitchenCard = KitchenOrder & { kitchenItems: KitchenOrderItem[] }

const ITEMS_PER_PAGE = 30
const POLL_MS = 10_000 // backup for realtime: reads only the orders changed since the last read
const FULL_RESYNC_MS = 120_000 // full reload of the active list now and then (self-healing)
const CHANGE_OVERLAP_MS = 60_000 // re-read the last minute of changes: a checkout that commits late keeps an earlier updated_at
const REALTIME_DEBOUNCE_MS = 300
const AUTO_PRINT_KEY = 'kitchen_auto_print'

// Orders shown: today's (Cairo) orders, and at least the last 6 hours so orders from just before midnight stay.
function kitchenWindowStart(): string {
  const todayStart = Date.parse(localDayStartISO(todayLocal()))
  return new Date(Math.min(todayStart, Date.now() - 6 * 3600_000)).toISOString()
}

const isKitchenStatus = (status: string) => KITCHEN_STATUSES.includes(status as KitchenOrder['status'])

// Only lines from kitchen categories are shown; with no kitchen category configured every line is shown.
function getKitchenItems(order: KitchenOrder, kitchenCategoryIds: string[]): KitchenOrderItem[] {
  const items = order.items || []
  if (kitchenCategoryIds.length === 0) return items
  return items.filter(item => {
    const categoryId = item.item?.category_id || item.menu_item?.category_id
    if (!categoryId) return true // Show items without category (safety)
    return kitchenCategoryIds.includes(categoryId)
  })
}

const lineName = (item: KitchenOrderItem, fallback: string) => item.item?.name_ar || item.menu_item?.name_ar || fallback
const shortNumber = (orderNumber: string) => orderNumber.split('-').pop()
const newestFirst = (a: KitchenOrder, b: KitchenOrder) => Date.parse(b.created_at) - Date.parse(a.created_at)

function escapeHtml(value: unknown): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(value ?? '').replace(/[&<>"']/g, ch => map[ch])
}

function buildTicketHtml(order: KitchenOrder, items: KitchenOrderItem[]): string {
  const rows = items.map(item => `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(lineName(item, 'صنف'))}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${escapeHtml(item.quantity)}</td>
          ${item.notes ? `<td style="padding: 8px; border-bottom: 1px solid #eee; color: #f97316; font-size: 12px;">${escapeHtml(item.notes)}</td>` : '<td></td>'}
        </tr>
      `).join('')

  return `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>طلب ${escapeHtml(order.order_number)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; direction: rtl; }
          .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 15px; margin-bottom: 15px; }
          .order-number { font-size: 24px; font-weight: bold; }
          .time { color: #666; margin-top: 5px; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th { background: #f3f4f6; padding: 10px; text-align: right; }
          .footer { text-align: center; margin-top: 20px; padding-top: 15px; border-top: 2px dashed #000; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="order-number">طلب #${escapeHtml(shortNumber(order.order_number))}</div>
          <div class="time">${escapeHtml(formatTime(order.created_at))}</div>
        </div>
        <table>
          <thead>
            <tr><th>الصنف</th><th>الكمية</th><th>ملاحظات</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${order.notes ? `<div style="background: #fef3c7; padding: 10px; border-radius: 5px; margin-top: 10px;"><strong>ملاحظات:</strong> ${escapeHtml(order.notes)}</div>` : ''}
        <div class="footer"><p>شكراً لكم</p></div>
      </body>
      </html>
    `
}

// Tickets print one after another through a hidden iframe: no pop-up window, so the browser's
// pop-up blocker cannot stop automatic printing (a kiosk-printing browser prints without a dialog).
interface PrintJob {
  html: string
  orderNumber: string
  manual: boolean // the chef pressed the print button (automatic prints run unattended)
}
const printQueue: PrintJob[] = []
let printing = false
// Set by the open kitchen screen: shows a failed automatic print as a banner (an alert would stop the
// unattended screen until someone dismisses it).
let onAutoPrintFailed: ((orderNumber: string) => void) | null = null

function reportPrintFailure(job: PrintJob) {
  if (!job.manual && onAutoPrintFailed) onAutoPrintFailed(job.orderNumber)
  else alert(`تعذر طباعة الطلب #${job.orderNumber}، حاول مرة أخرى`)
}

function printNextTicket() {
  if (printing) return
  const job = printQueue.shift()
  if (!job) return
  printing = true

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  if (doc) {
    doc.open()
    doc.write(job.html)
    doc.close()
  }
  const win = frame.contentWindow
  if (!doc || !win) {
    frame.remove()
    printing = false
    reportPrintFailure(job)
    printNextTicket()
    return
  }

  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    window.setTimeout(() => {
      frame.remove()
      printing = false
      printNextTicket()
    }, 300)
  }

  win.addEventListener('afterprint', finish)
  window.setTimeout(() => {
    try {
      win.focus()
      win.print()
    } catch (error) {
      console.error('Kitchen ticket print failed:', error)
      reportPrintFailure(job)
      finish()
      return
    }
    window.setTimeout(finish, 60_000) // safety net when the browser never fires afterprint
  }, 50)
}

function printTicket(order: KitchenOrder, items: KitchenOrderItem[], manual: boolean) {
  printQueue.push({ html: buildTicketHtml(order, items), orderNumber: shortNumber(order.order_number) || order.order_number, manual })
  printNextTicket()
}

function readAutoPrintSetting(): boolean {
  try {
    return localStorage.getItem(AUTO_PRINT_KEY) !== 'off'
  } catch {
    return true
  }
}

export default function POSKitchen() {
  const { user } = useAuth()
  const branchId = user?.branch_id || null
  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [kitchenCategoryIds, setKitchenCategoryIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [failedPrints, setFailedPrints] = useState<string[]>([]) // order numbers whose automatic print failed
  const [currentPage, setCurrentPage] = useState(1)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [autoPrint, setAutoPrint] = useState(readAutoPrintSetting)
  const [, setClock] = useState(0)

  // Everything the background refreshes need lives in refs, so the polling and realtime callbacks
  // always work with the current list (no stale closures).
  const ordersRef = useRef(new Map<string, KitchenOrder>())
  const categoriesRef = useRef<string[]>([])
  const cursorRef = useRef(0) // newest updated_at read so far (ms, server time)
  const initialLoadDoneRef = useRef(false) // orders already there when the screen opens are not printed
  const knownIdsRef = useRef(new Set<string>()) // orders already shown on this screen
  const printedIdsRef = useRef(new Set<string>()) // orders already printed: each one prints once
  const autoPrintRef = useRef(autoPrint)
  const busyRef = useRef(false)
  const queuedRef = useRef<RefreshMode | null>(null)
  const sessionRef = useRef(0) // changes with the branch / on unmount: late responses are dropped
  const pendingRef = useRef(new Set<string>())
  const debounceRef = useRef<number | undefined>(undefined)

  const applyRows = useCallback((rows: KitchenOrder[], mode: RefreshMode, windowStart: string, categoriesChanged: boolean) => {
    const windowMs = Date.parse(windowStart)
    const map = mode === 'full' ? new Map<string, KitchenOrder>() : new Map(ordersRef.current)

    for (const row of rows) {
      const changedAt = Date.parse(row.updated_at)
      if (changedAt > cursorRef.current) cursorRef.current = changedAt
      if (isKitchenStatus(row.status) && Date.parse(row.created_at) >= windowMs) map.set(row.id, row)
      else map.delete(row.id)
    }
    for (const [id, order] of map) {
      if (Date.parse(order.created_at) < windowMs) map.delete(id)
    }

    // Auto-print orders that just appeared on the screen (not the ones shown when it opened, and not the
    // ones that only became visible because the kitchen categories were changed).
    const canPrint = initialLoadDoneRef.current && !categoriesChanged && autoPrintRef.current
    const toPrint: KitchenOrder[] = []
    for (const order of map.values()) {
      if (knownIdsRef.current.has(order.id)) continue
      if (getKitchenItems(order, categoriesRef.current).length === 0) continue
      knownIdsRef.current.add(order.id)
      if (canPrint && !printedIdsRef.current.has(order.id)) toPrint.push(order)
    }

    ordersRef.current = map
    setOrders([...map.values()].sort(newestFirst))

    toPrint.sort((a, b) => newestFirst(b, a)).forEach(order => {
      printedIdsRef.current.add(order.id)
      printTicket(order, getKitchenItems(order, categoriesRef.current), false)
    })
  }, [])

  // Failed automatic prints are listed in a banner, so the chef can print them with the card's button
  useEffect(() => {
    onAutoPrintFailed = orderNumber =>
      setFailedPrints(prev => (prev.includes(orderNumber) ? prev : [...prev, orderNumber]))
    return () => {
      onAutoPrintFailed = null
    }
  }, [])

  const runRefresh = useCallback(async (mode: RefreshMode, session: number) => {
    if (!branchId) return
    const windowStart = kitchenWindowStart()
    let categoriesChanged = false

    if (mode === 'full') {
      const { data: categoryIds, error: categoriesError } = await kitchenService.getKitchenCategoryIds()
      if (session !== sessionRef.current) return
      if (categoriesError || !categoryIds) {
        setLoadError(toUserMessage(categoriesError))
        return
      }
      const previous = categoriesRef.current
      categoriesChanged = initialLoadDoneRef.current &&
        (previous.length !== categoryIds.length || categoryIds.some(id => !previous.includes(id)))
      categoriesRef.current = categoryIds
      setKitchenCategoryIds(categoryIds)
    }

    const changedSince = new Date(Math.max(cursorRef.current, Date.parse(windowStart)) - CHANGE_OVERLAP_MS).toISOString()
    const { data, error } = mode === 'full'
      ? await kitchenService.getActiveOrders(branchId, windowStart)
      : await kitchenService.getOrdersChangedSince(branchId, changedSince, windowStart)
    if (session !== sessionRef.current) return
    if (error || !data) {
      setLoadError(toUserMessage(error))
      return
    }

    applyRows(data, mode, windowStart, categoriesChanged)
    setLoadError(null)
    if (mode === 'full' && !initialLoadDoneRef.current) {
      initialLoadDoneRef.current = true
      setLoading(false)
    }

    if (mode === 'full') {
      // Orders with nothing for the kitchen (e.g. drinks only) would otherwise stay 'قيد التحضير' forever
      const { error: releaseErr } = await kitchenService.releaseNonKitchenOrders(branchId)
      if (session !== sessionRef.current) return
      setReleaseError(releaseErr ? toUserMessage(releaseErr) : null)
    }
  }, [branchId, applyRows])

  // One refresh at a time; requests made meanwhile are merged into one follow-up ('full' wins).
  const refresh = useCallback(async (mode: RefreshMode) => {
    if (!branchId) return
    const wanted = !initialLoadDoneRef.current ? 'full' : mode
    queuedRef.current = queuedRef.current === 'full' || wanted === 'full' ? 'full' : 'changes'
    if (busyRef.current) return
    busyRef.current = true
    const session = sessionRef.current
    try {
      while (queuedRef.current && session === sessionRef.current) {
        const next = queuedRef.current
        queuedRef.current = null
        try {
          await runRefresh(next, session)
        } catch (error) {
          if (session === sessionRef.current) setLoadError(toUserMessage(error))
        }
      }
    } finally {
      if (session === sessionRef.current) {
        busyRef.current = false
        if (!initialLoadDoneRef.current) setLoading(false)
      }
    }
  }, [branchId, runRefresh])

  useEffect(() => {
    autoPrintRef.current = autoPrint
    try {
      localStorage.setItem(AUTO_PRINT_KEY, autoPrint ? 'on' : 'off')
    } catch {
      // the setting just won't be remembered in this browser
    }
  }, [autoPrint])

  useEffect(() => {
    sessionRef.current += 1
    ordersRef.current = new Map()
    cursorRef.current = 0
    initialLoadDoneRef.current = false
    knownIdsRef.current = new Set()
    busyRef.current = false
    queuedRef.current = null
    setOrders([])
    setLoadError(null)
    setReleaseError(null)
    if (!branchId) {
      setLoading(false)
      return
    }

    setLoading(true)
    refresh('full')
    const poll = window.setInterval(() => refresh('changes'), POLL_MS)
    const resync = window.setInterval(() => refresh('full'), FULL_RESYNC_MS)
    const clock = window.setInterval(() => setClock(c => c + 1), 30_000) // keeps 'منذ ... دقيقة' current

    return () => {
      sessionRef.current += 1
      window.clearInterval(poll)
      window.clearInterval(resync)
      window.clearInterval(clock)
      window.clearTimeout(debounceRef.current)
    }
  }, [branchId, refresh])

  // Realtime: only this branch's orders; a burst of events triggers one small 'changes' read.
  const handleRealtimeChange = useCallback(() => {
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => refresh('changes'), REALTIME_DEBOUNCE_MS)
  }, [refresh])

  useRealtime({
    table: 'orders',
    events: ['INSERT', 'UPDATE'],
    filter: branchId ? `branch_id=eq.${branchId}` : undefined,
    enabled: !!branchId,
    onChange: handleRealtimeChange,
  })

  const handleStatusChange = async (orderId: string, newStatus: KitchenNextStatus) => {
    if (pendingRef.current.has(orderId)) return
    pendingRef.current.add(orderId)
    setPendingIds(new Set(pendingRef.current))

    const { error } = await kitchenService.setOrderStatus(orderId, newStatus)

    pendingRef.current.delete(orderId)
    setPendingIds(new Set(pendingRef.current))
    if (error) alert(toUserMessage(error))
    refresh('changes')
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-yellow-100 border-yellow-300'
      case 'in_kitchen': return 'bg-blue-100 border-blue-300'
      case 'preparing': return 'bg-orange-100 border-orange-300'
      case 'ready': return 'bg-green-100 border-green-300'
      default: return 'bg-gray-100 border-gray-300'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'جديد'
      case 'in_kitchen': return 'في المطبخ'
      case 'preparing': return 'قيد التحضير'
      case 'ready': return 'جاهز'
      default: return status
    }
  }

  const getTimeSince = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'الآن'
    if (minutes < 60) return `${minutes} دقيقة`
    const hours = Math.floor(minutes / 60)
    return `${hours} ساعة`
  }

  // Orders with at least one kitchen item
  const kitchenOrders: KitchenCard[] = useMemo(() => orders
    .map(order => ({ ...order, kitchenItems: getKitchenItems(order, kitchenCategoryIds) }))
    .filter(order => order.kitchenItems.length > 0), [orders, kitchenCategoryIds])

  // Pagination: refreshes keep the current page; it only moves back when that page no longer exists
  const totalPages = Math.max(1, Math.ceil(kitchenOrders.length / ITEMS_PER_PAGE))
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])
  const page = Math.min(currentPage, totalPages)
  const startIndex = (page - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const paginatedOrders = kitchenOrders.slice(startIndex, endIndex)

  const handlePrint = (order: KitchenCard) => printTicket(order, order.kitchenItems, true)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!branchId) {
    return (
      <div className="text-center py-16 bg-white rounded-lg border border-gray-100">
        <ChefHat className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h3 className="text-xl font-medium text-gray-900 mb-2">لا يوجد فرع مرتبط بحسابك</h3>
        <p className="text-gray-600">اطلب من مدير النظام ربط حسابك بفرع لعرض طلبات المطبخ</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
            <ChefHat className="w-6 h-6 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">شاشة المطبخ</h1>
            <p className="text-gray-600">الطلبات النشطة: {kitchenOrders.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoPrint(v => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              autoPrint ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
            title="طباعة الطلبات الجديدة تلقائياً على هذا الجهاز"
          >
            <Printer className="w-4 h-4" />
            {autoPrint ? 'الطباعة التلقائية: تعمل' : 'الطباعة التلقائية: متوقفة'}
          </button>
          <button
            type="button"
            onClick={() => refresh('full')}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            تحديث
          </button>
        </div>
      </div>

      {loadError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          تعذر تحديث الطلبات: {loadError}
        </div>
      )}
      {releaseError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          تعذر إنهاء الطلبات التي لا تحتوي على أصناف مطبخ: {releaseError}
        </div>
      )}
      {failedPrints.length > 0 && (
        <div className="flex items-center justify-between gap-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          <span>
            تعذرت الطباعة التلقائية للطلبات: {failedPrints.map(n => `#${n}`).join('، ')}. اطبعها يدوياً من زر الطباعة في بطاقة كل طلب.
          </span>
          <button
            type="button"
            onClick={() => setFailedPrints([])}
            className="px-3 py-1 rounded-lg bg-white border border-red-200 hover:bg-red-100 whitespace-nowrap"
          >
            إخفاء
          </button>
        </div>
      )}

      {/* Orders Grid */}
      {kitchenOrders.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-100">
          <ChefHat className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-900 mb-2">لا توجد طلبات</h3>
          <p className="text-gray-600">ستظهر الطلبات الجديدة هنا تلقائياً</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paginatedOrders.map(order => {
            const pending = pendingIds.has(order.id)
            return (
            <div
              key={order.id}
              className={`rounded-lg border-2 overflow-hidden ${getStatusColor(order.status)}`}
            >
              {/* Order Header */}
              <div className="p-4 bg-white/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-lg text-gray-900">
                    #{shortNumber(order.order_number)}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handlePrint(order)}
                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="طباعة"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      order.status === 'paid' ? 'bg-yellow-200 text-yellow-800' :
                      order.status === 'in_kitchen' ? 'bg-blue-200 text-blue-800' :
                      order.status === 'preparing' ? 'bg-orange-200 text-orange-800' :
                      'bg-green-200 text-green-800'
                    }`}>
                      {getStatusLabel(order.status)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Clock className="w-4 h-4" />
                  <span>{formatTime(order.created_at)}</span>
                  <span className="text-gray-400">•</span>
                  <span className="text-orange-600 font-medium">{getTimeSince(order.created_at)}</span>
                </div>
              </div>

              {/* Order Items - Kitchen items only */}
              <div className="p-4 bg-white space-y-2">
                {order.kitchenItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3">
                    <span className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-sm">
                      {item.quantity}
                    </span>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{lineName(item, 'صنف غير معروف')}</p>
                      {item.notes && (
                        <p className="text-sm text-orange-600">{item.notes}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Order Actions */}
              <div className="p-4 bg-white border-t border-gray-100">
                {order.status === 'paid' && (
                  <button
                    type="button"
                    onClick={() => handleStatusChange(order.id, 'in_kitchen')}
                    disabled={pending}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    <PlayCircle className="w-5 h-5" />
                    بدء التحضير
                  </button>
                )}
                {order.status === 'in_kitchen' && (
                  <button
                    type="button"
                    onClick={() => handleStatusChange(order.id, 'preparing')}
                    disabled={pending}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
                  >
                    <Package className="w-5 h-5" />
                    قيد التحضير
                  </button>
                )}
                {order.status === 'preparing' && (
                  <button
                    type="button"
                    onClick={() => handleStatusChange(order.id, 'ready')}
                    disabled={pending}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    <CheckCircle className="w-5 h-5" />
                    جاهز للتسليم
                  </button>
                )}
              </div>
            </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {kitchenOrders.length > ITEMS_PER_PAGE && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              عرض {startIndex + 1} - {Math.min(endIndex, kitchenOrders.length)} من {kitchenOrders.length} طلب
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage(1)}
                disabled={page === 1}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                الأولى
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                السابق
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum
                  if (totalPages <= 5) {
                    pageNum = i + 1
                  } else if (page <= 3) {
                    pageNum = i + 1
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i
                  } else {
                    pageNum = page - 2 + i
                  }

                  return (
                    <button
                      type="button"
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`px-3 py-1 rounded-lg ${
                        page === pageNum
                          ? 'bg-blue-600 text-white'
                          : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {pageNum}
                    </button>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={() => setCurrentPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                التالي
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={page === totalPages}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                الأخيرة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
