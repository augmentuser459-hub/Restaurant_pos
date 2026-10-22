import { OrderPaymentMethod, OrderStatus } from '../../types/database.types'

// One place for the Arabic labels of order statuses and payment methods (orders, shifts and POS screens).

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'جديد',
  pending_payment: 'في انتظار الدفع',
  paid: 'مدفوع',
  in_kitchen: 'في المطبخ',
  preparing: 'قيد التحضير',
  ready: 'جاهز',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
}

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  new: 'bg-blue-100 text-blue-700',
  pending_payment: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-green-100 text-green-700',
  in_kitchen: 'bg-yellow-100 text-yellow-700',
  preparing: 'bg-orange-100 text-orange-700',
  ready: 'bg-purple-100 text-purple-700',
  delivered: 'bg-teal-100 text-teal-700',
  cancelled: 'bg-red-100 text-red-700',
}

export const PAYMENT_METHOD_LABELS: Record<OrderPaymentMethod, string> = {
  cash: 'كاش',
  visa: 'دليفري',
  instapay: 'إنستاباي',
  wallet: 'محفظة',
}

export const PAYMENT_METHODS: OrderPaymentMethod[] = ['cash', 'visa', 'instapay', 'wallet']

export function orderStatusLabel(status?: string | null): string {
  return (status && ORDER_STATUS_LABELS[status as OrderStatus]) || status || '-'
}

export function orderStatusColor(status?: string | null): string {
  return (status && ORDER_STATUS_COLORS[status as OrderStatus]) || 'bg-gray-100 text-gray-700'
}

/** Arabic payment label; an order without a method was never paid. */
export function paymentMethodLabel(method?: string | null): string {
  if (!method) return 'غير مدفوع'
  return PAYMENT_METHOD_LABELS[method as OrderPaymentMethod] || method
}

export function paymentMethodColor(method?: string | null): string {
  if (!method) return 'bg-gray-100 text-gray-600'
  return method === 'cash' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
}
