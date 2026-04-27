import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { branchesService } from '../../services/branches.service'
import { inventoryService } from '../../services/inventory.service'
import { suppliersService } from '../../services/suppliers.service'
import { useAuth } from '../../contexts/AuthContext'
import { Branch, Item, Supplier } from '../../types/database.types'
import { Save, ArrowRight, AlertCircle, Plus, Trash2, Search, X, Barcode } from 'lucide-react'

interface OrderItem {
  item_id: string
  quantity: number
  unit_price: number
  notes: string
}

export default function PurchaseOrderForm() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(true)
  const [error, setError] = useState('')

  const [branches, setBranches] = useState<Branch[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  const [formData, setFormData] = useState({
    supplier_id: '',
    branch_id: user?.branch_id || '',
    expected_delivery_date: '',
    payment_type: 'cash' as 'cash' | 'credit',
    notes: '',
  })

  const [orderItems, setOrderItems] = useState<OrderItem[]>([
    { item_id: '', quantity: 1, unit_price: 0, notes: '' }
  ])
  const [searchTerm, setSearchTerm] = useState<{ [key: number]: string }>({})

  const filteredItems = (index: number) => {
    const term = searchTerm[index]?.toLowerCase() || ''
    if (!term) return items
    return items.filter(item => 
      item.name_ar.toLowerCase().includes(term) ||
      item.code.toLowerCase().includes(term) ||
      (item.barcode && item.barcode.toLowerCase().includes(term))
    )
  }

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const [branchesRes, itemsRes, suppliersRes] = await Promise.all([
      branchesService.getActive(),
      inventoryService.getAllItems(),
      suppliersService.getActive()
    ])
    if (branchesRes.data) setBranches(branchesRes.data)
    if (itemsRes.data) setItems(itemsRes.data.filter(i => i.status === 'active'))
    if (suppliersRes.data) setSuppliers(suppliersRes.data)
    setFetchLoading(false)
  }


  const calculateTotal = () => {
    return orderItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0)
  }

  const handleAddItem = () => {
    setOrderItems([...orderItems, { item_id: '', quantity: 1, unit_price: 0, notes: '' }])
  }

  const handleRemoveItem = (index: number) => {
    if (orderItems.length > 1) {
      setOrderItems(orderItems.filter((_, i) => i !== index))
    }
  }

  const handleItemChange = (index: number, field: keyof OrderItem, value: string | number) => {
    const updated = [...orderItems]
    updated[index] = { ...updated[index], [field]: value }
    
    // If item is selected, auto-fill the price from item data
    if (field === 'item_id' && value) {
      const selectedItem = items.find(i => i.id === value)
      if (selectedItem && selectedItem.purchase_price) {
        updated[index].unit_price = selectedItem.purchase_price
      }
    }
    
    setOrderItems(updated)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    // Check if user is logged in
    if (!user?.id) {
      setError('يجب تسجيل الدخول أولاً')
      return
    }

    const validItems = orderItems.filter(item => item.item_id && item.quantity > 0 && item.unit_price > 0)
    if (validItems.length === 0) {
      setError('يجب إضافة صنف واحد على الأقل مع السعر')
      return
    }

    setLoading(true)

    const orderNumber = `PO-${Date.now()}`
    const totalAmount = calculateTotal()

    const { data: order, error: orderError } = await supabase
      .from('purchase_orders')
      .insert({
        order_number: orderNumber,
        order_date: new Date().toISOString(),
        supplier_id: formData.supplier_id,
        branch_id: formData.branch_id,
        subtotal: totalAmount,
        total_amount: totalAmount,
        payment_type: formData.payment_type,
        paid_amount: formData.payment_type === 'cash' ? totalAmount : 0,
        remaining_amount: formData.payment_type === 'cash' ? 0 : totalAmount,
        payment_status: formData.payment_type === 'cash' ? 'paid' : 'pending',
        status: 'pending',
        expected_delivery_date: formData.expected_delivery_date || null,
        notes: formData.notes || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (orderError) {
      console.error('Purchase order error:', orderError)
      setError('فشل في حفظ أمر الشراء: ' + (orderError.message || 'خطأ غير معروف'))
      setLoading(false)
      return
    }

    const orderItemsData = validItems.map(item => ({
      order_id: order.id,
      item_id: item.item_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.quantity * item.unit_price,
      notes: item.notes || null,
    }))

    const { error: itemsError } = await supabase
      .from('purchase_order_items')
      .insert(orderItemsData)

    if (itemsError) {
      setError('فشل في حفظ أصناف الأمر')
      setLoading(false)
      return
    }

    // Update supplier balance if payment is on credit
    if (formData.payment_type === 'credit') {
      console.log('Payment type is credit, updating supplier balance...')
      // First get current balance
      const { data: supplier, error: fetchError } = await supabase
        .from('suppliers')
        .select('current_balance')
        .eq('id', formData.supplier_id)
        .single()
      
      if (fetchError) {
        console.error('Failed to fetch supplier:', fetchError)
      } else if (supplier) {
        const newBalance = (supplier.current_balance || 0) + totalAmount
        console.log(`Updating supplier balance: ${supplier.current_balance} + ${totalAmount} = ${newBalance}`)
        
        const { error: balanceError } = await supabase
          .from('suppliers')
          .update({ 
            current_balance: newBalance,
            updated_at: new Date().toISOString()
          })
          .eq('id', formData.supplier_id)
        
        if (balanceError) {
          console.error('Failed to update supplier balance:', balanceError)
          alert('تحذير: تم حفظ الأمر ولكن فشل تحديث رصيد المورد')
        } else {
          console.log(`✅ Updated supplier balance from ${supplier.current_balance} to ${newBalance} (+${totalAmount})`)
        }
      }
    } else {
      console.log('Payment type is cash, no balance update needed')
    }

    // Update purchase prices in items table
    console.log('Updating purchase prices for items...')
    for (const item of validItems) {
      const { error: priceUpdateError } = await supabase
        .from('items')
        .update({ 
          purchase_price: item.unit_price,
          updated_at: new Date().toISOString()
        })
        .eq('id', item.item_id)
      
      if (priceUpdateError) {
        console.error(`Failed to update price for item ${item.item_id}:`, priceUpdateError)
      } else {
        console.log(`✅ Updated purchase price for item ${item.item_id} to ${item.unit_price}`)
      }
    }

    navigate('/purchase/orders')
    setLoading(false)
  }

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  if (fetchLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button type="button" onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">أمر شراء جديد</h1>
          <p className="text-gray-600">إنشاء أمر شراء جديد</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">معلومات الأمر</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">المورد <span className="text-red-500">*</span></label>
              <select value={formData.supplier_id} onChange={(e) => handleChange('supplier_id', e.target.value)} required
                aria-label="المورد" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="">اختر المورد</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name_ar} ({s.code})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">الفرع <span className="text-red-500">*</span></label>
              <select value={formData.branch_id} onChange={(e) => handleChange('branch_id', e.target.value)} required
                aria-label="الفرع" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="">اختر الفرع</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name_ar}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">تاريخ التسليم المتوقع</label>
              <input type="date" value={formData.expected_delivery_date} onChange={(e) => handleChange('expected_delivery_date', e.target.value)}
                aria-label="تاريخ التسليم المتوقع" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" dir="ltr" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">طريقة الدفع <span className="text-red-500">*</span></label>
              <select value={formData.payment_type} onChange={(e) => handleChange('payment_type', e.target.value as 'cash' | 'credit')} required
                aria-label="طريقة الدفع" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="cash">كاش (دفع فوري)</option>
                <option value="credit">آجل (دفع بالتقسيط)</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات</label>
              <input type="text" value={formData.notes} onChange={(e) => handleChange('notes', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="ملاحظات..." />
            </div>
          </div>
        </div>


        {/* Order Items */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">الأصناف</h2>
            <button type="button" onClick={handleAddItem}
              className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg">
              <Plus className="w-4 h-4" />
              إضافة صنف
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الصنف</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الكمية</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">سعر الوحدة</th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-gray-700">الإجمالي</th>
                  <th className="py-3 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {orderItems.map((item, index) => {
                  const selectedItem = items.find(i => i.id === item.item_id)
                  const searchResults = filteredItems(index)
                  const showResults = searchTerm[index] && searchResults.length > 0
                  
                  return (
                    <tr key={index} className="border-b border-gray-100">
                      <td className="py-3 px-2">
                        <div className="relative">
                          {/* Search Input with Icon */}
                          <div className="flex items-center gap-2 mb-2 bg-blue-50 rounded-lg p-2">
                            <div className="bg-blue-600 text-white p-2 rounded-lg">
                              <Search className="w-5 h-5" />
                            </div>
                            <input
                              type="text"
                              placeholder="امسح الباركود أو أدخل الكود أو اسم الصنف"
                              value={searchTerm[index] || ''}
                              onChange={(e) => {
                                setSearchTerm({ ...searchTerm, [index]: e.target.value })
                                // Auto-select if only one result
                                const results = items.filter(i => 
                                  i.name_ar.toLowerCase().includes(e.target.value.toLowerCase()) ||
                                  i.code.toLowerCase().includes(e.target.value.toLowerCase()) ||
                                  (i.barcode && i.barcode.toLowerCase().includes(e.target.value.toLowerCase()))
                                )
                                if (results.length === 1 && e.target.value.length > 2) {
                                  handleItemChange(index, 'item_id', results[0].id)
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && searchResults.length > 0) {
                                  handleItemChange(index, 'item_id', searchResults[0].id)
                                  setSearchTerm({ ...searchTerm, [index]: '' })
                                }
                              }}
                              className="flex-1 px-3 py-2 border-0 bg-transparent focus:outline-none text-gray-700 placeholder-gray-500"
                            />
                          </div>
                          
                          {/* Search Results Dropdown */}
                          {showResults && (
                            <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                              {searchResults.map(i => (
                                <button
                                  key={i.id}
                                  type="button"
                                  onClick={() => {
                                    handleItemChange(index, 'item_id', i.id)
                                    setSearchTerm({ ...searchTerm, [index]: '' })
                                  }}
                                  className="w-full text-right px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-0 transition-colors"
                                >
                                  <div className="font-medium text-gray-900">{i.name_ar}</div>
                                  <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                                    <span>الكود: {i.code}</span>
                                    {i.barcode && (
                                      <>
                                        <span>•</span>
                                        <span>الباركود: {i.barcode}</span>
                                      </>
                                    )}
                                    {i.purchase_price && (
                                      <>
                                        <span>•</span>
                                        <span className="text-green-600">{i.purchase_price} ج.م</span>
                                      </>
                                    )}
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                          
                          {/* Selected Item Display */}
                          {selectedItem && (
                            <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="font-medium text-green-900">{selectedItem.name_ar}</p>
                                  <p className="text-sm text-green-700">
                                    الكود: {selectedItem.code}
                                    {selectedItem.barcode && ` | الباركود: ${selectedItem.barcode}`}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleItemChange(index, 'item_id', '')
                                    setSearchTerm({ ...searchTerm, [index]: '' })
                                  }}
                                  className="text-red-500 hover:text-red-700"
                                  title="إلغاء الاختيار"
                                >
                                  <X className="w-5 h-5" />
                                </button>
                              </div>
                            </div>
                          )}
                          
                          {/* Helper Text */}
                          {!selectedItem && !searchTerm[index] && (
                            <p className="text-sm text-blue-600 mt-2 flex items-center gap-2">
                              <Barcode className="w-4 h-4" />
                              استخدم قارئ الباركود أو أدخل الكود يدوياً ثم اضغط Enter
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                          aria-label="الكمية" placeholder="مثال: 19.200" className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" dir="ltr" />
                      </td>
                      <td className="py-3 px-2">
                        <input type="number" min="0" step="0.01" value={item.unit_price} onChange={(e) => handleItemChange(index, 'unit_price', Number(e.target.value))}
                          aria-label="سعر الوحدة" className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" dir="ltr" />
                      </td>
                      <td className="py-3 px-2 text-sm font-medium text-gray-900">
                        {(item.quantity * item.unit_price).toLocaleString('ar-EG')} ج.م
                      </td>
                      <td className="py-3 px-2">
                        <button type="button" onClick={() => handleRemoveItem(index)} disabled={orderItems.length === 1}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed" title="حذف">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex justify-between gap-8">
                <span className="text-gray-600">الإجمالي:</span>
                <span className="font-bold text-lg text-gray-900">{calculateTotal().toLocaleString('ar-EG')} ج.م</span>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? (
              <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />جاري الحفظ...</>
            ) : (
              <><Save className="w-5 h-5" />حفظ الأمر</>
            )}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">
            إلغاء
          </button>
        </div>
      </form>
    </div>
  )
}
