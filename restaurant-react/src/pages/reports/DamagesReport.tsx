import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { branchesService } from '../../services/branches.service'
import { Branch } from '../../types/database.types'
import { formatDate, formatNumber, formatCurrency } from '../../lib/utils'
import { ArrowRight, AlertTriangle, CheckCircle, XCircle, Clock, DollarSign } from 'lucide-react'

interface DamageReportData {
  totalDamages: number
  pendingCount: number
  approvedCount: number
  rejectedCount: number
  totalValue: number
  damages: {
    id: string
    damage_number: string
    branch: string
    item: string
    quantity: number
    estimated_value: number
    reason: string
    status: string
    created_at: string
  }[]
  byReason: { reason: string; count: number; value: number }[]
}

export default function DamagesReport() {
  const [data, setData] = useState<DamageReportData | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => {
    fetchBranches()
  }, [])

  useEffect(() => {
    fetchReport()
  }, [selectedBranch, startDate, endDate])

  const fetchBranches = async () => {
    const { data } = await branchesService.getActive()
    setBranches(data || [])
  }

  const fetchReport = async () => {
    setLoading(true)
    
    let query = supabase
      .from('damages')
      .select(`
        id, damage_number, quantity, total_cost, status, created_at,
        branch:branches(name_ar),
        item:items(name_ar),
        reason:damage_reasons(name_ar)
      `)
      .gte('created_at', startDate)
      .lte('created_at', endDate + 'T23:59:59')
      .order('created_at', { ascending: false })

    if (selectedBranch) {
      query = query.eq('branch_id', selectedBranch)
    }

    const { data: damages, error } = await query
    
    console.log('Damages report query result:', { damages, error })

    if (damages) {
      // Group by reason
      const reasonStats: Record<string, { count: number; value: number }> = {}
      damages.forEach(d => {
        const reasonObj = d.reason as unknown as { name_ar: string } | null
        const reason = reasonObj?.name_ar || 'غير محدد'
        if (!reasonStats[reason]) reasonStats[reason] = { count: 0, value: 0 }
        reasonStats[reason].count++
        reasonStats[reason].value += d.total_cost || 0
      })

      const reportData: DamageReportData = {
        totalDamages: damages.length,
        pendingCount: damages.filter(d => d.status === 'pending').length,
        approvedCount: damages.filter(d => d.status === 'approved').length,
        rejectedCount: damages.filter(d => d.status === 'rejected').length,
        totalValue: damages.reduce((sum, d) => sum + (d.total_cost || 0), 0),
        damages: damages.map(d => {
          const reasonObj = d.reason as unknown as { name_ar: string } | null
          return {
            id: d.id,
            damage_number: d.damage_number,
            branch: (d.branch as unknown as { name_ar: string })?.name_ar || '-',
            item: (d.item as unknown as { name_ar: string })?.name_ar || '-',
            quantity: d.quantity,
            estimated_value: d.total_cost || 0,
            reason: reasonObj?.name_ar || '-',
            status: d.status,
            created_at: d.created_at,
          }
        }),
        byReason: Object.entries(reasonStats).map(([reason, stats]) => ({
          reason,
          count: stats.count,
          value: stats.value,
        })),
      }
      setData(reportData)
    }
    setLoading(false)
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
    }
    const labels: Record<string, string> = {
      pending: 'معلق',
      approved: 'موافق عليه',
      rejected: 'مرفوض',
    }
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>{labels[status] || status}</span>
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/reports" className="p-2 hover:bg-gray-100 rounded-lg"><ArrowRight className="w-5 h-5" /></Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">تقرير التالف</h1>
          <p className="text-gray-600">تحليل سجلات التالف والهالك</p>
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
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">إجمالي التالف</p>
              <p className="text-xl font-bold">{formatNumber(data?.totalDamages || 0)}</p>
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
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">موافق عليه</p>
              <p className="text-xl font-bold text-green-600">{formatNumber(data?.approvedCount || 0)}</p>
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
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">إجمالي الخسائر</p>
              <p className="text-xl font-bold text-orange-600">{formatCurrency(data?.totalValue || 0)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* By Reason */}
      {data?.byReason && data.byReason.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">التالف حسب السبب</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data.byReason.map(r => (
              <div key={r.reason} className="bg-gray-50 rounded-lg p-4">
                <p className="font-medium text-gray-900">{r.reason}</p>
                <div className="flex justify-between mt-2 text-sm">
                  <span className="text-gray-500">{r.count} سجل</span>
                  <span className="text-red-600 font-medium">{formatCurrency(r.value)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-red-600 text-white">
              <tr>
                <th className="px-4 py-3 text-right text-sm font-medium">رقم السجل</th>
                <th className="px-4 py-3 text-right text-sm font-medium">الفرع</th>
                <th className="px-4 py-3 text-right text-sm font-medium">الصنف</th>
                <th className="px-4 py-3 text-right text-sm font-medium">الكمية</th>
                <th className="px-4 py-3 text-right text-sm font-medium">القيمة</th>
                <th className="px-4 py-3 text-right text-sm font-medium">السبب</th>
                <th className="px-4 py-3 text-right text-sm font-medium">التاريخ</th>
                <th className="px-4 py-3 text-right text-sm font-medium">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data?.damages.map((d, i) => (
                <tr key={d.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-3 font-medium">{d.damage_number}</td>
                  <td className="px-4 py-3">{d.branch}</td>
                  <td className="px-4 py-3">{d.item}</td>
                  <td className="px-4 py-3">{d.quantity}</td>
                  <td className="px-4 py-3 text-red-600">{formatCurrency(d.estimated_value)}</td>
                  <td className="px-4 py-3">{d.reason}</td>
                  <td className="px-4 py-3">{formatDate(d.created_at)}</td>
                  <td className="px-4 py-3">{getStatusBadge(d.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(!data?.damages || data.damages.length === 0) && (
          <div className="text-center py-12 text-gray-500">لا توجد سجلات تالف في هذه الفترة</div>
        )}
      </div>
    </div>
  )
}
