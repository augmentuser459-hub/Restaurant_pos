import { supabase, fixEncodingInData } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { roundQuantity } from '../lib/utils'

// Every status change of a return is one database function (status re-checked under a row lock,
// stock and supplier balance changed in the same transaction). These wrappers only pass the input on.

export interface SupplierReturn {
  id: string
  return_number: string
  supplier_id: string
  item_id: string
  branch_id: string | null
  quantity: number
  unit_price: number
  total_amount: number
  reason: string
  description: string | null
  status: string
  rejection_reason: string | null
  registered_at: string
  approved_at?: string | null
  received_by_supplier_at?: string | null
  supplier: { id: string; name_ar: string; code: string } | null
  item: { id: string; name_ar: string; code: string; unit: { name_ar: string } | null } | null
  branch: { id: string; name_ar: string } | null
}

export interface BranchReturnItem {
  id: string
  item_id: string
  requested_quantity: number
  approved_quantity: number | null
  shipped_quantity: number | null
  received_quantity: number | null
  item_reason: string | null
  notes: string | null
  item: { id: string; name_ar: string; code: string; unit: { name_ar: string } | null } | null
}

export interface BranchReturn {
  id: string
  return_number: string
  return_date: string
  from_branch_id: string
  to_branch_id: string
  status: string
  return_reason: string
  total_items: number
  total_quantity: number
  notes: string | null
  rejection_reason: string | null
  requested_at: string
  from_branch: { id: string; name_ar: string; code: string } | null
  to_branch: { id: string; name_ar: string; code: string } | null
  items: BranchReturnItem[]
}

export interface CreateSupplierReturnData {
  supplier_id: string
  reason?: string
  notes?: string
  items: { item_id: string; quantity: number; unit_price: number; reason?: string; notes?: string }[]
}

export interface CreateBranchReturnData {
  from_branch_id: string
  return_reason: string
  notes?: string
  items: { item_id: string; quantity: number; reason?: string; notes?: string }[]
}

const SUPPLIER_RETURN_SELECT = `
  id, return_number, supplier_id, item_id, branch_id, quantity, unit_price, total_amount, reason, description,
  status, rejection_reason, registered_at, approved_at, received_by_supplier_at,
  supplier:suppliers(id, name_ar, code),
  item:items(id, name_ar, code, unit:units(name_ar)),
  branch:branches(id, name_ar)
`

const BRANCH_RETURN_SELECT = `
  id, return_number, return_date, from_branch_id, to_branch_id, status, return_reason, total_items, total_quantity,
  notes, rejection_reason, requested_at,
  from_branch:branches!branch_returns_from_branch_id_fkey(id, name_ar, code),
  to_branch:branches!branch_returns_to_branch_id_fkey(id, name_ar, code),
  items:branch_return_items(id, item_id, requested_quantity, approved_quantity, shipped_quantity, received_quantity,
    item_reason, notes, item:items(id, name_ar, code, unit:units(name_ar)))
`

export const returnsService = {
  // ---------- Supplier returns ----------

  async getSupplierReturns() {
    try {
      const rows = await fetchAll<Record<string, unknown>>((from, to) =>
        supabase
          .from('supplier_returns')
          .select(SUPPLIER_RETURN_SELECT)
          .order('registered_at', { ascending: false })
          .order('id')
          .range(from, to))
      return { data: fixEncodingInData(rows) as unknown as SupplierReturn[], error: null }
    } catch (error) {
      return { data: [] as SupplierReturn[], error }
    }
  },

  async getSupplierReturnById(id: string) {
    const { data, error } = await supabase
      .from('supplier_returns')
      .select(SUPPLIER_RETURN_SELECT)
      .eq('id', id)
      .single()
    return { data: data ? (fixEncodingInData(data) as unknown as SupplierReturn) : null, error }
  },

  // All lines are saved together under one number (SRT-YYYYMM-00001, -1/-2... for several items)
  async createSupplierReturn(payload: CreateSupplierReturnData) {
    const { data, error } = await supabase.rpc('return_supplier_create', {
      p_supplier_id: payload.supplier_id,
      p_items: payload.items.map(i => ({
        item_id: i.item_id,
        quantity: roundQuantity(i.quantity),
        unit_price: i.unit_price,
        reason: i.reason || null,
        notes: i.notes || null,
      })),
      p_reason: payload.reason || null,
      p_notes: payload.notes || null,
    })
    return { data: data as { return_number: string; ids: string[] } | null, error }
  },

  // Deducts the stock and lowers the supplier balance by the return value, in one transaction
  async approveSupplierReturn(id: string) {
    const { error } = await supabase.rpc('return_supplier_approve', { p_return_id: id })
    return { error }
  },

  // Marks an approved return as handed over to the supplier
  async completeSupplierReturn(id: string) {
    const { error } = await supabase.rpc('return_supplier_complete', { p_return_id: id })
    return { error }
  },

  async rejectSupplierReturn(id: string, reason?: string) {
    const { error } = await supabase.rpc('return_supplier_reject', { p_return_id: id, p_reason: reason || null })
    return { error }
  },

  // ---------- Branch returns (branch -> main warehouse) ----------

  async getBranchReturns(fromBranchId?: string) {
    try {
      const rows = await fetchAll<Record<string, unknown>>((from, to) => {
        let query = supabase
          .from('branch_returns')
          .select(BRANCH_RETURN_SELECT)
          .order('return_date', { ascending: false })
          .order('requested_at', { ascending: false })
          .order('id')
        if (fromBranchId) {
          query = query.eq('from_branch_id', fromBranchId)
        }
        return query.range(from, to)
      })
      return { data: fixEncodingInData(rows) as unknown as BranchReturn[], error: null }
    } catch (error) {
      return { data: [] as BranchReturn[], error }
    }
  },

  async getBranchReturnById(id: string) {
    const { data, error } = await supabase
      .from('branch_returns')
      .select(BRANCH_RETURN_SELECT)
      .eq('id', id)
      .single()
    return { data: data ? (fixEncodingInData(data) as unknown as BranchReturn) : null, error }
  },

  // Header and lines in one transaction; the number and the main warehouse are set by the database
  async createBranchReturn(payload: CreateBranchReturnData) {
    const { data, error } = await supabase.rpc('return_branch_create', {
      p_from_branch_id: payload.from_branch_id,
      p_return_reason: payload.return_reason,
      p_items: payload.items.map(i => ({
        item_id: i.item_id,
        quantity: roundQuantity(i.quantity),
        reason: i.reason || null,
        notes: i.notes || null,
      })),
      p_notes: payload.notes || null,
    })
    return { data: data as { id: string; return_number: string } | null, error }
  },

  async approveBranchReturn(id: string) {
    const { error } = await supabase.rpc('return_branch_approve', { p_return_id: id })
    return { error }
  },

  async shipBranchReturn(id: string) {
    const { error } = await supabase.rpc('return_branch_ship', { p_return_id: id })
    return { error }
  },

  // Moves the stock from the branch to the main warehouse; refused when the branch no longer holds it
  async receiveBranchReturn(id: string) {
    const { error } = await supabase.rpc('return_branch_receive', { p_return_id: id })
    return { error }
  },

  async rejectBranchReturn(id: string, reason?: string) {
    const { error } = await supabase.rpc('return_branch_reject', { p_return_id: id, p_reason: reason || null })
    return { error }
  },
}
