import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { inventoryService, InventoryWithDetails, ItemSaveData } from '../../services/inventory.service'
import { branchesService } from '../../services/branches.service'
import { Branch } from '../../types/database.types'
import { Package, Search, Filter, Plus, Download, Upload, Edit2, Save, X, Trash2, Barcode as BarcodeIcon, Copy, Check, CheckSquare, Square, PackageX } from 'lucide-react'
import ReactBarcode from 'react-barcode'
import { formatNumber, parseDecimal, roundMoney, roundQuantity } from '../../lib/utils'
import { exportToExcel, inventoryColumns } from '../../lib/excel'
import { toUserMessage } from '../../lib/errors'
import { toLocalDate } from '../../lib/dates'
import { useAuth } from '../../contexts/AuthContext'
import { displayCode, roleName, unitLabel } from './stockHelpers'
import StockImportDialog from './StockImportDialog'

// Values of the row being edited (numbers kept as typed text, validated on save)
interface EditForm {
  name_ar: string
  code: string
  barcode: string
  purchase_price: string
  selling_price: string
  quantity: string
  opening_balance: string
  category_id: string
}

const EMPTY_EDIT: EditForm = {
  name_ar: '',
  code: '',
  barcode: '',
  purchase_price: '',
  selling_price: '',
  quantity: '',
  opening_balance: '',
  category_id: ''
}

type StockItem = { id: string; code?: string; barcode?: string | null; name_ar?: string; category?: { id?: string; name_ar: string } | null; category_id?: string | null; unit?: unknown; purchase_price?: number | null; selling_price?: number | null; min_stock_level?: number | null }

