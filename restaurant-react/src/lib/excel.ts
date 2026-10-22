// Excel Export/Import Utility
// Uses native browser APIs for Excel-compatible CSV files
import { todayLocal, toLocalDate } from './dates'

export interface ExcelColumn {
  key: string
  header: string
  width?: number
}

/**
 * Error with a message meant for the user (e.g. an unsupported file).
 * Carries code 'P0001' so toUserMessage() shows the Arabic message as-is.
 */
export class FileFormatError extends Error {
  code = 'P0001'
  constructor(message: string) {
    super(message)
    this.name = 'FileFormatError'
  }
}

// Long digit strings (barcodes, item codes) and things like "1E5" are turned into numbers by Excel
// (6223000123456 -> 6.22E+12, leading zeros dropped) and saved back that way. ="..." keeps them as text.
const LONG_DIGITS = /^\d{11,}$/
const LEADING_ZERO_DIGITS = /^0\d+$/
const NUMBER_LIKE_CODE = /^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/
// A cell starting with one of these is run as a formula by Excel (CSV / formula injection)
const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/

function quote(text: string): string {
  return `"${text.replace(/"/g, '""')}"`
}

function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""'
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : '""'
  const text = String(value)
  if (LONG_DIGITS.test(text) || LEADING_ZERO_DIGITS.test(text) || NUMBER_LIKE_CODE.test(text)) {
    return quote(`="${text}"`)
  }
  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) && text !== '-') {
    return quote(`'${text}`)
  }
  return quote(text)
}

// Export data to Excel (CSV format with UTF-8 BOM for Arabic support)
export function exportToExcel<T extends Record<string, unknown>>(
  data: T[],
  columns: ExcelColumn[],
  filename: string
): void {
  // Add BOM for UTF-8 (required for Arabic in Excel)
  const BOM = '﻿'

  // Create header row
  const headers = columns.map(col => toCsvCell(col.header)).join(',')

  // Create data rows
  const rows = data.map(item => columns.map(col => toCsvCell(item[col.key])).join(','))

  // Combine all
  const csv = BOM + [headers, ...rows].join('\r\n')

  // Create blob and download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}_${todayLocal()}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** Undoes what exportToExcel adds to protect a cell: ="123" -> 123, '=text -> =text. */
function cleanImportedCell(value: string): string {
  let text = value.trim()
  const formula = /^="(.*)"$/s.exec(text)
  if (formula) text = formula[1].replace(/""/g, '"')
  if (text.length > 1 && text[0] === "'" && FORMULA_START.test(text.slice(1))) text = text.slice(1)
  return text
}

/** Picks the delimiter Excel used (',' normally, ';' in some locales, tab for "Unicode text"). */
function detectDelimiter(text: string): string {
  let firstLine = ''
  let inQuotes = false
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes
    else if ((char === '\n' || char === '\r') && !inQuotes) break
    firstLine += char
  }
  const count = (d: string) => firstLine.split(d).length - 1
  const candidates = [',', ';', '\t'].map(d => ({ d, n: count(d) }))
  candidates.sort((a, b) => b.n - a.n)
  return candidates[0].n > 0 ? candidates[0].d : ','
}

/** Splits CSV text into rows of cells. Handles quoted cells with commas, quotes ("") and line breaks. */
function parseCSVRows(csvText: string): string[][] {
  const text = csvText.replace(/^﻿/, '')
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
    } else if (char === '"' && cell.trim() === '') {
      // a quote opens a quoted cell only at its start; elsewhere it is a literal character (12" pizza)
      cell = ''
      inQuotes = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  // drop empty lines
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

// Parse CSV file to array of objects (keys = header cells)
export function parseCSV(csvText: string): Record<string, string>[] {
  const rows = parseCSVRows(csvText)
  if (rows.length < 2) return []

  const headers = rows[0].map(h => cleanImportedCell(h))
  const data: Record<string, string>[] = []
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i]
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      if (header) row[header] = cleanImportedCell(values[index] ?? '')
    })
    data.push(row)
  }
  return data
}

