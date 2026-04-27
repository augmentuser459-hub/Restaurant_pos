import { supabase, fixEncodingInData } from '../lib/supabase'
import { Transfer, TransferItem } from '../types/database.types'
import { notificationsService } from './notifications.service'

export interface CreateTransferData {
  from_branch_id: string
  to_branch_id: string
  notes?: string
  requested_by: string
  items: {
    item_id: string
    requested_quantity: number
    notes?: string
  }[]
}

export interface TransferWithDetails extends Omit<Transfer, 'from_branch' | 'to_branch' | 'items'> {
  from_branch: { id: string; name_ar: string; code: string }
  to_branch: { id: string; name_ar: string; code: string }
  items: (TransferItem & { item: { id: string; name_ar: string; code: string; unit_id?: string; unit?: { name_ar: string } | string } })[]
}

export const transfersService = {
  // Get all transfers
  async getAll(branchId?: string) {
    let query = supabase
      .from('transfers')
      .select(`
        *,
        from_branch:branches!from_branch_id(id, name_ar, code),
        to_branch:branches!to_branch_id(id, name_ar, code),
        items:transfer_items(id)
      `)
      .order('created_at', { ascending: false })

    if (branchId) {
      query = query.or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`)
    }

    const { data, error } = await query
    return { data: fixEncodingInData(data) as TransferWithDetails[], error }
  },

  // Get transfer by ID with full item details
  async getById(id: string) {
    // First get the transfer with branches
    const { data: transfer, error: transferError } = await supabase
      .from('transfers')
      .select(`
        *,
        from_branch:branches!from_branch_id(id, name_ar, code),
        to_branch:branches!to_branch_id(id, name_ar, code)
      `)
      .eq('id', id)
      .single()

    if (transferError || !transfer) {
      return { data: null, error: transferError }
    }

    // Then get the transfer items with item details
    const { data: items, error: itemsError } = await supabase
      .from('transfer_items')
      .select(`
        *,
        item:items(id, name_ar, code, unit_id, unit:units(name_ar))
      `)
      .eq('transfer_id', id)

    if (itemsError) {
      return { data: null, error: itemsError }
    }

    // Combine the data
    const result = {
      ...transfer,
      items: items || []
    }

    return { data: fixEncodingInData(result) as TransferWithDetails, error: null }
  },

  // Create transfer request
  async create(transferData: CreateTransferData) {
    const transferNumber = `TRF-${Date.now()}`

    // Insert transfer
    const { data: transfer, error: transferError } = await supabase
      .from('transfers')
      .insert({
        transfer_number: transferNumber,
        from_branch_id: transferData.from_branch_id,
        to_branch_id: transferData.to_branch_id,
        status: 'pending',
        notes: transferData.notes,
        requested_by: transferData.requested_by,
        requested_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (transferError) return { data: null, error: transferError }

    // Insert transfer items
    const transferItems = transferData.items.map(item => ({
      transfer_id: transfer.id,
      item_id: item.item_id,
      requested_quantity: item.requested_quantity,
      notes: item.notes,
    }))

    const { error: itemsError } = await supabase
      .from('transfer_items')
      .insert(transferItems)

    if (itemsError) return { data: null, error: itemsError }

    // Get branch names for notification
    const { data: fromBranch } = await supabase
      .from('branches')
      .select('name_ar')
      .eq('id', transferData.from_branch_id)
      .single()
    
    const { data: toBranch } = await supabase
      .from('branches')
      .select('name_ar')
      .eq('id', transferData.to_branch_id)
      .single()

    // Create notification for destination branch
    await notificationsService.create({
      user_id: null, // Broadcast to all users in branch
      branch_id: transferData.to_branch_id,
      type: 'transfer',
      title: 'طلب تحويل جديد',
      message: `طلب تحويل جديد ${transferNumber} من ${fromBranch?.name_ar || 'فرع'} إلى ${toBranch?.name_ar || 'فرع'}`,
      priority: 'medium',
      reference_type: 'transfer',
      reference_id: transfer.id,
      expires_at: null,
    })

    return { data: transfer as Transfer, error: null }
  },

  // Approve transfer
  async approve(id: string, approvedBy: string, approvedQuantities: { itemId: string; quantity: number }[]) {
    // Get transfer details for notification
    const { data: transfer } = await supabase
      .from('transfers')
      .select('transfer_number, from_branch_id, to_branch_id')
      .eq('id', id)
      .single()

    // Update transfer status
    const { error: transferError } = await supabase
      .from('transfers')
      .update({
        status: 'approved',
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (transferError) return { error: transferError }

    // Update approved quantities for each item
    for (const item of approvedQuantities) {
      await supabase
        .from('transfer_items')
        .update({ approved_quantity: item.quantity })
        .eq('transfer_id', id)
        .eq('item_id', item.itemId)
    }

    // Create notification for source branch (transfer approved, ready to ship)
    if (transfer) {
      await notificationsService.create({
        user_id: null,
        branch_id: transfer.from_branch_id,
        type: 'transfer',
        title: 'تمت الموافقة على التحويل',
        message: `تمت الموافقة على طلب التحويل ${transfer.transfer_number}. جاهز للشحن.`,
        priority: 'medium',
        reference_type: 'transfer',
        reference_id: id,
        expires_at: null,
      })
    }

    return { error: null }
  },

  // Reject transfer
  async reject(id: string, _rejectedBy: string, reason?: string) {
    const { error } = await supabase
      .from('transfers')
      .update({
        status: 'rejected',
        notes: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    return { error }
  },

  // Receive transfer (complete)
  // Inventory adjustment is done manually since trigger is not enabled
  async receive(id: string, receivedBy: string, receivedQuantities: { itemId: string; quantity: number }[]) {
    console.log('=== TRANSFER RECEIVE START ===')
    
    // Get transfer details first
    const { data: transfer, error: fetchError } = await supabase
      .from('transfers')
      .select('from_branch_id, to_branch_id, status, transfer_number')
      .eq('id', id)
      .single()

    if (fetchError || !transfer) return { error: fetchError || new Error('Transfer not found') }
    
    console.log('Transfer:', transfer.transfer_number)
    
    // Check if already received
    if (transfer.status === 'received') {
      console.warn('Transfer already received, skipping')
      return { error: null }
    }

    // Get item names for error messages
    const { data: itemsData } = await supabase
      .from('items')
      .select('id, name_ar')
      .in('id', receivedQuantities.map(i => i.itemId))

    const itemNames: Record<string, string> = {}
    itemsData?.forEach(item => { itemNames[item.id] = item.name_ar })

    // STEP 1: Take SNAPSHOT of inventory BEFORE any changes
    const inventorySnapshot: { 
      itemId: string
      itemName: string
      qty: number
      sourceQty: number
      destQty: number
      sourceInvId: string
      destInvId: string | null 
    }[] = []

    for (const item of receivedQuantities) {
      if (item.quantity <= 0) continue

      const { data: sourceInv } = await supabase
        .from('inventory')
        .select('id, quantity')
        .eq('branch_id', transfer.from_branch_id)
        .eq('item_id', item.itemId)
        .single()

      const { data: destInv } = await supabase
        .from('inventory')
        .select('id, quantity')
        .eq('branch_id', transfer.to_branch_id)
        .eq('item_id', item.itemId)
        .single()

      const sourceQty = Number(sourceInv?.quantity || 0)
      const destQty = Number(destInv?.quantity || 0)
      
      inventorySnapshot.push({
        itemId: item.itemId,
        itemName: itemNames[item.itemId] || item.itemId,
        qty: item.quantity,
        sourceQty,
        destQty,
        sourceInvId: sourceInv?.id || '',
        destInvId: destInv?.id || null
      })
      
      console.log(`SNAPSHOT - ${itemNames[item.itemId]}: Source=${sourceQty}, Dest=${destQty}`)
    }

    // VALIDATION: Check if all quantities are available
    const insufficientItems: string[] = []
    for (const snap of inventorySnapshot) {
      if (snap.sourceQty < snap.qty) {
        insufficientItems.push(`${snap.itemName}: متوفر ${snap.sourceQty} - مطلوب ${snap.qty}`)
      }
    }

    if (insufficientItems.length > 0) {
      return { 
        error: new Error(`الكمية غير متوفرة في المخزن المصدر:\n${insufficientItems.join('\n')}`) 
      }
    }

    // STEP 2: Update transfer status FIRST
    const { error: transferError } = await supabase
      .from('transfers')
      .update({
        status: 'received',
        received_by: receivedBy,
        received_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'approved') // Only update if still approved (optimistic locking)

    if (transferError) return { error: transferError }
    
    console.log('Status updated to received, now processing inventory using SNAPSHOT values...')

    // STEP 3: Update received quantities
    for (const item of receivedQuantities) {
      await supabase
        .from('transfer_items')
        .update({ received_quantity: item.quantity })
        .eq('transfer_id', id)
        .eq('item_id', item.itemId)
    }

    // STEP 4: Update inventory using SNAPSHOT values
    for (const snap of inventorySnapshot) {
      // Deduct from source branch using SNAPSHOT value
      if (snap.sourceInvId) {
        const newSourceQty = Math.max(0, snap.sourceQty - snap.qty)
        await supabase
          .from('inventory')
          .update({ quantity: newSourceQty, updated_at: new Date().toISOString() })
          .eq('id', snap.sourceInvId)
        console.log(`Source: ${snap.sourceQty} -> ${newSourceQty}`)
      }

      // Add to destination branch using SNAPSHOT value
      if (snap.destInvId) {
        const newDestQty = snap.destQty + snap.qty
        await supabase
          .from('inventory')
          .update({ 
            quantity: newDestQty, 
            last_restock_date: new Date().toISOString(),
            updated_at: new Date().toISOString() 
          })
          .eq('id', snap.destInvId)
        console.log(`Dest: ${snap.destQty} -> ${newDestQty}`)
      } else {
        // Create new inventory record
        await supabase
          .from('inventory')
          .insert({
            branch_id: transfer.to_branch_id,
            item_id: snap.itemId,
            quantity: snap.qty,
            min_quantity: 0,
          })
        console.log(`Dest: Created new record with qty ${snap.qty}`)
      }
    }

    console.log('=== TRANSFER RECEIVE COMPLETE ===')

    // Create notification for source branch (transfer completed)
    await notificationsService.create({
      user_id: null,
      branch_id: transfer.from_branch_id,
      type: 'transfer',
      title: 'تم استلام التحويل',
      message: `تم استلام التحويل ${transfer.transfer_number} بنجاح`,
      priority: 'low',
      reference_type: 'transfer',
      reference_id: id,
      expires_at: null,
    })

    return { error: null }
  },

  // Cancel transfer
  async cancel(id: string) {
    const { error } = await supabase
      .from('transfers')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    return { error }
  },

  // Get pending transfers count
  async getPendingCount(branchId?: string) {
    let query = supabase
      .from('transfers')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')

    if (branchId) {
      query = query.eq('to_branch_id', branchId)
    }

    const { count, error } = await query
    return { count, error }
  },
}
