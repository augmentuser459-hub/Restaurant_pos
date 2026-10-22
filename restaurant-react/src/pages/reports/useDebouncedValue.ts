import { useEffect, useState } from 'react'

/**
 * Returns `value` once it has stopped changing for `delay` ms, so a report is not re-queried on every keystroke
 * while a date is being typed.
 */
export function useDebouncedValue<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
