import { supabase, fixEncodingInData } from '../lib/supabase'

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
    calculated_cost?: number
    unit?: {
      id: string
      code: string
      name_ar: string
    }
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
  unit?: {
    name_ar: string
  }
  stock_quantity: number
}

export const posManagementService = {
  // Get all branch POS items for a specific branch (with stock info)
  async getBranchPOSItems(branchId: string) {
    const { data, error } = await supabase
      .from('v_branch_pos_items_with_stock')
      .select('*')
      .eq('branch_id', branchId)
      .order('display_order')
      .limit(10000)

    if (error) return { data: null, error }

    // Parse item JSONB and calculate recipe costs
    const itemsWithCosts = await Promise.all(
      (data || []).map(async (row: any) => {
        // Parse item from JSONB
        const item = typeof row.item === 'string' ? JSON.parse(row.item) : row.item
        
        let calculatedCost = item?.purchase_price || 0
        
        // If it's a recipe, calculate cost from ingredients
        if (item?.is_recipe) {
          const { data: costData } = await supabase.rpc('calculate_recipe_cost', {
            recipe_item_id: row.item_id
          })
          calculatedCost = costData || 0
        }
        
        return {
          ...row,
          item: {
            ...item,
            calculated_cost: calculatedCost
          }
        }
      })
    )

    return { data: fixEncodingInData(itemsWithCosts) as BranchPOSItem[], error: null }
  },

  // Get all branches with their POS item counts - count per branch to avoid 1000 row limit
  async getBranchesWithItemCounts() {
    const { data: branches, error: branchError } = await supabase
      .from('branches')
      .select('id, code, name, name_ar, is_main_warehouse, status')
      .eq('is_main_warehouse', false)
      .eq('status', 'active')
      .order('name')

    if (branchError) return { data: null, error: branchError }

    // Count per branch separately to avoid the 1000-row global limit
    const branchesWithCounts = await Promise.all(
      (branches || []).map(async (branch) => {
        const { count } = await supabase
          .from('branch_pos_items')
          .select('*', { count: 'exact', head: true })
          .eq('branch_id', branch.id)

        return {
          ...branch,
          itemCount: count || 0
        }
      })
    )

    return { data: fixEncodingInData(branchesWithCounts), error: null }
  },

  // Get available inventory items for a branch (recipes + selected products)
  async getAvailableInventoryItems(branchId: string) {
    const { data, error } = await supabase
      .from('inventory')
      .select(`
        item_id,
        quantity,
        item:items(
          id, code, name, name_ar, is_recipe, image_url, selling_price, purchase_price,
          unit:units(name_ar)
        )
      `)
      .eq('branch_id', branchId)
      .order('item(name_ar)')
      .limit(10000)

    if (error) return { data: null, error }

    // Filter and transform
    const items = data
      ?.filter(inv => inv.item && !Array.isArray(inv.item))
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
          stock_quantity: inv.quantity
        }
      })

    return { data: fixEncodingInData(items) as AvailableInventoryItem[], error: null }
  },

  // Add item to POS
  async addItemToPOS(branchId: string, itemId: string, price: number) {
    // First, update the base item's selling price
    await supabase
      .from('items')
      .update({
        selling_price: price,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)

    // Then add to POS
    const { data, error } = await supabase
      .from('branch_pos_items')
      .insert({
        branch_id: branchId,
        item_id: itemId,
        price: price,
        is_available: true,
        display_order: 0
      })
      .select()
      .single()

    return { data, error }
  },

  // Fix zero prices: update branch_pos_items.price from items.selling_price in batches
  async fixPricesFromInventory(branchId: string, onProgress?: (done: number, total: number) => void) {
    // Get all POS items with price = 0 for this branch
    const { data: zeroPriceItems, error: fetchError } = await supabase
      .from('branch_pos_items')
      .select('id, item_id')
      .eq('branch_id', branchId)
      .eq('price', 0)
      .limit(10000)

    if (fetchError || !zeroPriceItems || zeroPriceItems.length === 0) {
      return { updated: 0, error: fetchError }
    }

    // Get all item prices in one query
    const itemIds = zeroPriceItems.map(p => p.item_id)
    const { data: items, error: itemsError } = await supabase
      .from('items')
      .select('id, selling_price, purchase_price')
      .in('id', itemIds)

    if (itemsError || !items) return { updated: 0, error: itemsError }

    // Build item price map
    const priceMap = new Map(items.map(i => [i.id, i.selling_price || i.purchase_price || 0]))

    // Filter only items that have a valid price > 0
    const itemsToFix = zeroPriceItems.filter(p => {
      const price = priceMap.get(p.item_id) || 0
      return price > 0
    })

    if (itemsToFix.length === 0) return { updated: 0, error: null }

    const total = itemsToFix.length
    let updated = 0
    const BATCH_SIZE = 50

    for (let i = 0; i < itemsToFix.length; i += BATCH_SIZE) {
      const batch = itemsToFix.slice(i, i + BATCH_SIZE).map(p => ({
        id: p.id,
        price: priceMap.get(p.item_id) || 0,
        updated_at: new Date().toISOString()
      }))

      const { error } = await supabase
        .from('branch_pos_items')
        .upsert(batch)

      if (!error) updated += batch.length
      if (onProgress) onProgress(Math.min(i + BATCH_SIZE, total), total)
    }

    return { updated, error: null }
  },

  // Remove item from POS
  async removeItemFromPOS(id: string) {
    const { error } = await supabase
      .from('branch_pos_items')
      .delete()
      .eq('id', id)

    return { error }
  },

  // Update POS item price and availability
  async updatePOSItem(id: string, updates: { price?: number; is_available?: boolean }) {
    // First, get the item_id from this POS item
    const { data: posItem, error: fetchError } = await supabase
      .from('branch_pos_items')
      .select('item_id')
      .eq('id', id)
      .single()

    if (fetchError) return { data: null, error: fetchError }

    // Update the POS item
    const { data, error } = await supabase
      .from('branch_pos_items')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    // If price is being updated, also update the base item's selling_price
    if (!error && updates.price !== undefined && posItem?.item_id) {
      await supabase
        .from('items')
        .update({
          selling_price: updates.price,
          updated_at: new Date().toISOString()
        })
        .eq('id', posItem.item_id)
    }

    return { data, error }
  },

  // Update item purchase price (cost)
  async updateItemCost(itemId: string, purchasePrice: number) {
    const { data, error } = await supabase
      .from('items')
      .update({
        purchase_price: purchasePrice,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)
      .select()
      .single()

    return { data, error }
  },

  // Copy prices from one branch to another
  async copyPricesFromBranch(sourceBranchId: string, targetBranchId: string) {
    // Get source items
    const { data: sourceItems, error: fetchError } = await supabase
      .from('branch_pos_items')
      .select('item_id, price, is_available')
      .eq('branch_id', sourceBranchId)

    if (fetchError || !sourceItems) return { success: false, error: fetchError }

    // Update base item prices and upsert to target branch
    for (const item of sourceItems) {
      // Update base item selling price
      await supabase
        .from('items')
        .update({ 
          selling_price: item.price, 
          updated_at: new Date().toISOString() 
        })
        .eq('id', item.item_id)
    }

    // Upsert to target branch
    const itemsToInsert = sourceItems.map(item => ({
      branch_id: targetBranchId,
      item_id: item.item_id,
      price: item.price,
      is_available: item.is_available
    }))

    const { error: upsertError } = await supabase
      .from('branch_pos_items')
      .upsert(itemsToInsert, {
        onConflict: 'branch_id,item_id'
      })

    return { success: !upsertError, error: upsertError }
  },

  // Apply percentage change to all prices in a branch
  async applyPercentageChange(branchId: string, percentage: number) {
    const { data: currentItems, error: fetchError } = await supabase
      .from('branch_pos_items')
      .select('id, item_id, price')
      .eq('branch_id', branchId)

    if (fetchError || !currentItems) return { success: false, error: fetchError }

    const multiplier = 1 + (percentage / 100)
    
    for (const item of currentItems) {
      const newPrice = Math.round(item.price * multiplier * 100) / 100
      
      // Update POS item price
      await supabase
        .from('branch_pos_items')
        .update({ price: newPrice, updated_at: new Date().toISOString() })
        .eq('id', item.id)
      
      // Update base item selling price
      await supabase
        .from('items')
        .update({ selling_price: newPrice, updated_at: new Date().toISOString() })
        .eq('id', item.item_id)
    }

    return { success: true, error: null }
  },

  // Get POS items for cashier - reads directly from inventory
  // Any item with stock in the branch automatically appears in POS
  async getPOSItemsForCashier(branchId: string) {
    // First try the managed POS items view
    const { data: posData } = await supabase
      .from('v_branch_pos_items_with_stock')
      .select('*')
      .eq('branch_id', branchId)
      .eq('is_available', true)
      .order('display_order')

    // Also get ALL inventory items for this branch (auto-populate)
    const { data: invData, error: invError } = await supabase
      .from('inventory')
      .select(`
        id,
        item_id,
        quantity,
        branch_id,
        item:items(
          id, code, barcode, name, name_ar, is_recipe, image_url,
          selling_price, purchase_price, category_id,
          unit:units(name_ar, code)
        )
      `)
      .eq('branch_id', branchId)
      .gt('quantity', 0)

    if (invError) {
      // Fallback to managed POS items only
      return { data: fixEncodingInData(posData), error: null }
    }

    // Build a set of item_ids already in POS
    const posItemIds = new Set((posData || []).map((p: any) => p.item_id))

    // Transform inventory items into POS format (for items NOT already in POS)
    const autoItems = (invData || [])
      .filter(inv => inv.item && !Array.isArray(inv.item) && !posItemIds.has(inv.item_id))
      .map(inv => {
        const item = Array.isArray(inv.item) ? inv.item[0] : inv.item
        return {
          id: `auto_${inv.id}`,
          branch_id: branchId,
          item_id: inv.item_id,
          price: item.selling_price || item.purchase_price || 0,
          is_available: true,
          display_order: 999,
          item: {
            id: item.id,
            code: item.code,
            barcode: item.barcode,
            name: item.name,
            name_ar: item.name_ar,
            is_recipe: item.is_recipe,
            image_url: item.image_url,
            category_id: item.category_id,
            purchase_price: item.purchase_price,
            unit: Array.isArray(item.unit) ? item.unit[0] : item.unit
          },
          stock_quantity: inv.quantity,
          in_stock: inv.quantity > 0
        }
      })

    // Merge: POS managed items first, then auto-populated from inventory
    const merged = [...(posData || []), ...autoItems]
    return { data: fixEncodingInData(merged), error: null }
  }
}
