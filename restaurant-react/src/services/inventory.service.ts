import type { PostgrestError } from '@supabase/supabase-js'
import { supabase, fixEncodingInData } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { Item, Inventory, Category } from '../types/database.types'

export interface Unit {
  id: string
  code: string
  name_ar: string
  name?: string
}

export interface InventoryWithDetails extends Omit<Inventory, 'branch' | 'item'> {
  item: Item
  branch: { id: string; name_ar: string; code: string }
}

/** Item columns item_save() accepts. On update only the keys present are changed. */
export interface ItemSaveData {
  code?: string
  barcode?: string | null
  name?: string
  name_ar?: string
  description?: string | null
  unit_id?: string
  category_id?: string | null
  purchase_price?: number
  selling_price?: number
  min_stock_level?: number
  max_stock_level?: number | null
  reorder_level?: number | null
  status?: 'active' | 'inactive'
}

/**
 * One row of a stock import file (null = blank cell = leave unchanged).
 * A number cell that could not be read is sent as its text, so the database reports it for that row.
 */
export interface StockImportRow {
  row: number
  code: string
  name: string | null
  category: string | null
  unit: string | null
  quantity: number | string | null
  opening_balance: number | string | null
  purchase_price: number | string | null
  selling_price: number | string | null
}

export interface StockImportChange {
  row: number
  code: string
  name: string | null
  action: 'new' | 'update'
  quantity_before?: number
  quantity_after?: number
  opening_balance_before?: number | null
  opening_balance_after?: number
  purchase_price_before?: number | null
  purchase_price_after?: number
  selling_price_before?: number | null
  selling_price_after?: number
  category_before?: string | null
  category_after?: string
}

export interface StockImportResult {
  dry_run: boolean
  rows: number
  created_items: number
  updated_items: number
  created_categories: number
  quantity_changes: number
  opening_balance_changes: number
  unchanged: number
  errors: { row: number; code: string; message: string }[]
  changes: StockImportChange[]
}

const STOCK_SELECT =
  '*, item:items(id, code, barcode, name_ar, min_stock_level, category_id, purchase_price, selling_price, unit:units(id, name_ar, code), category:categories(id, name_ar))'

