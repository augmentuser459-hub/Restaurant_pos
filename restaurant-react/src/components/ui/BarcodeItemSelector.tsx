import { useState, useEffect, useRef } from 'react'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { fetchAll } from '../../lib/fetchAll'
import { toUserMessage } from '../../lib/errors'
import { findItemsByScan } from '../../pages/inventory/stockHelpers'
import BarcodeScanner from './BarcodeScanner'
import { AlertCircle, Package, Check } from 'lucide-react'

/** Item as the selector loads it and passes to onItemSelect. */
export interface BarcodeSelectableItem {
  id: string
  code: string
  barcode: string | null
  name_ar: string
  name: string
  purchase_price: number
  unit_id: string
  is_recipe: boolean
  unit?: { id: string; name_ar: string; code: string } | null
}

type Item = BarcodeSelectableItem

interface BarcodeItemSelectorProps {
  onItemSelect: (item: Item) => void
  selectedItemId?: string
  branchId?: string // Optional: to check inventory availability
  showInventory?: boolean
  className?: string
  disabled?: boolean
  excludeRecipes?: boolean // Optional: hide recipe items (e.g. when picking recipe ingredients)
}

/**
 * BarcodeItemSelector Component
 * - Combines barcode scanning with item selection
 * - Shows item details after scanning
 * - Optionally shows inventory availability
 */
