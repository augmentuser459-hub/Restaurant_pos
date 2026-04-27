import { createClient } from '@supabase/supabase-js'

// Supabase configuration - reads from environment variables with fallback to production values
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://hqjwhhqcymgkwohlofvf.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxandoaHFjeW1na3dvaGxvZnZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MzU0NjIsImV4cCI6MjA5MTMxMTQ2Mn0.nXBqG9P7_6I5eqxtMxaaSKr2NM5PTdkhC6jZH0GJu08'

// Check if we have valid credentials
export const hasValidCredentials = Boolean(supabaseUrl && supabaseAnonKey && supabaseUrl !== 'https://placeholder.supabase.co')

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
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
