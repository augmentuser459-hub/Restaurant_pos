import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { Package, Search, Filter, Plus, Download } from 'lucide-react'
import { formatNumber } from '../../lib/utils'
import { exportToExcel, consumptionColumns, formatDateForExcel } from '../../lib/excel'
import { useAuth } from '../../contexts/AuthContext'

interface ConsumptionItem {
  id: string
  count_date: string
  item: {
    id: string
    code: string
    name_ar: string
    unit?: { name_ar: string; code: string }
  }
  actual_quantity: number
  system_quantity: number
  variance_reason: string
  count: {
    id: string
    branch: { name_ar: string }
  }
}

export default function ChefConsumption() {
  const { user } = useAuth()
  const [items, setItems] = useState<ConsumptionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedDate, setSelectedDate] = useState('')

  // Check if user has permission to access this page
  const userRole = typeof user?.role === 'object' && user?.role !== null 
    ? (user.role as { name: string }).name 
    : user?.role

  // Only admin and warehouse_manager can access chef consumption
  if (userRole && !['admin', 'warehouse_manager'].includes(userRole)) {
    return <Navigate to="/dashboard" replace />
  }

  useEffect(() => {
    fetchConsumption()
  }, [selectedDate])

  const fetchConsumption = async () => {
    setLoading(true)
    
    let query = supabase
      .from('daily_inventory_count_items')
      .select(`
        id, actual_quantity, system_quantity, variance_reason, created_at,
        item:items(id, code, name_ar, unit:units(name_ar, code)),
        count:daily_inventory_counts(id, count_date, branch:branches(name_ar))
      `)
      .order('created_at', { ascending: false })
      .limit(100)

    const { data } = await query
    
    // Transform data to include count_date at item level
    const transformedData = (data || []).map(item => ({
      ...item,
      count_date: (item.count as { count_date?: string })?.count_date || '',
    }))
    
    // Filter by date if selected
    let filteredData = transformedData
    if (selectedDate) {
      filteredData = transformedData.filter(item => 
        item.count_date?.startsWith(selectedDate)
      )
    }
    
    setItems(fixEncodingInData(filteredData) as unknown as ConsumptionItem[] || [])
    setLoading(false)
  }

  const formatDate = (date: string) => {
    if (!date) return '-'
    const d = new Date(date)
    return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`
  }

  const getDocNumber = (date: string, index: number) => {
    if (!date) return '-'
    const d = new Date(date)
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}-${String(index + 1).padStart(2, '0')}`
  }

  const filteredItems = items.filter((item) => {
    const itemData = item.item as { code?: string; name_ar?: string }
    return (
      itemData?.name_ar?.includes(search) ||
      itemData?.code?.toLowerCase().includes(search.toLowerCase())
    )
  })

  // Export to Excel
  const handleExport = () => {
    const exportData = filteredItems.map(item => {
      const itemData = item.item as { code?: string; name_ar?: string }
      const countData = item.count as { branch?: { name_ar?: string } }
      return {
        date: item.count_date ? formatDateForExcel(item.count_date) : '',
        branch_name: countData?.branch?.name_ar || '',
        item_code: itemData?.code || '',
        item_name: itemData?.name_ar || '',
        quantity: item.actual_quantity || 0,
        chef_name: '',
        notes: item.variance_reason || '',
      }
    })
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
                  const itemData = item.item as { code?: string; name_ar?: string; unit?: { name_ar: string; code: string } }
                  const unitName = itemData?.unit?.name_ar || itemData?.unit?.code || 'كيلو'
                  const totalQty = item.actual_quantity || 0
                  const partialQty = Math.floor(totalQty)
                  const contentQty = item.system_quantity || 1
                  
                  return (
                    <tr key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 text-gray-900">{index + 1}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(item.count_date)}</td>
                      <td className="px-4 py-3 text-gray-900 font-mono">{getDocNumber(item.count_date, index)}</td>
                      <td className="px-4 py-3 text-gray-900 font-mono">{itemData?.code || '-'}</td>
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
