import { supabase, fixEncodingInData } from '../lib/supabase'
import { notificationsService } from './notifications.service'

export interface SupplierReturn {
  id: string
  return_number: string
  supplier_id: string
  item_id: string
  quantity: number
  reason: string
  description: string
  status: string
  registered_at: string
  approved_at?: string
  approved_by?: string
  supplier?: { id: string; name_ar: string }
  item?: { id: string; name_ar: string; code: string }
}

export interface BranchReturn {
  id: string
  return_number: string
  from_branch_id: string
  to_branch_id: string
  status: string
  return_reason: string
  total_items: number
  total_quantity: number
  notes: string
  requested_at: string
  approved_at?: string
  from_branch?: { id: string; name_ar: string }
  to_branch?: { id: string; name_ar: string }
  items?: BranchReturnItem[]
}

export interface BranchReturnItem {
  id: string
  return_id: string
  item_id: string
  requested_quantity: number
  approved_quantity?: number
  received_quantity?: number
  item?: { id: string; name_ar: string; code: string }
}

export const returnsService = {
  // Supplier Returns
  async getSupplierReturns() {
    const { data, error } = await supabase
      .from('supplier_returns')
      .select('*, supplier:suppliers(id, name_ar), item:items(id, name_ar, code)')
      .order('registered_at', { ascending: false })
    return { data: fixEncodingInData(data) as SupplierReturn[], error }
  },

  async getSupplierReturnById(id: string) {
    const { data, error } = await supabase
      .from('supplier_returns')
      .select('*, supplier:suppliers(id, name_ar), item:items(id, name_ar, code)')
      .eq('id', id)
      .single()
    return { data: fixEncodingInData(data) as SupplierReturn, error }
  },

  async approveSupplierReturn(id: string, approvedBy: string, branchId: string) {
    // Get return details
    const { data: returnData } = await this.getSupplierReturnById(id)
    if (!returnData) return { error: new Error('Return not found') }

    // Update status
    const { error: updateError } = await supabase
      .from('supplier_returns')
      .update({
        status: 'approved',
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) return { error: updateError }

    // Deduct from inventory (return to supplier means removing from our stock)
    const { data: inventory } = await supabase
      .from('inventory')
      .select('id, quantity')
      .eq('branch_id', branchId)
      .eq('item_id', returnData.item_id)
      .single()

    if (inventory) {
      const newQuantity = Math.max(0, Number(inventory.quantity) - returnData.quantity)
      await supabase
        .from('inventory')
        .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
        .eq('id', inventory.id)
    }

    return { error: null }
  },

  async rejectSupplierReturn(id: string, rejectedBy: string, reason?: string) {
    const { error } = await supabase
      .from('supplier_returns')
      .update({
        status: 'rejected',
        rejected_by: rejectedBy,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason,
      })
      .eq('id', id)
    return { error }
  },

  // Branch Returns
  async getBranchReturns() {
    const { data, error } = await supabase
      .from('branch_returns')
      .select('*, from_branch:branches!from_branch_id(id, name_ar), to_branch:branches!to_branch_id(id, name_ar)')
      .order('requested_at', { ascending: false })
    return { data: fixEncodingInData(data) as BranchReturn[], error }
  },

  async getBranchReturnById(id: string) {
    // Get return with branches
    const { data: returnData, error: returnError } = await supabase
      .from('branch_returns')
      .select('*, from_branch:branches!from_branch_id(id, name_ar), to_branch:branches!to_branch_id(id, name_ar)')
      .eq('id', id)
      .single()

    if (returnError) return { data: null, error: returnError }

    // Get return items
    const { data: items } = await supabase
      .from('branch_return_items')
      .select('*, item:items(id, name_ar, code)')
      .eq('return_id', id)

    return { 
      data: fixEncodingInData({ ...returnData, items: items || [] }) as BranchReturn, 
      error: null 
    }
  },

  async approveBranchReturn(id: string, approvedBy: string, approvedQuantities: { itemId: string; quantity: number }[]) {
    // Get return details for notification
    const { data: returnData } = await supabase
      .from('branch_returns')
      .select('return_number, from_branch_id, to_branch_id')
      .eq('id', id)
      .single()

    // Update status
    const { error: updateError } = await supabase
      .from('branch_returns')
      .update({
        status: 'approved',
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) return { error: updateError }

    // Update approved quantities
    for (const item of approvedQuantities) {
      await supabase
        .from('branch_return_items')
        .update({ approved_quantity: item.quantity })
        .eq('return_id', id)
        .eq('item_id', item.itemId)
    }

    // Create notification
    if (returnData) {
      await notificationsService.create({
        user_id: null,
        branch_id: returnData.from_branch_id,
        type: 'return',
        title: 'تمت الموافقة على المرتجع',
        message: `تمت الموافقة على طلب المرتجع ${returnData.return_number}`,
        priority: 'medium',
        reference_type: 'branch_return',
        reference_id: id,
        expires_at: null,
      })
    }

    return { error: null }
  },

  async receiveBranchReturn(id: string, receivedBy: string, receivedQuantities: { itemId: string; quantity: number }[]) {
    // Get return details
    const { data: returnData } = await this.getBranchReturnById(id)
    if (!returnData) return { error: new Error('Return not found') }

    // Get item names for error messages
    const { data: itemsData } = await supabase
      .from('items')
      .select('id, name_ar')
      .in('id', receivedQuantities.map(i => i.itemId))

    const itemNames: Record<string, string> = {}
    itemsData?.forEach(item => { itemNames[item.id] = item.name_ar })

    // VALIDATION: Check if all quantities are available in source branch
    const insufficientItems: string[] = []
    for (const item of receivedQuantities) {
      if (item.quantity <= 0) continue

      const { data: sourceInv } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('branch_id', returnData.from_branch_id)
        .eq('item_id', item.itemId)
        .single()

      const availableQty = sourceInv?.quantity || 0
      if (availableQty < item.quantity) {
        const itemName = itemNames[item.itemId] || item.itemId
        insufficientItems.push(`${itemName}: متوفر ${availableQty} - مطلوب ${item.quantity}`)
      }
    }

    if (insufficientItems.length > 0) {
      return { 
        error: new Error(`الكمية غير متوفرة في الفرع المرسل:\n${insufficientItems.join('\n')}`) 
      }
    }

    // Update status
    const { error: updateError } = await supabase
      .from('branch_returns')
      .update({
        status: 'received',
        received_by: receivedBy,
        received_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) return { error: updateError }

    // Update received quantities and adjust inventory
    for (const item of receivedQuantities) {
      if (item.quantity <= 0) continue

      // Update return item
      await supabase
        .from('branch_return_items')
        .update({ received_quantity: item.quantity })
        .eq('return_id', id)
        .eq('item_id', item.itemId)

      // Deduct from source branch (the branch returning items)
      const { data: sourceInv } = await supabase
        .from('inventory')
        .select('id, quantity')
        .eq('branch_id', returnData.from_branch_id)
        .eq('item_id', item.itemId)
        .single()

      if (sourceInv) {
        const newSourceQty = sourceInv.quantity - item.quantity
        await supabase
          .from('inventory')
          .update({ quantity: newSourceQty, updated_at: new Date().toISOString() })
          .eq('id', sourceInv.id)
      }

      // Add to destination branch (main warehouse)
      const { data: destInv } = await supabase
        .from('inventory')
        .select('id, quantity')
        .eq('branch_id', returnData.to_branch_id)
        .eq('item_id', item.itemId)
        .single()

      if (destInv) {
        const newDestQty = Number(destInv.quantity) + item.quantity
        await supabase
          .from('inventory')
          .update({ quantity: newDestQty, updated_at: new Date().toISOString() })
          .eq('id', destInv.id)
      } else {
        // Create new inventory record
        await supabase
          .from('inventory')
          .insert({
            branch_id: returnData.to_branch_id,
            item_id: item.itemId,
            quantity: item.quantity,
            min_quantity: 0,
          })
      }
    }

    return { error: null }
  },

  async rejectBranchReturn(id: string, rejectedBy: string, reason?: string) {
    const { error } = await supabase
      .from('branch_returns')
      .update({
        status: 'rejected',
        rejected_by: rejectedBy,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason,
      })
      .eq('id', id)
    return { error }
  },
}
