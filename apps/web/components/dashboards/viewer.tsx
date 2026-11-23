'use client'

import Link from 'next/link'
import { ChevronRight, Lock } from 'lucide-react'
import { useState } from 'react'
import type { DashboardView, GrantAccess } from '@omnimetrics/types'
import { GlassPanel } from '@/components/fx/glass-panel'
import { pathOf } from '@/lib/portal/tree'
import { StaticBoard } from '@/components/panels/artboard'
import { BoardBar } from './board-bar'
import { useAutoRefresh } from './use-refresh'
import type { VarValue } from '@/lib/builder/settings'
import { normalizeSpec } from '@/lib/builder/model'
import type { Filters, FilterValue } from '@/lib/panels/types'
import { useWorkspace } from './workspace'

const ACCESS_LABEL: Record<GrantAccess, string> = { view: 'View', edit: 'Edit', manage: 'Manage' }

function Breadcrumbs({ nodeId, fallback }: { nodeId: string; fallback: DashboardView['path'] }) {
  const { nodes, basePath } = useWorkspace()
  const live = pathOf(nodes, nodeId)
  const path = live.length ? live : fallback
  return (
    <nav aria-label="Breadcrumb" className="mb-1 text-xs text-brand-text-muted">
      <ol className="flex flex-wrap items-center gap-0.5">
        <li className="list-none">
          <Link href={basePath} className="rounded px-1 hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
            Dashboards
          </Link>
        </li>
        {path.map((p, i) => (
          <li key={p.id} className="flex list-none items-center gap-0.5">
            <ChevronRight className="size-3" aria-hidden />
            {i === path.length - 1 ? (
              <span aria-current="page" className="px-1 text-brand-text">
                {p.name}
              </span>
            ) : (
              <span className="px-1">
                {p.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

function AccessPanel({ view }: { view: DashboardView }) {
  return (
    <GlassPanel tone="data" className="mt-3 p-4" aria-labelledby="access-heading">
      <div className="mb-2 flex items-center gap-2">
        <Lock className="size-4 text-brand-accent" aria-hidden />
        <h2 id="access-heading" className="font-display text-sm font-semibold">
          Access
        </h2>
        <span className="rounded-full border border-brand-border-strong px-2 text-[10px] uppercase tracking-wider text-brand-text-muted">Read only</span>
      </div>
      <p className="mb-2 text-sm text-brand-text-muted">
        Your access: <strong className="font-medium text-brand-text">{ACCESS_LABEL[view.yourAccess]}</strong>.
        {view.grants.length === 0 ? ' The list of who else has access is shown to builders and admins.' : ''}
      </p>
      {view.grants.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Who can open this dashboard</caption>
            <thead className="text-xs uppercase tracking-wider text-brand-text-muted">
              <tr>
                <th scope="col" className="py-1.5 pr-3 font-medium">Who</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Type</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Access</th>
                <th scope="col" className="py-1.5 font-medium">Granted by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {view.grants.map((g) => (
                <tr key={`${g.principal}-${g.via}`}>
                  <th scope="row" className="py-1.5 pr-3 font-medium">{g.principal}</th>
                  <td className="py-1.5 pr-3 capitalize text-brand-text-muted">{g.kind}</td>
                  <td className="py-1.5 pr-3">{ACCESS_LABEL[g.access]}</td>
                  <td className="py-1.5 text-brand-text-muted">{g.via}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="mt-2 text-xs text-brand-text-muted">Grants are edited in Admin &gt; Users (M4). Mock data.</p>
    </GlassPanel>
  )
}

export function DashboardViewer({ view, systemTz }: { view: DashboardView; systemTz: string }) {
  const { nodes, basePath } = useWorkspace()
  const name = nodes.find((n) => n.id === view.node.id)?.name ?? view.node.name
  const [filters, setFilters] = useState<Filters>({})
  const spec = normalizeSpec(view.spec)
  const [values, setValues] = useState<Record<string, VarValue>>({})
  const [refresh, setRefresh] = useState(spec.settings.time.autoRefresh)
  const [range, setRange] = useState('Last 24 hours')
  const { tick, last, refreshNow } = useAutoRefresh(refresh)
  const orgBase = basePath.slice(0, basePath.length - '/dashboards'.length)
  const setFilter = (field: string, value: FilterValue | null) =>
    setFilters((f) => {
      const next = { ...f }
      if (value === null) delete next[field]
      else next[field] = value
      return next
    })
  return (
    <article aria-label={name}>
      <Breadcrumbs nodeId={view.node.id} fallback={view.path} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-xl font-semibold leading-tight">{name}</h1>
        {view.yourAccess !== 'view' ? (
          <Link href={`${basePath.replace(/\/dashboards$/, '')}/d/${encodeURIComponent(view.node.id)}/edit`} className="rounded-md border border-brand-border-strong px-3 py-1.5 text-sm hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
            Edit
          </Link>
        ) : null}
      </div>
      {spec.settings.general.description ? <p className="mb-2 text-sm text-brand-text-muted">{spec.settings.general.description}</p> : null}
      <BoardBar settings={spec.settings} values={values} onValue={(n, v) => setValues((x) => ({ ...x, [`$${n}`]: v }))} systemTz={systemTz} tick={tick} last={last} refreshInterval={refresh} onRefreshInterval={setRefresh} onRefreshNow={refreshNow} nodeHref={(id) => `${orgBase}/d/${encodeURIComponent(id)}`} range={range} onRange={setRange} />
      <StaticBoard spec={spec} filters={filters} setFilter={setFilter} varValues={values} tick={tick} />
      <AccessPanel view={view} />
    </article>
  )
}
