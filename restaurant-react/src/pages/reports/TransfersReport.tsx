import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/fetchAll'
import { localDateRangeISO, todayLocal } from '../../lib/dates'
import { toUserMessage } from '../../lib/errors'
import { branchesService } from '../../services/branches.service'
import { dateRangeError, monthsAgoLocal } from '../../services/reports.service'
import { Branch } from '../../types/database.types'
import { formatDate, formatNumber } from '../../lib/utils'
import { useDebouncedValue } from './useDebouncedValue'
import { ArrowRight, ArrowLeftRight, CheckCircle, XCircle, Clock, Truck, AlertCircle } from 'lucide-react'

interface TransferReportData {
  totalTransfers: number
  pendingCount: number
  approvedCount: number
  receivedCount: number
  rejectedCount: number
  transfers: {
    id: string
    transfer_number: string
    from_branch: string
    to_branch: string
    status: string
    items_count: number
    created_at: string
  }[]
}

interface TransferRow {
  id: string
  transfer_number: string
  status: string
  created_at: string
  from_branch: { name_ar: string } | null
  to_branch: { name_ar: string } | null
  items: { id: string }[] | null
}

export default function TransfersReport() {
  const [data, setData] = useState<TransferReportData | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchesError, setBranchesError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [startDate, setStartDate] = useState(() => monthsAgoLocal(1))
  const [endDate, setEndDate] = useState(() => todayLocal())
  const requestId = useRef(0)
  const filterKey = useDebouncedValue(`${startDate}|${endDate}|${selectedBranch}`)

  useEffect(() => {
    fetchBranches()
  }, [])

  useEffect(() => {
    fetchReport(filterKey)
  }, [filterKey])

  const fetchBranches = async () => {
    const { data, error } = await branchesService.getActive()
    if (error) setBranchesError(toUserMessage(error))
    setBranches(data || [])
  }

  const fetchReport = async (key: string) => {
    const [from, to, branchId] = key.split('|')
    const id = ++requestId.current
    const rangeError = dateRangeError(from, to)
    if (rangeError) {
      // Never leave the previous report on screen under new filter values
      setData(null)
      setError(rangeError)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')

    // Cairo days, end day included
    const { start, endExclusive } = localDateRangeISO(from, to)
    try {
      const rows = await fetchAll((rangeFrom, rangeTo) => {
        let query = supabase
          .from('transfers')
          .select(`
            id, transfer_number, status, created_at,
            from_branch:branches!from_branch_id(name_ar),
            to_branch:branches!to_branch_id(name_ar),
            items:transfer_items(id)
          `)
          .gte('created_at', start)
          .lt('created_at', endExclusive)
          .order('created_at', { ascending: false })
          .order('id')
        if (branchId) {
          query = query.or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`)
        }
        return query.range(rangeFrom, rangeTo)
      })
      if (id !== requestId.current) return
      // Embedded many-to-one relations arrive as objects
      const transfers = rows as unknown as TransferRow[]

      setData({
        totalTransfers: transfers.length,
        pendingCount: transfers.filter(t => t.status === 'pending').length,
        approvedCount: transfers.filter(t => t.status === 'approved').length,
        receivedCount: transfers.filter(t => t.status === 'received').length,
        rejectedCount: transfers.filter(t => t.status === 'rejected').length,
        transfers: transfers.map(t => ({
          id: t.id,
          transfer_number: t.transfer_number,
          from_branch: t.from_branch?.name_ar || '-',
          to_branch: t.to_branch?.name_ar || '-',
          status: t.status,
          items_count: Array.isArray(t.items) ? t.items.length : 0,
          created_at: t.created_at,
        })),
      })
    } catch (err) {
      if (id !== requestId.current) return
      setData(null)
      setError(toUserMessage(err))
    }
    setLoading(false)
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-blue-100 text-blue-800',
      received: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      cancelled: 'bg-gray-100 text-gray-800',
    }
    const labels: Record<string, string> = {
      pending: 'معلق',
      approved: 'موافق عليه',
      received: 'مستلم',
      rejected: 'مرفوض',
      cancelled: 'ملغي',
    }
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>{labels[status] || status}</span>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/reports" className="p-2 hover:bg-gray-100 rounded-lg"><ArrowRight className="w-5 h-5" /></Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">تقرير التحويلات</h1>
          <p className="text-gray-600">تحليل تحويلات المخزون بين الفروع</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">من تاريخ</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} aria-label="من تاريخ" className="px-4 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">إلى تاريخ</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} aria-label="إلى تاريخ" className="px-4 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">الفرع</label>
            <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} aria-label="الفرع" className="px-4 py-2 border border-gray-300 rounded-lg">
              <option value="">جميع الفروع</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name_ar}</option>)}
            </select>
            {branchesError && <p className="text-xs text-red-600 mt-1">{branchesError}</p>}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <ArrowLeftRight className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">إجمالي التحويلات</p>
                  <p className="text-xl font-bold">{formatNumber(data?.totalTransfers || 0)}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <Clock className="w-5 h-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">معلق</p>
                  <p className="text-xl font-bold text-yellow-600">{formatNumber(data?.pendingCount || 0)}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Truck className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">موافق عليه</p>
                  <p className="text-xl font-bold text-blue-600">{formatNumber(data?.approvedCount || 0)}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">مستلم</p>
                  <p className="text-xl font-bold text-green-600">{formatNumber(data?.receivedCount || 0)}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                  <XCircle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">مرفوض</p>
                  <p className="text-xl font-bold text-red-600">{formatNumber(data?.rejectedCount || 0)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-indigo-600 text-white">
                  <tr>
                    <th className="px-4 py-3 text-right text-sm font-medium">رقم التحويل</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">من</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">إلى</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">عدد الأصناف</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">التاريخ</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data?.transfers.map((t, i) => (
                    <tr key={t.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 font-medium">{t.transfer_number}</td>
                      <td className="px-4 py-3">{t.from_branch}</td>
                      <td className="px-4 py-3">{t.to_branch}</td>
                      <td className="px-4 py-3">{formatNumber(t.items_count)}</td>
                      <td className="px-4 py-3">{formatDate(t.created_at)}</td>
                      <td className="px-4 py-3">{getStatusBadge(t.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(!data?.transfers || data.transfers.length === 0) && (
              <div className="text-center py-12 text-gray-500">لا توجد تحويلات في هذه الفترة</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
