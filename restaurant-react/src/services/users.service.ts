import { supabase, fixEncodingInData } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'

// User columns the Users screen shows. Listed explicitly: never password_hash, never users(*).
const USER_COLUMNS =
  'id, employee_code, username, email, full_name, full_name_ar, phone, status, created_at, ' +
  'role:roles(id, name, name_ar), branch:branches(id, name_ar, code)'

export interface UserWithDetails {
  id: string
  employee_code: string | null
  username: string
  email: string
  full_name: string
  full_name_ar: string | null
  phone: string | null
  status: 'active' | 'inactive' | 'suspended'
  created_at: string
  role: { id: string; name: string; name_ar: string } | null
  branch: { id: string; name_ar: string; code: string } | null
}

export interface CreateUserData {
  username: string
  email: string
  password: string
  full_name: string
  full_name_ar: string
  employee_code?: string | null
  phone?: string | null
  role_id: string
  branch_id?: string | null
  status?: 'active' | 'inactive'
  /** POS categories a cashier may sell (empty / omitted = all categories) */
  cashier_category_ids?: string[] | null
}

export interface UpdateUserData {
  email: string
  full_name: string
  full_name_ar: string
  // Always sent: null / '' clears the value
  employee_code: string | null
  phone: string | null
  branch_id: string | null
  role_id: string
  status: 'active' | 'inactive' | 'suspended'
  /** Empty / omitted keeps the current password */
  password?: string
  /** null / omitted leaves the cashier's POS categories as they are; an array replaces them */
  cashier_category_ids?: string[] | null
}

export const usersService = {
  async getAll() {
    try {
      const data = await fetchAll((from, to) =>
        supabase
          .from('users')
          .select(USER_COLUMNS)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to)
      )
      return { data: fixEncodingInData(data) as unknown as UserWithDetails[], error: null }
    } catch (error) {
      return { data: [] as UserWithDetails[], error }
    }
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('users')
      .select(USER_COLUMNS)
      .eq('id', id)
      .single()

    return { data: fixEncodingInData(data) as unknown as UserWithDetails | null, error }
  },

  async getRoles() {
    const { data, error } = await supabase
      .from('roles')
      .select('id, name, name_ar')
      .order('name')

    return { data: fixEncodingInData(data), error }
  },

  // Creates the staff member and their login account (one transaction, admin only)
  async create(userData: CreateUserData) {
    const { data, error } = await supabase.rpc('create_user', {
      p_username: userData.username,
      p_email: userData.email,
      p_password: userData.password,
      p_full_name: userData.full_name,
      p_full_name_ar: userData.full_name_ar,
      p_employee_code: userData.employee_code || null,
      p_phone: userData.phone || null,
      p_role_id: userData.role_id,
      p_branch_id: userData.branch_id || null,
      p_status: userData.status || 'active',
      p_cashier_category_ids: userData.cashier_category_ids ?? null,
    })

    if (error) return { data: null, error }

    // Fetch the created user with relations
    const userId = (data as { id: string }[] | null)?.[0]?.id
    if (userId) {
      return await this.getById(userId)
    }

    return { data: null, error: new Error('تم إنشاء المستخدم لكن تعذر تحميل بياناته، أعد تحميل الصفحة') }
  },

  // Saves the edit form; email/password/status changes also update the login account (admin only)
  async update(id: string, userData: UpdateUserData) {
    const { error } = await supabase.rpc('update_user', {
      p_user_id: id,
      p_email: userData.email,
      p_password: userData.password || null,
      p_full_name: userData.full_name,
      p_full_name_ar: userData.full_name_ar,
      p_employee_code: userData.employee_code || null,
      p_phone: userData.phone || null,
      p_role_id: userData.role_id,
      p_branch_id: userData.branch_id || null,
      p_status: userData.status,
      p_cashier_category_ids: userData.cashier_category_ids ?? null,
    })

    if (error) return { data: null, error }

    // Fetch the updated user with relations
    return await this.getById(id)
  },

  // Deletes the user and their login account; refused for users with recorded work (deactivate them instead)
  async delete(id: string) {
    const { error } = await supabase.rpc('user_delete', { p_user_id: id })
    return { error }
  },

  async checkUsernameExists(username: string, excludeId?: string) {
    let query = supabase
      .from('users')
      .select('id')
      .eq('username', username)

    if (excludeId) {
      query = query.neq('id', excludeId)
    }

    const { data, error } = await query
    return { exists: !!data && data.length > 0, error }
  },

  // Get all active categories
  async getCategories() {
    try {
      const data = await fetchAll((from, to) =>
        supabase
          .from('categories')
          .select('id, code, name, name_ar')
          .eq('is_active', true)
          .order('sort_order')
          .order('id')
          .range(from, to)
      )
      return { data: fixEncodingInData(data), error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  // Get categories assigned to a user
  async getUserCategories(userId: string) {
    const { data, error } = await supabase
      .from('cashier_category_permissions')
      .select('category_id, category:categories(id, code, name_ar)')
      .eq('user_id', userId)

    return { data: fixEncodingInData(data), error }
  },

  // Replace a cashier's POS categories (empty = no restriction)
  async updateUserCategories(userId: string, categoryIds: string[]) {
    const { error } = await supabase.rpc('user_set_category_permissions', {
      p_user_id: userId,
      p_kind: 'cashier',
      p_category_ids: categoryIds,
    })
    return { error }
  },

  // Get categories assigned to a chef user
  async getChefCategories(userId: string) {
    const { data, error } = await supabase
      .from('chef_category_permissions')
      .select('category_id, category:categories(id, code, name_ar)')
      .eq('user_id', userId)

    return { data: fixEncodingInData(data), error }
  },

  // Replace a chef's kitchen categories (empty = no restriction)
  async updateChefCategories(userId: string, categoryIds: string[]) {
    const { error } = await supabase.rpc('user_set_category_permissions', {
      p_user_id: userId,
      p_kind: 'chef',
      p_category_ids: categoryIds,
    })
    return { error }
  },
}
