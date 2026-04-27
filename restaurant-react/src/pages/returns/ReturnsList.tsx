import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fixEncodingInData } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Package, Search, Filter, Plus, Eye, Download } from 'lucide-react'
import { formatNumber } from '../../lib/utils'
import { exportToExcel, returnColumns, statusTranslations, formatDateForExcel } from '../../lib/excel'

type ReturnType = 'supplier' | 'branch'

interface SupplierReturn {
  id: string
  return_number: string
  registered_at: string
  quantity: number
  reason: string
  description: string
  status: string
  item: { code: string; name_ar: string }
  supplier: { name_ar: string }
}

interface BranchReturn {
  id: string
  return_number: string
  return_date: string
  status: string
  return_reason: string
  total_quantity: number
  notes: string
  from_branch: { name_ar: string }
  to_branch: { name_ar: string }
  items: BranchReturnItem[]
}

interface BranchReturnItem {
  id: string
  requested_quantity: number
  item_reason: string
  notes: string
  item: { code: string; name_ar: string }
}

export default function ReturnsList() {
  const { user } = useAuth()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userRole = typeof user?.role === 'object' ? (user.role as any)?.name : user?.role
  const isBranchSupervisor = userRole === 'branch_supervisor'
  
  // Branch supervisors can only see branch returns
  const [returnType, setReturnType] = useState<ReturnType>(isBranchSupervisor ? 'branch' : 'supplier')
  const [supplierReturns, setSupplierReturns] = useState<SupplierReturn[]>([])
  const [branchReturns, setBranchReturns] = useState<BranchReturn[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchReturns()
  }, [returnType, user?.branch_id])

  const fetchReturns = async () => {
    setLoading(true)
    
    if (returnType === 'supplier') {
      const { data } = await supabase
        .from('supplier_returns')
        .select(`
          id, return_number, registered_at, quantity, reason, description, status,
          item:items(code, name_ar),
          supplier:suppliers(name_ar)
        `)
        .order('registered_at', { ascending: false })
      
      setSupplierReturns(fixEncodingInData(data) as unknown as SupplierReturn[] || [])
    } else {
      // Build query
      let query = supabase
        .from('branch_returns')
        .select(`
          id, return_number, return_date, status, return_reason, total_quantity, notes,
          from_branch:branches!branch_returns_from_branch_id_fkey(name_ar),
          to_branch:branches!branch_returns_to_branch_id_fkey(name_ar)
        `)
      
      // Filter by branch for branch supervisors
      if (isBranchSupervisor && user?.branch_id) {
        query = query.eq('from_branch_id', user.branch_id)
      }
      
      const { data, error } = await query.order('return_date', { ascending: false })
      
      if (error) {
        console.error('Error fetching branch returns:', error)
      }
      
      console.log('Branch returns fetched:', data?.length || 0, 'records')
      
      // Fetch items for each return
      const returnsWithItems = await Promise.all(
        (data || []).map(async (ret) => {
          const { data: items } = await supabase
            .from('branch_return_items')
            .select('id, requested_quantity, item_reason, notes, item:items(code, name_ar)')
            .eq('return_id', ret.id)
          
          return { ...ret, items: fixEncodingInData(items) || [] }
        })
      )
      
      setBranchReturns(fixEncodingInData(returnsWithItems) as unknown as BranchReturn[] || [])
    }
    
    setLoading(false)
  }

  const formatDate = (date: string) => {
    const d = new Date(date)
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
  }

  // Export to Excel
  const handleExport = () => {
    if (returnType === 'supplier') {
      const exportData = filteredSupplierReturns.map(ret => ({
        return_number: ret.return_number || '',
        return_date: ret.registered_at ? formatDateForExcel(ret.registered_at) : '',
        from_branch: 'المخزن الرئيسي',
        to_branch: ret.supplier?.name_ar || '',
        item_code: ret.item?.code || '',
        item_name: ret.item?.name_ar || '',
        quantity: ret.quantity || 0,
        reason: ret.reason || '',
        status: statusTranslations[ret.status] || ret.status,
      }))
      exportToExcel(exportData, returnColumns, 'مرتجعات_الموردين')
    } else {
      const exportData = flattenedBranchReturns.map(ret => ({
        return_number: ret.return_number || '',
        return_date: ret.return_date ? formatDateForExcel(ret.return_date) : '',
        from_branch: ret.from_branch?.name_ar || '',
        to_branch: ret.to_branch?.name_ar || '',
        item_code: ret.itemData?.item?.code || '',
        item_name: ret.itemData?.item?.name_ar || '',
        quantity: ret.itemData?.requested_quantity || 0,
        reason: ret.itemData?.item_reason || ret.return_reason || '',
        status: statusTranslations[ret.status] || ret.status,
      }))
      exportToExcel(exportData, returnColumns, 'مرتجعات_الفروع')
    }
  }

  // Filter supplier returns
  const filteredSupplierReturns = supplierReturns.filter((ret) => {
    const item = ret.item as { code?: string; name_ar?: string }
    return (
      item?.name_ar?.includes(search) ||
      item?.code?.toLowerCase().includes(search.toLowerCase()) ||
      ret.return_number?.toLowerCase().includes(search.toLowerCase())
    )
  })

  // Flatten branch returns to show items
  const flattenedBranchReturns = branchReturns.flatMap((ret) => {
    return (ret.items || []).map((item, idx) => ({
      ...ret,
      itemIndex: idx,
      itemData: item,
    }))
  }).filter((ret) => {
    const item = ret.itemData?.item as { code?: string; name_ar?: string }
    return (
      item?.name_ar?.includes(search) ||
      item?.code?.toLowerCase().includes(search.toLowerCase()) ||
      ret.return_number?.toLowerCase().includes(search.toLowerCase())
    )
  })

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
          <h1 className="text-2xl font-bold text-gray-900">المرتجعات</h1>
          <p className="text-gray-600">إدارة مرتجعات الموردين والفروع</p>
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
            to={returnType === 'supplier' ? '/returns/supplier/new' : '/returns/branch/new'}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-5 h-5" />
            {returnType === 'supplier' ? 'مرتجع للمورد' : 'مرتجع للرئيسي'}
          </Link>
        </div>
      </div>

      {/* Tabs - Hide supplier returns tab for branch supervisors */}
      <div className="flex gap-2 border-b border-gray-200">
        {!isBranchSupervisor && (
          <button
            type="button"
            onClick={() => setReturnType('supplier')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              returnType === 'supplier'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            مرتجع المخزن للمورد
          </button>
        )}
        <button
          type="button"
          onClick={() => setReturnType('branch')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            returnType === 'branch'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          مرتجع الفروع للرئيسي
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-5 h-5 text-gray-400" />
          <span className="font-medium text-gray-700">تصفية</span>
        </div>
        <div className="relative max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو الكود أو رقم المستند..."
            aria-label="بحث"
            className="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {returnType === 'supplier' ? (
          /* Supplier Returns Table */
          filteredSupplierReturns.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">لا توجد مرتجعات</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-blue-100">
                  <tr>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">م</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">التاريخ</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">رقم المستند</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">كود الصنف</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">اسم الصنف</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">بيان</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الكمية</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">ملاحظات</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSupplierReturns.map((ret, index) => {
                    const item = ret.item as { code?: string; name_ar?: string }
                    return (
                      <tr key={ret.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-3 text-gray-900">{index + 1}</td>
                        <td className="px-4 py-3 text-gray-600">{formatDate(ret.registered_at)}</td>
                        <td className="px-4 py-3 text-gray-900 font-mono">{ret.return_number}</td>
                        <td className="px-4 py-3 text-gray-900 font-mono">{item?.code || '-'}</td>
                        <td className="px-4 py-3 text-gray-900">{item?.name_ar || '-'}</td>
                        <td className="px-4 py-3 text-gray-600">{ret.reason || '-'}</td>
                        <td className="px-4 py-3 text-gray-900 font-medium">{formatNumber(ret.quantity)}</td>
                        <td className="px-4 py-3 text-gray-500 text-sm">{ret.description || '-'}</td>
                        <td className="px-4 py-3">
                          <Link to={`/returns/supplier/${ret.id}`} className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg">
                            <Eye className="w-4 h-4" /> عرض
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* Branch Returns Table */
          flattenedBranchReturns.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">لا توجد مرتجعات</p>
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
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">الكمية</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">ملاحظات</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {flattenedBranchReturns.map((ret, index) => {
                    const item = ret.itemData?.item as { code?: string; name_ar?: string }
                    return (
                      <tr key={`${ret.id}-${ret.itemIndex}`} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-3 text-gray-900">{index + 1}</td>
                        <td className="px-4 py-3 text-gray-600">{formatDate(ret.return_date)}</td>
                        <td className="px-4 py-3 text-gray-900 font-mono">{ret.return_number}</td>
                        <td className="px-4 py-3 text-gray-900 font-mono">{item?.code || '-'}</td>
                        <td className="px-4 py-3 text-gray-900">{item?.name_ar || '-'}</td>
                        <td className="px-4 py-3 text-gray-900 font-medium">{formatNumber(ret.itemData?.requested_quantity || 0)}</td>
                        <td className="px-4 py-3 text-gray-500 text-sm">{ret.itemData?.notes || ret.notes || '-'}</td>
                        <td className="px-4 py-3">
                          <Link to={`/returns/branch/${ret.id}`} className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg">
                            <Eye className="w-4 h-4" /> عرض
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  )
}
