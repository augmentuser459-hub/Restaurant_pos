import { useEffect, useRef, useState } from 'react'
import type { RealtimePostgresChangesFilter, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE'
type Row = Record<string, unknown>

interface UseRealtimeOptions {
  table: string
  schema?: string
  events?: ChangeEvent[]
  // PostgREST-style filter, e.g. `branch_id=eq.<uuid>`. Use it whenever the screen only needs part of the table.
  filter?: string
  // false = do not subscribe (e.g. while the branch is not known yet)
  enabled?: boolean
  onChange: (payload: RealtimePostgresChangesPayload<Row>) => void
}

let channelSeq = 0

/**
 * Subscribes to Supabase realtime changes of one table while the component is mounted.
 * The channel name is unique per subscription (two screens never share a channel), the latest
 * onChange is always called (no stale closures, no resubscribe on every render), and the channel
 * is removed on unmount or when table/filter/events change.
 */
export function useRealtime({ table, schema = 'public', events = ['INSERT', 'UPDATE', 'DELETE'], filter, enabled = true, onChange }: UseRealtimeOptions) {
  const [isConnected, setIsConnected] = useState(false)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  const eventsKey = events.join(',')

  useEffect(() => {
    if (!enabled) return

    channelSeq += 1
    const channel = supabase.channel(`rt-${table}-${filter ?? 'all'}-${channelSeq}-${Date.now()}`)
    for (const event of eventsKey.split(',')) {
      // One listener per event type: the filter applies to INSERT and UPDATE (DELETE events cannot be filtered).
      const config = { event, schema, table, ...(filter ? { filter } : {}) } as RealtimePostgresChangesFilter<'*'>
      channel.on('postgres_changes', config, (payload: RealtimePostgresChangesPayload<Row>) => onChangeRef.current(payload))
    }
    channel.subscribe(status => setIsConnected(status === 'SUBSCRIBED'))

    return () => {
      setIsConnected(false)
      supabase.removeChannel(channel)
    }
  }, [table, schema, eventsKey, filter, enabled])

  return { isConnected }
}

export default useRealtime
