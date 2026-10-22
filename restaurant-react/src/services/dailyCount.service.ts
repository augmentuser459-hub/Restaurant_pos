import type { PostgrestError } from '@supabase/supabase-js'
import { supabase, fixEncodingInData } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { DailyInventoryCount, DailyInventoryCountItem } from '../types/database.types'

// Real counts are 'opening' / 'closing'. Chef consumption is stored in the same table with count_type 'morning'
// and is listed on its own page, never here.
const COUNT_TYPES = ['opening', 'closing']

export type DailyCountStatus = 'draft' | 'completed' | 'approved' | 'rejected'

export interface CreateDailyCountData {
  branch_id: string
  count_date: string
  count_type: 'opening' | 'closing'
  notes?: string
  items: {
    item_id: string
    system_quantity: number
    actual_quantity: number
    variance_reason?: string
  }[]
}

interface UserName {
  full_name: string
  full_name_ar?: string | null
}

export type DailyCountItemWithDetails = Omit<DailyInventoryCountItem, 'item'> & {
  item: { id: string; name_ar: string; code: string; unit: { name_ar: string; code: string } | null } | null
}

export interface DailyCountWithDetails extends Omit<DailyInventoryCount, 'branch' | 'items' | 'status'> {
  status: DailyCountStatus
  branch: { id: string; name_ar: string; code: string } | null
  counted_by_user?: UserName | null
  approved_by_user?: UserName | null
  items: DailyCountItemWithDetails[]
}

export const dailyCountService = {
  async getAll(branchId?: string) {
    try {
      const data = await fetchAll<DailyCountWithDetails>((from, to) => {
        let query = supabase
          .from('daily_inventory_counts')
          .select('*, branch:branches(id, name_ar, code)')
          .in('count_type', COUNT_TYPES)
          .order('count_date', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id')
        if (branchId) query = query.eq('branch_id', branchId)
        return query.range(from, to)
      })
      return { data: fixEncodingInData(data) as DailyCountWithDetails[], error: null }
    } catch (error) {
      return { data: null, error: error as PostgrestError }
    }
  },

  async getById(id: string) {
    const { data: count, error } = await supabase
      .from('daily_inventory_counts')
      .select(`*, branch:branches(id, name_ar, code),
        counted_by_user:users!daily_inventory_counts_counted_by_fkey(full_name, full_name_ar),
        approved_by_user:users!daily_inventory_counts_approved_by_fkey(full_name, full_name_ar)`)
      .eq('id', id)
      .in('count_type', COUNT_TYPES)
      .maybeSingle()
    if (error || !count) return { data: null, error }

    try {
      const items = await fetchAll<DailyCountItemWithDetails>((from, to) =>
        supabase
          .from('daily_inventory_count_items')
          .select('*, item:items(id, name_ar, code, unit:units(name_ar, code))')
          .eq('count_id', id)
          .order('id')
          .range(from, to)
      )
      items.sort((a, b) => (a.item?.code || '').localeCompare(b.item?.code || ''))
      return { data: fixEncodingInData({ ...count, items }) as DailyCountWithDetails, error: null }
    } catch (itemsError) {
      return { data: null, error: itemsError as PostgrestError }
    }
  },

  /** Saves the count as a draft (one database call). Returns the new count id. */
  async create(countData: CreateDailyCountData) {
    const { data, error } = await supabase.rpc('daily_count_create', {
      p_branch_id: countData.branch_id,
      p_count_date: countData.count_date,
      p_count_type: countData.count_type,
      p_notes: countData.notes ?? null,
      p_items: countData.items,
    })
    return { data: data as string | null, error }
  },

  /** draft -> completed (sent for approval) */
  async submit(id: string) {
    const { error } = await supabase.rpc('daily_count_submit', { p_count_id: id })
    return { error }
  },

  /** completed -> approved: stock is corrected by each item's variance. Returns how many items were adjusted. */
  async approve(id: string) {
    const { data, error } = await supabase.rpc('daily_count_approve', { p_count_id: id })
    return { data: data as number | null, error }
  },

  /** draft / completed -> rejected (stock unchanged) */
  async reject(id: string, reason: string) {
    const { error } = await supabase.rpc('daily_count_reject', { p_count_id: id, p_reason: reason })
    return { error }
  },
}
