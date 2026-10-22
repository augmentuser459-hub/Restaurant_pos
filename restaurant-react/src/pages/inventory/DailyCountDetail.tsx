import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, Building2, ClipboardList, Send, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { dailyCountService, DailyCountWithDetails } from '../../services/dailyCount.service'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate, formatDateTime, formatQuantity, getStatusColor, roundQuantity } from '../../lib/utils'
import { toUserMessage } from '../../lib/errors'
import { countStatusLabel, displayCode, roleName, unitLabel } from './stockHelpers'

// Who may submit / approve / reject (the database also limits a branch supervisor to their own branch)
const COUNT_MANAGER_ROLES = ['admin', 'warehouse_manager', 'branch_supervisor']

export default function DailyCountDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const canManage = COUNT_MANAGER_ROLES.includes(roleName(user?.role) || '')

  const [count, setCount] = useState<DailyCountWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (id) fetchCount(id)
  }, [id])

  const fetchCount = async (countId: string) => {
    setLoading(true)
    const { data, error: loadError } = await dailyCountService.getById(countId)
    if (loadError) setError('تعذر تحميل الجرد: ' + toUserMessage(loadError))
    else if (!data) setError('الجرد غير موجود')
    setCount(data)
    setLoading(false)
  }

  const runAction = async (action: () => Promise<{ error: unknown }>, success: string) => {
    if (!id || busy) return
    setBusy(true)
    setError('')
    const { error: actionError } = await action()
    setBusy(false)
    if (actionError) {
      alert('فشلت العملية: ' + toUserMessage(actionError))
    } else {
      alert(success)
    }
    await fetchCount(id)
  }

  const handleSubmit = () => {
    if (!id || !confirm('إرسال الجرد للاعتماد؟ لن يمكن تعديله بعد ذلك.')) return
    runAction(() => dailyCountService.submit(id), 'تم إرسال الجرد للاعتماد')
  }

  const handleApprove = async () => {
    if (!id || !count || busy) return
    const changed = count.items.filter(i => Number(i.actual_quantity) !== Number(i.system_quantity)).length
    if (!confirm(`اعتماد الجرد؟\nسيتم تعديل رصيد ${changed} صنف في ${count.branch?.name_ar || 'الفرع'} بمقدار الفرق بين الكمية الفعلية وكمية النظام، وتسجيلها كتسوية مخزون.`)) return
    setBusy(true)
    setError('')
    const { data: adjusted, error: approveError } = await dailyCountService.approve(id)
    setBusy(false)
    if (approveError) {
      alert('فشل اعتماد الجرد ولم يتغير المخزون: ' + toUserMessage(approveError))
    } else {
      alert(`تم اعتماد الجرد وتعديل رصيد ${adjusted ?? 0} صنف`)
    }
    await fetchCount(id)
  }

  const handleReject = () => {
    if (!id) return
    const reason = prompt('سبب رفض الجرد (اختياري):')
    if (reason === null) return
    runAction(() => dailyCountService.reject(id, reason), 'تم رفض الجرد، ولم يتغير المخزون')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!count) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-8 text-center">
        <p className="text-red-600 mb-4">{error || 'الجرد غير موجود'}</p>
        <Link to="/inventory/daily-count" className="text-blue-600 hover:underline">العودة لسجلات الجرد</Link>
      </div>
    )
  }

  const variances = count.items.map(i => roundQuantity(Number(i.actual_quantity) - Number(i.system_quantity)))
  const totalVariance = roundQuantity(variances.reduce((sum, v) => sum + v, 0))
  const itemsWithVariance = variances.filter(v => v !== 0).length
  const userName = (u?: { full_name: string; full_name_ar?: string | null } | null) => u?.full_name_ar || u?.full_name || '-'

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/inventory/daily-count" className="p-2 hover:bg-gray-100 rounded-lg" title="رجوع">
          <ArrowRight className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">
            تفاصيل الجرد {count.count_type === 'opening' ? 'الافتتاحي' : 'الختامي'}
          </h1>
          <p className="text-gray-600">{formatDate(count.count_date)}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(count.status)}`}>
          {countStatusLabel(count.status)}
        </span>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div className="flex items-center gap-2 text-gray-700">
          <Building2 className="w-4 h-4" />
          <span>{count.branch?.name_ar || '-'}</span>
        </div>
        <div><span className="text-gray-500">بواسطة: </span>{userName(count.counted_by_user)}</div>
        <div><span className="text-gray-500">تاريخ التسجيل: </span>{formatDateTime(count.created_at)}</div>
        {count.submitted_at && <div><span className="text-gray-500">أُرسل للاعتماد: </span>{formatDateTime(count.submitted_at)}</div>}
        {count.approved_at && (
          <div><span className="text-gray-500">اعتمده: </span>{userName(count.approved_by_user)} - {formatDateTime(count.approved_at)}</div>
        )}
        {count.notes && <div className="md:col-span-3"><span className="text-gray-500">ملاحظات: </span>{count.notes}</div>}
      </div>

      <div className="bg-blue-50 rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-6 h-6 text-blue-600" />
          <div>
            <p className="font-medium text-gray-900">{count.items.length} صنف</p>
            <p className="text-sm text-gray-600">{itemsWithVariance} صنف بفرق</p>
          </div>
        </div>
        <div className={`text-lg font-bold ${totalVariance === 0 ? 'text-green-600' : totalVariance > 0 ? 'text-blue-600' : 'text-red-600'}`}>
          {totalVariance > 0 ? '+' : ''}{formatQuantity(totalVariance)} فرق إجمالي
        </div>
      </div>

      {canManage && (count.status === 'draft' || count.status === 'completed') && (
        <div className="flex flex-wrap items-center gap-3">
          {count.status === 'draft' && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="w-5 h-5" />
              إرسال للاعتماد
            </button>
          )}
          {count.status === 'completed' && (
            <button
              type="button"
              onClick={handleApprove}
              disabled={busy}
              className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircle className="w-5 h-5" />
              اعتماد وتسوية المخزون
            </button>
          )}
          <button
            type="button"
            onClick={handleReject}
            disabled={busy}
            className="flex items-center gap-2 px-5 py-2 bg-white text-red-600 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50"
          >
            <XCircle className="w-5 h-5" />
            رفض الجرد
          </button>
          {busy && <span className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-right py-3 px-3 text-sm font-medium text-gray-700">الكود</th>
              <th className="text-right py-3 px-3 text-sm font-medium text-gray-700">الصنف</th>
              <th className="text-right py-3 px-3 text-sm font-medium text-gray-700">الوحدة</th>
              <th className="text-right py-3 px-3 text-sm font-medium text-gray-700">الكمية بالنظام</th>
              <th className="text-right py-3 px-3 text-sm font-medium text-gray-700">الكمية الفعلية</th>
              <th className="text-right py-3 px-3 text-sm font-medium text-gray-700">الفرق</th>
              <th className="text-right py-3 px-3 text-sm font-medium text-gray-700">سبب الفرق</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {count.items.map((line, index) => {
              const variance = variances[index]
              return (
                <tr key={line.id} className={variance !== 0 ? 'bg-yellow-50' : ''}>
                  <td className="py-2 px-3 text-sm text-gray-600" dir="ltr">{displayCode(line.item?.code) || '-'}</td>
                  <td className="py-2 px-3 font-medium text-gray-900">{line.item?.name_ar || '-'}</td>
                  <td className="py-2 px-3 text-sm text-gray-600">{unitLabel(line.item?.unit)}</td>
                  <td className="py-2 px-3 text-sm text-gray-600">{formatQuantity(line.system_quantity)}</td>
                  <td className="py-2 px-3 text-sm text-gray-900">{formatQuantity(line.actual_quantity)}</td>
                  <td className={`py-2 px-3 text-sm font-medium ${variance === 0 ? 'text-green-600' : variance > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                    {variance > 0 ? '+' : ''}{formatQuantity(variance)}
                  </td>
                  <td className="py-2 px-3 text-sm text-gray-600">{line.variance_reason || '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {count.items.length === 0 && <p className="text-center text-gray-500 py-8">لا توجد أصناف في هذا الجرد</p>}
      </div>
    </div>
  )
}