export default function StockList() {
  const { user } = useAuth()
  const isAdmin = roleName(user?.role) === 'admin'
  const canEditItems = ['admin', 'warehouse_manager'].includes(roleName(user?.role) || '')

  const [stock, setStock] = useState<InventoryWithDetails[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [mainWarehouseId, setMainWarehouseId] = useState<string | null>(null)
  const [mainWarehouseName, setMainWarehouseName] = useState('')
  const [categories, setCategories] = useState<{ id: string; name_ar: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(250)
  const [showImport, setShowImport] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingInv, setEditingInv] = useState<InventoryWithDetails | null>(null)
  const [editFormData, setEditFormData] = useState<EditForm>(EMPTY_EDIT)
  const [editOriginal, setEditOriginal] = useState<EditForm>(EMPTY_EDIT)
  const [saving, setSaving] = useState(false)
  const [showBarcode, setShowBarcode] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [busyRowId, setBusyRowId] = useState<string | null>(null)
  const stockRequestRef = useRef(0)

  // The branch whose stock is shown: the selected branch, or the main warehouse
  const stockBranchId = selectedBranch || mainWarehouseId || ''
  const isMainWarehouse = !selectedBranch

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (stockBranchId) fetchStock()
  }, [stockBranchId])

  const fetchData = async () => {
    const [branchesRes, categoriesRes] = await Promise.all([
      branchesService.getActive(),
      inventoryService.getCategories(),
    ])
    if (branchesRes.error || categoriesRes.error) {
      setLoadError('تعذر تحميل الفروع أو المجموعات: ' + toUserMessage(branchesRes.error || categoriesRes.error))
    }
    const allBranches = branchesRes.data || []
    // Filter out main warehouse from dropdown (it's the default option)
    setBranches(allBranches.filter(b => !b.is_main_warehouse))
    setCategories(categoriesRes.data || [])

    const mainWarehouse = allBranches.find(b => b.is_main_warehouse)
    if (mainWarehouse) {
      setMainWarehouseId(mainWarehouse.id)
      setMainWarehouseName(mainWarehouse.name_ar || '')
    } else {
      if (!branchesRes.error) setLoadError('لم يتم تحديد مخزن رئيسي. حدّده من صفحة الفروع')
      setLoading(false)
    }
  }

  const fetchStock = async () => {
    const branchId = stockBranchId
    if (!branchId) return
    const request = ++stockRequestRef.current
    setLoading(true)
    const { data, error } = await inventoryService.getStockByBranch(branchId)
    if (request !== stockRequestRef.current) return // a newer branch was selected meanwhile
    if (error) setLoadError('تعذر تحميل المخزون: ' + toUserMessage(error))
    else setLoadError('')
    setStock(data || [])
    setLoading(false)
  }

  const filteredStock = stock.filter((inv) => {
    const item = inv.item as unknown as StockItem
    const term = search.trim()
    const matchesSearch =
      !term ||
      item?.name_ar?.includes(term) ||
      item?.code?.toLowerCase().includes(term.toLowerCase()) ||
      (item?.barcode || '').includes(term)
    const matchesCategory = !selectedCategory || item?.category?.id === selectedCategory
    return matchesSearch && matchesCategory
  })

  // Pagination
  const totalPages = Math.ceil(filteredStock.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedStock = filteredStock.slice(startIndex, endIndex)

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [search, selectedCategory, selectedBranch])

  // A selection only ever covers rows the user can see: clear it when the filters, branch or page change
  useEffect(() => {
    setSelectedItems(new Set())
  }, [search, selectedCategory, selectedBranch, currentPage])

  // Handle edit item
  const handleEditItem = (inv: InventoryWithDetails) => {
    const item = inv.item as unknown as StockItem
    // Codes are kept exactly as stored (no number conversion: '1E5' stays '1E5')
    const values: EditForm = {
      name_ar: item.name_ar || '',
      code: displayCode(item.code),
      barcode: displayCode(item.barcode),
      purchase_price: String(item.purchase_price ?? 0),
      selling_price: String(item.selling_price ?? 0),
      quantity: String(inv.quantity ?? 0),
      opening_balance: String(inv.opening_balance ?? 0),
      category_id: item.category_id || item.category?.id || ''
    }
    setEditingItemId(item.id)
    setEditingInv(inv)
    setEditFormData(values)
    setEditOriginal(values)
  }

  const handleCancelEdit = () => {
    setEditingItemId(null)
    setEditingInv(null)
    setEditFormData(EMPTY_EDIT)
    setEditOriginal(EMPTY_EDIT)
  }

  const handleSaveEdit = async () => {
    if (!editingItemId || !editingInv || saving) return

    // Numbers: empty or invalid input is rejected, never silently turned into 0
    const readNumber = (text: string, label: string): number | string => {
      const value = parseDecimal(text)
      if (value === null) return `قيمة "${label}" غير صحيحة`
      if (value < 0) return `قيمة "${label}" لا يمكن أن تكون سالبة`
      return value
    }
    const purchase = readNumber(editFormData.purchase_price, 'سعر الشراء')
    const selling = readNumber(editFormData.selling_price, 'سعر البيع')
    const quantity = readNumber(editFormData.quantity, 'الكمية')
    const opening = readNumber(editFormData.opening_balance, 'رصيد أول المدة')
    const invalid = [purchase, selling, quantity, opening].find(v => typeof v === 'string')
    if (typeof invalid === 'string') {
      alert(invalid)
      return
    }
    if (!editFormData.code.trim() || !editFormData.name_ar.trim()) {
      alert('كود الصنف واسم الصنف مطلوبان')
      return
    }

    // Send only what the user changed, so nothing else is overwritten with values loaded earlier
    const changed = (field: keyof EditForm) => editFormData[field].trim() !== editOriginal[field].trim()
    const itemChanges: ItemSaveData = {}
    if (changed('name_ar')) itemChanges.name_ar = editFormData.name_ar.trim()
    if (changed('code')) itemChanges.code = editFormData.code.trim()
    if (changed('barcode')) itemChanges.barcode = editFormData.barcode.trim() || null
    if (changed('purchase_price')) itemChanges.purchase_price = roundMoney(purchase as number)
    if (changed('selling_price')) itemChanges.selling_price = roundMoney(selling as number)
    if (changed('category_id')) itemChanges.category_id = editFormData.category_id || null
    const quantityChanged = roundQuantity(quantity as number) !== roundQuantity(Number(editingInv.quantity ?? 0))
    const openingChanged = roundQuantity(opening as number) !== roundQuantity(Number(editingInv.opening_balance ?? 0))

    if (Object.keys(itemChanges).length === 0 && !quantityChanged && !openingChanged) {
      handleCancelEdit()
      return
    }

    setSaving(true)
    // One database call: item fields, opening balance and the quantity (as a logged adjustment;
    // refused when the stock moved since this list was loaded)
    const { error } = await inventoryService.saveStockRow({
      inventoryId: editingInv.id,
      item: itemChanges,
      quantity: quantityChanged ? roundQuantity(quantity as number) : null,
      expectedQuantity: quantityChanged ? Number(editingInv.quantity ?? 0) : null,
      openingBalance: openingChanged ? roundQuantity(opening as number) : null,
    })
    setSaving(false)

    if (error) {
      alert('فشل في حفظ التعديلات: ' + toUserMessage(error))
      return
    }

    handleCancelEdit()
    await fetchStock()
    alert('تم حفظ التعديلات بنجاح')
  }

  // Remove the item from this branch's stock list (the item itself stays in the system)
  const handleRemoveFromBranch = async (inv: InventoryWithDetails) => {
    if (busyRowId) return
    const item = inv.item as unknown as StockItem
    const itemName = item?.name_ar || item?.code || 'غير معروف'
    const qty = Number(inv.quantity || 0)
    let message = `إزالة الصنف "${itemName}" من مخزون ${selectedBranchName}؟\nالصنف نفسه يبقى في النظام وفي الفروع الأخرى.`
    if (qty > 0) message += `\nسيتم تصفير رصيده (${formatNumber(qty)}) وتسجيل ذلك كتسوية مخزون.`
    if (!confirm(message)) return

    setBusyRowId(inv.id)
    const { data: removed, error } = await inventoryService.removeStockRows([inv.id])
    setBusyRowId(null)
    if (error) {
      alert('فشل في حذف الصنف من مخزون الفرع: ' + toUserMessage(error))
      return
    }
    setStock(prev => prev.filter(s => s.id !== inv.id))
    alert(removed ? `تم حذف "${itemName}" من مخزون ${selectedBranchName}` : `"${itemName}" محذوف من مخزون الفرع بالفعل`)
  }

  // Delete the item from the whole system (refused while it has stock, is a recipe ingredient or has history)
  const handleDeleteItem = async (inv: InventoryWithDetails) => {
    if (busyRowId) return
    const item = inv.item as unknown as StockItem
    const itemName = item?.name_ar || item?.code || 'غير معروف'
    if (!confirm(`حذف الصنف "${itemName}" من النظام نهائياً (من كل الفروع)؟\nلا يمكن حذف صنف له رصيد أو مستخدم في وصفة أو له عمليات سابقة؛ اجعله غير نشط بدلاً من ذلك.`)) {
      return
    }
    setBusyRowId(inv.id)
    const { error } = await inventoryService.deleteItem(item.id)
    setBusyRowId(null)
    if (error) {
      alert('فشل حذف الصنف: ' + toUserMessage(error))
      return
    }
    setStock(prev => prev.filter(s => s.id !== inv.id))
    alert(`تم حذف الصنف "${itemName}" من النظام`)
  }

  // Copy code/barcode to clipboard
  const handleCopyCode = (text: string, itemId: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(itemId)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  // Bulk selection handlers
  const handleToggleSelect = (invId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(invId)) {
        next.delete(invId)
      } else {
        next.add(invId)
      }
      return next
    })
  }

  const allOnPageSelected = paginatedStock.length > 0 && paginatedStock.every(inv => selectedItems.has(inv.id))

  const handleSelectAll = () => {
    if (allOnPageSelected) {
      // Deselect all
      setSelectedItems(new Set())
    } else {
      // Select all on current page
      setSelectedItems(new Set(paginatedStock.map(inv => inv.id)))
    }
  }

  // Only rows that are visible right now can be acted on
  const selectedVisible = filteredStock.filter(inv => selectedItems.has(inv.id))

  const handleBulkRemove = async () => {
    if (selectedVisible.length === 0 || bulkDeleting) return

    const count = selectedVisible.length
    const withStock = selectedVisible.filter(inv => Number(inv.quantity || 0) > 0).length
    let message = `إزالة ${count} صنف من مخزون ${selectedBranchName}؟\nالأصناف نفسها تبقى في النظام.`
    if (withStock > 0) message += `\n${withStock} منها لها رصيد سيتم تصفيره وتسجيله كتسوية مخزون.`
    if (!confirm(message)) return

    setBulkDeleting(true)
    const { data: removed, error } = await inventoryService.removeStockRows(selectedVisible.map(inv => inv.id))
    setBulkDeleting(false)
    if (error) {
      alert('فشل الحذف ولم يتم حذف أي صنف: ' + toUserMessage(error))
      return
    }
    setSelectedItems(new Set())
    await fetchStock()
    let msg = `تم حذف ${removed ?? 0} صنف من مخزون ${selectedBranchName}`
    if ((removed ?? 0) < count) msg += `\n${count - (removed ?? 0)} صنف كان محذوفاً بالفعل`
    alert(msg)
  }

  // Group by category for display
  const groupedStock = paginatedStock.reduce(
    (acc, inv) => {
      const item = inv.item as unknown as StockItem
      const categoryName = item?.category?.name_ar || 'بدون تصنيف'
      if (!acc[categoryName]) {
        acc[categoryName] = []
      }
      acc[categoryName].push(inv)
      return acc
    },
    {} as Record<string, InventoryWithDetails[]>
  )

  // Get selected branch name (the main warehouse's real name, as the export writes it)
  const selectedBranchName = selectedBranch
    ? branches.find(b => b.id === selectedBranch)?.name_ar || 'الفرع'
    : mainWarehouseName || 'المخزن الرئيسي'

  // Format date helper (Cairo calendar date)
  const formatDate = (date: string) => {
    const [y, m, d] = toLocalDate(date).split('-')
    return `${Number(d)}/${Number(m)}/${y}`
  }

  // Generate document number
  const getDocNumber = (date: string, index: number) => `${formatDate(date)}-${String(index + 1).padStart(2, '0')}`

  // Export to Excel (codes are written so Excel keeps them as text)
  const handleExport = () => {
    const exportData = filteredStock.map(inv => {
      const item = inv.item as unknown as StockItem
      const branch = inv.branch as { name_ar?: string } | undefined
      return {
        item_code: displayCode(item?.code),
        item_barcode: displayCode(item?.barcode),
        item_name: item?.name_ar || '',
        category_name: item?.category?.name_ar || '',
        branch_name: branch?.name_ar || selectedBranchName,
        quantity: Number(inv.quantity || 0),
        unit: unitLabel(item?.unit, ''),
        min_quantity: Number(inv.min_quantity || 0),
        opening_balance: Number(inv.opening_balance || 0), // رصيد أول المدة - actual field
        purchase_price: Number(item?.purchase_price || 0),
        selling_price: Number(item?.selling_price || 0),
      }
    })
    exportToExcel(exportData, inventoryColumns, `مخزون_${selectedBranchName}`)
  }

  const totalQuantity = roundQuantity(filteredStock.reduce((sum, i) => sum + Number(i.quantity || 0), 0))
  const lowStockCount = filteredStock.filter(i => Number(i.quantity || 0) < Number(i.item?.min_stock_level ?? 10)).length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const renderCodeCell = (item: StockItem, displayValue: string) => (
    <div className="flex items-center gap-2">
      {showBarcode && displayValue !== '-' ? (
        <div className="bg-white p-1 rounded border border-gray-200 inline-block overflow-hidden flex-shrink-0" style={{ maxWidth: '100px' }}>
          <ReactBarcode
            value={displayValue}
            height={30}
            width={1.2}
            fontSize={11}
            margin={0}
            background="transparent"
          />
        </div>
      ) : (
        <span className="text-gray-900 font-mono text-sm select-all" dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>{displayValue}</span>
      )}
      {displayValue !== '-' && (
        <button
          type="button"
          onClick={() => handleCopyCode(displayValue, item.id)}
          className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors shrink-0"
          title="نسخ الكود"
        >
          {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  )

  const renderCodeInputs = () => (
    <div className="space-y-1">
      <input
        type="text"
        value={editFormData.code}
        onChange={(e) => setEditFormData({ ...editFormData, code: e.target.value })}
        className="w-full px-2 py-1 border border-blue-300 rounded text-sm font-mono"
        dir="ltr"
        placeholder="الكود"
        title="كود الصنف"
      />
      <input
        type="text"
        value={editFormData.barcode}
        onChange={(e) => setEditFormData({ ...editFormData, barcode: e.target.value })}
        className="w-full px-2 py-1 border border-orange-300 rounded text-sm font-mono"
        dir="ltr"
        placeholder="الباركود"
        title="الباركود"
      />
    </div>
  )

  const renderCategoryCell = (isEditing: boolean, categoryName: string) =>
    isEditing ? (
      <select
        value={editFormData.category_id}
        onChange={(e) => setEditFormData({ ...editFormData, category_id: e.target.value })}
        className="w-full px-2 py-1 border border-blue-300 rounded text-sm"
        aria-label="المجموعة"
      >
        <option value="">بدون تصنيف</option>
        {editOriginal.category_id && !categories.some(c => c.id === editOriginal.category_id) && (
          <option value={editOriginal.category_id}>{categoryName} (غير نشطة)</option>
        )}
        {categories.map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.name_ar}
          </option>
        ))}
      </select>
    ) : (
      categoryName
    )

  const renderNumberInput = (field: 'quantity' | 'opening_balance' | 'purchase_price' | 'selling_price', width: string, title: string) => (
    <input
      type="text"
      inputMode="decimal"
      value={editFormData[field]}
      onChange={(e) => setEditFormData({ ...editFormData, [field]: e.target.value })}
      className={`${width} px-2 py-1 border border-blue-300 rounded text-sm`}
      dir="ltr"
      title={title}
      aria-label={title}
    />
  )

  const renderActions = (inv: InventoryWithDetails, isEditing: boolean) =>
    isEditing ? (
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={handleSaveEdit}
          disabled={saving}
          className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg disabled:opacity-50"
          title="حفظ"
        >
          <Save className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleCancelEdit}
          disabled={saving}
          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
          title="إلغاء"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    ) : (
      <div className="flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => handleEditItem(inv)}
          disabled={editingItemId !== null}
          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-40"
          title="تعديل"
        >
          <Edit2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => handleRemoveFromBranch(inv)}
          disabled={busyRowId !== null}
          className="p-1.5 text-orange-600 hover:bg-orange-50 rounded-lg disabled:opacity-40"
          title="حذف من مخزون هذا الفرع"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => handleDeleteItem(inv)}
            disabled={busyRowId !== null}
            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-40"
            title="حذف الصنف من النظام نهائياً"
          >
            <PackageX className="w-4 h-4" />
          </button>
        )}
      </div>
    )

  const renderSelectAll = (hoverClass: string, checkedClass: string) => (
    <button
      type="button"
      onClick={handleSelectAll}
      className={`p-1 ${hoverClass} rounded transition-colors`}
      title={allOnPageSelected ? 'إلغاء اختيار الكل' : 'اختيار الكل'}
    >
      {allOnPageSelected ? (
        <CheckSquare className={`w-4 h-4 ${checkedClass}`} />
      ) : (
        <Square className="w-4 h-4 text-gray-500" />
      )}
    </button>
  )

  const renderRowCheckbox = (invId: string, hoverClass: string, checkedClass: string) => (
    <button
      type="button"
      onClick={() => handleToggleSelect(invId)}
      className={`p-1 ${hoverClass} rounded transition-colors`}
    >
      {selectedItems.has(invId) ? (
        <CheckSquare className={`w-4 h-4 ${checkedClass}`} />
      ) : (
        <Square className="w-4 h-4 text-gray-400" />
      )}
    </button>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{selectedBranchName}</h1>
          <p className="text-gray-600">أرصدة المخزون والكميات المتاحة</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            title="تصدير إلى Excel"
          >
            <Download className="w-5 h-5" />
            تصدير
          </button>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            disabled={!stockBranchId}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
            title="استيراد من ملف CSV"
          >
            <Upload className="w-5 h-5" />
            استيراد
          </button>
          <Link
            to="/inventory/items/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-5 h-5" />
            إضافة صنف
          </Link>
        </div>
      </div>

      {loadError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{loadError}</div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-5 h-5 text-gray-400" />
          <span className="font-medium text-gray-700">تصفية</span>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الكود..."
              aria-label="بحث"
              className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <select
            value={selectedBranch}
            onChange={(e) => {
              handleCancelEdit()
              setSelectedBranch(e.target.value)
            }}
            aria-label="الفرع"
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">المخزن الرئيسي</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name_ar}
              </option>
            ))}
          </select>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            aria-label="المجموعة"
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">جميع المجموعات</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name_ar}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              handleCancelEdit()
              setSearch('')
              setSelectedBranch('')
              setSelectedCategory('')
            }}
            className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            إعادة تعيين
          </button>
        </div>
      </div>

      {/* Bulk Remove Action Bar */}
      {selectedVisible.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckSquare className="w-5 h-5 text-red-600" />
            <span className="font-medium text-red-800">
              تم اختيار {selectedVisible.length} صنف
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedItems(new Set())}
              className="px-4 py-2 text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              إلغاء الاختيار
            </button>
            <button
              type="button"
              onClick={handleBulkRemove}
              disabled={bulkDeleting}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2 disabled:opacity-50"
            >
              {bulkDeleting ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              حذف المحدد من مخزون الفرع ({selectedVisible.length})
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">إجمالي الأصناف</p>
          <p className="text-2xl font-bold text-gray-900">{formatNumber(filteredStock.length)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">إجمالي الكمية</p>
          <p className="text-2xl font-bold text-blue-600">
            {formatNumber(totalQuantity)}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">عدد المجموعات</p>
          <p className="text-2xl font-bold text-green-600">{formatNumber(Object.keys(groupedStock).length)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">مخزون منخفض</p>
          <p className="text-2xl font-bold text-red-600">
            {formatNumber(lowStockCount)}
          </p>
        </div>
      </div>

      {/* Stock Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {filteredStock.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">لا توجد بيانات</p>
          </div>
        ) : isMainWarehouse ? (
          /* Main Warehouse Table - Blue Header */
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-blue-100">
                <tr>
                  <th className="px-2 py-3 text-center">
                    {renderSelectAll('hover:bg-blue-200', 'text-blue-700')}
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">م</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">مجموعة</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">
                    <div className="flex items-center gap-2">
                      <span>{showBarcode ? 'باركود' : 'كود'}</span>
                      <button
                        type="button"
                        onClick={() => setShowBarcode(!showBarcode)}
                        className={`p-1 rounded transition-colors ${showBarcode ? 'bg-blue-200 text-blue-700' : 'hover:bg-blue-200 text-gray-500'}`}
                        title={showBarcode ? 'عرض الكود' : 'عرض الباركود'}
                      >
                        <BarcodeIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">اسم الصنف</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">رصيد أول المدة</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الوارد</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">المحتوى بالكمية</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الرصيد إجمالي</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">وصف المحتوى</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">سعر الشراء</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">سعر البيع</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginatedStock.map((inv, index) => {
                  const item = inv.item as unknown as StockItem
                  const categoryName = item?.category?.name_ar || '-'
                  const unitName = unitLabel(item?.unit, 'كرتونة')
                  const purchasePrice = item?.purchase_price || 0
                  const sellingPrice = item?.selling_price || 0
                  const globalIndex = startIndex + index + 1
                  const isEditing = editingItemId === item.id
                  const displayValue = (showBarcode ? displayCode(item?.barcode) || displayCode(item?.code) : displayCode(item?.code)) || '-'

                  return (
                    <tr key={inv.id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${selectedItems.has(inv.id) ? '!bg-blue-50' : ''}`}>
                      <td className="px-2 py-3 text-center">
                        {renderRowCheckbox(inv.id, 'hover:bg-blue-100', 'text-blue-600')}
                      </td>
                      <td className="px-4 py-3 text-gray-900">{globalIndex}</td>
                      <td className="px-4 py-3 text-gray-600">{renderCategoryCell(isEditing, categoryName)}</td>
                      <td className="px-4 py-3">
                        {isEditing ? renderCodeInputs() : renderCodeCell(item, displayValue)}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editFormData.name_ar}
                            onChange={(e) => setEditFormData({ ...editFormData, name_ar: e.target.value })}
                            className="w-full px-2 py-1 border border-blue-300 rounded text-sm"
                            aria-label="اسم الصنف"
                          />
                        ) : (
                          <span className="text-gray-900">{item?.name_ar || '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {isEditing ? renderNumberInput('opening_balance', 'w-24', 'رصيد أول المدة') : formatNumber(inv.opening_balance || 0)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">-</td>
                      <td className="px-4 py-3 text-gray-600">-</td>
                      <td className="px-4 py-3 text-gray-900 font-medium">
                        {isEditing ? renderNumberInput('quantity', 'w-24', 'الرصيد') : formatNumber(inv.quantity)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{unitName}</td>
                      <td className="px-4 py-3">
                        {isEditing ? renderNumberInput('purchase_price', 'w-24', 'سعر الشراء') : (
                          <span className="text-blue-600 font-medium">{formatNumber(purchasePrice)} ج</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? renderNumberInput('selling_price', 'w-24', 'سعر البيع') : (
                          <span className="text-green-600 font-medium">{formatNumber(sellingPrice)} ج</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{renderActions(inv, isEditing)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Branch Table - Red Header with Date & Document Number */
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-red-100">
                <tr>
                  <th className="px-2 py-3 text-center">
                    {renderSelectAll('hover:bg-red-200', 'text-red-700')}
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">م</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">مجموعة</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">التاريخ</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">رقم المستند</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">
                    <div className="flex items-center gap-2">
                      <span>{showBarcode ? 'باركود الصنف' : 'كود الصنف'}</span>
                      <button
                        type="button"
                        onClick={() => setShowBarcode(!showBarcode)}
                        className={`p-1 rounded transition-colors ${showBarcode ? 'bg-red-200 text-red-700' : 'hover:bg-red-200 text-gray-500'}`}
                        title={showBarcode ? 'عرض الكود' : 'عرض الباركود'}
                      >
                        <BarcodeIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">اسم الصنف</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">جزئي</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">المحتوى</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">كلي</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">وصف المحتوى</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">سعر الشراء</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">سعر البيع</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginatedStock.map((inv, index) => {
                  const item = inv.item as unknown as StockItem
                  const categoryName = item?.category?.name_ar || '-'
                  const unitName = unitLabel(item?.unit, 'قطعة')
                  const totalQty = Number(inv.quantity || 0)
                  const createdAt = (inv as unknown as { created_at?: string }).created_at || new Date().toISOString()
                  const purchasePrice = item?.purchase_price || 0
                  const sellingPrice = item?.selling_price || 0
                  const globalIndex = startIndex + index + 1
                  const isEditing = editingItemId === item.id
                  const displayValue = (showBarcode ? displayCode(item?.barcode) || displayCode(item?.code) : displayCode(item?.code)) || '-'

                  return (
                    <tr key={inv.id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${selectedItems.has(inv.id) ? '!bg-red-50' : ''}`}>
                      <td className="px-2 py-3 text-center">
                        {renderRowCheckbox(inv.id, 'hover:bg-red-100', 'text-red-600')}
                      </td>
                      <td className="px-4 py-3 text-gray-900">{globalIndex}</td>
                      <td className="px-4 py-3 text-gray-600">{renderCategoryCell(isEditing, categoryName)}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(createdAt)}</td>
                      <td className="px-4 py-3 text-gray-900 font-mono">{getDocNumber(createdAt, index)}</td>
                      <td className="px-4 py-3">
                        {isEditing ? renderCodeInputs() : renderCodeCell(item, displayValue)}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editFormData.name_ar}
                            onChange={(e) => setEditFormData({ ...editFormData, name_ar: e.target.value })}
                            className="w-full px-2 py-1 border border-blue-300 rounded text-sm"
                            aria-label="اسم الصنف"
                          />
                        ) : (
                          <span className="text-gray-900">{item?.name_ar || '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {isEditing ? renderNumberInput('quantity', 'w-20', 'جزئي') : formatNumber(Math.floor(totalQty))}
                      </td>
                      <td className="px-4 py-3 text-gray-600">1</td>
                      <td className="px-4 py-3 text-gray-900 font-medium">
                        {isEditing ? (
                          <span className="font-medium">{editFormData.quantity}</span>
                        ) : (
                          formatNumber(totalQty)
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{unitName}</td>
                      <td className="px-4 py-3">
                        {isEditing ? renderNumberInput('purchase_price', 'w-24', 'سعر الشراء') : (
                          <span className="text-blue-600 font-medium">{formatNumber(purchasePrice)} ج</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? renderNumberInput('selling_price', 'w-24', 'سعر البيع') : (
                          <span className="text-green-600 font-medium">{formatNumber(sellingPrice)} ج</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{renderActions(inv, isEditing)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {filteredStock.length > itemsPerPage && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              عرض {startIndex + 1} - {Math.min(endIndex, filteredStock.length)} من {filteredStock.length} صنف
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                الأولى
              </button>
              <button
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                السابق
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum
                  if (totalPages <= 5) {
                    pageNum = i + 1
                  } else if (currentPage <= 3) {
                    pageNum = i + 1
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i
                  } else {
                    pageNum = currentPage - 2 + i
                  }

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`px-3 py-1 rounded-lg ${
                        currentPage === pageNum
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
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                التالي
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-3 py-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                الأخيرة
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && stockBranchId && (
        <StockImportDialog
          branchId={stockBranchId}
          branchName={selectedBranchName}
          canEditItems={canEditItems}
          onClose={() => setShowImport(false)}
          onImported={fetchStock}
        />
      )}
    </div>
  )
}
