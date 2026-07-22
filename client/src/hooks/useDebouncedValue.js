import { useEffect, useState } from 'react'

/**
 * Debounce a rapidly-changing value. House style is the Inbox.jsx 300ms
 * setTimeout pattern; this hoists it to a reusable hook. People search uses the
 * spec's 120–180ms window (default 150).
 */
export function useDebouncedValue(value, delay = 150) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
