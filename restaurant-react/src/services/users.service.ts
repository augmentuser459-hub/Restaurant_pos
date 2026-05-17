import { supabase, fixEncodingInData } from '../lib/supabase'

export interface UserWithDetails {
  id: string
  employee_code: string
  username: string
  email: string
  full_name: string
  full_name_ar: string
  phone: string | null
  status: 'active' | 'inactive'
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
  employee_code?: string
  phone?: string
  role_id: string
  branch_id?: string | null
  status?: 'active' | 'inactive'
}

export interface UpdateUserData {
  email?: string
  full_name?: string
  full_name_ar?: string
  employee_code?: string
  phone?: string
  role_id?: string
  branch_id?: string | null
  status?: 'active' | 'inactive'
  password?: string
}

export const usersService = {
  async getAll() {
    const { data, error } = await supabase
      .from('users')
      .select('*, role:roles(id, name, name_ar), branch:branches(id, name_ar, code)')
      .order('created_at', { ascending: false })

    return { data: fixEncodingInData(data) as UserWithDetails[], error }
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('users')
      .select('*, role:roles(id, name, name_ar), branch:branches(id, name_ar, code)')
      .eq('id', id)
      .single()

    return { data: fixEncodingInData(data) as UserWithDetails, error }
  },

  async getRoles() {
    const { data, error } = await supabase
      .from('roles')
      .select('*')
      .order('name')

    return { data: fixEncodingInData(data), error }
  },

  async create(userData: CreateUserData) {
    // Use RPC function to create user with hashed password
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
    })

    if (error) return { data: null, error }

    // Fetch the created user with relations
    const userId = data?.[0]?.id
    if (userId) {
      return await this.getById(userId)
    }

    return { data: null, error: new Error('User created but could not fetch details') }
  },

  async update(id: string, userData: UpdateUserData) {
    // Use RPC function to update user with optional password hashing
    const { data, error } = await supabase.rpc('update_user', {
      p_user_id: id,
      p_email: userData.email || null,
      p_password: userData.password || null,
      p_full_name: userData.full_name || null,
      p_full_name_ar: userData.full_name_ar || null,
      p_employee_code: userData.employee_code || null,
      p_phone: userData.phone || null,
      p_role_id: userData.role_id || null,
      p_branch_id: userData.branch_id || null,
      p_status: userData.status || null,
    })

    if (error) return { data: null, error }

    // Fetch the updated user with relations
    return await this.getById(id)
  },

  async delete(id: string) {
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id)

    return { error }
  },

  async updateStatus(id: string, status: 'active' | 'inactive') {
    const { data, error } = await supabase
      .from('users')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    return { data, error }
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
    return { exists: data && data.length > 0, error }
  },

  // Get all active categories
  async getCategories() {
    const { data, error } = await supabase
      .from('categories')
      .select('id, code, name, name_ar')
      .eq('is_active', true)
      .order('sort_order')

    return { data: fixEncodingInData(data), error }
  },

  // Get categories assigned to a user
  async getUserCategories(userId: string) {
    const { data, error } = await supabase
      .from('cashier_category_permissions')
      .select('category_id, category:categories(id, code, name_ar)')
      .eq('user_id', userId)

    return { data: fixEncodingInData(data), error }
  },

  // Update user category permissions
  async updateUserCategories(userId: string, categoryIds: string[]) {
    // First, delete existing permissions
    await supabase
      .from('cashier_category_permissions')
      .delete()
      .eq('user_id', userId)

    // If no categories selected, user can see all (no restrictions)
    if (categoryIds.length === 0) {
      return { error: null }
    }

    // Insert new permissions
    const permissions = categoryIds.map(categoryId => ({
      user_id: userId,
      category_id: categoryId
    }))

    const { error } = await supabase
      .from('cashier_category_permissions')
      .insert(permissions)

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

  // Update chef category permissions
  async updateChefCategories(userId: string, categoryIds: string[]) {
    // First, delete existing permissions
    await supabase
      .from('chef_category_permissions')
      .delete()
      .eq('user_id', userId)

    // If no categories selected, chef can see all (no restrictions)
    if (categoryIds.length === 0) {
      return { error: null }
    }

    // Insert new permissions
    const permissions = categoryIds.map(categoryId => ({
      user_id: userId,
      category_id: categoryId
    }))

    const { error } = await supabase
      .from('chef_category_permissions')
      .insert(permissions)

    return { error }
  },
}
