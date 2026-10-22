import { supabase, fixEncodingInData } from '../lib/supabase'
import { fetchAll, fetchByIds } from '../lib/fetchAll'
import { roundQuantity } from '../lib/utils'
import { Transfer, TransferItem } from '../types/database.types'
import { notificationsService } from './notifications.service'

export interface CreateTransferData {
  from_branch_id: string
  to_branch_id: string
  notes?: string
  items: {
    item_id: string
    requested_quantity: number
    notes?: string
  }[]
}

export interface TransferWithDetails extends Omit<Transfer, 'from_branch' | 'to_branch' | 'items'> {
  rejection_reason?: string | null
  from_branch: { id: string; name_ar: string; code: string }
  to_branch: { id: string; name_ar: string; code: string }
  items: (TransferItem & { item: { id: string; name_ar: string; code: string; unit_id?: string; unit?: { name_ar: string } | string } })[]
}

/** One line of the transfers Excel export */
export interface TransferExportLine {
  transfer_id: string
  requested_quantity: number
  approved_quantity: number | null
  received_quantity: number | null
  item: { code: string; name_ar: string; unit: { name_ar: string } | null } | null
}

/** Item row used by the item pickers of the movement forms (transfers, returns, damages, recipes) */
export interface PickerItem {
  id: string
  code: string
  barcode: string | null
  name: string
  name_ar: string
  unit_id: string | null
  purchase_price: number | null
  is_recipe: boolean | null
  status: string
  unit: { id: string; name_ar: string; code: string } | null
}

/** Every item (all pages, not only the first 1000), ordered by Arabic name */
export async function fetchPickerItems(): Promise<{ data: PickerItem[]; error: unknown }> {
  try {
    const rows = await fetchAll<Record<string, unknown>>((from, to) =>
      supabase
        .from('items')
        .select('id, code, barcode, name, name_ar, unit_id, purchase_price, is_recipe, status, unit:units(id, name_ar, code)')
        .order('name_ar')
        .order('id')
        .range(from, to))
    return { data: fixEncodingInData(rows) as unknown as PickerItem[], error: null }
  } catch (error) {
    return { data: [], error }
  }
}

// Notifications are a side effect of an action that already succeeded: a failure is logged, not shown as a failed action.
async function notifyBranch(branchId: string, title: string, message: string, transferId: string, priority = 'medium') {
  const { error } = await notificationsService.create({
    user_id: null,
    branch_id: branchId,
    type: 'transfer',
    title,
    message,
    priority,
    reference_type: 'transfer',
    reference_id: transferId,
    expires_at: null,
  })
  if (error) console.warn('Transfer notification was not sent:', error)
}

interface TransferActionResult {
  id: string
  transfer_number: string
  from_branch_id: string
  to_branch_id: string
}

