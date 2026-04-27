import { supabase, fixEncodingInData } from '../lib/supabase'
import { Supplier, Supply, Payment, SupplierStatus, PaymentMethod, PaymentStatus } from '../types/database.types'

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
  supply_date: string
  total_amount: number
  paid_amount: number
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  invoice_number?: string
  notes?: string
  created_by: string
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
  created_by: string
}

export const suppliersService = {
  // Get all suppliers
  async getAll() {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('name_ar')

    return { data: fixEncodingInData(data) as Supplier[], error }
  },

  // Get supplier by ID
  async getById(id: string) {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .single()

    return { data: fixEncodingInData(data) as Supplier, error }
  },

  // Create supplier
  async create(supplierData: CreateSupplierData) {
    const { data, error } = await supabase
      .from('suppliers')
      .insert({ ...supplierData, current_balance: 0 })
      .select()
      .single()

    return { data: data as Supplier, error }
  },

  // Update supplier
  async update(id: string, supplierData: Partial<CreateSupplierData>) {
    const { data, error } = await supabase
      .from('suppliers')
      .update({ ...supplierData, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    return { data: data as Supplier, error }
  },

  // Delete supplier
  async delete(id: string) {
    const { error } = await supabase
      .from('suppliers')
      .delete()
      .eq('id', id)

    return { error }
  },

  // Get active suppliers
  async getActive() {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('status', 'active')
      .order('name_ar')

    return { data: fixEncodingInData(data) as Supplier[], error }
  },

  // Get supplier supplies
  async getSupplies(supplierId: string) {
    const { data, error } = await supabase
      .from('supplies')
      .select('*, branch:branches(name_ar), items:supply_items(*, item:items(name_ar, code))')
      .eq('supplier_id', supplierId)
      .order('supply_date', { ascending: false })

    return { data: fixEncodingInData(data) as Supply[], error }
  },

  // Create supply with items
  async createSupply(supplyData: CreateSupplyData) {
    // Generate supply number
    const supplyNumber = `SUP-${Date.now()}`
    
    // Insert supply
    const { data: supply, error: supplyError } = await supabase
      .from('supplies')
      .insert({
        supply_number: supplyNumber,
        supplier_id: supplyData.supplier_id,
        branch_id: supplyData.branch_id,
        supply_date: supplyData.supply_date,
        total_amount: supplyData.total_amount,
        paid_amount: supplyData.paid_amount,
        payment_method: supplyData.payment_method,
        payment_status: supplyData.payment_status,
        invoice_number: supplyData.invoice_number,
        notes: supplyData.notes,
        created_by: supplyData.created_by,
      })
      .select()
      .single()

    if (supplyError) return { data: null, error: supplyError }

    // Insert supply items
    const supplyItems = supplyData.items.map(item => ({
      supply_id: supply.id,
      item_id: item.item_id,
      quantity: item.quantity,
      received_quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.quantity * item.unit_price,
      expiry_date: item.expiry_date,
      batch_number: item.batch_number,
    }))

    const { error: itemsError } = await supabase
      .from('supply_items')
      .insert(supplyItems)

    if (itemsError) return { data: null, error: itemsError }

    // Update supplier balance
    const remainingAmount = supplyData.total_amount - supplyData.paid_amount
    if (remainingAmount > 0) {
      await supabase.rpc('update_supplier_balance', {
        p_supplier_id: supplyData.supplier_id,
        p_amount: remainingAmount,
      })
    }

    // Update inventory - add quantities
    for (const item of supplyData.items) {
      // Check if inventory record exists
      const { data: existingInv } = await supabase
        .from('inventory')
        .select('id, quantity')
        .eq('branch_id', supplyData.branch_id)
        .eq('item_id', item.item_id)
        .single()

      if (existingInv) {
        // Update existing inventory
        await supabase
          .from('inventory')
          .update({ 
            quantity: existingInv.quantity + item.quantity,
            last_restock_date: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', existingInv.id)
      } else {
        // Create new inventory record
        await supabase
          .from('inventory')
          .insert({
            branch_id: supplyData.branch_id,
            item_id: item.item_id,
            quantity: item.quantity,
            min_quantity: 0,
            last_restock_date: new Date().toISOString(),
          })
      }
    }

    return { data: supply as Supply, error: null }
  },

  // Get supplier payments
  async getPayments(supplierId: string) {
    const { data, error } = await supabase
      .from('payments')
      .select('*, supplier:suppliers(name_ar)')
      .eq('supplier_id', supplierId)
      .order('payment_date', { ascending: false })

    return { data: fixEncodingInData(data) as Payment[], error }
  },

  // Create payment
  async createPayment(paymentData: CreatePaymentData) {
    const paymentNumber = `PAY-${Date.now()}`

    const { data, error } = await supabase
      .from('payments')
      .insert({
        payment_number: paymentNumber,
        ...paymentData,
      })
      .select()
      .single()

    if (error) return { data: null, error }

    // Update supplier balance (decrease)
    await supabase.rpc('update_supplier_balance', {
      p_supplier_id: paymentData.supplier_id,
      p_amount: -paymentData.amount,
    })

    // Update supply payment status if linked
    if (paymentData.supply_id) {
      const { data: supply } = await supabase
        .from('supplies')
        .select('total_amount, paid_amount')
        .eq('id', paymentData.supply_id)
        .single()

      if (supply) {
        const newPaidAmount = (supply.paid_amount || 0) + paymentData.amount
        const newStatus = newPaidAmount >= supply.total_amount ? 'paid' : 'partial'

        await supabase
          .from('supplies')
          .update({ paid_amount: newPaidAmount, payment_status: newStatus })
          .eq('id', paymentData.supply_id)
      }
    }

    return { data: data as Payment, error: null }
  },

  // Check if code exists
  async codeExists(code: string, excludeId?: string) {
    let query = supabase
      .from('suppliers')
      .select('id')
      .eq('code', code)

    if (excludeId) {
      query = query.neq('id', excludeId)
    }

    const { data, error } = await query
    return { exists: data && data.length > 0, error }
  },
}
