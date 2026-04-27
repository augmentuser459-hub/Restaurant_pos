import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate, getStatusColor, translateStatus } from '../../lib/utils'
import { ArrowRight, Building2, Package, Check, X, Truck, Printer } from 'lucide-react'

interface BranchReturnItem {
  id: string
  requested_quantity: number
  received_quantity: number | null
  item_reason: string
  notes: string
  item: { id: string; code: string; name_ar: string }
}

interface BranchReturn {
  id: string
  return_number: string
  return_date: string
  status: string
  return_reason: string
  total_quantity: number
  notes: string
  from_branch: { id: string; name_ar: string; code: string }
  to_branch: { id: string; name_ar: string; code: string }
  items: BranchReturnItem[]
}

export default function BranchReturnDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [returnData, setReturnData] = useState<BranchReturn | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const isReceiving = useRef(false) // Prevent double execution

  useEffect(() => {
    if (id) fetchReturn(id)
  }, [id])

  const fetchReturn = async (returnId: string) => {
    const { data } = await supabase
      .from('branch_returns')
      .select(`
        id, return_number, return_date, status, return_reason, total_quantity, notes,
        from_branch:branches!branch_returns_from_branch_id_fkey(id, name_ar, code),
        to_branch:branches!branch_returns_to_branch_id_fkey(id, name_ar, code)
      `)
      .eq('id', returnId)
      .single()
    
    // Fetch items
    const { data: items } = await supabase
      .from('branch_return_items')
      .select('id, requested_quantity, received_quantity, item_reason, notes, item:items(id, code, name_ar)')
      .eq('return_id', returnId)
    
    const returnWithItems = { ...data, items: fixEncodingInData(items) || [] }
    setReturnData(fixEncodingInData(returnWithItems) as unknown as BranchReturn)
    setLoading(false)
  }

  const handlePrint = () => {
    // Hide headers and footers by using CSS
    const style = document.createElement('style');
    style.innerHTML = `
      @media print {
        @page { margin: 0; }
        body { margin: 1cm; }
      }
    `;
    document.head.appendChild(style);
    
    window.print();
    
    // Remove the style after printing
    setTimeout(() => {
      document.head.removeChild(style);
    }, 1000);
  };

  const handleApprove = async () => {
    if (!returnData || !user) return
    setActionLoading(true)
    
    console.log('=== APPROVE PROCESS START ===')
    console.log('Return:', returnData.return_number)
    
    // Log inventory BEFORE approve
    for (const item of returnData.items) {
      const { data: sourceInv } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('branch_id', returnData.from_branch.id)
        .eq('item_id', item.item.id)
        .single()
      console.log(`BEFORE APPROVE - ${item.item.name_ar}: Source=${sourceInv?.quantity}`)
    }
    
    await supabase
      .from('branch_returns')
      .update({ 
        status: 'approved',
        updated_at: new Date().toISOString()
      })
      .eq('id', returnData.id)
    
    // Log inventory AFTER approve
    for (const item of returnData.items) {
      const { data: sourceInv } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('branch_id', returnData.from_branch.id)
        .eq('item_id', item.item.id)
        .single()
      console.log(`AFTER APPROVE - ${item.item.name_ar}: Source=${sourceInv?.quantity}`)
    }
    
    console.log('=== APPROVE PROCESS COMPLETE ===')
    fetchReturn(returnData.id)
    setActionLoading(false)
  }

  const handleReject = async () => {
    if (!returnData || !user) return
    const reason = prompt('سبب الرفض:')
    if (reason === null) return
    setActionLoading(true)
    
    await supabase
      .from('branch_returns')
      .update({ 
        status: 'rejected',
        notes: returnData.notes ? `${returnData.notes}\nسبب الرفض: ${reason}` : `سبب الرفض: ${reason}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', returnData.id)
    
    fetchReturn(returnData.id)
    setActionLoading(false)
  }

  const handleShip = async () => {
    if (!returnData || !user) return
    setActionLoading(true)
    
    console.log('=== SHIP PROCESS START ===')
    console.log('Return:', returnData.return_number)
    
    // Log inventory BEFORE ship
    for (const item of returnData.items) {
      const { data: sourceInv } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('branch_id', returnData.from_branch.id)
        .eq('item_id', item.item.id)
        .single()
      console.log(`BEFORE SHIP - ${item.item.name_ar}: Source=${sourceInv?.quantity}`)
    }
    
    await supabase
      .from('branch_returns')
      .update({ 
        status: 'in_transit',
        updated_at: new Date().toISOString()
      })
      .eq('id', returnData.id)
    
    // Log inventory AFTER ship
    for (const item of returnData.items) {
      const { data: sourceInv } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('branch_id', returnData.from_branch.id)
        .eq('item_id', item.item.id)
        .single()
      console.log(`AFTER SHIP - ${item.item.name_ar}: Source=${sourceInv?.quantity}`)
    }
    
    console.log('=== SHIP PROCESS COMPLETE ===')
    fetchReturn(returnData.id)
    setActionLoading(false)
  }

  const handleReceive = async () => {
    if (!returnData || !user) return
    
    // Prevent double execution using ref (survives re-renders)
    if (isReceiving.current) {
      console.warn('Already receiving, skipping duplicate call')
      return
    }
    if (actionLoading) return
    if (returnData.status !== 'in_transit') {
      console.warn('Return is not in_transit status, cannot receive')
      return
    }
    
    isReceiving.current = true
    setActionLoading(true)
    
    console.log('=== RECEIVE PROCESS START ===')
    console.log('Return:', returnData.return_number)
    
    // STEP 1: Check current status from database (not from state)
    const { data: currentReturn } = await supabase
      .from('branch_returns')
      .select('status')
      .eq('id', returnData.id)
      .single()
    
    if (!currentReturn || currentReturn.status !== 'in_transit') {
      console.warn('Return status is not in_transit, skipping. Current status:', currentReturn?.status)
      setActionLoading(false)
      isReceiving.current = false
      fetchReturn(returnData.id)
      return
    }
    
    // STEP 2: Read inventory values BEFORE changing status
    // (because there might be a trigger that modifies inventory on status change)
    const inventorySnapshot: { itemId: string; sourceQty: number; destQty: number; sourceInvId: string; destInvId: string | null }[] = []
    
    for (const item of returnData.items) {
      const { data: sourceInv } = await supabase
        .from('inventory')
        .select('id, quantity')
        .eq('branch_id', returnData.from_branch.id)
        .eq('item_id', item.item.id)
        .single()

      const { data: destInv } = await supabase
        .from('inventory')
        .select('id, quantity')
        .eq('branch_id', returnData.to_branch.id)
        .eq('item_id', item.item.id)
        .single()
      
      inventorySnapshot.push({
        itemId: item.item.id,
        sourceQty: Number(sourceInv?.quantity || 0),
        destQty: Number(destInv?.quantity || 0),
        sourceInvId: sourceInv?.id || '',
        destInvId: destInv?.id || null
      })
      
      console.log(`SNAPSHOT - ${item.item.name_ar}: Source=${sourceInv?.quantity}, Dest=${destInv?.quantity}`)
    }
    
    // STEP 3: Update status to 'received'
    const { data: updatedReturn, error: statusError } = await supabase
      .from('branch_returns')
      .update({ 
        status: 'received',
        received_by: user.id,
        received_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', returnData.id)
      .eq('status', 'in_transit')
      .select('id')
      .single()
    
    if (statusError || !updatedReturn) {
      console.error('Failed to update status (may already be processed):', statusError)
      setActionLoading(false)
      isReceiving.current = false
      fetchReturn(returnData.id)
      return
    }
    
    console.log('Status updated to received, now processing inventory using SNAPSHOT values...')
    
    // STEP 4: Process inventory updates using SNAPSHOT values (not current DB values)
    for (let i = 0; i < returnData.items.length; i++) {
      const item = returnData.items[i]
      const snapshot = inventorySnapshot[i]
      const qty = Number(item.requested_quantity)
      
      console.log(`Processing: ${item.item.name_ar}, qty: ${qty}`)
      
      // Update received quantity
      await supabase
        .from('branch_return_items')
        .update({ received_quantity: qty })
        .eq('id', item.id)
      
      // Deduct from source branch using SNAPSHOT value
      if (snapshot.sourceInvId) {
        const newSourceQty = Math.max(0, snapshot.sourceQty - qty)
        await supabase
          .from('inventory')
          .update({ quantity: newSourceQty, updated_at: new Date().toISOString() })
          .eq('id', snapshot.sourceInvId)
        console.log(`Source: ${snapshot.sourceQty} -> ${newSourceQty}`)
      }

      // Add to destination branch using SNAPSHOT value
      if (snapshot.destInvId) {
        const newDestQty = snapshot.destQty + qty
        await supabase
          .from('inventory')
          .update({ quantity: newDestQty, updated_at: new Date().toISOString() })
          .eq('id', snapshot.destInvId)
        console.log(`Dest: ${snapshot.destQty} -> ${newDestQty}`)
      } else {
        // Create new inventory record
        await supabase
          .from('inventory')
          .insert({
            branch_id: returnData.to_branch.id,
            item_id: item.item.id,
            quantity: qty,
            min_quantity: 0,
          })
        console.log(`Dest: Created new record with qty ${qty}`)
      }
    }
    
    // STEP 5: Verify final inventory values
    console.log('=== VERIFICATION ===')
    for (const item of returnData.items) {
      const { data: finalSource } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('branch_id', returnData.from_branch.id)
        .eq('item_id', item.item.id)
        .single()
      
      const { data: finalDest } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('branch_id', returnData.to_branch.id)
        .eq('item_id', item.item.id)
        .single()
      
      console.log(`${item.item.name_ar}: Source=${finalSource?.quantity}, Dest=${finalDest?.quantity}`)
    }
    
    console.log('=== RECEIVE PROCESS COMPLETE ===')
    fetchReturn(returnData.id)
    setActionLoading(false)
    isReceiving.current = false
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  if (!returnData) {
    return <div className="text-center py-12"><p className="text-gray-600">المرتجع غير موجود</p></div>
  }

  // Get user role
  const userRole = typeof user?.role === 'object' && user?.role !== null 
    ? (user.role as { name: string }).name 
    : user?.role

  // Branch supervisor at source can approve/ship
  const canApprove = returnData.status === 'pending' && (
    userRole === 'admin' || 
    userRole === 'warehouse_manager' ||
    (userRole === 'branch_supervisor' && user?.branch_id === returnData.from_branch?.id)
  )
  
  const canShip = returnData.status === 'approved' && (
    userRole === 'admin' || 
    userRole === 'warehouse_manager' ||
    (userRole === 'branch_supervisor' && user?.branch_id === returnData.from_branch?.id)
  )
  
  // Warehouse manager can receive at main warehouse
  const canReceive = returnData.status === 'in_transit' && (
    userRole === 'admin' || 
    userRole === 'warehouse_manager' ||
    user?.branch_id === returnData.to_branch?.id
  )

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4 print:hidden">
        <button type="button" onClick={() => navigate('/returns')} className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">مرتجع للمخزن الرئيسي</h1>
          <p className="text-gray-600">{returnData.return_number}</p>
        </div>
        <button
          type="button"
          onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          title="طباعة"
        >
          <Printer className="w-4 h-4" />
          طباعة
        </button>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(returnData.status)}`}>
          {translateStatus(returnData.status)}
        </span>
      </div>

      {/* Print Header - Only visible when printing */}
      <div className="hidden print:block text-center mb-6">
        <h1 className="text-2xl font-bold">مرتجع للمخزن الرئيسي</h1>
        <p className="text-lg text-gray-600 mt-2">{returnData.return_number}</p>
        <p className="text-sm text-gray-500 mt-1">تاريخ الطباعة: {formatDate(new Date().toISOString())}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 print:hidden" /> من فرع
          </h3>
          <p className="text-lg font-medium">{returnData.from_branch?.name_ar}</p>
          <p className="text-sm text-gray-500">{returnData.from_branch?.code}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Truck className="w-5 h-5 print:hidden" /> إلى
          </h3>
          <p className="text-lg font-medium">{returnData.to_branch?.name_ar}</p>
          <p className="text-sm text-gray-500">{returnData.to_branch?.code}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Package className="w-5 h-5 print:hidden" /> الأصناف
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full print:border-collapse">
            <thead className="bg-gray-50 print:bg-gray-200">
              <tr>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 print:border print:border-gray-300 print:text-black">الصنف</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 print:border print:border-gray-300 print:text-black">الكمية المطلوبة</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 print:border print:border-gray-300 print:text-black">الكمية المستلمة</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 print:border print:border-gray-300 print:text-black">السبب</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {returnData.items?.map(item => (
                <tr key={item.id}>
                  <td className="px-4 py-3 print:border print:border-gray-300">{item.item?.name_ar} <span className="text-gray-500">({item.item?.code})</span></td>
                  <td className="px-4 py-3 print:border print:border-gray-300">{item.requested_quantity}</td>
                  <td className="px-4 py-3 print:border print:border-gray-300">{item.received_quantity ?? '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 print:border print:border-gray-300">{item.item_reason || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 print:shadow-none print:border print:rounded-none print:p-4">
        <h3 className="font-semibold text-gray-900 mb-4">معلومات إضافية</h3>
        <div className="grid grid-cols-2 gap-4 text-sm print:gap-2">
          <div><span className="text-gray-500">التاريخ:</span> <span className="font-medium">{formatDate(returnData.return_date)}</span></div>
          <div><span className="text-gray-500">إجمالي الكمية:</span> <span className="font-medium">{returnData.total_quantity}</span></div>
          {returnData.return_reason && <div><span className="text-gray-500">سبب الإرجاع:</span> <span className="font-medium">{returnData.return_reason}</span></div>}
          {returnData.notes && <div className="col-span-2"><span className="text-gray-500">ملاحظات:</span> <span className="font-medium">{returnData.notes}</span></div>}
        </div>
      </div>

      {(canApprove || canShip || canReceive) && (
        <div className="flex gap-3 print:hidden">
          {canApprove && (
            <>
              <button type="button" onClick={handleApprove} disabled={actionLoading}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                <Check className="w-5 h-5" /> موافقة
              </button>
              <button type="button" onClick={handleReject} disabled={actionLoading}
                className="flex items-center gap-2 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                <X className="w-5 h-5" /> رفض
              </button>
            </>
          )}
          {canShip && (
            <button type="button" onClick={handleShip} disabled={actionLoading}
              className="flex items-center gap-2 px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
              <Truck className="w-5 h-5" /> بدء الشحن
            </button>
          )}
          {canReceive && (
            <button type="button" onClick={handleReceive} disabled={actionLoading}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <Check className="w-5 h-5" /> تأكيد الاستلام
            </button>
          )}
        </div>
      )}
    </div>
  )
}