export const transfersService = {
  // Get all transfers (every page), newest first
  async getAll(branchId?: string) {
    try {
      const rows = await fetchAll<TransferWithDetails>((from, to) => {
        let query = supabase
          .from('transfers')
          .select(`
            *,
            from_branch:branches!from_branch_id(id, name_ar, code),
            to_branch:branches!to_branch_id(id, name_ar, code),
            items:transfer_items(id)
          `)
          .order('created_at', { ascending: false })
          .order('id')
        if (branchId) {
          query = query.or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`)
        }
        return query.range(from, to)
      })
      return { data: fixEncodingInData(rows) as TransferWithDetails[], error: null }
    } catch (error) {
      return { data: [] as TransferWithDetails[], error }
    }
  },

  // Item lines of the given transfers, for the Excel export
  async getExportLines(transferIds: string[]) {
    try {
      const rows = await fetchByIds<Record<string, unknown>>(transferIds, (ids, from, to) =>
        supabase
          .from('transfer_items')
          .select('id, transfer_id, requested_quantity, approved_quantity, received_quantity, item:items(code, name_ar, unit:units(name_ar))')
          .in('transfer_id', ids)
          .order('id')
          .range(from, to))
      return { data: fixEncodingInData(rows) as unknown as TransferExportLine[], error: null }
    } catch (error) {
      return { data: [] as TransferExportLine[], error }
    }
  },

  // Get transfer by ID with full item details
  async getById(id: string) {
    // First get the transfer with branches
    const { data: transfer, error: transferError } = await supabase
      .from('transfers')
      .select(`
        *,
        from_branch:branches!from_branch_id(id, name_ar, code),
        to_branch:branches!to_branch_id(id, name_ar, code)
      `)
      .eq('id', id)
      .single()

    if (transferError || !transfer) {
      return { data: null, error: transferError }
    }

    // Then get the transfer items with item details
    const { data: items, error: itemsError } = await supabase
      .from('transfer_items')
      .select(`
        *,
        item:items(id, name_ar, code, unit_id, unit:units(name_ar))
      `)
      .eq('transfer_id', id)
      .order('created_at')
      .order('id')

    if (itemsError) {
      return { data: null, error: itemsError }
    }

    // Combine the data
    const result = {
      ...transfer,
      items: items || []
    }

    return { data: fixEncodingInData(result) as TransferWithDetails, error: null }
  },

  // Stock of every item in a branch (all pages): item_id -> quantity
  async getBranchStock(branchId: string) {
    try {
      const rows = await fetchAll<{ item_id: string; quantity: number }>((from, to) =>
        supabase.from('inventory').select('item_id, quantity').eq('branch_id', branchId).order('id').range(from, to))
      const stock: Record<string, number> = {}
      rows.forEach(r => { stock[r.item_id] = Number(r.quantity) || 0 })
      return { data: stock, error: null }
    } catch (error) {
      return { data: {} as Record<string, number>, error }
    }
  },

  // Create transfer request (header + lines in one database transaction; the same item on several rows is merged)
  async create(transferData: CreateTransferData) {
    const { data, error } = await supabase.rpc('transfer_create', {
      p_from_branch_id: transferData.from_branch_id,
      p_to_branch_id: transferData.to_branch_id,
      p_items: transferData.items.map(item => ({
        item_id: item.item_id,
        quantity: roundQuantity(item.requested_quantity),
        notes: item.notes || null,
      })),
      p_notes: transferData.notes || null,
    })
    if (error) return { data: null, error }

    const created = data as TransferActionResult & { from_branch_name: string; to_branch_name: string }
    // The source branch approves the request
    await notifyBranch(
      created.from_branch_id,
      'طلب تحويل جديد',
      `طلب تحويل جديد ${created.transfer_number} من ${created.from_branch_name || 'فرع'} إلى ${created.to_branch_name || 'فرع'} بانتظار الموافقة`,
      created.id,
    )
    return { data: created, error: null }
  },

  // Approve transfer (pending -> approved; refused if it was already processed)
  async approve(id: string) {
    const { data, error } = await supabase.rpc('transfer_approve', { p_transfer_id: id })
    if (error) return { error }
    const result = data as TransferActionResult
    // The destination branch receives it
    await notifyBranch(
      result.to_branch_id,
      'تمت الموافقة على التحويل',
      `تمت الموافقة على طلب التحويل ${result.transfer_number}. جاهز للاستلام.`,
      id,
    )
    return { error: null }
  },

  // Reject transfer (pending -> rejected)
  async reject(id: string, reason?: string) {
    const { error } = await supabase.rpc('transfer_reject', { p_transfer_id: id, p_reason: reason || null })
    return { error }
  },

  // Receive transfer: moves the approved quantities from the source to the destination, all or nothing
  async receive(id: string) {
    const { data, error } = await supabase.rpc('transfer_receive', { p_transfer_id: id })
    if (error) return { error }
    const result = data as TransferActionResult
    await notifyBranch(
      result.from_branch_id,
      'تم استلام التحويل',
      `تم استلام التحويل ${result.transfer_number} بنجاح`,
      id,
      'low',
    )
    return { error: null }
  },

  // Get pending transfers count
  async getPendingCount(branchId?: string) {
    let query = supabase
      .from('transfers')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')

    if (branchId) {
      query = query.eq('to_branch_id', branchId)
    }

    const { count, error } = await query
    return { count, error }
  },
}
