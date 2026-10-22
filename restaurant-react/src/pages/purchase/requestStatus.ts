// Labels and badge colours of purchase request statuses (purchase_request_status enum).
export const requestStatusConfig: Record<string, { label: string; color: string }> = {
  draft: { label: 'مسودة', color: 'bg-gray-100 text-gray-700' },
  pending: { label: 'بانتظار الموافقة', color: 'bg-yellow-100 text-yellow-700' },
  approved: { label: 'معتمد', color: 'bg-green-100 text-green-700' },
  rejected: { label: 'مرفوض', color: 'bg-red-100 text-red-700' },
  ordered: { label: 'تم إصدار أمر شراء', color: 'bg-blue-100 text-blue-700' },
  partially_received: { label: 'استلام جزئي', color: 'bg-purple-100 text-purple-700' },
  completed: { label: 'مكتمل', color: 'bg-green-100 text-green-700' },
  cancelled: { label: 'ملغي', color: 'bg-gray-100 text-gray-700' },
}
