import { useState, useEffect, FormEvent, useRef } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, Barcode, Search } from 'lucide-react'

interface Branch {
  id: string
  name_ar: string
}

interface Item {
  id: string
  code: string
  name_ar: string
}

interface ConsumptionItem {
  item_id: string
  quantity: number
  content: number
  notes: string
}

export default function ChefConsumptionForm() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [items, setItems] = useState<Item[]>([])

  // Check if user has permission to access this page
  const userRole = typeof user?.role === 'object' && user?.role !== null 
    ? (user.role as { name: string }).name 
    : user?.role

  // Only admin and warehouse_manager can access chef consumption
  if (userRole && !['admin', 'warehouse_manager'].includes(userRole)) {
    return <Navigate to="/dashboard" replace />
  }

  const [formData, setFormData] = useState({
    branch_id: '',
    count_date: new Date().toISOString().split('T')[0],
    notes: '',
  })

  const [consumptionItems, setConsumptionItems] = useState<ConsumptionItem[]>([
    { item_id: '', quantity: 0, content: 1, notes: '' },
  ])
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeError, setBarcodeError] = useState('')
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const [branchesRes, itemsRes] = await Promise.all([
      supabase.from('branches').select('id, name_ar').order('name_ar'),
      supabase.from('items').select('id, code, name_ar').eq('status', 'active').order('name_ar'),
    ])
    console.log('Branches loaded:', branchesRes.data?.length, branchesRes.error)
    console.log('Items loaded:', itemsRes.data?.length, itemsRes.error)
    setBranches(fixEncodingInData(branchesRes.data) as Branch[] || [])
    setItems(fixEncodingInData(itemsRes.data) as Item[] || [])
  }

  const addItem = () => {
    setConsumptionItems([...consumptionItems, { item_id: '', quantity: 0, content: 1, notes: '' }])
  }

  // Barcode search function
  const handleBarcodeSearch = () => {
    if (!barcodeInput.trim()) return
    setBarcodeError('')

    // Search by barcode or code
    const item = items.find(i => 
      (i as Item & { barcode?: string }).barcode === barcodeInput.trim() || 
      i.code === barcodeInput.trim()
    )

    if (item) {
      // Check if item already exists in list
      const existingIndex = consumptionItems.findIndex(ci => ci.item_id === item.id)
      if (existingIndex >= 0) {
        // Increment quantity
        const updated = [...consumptionItems]
        updated[existingIndex].quantity += 1
        setConsumptionItems(updated)
      } else {
        // Add new item
        const newItem: ConsumptionItem = {
          item_id: item.id,
          quantity: 1,
          content: 1,
          notes: ''
        }
        // Replace empty item or add new
        const emptyIndex = consumptionItems.findIndex(ci => !ci.item_id)
        if (emptyIndex >= 0) {
          const updated = [...consumptionItems]
          updated[emptyIndex] = newItem
          setConsumptionItems(updated)
        } else {
          setConsumptionItems([...consumptionItems, newItem])
        }
      }
      setBarcodeInput('')
      barcodeInputRef.current?.focus()
    } else {
      setBarcodeError(`لم يتم العثور على صنف بالباركود: ${barcodeInput}`)
    }
  }

  const handleBarcodeKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleBarcodeSearch()
    }
  }

  const removeItem = (index: number) => {
    if (consumptionItems.length > 1) {
      setConsumptionItems(consumptionItems.filter((_, i) => i !== index))
    }
  }

  const updateItem = (index: number, field: keyof ConsumptionItem, value: string | number) => {
    const updated = [...consumptionItems]
    updated[index] = { ...updated[index], [field]: value }
    setConsumptionItems(updated)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!formData.branch_id) {
      setError('يرجى اختيار الفرع')
      setLoading(false)
      return
    }

    const validItems = consumptionItems.filter(item => item.item_id && item.quantity > 0)
    if (validItems.length === 0) {
      setError('يرجى إضافة صنف واحد على الأقل')
      setLoading(false)
      return
    }

    console.log('=== CHEF CONSUMPTION START ===')
    console.log('Branch ID:', formData.branch_id)
    console.log('Date:', formData.count_date)
    console.log('Items count:', validItems.length)

    // STEP 1: Read inventory SNAPSHOT before any changes
    const inventorySnapshot: { itemId: string; invId: string; currentQty: number; consumeQty: number }[] = []
    
    for (const item of validItems) {
      const { data: inv } = await supabase
        .from('inventory')
        .select('id, quantity')
        .eq('branch_id', formData.branch_id)
        .eq('item_id', item.item_id)
        .single()
      
      const itemName = items.find(i => i.id === item.item_id)?.name_ar || item.item_id
      console.log(`SNAPSHOT - ${itemName}: Current=${inv?.quantity || 0}, Consume=${item.quantity}`)
      
      inventorySnapshot.push({
        itemId: item.item_id,
        invId: inv?.id || '',
        currentQty: Number(inv?.quantity || 0),
        consumeQty: item.quantity
      })
    }

    // STEP 2: Create daily count record
    const { data: countData, error: countError } = await supabase
      .from('daily_inventory_counts')
      .insert({
        branch_id: formData.branch_id,
        count_date: formData.count_date,
        count_type: 'morning', // Using morning as chef consumption
        status: 'approved', // Mark as approved immediately since we're deducting inventory
        notes: formData.notes || 'استهلاك الطباخ',
        counted_by: user?.id,
        submitted_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (countError) {
      setError('فشل في حفظ السجل: ' + countError.message)
      setLoading(false)
      return
    }

    console.log('Count record created:', countData.id)

    // STEP 3: Create count items
    const itemsToInsert = validItems.map(item => ({
      count_id: countData.id,
      item_id: item.item_id,
      actual_quantity: item.quantity,
      system_quantity: item.content,
      variance_reason: item.notes,
    }))

    const { error: itemsError } = await supabase
      .from('daily_inventory_count_items')
      .insert(itemsToInsert)

    if (itemsError) {
      setError('فشل في حفظ الأصناف: ' + itemsError.message)
      setLoading(false)
      return
    }

    console.log('Count items created')

    // STEP 4: Deduct from inventory using SNAPSHOT values
    console.log('Deducting from inventory...')
    
    for (const snapshot of inventorySnapshot) {
      const itemName = items.find(i => i.id === snapshot.itemId)?.name_ar || snapshot.itemId
      
      if (snapshot.invId) {
        // Use SNAPSHOT value for calculation
        const newQty = Math.max(0, snapshot.currentQty - snapshot.consumeQty)
        
        const { error: updateError } = await supabase
          .from('inventory')
          .update({ 
            quantity: newQty,
            updated_at: new Date().toISOString()
          })
          .eq('id', snapshot.invId)
        
        if (updateError) {
          console.error(`Failed to update inventory for ${itemName}:`, updateError)
        } else {
          console.log(`${itemName}: ${snapshot.currentQty} -> ${newQty} (consumed: ${snapshot.consumeQty})`)
        }
      } else {
        console.warn(`No inventory record found for ${itemName} in this branch`)
      }
    }

    // STEP 5: Verify final inventory values
    console.log('=== VERIFICATION ===')
    for (const snapshot of inventorySnapshot) {
      const { data: finalInv } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('branch_id', formData.branch_id)
        .eq('item_id', snapshot.itemId)
        .single()
      
      const itemName = items.find(i => i.id === snapshot.itemId)?.name_ar || snapshot.itemId
      console.log(`${itemName}: Final=${finalInv?.quantity}`)
    }

    console.log('=== CHEF CONSUMPTION COMPLETE ===')
    navigate('/inventory/chef-consumption')
    setLoading(false)
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button
          type="button"
          onClick={() => navigate('/inventory/chef-consumption')}
          className="p-2 hover:bg-gray-100 rounded-lg"
          title="رجوع"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">إضافة استهلاك</h1>
          <p className="text-gray-600">تسجيل استهلاك الطباخ للمواد</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات الاستهلاك</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="branch_id" className="block text-sm font-medium text-gray-700 mb-2">
                الفرع <span className="text-red-500">*</span>
              </label>
              <select
                id="branch_id"
                value={formData.branch_id}
                onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">اختر الفرع</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name_ar}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="count_date" className="block text-sm font-medium text-gray-700 mb-2">
                التاريخ <span className="text-red-500">*</span>
              </label>
              <input
                id="count_date"
                type="date"
                value={formData.count_date}
                onChange={(e) => setFormData({ ...formData, count_date: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
                ملاحظات
              </label>
              <textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={2}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="ملاحظات إضافية..."
              />
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">الأصناف المستهلكة</h2>
            <button
              type="button"
              onClick={addItem}
              className="flex items-center gap-2 px-3 py-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"
            >
              <Plus className="w-4 h-4" />
              إضافة صنف
            </button>
          </div>

          {/* Barcode Scanner Input */}
          <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
            <label className="flex items-center gap-2 text-sm font-medium text-orange-800 mb-2">
              <Barcode className="w-4 h-4" />
              إضافة صنف بالباركود
            </label>
            <div className="flex gap-2">
              <input
                ref={barcodeInputRef}
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyPress={handleBarcodeKeyPress}
                placeholder="امسح الباركود أو أدخل كود الصنف"
                className="flex-1 px-4 py-2 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                dir="ltr"
              />
              <button
                type="button"
                onClick={handleBarcodeSearch}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
                title="بحث بالباركود"
                aria-label="بحث بالباركود"
              >
                <Search className="w-5 h-5" />
              </button>
            </div>
            {barcodeError && <p className="text-red-600 text-sm mt-2">{barcodeError}</p>}
            <p className="text-xs text-orange-600 mt-1">استخدم قارئ الباركود أو أدخل الكود يدوياً ثم اضغط Enter</p>
          </div>

          <div className="space-y-4">
            {consumptionItems.map((item, index) => (
              <div key={index} className="flex gap-4 items-start p-4 bg-gray-50 rounded-lg">
                <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">الصنف</label>
                    <select
                      value={item.item_id}
                      onChange={(e) => updateItem(index, 'item_id', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      aria-label="الصنف"
                    >
                      <option value="">اختر</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name_ar} ({i.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">جزئي (الكمية)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      dir="ltr"
                      aria-label="الكمية"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">المحتوى</label>
                    <input
                      type="number"
                      min="1"
                      value={item.content}
                      onChange={(e) => updateItem(index, 'content', Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      dir="ltr"
                      aria-label="المحتوى"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">ملاحظات</label>
                    <input
                      type="text"
                      value={item.notes}
                      onChange={(e) => updateItem(index, 'notes', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      placeholder="ملاحظات"
                      aria-label="ملاحظات"
                    />
                  </div>
                </div>
                {consumptionItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                    title="حذف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? (
              <>
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                جاري الحفظ...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                حفظ
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate('/inventory/chef-consumption')}
            className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            إلغاء
          </button>
        </div>
      </form>
    </div>
  )
}
