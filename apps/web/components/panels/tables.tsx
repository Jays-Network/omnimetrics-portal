'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Info, OctagonAlert } from 'lucide-react'
import type { PanelProps } from '@/lib/panels/types'
import { cn } from '@/lib/utils'
import { NoData } from './frame'

const PAGE = 8

/** Sortable, paged table. Header buttons set aria-sort; the table itself is the accessible form. */
export function DataTablePanel({ data }: PanelProps) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [page, setPage] = useState(0)
  const rows = useMemo(() => {
    if (data.kind !== 'table') return []
    if (!sort) return data.rows
    return [...data.rows].sort((a, b) => {
      const x = a[sort.key]
      const y = b[sort.key]
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir
    })
  }, [data, sort])
  if (data.kind !== 'table') return <NoData kind="table" />
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const cur = Math.min(page, pages - 1)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-brand-surface text-xs uppercase tracking-wider text-brand-text-muted">
            <tr>
              {data.columns.map((c) => {
                const on = sort?.key === c.key
                return (
                  <th key={c.key} scope="col" aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'} className={cn('py-1.5 pr-3 font-medium', c.numeric && 'text-right')}>
                    <button type="button" onClick={() => setSort(on && sort!.dir === -1 ? null : { key: c.key, dir: on ? -1 : 1 })} className="inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
                      {c.label}
                      {on ? sort!.dir === 1 ? <ChevronUp className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden /> : null}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {rows.slice(cur * PAGE, cur * PAGE + PAGE).map((r, i) => (
              <tr key={i}>
                {data.columns.map((c, j) => (j === 0 ? <th key={c.key} scope="row" className="py-1.5 pr-3 font-medium">{r[c.key]}</th> : <td key={c.key} className={cn('py-1.5 pr-3', c.numeric && 'tabular text-right')}>{r[c.key]}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-brand-text-muted">
        <span>{rows.length} rows</span>
        <span className="flex items-center gap-1">
          <button type="button" disabled={cur === 0} onClick={() => setPage(cur - 1)} className="rounded px-1.5 py-0.5 hover:text-brand-text disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">Prev</button>
          <span aria-live="polite">Page {cur + 1} of {pages}</span>
          <button type="button" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="rounded px-1.5 py-0.5 hover:text-brand-text disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">Next</button>
        </span>
      </div>
    </div>
  )
}

export function TopNPanel({ data }: PanelProps) {
  if (data.kind !== 'named') return <NoData kind="named" />
  return (
    <ol className="m-0 h-full min-h-0 list-none space-y-1.5 overflow-y-auto p-0">
      {data.items.map((i, k) => (
        <li key={i.name} className="flex items-center gap-2 text-sm">
          <span className="tabular w-5 text-right text-xs text-brand-text-muted">{k + 1}</span>
          <span className="min-w-0 flex-1 truncate">{i.name}</span>
          <span className="tabular font-medium">{i.value}</span>
        </li>
      ))}
    </ol>
  )
}

const SEV = {
  critical: { Icon: OctagonAlert, cls: 'text-brand-danger', label: 'Critical' },
  warning: { Icon: AlertTriangle, cls: 'text-[var(--chart-2)]', label: 'Warning' },
  info: { Icon: Info, cls: 'text-brand-accent', label: 'Info' },
} as const

/** Alerts and activity share the list shape; severity is icon + text, never colour alone. */
export function ListPanel({ data }: PanelProps) {
  if (data.kind !== 'list') return <NoData kind="list" />
  return (
    <ul className="m-0 h-full min-h-0 list-none divide-y divide-brand-border overflow-y-auto p-0">
      {data.items.map((i) => {
        const s = SEV[i.severity]
        return (
          <li key={i.id} className="flex items-start gap-2 py-1.5 text-sm">
            <s.Icon className={cn('mt-0.5 size-4 shrink-0', s.cls)} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{i.title}</span>
              <span className="sr-only"> ({s.label})</span>
              {i.detail ? <span className="block truncate text-xs text-brand-text-muted">{i.detail}</span> : null}
            </span>
            <time className="tabular text-xs text-brand-text-muted">{i.time}</time>
          </li>
        )
      })}
    </ul>
  )
}
