import { supabase } from '../lib/supabase'

export interface Notification {
  id: string
  user_id: string | null
  branch_id: string | null
  type: string
  title: string
  message: string
  priority: string
  reference_type: string | null
  reference_id: string | null
  is_read: boolean
  read_at: string | null
  created_at: string
  expires_at: string | null
}

export const notificationsService = {
  async getUnread(userId: string, branchId?: string) {
    let query = supabase
      .from('notifications')
      .select('*')
      .eq('is_read', false)
      .or(`user_id.eq.${userId},user_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(20)

    if (branchId) {
      query = query.or(`branch_id.eq.${branchId},branch_id.is.null`)
    }

    const { data, error } = await query
    return { data: data as Notification[], error }
  },

  async getAll(userId: string, branchId?: string, limit = 50) {
    let query = supabase
      .from('notifications')
      .select('*')
      .or(`user_id.eq.${userId},user_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (branchId) {
      query = query.or(`branch_id.eq.${branchId},branch_id.is.null`)
    }

    const { data, error } = await query
    return { data: data as Notification[], error }
  },

  async markAsRead(notificationId: string) {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId)
    return { error }
  },

  async markAllAsRead(userId: string) {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .or(`user_id.eq.${userId},user_id.is.null`)
      .eq('is_read', false)
    return { error }
  },

  async getUnreadCount(userId: string, branchId?: string) {
    let query = supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false)
      .or(`user_id.eq.${userId},user_id.is.null`)

    if (branchId) {
      query = query.or(`branch_id.eq.${branchId},branch_id.is.null`)
    }

    const { count, error } = await query
    return { count: count || 0, error }
  },

  async create(notification: Omit<Notification, 'id' | 'is_read' | 'read_at' | 'created_at'>) {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        ...notification,
        is_read: false,
        created_at: new Date().toISOString(),
      })
      .select()
      .single()
    return { data: data as Notification, error }
  },
}
