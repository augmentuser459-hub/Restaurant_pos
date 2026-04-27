import { supabase, fixEncodingInData } from '../lib/supabase';

export interface CashierShift {
  id: string;
  shift_number: string;
  cashier_id: string;
  branch_id: string;
  start_time: string;
  end_time?: string;
  opening_amount: number;
  closing_amount?: number;
  expected_amount?: number;
  cash_sales: number;
  card_sales: number;
  total_sales: number;
  orders_count: number;
  difference?: number;
  status: 'open' | 'closed';
  notes?: string;
  closed_by?: string;
  created_at: string;
  updated_at: string;
  // Joined
  cashier?: { id: string; full_name: string };
  branch?: { id: string; name_ar: string };
}

export const shiftsService = {
  // Get open shift for current cashier in a branch
  async getOpenShift(cashierId: string, branchId: string) {
    const { data, error } = await supabase
      .from('cashier_shifts')
      .select('*')
      .eq('cashier_id', cashierId)
      .eq('branch_id', branchId)
      .eq('status', 'open')
      .order('start_time', { ascending: false })
      .limit(1)
      .single();

    return { data: data as CashierShift | null, error };
  },

  // Start a new shift
  async startShift(cashierId: string, branchId: string, openingAmount: number) {
    const shiftNumber = `SHF-${Date.now()}`;
    
    const { data, error } = await supabase
      .from('cashier_shifts')
      .insert({
        shift_number: shiftNumber,
        cashier_id: cashierId,
        branch_id: branchId,
        opening_amount: openingAmount,
        status: 'open',
        start_time: new Date().toISOString(),
      })
      .select()
      .single();

    return { data: data as CashierShift, error };
  },

  // Close shift
  async closeShift(shiftId: string, closingAmount: number, closedBy: string, notes?: string) {
    // First get shift orders summary
    const { data: ordersData } = await supabase
      .from('orders')
      .select('total_amount, payment_method, status')
      .eq('shift_id', shiftId)
      .neq('status', 'cancelled');

    const orders = ordersData || [];
    const cashSales = orders
      .filter(o => o.payment_method === 'cash')
      .reduce((sum, o) => sum + (o.total_amount || 0), 0);
    const cardSales = orders
      .filter(o => o.payment_method !== 'cash')
      .reduce((sum, o) => sum + (o.total_amount || 0), 0);
    const totalSales = cashSales + cardSales;
    const ordersCount = orders.length;

    // Get opening amount
    const { data: shift } = await supabase
      .from('cashier_shifts')
      .select('opening_amount')
      .eq('id', shiftId)
      .single();

    const openingAmount = shift?.opening_amount || 0;
    const expectedAmount = openingAmount + cashSales;
    const difference = closingAmount - expectedAmount;

    // Update shift
    const { data, error } = await supabase
      .from('cashier_shifts')
      .update({
        end_time: new Date().toISOString(),
        closing_amount: closingAmount,
        expected_amount: expectedAmount,
        cash_sales: cashSales,
        card_sales: cardSales,
        total_sales: totalSales,
        orders_count: ordersCount,
        difference: difference,
        status: 'closed',
        closed_by: closedBy,
        notes: notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', shiftId)
      .select()
      .single();

    return { data: data as CashierShift, error };
  },

  // Get all shifts (for admin)
  async getAllShifts(filters?: { branchId?: string; cashierId?: string; status?: string; dateFrom?: string; dateTo?: string }) {
    let query = supabase
      .from('cashier_shifts')
      .select(`
        *,
        cashier:users!cashier_id(id, full_name),
        branch:branches!branch_id(id, name_ar)
      `)
      .order('start_time', { ascending: false });

    if (filters?.branchId) query = query.eq('branch_id', filters.branchId);
    if (filters?.cashierId) query = query.eq('cashier_id', filters.cashierId);
    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.dateFrom) query = query.gte('start_time', filters.dateFrom);
    if (filters?.dateTo) query = query.lte('start_time', filters.dateTo);

    const { data, error } = await query;
    return { data: fixEncodingInData(data) as CashierShift[], error };
  },

  // Get shift by ID
  async getShiftById(shiftId: string) {
    const { data, error } = await supabase
      .from('cashier_shifts')
      .select(`
        *,
        cashier:users!cashier_id(id, full_name),
        branch:branches!branch_id(id, name_ar)
      `)
      .eq('id', shiftId)
      .single();

    return { data: fixEncodingInData(data) as CashierShift, error };
  },

  // Get shift summary (for reports)
  async getShiftsSummary(branchId?: string, dateFrom?: string, dateTo?: string) {
    let query = supabase
      .from('cashier_shifts')
      .select(`
        id,
        cashier_id,
        branch_id,
        total_sales,
        cash_sales,
        card_sales,
        orders_count,
        difference,
        cashier:users!cashier_id(id, full_name),
        branch:branches!branch_id(id, name_ar)
      `)
      .eq('status', 'closed');

    if (branchId) query = query.eq('branch_id', branchId);
    if (dateFrom) query = query.gte('start_time', dateFrom);
    if (dateTo) query = query.lte('start_time', dateTo);

    const { data, error } = await query;
    return { data: fixEncodingInData(data), error };
  },

  // Get cashier performance
  async getCashierPerformance(branchId?: string, dateFrom?: string, dateTo?: string) {
    const { data: shifts } = await this.getShiftsSummary(branchId, dateFrom, dateTo);
    
    if (!shifts) return { data: [], error: null };

    // Group by cashier
    const cashierMap = new Map<string, {
      cashier_id: string;
      cashier_name: string;
      total_sales: number;
      cash_sales: number;
      card_sales: number;
      orders_count: number;
      shifts_count: number;
      total_difference: number;
    }>();

    for (const shift of shifts) {
      const cashierId = shift.cashier_id;
      const existing = cashierMap.get(cashierId);
      
      if (existing) {
        existing.total_sales += shift.total_sales || 0;
        existing.cash_sales += shift.cash_sales || 0;
        existing.card_sales += shift.card_sales || 0;
        existing.orders_count += shift.orders_count || 0;
        existing.shifts_count += 1;
        existing.total_difference += shift.difference || 0;
      } else {
        // Handle cashier data - could be array or object from Supabase join
        const rawCashier = shift.cashier as unknown;
        let cashierName = 'Unknown';
        if (Array.isArray(rawCashier) && rawCashier.length > 0) {
          cashierName = (rawCashier[0] as { full_name?: string })?.full_name || 'Unknown';
        } else if (rawCashier && typeof rawCashier === 'object') {
          cashierName = (rawCashier as { full_name?: string })?.full_name || 'Unknown';
        }
        cashierMap.set(cashierId, {
          cashier_id: cashierId,
          cashier_name: cashierName,
          total_sales: shift.total_sales || 0,
          cash_sales: shift.cash_sales || 0,
          card_sales: shift.card_sales || 0,
          orders_count: shift.orders_count || 0,
          shifts_count: 1,
          total_difference: shift.difference || 0,
        });
      }
    }

    return { data: Array.from(cashierMap.values()), error: null };
  },
};
