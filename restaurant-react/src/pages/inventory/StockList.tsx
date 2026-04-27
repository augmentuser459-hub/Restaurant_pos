import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { inventoryService, InventoryWithDetails } from '../../services/inventory.service'
import { branchesService } from '../../services/branches.service'
import { Branch } from '../../types/database.types'
import { Package, Search, Filter, Plus, Download, Upload, Edit2, Save, X } from 'lucide-react'
import { formatNumber } from '../../lib/utils'
import { exportToExcel, inventoryColumns, parseCSV, readFileAsText } from '../../lib/excel'
import { supabase } from '../../lib/supabase'

export default function StockList() {
  const [stock, setStock] = useState<InventoryWithDetails[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [categories, setCategories] = useState<{ id: string; name_ar: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [search, setSearch] = useState('')
  const [isMainWarehouse, setIsMainWarehouse] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(250)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editFormData, setEditFormData] = useState<{
    name_ar: string
    code: string
    purchase_price: number
    selling_price: number
  }>({
    name_ar: '',
    code: '',
    purchase_price: 0,
    selling_price: 0
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    fetchStock()
  }, [selectedBranch])

  const fetchData = async () => {
    const [branchesRes, categoriesRes] = await Promise.all([
      branchesService.getActive(),
      inventoryService.getCategories(),
    ])
    const allBranches = branchesRes.data || []
    // Filter out main warehouse from dropdown (it's the default option)
    const nonMainBranches = allBranches.filter(b => !b.is_main_warehouse)
    setBranches(nonMainBranches)
    setCategories(categoriesRes.data || [])

    // Get main warehouse ID and fetch its stock
    const mainWarehouse = allBranches.find(b => b.is_main_warehouse)
    if (mainWarehouse) {
      const stockRes = await inventoryService.getStockByBranch(mainWarehouse.id)
      setStock(stockRes.data || [])
    }
    setLoading(false)
  }

  const fetchStock = async () => {
    setLoading(true)

    if (selectedBranch) {
      // Fetch selected branch stock
      const { data } = await inventoryService.getStockByBranch(selectedBranch)
      setStock(data || [])
      setIsMainWarehouse(false)
    } else {
      // Fetch main warehouse stock (not all stock)
      const { data: allBranches } = await branchesService.getActive()
      const mainWarehouse = allBranches?.find(b => b.is_main_warehouse)
      if (mainWarehouse) {
        const { data } = await inventoryService.getStockByBranch(mainWarehouse.id)
        setStock(data || [])
      } else {
        setStock([])
      }
      setIsMainWarehouse(true)
    }

    setLoading(false)
  }

  const filteredStock = stock.filter((inv) => {
    const item = inv.item as { name_ar?: string; code?: string; category?: { id: string } }
    const matchesSearch =
      item?.name_ar?.includes(search) ||
      item?.code?.toLowerCase().includes(search.toLowerCase())
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

  // Handle edit item
  const handleEditItem = (inv: InventoryWithDetails) => {
    const item = inv.item as { id: string; name_ar?: string; code?: string; purchase_price?: number; selling_price?: number }
    setEditingItemId(item.id)
    setEditFormData({
      name_ar: item.name_ar || '',
      code: item.code || '',
      purchase_price: item.purchase_price || 0,
      selling_price: item.selling_price || 0
    })
  }

  const handleCancelEdit = () => {
    setEditingItemId(null)
    setEditFormData({
      name_ar: '',
      code: '',
      purchase_price: 0,
      selling_price: 0
    })
  }

  const handleSaveEdit = async () => {
    if (!editingItemId) return
    
    setSaving(true)
    
    // Update item in database
    const { error } = await supabase
      .from('items')
      .update({
        name_ar: editFormData.name_ar,
        code: editFormData.code,
        purchase_price: editFormData.purchase_price,
        selling_price: editFormData.selling_price,
        updated_at: new Date().toISOString()
      })
      .eq('id', editingItemId)
    
    if (error) {
      alert('فشل في حفظ التعديلات: ' + error.message)
    } else {
      // Refresh stock data
      await fetchStock()
      handleCancelEdit()
      alert('تم حفظ التعديلات بنجاح')
    }
    
    setSaving(false)
  }

  // Group by category for display
  const groupedStock = paginatedStock.reduce(
    (acc, inv) => {
      const item = inv.item as { category?: { name_ar: string } }
      const categoryName = item?.category?.name_ar || 'بدون تصنيف'
      if (!acc[categoryName]) {
        acc[categoryName] = []
      }
      acc[categoryName].push(inv)
      return acc
    },
    {} as Record<string, InventoryWithDetails[]>
  )

  // Get selected branch name
  const selectedBranchName = selectedBranch
    ? branches.find(b => b.id === selectedBranch)?.name_ar || 'الفرع'
    : 'المخزن الرئيسي'

  // Format date helper
  const formatDate = (date: string) => {
    const d = new Date(date)
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
  }

  // Generate document number
  const getDocNumber = (date: string, index: number) => {
    const d = new Date(date)
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}-${String(index + 1).padStart(2, '0')}`
  }

  // Export to Excel
  const handleExport = () => {
    const exportData = filteredStock.map(inv => {
      const item = inv.item as { code?: string; name_ar?: string; unit?: { name_ar?: string; code?: string } | string; purchase_price?: number; selling_price?: number }
      const branch = inv.branch as { name_ar?: string }
      // Handle unit as object or string
      const unitValue = typeof item?.unit === 'object'
        ? (item?.unit?.name_ar || item?.unit?.code || '')
        : (item?.unit || '')
      return {
        item_code: item?.code || '',
        item_name: item?.name_ar || '',
        branch_name: branch?.name_ar || selectedBranchName,
        quantity: inv.quantity || 0,
        unit: unitValue,
        min_quantity: inv.min_quantity || 0,
        opening_balance: inv.opening_balance || 0, // رصيد أول المدة - actual field
        purchase_price: item?.purchase_price || 0,
        selling_price: item?.selling_price || 0,
      }
    })
    exportToExcel(exportData, inventoryColumns, `مخزون_${selectedBranchName}`)
  }

  // Import from Excel
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setLoading(true)
      const text = await readFileAsText(file)
      const data = parseCSV(text)
      console.log('Imported data:', data)

      if (data.length === 0) {
        alert('الملف فارغ أو غير صالح')
        setLoading(false)
        return
      }

      // Get target branch (selected or main warehouse)
      let targetBranchId = selectedBranch
      if (!targetBranchId) {
        const { data: allBranches } = await branchesService.getActive()
        const mainWarehouse = allBranches?.find(b => b.is_main_warehouse)
        targetBranchId = mainWarehouse?.id || ''
      }
      if (!targetBranchId) {
        alert('يرجى اختيار الفرع أولاً')
        setLoading(false)
        return
      }

      // Get all items to match by code
      const { data: allItems } = await inventoryService.getAllItems()
      const itemMap = new Map((allItems || []).map(i => [i.code?.toLowerCase(), i]))

      // Get units for mapping
      const { data: units } = await inventoryService.getUnits()
      const defaultUnit = units?.find(u => u.code === 'PC' || u.code === 'KG') || units?.[0]

      let successCount = 0
      let newItemsCount = 0
      let errorCount = 0
      const errors: string[] = []

      console.log('CSV Headers:', Object.keys(data[0] || {}))
      console.log('Default unit:', defaultUnit)
      console.log(`Starting import of ${data.length} items in batches of 50...`)

      // Process in batches of 50
      const BATCH_SIZE = 50
      const totalBatches = Math.ceil(data.length / BATCH_SIZE)

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const start = batchIndex * BATCH_SIZE
        const end = Math.min(start + BATCH_SIZE, data.length)
        const batch = data.slice(start, end)

        console.log(`Processing batch ${batchIndex + 1}/${totalBatches} (items ${start + 1}-${end})`)

        for (const row of batch) {
          // Get item data from CSV
          const itemCode = (row['كود الصنف'] || row['item_code'] || row['كود'] || '').toString().trim()
          const itemName = (row['اسم الصنف'] || row['item_name'] || row['الاسم'] || '').toString().trim()
          const quantity = parseFloat(row['الكمية'] || row['quantity'] || row['الرصيد إجمالي'] || '0')
          const openingBalance = parseFloat(row['رصيد أول المدة'] || row['opening_balance'] || row['الحد الأدنى'] || '0')
          const purchasePrice = parseFloat(row['سعر الشراء'] || row['purchase_price'] || '0')
          const sellingPrice = parseFloat(row['سعر البيع'] || row['selling_price'] || '0')
          // Handle unit - could be string or [object Object] from bad export
          let unitRaw = row['الوحدة'] || row['unit'] || row['وصف المحتوى'] || ''
          const unitName = (typeof unitRaw === 'object' ? '' : unitRaw.toString()).trim()

          if (!itemCode) {
            errorCount++
            errors.push(`سطر بدون كود صنف`)
            continue
          }

          if (!itemName) {
            errorCount++
            errors.push(`سطر بدون اسم صنف: ${itemCode}`)
            continue
          }

          let item = itemMap.get(itemCode.toLowerCase())

          // If item doesn't exist, create it
          if (!item) {
            // Find matching unit or use default
            const matchedUnit = units?.find(u =>
              u.name_ar === unitName ||
              u.code?.toLowerCase() === unitName.toLowerCase()
            ) || defaultUnit

            if (!matchedUnit || !matchedUnit.id) {
              errorCount++
              errors.push(`لا توجد وحدة قياس للصنف ${itemCode}`)
              console.error(`No valid unit found for item ${itemCode}. unitName: ${unitName}`)
              continue
            }

            const itemToCreate = {
              code: itemCode,
              name: itemName,
              name_ar: itemName,
              unit: matchedUnit.id,
              min_stock_level: 0,
              purchase_price: purchasePrice || 0,
              selling_price: sellingPrice || 0,
              status: 'active' as const,
            }

            const { data: newItem, error: createError } = await inventoryService.createItem(itemToCreate)

            if (createError || !newItem) {
              errorCount++
              const errorMsg = createError?.message || 'خطأ غير معروف'
              errors.push(`فشل إنشاء الصنف ${itemCode}: ${errorMsg}`)
              console.error(`❌ Failed to create item: ${itemCode}`, createError)
              continue
            }

            item = newItem
            itemMap.set(itemCode.toLowerCase(), newItem)
            newItemsCount++
          } else if (purchasePrice > 0 || sellingPrice > 0) {
            // Update existing item prices if provided
            const updateData: { purchase_price?: number; selling_price?: number } = {}
            if (purchasePrice > 0) updateData.purchase_price = purchasePrice
            if (sellingPrice > 0) updateData.selling_price = sellingPrice

            if (Object.keys(updateData).length > 0) {
              await inventoryService.updateItem(item.id, updateData)
            }
          }

          // Update stock
          if (!item || !item.id) {
            errorCount++
            errors.push(`فشل في الحصول على معرف الصنف ${itemCode}`)
            continue
          }

          // For first-time import: if quantity is 0 but opening balance exists, use opening balance as quantity
          const finalQuantity = (quantity === 0 && openingBalance > 0) ? openingBalance : quantity

          const { error: stockError } = await inventoryService.updateStock(
            targetBranchId, 
            item.id, 
            finalQuantity,
            openingBalance // Pass opening balance
          )

          if (stockError) {
            errorCount++
            errors.push(`فشل تحديث مخزون ${itemCode}: ${stockError.message}`)
            console.error(`Stock update failed for ${itemCode}:`, stockError)
          } else {
            successCount++
          }
        }

        // Small delay between batches to avoid rate limiting
        if (batchIndex < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        console.log(`✅ Batch ${batchIndex + 1}/${totalBatches} complete. Success: ${successCount}, Errors: ${errorCount}`)
      }

      // Show result
      let message = `تم استيراد ${successCount} سجل بنجاح من أصل ${data.length}`
      if (newItemsCount > 0) {
        message += `\nتم إنشاء ${newItemsCount} صنف جديد`
      }
      if (errorCount > 0) {
        message += `\nفشل ${errorCount} سجل`
        if (errors.length > 0 && errors.length <= 10) {
          message += `:\n${errors.slice(0, 10).join('\n')}`
        } else if (errors.length > 10) {
          message += `\nأول 10 أخطاء:\n${errors.slice(0, 10).join('\n')}`
        }
      }
      alert(message)

      console.log(`Import complete! Total: ${data.length}, Success: ${successCount}, New items: ${newItemsCount}, Errors: ${errorCount}`)

      // Refresh data
      await new Promise(resolve => setTimeout(resolve, 500))
      const { data: freshData, error: fetchError } = await inventoryService.getStockByBranch(targetBranchId)

      if (fetchError) {
        console.error('Failed to refresh inventory:', fetchError)
        alert('تم الاستيراد بنجاح ولكن فشل تحديث العرض. يرجى تحديث الصفحة.')
      } else {
        setStock(freshData || [])
      }

      setLoading(false)

    } catch (error) {
      console.error('Import error:', error)
      alert('فشل في قراءة الملف')
      setLoading(false)
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

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
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
            title="استيراد من Excel"
          >
            <Upload className="w-5 h-5" />
            استيراد
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleImport}
            className="hidden"
            aria-label="استيراد ملف Excel"
          />
          <Link
            to="/inventory/items/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-5 h-5" />
            إضافة صنف
          </Link>
        </div>
      </div>

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
            onChange={(e) => setSelectedBranch(e.target.value)}
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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">إجمالي الأصناف</p>
          <p className="text-2xl font-bold text-gray-900">{formatNumber(filteredStock.length)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">إجمالي الكمية</p>
          <p className="text-2xl font-bold text-blue-600">
            {formatNumber(filteredStock.reduce((sum, i) => sum + (i.quantity || 0), 0))}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">عدد المجموعات</p>
          <p className="text-2xl font-bold text-green-600">{formatNumber(Object.keys(groupedStock).length)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">مخزون منخفض</p>
          <p className="text-2xl font-bold text-red-600">
            {formatNumber(filteredStock.filter((i) => i.quantity < (i.item?.min_stock_level || 10)).length)}
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
        ) : isMainWarehouse || !selectedBranch ? (
          /* Main Warehouse Table - Blue Header */
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-blue-100">
                <tr>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">م</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">مجموعة</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">كود</th>
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
                  const item = inv.item as unknown as { id: string; code?: string; name_ar?: string; category?: { name_ar: string }; unit?: { name_ar: string; code: string }; purchase_price?: number; selling_price?: number }
                  const categoryName = item?.category?.name_ar || '-'
                  const unitName = item?.unit?.name_ar || item?.unit?.code || 'كرتونة'
                  const purchasePrice = item?.purchase_price || 0
                  const sellingPrice = item?.selling_price || 0
                  const globalIndex = startIndex + index + 1
                  const isEditing = editingItemId === item.id
                  
                  return (
                    <tr key={inv.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 text-gray-900">{globalIndex}</td>
                      <td className="px-4 py-3 text-gray-600">{categoryName}</td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editFormData.code}
                            onChange={(e) => setEditFormData({ ...editFormData, code: e.target.value })}
                            className="w-full px-2 py-1 border border-blue-300 rounded text-sm font-mono"
                            dir="ltr"
                          />
                        ) : (
                          <span className="text-gray-900 font-mono">{item?.code || '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editFormData.name_ar}
                            onChange={(e) => setEditFormData({ ...editFormData, name_ar: e.target.value })}
                            className="w-full px-2 py-1 border border-blue-300 rounded text-sm"
                          />
                        ) : (
                          <span className="text-gray-900">{item?.name_ar || '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatNumber(inv.opening_balance || 0)}</td>
                      <td className="px-4 py-3 text-gray-600">-</td>
                      <td className="px-4 py-3 text-gray-600">-</td>
                      <td className="px-4 py-3 text-gray-900 font-medium">{formatNumber(inv.quantity)}</td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{unitName}</td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editFormData.purchase_price}
                            onChange={(e) => setEditFormData({ ...editFormData, purchase_price: parseFloat(e.target.value) || 0 })}
                            className="w-24 px-2 py-1 border border-blue-300 rounded text-sm"
                            dir="ltr"
                          />
                        ) : (
                          <span className="text-blue-600 font-medium">{formatNumber(purchasePrice)} ج</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editFormData.selling_price}
                            onChange={(e) => setEditFormData({ ...editFormData, selling_price: parseFloat(e.target.value) || 0 })}
                            className="w-24 px-2 py-1 border border-blue-300 rounded text-sm"
                            dir="ltr"
                          />
                        ) : (
                          <span className="text-green-600 font-medium">{formatNumber(sellingPrice)} ج</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
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
                          <div className="flex items-center justify-center">
                            <button
                              type="button"
                              onClick={() => handleEditItem(inv)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
                              title="تعديل"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
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
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">م</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">التاريخ</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">رقم المستند</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">كود الصنف</th>
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
                  const item = inv.item as unknown as { id: string; code?: string; name_ar?: string; unit?: { name_ar: string; code: string }; purchase_price?: number; selling_price?: number }
                  const unitName = item?.unit?.name_ar || item?.unit?.code || 'قطعة'
                  const totalQty = inv.quantity || 0
                  const createdAt = (inv as unknown as { created_at?: string }).created_at || new Date().toISOString()
                  const purchasePrice = item?.purchase_price || 0
                  const sellingPrice = item?.selling_price || 0
                  const globalIndex = startIndex + index + 1
                  const isEditing = editingItemId === item.id

                  return (
                    <tr key={inv.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 text-gray-900">{globalIndex}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(createdAt)}</td>
                      <td className="px-4 py-3 text-gray-900 font-mono">{getDocNumber(createdAt, index)}</td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editFormData.code}
                            onChange={(e) => setEditFormData({ ...editFormData, code: e.target.value })}
                            className="w-full px-2 py-1 border border-blue-300 rounded text-sm font-mono"
                            dir="ltr"
                          />
                        ) : (
                          <span className="text-gray-900 font-mono">{item?.code || '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editFormData.name_ar}
                            onChange={(e) => setEditFormData({ ...editFormData, name_ar: e.target.value })}
                            className="w-full px-2 py-1 border border-blue-300 rounded text-sm"
                          />
                        ) : (
                          <span className="text-gray-900">{item?.name_ar || '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatNumber(Math.floor(totalQty))}</td>
                      <td className="px-4 py-3 text-gray-600">1</td>
                      <td className="px-4 py-3 text-gray-900 font-medium">{formatNumber(totalQty)}</td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{unitName}</td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editFormData.purchase_price}
                            onChange={(e) => setEditFormData({ ...editFormData, purchase_price: parseFloat(e.target.value) || 0 })}
                            className="w-24 px-2 py-1 border border-blue-300 rounded text-sm"
                            dir="ltr"
                          />
                        ) : (
                          <span className="text-blue-600 font-medium">{formatNumber(purchasePrice)} ج</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editFormData.selling_price}
                            onChange={(e) => setEditFormData({ ...editFormData, selling_price: parseFloat(e.target.value) || 0 })}
                            className="w-24 px-2 py-1 border border-blue-300 rounded text-sm"
                            dir="ltr"
                          />
                        ) : (
                          <span className="text-green-600 font-medium">{formatNumber(sellingPrice)} ج</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
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
                          <div className="flex items-center justify-center">
                            <button
                              type="button"
                              onClick={() => handleEditItem(inv)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
                              title="تعديل"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
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
    </div>
  )
}
