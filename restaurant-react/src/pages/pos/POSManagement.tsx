import { useEffect, useRef, useState } from 'react'
import {
  posManagementService, BranchPOSItem, AvailableInventoryItem, POSItemChange, ItemCostChange
} from '../../services/posManagement.service'
import { parseDecimal, roundMoney } from '../../lib/utils'
import { toUserMessage } from '../../lib/errors'
import {
  Store, Save, Copy, Percent,
  Check, X, Eye, EyeOff, Search, Plus, Trash2, Package, PackagePlus, RefreshCw
} from 'lucide-react'

interface Branch {
  id: string
  code: string
  name: string
  name_ar: string
  itemCount: number
}

// Unsaved edits of one row: the typed price text and/or the availability toggle
interface RowEdit {
  price?: string
  is_available?: boolean
}

const MIN_PERCENT = -90
const MAX_PERCENT = 500

export default function POSManagement() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
  const [posItems, setPosItems] = useState<BranchPOSItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [editedPrices, setEditedPrices] = useState<Record<string, RowEdit>>({})
  const [editedCosts, setEditedCosts] = useState<Record<string, string>>({})
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [showPercentModal, setShowPercentModal] = useState(false)
  const [showAddItemModal, setShowAddItemModal] = useState(false)
  const [percentValue, setPercentValue] = useState<string>('')
  const [copySourceBranch, setCopySourceBranch] = useState<string>('')
  const [availableItems, setAvailableItems] = useState<AvailableInventoryItem[]>([])
  const [selectedItemToAdd, setSelectedItemToAdd] = useState<string>('')
  const [newItemPrice, setNewItemPrice] = useState<string>('')
  const [bulkAdding, setBulkAdding] = useState(false)
  const [fixingPrices, setFixingPrices] = useState(false)
  // Only the response of the latest request is used (switching branch quickly must not show the wrong branch)
  const posRequestRef = useRef(0)
  const availableRequestRef = useRef(0)

  const busy = saving || bulkAdding || fixingPrices

  useEffect(() => {
    fetchBranches()
  }, [])

  useEffect(() => {
    if (selectedBranch) {
      setPosItems([])
      setAvailableItems([])
      setEditedPrices({})
      setEditedCosts({})
      fetchPOSItems(selectedBranch)
      fetchAvailableItems(selectedBranch)
    }
  }, [selectedBranch])

  const fetchBranches = async () => {
    const { data, error } = await posManagementService.getBranchesWithItemCounts()
    if (error) {
      setLoadError(toUserMessage(error))
    } else {
      setBranches((data || []) as unknown as Branch[])
    }
  }

  const fetchPOSItems = async (branchId: string) => {
    const requestId = ++posRequestRef.current
    setLoading(true)
    const { data, error } = await posManagementService.getBranchPOSItems(branchId)
    if (requestId !== posRequestRef.current) return // a newer request (e.g. another branch) is running
    if (error) {
      setPosItems([])
      setLoadError(toUserMessage(error))
    } else {
      setPosItems(data || [])
      setLoadError(null)
    }
    setEditedPrices({})
    setEditedCosts({})
    setLoading(false)
  }

  const fetchAvailableItems = async (branchId: string) => {
    const requestId = ++availableRequestRef.current
    const { data, error } = await posManagementService.getAvailableInventoryItems(branchId)
    if (requestId !== availableRequestRef.current) return
    if (error) {
      setAvailableItems([])
      setLoadError(toUserMessage(error))
    } else {
      setAvailableItems(data || [])
    }
  }

  const reloadBranch = async (branchId: string) => {
    await fetchPOSItems(branchId)
    await fetchBranches()
    await fetchAvailableItems(branchId)
  }

  const hasChanges = Object.keys(editedPrices).length > 0 || Object.keys(editedCosts).length > 0

  // Actions that reload the list drop unsaved edits: ask first
  const confirmDiscardChanges = () =>
    !hasChanges || confirm('لديك تغييرات غير محفوظة ستُفقد. هل تريد المتابعة؟')

  const handleSelectBranch = (branchId: string) => {
    if (branchId === selectedBranch) return
    if (!confirmDiscardChanges()) return
    setSelectedBranch(branchId)
  }

  const handlePriceInput = (id: string, value: string) => {
    setEditedPrices(prev => ({ ...prev, [id]: { ...prev[id], price: value } }))
  }

  const handleToggleAvailable = (item: BranchPOSItem) => {
    setEditedPrices(prev => {
      const current = prev[item.id]?.is_available ?? item.is_available
      const edit: RowEdit = { ...prev[item.id], is_available: !current }
      if (edit.is_available === item.is_available) delete edit.is_available
      const next = { ...prev }
      if (edit.price === undefined && edit.is_available === undefined) delete next[item.id]
      else next[item.id] = edit
      return next
    })
  }

  const handleCostChange = (itemId: string, value: string) => {
    setEditedCosts(prev => ({
      ...prev,
      [itemId]: value
    }))
  }

  const handleSave = async () => {
    if (!selectedBranch || !hasChanges || busy) return

    // Selling prices / availability
    const items: POSItemChange[] = []
    for (const [id, edit] of Object.entries(editedPrices)) {
      const row = posItems.find(p => p.id === id)
      if (!row) continue
      const change: POSItemChange = { id }
      if (edit.price !== undefined) {
        const price = parseDecimal(edit.price)
        if (price === null || roundMoney(price) <= 0) {
          alert(`سعر البيع غير صالح للمنتج "${row.item?.name_ar || ''}". أدخل سعراً أكبر من صفر`)
          return
        }
        if (roundMoney(price) !== roundMoney(row.price)) change.price = roundMoney(price)
      }
      if (edit.is_available !== undefined && edit.is_available !== row.is_available) change.is_available = edit.is_available
      // A product priced 0 would be sold for 0 EGP: it can only be shown once it has a price
      const resultingPrice = change.price ?? roundMoney(row.price)
      const resultingAvailable = change.is_available ?? row.is_available
      if (resultingAvailable && resultingPrice <= 0 && (change.price !== undefined || change.is_available !== undefined)) {
        alert(`المنتج "${row.item?.name_ar || ''}" سعره صفر. أدخل سعر بيع أكبر من صفر قبل إظهاره للكاشير`)
        return
      }
      if (change.price !== undefined || change.is_available !== undefined) items.push(change)
    }

    // Item costs (purchase prices)
    const costs: ItemCostChange[] = []
    for (const [itemId, value] of Object.entries(editedCosts)) {
      const row = posItems.find(p => p.item_id === itemId)
      const cost = parseDecimal(value)
      if (cost === null || cost < 0) {
        alert(`سعر التكلفة غير صالح للمنتج "${row?.item?.name_ar || ''}". أدخل رقماً صفراً أو أكبر`)
        return
      }
      if (row && cost !== Number(row.item?.purchase_price ?? 0)) costs.push({ item_id: itemId, cost })
    }

    if (items.length === 0 && costs.length === 0) {
      setEditedPrices({})
      setEditedCosts({})
      return
    }

    setSaving(true)
    const { error } = await posManagementService.saveChanges(selectedBranch, items, costs)
    if (error) {
      alert(toUserMessage(error))
    } else {
      await fetchPOSItems(selectedBranch)
    }
    setSaving(false)
  }

  const handleRemoveItem = async (id: string) => {
    if (!selectedBranch || busy) return
    if (!confirm('هل أنت متأكد من إزالة هذا المنتج من نقطة البيع؟')) return
    if (!confirmDiscardChanges()) return

    setSaving(true)
    const { error } = await posManagementService.removeItemFromPOS(id)
    if (error) alert(toUserMessage(error))
    await reloadBranch(selectedBranch)
    setSaving(false)
  }

  const handleAddItem = async () => {
    if (!selectedBranch || !selectedItemToAdd || busy) return
    const price = parseDecimal(newItemPrice)
    if (price === null || roundMoney(price) <= 0) {
      alert('أدخل سعر بيع صحيح أكبر من صفر')
      return
    }
    if (!confirmDiscardChanges()) return

    setSaving(true)
    const { error } = await posManagementService.addItemToPOS(
      selectedBranch,
      selectedItemToAdd,
      roundMoney(price)
    )

    if (error) {
      alert(toUserMessage(error))
    } else {
      setShowAddItemModal(false)
      setSelectedItemToAdd('')
      setNewItemPrice('')
      await fetchPOSItems(selectedBranch)
      await fetchBranches()
    }
    setSaving(false)
  }

  const handleBulkAddAll = async () => {
    if (!selectedBranch || busy) return

    // Items not yet in POS
    const newItems = itemsToAdd
    if (newItems.length === 0) {
      alert('كل أصناف المخزون موجودة بالفعل في نقطة البيع')
      return
    }

    if (!confirm(
      `هل تريد إضافة ${newItems.length} صنف من المخزون إلى نقطة البيع؟\nسيتم استخدام سعر البيع الموجود في كل صنف.\n` +
      'الأصناف التي ليس لها سعر تُضاف مخفية عن الكاشير حتى تُدخل سعرها.'
    )) {
      return
    }
    if (!confirmDiscardChanges()) return

    setBulkAdding(true)
    const { data, error } = await posManagementService.addAllInventoryItems(selectedBranch)
    if (error) {
      setBulkAdding(false)
      alert(toUserMessage(error))
      return
    }

    await reloadBranch(selectedBranch)
    setBulkAdding(false)

    let msg = `تم إضافة ${data?.added ?? 0} صنف بنجاح`
    if (data?.repriced) {
      msg += `\nتم تحديث سعر ${data.repriced} صنف كان سعره صفراً`
      // Repricing keeps a row's visibility, and a row priced 0 is always hidden, so these normally stay hidden
      const repricedHidden = (data as { repriced_hidden?: number }).repriced_hidden ?? data.repriced
      if (repricedHidden > 0) msg += `\nمنها ${repricedHidden} صنف مخفي عن الكاشير، أظهره من عمود الحالة إذا كان للبيع.`
    }
    if (data?.hidden_no_price) {
      msg += `\n${data.hidden_no_price} صنف منها ليس له سعر في بيانات الصنف، فأضيف مخفياً عن الكاشير - أدخل سعره ثم أظهره`
    }
    alert(msg)
  }

  const handleFixPrices = async () => {
    if (!selectedBranch || busy) return

    if (!confirm('هل تريد تحديث أسعار البيع من المخزون؟\nسيتم استبدال كل الأسعار الصفرية بالسعر الموجود في بيانات الصنف.')) return
    if (!confirmDiscardChanges()) return

    setFixingPrices(true)
    const { updated, updatedHidden, remaining, error } = await posManagementService.fixPricesFromInventory(selectedBranch)
    // Reload also when nothing was updated: rows still priced 0 may have just been hidden
    if (!error && (updated > 0 || remaining > 0)) await fetchPOSItems(selectedBranch)
    setFixingPrices(false)

    const remainingNote = `${remaining} منتج بسعر صفر لا يمكن تحديثه تلقائياً لأن الصنف ليس له سعر بيع أو شراء، ` +
      'وهو مخفي عن الكاشير حتى تُدخل سعره يدوياً.'
    if (error) {
      alert(toUserMessage(error))
    } else if (updated === 0 && remaining === 0) {
      alert('لا توجد أسعار صفرية تحتاج إلى تحديث ✓')
    } else if (updated === 0) {
      alert(`يوجد ${remainingNote}`)
    } else {
      let msg = `تم تحديث ${updated} سعر بنجاح ✓`
      if (updatedHidden > 0) msg += `\nمنها ${updatedHidden} منتج مخفي عن الكاشير، أظهره من عمود الحالة إذا كان للبيع.`
      if (remaining > 0) msg += `\nبقي ${remainingNote}`
      alert(msg)
    }
  }

  const handleCopyPrices = async () => {
    if (!selectedBranch || !copySourceBranch || busy) return

    const source = branches.find(b => b.id === copySourceBranch)
    const target = branches.find(b => b.id === selectedBranch)
    if (!confirm(
      `سيتم نسخ ${source?.itemCount ?? 0} منتج بأسعارها من "${source?.name_ar || source?.name || ''}" إلى "${target?.name_ar || target?.name || ''}".\n` +
      'المنتجات الموجودة في الفرعين ستأخذ سعر الفرع المصدر (إلا إذا كان سعرها فيه صفراً)، ولن تتغير أسعار أي فرع آخر.\n' +
      'هل تريد المتابعة؟'
    )) return
    if (!confirmDiscardChanges()) return

    setSaving(true)
    const { data, error } = await posManagementService.copyPricesFromBranch(copySourceBranch, selectedBranch)
    if (error) {
      setSaving(false)
      alert(toUserMessage(error))
      return
    }
    setShowCopyModal(false)
    setCopySourceBranch('')
    await reloadBranch(selectedBranch)
    setSaving(false)
    let msg = `تم النسخ بنجاح ✓\nمنتجات جديدة: ${data?.inserted ?? 0}\nأسعار محدثة: ${data?.updated ?? 0}`
    if (data?.hidden_no_price) {
      msg += `\n${data.hidden_no_price} منتج من الجديدة سعره صفر في الفرع المصدر، فأضيف مخفياً عن الكاشير حتى تُدخل سعره`
    }
    alert(msg)
  }

  const handleApplyPercent = async () => {
    if (!selectedBranch || !percentValue || busy) return

    const percent = parseDecimal(percentValue)
    if (percent === null || percent === 0 || percent < MIN_PERCENT || percent > MAX_PERCENT) {
      alert(`أدخل نسبة صحيحة بين ${MIN_PERCENT} و ${MAX_PERCENT} (لا تساوي صفراً)`)
      return
    }

    const branchName = selectedBranchData?.name_ar || selectedBranchData?.name || ''
    const pricedCount = posItems.filter(p => p.price > 0).length
    if (!confirm(
      `سيتم ${percent > 0 ? 'زيادة' : 'تخفيض'} كل أسعار فرع "${branchName}" (${pricedCount} منتج) بنسبة ${Math.abs(percent)}%.\n` +
      `مثال: سعر 100 يصبح ${roundMoney(100 * (1 + percent / 100))}.\nهل أنت متأكد؟`
    )) return
    if (!confirmDiscardChanges()) return

    setSaving(true)
    const { data, error } = await posManagementService.applyPercentageChange(selectedBranch, percent)
    if (error) {
      setSaving(false)
      alert(toUserMessage(error))
      return
    }
    setShowPercentModal(false)
    setPercentValue('')
    await fetchPOSItems(selectedBranch)
    setSaving(false)
    alert(`تم تحديث ${data?.updated ?? 0} سعر بنجاح ✓`)
  }

  const filteredPOSItems = posItems.filter(p => {
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    return (
      p.item?.name?.toLowerCase()?.includes(term) ||
      p.item?.name_ar?.toLowerCase()?.includes(term) ||
      p.item?.code?.toLowerCase()?.includes(term)
    )
  })

  // Filter available items to exclude already added ones (unless their price is 0 and we can fix it)
  const itemsToAdd = availableItems.filter(
    avail => {
      const pos = posItems.find(pos => pos.item_id === avail.id)
      if (!pos) return true // Not added yet

      // If it's already added but price is 0, and inventory has a valid price, include it for update
      const validPrice = roundMoney(Number(avail.selling_price || 0) || Number(avail.purchase_price || 0))
      if (roundMoney(pos.price) <= 0 && validPrice > 0) return true

      return false
    }
  )

  const selectedBranchData = branches.find(b => b.id === selectedBranch)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">إدارة نقاط البيع</h1>
          <p className="text-gray-600 mt-1">إدارة المنتجات المتاحة للبيع في كل فرع</p>
        </div>
      </div>

      {loadError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {loadError}
        </div>
      )}

      {/* Branch Selection */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Store className="w-5 h-5 text-blue-600" />
          اختر الفرع
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {branches.map(branch => (
            <button
              type="button"
              key={branch.id}
              onClick={() => handleSelectBranch(branch.id)}
              disabled={busy}
              className={`p-4 rounded-lg border-2 text-right transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                selectedBranch === branch.id
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  selectedBranch === branch.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                }`}>
                  {branch.code}
                </span>
                {selectedBranch === branch.id && (
                  <Check className="w-5 h-5 text-blue-600" />
                )}
              </div>
              <h3 className="font-semibold text-gray-900 mt-2">{branch.name_ar || branch.name}</h3>
              <p className="text-sm text-gray-500 mt-1">{branch.itemCount} منتج</p>
            </button>
          ))}
        </div>
      </div>

      {/* POS Items Management */}
      {selectedBranch && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          {/* Toolbar */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-green-600" />
                <h2 className="text-lg font-semibold text-gray-900">
                  منتجات {selectedBranchData?.name_ar || selectedBranchData?.name}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="بحث..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pr-10 pl-4 py-2 border border-gray-300 rounded-lg text-sm w-48"
                  />
                </div>

                {/* Actions */}
                <button
                  type="button"
                  onClick={() => setShowAddItemModal(true)}
                  disabled={busy || loading}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="إضافة منتج"
                >
                  <Plus className="w-4 h-4" />
                  إضافة منتج
                </button>

                <button
                  type="button"
                  onClick={handleBulkAddAll}
                  disabled={busy || loading || itemsToAdd.length === 0}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={`إضافة كل أصناف المخزون (${itemsToAdd.length} صنف)`}
                >
                  {bulkAdding ? (
                    <span className="w-4 h-4 border-2 border-teal-700 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <PackagePlus className="w-4 h-4" />
                  )}
                  {bulkAdding
                    ? 'جاري الإضافة...'
                    : `إضافة الكل (${itemsToAdd.length})`
                  }
                </button>

                {/* Fix Prices Button */}
                <button
                  type="button"
                  onClick={handleFixPrices}
                  disabled={busy || loading}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-yellow-50 text-yellow-700 rounded-lg hover:bg-yellow-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="تحديث أسعار البيع من المخزون"
                >
                  {fixingPrices ? (
                    <span className="w-4 h-4 border-2 border-yellow-700 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {fixingPrices ? 'جاري التحديث...' : 'تحديث الأسعار'}
                </button>

                <button
                  type="button"
                  onClick={() => setShowPercentModal(true)}
                  disabled={busy || loading}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="تطبيق نسبة مئوية"
                >
                  <Percent className="w-4 h-4" />
                  نسبة
                </button>

                <button
                  type="button"
                  onClick={() => setShowCopyModal(true)}
                  disabled={busy || loading}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="نسخ من فرع آخر"
                >
                  <Copy className="w-4 h-4" />
                  نسخ
                </button>

                {hasChanges && (
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={busy}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    حفظ التغييرات
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">الكود</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">المنتج</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">النوع</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">الوحدة</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">الكمية المتاحة</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">سعر التكلفة</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">سعر البيع</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">الربح</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">الحالة</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center">
                      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : filteredPOSItems.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                      لا توجد منتجات
                    </td>
                  </tr>
                ) : (
                  filteredPOSItems.map(item => {
                    const edited = editedPrices[item.id]
                    const priceText = edited?.price ?? String(item.price)
                    const parsedPrice = parseDecimal(priceText)
                    const priceInvalid = edited?.price !== undefined && (parsedPrice === null || roundMoney(parsedPrice) <= 0)
                    const currentPrice = parsedPrice ?? 0
                    const currentAvailable = edited?.is_available ?? item.is_available
                    const stockQty = item.stock_quantity || 0
                    const inStock = item.in_stock || false

                    // Cost price - use calculated cost for recipes, purchase price for regular items
                    const isRecipe = item.item?.is_recipe || false
                    const editedCost = editedCosts[item.item_id]
                    const baseCost = isRecipe
                      ? (item.item?.calculated_cost ?? 0)
                      : Number(item.item?.purchase_price ?? 0)
                    const costText = editedCost ?? String(baseCost)
                    const parsedCost = parseDecimal(costText)
                    const costInvalid = editedCost !== undefined && (parsedCost === null || parsedCost < 0)
                    const currentCost = parsedCost ?? 0

                    // Profit calculation
                    const profit = roundMoney(currentPrice - currentCost)
                    const profitPercent = currentCost > 0 ? ((profit / currentCost) * 100) : 0

                    const hasEdits = edited || editedCost !== undefined

                    return (
                      <tr key={item.id} className={hasEdits ? 'bg-yellow-50' : ''}>
                        <td className="px-4 py-3">
                          <span className="text-sm font-mono text-gray-600">
                            {item.item?.code}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-gray-900">{item.item?.name_ar}</p>
                            <p className="text-sm text-gray-500">{item.item?.name}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-sm ${
                            item.item?.is_recipe
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}>
                            {item.item?.is_recipe ? 'ريسبي' : 'منتج'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">
                            {item.item?.unit?.name_ar || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`font-medium ${
                            inStock ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {stockQty.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={costText}
                              onChange={(e) => handleCostChange(item.item_id, e.target.value)}
                              disabled={isRecipe || busy}
                              className={`w-24 px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 ${
                                isRecipe
                                  ? 'bg-purple-50 border-purple-200 cursor-not-allowed'
                                  : costInvalid ? 'border-red-500' : 'border-gray-300'
                              }`}
                              min="0"
                              step="0.01"
                              aria-label={`سعر التكلفة ${item.item?.name_ar}`}
                              title={isRecipe ? 'محسوب تلقائياً من المكونات' : 'سعر الشراء'}
                            />
                            {isRecipe && (
                              <span className="text-xs text-purple-600" title="محسوب من المكونات">
                                🧮
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={priceText}
                            onChange={(e) => handlePriceInput(item.id, e.target.value)}
                            disabled={busy}
                            className={`w-24 px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 ${
                              priceInvalid ? 'border-red-500' : 'border-gray-300'
                            }`}
                            min="0"
                            step="0.01"
                            aria-label={`سعر البيع ${item.item?.name_ar}`}
                            title={priceInvalid ? 'أدخل سعراً أكبر من صفر' : undefined}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm">
                            <div className={`font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {profit.toFixed(2)} ج
                            </div>
                            <div className={`text-xs ${profitPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {profitPercent.toFixed(1)}%
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleAvailable(item)}
                            disabled={busy}
                            className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                              currentAvailable
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-red-100 text-red-700 hover:bg-red-200'
                            }`}
                            title={currentAvailable
                              ? 'متاح - اضغط للإخفاء'
                              : currentPrice <= 0 ? 'غير متاح - أدخل سعر البيع ثم اضغط للإظهار' : 'غير متاح - اضغط للإظهار'}
                          >
                            {currentAvailable ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            disabled={busy}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                            title="إزالة من نقطة البيع"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Item Modal */}
      {showAddItemModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">إضافة منتج لنقطة البيع</h3>
              <button type="button" onClick={() => setShowAddItemModal(false)} className="p-2 hover:bg-gray-100 rounded-lg" title="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-gray-600 mb-4">اختر منتج من المخزن لإضافته لنقطة البيع</p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">المنتج</label>
              <select
                value={selectedItemToAdd}
                onChange={(e) => setSelectedItemToAdd(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                aria-label="اختر المنتج"
              >
                <option value="">اختر المنتج...</option>
                {itemsToAdd.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name_ar} ({item.is_recipe ? 'ريسبي' : 'منتج'}) - متاح: {item.stock_quantity.toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">السعر</label>
              <input
                type="number"
                value={newItemPrice}
                onChange={(e) => setNewItemPrice(e.target.value)}
                placeholder="أدخل السعر"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                aria-label="السعر"
                min="0"
                step="0.01"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowAddItemModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleAddItem}
                disabled={!selectedItemToAdd || !newItemPrice || busy}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? 'جاري الإضافة...' : 'إضافة'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Modal */}
      {showCopyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">نسخ المنتجات من فرع آخر</h3>
              <button type="button" onClick={() => setShowCopyModal(false)} className="p-2 hover:bg-gray-100 rounded-lg" title="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-gray-600 mb-4">اختر الفرع المصدر لنسخ منتجاته وأسعاره إلى الفرع الحالي</p>
            <select
              value={copySourceBranch}
              onChange={(e) => setCopySourceBranch(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-4"
              aria-label="اختر الفرع المصدر"
            >
              <option value="">اختر الفرع...</option>
              {branches.filter(b => b.id !== selectedBranch).map(branch => (
                <option key={branch.id} value={branch.id}>
                  {branch.name_ar || branch.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCopyModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleCopyPrices}
                disabled={!copySourceBranch || busy}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'جاري النسخ...' : 'نسخ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Percent Modal */}
      {showPercentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">تطبيق نسبة مئوية</h3>
              <button type="button" onClick={() => setShowPercentModal(false)} className="p-2 hover:bg-gray-100 rounded-lg" title="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-gray-600 mb-4">أدخل النسبة المئوية للزيادة أو النقصان (مثال: 10 للزيادة 10%، -5 للنقصان 5%). المسموح من {MIN_PERCENT}% إلى {MAX_PERCENT}%.</p>
            <input
              type="number"
              value={percentValue}
              onChange={(e) => setPercentValue(e.target.value)}
              placeholder="مثال: 10 أو -5"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-4"
              aria-label="النسبة المئوية"
              min={MIN_PERCENT}
              max={MAX_PERCENT}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowPercentModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleApplyPercent}
                disabled={!percentValue || busy}
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {saving ? 'جاري التطبيق...' : 'تطبيق'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
