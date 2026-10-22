import { useRef, useState } from 'react'
import { Upload, X, AlertCircle, CheckCircle, FileUp } from 'lucide-react'
import { inventoryService, StockImportResult, StockImportRow } from '../../services/inventory.service'
import { parseCSV, readFileAsText } from '../../lib/excel'
import { toUserMessage } from '../../lib/errors'
import { formatNumber, parseDecimal } from '../../lib/utils'

type ImportMode = 'items' | 'quantities' | 'both'

interface StockImportDialogProps {
  branchId: string
  branchName: string
  /** admin / warehouse_manager: may create items and change prices; others may only set quantities */
  canEditItems: boolean
  onClose: () => void
  onImported: () => void
}

interface RowError {
  row: number
  code: string
  message: string
}

// Accepted header names for each field (the stock export writes the first one)
const COLUMNS: Record<keyof Omit<StockImportRow, 'row'>, string[]> = {
  code: ['كود الصنف', 'item_code', 'كود', 'الكود', 'code'],
  name: ['اسم الصنف', 'item_name', 'الاسم', 'الصنف', 'name'],
  category: ['مجموعة', 'المجموعة', 'category_name', 'category'],
  unit: ['الوحدة', 'unit', 'وصف المحتوى'],
  quantity: ['الكمية', 'quantity', 'الرصيد إجمالي', 'الرصيد'],
  opening_balance: ['رصيد أول المدة', 'opening_balance'],
  purchase_price: ['سعر الشراء', 'purchase_price'],
  selling_price: ['سعر البيع', 'selling_price'],
}

// Header of the branch-name column the stock export writes
const BRANCH_HEADERS = ['الفرع', 'اسم الفرع', 'branch_name', 'branch']

const MAX_ROWS = 2500 // same limit as inv_import_stock (one call must finish inside the API timeout)

