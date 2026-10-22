import { createClient } from '@supabase/supabase-js'

// Supabase configuration comes only from the build environment (.env.local / the hosting provider's
// environment variables). There is deliberately no fallback: a build without them must not silently talk
// to some other project.
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

if (!supabaseUrl || !supabaseAnonKey) {
  const message =
    'Missing Supabase configuration: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example) and rebuild.'
  if (typeof document !== 'undefined') {
    document.body.innerHTML =
      '<div dir="rtl" style="font-family:sans-serif;max-width:640px;margin:15vh auto;padding:24px;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;color:#991b1b">' +
      '<h1 style="font-size:20px;margin:0 0 8px">خطأ في إعدادات النظام</h1>' +
      '<p style="margin:0 0 8px">لم يتم ضبط بيانات الاتصال بقاعدة البيانات لهذه النسخة. تواصل مع الدعم الفني.</p>' +
      `<p dir="ltr" style="margin:0;font-size:13px;color:#7f1d1d">${message}</p></div>`
  }
  throw new Error(message)
}

// Where supabase-js keeps the signed-in session (its default key, spelled out so sign-out can always clear it)
export const AUTH_STORAGE_KEY = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: AUTH_STORAGE_KEY,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  }
)

// Known corrupted strings mapping to correct Arabic
const ENCODING_MAP: Record<string, string> = {
  // Suppliers
  'Ø§Ù„Ù…Ø²Ø§Ø±Ø¹ Ø§Ù„Ø®Ø¶Ø±Ø§Ø¡': 'المزارع الخضراء',
  'Ù…ÙˆØ²Ø¹ Ø§Ù„Ù…Ø´Ø±ÙˆØ¨Ø§Øª': 'موزع المشروبات',
  'Ø´Ø±ÙƒØ© Ø§Ù„Ù„Ø­ÙˆÙ… Ø§Ù„Ø·Ø§Ø²Ø¬Ø©': 'شركة اللحوم الطازجة',
  'Ù…Ù†ØªØ¬Ø§Øª Ø§Ù„Ø£Ù„Ø¨Ø§Ù†': 'منتجات الألبان',
  // Users
  'Ù…Ø¯ÙŠØ± Ø§Ù„Ù†Ø¸Ø§Ù…': 'مدير النظام',
  'Ø£Ø­Ù…Ø¯ Ù…Ø­Ù…Ø¯': 'أحمد محمد',
  'Ù…Ø­Ù…Ø¯ Ø¹Ù„ÙŠ': 'محمد علي',
  'Ø³Ø§Ø±Ø© Ø£Ø­Ù…Ø¯': 'سارة أحمد',
  'Ø­Ø³Ù† Ø¥Ø¨Ø±Ø§Ù‡ÙŠÙ…': 'حسن إبراهيم',
  // Roles
  'Ù…Ø¯ÙŠØ± Ø§Ù„Ù…Ø®Ø²Ù†': 'مدير المخزن',
  'Ù…Ø´Ø±Ù Ø§Ù„ÙØ±Ø¹': 'مشرف الفرع',
  'ÙƒØ§Ø´ÙŠØ±': 'كاشير',
  'Ø´ÙŠÙ': 'شيف',
  'Ù…Ø¯ÙŠØ± Ø§Ù„Ù…Ø´ØªØ±ÙŠØ§Øª': 'مدير المشتريات',
  // Menu Items
  'Ø¯Ø¬Ø§Ø¬ Ù…Ø´ÙˆÙŠ': 'دجاج مشوي',
  'Ø¨ÙŠØ¨Ø³ÙŠ': 'بيبسي',
  // Menu Categories
  'Ù…Ø´ÙˆÙŠØ§Øª': 'مشويات',
  'Ø³Ù†Ø¯ÙˆØªØ´Ø§Øª': 'سندوتشات',
  'ÙˆØ¬Ø¨Ø§Øª': 'وجبات',
  'Ù…Ø´Ø±ÙˆØ¨Ø§Øª': 'مشروبات',
  // Units
  'ÙƒÙŠÙ„ÙˆØ¬Ø±Ø§Ù…': 'كيلوجرام',
  'Ø¬Ø±Ø§Ù…': 'جرام',
  'Ù„ØªØ±': 'لتر',
  'Ù…Ù„Ù„ÙŠ Ù„ØªØ±': 'مللي لتر',
  'Ù‚Ø·Ø¹Ø©': 'قطعة',
  'Ø¹Ù„Ø¨Ø©': 'علبة',
  'Ø¨Ø§ÙƒØª': 'باكت',
  'Ø²Ø¬Ø§Ø¬Ø©': 'زجاجة',
  'Ø¹Ù„Ø¨Ø© Ù…Ø¹Ø¯Ù†ÙŠØ©': 'علبة معدنية',
  'ÙƒÙŠØ³': 'كيس',
  'Ø¯Ø±Ø²Ù†': 'درزن',
  'ÙƒØ±ØªÙˆÙ†Ø©': 'كرتونة',
}

/**
 * Fix corrupted UTF-8 text in database records
 */
function fixString(text: string): string {
  // Check direct mapping first
  if (ENCODING_MAP[text]) {
    return ENCODING_MAP[text]
  }
  
  // Try to decode if it looks corrupted
  if (/[\u00C0-\u00FF]/.test(text) && !/^[a-zA-Z0-9\s@._\-+()]+$/.test(text)) {
    try {
      const bytes = new Uint8Array(text.length)
      for (let i = 0; i < text.length; i++) {
        bytes[i] = text.charCodeAt(i) & 0xFF
      }
      const decoded = new TextDecoder('utf-8').decode(bytes)
      if (/[\u0600-\u06FF]/.test(decoded)) {
        return decoded
      }
    } catch {
      // Ignore
    }
  }
  
  return text
}

/**
 * Fix corrupted UTF-8 text in database records
 * Recursively fixes all string fields that look corrupted
 */
export function fixEncodingInData<T>(data: T): T {
  if (data === null || data === undefined) return data
  
  if (typeof data === 'string') {
    return fixString(data) as T
  }
  
  if (Array.isArray(data)) {
    return data.map(item => fixEncodingInData(item)) as T
  }
  
  if (typeof data === 'object') {
    const fixed: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      fixed[key] = fixEncodingInData(value)
    }
    return fixed as T
  }
  
  return data
}

export default supabase
