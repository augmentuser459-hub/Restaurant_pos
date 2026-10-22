import { translations } from '../lib/translations'
import { formatCurrency as formatMoney } from '../lib/utils'

type NestedKeyOf<T> = T extends object
  ? { [K in keyof T]: K extends string
      ? T[K] extends object
        ? `${K}.${NestedKeyOf<T[K]>}` | K
        : K
      : never
    }[keyof T]
  : never

type TranslationPath = NestedKeyOf<typeof translations>

function toDate(date: Date | string): Date | null {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  return dateObj instanceof Date && !Number.isNaN(dateObj.getTime()) ? dateObj : null
}

/**
 * Hook for accessing translations
 * Usage: const { t, formatNumber, formatCurrency, formatDate } = useTranslation()
 */
export function useTranslation() {
  /**
   * Get translation by dot-notation path
   * @param path - Dot-notation path like 'nav.dashboard' or 'status.in_transit'
   * @returns Translated string (the last path segment when the key is missing, e.g. a new status value)
   */
  const t = (path: TranslationPath | string): string => {
    const keys = path.split('.')
    let result: unknown = translations

    for (const key of keys) {
      if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, key)) {
        result = (result as Record<string, unknown>)[key]
      } else {
        return keys[keys.length - 1]
      }
    }

    return typeof result === 'string' ? result : keys[keys.length - 1]
  }

  /**
   * Format number according to Arabic locale
   * @param value - Number to format
   * @param options - Intl.NumberFormat options
   */
  const formatNumber = (value: number, options?: Intl.NumberFormatOptions): string => {
    return new Intl.NumberFormat('ar-EG', options).format(value)
  }

  /**
   * Format currency in Egyptian Pounds (same format as formatCurrency in lib/utils, used everywhere else)
   * @param value - Amount to format
   */
  const formatCurrency = (value: number): string => formatMoney(value)

  /**
   * Format date according to Arabic locale ('-' for a missing or invalid date)
   * @param date - Date to format
   * @param options - Intl.DateTimeFormat options
   */
  const formatDate = (date: Date | string, options?: Intl.DateTimeFormatOptions): string => {
    const dateObj = toDate(date)
    if (!dateObj) return '-'
    return new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      ...options,
    }).format(dateObj)
  }

  /**
   * Format relative time (e.g., "منذ 5 دقائق")
   * @param date - Date to compare
   */
  const formatRelativeTime = (date: Date | string): string => {
    const dateObj = toDate(date)
    if (!dateObj) return '-'
    const now = new Date()
    const diffMs = now.getTime() - dateObj.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'الآن'
    if (diffMins < 60) return `منذ ${diffMins} دقيقة`
    if (diffHours < 24) return `منذ ${diffHours} ساعة`
    if (diffDays < 7) return `منذ ${diffDays} يوم`
    return formatDate(dateObj)
  }

  return {
    t,
    formatNumber,
    formatCurrency,
    formatDate,
    formatRelativeTime,
    translations,
  }
}

export default useTranslation
