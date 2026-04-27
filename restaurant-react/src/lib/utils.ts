// Utility functions

/**
 * Format number to Arabic locale
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('ar-EG').format(num)
}

/**
 * Format currency to Egyptian Pound
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
  }).format(amount)
}

/**
 * Format date to Arabic locale
 */
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date))
}

/**
 * Format datetime to Arabic locale
 */
export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

/**
 * Format time only
 */
export function formatTime(date: string | Date): string {
  return new Intl.DateTimeFormat('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

/**
 * Get status color class
 */
export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    received: 'bg-blue-100 text-blue-800',
    active: 'bg-green-100 text-green-800',
    inactive: 'bg-gray-100 text-gray-800',
    new: 'bg-blue-100 text-blue-800',
    paid: 'bg-green-100 text-green-800',
    in_kitchen: 'bg-orange-100 text-orange-800',
    preparing: 'bg-yellow-100 text-yellow-800',
    ready: 'bg-green-100 text-green-800',
    delivered: 'bg-gray-100 text-gray-800',
    cancelled: 'bg-red-100 text-red-800',
  }
  return colors[status] || 'bg-gray-100 text-gray-800'
}

/**
 * Translate status to Arabic
 */
export function translateStatus(status: string): string {
  const translations: Record<string, string> = {
    pending: 'معلق',
    approved: 'موافق عليه',
    rejected: 'مرفوض',
    received: 'مستلم',
    active: 'نشط',
    inactive: 'غير نشط',
    new: 'جديد',
    paid: 'مدفوع',
    in_kitchen: 'في المطبخ',
    preparing: 'قيد التحضير',
    ready: 'جاهز',
    delivered: 'تم التسليم',
    cancelled: 'ملغي',
    draft: 'مسودة',
    completed: 'مكتمل',
  }
  return translations[status] || status
}

/**
 * Classnames helper
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

/**
 * Fix corrupted UTF-8 text - maps known corrupted strings to correct Arabic
 */
export function fixArabicEncoding(text: string | null | undefined): string {
  if (!text) return ''
  
  // Direct mapping for known corrupted values
  const knownMappings: Record<string, string> = {
    'Ù…Ø¯ÙŠØ± Ø§Ù„Ù†Ø¸Ø§Ù…': 'مدير النظام',
    'Ø£Ø­Ù…Ø¯ Ù…Ø­Ù…Ø¯': 'أحمد محمد',
    'Ù…Ø­Ù…Ø¯ Ø¹Ù„ÙŠ': 'محمد علي',
    'Ø³Ø§Ø±Ø© Ø£Ø­Ù…Ø¯': 'سارة أحمد',
    'Ø­Ø³Ù† Ø¥Ø¨Ø±Ø§Ù‡ÙŠÙ…': 'حسن إبراهيم',
    'Ù…Ø¯ÙŠØ± Ø§Ù„Ù…Ø®Ø²Ù†': 'مدير المخزن',
    'Ù…Ø´Ø±Ù Ø§Ù„ÙØ±Ø¹': 'مشرف الفرع',
    'ÙƒØ§Ø´ÙŠØ±': 'كاشير',
    'Ø´ÙŠÙ': 'شيف',
    'Ù…Ø¯ÙŠØ± Ø§Ù„Ù…Ø´ØªØ±ÙŠØ§Øª': 'مدير المشتريات',
  }
  
  // Check if text matches a known corrupted value
  if (knownMappings[text]) {
    return knownMappings[text]
  }
  
  // Try to decode if it looks corrupted
  try {
    if (/[\u00C0-\u00FF]{2,}/.test(text)) {
      const bytes = new Uint8Array(text.length)
      for (let i = 0; i < text.length; i++) {
        bytes[i] = text.charCodeAt(i)
      }
      return new TextDecoder('utf-8').decode(bytes)
    }
  } catch {
    // Ignore decoding errors
  }
  
  return text
}

/**
 * Format decimal quantities by removing trailing zeros
 * تنسيق الكميات العشرية بإزالة الأصفار الزائدة
 * 
 * @example
 * formatQuantity(19.200) => "19.2"
 * formatQuantity(5.000) => "5"
 * formatQuantity(100.125) => "100.125"
 * formatQuantity(0) => "0"
 */
export function formatQuantity(quantity: number | string | null | undefined): string {
  if (quantity === null || quantity === undefined) return '0'
  
  const num = typeof quantity === 'string' ? parseFloat(quantity) : quantity
  
  if (isNaN(num)) return '0'
  
  // Convert to string with 3 decimal places and remove trailing zeros
  // تحويل إلى نص مع 3 أرقام عشرية وإزالة الأصفار الزائدة
  return num.toFixed(3).replace(/\.?0+$/, '')
}

/**
 * Parse quantity from text input (supports Arabic comma)
 * تحليل الكمية من النص (يدعم الفاصلة العربية)
 * 
 * @example
 * parseQuantity("19.2") => 19.2
 * parseQuantity("19,2") => 19.2 (Arabic comma)
 * parseQuantity("") => 0
 * parseQuantity("abc") => 0
 */
export function parseQuantity(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  
  if (typeof value === 'number') return Math.max(0, value)
  
  // Replace Arabic comma with dot
  // استبدال الفاصلة العربية بالنقطة
  const normalized = value.replace(',', '.')
  const num = parseFloat(normalized)
  
  return isNaN(num) ? 0 : Math.max(0, num)
}

/**
 * Validate quantity value
 * التحقق من صحة الكمية
 * 
 * @param quantity - The quantity to validate
 * @param allowZero - Whether to allow zero values (default: false)
 * @returns true if valid, false otherwise
 */
export function isValidQuantity(quantity: number | string | null | undefined, allowZero: boolean = false): boolean {
  const num = typeof quantity === 'string' ? parseFloat(quantity) : quantity
  
  if (num === null || num === undefined || isNaN(num)) return false
  
  const minValue = allowZero ? 0 : 0.001
  const maxValue = 999999999.999
  
  return num >= minValue && num <= maxValue
}

/**
 * Round quantity to 3 decimal places
 * تقريب الكمية إلى 3 أرقام عشرية
 * 
 * @example
 * roundQuantity(19.2005) => 19.201
 * roundQuantity(19.2004) => 19.200
 */
export function roundQuantity(quantity: number): number {
  return Math.round(quantity * 1000) / 1000
}

/**
 * Format quantity with unit
 * تنسيق الكمية مع الوحدة
 * 
 * @example
 * formatQuantityWithUnit(19.2, "كجم") => "19.2 كجم"
 * formatQuantityWithUnit(5, "لتر") => "5 لتر"
 */
export function formatQuantityWithUnit(quantity: number | string | null | undefined, unit: string): string {
  const formattedQty = formatQuantity(quantity)
  return `${formattedQty} ${unit}`
}
