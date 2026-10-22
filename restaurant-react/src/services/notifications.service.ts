import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js'
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

// Read state is per user. v_notifications_inbox returns every notification with is_read / read_at of the
// logged-in user (table notification_reads), so one user reading a broadcast does not hide it for anyone else.
// Marking read goes through notification_mark_read / notification_mark_all_read (the caller's own state only).
const INBOX = 'v_notifications_inbox'

/**
 * The notifications a user sees in the bell: addressed to them or to everyone (user_id null), and for
 * their branch or for all branches (branch_id null). A user without a branch (e.g. an admin) sees all branches.
 * Same rule as getUnread, so realtime and the periodic fetch always agree.
 */
export function isNotificationVisibleTo(
  notification: Pick<Notification, 'user_id' | 'branch_id'>,
  userId: string,
  branchId?: string | null,
): boolean {
  if (notification.user_id && notification.user_id !== userId) return false
  if (branchId && notification.branch_id && notification.branch_id !== branchId) return false
  return true
}

let channelSeq = 0

export const notificationsService = {
  async getUnread(userId: string, branchId?: string) {
    let query = supabase
      .from(INBOX)
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
      .from(INBOX)
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

  // Marks one notification read for the logged-in user only
  async markAsRead(notificationId: string) {
    const { error } = await supabase.rpc('notification_mark_read', { p_notification_id: notificationId })
    return { error }
  },

  // 'قراءة الكل': marks read, for the logged-in user only, everything that user sees.
  // The database identifies the user (and branch) from the session; the parameter is kept for existing callers.
  async markAllAsRead(_userId: string) {
    const { error } = await supabase.rpc('notification_mark_all_read')
    return { error }
  },

  async getUnreadCount(userId: string, branchId?: string) {
    let query = supabase
      .from(INBOX)
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
      })
      .select()
      .single()
    return { data: data as Notification, error }
  },

  /**
   * Calls onNew for every new notification the user sees (isNotificationVisibleTo), each one once.
   * The subscription is filtered on the server to the user's branch and to rows addressed to the user
   * (no filter for a user without a branch). Notifications for all branches at once (branch_id null)
   * arrive with the next getUnread poll. Returns the unsubscribe function (call it on unmount).
   */
  subscribeToNew(userId: string, branchId: string | null | undefined, onNew: (notification: Notification) => void) {
    channelSeq += 1
    const channel = supabase.channel(`notifications-${userId}-${channelSeq}-${Date.now()}`)
    const seen = new Set<string>()
    const handle = (payload: RealtimePostgresInsertPayload<Record<string, unknown>>) => {
      const notification = payload.new as unknown as Notification
      if (!notification?.id || seen.has(notification.id)) return
      if (!isNotificationVisibleTo(notification, userId, branchId)) return
      seen.add(notification.id)
      onNew({ ...notification, is_read: false, read_at: null })
    }

    const base = { event: 'INSERT' as const, schema: 'public', table: 'notifications' }
    if (branchId) {
      channel.on('postgres_changes', { ...base, filter: `branch_id=eq.${branchId}` }, handle)
      channel.on('postgres_changes', { ...base, filter: `user_id=eq.${userId}` }, handle)
    } else {
      channel.on('postgres_changes', base, handle)
    }
    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  },
}
