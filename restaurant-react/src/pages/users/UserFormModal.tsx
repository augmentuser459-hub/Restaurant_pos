import { useState, useEffect } from 'react'
import { X, Eye, EyeOff } from 'lucide-react'
import { usersService, UserWithDetails, CreateUserData, UpdateUserData } from '../../services/users.service'
import { branchesService } from '../../services/branches.service'

interface UserFormModalProps {
  user: UserWithDetails | null
  onClose: (success: boolean) => void
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

export default function UserFormModal({ user, onClose }: UserFormModalProps) {
  const [loading, setLoading] = useState(false)
  const [roles, setRoles] = useState<Role[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [showPassword, setShowPassword] = useState(false)
  
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
    
    setRoles(rolesRes.data || [])
    setBranches(branchesRes.data || [])
  }

  const fetchCategories = async () => {
    const { data, error } = await usersService.getCategories()
    if (!error && data) {
      setCategories(data)
    }
  }

  const fetchUserCategories = async () => {
    if (!user) return
    const { data, error } = await usersService.getUserCategories(user.id)
    if (!error && data) {
      setSelectedCategories(data.map((c: any) => c.category_id))
    }
  }

  const handleCategoryToggle = (categoryId: string) => {
    setSelectedCategories(prev => 
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validation
    if (!formData.username.trim()) {
      alert('يرجى إدخال اسم المستخدم')
      return
    }

    if (!formData.email.includes('@restaurant.com')) {
      alert('البريد الإلكتروني يجب أن ينتهي بـ @restaurant.com')
      return
    }

    if (!user && !formData.password) {
      alert('يرجى إدخال كلمة المرور')
      return
    }

    if (!formData.full_name.trim() || !formData.full_name_ar.trim()) {
      alert('يرجى إدخال الاسم بالعربي والإنجليزي')
      return
    }

    if (!formData.role_id) {
      alert('يرجى اختيار الدور الوظيفي')
      return
    }

    setLoading(true)

    try {
      if (user) {
        // Update existing user
        const updateData: UpdateUserData = {
          email: formData.email,
          full_name: formData.full_name,
          full_name_ar: formData.full_name_ar,
          employee_code: formData.employee_code || undefined,
          phone: formData.phone || undefined,
          role_id: formData.role_id,
          branch_id: formData.branch_id || null,
          status: formData.status as 'active' | 'inactive',
        }

        // Only include password if it was changed
        if (formData.password) {
          updateData.password = formData.password
        }

        const { error } = await usersService.update(user.id, updateData)
        
        if (error) {
          alert('حدث خطأ أثناء تحديث المستخدم')
          console.error(error)
          return
        }

        // Update category permissions if cashier
        if (selectedRole?.name === 'cashier') {
          await usersService.updateUserCategories(user.id, selectedCategories)
        }
      } else {
        // Create new user
        const createData: CreateUserData = {
          username: formData.username,
          email: formData.email,
          password: formData.password,
          full_name: formData.full_name,
          full_name_ar: formData.full_name_ar,
          employee_code: formData.employee_code || undefined,
          phone: formData.phone || undefined,
          role_id: formData.role_id,
          branch_id: formData.branch_id || null,
          status: formData.status as 'active' | 'inactive',
        }

        const { data: newUser, error } = await usersService.create(createData)
        
        if (error) {
          alert('حدث خطأ أثناء إضافة المستخدم')
          console.error(error)
          return
        }

        // Set category permissions if cashier
        if (selectedRole?.name === 'cashier' && newUser) {
          await usersService.updateUserCategories(newUser.id, selectedCategories)
        }
      }

      onClose(true)
    } finally {
      setLoading(false)
    }
  }

  const selectedRole = roles.find(r => r.id === formData.role_id)
  // Only admin and purchase_manager don't need a branch
  // Everyone else (including warehouse_manager) needs to be assigned to a branch/warehouse
  const needsBranch = selectedRole && !['admin', 'purchase_manager'].includes(selectedRole.name)

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">
            {user ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}
          </h2>
          <button
            onClick={() => onClose(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
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
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.email.replace('@restaurant.com', '')}
                onChange={(e) => setFormData({ ...formData, email: e.target.value + '@restaurant.com' })}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="username"
                required
              />
              <div className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-600">
                @restaurant.com
              </div>
            </div>
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
                required={!user}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              <option value="">اختر الدور</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name_ar} ({role.name})
                </option>
              ))}
            </select>
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
            </select>
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
              <div className="border border-gray-300 rounded-lg p-4 max-h-48 overflow-y-auto space-y-2">
                {categories.length === 0 ? (
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
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'جاري الحفظ...' : user ? 'تحديث' : 'إضافة'}
            </button>
            <button
              type="button"
              onClick={() => onClose(false)}
              className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
