// Excel Export/Import Utility
// Uses native browser APIs for Excel-compatible CSV files

export interface ExcelColumn {
  key: string
  header: string
  width?: number
}

// Export data to Excel (CSV format with UTF-8 BOM for Arabic support)
export function exportToExcel<T extends Record<string, unknown>>(
  data: T[],
  columns: ExcelColumn[],
  filename: string
): void {
  // Add BOM for UTF-8 (required for Arabic in Excel)
  const BOM = '\uFEFF'
  
  // Create header row
  const headers = columns.map(col => `"${col.header}"`).join(',')
  
  // Create data rows
  const rows = data.map(item => {
    return columns.map(col => {
      const value = item[col.key]
      if (value === null || value === undefined) return '""'
      if (typeof value === 'number') return value.toString()
      // Escape quotes and wrap in quotes
      return `"${String(value).replace(/"/g, '""')}"`
    }).join(',')
  })
  
  // Combine all
  const csv = BOM + [headers, ...rows].join('\n')
  
  // Create blob and download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Parse CSV file to array of objects
export function parseCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim())
  if (lines.length < 2) return []
  
  // Parse header
  const headers = parseCSVLine(lines[0])
  
  // Parse data rows
  const data: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = values[index] || ''
    })
    data.push(row)
  }
  
  return data
}

// Parse a single CSV line handling quoted values
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  
  result.push(current.trim())
  return result
}

// Read file as text
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file, 'UTF-8')
  })
}

// Format date for Excel
export function formatDateForExcel(date: string | Date): string {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Inventory columns
export const inventoryColumns: ExcelColumn[] = [
  { key: 'item_code', header: 'كود الصنف' },
  { key: 'item_name', header: 'اسم الصنف' },
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
