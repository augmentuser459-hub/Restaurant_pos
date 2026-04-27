import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { Package, Search, Filter } from 'lucide-react'
import { formatNumber } from '../../lib/utils'

interface BranchStockItem {
  id: string
  quantity: number
  min_quantity: number
  created_at: string
  item: {
    id: string
    code: string
    name_ar: string
    unit?: { name_ar: string; code: string }
    category?: { name_ar: string }
  }
}

interface Branch {
  id: string
  name_ar: string
  code: string
}

export default function BranchStock() {
  const { branchId } = useParams()
  const [stock, setStock] = useState<BranchStockItem[]>([])
  const [branch, setBranch] = useState<Branch | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedBranch, setSelectedBranch] = useState(branchId || '')

  useEffect(() => {
    fetchBranches()
  }, [])

  useEffect(() => {
    if (selectedBranch) {
      fetchStock(selectedBranch)
    }
  }, [selectedBranch])

  const fetchBranches = async () => {
    const { data } = await supabase
      .from('branches')
      .select('id, name_ar, code')
      .eq('is_active', true)
      .neq('branch_type', 'main_warehouse')
      .order('name_ar')
    
    const branchList = fixEncodingInData(data) as Branch[] || []
    setBranches(branchList)
    
    if (!selectedBranch && branchList.length > 0) {
      setSelectedBranch(branchList[0].id)
    }
  }

  const fetchStock = async (branchIdToFetch: string) => {
    setLoading(true)
    
    // Get branch info
    const { data: branchData } = await supabase
      .from('branches')
      .select('id, name_ar, code')
      .eq('id', branchIdToFetch)
      .single()
    
    setBranch(fixEncodingInData(branchData) as Branch)

    // Get stock
    const { data } = await supabase
      .from('inventory')
      .select(`
        id, quantity, min_quantity, created_at,
        item:items(id, code, name_ar, unit:units(name_ar, code), category:categories(name_ar))
      `)
      .eq('branch_id', branchIdToFetch)
      .order('created_at', { ascending: false })

    setStock(fixEncodingInData(data) as unknown as BranchStockItem[] || [])
    setLoading(false)
  }

  const filteredStock = stock.filter((inv) => {
    const item = inv.item
    return (
      item?.name_ar?.includes(search) ||
      item?.code?.toLowerCase().includes(search.toLowerCase())
    )
  })

  // Generate document number based on date
  const getDocNumber = (date: string, index: number) => {
    const d = new Date(date)
    const dateStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
    return `${dateStr}-${String(index + 1).padStart(2, '0')}`
  }

  const formatDate = (date: string) => {
    const d = new Date(date)
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
  }

  if (loading && !branch) {
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
          <h1 className="text-2xl font-bold text-gray-900">
            مخزون {branch?.name_ar || 'الفرع'}
          </h1>
          <p className="text-gray-600">أرصدة المخزون للفرع</p>
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
              className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            aria-label="الفرع"
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name_ar}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">إجمالي الأصناف</p>
          <p className="text-2xl font-bold text-gray-900">{formatNumber(filteredStock.length)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">إجمالي الكمية</p>
          <p className="text-2xl font-bold text-blue-600">
            {formatNumber(filteredStock.reduce((sum, i) => sum + (i.quantity || 0), 0))}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">مخزون منخفض</p>
          <p className="text-2xl font-bold text-red-600">
            {formatNumber(filteredStock.filter((i) => i.quantity < (i.min_quantity || 10)).length)}
          </p>
        </div>
      </div>

      {/* Stock Table - Branch Style */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {filteredStock.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">لا توجد بيانات</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-red-100">
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
                {filteredStock.map((inv, index) => {
                  const item = inv.item
                  const unitName = item?.unit?.name_ar || item?.unit?.code || 'قطعة'
                  const totalQty = inv.quantity || 0
                  const partialQty = Math.floor(totalQty)
                  const contentQty = 1 // Default content multiplier
                  
                  return (
                    <tr key={inv.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 text-gray-900">{index + 1}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(inv.created_at)}</td>
                      <td className="px-4 py-3 text-gray-900 font-mono">{getDocNumber(inv.created_at, index)}</td>
                      <td className="px-4 py-3 text-gray-900 font-mono">{item?.code || '-'}</td>
                      <td className="px-4 py-3 text-gray-900">{item?.name_ar || '-'}</td>
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
