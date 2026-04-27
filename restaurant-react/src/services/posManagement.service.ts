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

  // Get all branches with their POS item counts
  async getBranchesWithItemCounts() {
    const { data: branches, error: branchError } = await supabase
      .from('branches')
      .select('id, code, name, name_ar, is_main_warehouse, status')
      .eq('is_main_warehouse', false)
      .eq('status', 'active')
      .order('name')

    if (branchError) return { data: null, error: branchError }

    // Get item counts for each branch
    const { data: itemCounts, error: countError } = await supabase
      .from('branch_pos_items')
      .select('branch_id')

    if (countError) return { data: branches, error: null }

    const counts = itemCounts?.reduce((acc, item) => {
      acc[item.branch_id] = (acc[item.branch_id] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const branchesWithCounts = branches?.map(branch => ({
      ...branch,
      itemCount: counts?.[branch.id] || 0
    }))

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
          id, code, name, name_ar, is_recipe, image_url,
          unit:units(name_ar)
        )
      `)
      .eq('branch_id', branchId)
      .order('item(name_ar)')

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
          unit: Array.isArray(item.unit) ? item.unit[0] : item.unit,
          stock_quantity: inv.quantity
        }
      })

    return { data: fixEncodingInData(items) as AvailableInventoryItem[], error: null }
  },

  // Add item to POS
  async addItemToPOS(branchId: string, itemId: string, price: number) {
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
    const { data, error } = await supabase
      .from('branch_pos_items')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

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
      .select('id, price')
      .eq('branch_id', branchId)

    if (fetchError || !currentItems) return { success: false, error: fetchError }

    const multiplier = 1 + (percentage / 100)
    
    for (const item of currentItems) {
      const newPrice = Math.round(item.price * multiplier * 100) / 100
      await supabase
        .from('branch_pos_items')
        .update({ price: newPrice, updated_at: new Date().toISOString() })
        .eq('id', item.id)
    }

    return { success: true, error: null }
  },

  // Get POS items for cashier (with stock info)
  async getPOSItemsForCashier(branchId: string) {
    const { data, error } = await supabase
      .from('v_branch_pos_items_with_stock')
      .select('*')
      .eq('branch_id', branchId)
      .eq('is_available', true)
      .order('display_order')

    return { data: fixEncodingInData(data), error }
  }
}