const normalizeHeader = (h: string) => h.replace(/[‎‏‪-‮﻿]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** The delimiter parseCSV uses (same rule as excel.ts): the most frequent of , ; tab in the header line, ',' on a tie. */
function detectDelimiter(text: string): string {
  let firstLine = ''
  let inQuotes = false
  for (const char of text.replace(/^﻿/, '')) {
    if (char === '"') inQuotes = !inQuotes
    else if ((char === '\n' || char === '\r') && !inQuotes) break
    firstLine += char
  }
  const count = (d: string) => firstLine.split(d).length - 1
  const candidates = [',', ';', '\t'].map(d => ({ d, n: count(d) }))
  candidates.sort((a, b) => b.n - a.n)
  return candidates[0].n > 0 ? candidates[0].d : ','
}

const DIGIT = '[0-9٠-٩۰-۹]'
const LEAD = '[1-9١-٩۱-۹]' // a thousands-grouped number never starts with 0
/** 1,250 / 1,250.5 (comma = thousands separator) */
const COMMA_THOUSANDS = new RegExp(`^-?${LEAD}${DIGIT}{0,2}(,${DIGIT}{3})+(\\.${DIGIT}+)?$`)
/** 8,33 / 1.250,5 (comma = decimal separator, optional dot thousands) */
const DECIMAL_COMMA = new RegExp(`^-?(${DIGIT}+|${LEAD}${DIGIT}{0,2}(\\.${DIGIT}{3})+),${DIGIT}+$`)
/** 1.250 in a decimal-comma file: 1250 (dot = thousands) or 1.25? */
const DOT_THOUSANDS = new RegExp(`^-?${LEAD}${DIGIT}{0,2}(\\.${DIGIT}{3})+$`)

/**
 * A number cell: blank -> null (leave unchanged); valid -> number; anything else is sent as text so the server reports it.
 * decimalComma: the file is ';'-delimited (Excel in a decimal-comma locale), so 8,33 = 8.33 and 1.250,5 = 1250.5.
 * Otherwise a comma is accepted only as a thousands separator (1,250.5); 2,5 stays text (invalid), never 25.
 */
function numberCell(value: string | undefined, decimalComma: boolean): number | string | null {
  const text = (value ?? '').trim()
  if (!text) return null
  let normalized = text.replace(/\s/g, '')
  if (decimalComma) {
    if (normalized.includes(',')) {
      if (!DECIMAL_COMMA.test(normalized)) return text
      normalized = normalized.replace(/\./g, '').replace(',', '.')
    }
  } else if (normalized.includes(',') && !COMMA_THOUSANDS.test(normalized)) {
    return text
  }
  const parsed = parseDecimal(normalized)
  return parsed === null ? text : parsed
}

/** In a decimal-comma file "1.250" may mean 1250 or 1.25: refused instead of guessed. */
const isAmbiguousNumber = (value: string | undefined, decimalComma: boolean) =>
  decimalComma && DOT_THOUSANDS.test((value ?? '').replace(/\s/g, ''))

const MODE_LABELS: Record<ImportMode, string> = {
  items: 'تحديث بيانات الأصناف والأسعار فقط (لا تتغير الكميات)',
  quantities: 'ضبط الكميات حسب الملف (جرد) فقط',
  both: 'تحديث البيانات والأسعار وضبط الكميات معاً',
}

export default function StockImportDialog({ branchId, branchName, canEditItems, onClose, onImported }: StockImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<StockImportRow[]>([])
  const [clientErrors, setClientErrors] = useState<RowError[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [branchWarning, setBranchWarning] = useState('') // the file was exported from another branch
  const [mode, setMode] = useState<ImportMode>(canEditItems ? 'items' : 'quantities')
  const [preview, setPreview] = useState<StockImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const modeFlags = (m: ImportMode) => ({
    updateItems: m !== 'quantities',
    updateQuantities: m !== 'items',
  })

  const runPreview = async (importRows: StockImportRow[], m: ImportMode) => {
    const request = ++requestRef.current
    setPreview(null)
    setError('')
    if (importRows.length === 0) return
    setBusy(true)
    const { data, error: previewError } = await inventoryService.importStock({
      branchId, rows: importRows, ...modeFlags(m), dryRun: true,
    })
    if (request !== requestRef.current) return
    if (previewError || !data) setError('تعذر عمل المعاينة: ' + toUserMessage(previewError))
    else setPreview(data)
    setBusy(false)
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return
    setFileName(file.name)
    setRows([])
    setClientErrors([])
    setWarnings([])
    setBranchWarning('')
    setPreview(null)
    setError('')

    let data: Record<string, string>[]
    let decimalComma = false
    try {
      const text = await readFileAsText(file)
      data = parseCSV(text)
      decimalComma = detectDelimiter(text) === ';'
    } catch (readError) {
      setError(toUserMessage(readError, 'فشل في قراءة الملف'))
      return
    }
    if (data.length === 0) {
      setError('الملف فارغ أو غير صالح')
      return
    }
    if (data.length > MAX_ROWS) {
      setError(`الملف يحتوي على ${data.length} سطر، والحد الأقصى ${MAX_ROWS} سطر. قسّمه إلى أكثر من ملف`)
      return
    }

    // Map the file's headers to fields
    const headers = Object.keys(data[0])
    const headerFor = (field: keyof typeof COLUMNS) => {
      const wanted = COLUMNS[field].map(normalizeHeader)
      return headers.find(h => wanted.includes(normalizeHeader(h)))
    }
    const columns = Object.fromEntries(
      (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).map(field => [field, headerFor(field)])
    ) as Record<keyof typeof COLUMNS, string | undefined>
    if (!columns.code) {
      setError(`لم يتم العثور على عمود "كود الصنف" في الملف. الأعمدة الموجودة: ${headers.join('، ')}`)
      return
    }

    // The target is always the branch chosen in the stock list: warn when the file names another branch
    const branchHeader = headers.find(h => BRANCH_HEADERS.map(normalizeHeader).includes(normalizeHeader(h)))
    if (branchHeader) {
      const fileBranches = [...new Set(data.map(r => (r[branchHeader] ?? '').trim()).filter(Boolean))]
      const otherBranches = fileBranches.filter(b => normalizeHeader(b) !== normalizeHeader(branchName))
      if (otherBranches.length > 0) {
        setBranchWarning(
          `تنبيه: الملف مُصدَّر من فرع "${otherBranches.slice(0, 3).join('، ')}"${otherBranches.length > 3 ? ' وغيره' : ''} ` +
          `بينما سيتم الاستيراد على "${branchName}". إذا لم يكن هذا مقصوداً فأغلق النافذة واختر الفرع الصحيح من قائمة الفروع`
        )
      }
    }

    const cell = (r: Record<string, string>, field: keyof typeof COLUMNS) => {
      const header = columns[field]
      return header ? r[header] : undefined
    }
    const textCell = (r: Record<string, string>, field: keyof typeof COLUMNS) => (cell(r, field) ?? '').trim() || null

    const parsed: StockImportRow[] = data.map((r, index) => ({
      row: index + 2, // line 1 is the header
      code: (cell(r, 'code') ?? '').replace(/[‎‏‪-‮]/g, '').trim(),
      name: textCell(r, 'name'),
      category: textCell(r, 'category'),
      unit: textCell(r, 'unit'),
      quantity: numberCell(cell(r, 'quantity'), decimalComma),
      opening_balance: numberCell(cell(r, 'opening_balance'), decimalComma),
      purchase_price: numberCell(cell(r, 'purchase_price'), decimalComma),
      selling_price: numberCell(cell(r, 'selling_price'), decimalComma),
    }))

    const newWarnings: string[] = []
    const newErrors: RowError[] = []
    const skip = new Set<StockImportRow>()

    // ';' file (decimal comma): "1.250" could be 1250 or 1.25, so the row is refused rather than guessed
    const numberFields = ['quantity', 'opening_balance', 'purchase_price', 'selling_price'] as const
    parsed.forEach((row, index) => {
      const field = numberFields.find(f => isAmbiguousNumber(cell(data[index], f), decimalComma))
      if (!field) return
      skip.add(row)
      newErrors.push({
        row: row.row, code: row.code,
        message: `قيمة "${COLUMNS[field][0]}" (${(cell(data[index], field) ?? '').trim()}) غير واضحة: هل النقطة فاصل آلاف أم علامة عشرية؟ اكتب الرقم بدون فاصل الآلاف (مثل 1250 أو 1,25)`,
      })
    })

    // Repeated codes: identical rows are imported once; rows with different values are refused
    const byCode = new Map<string, StockImportRow[]>()
    for (const row of parsed) {
      if (!row.code) continue
      byCode.set(row.code, [...(byCode.get(row.code) || []), row])
    }
    for (const [code, group] of byCode) {
      if (group.length < 2) continue
      const signature = (r: StockImportRow) => JSON.stringify({ ...r, row: 0, name: null })
      const lines = group.map(r => r.row).join('، ')
      if (group.every(r => signature(r) === signature(group[0]))) {
        if (group.some(r => skip.has(r))) {
          group.forEach(r => skip.add(r)) // a copy was refused above (unclear number) and is already reported
          continue
        }
        group.slice(1).forEach(r => skip.add(r))
        newWarnings.push(`الكود ${code} مكرر في الأسطر ${lines} بنفس القيم؛ تم استيراد السطر ${group[0].row} فقط`)
      } else {
        group.forEach(r => skip.add(r))
        newErrors.push({ row: group[0].row, code, message: `الكود مكرر في الأسطر ${lines} بقيم مختلفة؛ احذف التكرار` })
      }
    }
    const missing = (['quantity', 'purchase_price', 'selling_price', 'opening_balance'] as const)
      .filter(f => !columns[f]).map(f => COLUMNS[f][0])
    if (missing.length > 0) newWarnings.push(`أعمدة غير موجودة في الملف (لن تتغير): ${missing.join('، ')}`)

    const importRows = parsed.filter(r => !skip.has(r))
    setRows(importRows)
    setClientErrors(newErrors)
    setWarnings(newWarnings)
    await runPreview(importRows, mode)
  }

  const handleModeChange = (m: ImportMode) => {
    setMode(m)
    runPreview(rows, m)
  }

  const allErrors: RowError[] = [...clientErrors, ...(preview?.errors || [])].sort((a, b) => a.row - b.row)
  const errorRows = new Set((preview?.errors || []).map(e => e.row))
  const rowsToApply = rows.filter(r => !errorRows.has(r.row))
  const changeCount = preview ? preview.created_items + preview.updated_items + preview.quantity_changes + preview.opening_balance_changes : 0

  const handleApply = async () => {
    if (busy || !preview) return
    if (rowsToApply.length === 0 || changeCount === 0) return
    let message = `سيتم تطبيق الاستيراد على ${branchName}:`
    if (preview.created_items) message += `\n- إنشاء ${preview.created_items} صنف جديد`
    if (preview.updated_items) message += `\n- تعديل بيانات/أسعار ${preview.updated_items} صنف`
    if (preview.quantity_changes) message += `\n- ضبط كمية ${preview.quantity_changes} صنف (تُسجل كتسوية مخزون)`
    if (preview.opening_balance_changes) message += `\n- تعديل رصيد أول المدة لـ ${preview.opening_balance_changes} صنف`
    if (allErrors.length) message += `\n\nسيتم تجاهل ${allErrors.length} سطر به أخطاء.`
    if (branchWarning) message = branchWarning + '\n\n' + message
    if (!confirm(message + '\n\nهل تريد المتابعة؟')) return

    setBusy(true)
    setError('')
    const { data, error: applyError } = await inventoryService.importStock({
      branchId, rows: rowsToApply, ...modeFlags(mode), dryRun: false,
    })
    setBusy(false)
    if (applyError || !data) {
      setError('فشل الاستيراد ولم يتم تغيير أي بيانات: ' + toUserMessage(applyError))
      return
    }
    let done = 'تم الاستيراد بنجاح'
    if (data.created_items) done += `\nأصناف جديدة: ${data.created_items}`
    if (data.created_categories) done += `\nمجموعات جديدة: ${data.created_categories}`
    if (data.updated_items) done += `\nأصناف تم تعديلها: ${data.updated_items}`
    if (data.quantity_changes) done += `\nكميات تم ضبطها: ${data.quantity_changes}`
    if (data.opening_balance_changes) done += `\nأرصدة أول المدة: ${data.opening_balance_changes}`
    alert(done)
    onImported()
    onClose()
  }

  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '-' : formatNumber(v))
  const arrow = (before: number | null | undefined, after: number | null | undefined) =>
    after === undefined ? '' : `${fmt(before)} ← ${fmt(after)}`

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">استيراد المخزون من ملف</h2>
            <p className="text-sm text-gray-600">الفرع: {branchName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-50" title="إغلاق">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* File */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
            >
              <FileUp className="w-5 h-5" />
              اختر ملف CSV
            </button>
            <span className="text-sm text-gray-600">{fileName || 'لم يتم اختيار ملف'}</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,text/csv"
              onChange={handleFile}
              className="hidden"
              aria-label="ملف الاستيراد"
            />
          </div>
          <p className="text-xs text-gray-500">
            الأعمدة: كود الصنف، اسم الصنف، مجموعة، الوحدة، الكمية، رصيد أول المدة، سعر الشراء، سعر البيع. الخلية الفارغة تعني "بدون تغيير".
            ملفات Excel (xlsx) يجب حفظها أولاً بصيغة CSV UTF-8.
          </p>

          {/* Mode */}
          <div className="space-y-2">
            {(Object.keys(MODE_LABELS) as ImportMode[])
              .filter(m => canEditItems || m === 'quantities')
              .map(m => (
                <label key={m} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={mode === m}
                    onChange={() => handleModeChange(m)}
                    disabled={busy}
                  />
                  {MODE_LABELS[m]}
                </label>
              ))}
          </div>

          {branchWarning && (
            <div className="p-3 bg-orange-50 border-2 border-orange-400 rounded-lg flex items-start gap-2 text-orange-900 text-sm font-medium">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{branchWarning}</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="whitespace-pre-line">{error}</span>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm space-y-1">
              {warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}

          {busy && (
            <div className="flex items-center gap-2 text-gray-600 text-sm">
              <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              جاري المعالجة...
            </div>
          )}

          {preview && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <div className="p-3 bg-gray-50 rounded-lg"><p className="text-gray-500">أسطر الملف</p><p className="font-bold">{formatNumber(preview.rows)}</p></div>
                <div className="p-3 bg-blue-50 rounded-lg"><p className="text-gray-500">أصناف جديدة</p><p className="font-bold text-blue-700">{formatNumber(preview.created_items)}</p></div>
                <div className="p-3 bg-blue-50 rounded-lg"><p className="text-gray-500">تعديل بيانات</p><p className="font-bold text-blue-700">{formatNumber(preview.updated_items)}</p></div>
                <div className="p-3 bg-orange-50 rounded-lg"><p className="text-gray-500">ضبط كميات</p><p className="font-bold text-orange-700">{formatNumber(preview.quantity_changes)}</p></div>
                <div className="p-3 bg-gray-50 rounded-lg"><p className="text-gray-500">بدون تغيير</p><p className="font-bold">{formatNumber(preview.unchanged)}</p></div>
              </div>

              {allErrors.length > 0 && (
                <div className="border border-red-200 rounded-lg">
                  <p className="px-3 py-2 bg-red-50 text-red-800 text-sm font-medium">
                    {allErrors.length} سطر به أخطاء (لن يتم استيرادها)
                  </p>
                  <div className="max-h-48 overflow-y-auto divide-y divide-red-100 text-sm">
                    {allErrors.slice(0, 200).map((e, i) => (
                      <p key={i} className="px-3 py-1.5 text-red-700">
                        سطر {e.row}{e.code ? ` (${e.code})` : ''}: {e.message}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {preview.changes.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-x-auto">
                  <p className="px-3 py-2 bg-gray-50 text-gray-700 text-sm font-medium">
                    التغييرات {preview.changes.length > 300 ? '(أول 300)' : ''}
                  </p>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">سطر</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">الكود</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">الصنف</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">الإجراء</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">الكمية</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">سعر الشراء</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">سعر البيع</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">أخرى</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {preview.changes.slice(0, 300).map(c => (
                        <tr key={c.row}>
                          <td className="px-3 py-1.5 text-gray-500">{c.row}</td>
                          <td className="px-3 py-1.5 font-mono" dir="ltr">{c.code}</td>
                          <td className="px-3 py-1.5">{c.name || '-'}</td>
                          <td className="px-3 py-1.5">{c.action === 'new' ? 'صنف جديد' : 'تعديل'}</td>
                          <td className="px-3 py-1.5" dir="ltr">{arrow(c.quantity_before, c.quantity_after)}</td>
                          <td className="px-3 py-1.5" dir="ltr">{arrow(c.purchase_price_before, c.purchase_price_after)}</td>
                          <td className="px-3 py-1.5" dir="ltr">{arrow(c.selling_price_before, c.selling_price_after)}</td>
                          <td className="px-3 py-1.5 text-gray-600">
                            {c.category_after
                              ? `المجموعة: ${c.category_before ? `${c.category_before} ← ` : ''}${c.category_after} `
                              : ''}
                            {c.opening_balance_after !== undefined ? `رصيد أول المدة: ${arrow(c.opening_balance_before, c.opening_balance_after)}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {changeCount === 0 && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  لا توجد تغييرات للتطبيق
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-3 p-4 border-t border-gray-200">
          <button
            type="button"
            onClick={handleApply}
            disabled={busy || !preview || changeCount === 0 || rowsToApply.length === 0}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Upload className="w-5 h-5" />
            {allErrors.length > 0 ? 'تجاهل الأسطر الخاطئة وتطبيق الباقي' : 'تطبيق الاستيراد'}
          </button>
          <button type="button" onClick={onClose} disabled={busy} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}