export const inventoryService = {
  // Items CRUD
  async getAllItems() {
    try {
      const data = await fetchAll<Item>((from, to) =>
        supabase
          .from('items')
          .select('*, category:categories(name_ar), unit:units(id, name_ar, code)')
          .order('name_ar')
          .order('id')
          .range(from, to)
      )
      return { data: fixEncodingInData(data) as Item[], error: null }
    } catch (error) {
      return { data: null, error: error as PostgrestError }
    }
  },

  // Search item by barcode, then by code
  async getItemByBarcode(barcode: string) {
    const value = barcode.trim()
    const select = '*, category:categories(name_ar), unit:units(id, name_ar, code)'
    const byBarcode = await supabase.from('items').select(select).eq('barcode', value).maybeSingle()
    if (byBarcode.error || byBarcode.data) {
      return { data: fixEncodingInData(byBarcode.data) as Item | null, error: byBarcode.error }
    }
    const byCode = await supabase.from('items').select(select).eq('code', value).maybeSingle()
    if (byCode.error || byCode.data || value.startsWith('"')) {
      return { data: fixEncodingInData(byCode.data) as Item | null, error: byCode.error }
    }
    // many imported codes are stored wrapped in quotes ("6223000123456")
    const byQuotedCode = await supabase.from('items').select(select).eq('code', `"${value}"`).maybeSingle()
    return { data: fixEncodingInData(byQuotedCode.data) as Item | null, error: byQuotedCode.error }
  },

  async getItemById(id: string) {
    const { data, error } = await supabase
      .from('items')
      .select('*, category:categories(name_ar)')
      .eq('id', id)
      .single()

    return { data: fixEncodingInData(data) as Item, error }
  },

  /** Creates (id null) or updates an item in one database call; a new item also gets an empty main-warehouse stock row. */
  async saveItem(id: string | null, item: ItemSaveData) {
    const { data, error } = await supabase.rpc('item_save', { p_item_id: id, p_item: item })
    return { data: data as string | null, error }
  },

  /** Deletes an item from the system (refused while it has stock, is a recipe ingredient or has history). */
  async deleteItem(id: string) {
    const { error } = await supabase.rpc('item_delete', { p_item_id: id })
    return { error }
  },

  // Categories
  async getCategories() {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .order('name_ar')

    return { data: fixEncodingInData(data) as Category[], error }
  },

  /**
   * Creates (id null) or updates a category and moves items in/out of it, in one database call
   * (the id lists travel in the request body, so long lists are fine). Only keys present in `category` change.
   */
  async saveCategory(
    id: string | null,
    category: { code?: string; name?: string; name_ar?: string; description?: string | null; sort_order?: number; is_active?: boolean; is_kitchen?: boolean },
    addItemIds: string[] = [],
    removeItemIds: string[] = []
  ) {
    const { data, error } = await supabase.rpc('item_category_save', {
      p_category_id: id,
      p_category: category,
      p_add_item_ids: addItemIds,
      p_remove_item_ids: removeItemIds,
    })
    return { data: data as string | null, error }
  },

  /** Deletes an empty category (refused while items are in it). */
  async deleteCategory(id: string) {
    const { error } = await supabase.rpc('item_category_delete', { p_category_id: id })
    return { error }
  },

  // Inventory/Stock
  async getStock(branchId?: string) {
    try {
      const data = await fetchAll<InventoryWithDetails>((from, to) => {
        let query = supabase
          .from('inventory')
          .select(`${STOCK_SELECT}, branch:branches(id, name_ar, code)`)
          .order('quantity', { ascending: true })
          .order('id')
        if (branchId) query = query.eq('branch_id', branchId)
        return query.range(from, to)
      })
      return { data: fixEncodingInData(data) as InventoryWithDetails[], error: null }
    } catch (error) {
      return { data: null, error: error as PostgrestError }
    }
  },

  async getStockByBranch(branchId: string) {
    try {
      const data = await fetchAll<InventoryWithDetails>((from, to) =>
        supabase
          .from('inventory')
          .select(STOCK_SELECT)
          .eq('branch_id', branchId)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to)
      )
      return { data: fixEncodingInData(data) as InventoryWithDetails[], error: null }
    } catch (error) {
      return { data: null, error: error as PostgrestError }
    }
  },

  async getLowStock(threshold?: number) {
    try {
      const data = await fetchAll<InventoryWithDetails>((from, to) =>
        supabase
          .from('inventory')
          .select('*, item:items(id, code, name_ar, min_stock_level, unit:units(id, name_ar, code)), branch:branches(id, name_ar, code)')
          .lt('quantity', threshold ?? 10)
          .order('quantity', { ascending: true })
          .order('id')
          .range(from, to)
      )
      return { data: fixEncodingInData(data) as InventoryWithDetails[], error: null }
    } catch (error) {
      return { data: null, error: error as PostgrestError }
    }
  },

  /**
   * Saves the stock list's inline edit in one database call. `quantity` is sent only when the user changed it,
   * with the quantity the page showed (`expectedQuantity`): the database refuses when the stock moved meanwhile,
   * and logs the change as an adjustment. Returns the quantity after saving.
   */
  async saveStockRow(params: {
    inventoryId: string
    item?: ItemSaveData | null
    quantity?: number | null
    expectedQuantity?: number | null
    openingBalance?: number | null
  }) {
    const { data, error } = await supabase.rpc('inv_save_stock_row', {
      p_inventory_id: params.inventoryId,
      p_item: params.item && Object.keys(params.item).length > 0 ? params.item : null,
      p_quantity: params.quantity ?? null,
      p_expected_quantity: params.expectedQuantity ?? null,
      p_opening_balance: params.openingBalance ?? null,
    })
    return { data: data as number | null, error }
  },

  /** Removes items from a branch's stock list (the items stay in the system). Returns how many rows were removed. */
  async removeStockRows(inventoryIds: string[]) {
    const { data, error } = await supabase.rpc('inv_remove_stock_rows', { p_inventory_ids: inventoryIds })
    return { data: data as number | null, error }
  },

  /** Stock CSV import: `dryRun` returns the preview; otherwise applies everything in one transaction. */
  async importStock(params: {
    branchId: string
    rows: StockImportRow[]
    updateItems: boolean
    updateQuantities: boolean
    dryRun: boolean
  }) {
    const { data, error } = await supabase.rpc('inv_import_stock', {
      p_branch_id: params.branchId,
      p_rows: params.rows,
      p_update_items: params.updateItems,
      p_update_quantities: params.updateQuantities,
      p_dry_run: params.dryRun,
    })
    return { data: fixEncodingInData(data) as StockImportResult | null, error }
  },

  /**
   * Records chef consumption and deducts exactly those quantities from the branch stock, in one database call.
   * Rows of the same item are added together; refused (nothing saved) when stock is not enough.
   */
  async recordChefConsumption(params: {
    branchId: string
    date: string
    notes?: string
    items: { item_id: string; quantity: number; content: number; notes?: string }[]
  }) {
    const { data, error } = await supabase.rpc('chef_consumption_record', {
      p_branch_id: params.branchId,
      p_date: params.date,
      p_notes: params.notes ?? null,
      p_items: params.items,
    })
    return { data: data as string | null, error }
  },

  // Check if item code exists
  async itemCodeExists(code: string, excludeId?: string) {
    let query = supabase
      .from('items')
      .select('id')
      .eq('code', code)

    if (excludeId) {
      query = query.neq('id', excludeId)
    }

    const { data, error } = await query
    return { exists: Boolean(data && data.length > 0), error }
  },

  // Get all units
  async getUnits() {
    const { data, error } = await supabase
      .from('units')
      .select('id, code, name_ar, name')
      .order('name_ar')

    return { data: fixEncodingInData(data) as Unit[], error }
  },
}
