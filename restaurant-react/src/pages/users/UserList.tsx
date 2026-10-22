import { useEffect, useState } from 'react'
import { useMatch, useNavigate, useParams } from 'react-router-dom'
import { usersService, UserWithDetails } from '../../services/users.service'
import { useAuth } from '../../contexts/AuthContext'
import { toUserMessage } from '../../lib/errors'
import { Users, Mail, Phone, Building2, Shield, CheckCircle, XCircle, Plus, Edit, Trash2 } from 'lucide-react'
import UserFormModal from './UserFormModal'

export default function UserList() {
  const { user: currentUser, refreshProfile } = useAuth()
  const navigate = useNavigate()
  // /users/new and /users/:id/edit open the form directly
  const isNewRoute = useMatch('/users/new') !== null
  const { id: routeEditId } = useParams()

  const [users, setUsers] = useState<UserWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [showModal, setShowModal] = useState(false)
  const [editingUser, setEditingUser] = useState<UserWithDetails | null>(null)
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)

  useEffect(() => {
    fetchUsers()
  }, [])

  // Open the form requested by the URL once the list is loaded
  useEffect(() => {
    if (loading || loadError) return
    if (isNewRoute) {
      setEditingUser(null)
      setShowModal(true)
    } else if (routeEditId) {
      const target = users.find(u => u.id === routeEditId)
      if (target) {
        setEditingUser(target)
        setShowModal(true)
      } else {
        alert('المستخدم غير موجود')
        navigate('/users', { replace: true })
      }
    }
  }, [loading, loadError, isNewRoute, routeEditId])

  const fetchUsers = async () => {
    const { data, error } = await usersService.getAll()
    if (error) {
      setLoadError(toUserMessage(error, 'تعذر تحميل المستخدمين، حاول مرة أخرى'))
    } else {
      setLoadError('')
      setUsers(data || [])
    }
    setLoading(false)
  }

  const handleAddUser = () => {
    setEditingUser(null)
    setShowModal(true)
  }

  const handleEditUser = (user: UserWithDetails) => {
    setEditingUser(user)
    setShowModal(true)
  }

  const handleDeleteUser = async (userId: string) => {
    if (deletingUserId) return
    if (!confirm('هل أنت متأكد من حذف هذا المستخدم؟')) return

    setDeletingUserId(userId)
    try {
      const { error } = await usersService.delete(userId)
      if (error) {
        alert(toUserMessage(error, 'حدث خطأ أثناء حذف المستخدم'))
      } else {
        await fetchUsers()
      }
    } finally {
      setDeletingUserId(null)
    }
  }

  const handleModalClose = async (success: boolean) => {
    const editedSelf = !!editingUser && editingUser.id === currentUser?.id
    setShowModal(false)
    setEditingUser(null)
    if (isNewRoute || routeEditId) {
      navigate('/users', { replace: true })
    }
    if (success) {
      await fetchUsers()
      // The admin edited their own account: refresh the name/branch shown in the app
      if (editedSelf) await refreshProfile()
    }
  }

  const filteredUsers = users.filter(u => 
    filter === 'all' || u.status === filter
  )

  const getRoleBadgeColor = (roleName: string) => {
    const colors: Record<string, string> = {
      admin: 'bg-red-100 text-red-700',
      warehouse_manager: 'bg-blue-100 text-blue-700',
      branch_supervisor: 'bg-green-100 text-green-700',
      cashier: 'bg-yellow-100 text-yellow-700',
      chef: 'bg-orange-100 text-orange-700',
      purchase_manager: 'bg-purple-100 text-purple-700',
    }
    return colors[roleName] || 'bg-gray-100 text-gray-700'
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
          <h1 className="text-2xl font-bold text-gray-900">المستخدمين</h1>
          <p className="text-gray-600">إدارة مستخدمي النظام</p>
        </div>
        <button
          type="button"
          onClick={handleAddUser}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          إضافة مستخدم
        </button>
      </div>

      {loadError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between gap-3">
          <p className="text-red-700 text-sm">{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              fetchUsers()
            }}
            className="px-3 py-1.5 bg-white text-red-700 border border-red-300 rounded-lg hover:bg-red-100 text-sm"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        {(['all', 'active', 'inactive'] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === status
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {status === 'all' ? 'الكل' : status === 'active' ? 'نشط' : 'غير نشط'}
          </button>
        ))}
      </div>

      {/* Users Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredUsers.map((user) => (
          <div key={user.id} className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-medium text-gray-900 truncate">{user.full_name_ar || user.full_name}</h3>
                  {user.status === 'active' ? (
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  )}
                </div>
                <p className="text-sm text-gray-500 mb-2">{user.employee_code}</p>
                
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Mail className="w-4 h-4" />
                    <span className="truncate">{user.email}</span>
                  </div>
                  {user.phone && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Phone className="w-4 h-4" />
                      <span>{user.phone}</span>
                    </div>
                  )}
                  {user.branch && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Building2 className="w-4 h-4" />
                      <span>{user.branch.name_ar}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-gray-400" />
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(user.role?.name || '')}`}>
                    {user.role?.name_ar || user.role?.name}
                  </span>
                </div>

                {/* Action Buttons */}
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleEditUser(user)}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors text-sm"
                  >
                    <Edit className="w-4 h-4" />
                    تعديل
                  </button>
                  {/* An admin can't delete their own account */}
                  {user.id !== currentUser?.id && (
                    <button
                      type="button"
                      onClick={() => handleDeleteUser(user.id)}
                      disabled={deletingUserId !== null}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm disabled:opacity-50"
                    >
                      {deletingUserId === user.id ? (
                        <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4" />
                          حذف
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredUsers.length === 0 && !loadError && (
        <div className="text-center py-12 bg-white rounded-lg shadow-sm">
          <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">لا يوجد مستخدمين</h3>
          <p className="text-gray-600">لم يتم العثور على مستخدمين</p>
        </div>
      )}

      {/* User Form Modal */}
      {showModal && (
        <UserFormModal
          user={editingUser}
          isSelf={!!editingUser && editingUser.id === currentUser?.id}
          onClose={handleModalClose}
        />
      )}
    </div>
  )
}
