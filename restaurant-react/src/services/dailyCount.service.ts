import { supabase } from '../lib/supabase'
import { DailyInventoryCount, DailyInventoryCountItem } from '../types/database.types'

export interface CreateDailyCountData {
  branch_id: string
  count_date: string
  count_type: 'opening' | 'closing'
  counted_by: string
  notes?: string
  items: {
    item_id: string
    system_quantity: number
    actual_quantity: number
    variance_reason?: string
  }[]
}

export interface DailyCountWithDetails extends Omit<DailyInventoryCount, 'branch' | 'items'> {
  branch: { id: string; name_ar: string; code: string }
  items: (DailyInventoryCountItem & { item: { id: string; name_ar: string; code: string; unit: string } })[]
}

export const dailyCountService = {
  async getAll(branchId?: string) {
    let query = supabase
      .from('daily_inventory_counts')
      .select('*, branch:branches(id, name_ar, code)')
      .order('count_date', { ascending: false })

    if (branchId) query = query.eq('branch_id', branchId)

    const { data, error } = await query
    return { data: data as DailyCountWithDetails[], error }
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('daily_inventory_counts')
      .select('*, branch:branches(id, name_ar, code), items:daily_inventory_count_items(*, item:items(id, name_ar, code, unit))')
      .eq('id', id)
      .single()

    return { data: data as DailyCountWithDetails, error }
  },

  async create(countData: CreateDailyCountData) {
    const { data: count, error: countError } = await supabase
      .from('daily_inventory_counts')
      .insert({
        branch_id: countData.branch_id,
        count_date: countData.count_date,
        count_type: countData.count_type,
        status: 'draft',
        notes: countData.notes,
        counted_by: countData.counted_by,
      })
      .select()
      .single()

    if (countError) return { data: null, error: countError }

    const countItems = countData.items.map(item => ({
      count_id: count.id,
      item_id: item.item_id,
      system_quantity: item.system_quantity,
      actual_quantity: item.actual_quantity,
      variance_reason: item.variance_reason,
    }))

    const { error: itemsError } = await supabase
      .from('daily_inventory_count_items')
      .insert(countItems)

    if (itemsError) return { data: null, error: itemsError }

    return { data: count as DailyInventoryCount, error: null }
  },

  async submit(id: string) {
    const { error } = await supabase
      .from('daily_inventory_counts')
      .update({ status: 'completed', submitted_at: new Date().toISOString() })
      .eq('id', id)

    return { error }
  },

  async approve(id: string, approvedBy: string) {
    // Get count details with items
    const { data: count, error: fetchError } = await this.getById(id)
    if (fetchError || !count) {
      return { error: fetchError || new Error('Count not found') }
    }

    // Update status
    const { error: updateError } = await supabase
      .from('daily_inventory_counts')
      .update({ status: 'approved', approved_by: approvedBy, approved_at: new Date().toISOString() })
      .eq('id', id)

    if (updateError) return { error: updateError }

    // If this is a closing count, adjust inventory based on actual quantities
    if (count.count_type === 'closing') {
      for (const item of count.items || []) {
        // Update inventory to match actual count
        const { data: inventory } = await supabase
          .from('inventory')
          .select('id')
          .eq('branch_id', count.branch_id)
          .eq('item_id', item.item_id)
          .single()

        if (inventory) {
          await supabase
            .from('inventory')
            .update({ 
              quantity: item.actual_quantity,
              updated_at: new Date().toISOString()
            })
            .eq('id', inventory.id)
        }
      }
    }

    return { error: null }
  },

  async getConsumption(branchId: string, date: string) {
    const { data: opening } = await supabase
      .from('daily_inventory_counts')
      .select('*, items:daily_inventory_count_items(*)')
      .eq('branch_id', branchId)
      .eq('count_date', date)
      .eq('count_type', 'opening')
      .single()

    const { data: closing } = await supabase
      .from('daily_inventory_counts')
      .select('*, items:daily_inventory_count_items(*)')
      .eq('branch_id', branchId)
      .eq('count_date', date)
      .eq('count_type', 'closing')
      .single()

    if (!opening || !closing) return { data: null, error: new Error('Missing counts') }

    const consumption = opening.items.map((openItem: DailyInventoryCountItem) => {
      const closeItem = closing.items.find((c: DailyInventoryCountItem) => c.item_id === openItem.item_id)
      return {
        item_id: openItem.item_id,
        opening_quantity: openItem.actual_quantity,
        closing_quantity: closeItem?.actual_quantity || 0,
        consumption: openItem.actual_quantity - (closeItem?.actual_quantity || 0),
      }
    })

    return { data: consumption, error: null }
  },
}
