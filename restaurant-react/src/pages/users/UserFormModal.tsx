import { useState, useEffect } from 'react'
import { X, Eye, EyeOff } from 'lucide-react'
import { usersService, UserWithDetails, CreateUserData, UpdateUserData } from '../../services/users.service'
import { branchesService } from '../../services/branches.service'
import { toUserMessage } from '../../lib/errors'

interface UserFormModalProps {
  user: UserWithDetails | null
  /** The signed-in admin is editing their own account (role and status can't be changed) */
  isSelf?: boolean
  onClose: (success: boolean) => void
}

// Typing only the name part (e.g. "casher5") gives "casher5@restaurant.com"
const DEFAULT_EMAIL_DOMAIN = '@restaurant.com'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Same limits as the database (010_auth.sql) and Supabase Auth
const MIN_PASSWORD_LENGTH = 6
const MAX_PASSWORD_BYTES = 72

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase()
  return email && !email.includes('@') ? email + DEFAULT_EMAIL_DOMAIN : email
}

interface Role {
  id: string
  name: string
  name_ar: string
}

interface Branch {
  id: string
  name_ar: string
  code: string
}

interface Category {
  id: string
  name_ar: string
  code: string
}

export default function UserFormModal({ user, isSelf = false, onClose }: UserFormModalProps) {
  const [loading, setLoading] = useState(false)
  const [roles, setRoles] = useState<Role[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  // The edited user's saved POS categories: until they are loaded the form must not overwrite them
  const [userCategoriesState, setUserCategoriesState] = useState<'loading' | 'loaded' | 'failed'>(user ? 'loading' : 'loaded')
  const [showPassword, setShowPassword] = useState(false)
  const [loadError, setLoadError] = useState('')

  const [formData, setFormData] = useState({
    username: user?.username || '',
    email: user?.email || '',
    password: '',
    full_name: user?.full_name || '',
    full_name_ar: user?.full_name_ar || '',
    employee_code: user?.employee_code || '',
    phone: user?.phone || '',
    role_id: user?.role?.id || '',
    branch_id: user?.branch?.id || '',
    status: user?.status || 'active',
  })

  useEffect(() => {
    fetchRolesAndBranches()
    fetchCategories()
    if (user) {
      fetchUserCategories()
    }
  }, [])

  const fetchRolesAndBranches = async () => {
    const [rolesRes, branchesRes] = await Promise.all([
      usersService.getRoles(),
      branchesService.getActive()
    ])

    if (rolesRes.error || branchesRes.error) {
      setLoadError(toUserMessage(rolesRes.error || branchesRes.error, 'تعذر تحميل الأدوار والفروع، أغلق النافذة وحاول مرة أخرى'))
    }
    setRoles((rolesRes.data as Role[] | null) || [])
    const branchList = ((branchesRes.data as Branch[] | null) || []).slice()
    // Keep the user's current branch selectable even if it is no longer active
    if (user?.branch && !branchList.some(b => b.id === user.branch?.id)) {
      branchList.push(user.branch)
    }
    setBranches(branchList)
  }

  const fetchCategories = async () => {
    const { data, error } = await usersService.getCategories()
    if (error) {
      setLoadError(toUserMessage(error, 'تعذر تحميل المجموعات، أغلق النافذة وحاول مرة أخرى'))
      return
    }
    setCategories((data as Category[] | null) || [])
  }

  const fetchUserCategories = async () => {
    if (!user) return
    const { data, error } = await usersService.getUserCategories(user.id)
    if (error) {
      setLoadError(toUserMessage(error, 'تعذر تحميل مجموعات الكاشير، أغلق النافذة وحاول مرة أخرى'))
      setUserCategoriesState('failed')
      return
    }
    setSelectedCategories(((data as { category_id: string }[] | null) || []).map(c => c.category_id))
    setUserCategoriesState('loaded')
  }

  const handleCategoryToggle = (categoryId: string) => {
    setSelectedCategories(prev => 
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    )
  }

  const selectedRole = roles.find(r => r.id === formData.role_id)
  // Only admin and purchase_manager don't need a branch
  // Everyone else (including warehouse_manager) needs to be assigned to a branch/warehouse
  const needsBranch = !!selectedRole && !['admin', 'purchase_manager'].includes(selectedRole.name)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return

    const email = normalizeEmail(formData.email)
    const password = formData.password

    // Validation
    if (!user && !formData.username.trim()) {
      alert('يرجى إدخال اسم المستخدم')
      return
    }

    if (!EMAIL_PATTERN.test(email)) {
      alert('يرجى إدخال بريد إلكتروني صحيح، مثل name@restaurant.com')
      return
    }

    if (!user && !password) {
      alert('يرجى إدخال كلمة المرور')
      return
    }

    if (password && password.length < MIN_PASSWORD_LENGTH) {
      alert(`كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل`)
      return
    }

    if (password && new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
      alert('كلمة المرور طويلة جداً')
      return
    }

    if (!formData.full_name.trim() || !formData.full_name_ar.trim()) {
      alert('يرجى إدخال الاسم بالعربي والإنجليزي')
      return
    }

    if (!formData.role_id || !selectedRole) {
      alert('يرجى اختيار الدور الوظيفي')
      return
    }

    if (needsBranch && !formData.branch_id) {
      alert(selectedRole.name === 'warehouse_manager' ? 'يرجى اختيار المستودع' : 'يرجى اختيار الفرع')
      return
    }

    // Roles without a branch never keep an old one; blank optional fields are cleared
    const branchId = needsBranch ? formData.branch_id : null
    const employeeCode = formData.employee_code.trim() || null
    const phone = formData.phone.trim() || null
    // Cashier POS categories are saved in the same request; for other roles, or when the saved set could not be
    // loaded, they are left untouched (an empty list would remove all of the cashier's restrictions)
    const cashierCategoryIds = selectedRole.name === 'cashier' && userCategoriesState === 'loaded' ? selectedCategories : null

    setLoading(true)

    try {
      if (user) {
        // Update existing user
        const updateData: UpdateUserData = {
          email,
          full_name: formData.full_name.trim(),
          full_name_ar: formData.full_name_ar.trim(),
          employee_code: employeeCode,
          phone,
          role_id: formData.role_id,
          branch_id: branchId,
          status: formData.status,
          cashier_category_ids: cashierCategoryIds,
        }

        // Only include password if it was changed
        if (password) {
          updateData.password = password
        }

        const { error } = await usersService.update(user.id, updateData)

        if (error) {
          alert(toUserMessage(error, 'حدث خطأ أثناء تحديث المستخدم'))
          return
        }
      } else {
        // Create new user (and their login account)
        const createData: CreateUserData = {
          username: formData.username.trim(),
          email,
          password,
          full_name: formData.full_name.trim(),
          full_name_ar: formData.full_name_ar.trim(),
          employee_code: employeeCode,
          phone,
          role_id: formData.role_id,
          branch_id: branchId,
          status: formData.status === 'inactive' ? 'inactive' : 'active',
          cashier_category_ids: cashierCategoryIds,
        }

        const { error } = await usersService.create(createData)

        if (error) {
          alert(toUserMessage(error, 'حدث خطأ أثناء إضافة المستخدم'))
          return
        }
      }

      onClose(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">
            {user ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}
          </h2>
          <button
            type="button"
            onClick={() => onClose(false)}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
            title="إغلاق"
            aria-label="إغلاق"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {loadError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{loadError}</div>
          )}

          {/* Username (only for new users) */}
          {!user && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                اسم المستخدم <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="username"
                required
              />
            </div>
          )}

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              البريد الإلكتروني <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              inputMode="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="name@restaurant.com"
              autoComplete="off"
              dir="ltr"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              يُستخدم لتسجيل الدخول. إذا كتبت الاسم فقط ستتم إضافة {DEFAULT_EMAIL_DOMAIN} تلقائياً.
            </p>
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {user ? 'كلمة المرور الجديدة (اتركها فارغة إذا لم ترد التغيير)' : 'كلمة المرور'} 
              {!user && <span className="text-red-500">*</span>}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
                autoComplete="new-password"
                dir="ltr"
                required={!user}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {MIN_PASSWORD_LENGTH} أحرف على الأقل. يمكن للموظف تغييرها بعد الدخول من قائمة المستخدم.
            </p>
            {user && (
              <p className="text-xs text-gray-500 mt-1">
                ملاحظة: كلمات المرور مشفرة ولا يمكن عرضها. اترك الحقل فارغاً للاحتفاظ بكلمة المرور الحالية.
              </p>
            )}
          </div>

          {/* Full Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                الاسم بالعربي <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.full_name_ar}
                onChange={(e) => setFormData({ ...formData, full_name_ar: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="محمد أحمد"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                الاسم بالإنجليزي <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Mohamed Ahmed"
                required
              />
            </div>
          </div>

          {/* Employee Code & Phone */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                كود الموظف
              </label>
              <input
                type="text"
                value={formData.employee_code}
                onChange={(e) => setFormData({ ...formData, employee_code: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="EMP001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                رقم الهاتف
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0501234567"
              />
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              الدور الوظيفي <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.role_id}
              onChange={(e) => setFormData({ ...formData, role_id: e.target.value, branch_id: '' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              disabled={isSelf}
              required
            >
              <option value="">اختر الدور</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name_ar} ({role.name})
                </option>
              ))}
            </select>
            {isSelf && (
              <p className="text-xs text-gray-500 mt-1">لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك</p>
            )}
          </div>

          {/* Branch (conditional) */}
          {needsBranch && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {selectedRole?.name === 'warehouse_manager' ? 'المستودع' : 'الفرع'} <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.branch_id}
                onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="">{selectedRole?.name === 'warehouse_manager' ? 'اختر المستودع' : 'اختر الفرع'}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name_ar} ({branch.code})
                  </option>
                ))}
              </select>
              {selectedRole?.name === 'warehouse_manager' && (
                <p className="text-xs text-gray-500 mt-1">
                  اختر المستودع الذي سيكون مسؤولاً عنه
                </p>
              )}
            </div>
          )}

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              الحالة
            </label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              disabled={isSelf}
            >
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
              {formData.status === 'suspended' && <option value="suspended">موقوف</option>}
            </select>
            <p className="text-xs text-gray-500 mt-1">الموظف غير النشط لا يستطيع تسجيل الدخول</p>
          </div>

          {/* Category Permissions (only for cashiers) */}
          {selectedRole?.name === 'cashier' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                المجموعات المسموح بها في نقطة البيع
              </label>
              <p className="text-xs text-gray-500 mb-3">
                اختر المجموعات التي يمكن للكاشير رؤيتها. إذا لم تختر أي مجموعة، سيتمكن من رؤية جميع المجموعات.
              </p>
              {userCategoriesState === 'failed' && (
                <p className="text-xs text-red-600 mb-3">
                  تعذر تحميل المجموعات المحفوظة لهذا الكاشير، لذلك لن يتم تغييرها عند الحفظ.
                </p>
              )}
              <div className="border border-gray-300 rounded-lg p-4 max-h-48 overflow-y-auto space-y-2">
                {userCategoriesState === 'loading' ? (
                  <p className="text-sm text-gray-500 text-center py-2">جاري تحميل المجموعات...</p>
                ) : categories.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-2">لا توجد مجموعات</p>
                ) : (
                  categories.map(category => (
                    <label
                      key={category.id}
                      className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCategories.includes(category.id)}
                        onChange={() => handleCategoryToggle(category.id)}
                        disabled={userCategoriesState !== 'loaded'}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-900">
                        {category.name_ar} <span className="text-gray-500">({category.code})</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              // Wait for the role list (until then the role can't be validated) and the user's saved categories
              disabled={loading || roles.length === 0 || userCategoriesState === 'loading'}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'جاري الحفظ...' : user ? 'تحديث' : 'إضافة'}
            </button>
            <button
              type="button"
              onClick={() => onClose(false)}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
