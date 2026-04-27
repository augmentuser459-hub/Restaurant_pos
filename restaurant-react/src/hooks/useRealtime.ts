import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { RealtimeChannel } from '@supabase/supabase-js'

type PostgresChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

interface UseRealtimeOptions {
  table: string
  schema?: string
  event?: PostgresChangeEvent
  filter?: string
  onInsert?: (payload: Record<string, unknown>) => void
  onUpdate?: (payload: Record<string, unknown>) => void
  onDelete?: (payload: Record<string, unknown>) => void
}

interface RealtimePayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

/**
 * Hook for subscribing to Supabase real-time changes
 * @param options - Configuration options for the subscription
 * @returns Object with subscription status and data
 */
export function useRealtime(options: UseRealtimeOptions) {
  const { table, schema = 'public', event = '*', filter, onInsert, onUpdate, onDelete } = options
  const [isConnected, setIsConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<RealtimePayload | null>(null)

  useEffect(() => {
    let channel: RealtimeChannel

    const setupSubscription = () => {
      channel = supabase.channel(`${table}-changes`)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const channelWithChanges = channel as any
      channelWithChanges
        .on(
          'postgres_changes',
          {
            event,
            schema,
            table,
            ...(filter && { filter })
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            const typedPayload = payload as RealtimePayload
            setLastEvent(typedPayload)

            switch (typedPayload.eventType) {
              case 'INSERT':
                onInsert?.(typedPayload.new)
                break
              case 'UPDATE':
                onUpdate?.(typedPayload.new)
                break
              case 'DELETE':
                onDelete?.(typedPayload.old)
                break
            }
          }
        )
        .subscribe((status: string) => {
          setIsConnected(status === 'SUBSCRIBED')
        })
    }

    setupSubscription()

    return () => {
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [table, schema, event, filter, onInsert, onUpdate, onDelete])

  return { isConnected, lastEvent }
}

/**
 * Hook for subscribing to orders in real-time (for kitchen display)
 */
export function useRealtimeOrders(branchId?: string) {
  const [orders, setOrders] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  const fetchOrders = useCallback(async () => {
    let query = supabase
      .from('orders')
      .select('*, items:order_items(*, item:items(name_ar))')
      .in('status', ['paid', 'in_kitchen', 'preparing'])
      .order('created_at', { ascending: true })

    if (branchId) {
      query = query.eq('branch_id', branchId)
    }

    const { data } = await query
    setOrders(data || [])
    setLoading(false)
  }, [branchId])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  const handleInsert = useCallback(() => {
    fetchOrders()
  }, [fetchOrders])

  const handleUpdate = useCallback(() => {
    fetchOrders()
  }, [fetchOrders])

  useRealtime({
    table: 'orders',
    event: '*',
    onInsert: handleInsert,
    onUpdate: handleUpdate,
  })

  return { orders, loading, refetch: fetchOrders }
}

export default useRealtime
