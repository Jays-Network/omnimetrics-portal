'use client'

import type { PanelProps } from '@/lib/panels/types'
import { NoData } from './frame'

const field = 'h-9 w-full rounded-md border border-brand-border-strong bg-brand-surface px-2 text-sm text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent'

/** Which filter field a control publishes into. */
export const CONTROL_FIELD = { folder: 'folder_name', country: 'country', dates: 'date_range', multi: 'status', search: 'search' } as const

function Label({ id, text }: { id: string; text: string }) {
  return (
    <label htmlFor={id} className="mb-1 block text-xs font-medium uppercase tracking-wider text-brand-text-muted">
      {text}
    </label>
  )
}

export function SelectControl({ title, data, filters, setFilter, name, fieldName }: PanelProps & { name: string; fieldName: string }) {
  if (data.kind !== 'control') return <NoData kind="control" />
  const id = `ctl-${fieldName}`
  const value = typeof filters[fieldName] === 'string' ? (filters[fieldName] as string) : ''
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <Label id={id} text={title || name} />
      <select id={id} value={value} onChange={(e) => setFilter?.(fieldName, e.target.value || null)} className={field}>
        <option value="">All</option>
        {data.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function MultiSelectControl({ title, data, filters, setFilter }: PanelProps) {
  if (data.kind !== 'control') return <NoData kind="control" />
  const fieldName = CONTROL_FIELD.multi
  const cur = Array.isArray(filters[fieldName]) ? (filters[fieldName] as string[]) : []
  const toggle = (v: string) => {
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
    setFilter?.(fieldName, next.length ? next : null)
  }
  return (
    <fieldset className="m-0 h-full min-h-0 min-w-0 overflow-y-auto border-0 p-0">
      <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-brand-text-muted">{title || 'Status'}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {data.options.map((o) => (
          <label key={o.value} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={cur.includes(o.value)} onChange={() => toggle(o.value)} className="size-4 accent-[var(--brand-accent)]" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function DateRangeControl({ title, filters, setFilter }: PanelProps) {
  const fieldName = CONTROL_FIELD.dates
  const cur = Array.isArray(filters[fieldName]) ? (filters[fieldName] as string[]) : ['', '']
  const set = (i: 0 | 1, v: string) => {
    const next = [i === 0 ? v : (cur[0] ?? ''), i === 1 ? v : (cur[1] ?? '')]
    setFilter?.(fieldName, next[0] || next[1] ? next : null)
  }
  return (
    <fieldset className="m-0 h-full min-h-0 min-w-0 overflow-y-auto border-0 p-0">
      <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-brand-text-muted">{title || 'Date range'}</legend>
      <div className="flex gap-2">
        <label className="flex-1 text-xs">
          <span className="sr-only">From</span>
          <input type="date" value={cur[0] ?? ''} max={cur[1] || undefined} onChange={(e) => set(0, e.target.value)} className={field} />
        </label>
        <label className="flex-1 text-xs">
          <span className="sr-only">To</span>
          <input type="date" value={cur[1] ?? ''} min={cur[0] || undefined} onChange={(e) => set(1, e.target.value)} className={field} />
        </label>
      </div>
    </fieldset>
  )
}

export function SearchControl({ title, filters, setFilter }: PanelProps) {
  const fieldName = CONTROL_FIELD.search
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <Label id="ctl-search" text={title || 'Search'} />
      <input id="ctl-search" type="search" value={typeof filters[fieldName] === 'string' ? (filters[fieldName] as string) : ''} onChange={(e) => setFilter?.(fieldName, e.target.value || null)} placeholder="Type to filter" className={field} />
    </div>
  )
}
