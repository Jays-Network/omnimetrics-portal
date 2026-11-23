'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GlassPanel } from './glass-panel'
import { activeFormatter } from './format-context'
import { useFxLevel } from './use-fx'

export function formatStat(value: number, decimals = 0): string {
  const f = activeFormatter() // viewer's preferred number format when a FormatProvider is mounted
  if (f) return f.number(value, decimals)
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))

/** Count-up to `target`; instant unless the level is "full". rAF stops itself in hidden tabs. */
export function useCountUp(target: number, enabled: boolean, ms = 900): number {
  const [shown, setShown] = useState(target)
  const current = useRef(target)
  const first = useRef(true)

  useEffect(() => {
    if (!enabled) {
      current.current = target
      setShown(target)
      return
    }
    const from = first.current ? 0 : current.current
    first.current = false
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const k = easeOutExpo((now - t0) / ms)
      current.current = from + (target - from) * k
      setShown(current.current)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, enabled, ms])

  return shown
}

export interface StatCardProps {
  label: string
  value: number
  decimals?: number
  prefix?: string
  suffix?: string
  delta?: { value: number; label?: string }
  icon?: ReactNode
  /** Position in a grid: staggers the entrance. */
  index?: number
  className?: string
}

/** Stat on data glass. Tabular numerals; trend uses an arrow + sign, never colour alone. */
export function StatCard({ label, value, decimals = 0, prefix, suffix, delta, icon, index = 0, className }: StatCardProps) {
  const level = useFxLevel()
  const shown = useCountUp(value, level === 'full')
  const final = `${prefix ?? ''}${formatStat(value, decimals)}${suffix ?? ''}`
  const up = (delta?.value ?? 0) >= 0

  return (
    <GlassPanel tone="data" className={cn('fx-rise p-4', className)} style={{ '--i': index } as CSSProperties}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-brand-text-muted">{label}</p>
        {icon ? <span className="text-brand-accent [&_svg]:size-4">{icon}</span> : null}
      </div>
      <p className="tabular mt-2 text-3xl font-semibold leading-none tracking-tight">
        <span aria-hidden>
          {prefix}
          {formatStat(shown, decimals)}
          {suffix}
        </span>
        <span className="sr-only">{final}</span>
      </p>
      {delta ? (
        <p className={cn('tabular mt-3 flex items-center gap-1 text-xs', up ? 'text-brand-accent' : 'text-brand-danger')}>
          {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
          <span>
            {up ? '+' : ''}
            {formatStat(delta.value, 1)}%
          </span>
          {delta.label ? <span className="text-brand-text-muted">{delta.label}</span> : null}
        </p>
      ) : null}
    </GlassPanel>
  )
}