export default function BarcodeItemSelector({
  onItemSelect,
  selectedItemId,
  branchId,
  showInventory = false,
  className = '',
  disabled = false,
  excludeRecipes = false
}: BarcodeItemSelectorProps) {
  const [allItems, setAllItems] = useState<Item[]>([])
  const [selectedItem, setSelectedItem] = useState<Item | null>(null)
  const [inventoryQty, setInventoryQty] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchMode, setSearchMode] = useState<'barcode' | 'dropdown'>('barcode')
  const [searchTerm, setSearchTerm] = useState('')
  const [suggestions, setSuggestions] = useState<Item[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inventoryRequestRef = useRef(0) // ignores a late quantity response for a previous item/branch

  const items = excludeRecipes ? allItems.filter(i => !i.is_recipe) : allItems

  useEffect(() => {
    fetchItems()
  }, [])

  useEffect(() => {
    if (selectedItemId && items.length > 0) {
      const item = items.find(i => i.id === selectedItemId)
      if (item) {
        setSelectedItem(item)
        if (showInventory && branchId) {
          fetchInventory(item.id, branchId)
        }
      }
    }
  }, [selectedItemId, allItems, branchId, showInventory])

  const fetchItems = async () => {
    try {
      // All active items (more than the 1000 rows one request returns)
      const data = await fetchAll<Record<string, unknown>>((from, to) =>
        supabase
          .from('items')
          .select('id, code, barcode, name_ar, name, purchase_price, unit_id, is_recipe, unit:units(id, name_ar, code)')
          .eq('status', 'active')
          .order('name_ar')
          .order('id')
          .range(from, to)
      )
      // Transform data to match Item interface (unit is object, not array)
      const transformedData = data.map(item => ({
        ...item,
        is_recipe: Boolean(item.is_recipe),
        unit: Array.isArray(item.unit) ? item.unit[0] || null : item.unit
      }))
      setAllItems(fixEncodingInData(transformedData) as unknown as Item[])
    } catch (loadError) {
      setError('تعذر تحميل الأصناف: ' + toUserMessage(loadError))
    }
  }

  const fetchInventory = async (itemId: string, branchId: string) => {
    const request = ++inventoryRequestRef.current
    setInventoryQty(null)
    const { data, error: invError } = await supabase
      .from('inventory')
      .select('quantity')
      .eq('item_id', itemId)
      .eq('branch_id', branchId)
      .maybeSingle()

    if (request !== inventoryRequestRef.current) return // another item or branch was selected meanwhile
    if (invError) {
      setError('تعذر تحميل الكمية المتاحة: ' + toUserMessage(invError))
      setInventoryQty(null)
      return
    }
    setInventoryQty(Number(data?.quantity ?? 0))
  }

  const matchSearch = (value: string) => {
    const searchLower = value.toLowerCase()
    return items.filter(item =>
      item.barcode?.toLowerCase().includes(searchLower) ||
      item.code.toLowerCase().includes(searchLower) ||
      item.name_ar.toLowerCase().includes(searchLower) ||
      item.name?.toLowerCase().includes(searchLower)
    )
  }

  const handleBarcodeScan = async (scanned: string) => {
    const barcode = scanned.trim()
    setError('')
    setLoading(true)
    setShowSuggestions(false)

    // Barcode first, then code (also codes stored in quotes, e.g. "6223000123456"), then the only
    // partial code match; a typed name with exactly one match is accepted too
    const scanMatches = findItemsByScan(items, barcode)
    let item = scanMatches.length === 1 ? scanMatches[0] : undefined
    if (!item && scanMatches.length === 0 && barcode.length >= 2) {
      const matches = matchSearch(barcode)
      if (matches.length === 1) item = matches[0]
    }

    if (item) {
      setSelectedItem(item)
      onItemSelect(item)
      setSearchTerm('')
      if (showInventory && branchId) {
        await fetchInventory(item.id, branchId)
      }
    } else {
      setSelectedItem(null)
      inventoryRequestRef.current++
      setInventoryQty(null)
      if (scanMatches.length > 1) {
        // e.g. two items whose codes differ only by quotes: let the user pick one from the suggestions
        setError(`يوجد ${scanMatches.length} أصناف تطابق "${barcode}". اختر الصنف المطلوب من القائمة`)
        setSearchTerm(barcode)
        setSuggestions(scanMatches.slice(0, 10))
        setShowSuggestions(true)
      } else {
        setError(`لم يتم العثور على صنف بالباركود: ${barcode}`)
      }
    }

    setLoading(false)
  }

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setError('')

    if (value.length >= 2) {
      const filtered = matchSearch(value).slice(0, 10) // Show max 10 suggestions
      setSuggestions(filtered)
      setShowSuggestions(filtered.length > 0)
    } else {
      setSuggestions([])
      setShowSuggestions(false)
    }
  }

  const handleSuggestionClick = async (item: Item) => {
    setSelectedItem(item)
    onItemSelect(item)
    setSearchTerm('')
    setSuggestions([])
    setShowSuggestions(false)

    if (showInventory && branchId) {
      await fetchInventory(item.id, branchId)
    }
  }

  const handleDropdownSelect = async (itemId: string) => {
    setError('')
    const item = items.find(i => i.id === itemId)
    if (item) {
      setSelectedItem(item)
      onItemSelect(item)
      if (showInventory && branchId) {
        await fetchInventory(item.id, branchId)
      }
    } else {
      setSelectedItem(null)
      setInventoryQty(null)
    }
  }

  const clearSelection = () => {
    setSelectedItem(null)
    setInventoryQty(null)
    setError('')
    setSearchTerm('')
    setSuggestions([])
    setShowSuggestions(false)
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Mode Toggle */}
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => setSearchMode('barcode')}
          className={`px-3 py-1 text-sm rounded-lg ${
            searchMode === 'barcode'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          باركود
        </button>
        <button
          type="button"
          onClick={() => setSearchMode('dropdown')}
          className={`px-3 py-1 text-sm rounded-lg ${
            searchMode === 'dropdown'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          قائمة
        </button>
      </div>

      {/* Barcode Scanner Mode */}
      {searchMode === 'barcode' && (
        <div className="relative">
          <BarcodeScanner
            onScan={handleBarcodeScan}
            placeholder="امسح الباركود أو ابحث بالكود أو الاسم"
            disabled={disabled || loading}
            value={searchTerm}
            onChange={handleSearchChange}
          />

          {/* Suggestions Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {suggestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSuggestionClick(item)}
                  className="w-full px-4 py-2 text-right hover:bg-blue-50 border-b border-gray-100 last:border-b-0 transition-colors"
                >
                  <div className="font-medium text-gray-900">{item.name_ar}</div>
                  <div className="text-sm text-gray-500">
                    {item.code}
                    {item.barcode && ` | ${item.barcode}`}
                    {item.unit && ` | ${item.unit.name_ar}`}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dropdown Mode */}
      {searchMode === 'dropdown' && (
        <select
          value={selectedItem?.id || ''}
          onChange={(e) => handleDropdownSelect(e.target.value)}
          disabled={disabled}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          aria-label="اختر الصنف"
        >
          <option value="">اختر الصنف</option>
          {items.map(item => (
            <option key={item.id} value={item.id}>
              {item.name_ar} ({item.code}) {item.barcode ? `- ${item.barcode}` : ''}
            </option>
          ))}
        </select>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Selected Item Display */}
      {selectedItem && (
        <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="p-2 bg-green-100 rounded-lg">
            <Package className="w-5 h-5 text-green-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-green-800">{selectedItem.name_ar}</span>
              <Check className="w-4 h-4 text-green-600" />
            </div>
            <div className="text-sm text-green-600">
              كود: {selectedItem.code}
              {selectedItem.barcode && ` | باركود: ${selectedItem.barcode}`}
              {selectedItem.unit && ` | ${selectedItem.unit.name_ar}`}
            </div>
            {showInventory && inventoryQty !== null && (
              <div className={`text-sm mt-1 ${inventoryQty > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                الكمية المتاحة: {inventoryQty}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={clearSelection}
            className="text-gray-400 hover:text-gray-600"
            title="مسح"
          >
            ×
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          جاري البحث...
        </div>
      )}
    </div>
  )
}
