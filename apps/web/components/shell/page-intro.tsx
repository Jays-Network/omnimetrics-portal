import type { ReactNode } from 'react'
import { GlassPanel } from '@/components/fx/glass-panel'

/** Page title row plus a "what lands here" card for sections whose real content arrives in a later milestone. */
export function PageTitle({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h1 className="font-display text-xl font-semibold leading-tight">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-brand-text-muted">{description}</p> : null}
      </div>
      {children}
    </div>
  )
}

export function PlannedCard({ milestone, heading, items }: { milestone: string; heading: string; items: string[] }) {
  return (
    <GlassPanel tone="data" className="p-5">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-display text-base font-semibold">{heading}</h2>
        <span className="rounded-full border border-brand-border-strong px-2 text-[10px] uppercase tracking-wider text-brand-text-muted">
          Planned: {milestone}
        </span>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-brand-text-muted">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </GlassPanel>
  )
}
