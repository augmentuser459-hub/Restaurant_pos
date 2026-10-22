import { supabase, fixEncodingInData } from '../lib/supabase';
import { fetchAll } from '../lib/fetchAll';
import { localDayStartISO, localDayEndExclusiveISO } from '../lib/dates';
import { roundMoney } from '../lib/utils';

// Shifts are opened and closed only through database functions (020_pos.sql): shift_open / shift_close.
// Totals are computed there from the shift's PAID orders, per payment method.

export interface CashierShift {
  id: string;
  shift_number: string;
  cashier_id: string;
  branch_id: string;
  start_time: string;
  end_time?: string | null;
  opening_amount: number;
  closing_amount?: number | null;
  expected_amount?: number | null;
  cash_sales: number;
  /** all non-cash sales: visa + instapay + wallet */
  card_sales: number;
  /** per-method totals; null on shifts closed before they were recorded */
  visa_sales?: number | null;
  instapay_sales?: number | null;
  wallet_sales?: number | null;
  total_sales: number;
  orders_count: number;
  difference?: number | null;
  status: 'open' | 'closed';
  notes?: string | null;
  closed_by?: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  cashier?: { id: string; full_name: string; full_name_ar?: string | null } | null;
  branch?: { id: string; name_ar: string } | null;
}

export interface ShiftFilters {
  branchId?: string;
  cashierId?: string;
  status?: string;
  /** Cairo calendar dates, YYYY-MM-DD, inclusive */
  dateFrom?: string;
  dateTo?: string;
}

const SHIFT_SELECT = `
  *,
  cashier:users!cashier_id(id, full_name, full_name_ar),
  branch:branches!branch_id(id, name_ar)
`;

/** Arabic name of the cashier, falling back to the Latin one. */
export function cashierName(cashier?: { full_name?: string | null; full_name_ar?: string | null } | null): string {
  return cashier?.full_name_ar || cashier?.full_name || 'غير معروف';
}

