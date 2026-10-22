import { supabase, fixEncodingInData } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { roundQuantity } from '../lib/utils'
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
}

export interface DamageWithDetails extends Omit<Damage, 'branch' | 'item' | 'reason'> {
  branch: { id: string; name_ar: string; code: string } | null
  // items has unit_id, not a unit column: the unit name comes from units
  item: { id: string; name_ar: string; code: string; unit: { name_ar: string } | null } | null
  reason: { id: string; name_ar: string } | null
}

// Related rows are embedded through the damages foreign keys (no long id lists, no extra round trips)
const DAMAGE_SELECT = `
  *,
  branch:branches!damages_branch_id_fkey(id, name_ar, code),
  item:items!damages_item_id_fkey(id, name_ar, code, unit:units(name_ar)),
  reason:damage_reasons!damages_reason_id_fkey(id, name_ar)
`

export const damagesService = {
  // Get all damages (every page), newest first
  async getAll(branchId?: string) {
    try {
      const rows = await fetchAll<DamageWithDetails>((from, to) => {
        let query = supabase
          .from('damages')
          .select(DAMAGE_SELECT)
          .order('registered_at', { ascending: false })
          .order('id')
        if (branchId) {
          query = query.eq('branch_id', branchId)
        }
        return query.range(from, to)
      })
      return { data: fixEncodingInData(rows) as DamageWithDetails[], error: null }
    } catch (error) {
      return { data: [] as DamageWithDetails[], error }
    }
  },

  // Get damage by ID
  async getById(id: string) {
    const { data, error } = await supabase
      .from('damages')
      .select(DAMAGE_SELECT)
      .eq('id', id)
      .single()

    if (error || !data) {
      return { data: null, error }
    }
    return { data: fixEncodingInData(data) as DamageWithDetails, error: null }
  },

  // Create damage record (number, cost and the stock check are done by the database)
  async create(damageData: CreateDamageData) {
    const { data, error } = await supabase.rpc('damage_create', {
      p_branch_id: damageData.branch_id,
      p_item_id: damageData.item_id,
      p_quantity: roundQuantity(damageData.quantity),
      p_reason_id: damageData.reason_id,
      p_unit_cost: damageData.unit_cost ?? null,
      p_description: damageData.description || null,
      p_image_url: damageData.image_url || null,
    })
    if (error) return { data: null, error }

    const created = data as { id: string; damage_number: string; item_name: string; quantity: number }
    // Notification for the approvers; a failure here does not undo the saved damage
    const { error: notifyError } = await notificationsService.create({
      user_id: null,
      branch_id: damageData.branch_id,
      type: 'damage',
      title: 'تسجيل تالف جديد',
      message: `تم تسجيل تالف جديد ${created.damage_number} - ${created.item_name || 'صنف'} (${created.quantity})`,
      priority: 'medium',
      reference_type: 'damage',
      reference_id: created.id,
      expires_at: null,
    })
    if (notifyError) console.warn('Damage notification was not sent:', notifyError)

    return { data: created, error: null }
  },

  // Approve damage and deduct it from the branch stock, in one database transaction
  async approve(id: string) {
    const { error } = await supabase.rpc('damage_approve', { p_damage_id: id })
    return { error }
  },

  // Reject damage
  async reject(id: string, reason?: string) {
    const { error } = await supabase.rpc('damage_reject', { p_damage_id: id, p_reason: reason || null })
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
