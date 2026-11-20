'use client'

import { useSyncExternalStore } from 'react'
import { Gauge, Sparkles, ZapOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setFxLevel, type FxLevel } from './fx-core'
import { useFxLevel } from './use-fx'

const MQ = '(prefers-reduced-motion: reduce)'
const subscribeMq = (cb: () => void) => {
  const mq = matchMedia(MQ)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

const OPTIONS: { level: FxLevel; label: string; Icon: typeof Sparkles }[] = [
  { level: 'full', label: 'Full effects', Icon: Sparkles },
  { level: 'reduced', label: 'Reduced effects', Icon: Gauge },
  { level: 'off', label: 'Effects off', Icon: ZapOff },
]

/** Segmented effects-level control. Choice is stored in localStorage (omni-fx). */
export function FxToggle({ className }: { className?: string }) {
  const level = useFxLevel()
  const osReduced = useSyncExternalStore(subscribeMq, () => matchMedia(MQ).matches, () => false)

  return (
    <div
      role="radiogroup"
      aria-label="Visual effects level"
      className={cn('inline-flex items-center gap-0.5 rounded-full border border-brand-border-strong bg-brand-primary/60 p-0.5', className)}
    >
      {OPTIONS.map(({ level: l, label, Icon }) => {
        const blocked = l === 'full' && osReduced
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={level === l}
            aria-label={label}
            disabled={blocked}
            title={blocked ? 'Full effects are unavailable: your system asks for reduced motion' : label}
            onClick={() => setFxLevel(l)}
            className={cn(
              'grid size-7 place-items-center rounded-full text-brand-text-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-40',
              level === l ? 'bg-brand-accent text-brand-accent-fg' : 'hover:text-brand-text',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