export const shiftsService = {
  // Open shift of a cashier in a branch; data is null when there is none (an error means "could not check").
  async getOpenShift(cashierId: string, branchId: string) {
    const { data, error } = await supabase
      .from('cashier_shifts')
      .select('*')
      .eq('cashier_id', cashierId)
      .eq('branch_id', branchId)
      .eq('status', 'open')
      .order('start_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    return { data: data as CashierShift | null, error };
  },

  // Opens the logged-in cashier's shift, or returns the one already open (existing = true).
  async startShift(branchId: string, openingAmount: number) {
    const { data, error } = await supabase.rpc('shift_open', {
      p_opening_amount: openingAmount,
      p_branch_id: branchId,
    });
    return { data: error ? null : (data as CashierShift & { existing: boolean }), error };
  },

  // Closes a shift; totals are computed in the database. unpaid_orders = orders of the shift never paid.
  async closeShift(shiftId: string, closingAmount: number, notes?: string) {
    const { data, error } = await supabase.rpc('shift_close', {
      p_shift_id: shiftId,
      p_closing_amount: closingAmount,
      p_notes: notes ?? null,
    });
    return { data: error ? null : (data as CashierShift & { unpaid_orders: number }), error };
  },

  // Admin: recompute a shift's totals from its orders
  async recalculateShift(shiftId: string) {
    const { data, error } = await supabase.rpc('shift_recalculate', { p_shift_id: shiftId });
    return { data: error ? null : (data as CashierShift), error };
  },

  // Get all shifts (for admin), no row cap
  async getAllShifts(filters?: ShiftFilters) {
    try {
      const rows = await fetchAll((from, to) => {
        let query = supabase
          .from('cashier_shifts')
          .select(SHIFT_SELECT)
          .order('start_time', { ascending: false })
          .order('id', { ascending: false });

        if (filters?.branchId) query = query.eq('branch_id', filters.branchId);
        if (filters?.cashierId) query = query.eq('cashier_id', filters.cashierId);
        if (filters?.status) query = query.eq('status', filters.status);
        if (filters?.dateFrom) query = query.gte('start_time', localDayStartISO(filters.dateFrom));
        if (filters?.dateTo) query = query.lt('start_time', localDayEndExclusiveISO(filters.dateTo));
        return query.range(from, to);
      });
      return { data: fixEncodingInData(rows) as CashierShift[], error: null };
    } catch (error) {
      return { data: [] as CashierShift[], error };
    }
  },

  // Get shift by ID
  async getShiftById(shiftId: string) {
    const { data, error } = await supabase
      .from('cashier_shifts')
      .select(SHIFT_SELECT)
      .eq('id', shiftId)
      .maybeSingle();

    return { data: fixEncodingInData(data) as CashierShift | null, error };
  },

  // Closed shifts that started in a Cairo date range (for reports), no row cap
  async getShiftsSummary(branchId?: string, dateFrom?: string, dateTo?: string) {
    try {
      const rows = await fetchAll((from, to) => {
        let query = supabase
          .from('cashier_shifts')
          .select(`
            id,
            cashier_id,
            branch_id,
            total_sales,
            cash_sales,
            card_sales,
            visa_sales,
            instapay_sales,
            wallet_sales,
            orders_count,
            difference,
            cashier:users!cashier_id(id, full_name, full_name_ar),
            branch:branches!branch_id(id, name_ar)
          `)
          .eq('status', 'closed')
          .order('start_time', { ascending: false })
          .order('id', { ascending: false });

        if (branchId) query = query.eq('branch_id', branchId);
        if (dateFrom) query = query.gte('start_time', localDayStartISO(dateFrom));
        if (dateTo) query = query.lt('start_time', localDayEndExclusiveISO(dateTo));
        return query.range(from, to);
      });
      return { data: fixEncodingInData(rows), error: null };
    } catch (error) {
      return { data: null, error };
    }
  },

  // Get cashier performance (dates are Cairo calendar dates, YYYY-MM-DD, inclusive)
  async getCashierPerformance(branchId?: string, dateFrom?: string, dateTo?: string) {
    const { data: shifts, error } = await this.getShiftsSummary(branchId, dateFrom, dateTo);

    if (error || !shifts) return { data: [] as CashierPerformance[], error };

    // Group by cashier
    const cashierMap = new Map<string, CashierPerformance>();

    for (const shift of shifts as {
      cashier_id: string;
      total_sales: number | null;
      cash_sales: number | null;
      card_sales: number | null;
      visa_sales: number | null;
      instapay_sales: number | null;
      wallet_sales: number | null;
      orders_count: number | null;
      difference: number | null;
      cashier: unknown;
    }[]) {
      const cashierId = shift.cashier_id;
      let row = cashierMap.get(cashierId);
      if (!row) {
        // Handle cashier data - could be array or object from Supabase join
        const rawCashier = Array.isArray(shift.cashier) ? shift.cashier[0] : shift.cashier;
        row = {
          cashier_id: cashierId,
          cashier_name: cashierName(rawCashier as { full_name?: string; full_name_ar?: string } | null),
          total_sales: 0,
          cash_sales: 0,
          card_sales: 0,
          visa_sales: 0,
          instapay_sales: 0,
          wallet_sales: 0,
          unsplit_sales: 0,
          orders_count: 0,
          shifts_count: 0,
          total_difference: 0,
        };
        cashierMap.set(cashierId, row);
      }

      const card = Number(shift.card_sales || 0);
      row.total_sales = roundMoney(row.total_sales + Number(shift.total_sales || 0));
      row.cash_sales = roundMoney(row.cash_sales + Number(shift.cash_sales || 0));
      row.card_sales = roundMoney(row.card_sales + card);
      if (shift.visa_sales == null || shift.instapay_sales == null || shift.wallet_sales == null) {
        // Closed before the per-method totals were recorded: its non-cash total is kept whole, never guessed apart
        row.unsplit_sales = roundMoney(row.unsplit_sales + card);
      } else {
        row.visa_sales = roundMoney(row.visa_sales + Number(shift.visa_sales));
        row.instapay_sales = roundMoney(row.instapay_sales + Number(shift.instapay_sales));
        row.wallet_sales = roundMoney(row.wallet_sales + Number(shift.wallet_sales));
      }
      row.orders_count += shift.orders_count || 0;
      row.shifts_count += 1;
      row.total_difference = roundMoney(row.total_difference + Number(shift.difference || 0));
    }

    return { data: Array.from(cashierMap.values()), error: null };
  },
};

/**
 * One cashier's closed shifts in a report period. card_sales = all non-cash sales
 * = visa_sales + instapay_sales + wallet_sales + unsplit_sales, where unsplit_sales is the non-cash total of
 * old shifts closed before the per-method columns existed (shown as "غير نقدي (غير مفصّل)").
 */
export interface CashierPerformance {
  cashier_id: string;
  cashier_name: string;
  total_sales: number;
  cash_sales: number;
  card_sales: number;
  visa_sales: number;
  instapay_sales: number;
  wallet_sales: number;
  unsplit_sales: number;
  orders_count: number;
  shifts_count: number;
  total_difference: number;
}
