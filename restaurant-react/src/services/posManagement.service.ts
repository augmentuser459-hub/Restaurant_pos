import { supabase, fixEncodingInData } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'

// Branch prices live in branch_pos_items.price (one row per branch and item). items.selling_price is only
// the default price used when an item is added to a branch; nothing here writes it.
// Every change goes through a posm_* database function (admin only, one transaction each). A row priced 0 is
// never left available (it would be sold for 0 EGP): such rows stay hidden until they get a price.
// What the cashier sells is read by the cashier screen from pos_sellable_items (orders.service.ts).

export interface BranchPOSItem {
  id: string
  branch_id: string
  item_id: string
  price: number
  is_available: boolean
  display_order: number
  created_at: string
  updated_at: string
  item?: {
    id: string
    code: string
    name: string
    name_ar: string
    is_recipe: boolean
    image_url?: string
    purchase_price?: number
    selling_price?: number
    calculated_cost?: number
    unit?: {
      id: string
      code: string
      name_ar: string
    } | null
  }
  stock_quantity?: number
  in_stock?: boolean
  branch?: {
    id: string
    code: string
    name: string
    name_ar: string
  }
}

export interface AvailableInventoryItem {
  id: string
  code: string
  name: string
  name_ar: string
  is_recipe: boolean
  image_url?: string
  selling_price?: number | null
  purchase_price?: number | null
  unit?: {
    name_ar: string
  }
  stock_quantity: number
}

export interface POSItemChange {
  id: string
  price?: number
  is_available?: boolean
}

export interface ItemCostChange {
  item_id: string
  cost: number
}

const num = (value: unknown) => Number(value ?? 0) || 0

export const posManagementService = {
  // All listed items of a branch (management table), with unit and cost (recipe cost is computed in the view)
  async getBranchPOSItems(branchId: string) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await fetchAll<any>((from, to) =>
        supabase
          .from('v_branch_pos_items_with_stock')
          .select('*')
          .eq('branch_id', branchId)
          .order('display_order')
          .order('id')
          .range(from, to))

      const items = rows.map(row => {
        const item = typeof row.item === 'string' ? JSON.parse(row.item) : row.item
        return {
          ...row,
          price: num(row.price),
          stock_quantity: num(row.stock_quantity),
          item: { ...item, calculated_cost: num(row.unit_cost) },
        }
      })
      return { data: fixEncodingInData(items) as BranchPOSItem[], error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  // Selling branches with the number of items listed in each
  async getBranchesWithItemCounts() {
    const { data: branches, error: branchError } = await supabase
      .from('branches')
      .select('id, code, name, name_ar, is_main_warehouse, status')
      .eq('is_main_warehouse', false)
      .eq('status', 'active')
      .order('name')

    if (branchError) return { data: null, error: branchError }

    // Count per branch (head request) to avoid the 1000-row limit
    const counts = await Promise.all(
      (branches || []).map(branch =>
        supabase
          .from('v_branch_pos_items_with_stock')
          .select('id', { count: 'exact', head: true })
          .eq('branch_id', branch.id))
    )
    const countError = counts.find(c => c.error)?.error
    if (countError) return { data: null, error: countError }

    const branchesWithCounts = (branches || []).map((branch, i) => ({
      ...branch,
      itemCount: counts[i].count || 0,
    }))
    return { data: fixEncodingInData(branchesWithCounts), error: null }
  },

  // Active items of the branch's inventory (candidates for 'إضافة منتج' / 'إضافة الكل')
  async getAvailableInventoryItems(branchId: string) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await fetchAll<any>((from, to) =>
        supabase
          .from('inventory')
          .select(`
            item_id,
            quantity,
            item:items!inner(
              id, code, name, name_ar, is_recipe, image_url, selling_price, purchase_price, status,
              unit:units(name_ar)
            )
          `)
          .eq('branch_id', branchId)
          .eq('item.status', 'active')
          .order('item_id')
          .range(from, to))

      const items = rows
        .filter(inv => inv.item)
        .map(inv => {
          const item = Array.isArray(inv.item) ? inv.item[0] : inv.item
          return {
            id: item.id,
            code: item.code,
            name: item.name,
            name_ar: item.name_ar,
            is_recipe: item.is_recipe,
            image_url: item.image_url,
            selling_price: item.selling_price,
            purchase_price: item.purchase_price,
            unit: Array.isArray(item.unit) ? item.unit[0] : item.unit,
            stock_quantity: num(inv.quantity),
          }
        })
      return { data: fixEncodingInData(items) as AvailableInventoryItem[], error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  // Add one item to a branch's POS at the given price (re-lists it if it was removed)
  async addItemToPOS(branchId: string, itemId: string, price: number) {
    const { data, error } = await supabase.rpc('posm_add_item', {
      p_branch_id: branchId,
      p_item_id: itemId,
      p_price: price,
    })
    return { data: data as string | null, error }
  },

  // 'إضافة الكل': every active inventory item not listed yet (or removed), at its default price.
  // added = new or listed again; repriced = listed rows that were priced 0; hidden_no_price = added rows
  // without any default price, which stay hidden until a price is entered.
  async addAllInventoryItems(branchId: string) {
    const { data, error } = await supabase.rpc('posm_add_all_items', { p_branch_id: branchId })
    return { data: data as { added: number; repriced: number; hidden_no_price: number } | null, error }
  },

  // 'تحديث الأسعار': listed items priced 0 get their default price (selling price, else purchase price).
  // updatedHidden = of the updated rows, how many are hidden from the cashier; remaining = rows still priced 0
  // (the item has no price at all), which the database keeps hidden.
  async fixPricesFromInventory(branchId: string) {
    const { data, error } = await supabase.rpc('posm_fix_zero_prices', { p_branch_id: branchId })
    const result = data as { updated: number; updated_hidden: number; remaining: number } | null
    return {
      updated: result?.updated ?? 0,
      updatedHidden: result?.updated_hidden ?? 0,
      remaining: result?.remaining ?? 0,
      error,
    }
  },

  // Remove item from POS (kept as removed, so the cashier screen does not list it again because of its stock)
  async removeItemFromPOS(id: string) {
    const { error } = await supabase.rpc('posm_remove_item', { p_id: id })
    return { error }
  },

  // Save the edited prices / availability of this branch and the edited item costs, all or nothing
  async saveChanges(branchId: string, items: POSItemChange[], costs: ItemCostChange[]) {
    const { data, error } = await supabase.rpc('posm_save_changes', {
      p_branch_id: branchId,
      p_items: items.map(i => ({ id: i.id, price: i.price ?? null, is_available: i.is_available ?? null })),
      p_costs: costs,
    })
    return { data: data as { items: number; costs: number } | null, error }
  },

  // Copy listed items and prices from one branch to another (only the target branch changes).
  // Source rows priced 0 are only added where the target lacks them, hidden (hidden_no_price).
  async copyPricesFromBranch(sourceBranchId: string, targetBranchId: string) {
    const { data, error } = await supabase.rpc('posm_copy_prices', {
      p_source_branch_id: sourceBranchId,
      p_target_branch_id: targetBranchId,
    })
    return { data: data as { inserted: number; updated: number; hidden_no_price: number } | null, error }
  },

  // Apply a percentage change to every listed price of ONE branch
  async applyPercentageChange(branchId: string, percentage: number) {
    const { data, error } = await supabase.rpc('posm_apply_percentage', {
      p_branch_id: branchId,
      p_percent: percentage,
    })
    return { data: data as { updated: number } | null, error }
  },
}
