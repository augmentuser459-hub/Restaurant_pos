import { supabase, fixEncodingInData } from '../lib/supabase'
import { Branch, BranchStatus } from '../types/database.types'

export interface CreateBranchData {
  code: string
  name: string
  name_ar: string
  address?: string
  phone?: string
  email?: string
  status?: BranchStatus
  is_main_warehouse?: boolean
  opening_time?: string
  closing_time?: string
}

export interface UpdateBranchData extends Partial<CreateBranchData> {}

export const branchesService = {
  // Get all branches
  async getAll() {
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .order('created_at', { ascending: false })

    return { data: fixEncodingInData(data) as Branch[], error }
  },

  // Get branch by ID
  async getById(id: string) {
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .eq('id', id)
      .single()

    return { data: fixEncodingInData(data) as Branch, error }
  },

  // Create new branch
  async create(branchData: CreateBranchData) {
    const { data, error } = await supabase
      .from('branches')
      .insert(branchData)
      .select()
      .single()

    return { data: data as Branch, error }
  },

  // Update branch
  async update(id: string, branchData: UpdateBranchData) {
    const { data, error } = await supabase
      .from('branches')
      .update({ ...branchData, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    return { data: data as Branch, error }
  },

  // Delete branch
  async delete(id: string) {
    const { error } = await supabase
      .from('branches')
      .delete()
      .eq('id', id)

    return { error }
  },

  // Get active branches only
  async getActive() {
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .eq('status', 'active')
      .order('name_ar')

    return { data: fixEncodingInData(data) as Branch[], error }
  },

  // Get main warehouse
  async getMainWarehouse() {
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .eq('is_main_warehouse', true)
      .single()

    return { data: fixEncodingInData(data) as Branch, error }
  },

  // Check if code exists
  async codeExists(code: string, excludeId?: string) {
    let query = supabase
      .from('branches')
      .select('id')
      .eq('code', code)

    if (excludeId) {
      query = query.neq('id', excludeId)
    }

    const { data, error } = await query

    return { exists: data && data.length > 0, error }
  },
}
