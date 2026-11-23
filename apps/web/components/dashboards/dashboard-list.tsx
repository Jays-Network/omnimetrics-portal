'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, LayoutDashboard, Search } from 'lucide-react'
import { pathOf } from '@/lib/portal/tree'
import { GlassPanel } from '@/components/fx/glass-panel'
import { useWorkspace } from './workspace'

/** Every dashboard of the organisation with its folder path; follows live tree edits. */
export function DashboardList() {
  const { nodes, orgSlug } = useWorkspace()
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return nodes
      .filter((n) => n.kind === 'dashboard')
      .map((n) => ({ n, path: pathOf(nodes, n.id) }))
      .filter(({ path }) => !needle || path.map((p) => p.name).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => a.path.map((p) => p.name).join('/').localeCompare(b.path.map((p) => p.name).join('/')))
  }, [nodes, q])

  return (
    <GlassPanel tone="data" className="p-3">
      <label className="relative mb-2 block">
        <span className="sr-only">Filter dashboards</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-brand-text-muted" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter dashboards"
          className="h-9 w-full rounded-md border border-brand-border bg-brand-surface pl-8 pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        />
      </label>
      <p className="mb-1 px-1 text-xs text-brand-text-muted" aria-live="polite">
        {rows.length} dashboard{rows.length === 1 ? '' : 's'}
      </p>
      {rows.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-brand-text-muted">{q ? 'No dashboards match.' : 'No dashboards yet. Create a folder, then a dashboard inside it.'}</p>
      ) : (
        <ul className="divide-y divide-brand-border">
          {rows.map(({ n, path }) => (
            <li key={n.id} className="list-none">
              <Link
                href={`/dashboard/o/${encodeURIComponent(orgSlug)}/d/${encodeURIComponent(n.id)}`}
                className="flex items-center gap-2 rounded-md px-1 py-2 text-sm hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              >
                <LayoutDashboard className="size-4 shrink-0 text-brand-accent" aria-hidden />
                <span className="font-medium">{n.name}</span>
                <span className="flex min-w-0 items-center gap-0.5 truncate text-xs text-brand-text-muted">
                  {path.slice(0, -1).map((p) => (
                    <span key={p.id} className="flex items-center gap-0.5">
                      <ChevronRight className="size-3" aria-hidden />
                      {p.name}
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  )
}
