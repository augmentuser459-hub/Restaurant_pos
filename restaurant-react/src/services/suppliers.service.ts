import { supabase, fixEncodingInData } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { roundMoney } from '../lib/utils'
import type { Supplier, SupplierStatus, PaymentMethod, PaymentStatus } from '../types/database.types'

// Writes go through database functions (050_purchasing.sql), which change stock only with stock_adjust and the
// supplier balance only with supplier_balance_adjust, in one transaction.

export interface CreateSupplierData {
  code: string
  name: string
  name_ar: string
  phone?: string
  email?: string
  address?: string
  contact_person?: string
  payment_terms?: PaymentMethod
  credit_limit?: number
  status?: SupplierStatus
  notes?: string
}

export interface CreateSupplyData {
  supplier_id: string
  branch_id: string
  invoice_date: string
  payment_method: PaymentMethod
  paid_amount: number
  invoice_number?: string
  notes?: string
  items: {
    item_id: string
    quantity: number
    unit_price: number
    expiry_date?: string
    batch_number?: string
  }[]
}

export interface CreatePaymentData {
  supplier_id: string
  supply_id?: string
  amount: number
  payment_date: string
  payment_method: string
  reference_number?: string
  notes?: string
}

// A row of the supplies table (real columns).
export interface SupplyRecord {
  id: string
  supply_number: string
  supplier_id: string
  branch_id: string
  invoice_number: string | null
  invoice_date: string | null
  total_amount: number
  paid_amount: number
  upfront_paid_amount: number | null
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  notes: string | null
  received_at: string
  created_at: string
  branch?: { name_ar: string } | null
  // Value of the approved / received supplier returns linked to this supply (filled by getSupplies)
  returned_amount?: number
}

/** What is still to be paid on a supply: total - paid - its approved returns (same rule as supplier_create_payment). */
export function supplyOutstanding(s: SupplyRecord): number {
  return Math.max(roundMoney(Number(s.total_amount || 0) - Number(s.paid_amount || 0) - Number(s.returned_amount || 0)), 0)
}

/** Payment status of a supply with its approved returns taken into account. */
export function supplyPaymentStatus(s: SupplyRecord): PaymentStatus {
  if (supplyOutstanding(s) <= 0) return 'paid'
  return Number(s.paid_amount || 0) > 0 || Number(s.returned_amount || 0) > 0 ? 'partial' : 'pending'
}

// A row of supplier_payments.
export interface SupplierPaymentRecord {
  id: string
  payment_number: string
  supplier_id: string
  supply_id: string | null
  amount: number
  payment_method: string
  reference_number: string | null
  payment_date: string
  notes: string | null
  created_at: string
}

export interface ManualDebtRecord {
  id: string
  supplier_id: string
  amount: number
  description: string | null
  created_at: string
}

function saveArgs(id: string | null, s: CreateSupplierData) {
  return {
    p_id: id,
    p_code: s.code,
    p_name: s.name,
    p_name_ar: s.name_ar,
    p_phone: s.phone ?? '',
    p_email: s.email ?? null,
    p_address: s.address ?? null,
    p_contact_person: s.contact_person ?? null,
    p_payment_terms: s.payment_terms ?? 'cash',
    p_credit_limit: s.credit_limit ?? 0,
    p_status: s.status ?? 'active',
    p_notes: s.notes ?? null,
  }
}

async function listSuppliers(activeOnly: boolean) {
  try {
    const data = await fetchAll((from, to) => {
      let query = supabase.from('suppliers').select('*').order('name_ar').order('id')
      if (activeOnly) query = query.eq('status', 'active')
      return query.range(from, to)
    })
    return { data: fixEncodingInData(data) as Supplier[], error: null }
  } catch (error) {
    return { data: null, error }
  }
}