/**
 * Reads a CSV/text file. Excel workbooks (.xlsx / .xls) are refused with an Arabic FileFormatError:
 * they are binary and cannot be read here. The text encoding is detected: UTF-8 (with or without BOM),
 * UTF-16 ("Unicode text") or Windows-1256 (Excel's "CSV (Comma delimited)" on Arabic Windows).
 */
export async function readFileAsText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
  if (isZip || isOle || /\.(xlsx|xlsm|xls)$/i.test(file.name)) {
    throw new FileFormatError(
      'ملفات Excel (xlsx / xls) غير مدعومة في الاستيراد. افتح الملف في Excel واحفظه بصيغة "CSV UTF-8 (Comma delimited)" ثم استورد ملف CSV'
    )
  }
  let text: string
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = new TextDecoder('utf-16le').decode(bytes)
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = new TextDecoder('utf-16be').decode(bytes)
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      text = new TextDecoder('windows-1256').decode(bytes)
    }
  }
  return text.replace(/^﻿/, '')
}

// Format date for Excel (Cairo calendar date)
export function formatDateForExcel(date: string | Date): string {
  if (!date || Number.isNaN(new Date(date).getTime())) return ''
  return toLocalDate(date)
}

// Inventory columns
export const inventoryColumns: ExcelColumn[] = [
  { key: 'item_code', header: 'كود الصنف' },
  { key: 'item_name', header: 'اسم الصنف' },
  { key: 'category_name', header: 'مجموعة' },
  { key: 'branch_name', header: 'الفرع' },
  { key: 'quantity', header: 'الكمية' },
  { key: 'unit', header: 'الوحدة' },
  { key: 'min_quantity', header: 'الحد الأدنى' },
  { key: 'opening_balance', header: 'رصيد أول المدة' },
  { key: 'purchase_price', header: 'سعر الشراء' },
  { key: 'selling_price', header: 'سعر البيع' },
]

// Transfers columns
export const transferColumns: ExcelColumn[] = [
  { key: 'transfer_number', header: 'رقم التحويل' },
  { key: 'transfer_date', header: 'التاريخ' },
  { key: 'from_branch', header: 'من الفرع' },
  { key: 'to_branch', header: 'إلى الفرع' },
  { key: 'item_code', header: 'كود الصنف' },
  { key: 'item_name', header: 'اسم الصنف' },
  { key: 'quantity', header: 'الكمية' },
  { key: 'status', header: 'الحالة' },
]

// Returns columns
export const returnColumns: ExcelColumn[] = [
  { key: 'return_number', header: 'رقم المرتجع' },
  { key: 'return_date', header: 'التاريخ' },
  { key: 'from_branch', header: 'من الفرع' },
  { key: 'to_branch', header: 'إلى الفرع' },
  { key: 'item_code', header: 'كود الصنف' },
  { key: 'item_name', header: 'اسم الصنف' },
  { key: 'quantity', header: 'الكمية' },
  { key: 'reason', header: 'السبب' },
  { key: 'status', header: 'الحالة' },
]

// Damages columns
export const damageColumns: ExcelColumn[] = [
  { key: 'damage_number', header: 'رقم السجل' },
  { key: 'date', header: 'التاريخ' },
  { key: 'branch_name', header: 'الفرع' },
  { key: 'item_code', header: 'كود الصنف' },
  { key: 'item_name', header: 'اسم الصنف' },
  { key: 'quantity', header: 'الكمية' },
  { key: 'reason', header: 'السبب' },
  { key: 'total_cost', header: 'التكلفة' },
  { key: 'status', header: 'الحالة' },
]

// Chef consumption columns
export const consumptionColumns: ExcelColumn[] = [
  { key: 'date', header: 'التاريخ' },
  { key: 'branch_name', header: 'الفرع' },
  { key: 'item_code', header: 'كود الصنف' },
  { key: 'item_name', header: 'اسم الصنف' },
  { key: 'quantity', header: 'الكمية المستهلكة' },
  { key: 'chef_name', header: 'الطباخ' },
  { key: 'notes', header: 'ملاحظات' },
]

// Status translations
export const statusTranslations: Record<string, string> = {
  pending: 'معلق',
  approved: 'موافق عليه',
  rejected: 'مرفوض',
  received: 'مستلم',
  cancelled: 'ملغي',
  active: 'نشط',
  inactive: 'غير نشط',
}
