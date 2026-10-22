// Turns Supabase/Postgres errors into an Arabic message the user can act on.
// Database functions raise business errors with an Arabic message (ERRCODE P0001 / 42501 / 28000),
// which is shown as-is; known Postgres codes get a generic Arabic explanation.

interface DbError {
  code?: string
  message?: string
  details?: string
  hint?: string
}

const MESSAGE_CODES = new Set(['P0001', '42501', '28000'])

const CODE_MESSAGES: Record<string, string> = {
  '23505': 'هذه القيمة مستخدمة بالفعل، أدخل قيمة مختلفة',
  '23503': 'لا يمكن تنفيذ العملية لارتباطها ببيانات أخرى',
  '23502': 'يوجد حقل مطلوب لم يتم إدخاله',
  '23514': 'قيمة غير صالحة، راجع البيانات المدخلة',
  '22P02': 'صيغة قيمة غير صحيحة، راجع البيانات المدخلة',
  '22007': 'صيغة تاريخ أو وقت غير صحيحة',
  PGRST116: 'السجل المطلوب غير موجود',
}

export function toUserMessage(error: unknown, fallback = 'حدث خطأ غير متوقع، حاول مرة أخرى'): string {
  if (!error) return fallback
  const e = error as DbError
  // A missing privilege (e.g. an expired session calling as anon) comes back as Postgres's English text
  if (e.code === '42501' && /^permission denied/i.test(e.message ?? '')) {
    return 'انتهت الجلسة أو ليس لديك صلاحية، سجّل الدخول مرة أخرى'
  }
  if (e.code && MESSAGE_CODES.has(e.code) && e.message) return e.message
  if (e.code && CODE_MESSAGES[e.code]) return CODE_MESSAGES[e.code]
  const text = typeof error === 'string' ? error : e.message ?? ''
  if (/failed to fetch|networkerror|network request failed/i.test(text)) {
    return 'تعذر الاتصال بالخادم، تحقق من الاتصال بالإنترنت'
  }
  console.error(error)
  return fallback
}

/** True when a database function refused a stock movement because it would go below zero. */
export function isInsufficientStock(error: unknown): boolean {
  return (error as DbError | null)?.hint === 'INSUFFICIENT_STOCK'
}
