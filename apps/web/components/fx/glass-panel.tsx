'use client'

import { useEffect, useRef, type HTMLAttributes, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { useFxLevel } from './use-fx'

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** 1 = lightest glass … 3 = densest; "data" = near-opaque, never blurred (charts, tables, stat values). */
  tone?: 1 | 2 | 3 | 'data'
  brackets?: boolean
  spotlight?: boolean
  sheen?: boolean
  halo?: boolean
}

/**
 * Glass surface: blur (not on "data"), 1px cyan-to-purple border, inner glow,
 * HUD brackets, rAF-throttled pointer spotlight, hover sheen. Content sits above
 * the effect layers; effect layers are pointer-transparent.
 */
export function GlassPanel({
  tone = 2,
  brackets = true,
  spotlight = true,
  sheen = true,
  halo = true,
  className,
  children,
  onPointerEnter,
  onPointerMove,
  ...rest
}: GlassPanelProps) {
  const level = useFxLevel()
  const root = useRef<HTMLDivElement>(null)
  const spot = useRef<HTMLSpanElement>(null)
  const rect = useRef<{ r: DOMRect; t: number } | null>(null)
  const raf = useRef(0)
  const pos = useRef({ x: 0, y: 0 })
  const live = spotlight && level === 'full'

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const measure = () => {
    const now = performance.now()
    if (!rect.current || now - rect.current.t > 250) {
      rect.current = { r: root.current!.getBoundingClientRect(), t: now }
    }
    return rect.current.r
  }
  const enter = (e: PointerEvent<HTMLDivElement>) => {
    onPointerEnter?.(e)
    if (live) measure()
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(e)
    if (!live) return
    const r = measure()
    pos.current = { x: e.clientX - r.left, y: e.clientY - r.top }
    if (!raf.current) {
      raf.current = requestAnimationFrame(() => {
        raf.current = 0
        if (spot.current) {
          spot.current.style.transform = `translate3d(${pos.current.x}px,${pos.current.y}px,0)`
        }
      })
    }
  }

  return (
    <div
      ref={root}
      data-tone={tone}
      className={cn('fx-glass', brackets && 'fx-brackets', className)}
      onPointerEnter={enter}
      onPointerMove={move}
      {...rest}
    >
      {halo ? <span aria-hidden className="fx-halo" /> : null}
      <span aria-hidden className="fx-clip">
        {live ? <span ref={spot} className="fx-spot" /> : null}
        {sheen ? <span className="fx-sheen" /> : null}
      </span>
      <div className="fx-content">{children}</div>
    </div>
  )
}
