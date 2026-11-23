'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { effectiveRefreshSeconds, shouldRefresh } from '@/lib/builder/settings'

/**
 * Auto refresh. Never faster than 30s (enforced here as well as in the schema), and it PAUSES while the
 * tab is hidden: a hidden tick is skipped, and one catch-up refresh runs when the tab is shown again.
 */
export function useAutoRefresh(interval: string | undefined) {
  const [tick, setTick] = useState(0)
  const [last, setLast] = useState<Date>(() => new Date())
  const missed = useRef(false)
  const refreshNow = useCallback(() => { setTick((t) => t + 1); setLast(new Date()); missed.current = false }, [])
  const seconds = effectiveRefreshSeconds(interval)
  useEffect(() => {
    if (seconds === null) return
    const id = window.setInterval(() => { if (shouldRefresh(document.visibilityState)) refreshNow(); else missed.current = true }, seconds * 1000)
    const vis = () => { if (document.visibilityState === 'visible' && missed.current) refreshNow() }
    document.addEventListener('visibilitychange', vis)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', vis) }
  }, [seconds, refreshNow])
  return { tick, last, refreshNow }
}
