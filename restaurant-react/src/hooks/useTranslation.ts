import { translations } from '../lib/translations'

type NestedKeyOf<T> = T extends object
  ? { [K in keyof T]: K extends string
      ? T[K] extends object
        ? `${K}.${NestedKeyOf<T[K]>}` | K
        : K
      : never
    }[keyof T]
  : never

type TranslationPath = NestedKeyOf<typeof translations>

/**
 * Hook for accessing translations
 * Usage: const { t, formatNumber, formatCurrency, formatDate } = useTranslation()
 */
export function useTranslation() {
  /**
   * Get translation by dot-notation path
   * @param path - Dot-notation path like 'nav.dashboard' or 'actions.save'
   * @returns Translated string
   */
  const t = (path: TranslationPath | string): string => {
    const keys = path.split('.')
    let result: unknown = translations

    for (const key of keys) {
      if (result && typeof result === 'object' && key in result) {
        result = (result as Record<string, unknown>)[key]
      } else {
        return path // Return path if translation not found
      }
    }

    return typeof result === 'string' ? result : path
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
   * Format currency in Egyptian Pounds
   * @param value - Amount to format
   */
  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'currency',
      currency: 'EGP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value)
  }

  /**
   * Format date according to Arabic locale
   * @param date - Date to format
   * @param options - Intl.DateTimeFormat options
   */
  const formatDate = (date: Date | string, options?: Intl.DateTimeFormatOptions): string => {
    const dateObj = typeof date === 'string' ? new Date(date) : date
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
    const dateObj = typeof date === 'string' ? new Date(date) : date
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
