import { supabase, fixEncodingInData } from '../lib/supabase'
import { Damage, DamageReason } from '../types/database.types'
import { notificationsService } from './notifications.service'

export interface CreateDamageData {
  branch_id: string
  item_id: string
  quantity: number
  unit_cost?: number
  reason_id: string
  description?: string
  image_url?: string
  registered_by: string
}

export interface DamageWithDetails extends Omit<Damage, 'branch' | 'item' | 'reason'> {
  branch: { id: string; name_ar: string; code: string }
  item: { id: string; name_ar: string; code: string; unit: string }
  reason: { id: string; name_ar: string }
}

export const damagesService = {
  // Get all damages
  async getAll(branchId?: string) {
    console.log('damagesService.getAll called with branchId:', branchId)
    
    // First get damages
    let query = supabase
      .from('damages')
      .select('*')
      .order('registered_at', { ascending: false })

    if (branchId) {
      query = query.eq('branch_id', branchId)
    }

    const { data: damages, error } = await query
    
    if (error || !damages) {
      console.log('damagesService.getAll error:', error)
      return { data: [], error }
    }
    
    // Get related data
    const branchIds = [...new Set(damages.map(d => d.branch_id))]
    const itemIds = [...new Set(damages.map(d => d.item_id))]
    const reasonIds = [...new Set(damages.map(d => d.reason_id).filter(Boolean))]
    
    const [branchesRes, itemsRes, reasonsRes] = await Promise.all([
      supabase.from('branches').select('id, name_ar, code').in('id', branchIds),
      supabase.from('items').select('id, name_ar, code, unit').in('id', itemIds),
      reasonIds.length > 0 
        ? supabase.from('damage_reasons').select('id, name_ar').in('id', reasonIds)
        : { data: [] }
    ])
    
    const branchMap = new Map((branchesRes.data || []).map(b => [b.id, b]))
    const itemMap = new Map((itemsRes.data || []).map(i => [i.id, i]))
    const reasonMap = new Map((reasonsRes.data || []).map(r => [r.id, r]))
    
    const result = damages.map(d => ({
      ...d,
      branch: branchMap.get(d.branch_id) || null,
      item: itemMap.get(d.item_id) || null,
      reason: d.reason_id ? reasonMap.get(d.reason_id) || null : null
    }))
    
    console.log('damagesService.getAll result:', { count: result.length })
    return { data: fixEncodingInData(result) as DamageWithDetails[], error: null }
  },

  // Get damage by ID
  async getById(id: string) {
    // Get damage
    const { data: damage, error } = await supabase
      .from('damages')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !damage) {
      return { data: null, error }
    }

    // Get related data
    const [branchRes, itemRes, reasonRes] = await Promise.all([
      supabase.from('branches').select('id, name_ar, code').eq('id', damage.branch_id).single(),
      supabase.from('items').select('id, name_ar, code, unit').eq('id', damage.item_id).single(),
      damage.reason_id 
        ? supabase.from('damage_reasons').select('id, name_ar').eq('id', damage.reason_id).single()
        : { data: null }
    ])

    const result = {
      ...damage,
      branch: branchRes.data || null,
      item: itemRes.data || null,
      reason: reasonRes.data || null
    }

    return { data: fixEncodingInData(result) as DamageWithDetails, error: null }
  },

  // Create damage record
  async create(damageData: CreateDamageData) {
    const damageNumber = `DMG-${Date.now()}`
    const totalCost = damageData.unit_cost 
      ? damageData.quantity * damageData.unit_cost 
      : undefined

    const { data, error } = await supabase
      .from('damages')
      .insert({
        damage_number: damageNumber,
        branch_id: damageData.branch_id,
        item_id: damageData.item_id,
        quantity: damageData.quantity,
        unit_cost: damageData.unit_cost,
        total_cost: totalCost,
        reason_id: damageData.reason_id,
        description: damageData.description,
        image_url: damageData.image_url,
        status: 'pending',
        registered_by: damageData.registered_by,
        registered_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (data) {
      // Get item name for notification
      const { data: item } = await supabase
        .from('items')
        .select('name_ar')
        .eq('id', damageData.item_id)
        .single()

      // Create notification for warehouse manager
      await notificationsService.create({
        user_id: null,
        branch_id: damageData.branch_id,
        type: 'damage',
        title: 'تسجيل تالف جديد',
        message: `تم تسجيل تالف جديد ${damageNumber} - ${item?.name_ar || 'صنف'} (${damageData.quantity})`,
        priority: 'medium',
        reference_type: 'damage',
        reference_id: data.id,
        expires_at: null,
      })
    }

    return { data: data as Damage, error }
  },

  // Approve damage and deduct from inventory
  async approve(id: string, approvedBy: string) {
    console.log('=== DAMAGE APPROVE START ===')
    
    // Get damage details first
    const { data: damage, error: fetchError } = await supabase
      .from('damages')
      .select('branch_id, item_id, quantity, status, damage_number')
      .eq('id', id)
      .single()

    if (fetchError || !damage) {
      return { error: fetchError || new Error('Damage not found') }
    }
    
    console.log('Damage:', damage.damage_number, 'Qty:', damage.quantity)
    
    // Check if already approved
    if (damage.status === 'approved') {
      console.warn('Damage already approved, skipping')
      return { error: null }
    }

    // STEP 1: Take SNAPSHOT of inventory BEFORE any changes
    const { data: inventory } = await supabase
      .from('inventory')
      .select('id, quantity')
      .eq('branch_id', damage.branch_id)
      .eq('item_id', damage.item_id)
      .single()

    const snapshotQty = Number(inventory?.quantity || 0)
    const inventoryId = inventory?.id || ''
    
    console.log('SNAPSHOT - Current inventory:', snapshotQty)

    if (!inventory || snapshotQty < damage.quantity) {
      return { error: new Error(`الكمية غير متوفرة. متوفر: ${snapshotQty} - مطلوب: ${damage.quantity}`) }
    }

    // STEP 2: Update damage status FIRST
    const { error: updateError } = await supabase
      .from('damages')
      .update({
        status: 'approved',
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending') // Only update if still pending (optimistic locking)

    if (updateError) return { error: updateError }
    
    console.log('Status updated to approved, now deducting from inventory using SNAPSHOT value...')

    // STEP 3: Deduct from inventory using SNAPSHOT value
    const newQuantity = Math.max(0, snapshotQty - damage.quantity)
    const { error: invError } = await supabase
      .from('inventory')
      .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
      .eq('id', inventoryId)
    
    console.log(`Inventory: ${snapshotQty} -> ${newQuantity}`)
    console.log('=== DAMAGE APPROVE COMPLETE ===')

    return { error: invError }
  },

  // Reject damage
  async reject(id: string, rejectedBy: string, reason?: string) {
    const { error } = await supabase
      .from('damages')
      .update({
        status: 'rejected',
        rejected_by: rejectedBy,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    return { error }
  },

  // Get damage reasons
  async getReasons() {
    const { data, error } = await supabase
      .from('damage_reasons')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')

    return { data: fixEncodingInData(data) as DamageReason[], error }
  },

  // Get pending damages count
  async getPendingCount(branchId?: string) {
    let query = supabase
      .from('damages')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')

    if (branchId) {
      query = query.eq('branch_id', branchId)
    }

    const { count, error } = await query
    return { count, error }
  },
}
