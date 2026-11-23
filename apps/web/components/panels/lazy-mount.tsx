'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Mount children only when the box nears the viewport (setting "lazy-load off-screen panels"). Once
 * mounted it stays mounted. Without IntersectionObserver (old browsers, jsdom) it mounts at once.
 */
export function LazyMount({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(() => !enabled || typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (on || !ref.current) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setOn(true); io.disconnect() } }, { rootMargin: '300px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [on])
  return <div ref={ref} className="h-full w-full">{on ? children : null}</div>
}
