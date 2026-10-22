import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { fetchAll } from '../../lib/fetchAll'
import { toUserMessage } from '../../lib/errors'
import { Package, Search, Filter, Plus, Download } from 'lucide-react'
import { formatNumber } from '../../lib/utils'
import { exportToExcel, consumptionColumns } from '../../lib/excel'
import { useAuth } from '../../contexts/AuthContext'
import { displayCode, roleName, unitLabel } from './stockHelpers'

interface ConsumptionItem {
  id: string
  count_date: string
  item: {
    id: string
    code: string
    name_ar: string
    unit?: { name_ar: string; code: string } | null
  } | null
  actual_quantity: number
  system_quantity: number
  variance_reason: string | null
  count: {
    id: string
    count_date: string
    branch: { name_ar: string } | null
  } | null
}

// Chef consumption records are daily_inventory_counts rows with count_type 'morning' (real counts are opening/closing)
const CONSUMPTION_TYPE = 'morning'

/** 'YYYY-MM-DD' -> 'D-M-YYYY' without going through Date (no time zone shift) */
const formatDate = (date: string) => {
  if (!date) return '-'
  const [y, m, d] = date.slice(0, 10).split('-')
  return `${Number(d)}-${Number(m)}-${y}`
}

const getDocNumber = (date: string, index: number) => {
  if (!date) return '-'
  const [y, m, d] = date.slice(0, 10).split('-')
  return `${Number(d)}/${Number(m)}/${y}-${String(index + 1).padStart(2, '0')}`
}

export default function ChefConsumption() {
  const { user } = useAuth()
  const [items, setItems] = useState<ConsumptionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const requestRef = useRef(0) // ignores a late response for a previously selected date

  // Check if user has permission to access this page
  const userRole = roleName(user?.role)
  const allowed = !userRole || ['admin', 'warehouse_manager'].includes(userRole)

  useEffect(() => {
    if (allowed) fetchConsumption()
  }, [selectedDate, allowed])

  const fetchConsumption = async () => {
    const request = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      // Only chef consumption (inner join on the record type), the date filtered in the query, every row loaded
      const data = await fetchAll<Record<string, unknown>>((from, to) => {
        let query = supabase
          .from('daily_inventory_count_items')
          .select(`
            id, actual_quantity, system_quantity, variance_reason, created_at,
            item:items(id, code, name_ar, unit:units(name_ar, code)),
            count:daily_inventory_counts!inner(id, count_date, count_type, branch:branches(name_ar))
          `)
          .eq('count.count_type', CONSUMPTION_TYPE)
        if (selectedDate) query = query.eq('count.count_date', selectedDate)
        return query.order('created_at', { ascending: false }).order('id').range(from, to)
      })

      const transformedData = data.map(row => ({
        ...row,
        count_date: (row.count as { count_date?: string } | null)?.count_date || '',
      }))
      if (request !== requestRef.current) return // a newer date was selected meanwhile
      setItems((fixEncodingInData(transformedData) as unknown as ConsumptionItem[]) || [])
    } catch (loadError) {
      if (request !== requestRef.current) return
      setError('تعذر تحميل سجل الاستهلاك: ' + toUserMessage(loadError))
      setItems([])
    }
    setLoading(false)
  }

  // Only admin and warehouse_manager can access chef consumption (checked after all hooks ran)
  if (!allowed) {
    return <Navigate to="/dashboard" replace />
  }

  const filteredItems = items.filter((item) => {
    const itemData = item.item
    const term = search.trim()
    return (
      !term ||
      itemData?.name_ar?.includes(term) ||
      itemData?.code?.toLowerCase().includes(term.toLowerCase())
    )
  })

  // Export to Excel
  const handleExport = () => {
    const exportData = filteredItems.map(item => ({
      date: item.count_date || '',
      branch_name: item.count?.branch?.name_ar || '',
      item_code: displayCode(item.item?.code),
      item_name: item.item?.name_ar || '',
      quantity: Number(item.actual_quantity || 0),
      chef_name: '',
      notes: item.variance_reason || '',
    }))
    exportToExcel(exportData, consumptionColumns, 'استهلاك_الطباخ')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">استهلاك الطباخ</h1>
          <p className="text-gray-600">سجل استهلاك المواد في المطبخ</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            title="تصدير إلى Excel"
          >
            <Download className="w-5 h-5" />
            تصدير
          </button>
          <Link
            to="/inventory/chef-consumption/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-5 h-5" />
            إضافة استهلاك
          </Link>
        </div>
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-5 h-5 text-gray-400" />
          <span className="font-medium text-gray-700">تصفية</span>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الكود..."
              aria-label="بحث"
              className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            aria-label="التاريخ"
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setSelectedDate('')
            }}
            className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            إعادة تعيين
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">لا توجد بيانات</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-green-100">
                <tr>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">م</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">التاريخ</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">رقم المستند</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الفرع</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">كود الصنف</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">اسم الصنف</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">جزئي</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">المحتوى</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">كلي</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">وصف المحتوى</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map((item, index) => {
                  const itemData = item.item
                  const unitName = unitLabel(itemData?.unit, 'كيلو')
                  const totalQty = Number(item.actual_quantity || 0)
                  const partialQty = Math.floor(totalQty)
                  const contentQty = Number(item.system_quantity || 1)

                  return (
                    <tr key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 text-gray-900">{index + 1}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(item.count_date)}</td>
                      <td className="px-4 py-3 text-gray-900 font-mono">{getDocNumber(item.count_date, index)}</td>
                      <td className="px-4 py-3 text-gray-600">{item.count?.branch?.name_ar || '-'}</td>
                      <td className="px-4 py-3 text-gray-900 font-mono" dir="ltr">{displayCode(itemData?.code) || '-'}</td>
                      <td className="px-4 py-3 text-gray-900">{itemData?.name_ar || '-'}</td>
                      <td className="px-4 py-3 text-gray-600">{formatNumber(partialQty)}</td>
                      <td className="px-4 py-3 text-gray-600">{formatNumber(contentQty)}</td>
                      <td className="px-4 py-3 text-gray-900 font-medium">{formatNumber(totalQty)}</td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{unitName}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