export const suppliersService = {
  async getAll() {
    return listSuppliers(false)
  },

  async getActive() {
    return listSuppliers(true)
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .single()

    return { data: fixEncodingInData(data) as Supplier | null, error }
  },

  // Duplicate codes and invalid values are refused by the database with an Arabic message.
  async create(supplierData: CreateSupplierData) {
    const { data, error } = await supabase.rpc('supplier_save', saveArgs(null, supplierData))
    return { data: data as string | null, error }
  },

  async update(id: string, supplierData: CreateSupplierData) {
    const { data, error } = await supabase.rpc('supplier_save', saveArgs(id, supplierData))
    return { data: data as string | null, error }
  },

  // Refused (with an explanation) when the supplier has any history.
  async delete(id: string) {
    const { error } = await supabase.rpc('supplier_delete', { p_id: id })
    return { error }
  },

  // Returns the new balance.
  async addManualDebt(supplierId: string, amount: number, description?: string) {
    const { data, error } = await supabase.rpc('supplier_add_manual_debt', {
      p_supplier_id: supplierId,
      p_amount: amount,
      p_description: description ?? null,
    })
    return { data: data as number | null, error }
  },

  // Manual debts of all suppliers (or one).
  async getManualDebts(supplierId?: string) {
    try {
      const data = await fetchAll((from, to) => {
        let query = supabase
          .from('supplier_debt_transactions')
          .select('id, supplier_id, amount, description, created_at')
          .eq('transaction_type', 'manual_debt')
          .order('created_at')
          .order('id')
        if (supplierId) query = query.eq('supplier_id', supplierId)
        return query.range(from, to)
      })
      return { data: fixEncodingInData(data) as ManualDebtRecord[], error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  // Each supply comes with the value of its approved returns (returned_amount), which no longer has to be paid.
  async getSupplies(supplierId: string) {
    try {
      const [data, returns] = await Promise.all([
        fetchAll((from, to) =>
          supabase
            .from('supplies')
            .select('*, branch:branches(name_ar)')
            .eq('supplier_id', supplierId)
            .order('created_at', { ascending: false })
            .order('id')
            .range(from, to)
        ),
        fetchAll((from, to) =>
          supabase
            .from('supplier_returns')
            .select('id, supply_id, total_amount')
            .eq('supplier_id', supplierId)
            .not('supply_id', 'is', null)
            .in('status', ['approved', 'received'])
            .order('id')
            .range(from, to)
        ),
      ])
      const returnedBySupply = new Map<string, number>()
      for (const r of returns as { supply_id: string | null; total_amount: number | null }[]) {
        if (!r.supply_id) continue
        returnedBySupply.set(r.supply_id, roundMoney((returnedBySupply.get(r.supply_id) || 0) + Number(r.total_amount || 0)))
      }
      const supplies = (fixEncodingInData(data) as SupplyRecord[]).map(s => ({
        ...s,
        returned_amount: returnedBySupply.get(s.id) || 0,
      }))
      return { data: supplies, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  // Saves the supply, its lines, the stock, batches and the unpaid part as supplier debt in one transaction.
  async createSupply(supplyData: CreateSupplyData) {
    const { data, error } = await supabase.rpc('supplier_create_supply', {
      p_supplier_id: supplyData.supplier_id,
      p_branch_id: supplyData.branch_id,
      p_invoice_date: supplyData.invoice_date,
      p_invoice_number: supplyData.invoice_number ?? null,
      p_payment_method: supplyData.payment_method,
      p_paid_amount: supplyData.paid_amount,
      p_notes: supplyData.notes ?? null,
      p_items: supplyData.items,
    })
    return { data: data as { id: string; supply_number: string } | null, error }
  },

  async getPayments(supplierId: string) {
    try {
      const data = await fetchAll((from, to) =>
        supabase
          .from('supplier_payments')
          .select('*')
          .eq('supplier_id', supplierId)
          .order('payment_date', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to)
      )
      return { data: fixEncodingInData(data) as SupplierPaymentRecord[], error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  // Never more than the supply's remaining amount or the supplier's balance (checked in the database).
  async createPayment(paymentData: CreatePaymentData) {
    const { data, error } = await supabase.rpc('supplier_create_payment', {
      p_supplier_id: paymentData.supplier_id,
      p_amount: paymentData.amount,
      p_payment_date: paymentData.payment_date,
      p_payment_method: paymentData.payment_method,
      p_reference_number: paymentData.reference_number ?? null,
      p_notes: paymentData.notes ?? null,
      p_supply_id: paymentData.supply_id ?? null,
    })
    return { data: data as { id: string; payment_number: string; balance: number } | null, error }
  },
}
