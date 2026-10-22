// Small helpers shared by the stock, items, categories and branches pages.
import { translateStatus } from '../../lib/utils'

/** Daily count status in Arabic ('completed' = submitted, waiting for approval). */
export function countStatusLabel(status: string | null | undefined): string {
  if (!status || status === 'draft') return 'مسودة'
  return status === 'completed' ? 'بانتظار الاعتماد' : translateStatus(status)
}

/** Role name of the signed-in user. users.role is the embedded roles row ({ name, name_ar }); older sessions held a plain string. */
export function roleName(role: unknown): string | undefined {
  if (role && typeof role === 'object') return (role as { name?: string }).name
  return typeof role === 'string' ? role : undefined
}

/** Roles that may see and change stock in every branch (the database functions enforce the same rule). */
export function canAccessAllBranches(role: unknown): boolean {
  const name = roleName(role)
  return name === 'admin' || name === 'warehouse_manager' || name === 'purchase_manager'
}

/** Display name of an item's unit. items has no text unit column: `unit` is the embedded units row (or null). */
export function unitLabel(unit: unknown, fallback = '-'): string {
  if (unit && typeof unit === 'object') {
    const u = unit as { name_ar?: string | null; code?: string | null }
    return u.name_ar || u.code || fallback
  }
  return typeof unit === 'string' && unit ? unit : fallback
}

/**
 * An item code or barcode exactly as stored (only invisible direction marks removed).
 * Codes are text: '1E5' or a code Excel already damaged ('6.22E+12') must not be "converted" to a number.
 */
export function displayCode(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[‎‏‪-‮]/g, '').trim()
}

/** A code or barcode compared without invisible marks, surrounding quotes or letter case. */
export const scanKey = (value: string | null | undefined) => displayCode(value).replace(/^"+|"+$/g, '').trim().toLowerCase()

/**
 * Items matching a scanned or typed code, best match level first:
 * the exact barcode; then the code, compared without case and without the literal quotes many imported
 * codes are stored with ("6223000123456"); then barcodes/codes containing the text.
 * One result = the item; more than one = ambiguous (the data has items whose codes differ only by those
 * quotes, e.g. 6223000123456 and "6223000123456": the user must choose); none = not found.
 */
export function findItemsByScan<T extends { code: string | null; barcode?: string | null }>(items: T[], scanned: string): T[] {
  const text = displayCode(scanned)
  if (!text) return []
  const byBarcode = items.filter(i => i.barcode === text)
  if (byBarcode.length > 0) return byBarcode
  const key = scanKey(text)
  if (!key) return []
  const sameKey = items.filter(i => i.code === text || scanKey(i.barcode) === key || scanKey(i.code) === key)
  if (sameKey.length > 0 || key.length < 2) return sameKey
  return items.filter(i => scanKey(i.barcode).includes(key) || scanKey(i.code).includes(key))
}
