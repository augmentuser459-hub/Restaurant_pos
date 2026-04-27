import { useEffect, useState } from 'react'
import { posManagementService, BranchPOSItem, AvailableInventoryItem } from '../../services/posManagement.service'
import { formatCurrency } from '../../lib/utils'
import { 
  Store, DollarSign, Save, Copy, Percent, 
  Check, X, Eye, EyeOff, Search, Plus, Trash2, Package
} from 'lucide-react'

interface Branch {
  id: string
  code: string
  name: string
  name_ar: string
  itemCount: number
}

export default function POSManagement() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
  const [posItems, setPosItems] = useState<BranchPOSItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [editedPrices, setEditedPrices] = useState<Record<string, { price: number; is_available: boolean }>>({})
  const [editedCosts, setEditedCosts] = useState<Record<string, number>>({})
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [showPercentModal, setShowPercentModal] = useState(false)
  const [showAddItemModal, setShowAddItemModal] = useState(false)
  const [percentValue, setPercentValue] = useState<string>('')
  const [copySourceBranch, setCopySourceBranch] = useState<string>('')
  const [availableItems, setAvailableItems] = useState<AvailableInventoryItem[]>([])
  const [selectedItemToAdd, setSelectedItemToAdd] = useState<string>('')
  const [newItemPrice, setNewItemPrice] = useState<string>('')

  useEffect(() => {
    fetchBranches()
  }, [])

  useEffect(() => {
    if (selectedBranch) {
      fetchPOSItems(selectedBranch)
      fetchAvailableItems(selectedBranch)
    }
  }, [selectedBranch])

  const fetchBranches = async () => {
    const { data } = await posManagementService.getBranchesWithItemCounts()
    setBranches((data || []) as unknown as Branch[])
    setLoading(false)
  }

  const fetchPOSItems = async (branchId: string) => {
    setLoading(true)
    const { data } = await posManagementService.getBranchPOSItems(branchId)
    setPosItems(data || [])
    setEditedPrices({})
    setEditedCosts({})
    setLoading(false)
  }

  const fetchAvailableItems = async (branchId: string) => {
    const { data } = await posManagementService.getAvailableInventoryItems(branchId)
    setAvailableItems(data || [])
  }

  const handlePriceChange = (id: string, field: 'price' | 'is_available', value: number | boolean) => {
    const current = posItems.find(p => p.id === id)
    if (!current) return

    setEditedPrices(prev => ({
      ...prev,
      [id]: {
        price: field === 'price' ? value as number : (prev[id]?.price ?? current.price),
        is_available: field === 'is_available' ? value as boolean : (prev[id]?.is_available ?? current.is_available)
      }
    }))
  }

  const handleCostChange = (itemId: string, cost: number) => {
    setEditedCosts(prev => ({
      ...prev,
      [itemId]: cost
    }))
  }

  const hasChanges = Object.keys(editedPrices).length > 0 || Object.keys(editedCosts).length > 0

  const handleSave = async () => {
    if (!selectedBranch || !hasChanges) return
    
    setSaving(true)
    
    // Update POS items (selling prices)
    for (const [id, updates] of Object.entries(editedPrices)) {
      await posManagementService.updatePOSItem(id, updates)
    }
    
    // Update item costs (purchase prices)
    for (const [itemId, cost] of Object.entries(editedCosts)) {
      await posManagementService.updateItemCost(itemId, cost)
    }
    
    await fetchPOSItems(selectedBranch)
    setSaving(false)
  }

  const handleRemoveItem = async (id: string) => {
    if (!confirm('هل أنت متأكد من إزالة هذا المنتج من نقطة البيع؟')) return
    
    setSaving(true)
    await posManagementService.removeItemFromPOS(id)
    if (selectedBranch) {
      await fetchPOSItems(selectedBranch)
      await fetchBranches()
    }
    setSaving(false)
  }

  const handleAddItem = async () => {
    if (!selectedBranch || !selectedItemToAdd || !newItemPrice) return
    
    setSaving(true)
    const { error } = await posManagementService.addItemToPOS(
      selectedBranch,
      selectedItemToAdd,
      parseFloat(newItemPrice)
    )
    
    if (error) {
      alert('فشل في إضافة المنتج')
    } else {
      setShowAddItemModal(false)
      setSelectedItemToAdd('')
      setNewItemPrice('')
      await fetchPOSItems(selectedBranch)
      await fetchBranches()
    }
    setSaving(false)
  }

  const handleCopyPrices = async () => {
    if (!selectedBranch || !copySourceBranch) return
    
    setSaving(true)
    await posManagementService.copyPricesFromBranch(copySourceBranch, selectedBranch)
    await fetchPOSItems(selectedBranch)
    setShowCopyModal(false)
    setCopySourceBranch('')
    setSaving(false)
  }

  const handleApplyPercent = async () => {
    if (!selectedBranch || !percentValue) return
    
    const percent = parseFloat(percentValue)
    if (isNaN(percent)) return
    
    setSaving(true)
    await posManagementService.applyPercentageChange(selectedBranch, percent)
    await fetchPOSItems(selectedBranch)
    setShowPercentModal(false)
    setPercentValue('')
    setSaving(false)
  }

  const filteredPOSItems = posItems.filter(p => {
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    return (
      p.item?.name?.toLowerCase().includes(term) ||
      p.item?.name_ar?.toLowerCase().includes(term) ||
      p.item?.code?.toLowerCase().includes(term)
    )
  })

  // Filter available items to exclude already added ones
  const itemsToAdd = availableItems.filter(
    item => !posItems.some(pos => pos.item_id === item.id)
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

      {/* Branch Selection */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Store className="w-5 h-5 text-blue-600" />
          اختر الفرع
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {branches.map(branch => (
            <button
              key={branch.id}
              onClick={() => setSelectedBranch(branch.id)}
              className={`p-4 rounded-lg border-2 text-right transition-all ${
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
                  onClick={() => setShowAddItemModal(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100"
                  title="إضافة منتج"
                >
                  <Plus className="w-4 h-4" />
                  إضافة منتج
                </button>

                <button
                  onClick={() => setShowPercentModal(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100"
                  title="تطبيق نسبة مئوية"
                >
                  <Percent className="w-4 h-4" />
                  نسبة
                </button>
                
                <button
                  onClick={() => setShowCopyModal(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100"
                  title="نسخ من فرع آخر"
                >
                  <Copy className="w-4 h-4" />
                  نسخ
                </button>

                {hasChanges && (
                  <button
                    onClick={handleSave}
                    disabled={saving}
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
                    const currentPrice = edited?.price ?? item.price
                    const currentAvailable = edited?.is_available ?? item.is_available
                    const stockQty = item.stock_quantity || 0
                    const inStock = item.in_stock || false
                    
                    // Cost price - use calculated cost for recipes, purchase price for regular items
                    const isRecipe = item.item?.is_recipe || false
                    const editedCost = editedCosts[item.item_id]
                    const baseCost = isRecipe 
                      ? (item.item?.calculated_cost ?? 0)
                      : (item.item?.purchase_price ?? 0)
                    const currentCost = editedCost ?? baseCost
                    
                    // Profit calculation
                    const profit = currentPrice - currentCost
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
                              value={currentCost}
                              onChange={(e) => handleCostChange(item.item_id, parseFloat(e.target.value) || 0)}
                              disabled={isRecipe}
                              className={`w-24 px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 ${
                                isRecipe 
                                  ? 'bg-purple-50 border-purple-200 cursor-not-allowed' 
                                  : 'border-gray-300'
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
                            value={currentPrice}
                            onChange={(e) => handlePriceChange(item.id, 'price', parseFloat(e.target.value) || 0)}
                            className="w-24 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                            min="0"
                            step="0.01"
                            aria-label={`سعر البيع ${item.item?.name_ar}`}
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
                            onClick={() => handlePriceChange(item.id, 'is_available', !currentAvailable)}
                            className={`p-2 rounded-lg transition-colors ${
                              currentAvailable 
                                ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                                : 'bg-red-100 text-red-700 hover:bg-red-200'
                            }`}
                            title={currentAvailable ? 'متاح - اضغط للإخفاء' : 'غير متاح - اضغط للإظهار'}
                          >
                            {currentAvailable ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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
              <button onClick={() => setShowAddItemModal(false)} className="p-2 hover:bg-gray-100 rounded-lg" title="إغلاق">
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
                onClick={() => setShowAddItemModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                إلغاء
              </button>
              <button
                onClick={handleAddItem}
                disabled={!selectedItemToAdd || !newItemPrice || saving}
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
              <button onClick={() => setShowCopyModal(false)} className="p-2 hover:bg-gray-100 rounded-lg" title="إغلاق">
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
                onClick={() => setShowCopyModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                إلغاء
              </button>
              <button
                onClick={handleCopyPrices}
                disabled={!copySourceBranch || saving}
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
              <button onClick={() => setShowPercentModal(false)} className="p-2 hover:bg-gray-100 rounded-lg" title="إغلاق">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-gray-600 mb-4">أدخل النسبة المئوية للزيادة أو النقصان (مثال: 10 للزيادة 10%، -5 للنقصان 5%)</p>
            <input
              type="number"
              value={percentValue}
              onChange={(e) => setPercentValue(e.target.value)}
              placeholder="مثال: 10 أو -5"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-4"
              aria-label="النسبة المئوية"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowPercentModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                إلغاء
              </button>
              <button
                onClick={handleApplyPercent}
                disabled={!percentValue || saving}
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
