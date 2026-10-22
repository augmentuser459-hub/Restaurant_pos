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

export interface UpdateBranchData extends Partial<CreateBranchData> {
  /** Moving the main warehouse: untick the current one in the same save (asked for after the user confirms) */
  replace_main_warehouse?: boolean
}

// Optional text and TIME columns: an empty input is stored as NULL ('' is not a valid time)
const OPTIONAL_FIELDS = ['address', 'phone', 'email', 'opening_time', 'closing_time'] as const

function toSaveData(branchData: UpdateBranchData): Record<string, unknown> {
  const data: Record<string, unknown> = { ...branchData }
  for (const field of OPTIONAL_FIELDS) {
    if (field in data) {
      const value = typeof data[field] === 'string' ? (data[field] as string).trim() : data[field]
      data[field] = value ? value : null
    }
  }
  return data
}

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

  /** Creates (id null) or updates a branch in one database call. Returns the branch id. */
  async save(id: string | null, branchData: UpdateBranchData) {
    const { data, error } = await supabase.rpc('inv_branch_save', { p_branch_id: id, p_branch: toSaveData(branchData) })
    return { data: data as string | null, error }
  },

  // Create new branch
  async create(branchData: CreateBranchData) {
    return this.save(null, branchData)
  },

  // Update branch
  async update(id: string, branchData: UpdateBranchData) {
    return this.save(id, branchData)
  },

  // Delete branch (refused for the main warehouse, a branch with stock, or one with history)
  async delete(id: string) {
    const { error } = await supabase.rpc('inv_branch_delete', { p_branch_id: id })
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

  // Get main warehouse (at most one: unique index branches_one_main_warehouse)
  async getMainWarehouse() {
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .eq('is_main_warehouse', true)
      .maybeSingle()

    return { data: fixEncodingInData(data) as Branch | null, error }
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

    return { exists: Boolean(data && data.length > 0), error }
  },
}
