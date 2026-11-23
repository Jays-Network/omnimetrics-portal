'use client'

import { useFormat } from '@/components/fx/format-context'
import { createFormatter } from '@/lib/settings/format'
import Link from 'next/link'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { resolveTimezone, resolveVariable, WEEK_START_LABEL, type DashSettings, type VarValue, type Variable } from '@/lib/builder/settings'

const sel = 'h-8 rounded-md border border-brand-border-strong bg-brand-primary px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent'

/** Mock option lists for dropdown variables (the real ones come from the dataset on the server in M5). */
export const mockOptions = (v: Variable): string[] => (v.type === 'dropdown' ? ['Value A', 'Value B', 'Value C', 'Value D'] : v.values)

function VariableInput({ v, value, onChange }: { v: Variable; value: VarValue | undefined; onChange: (v: VarValue) => void }) {
  const id = `var-${v.name}`
  const label = v.label || v.name
  const cur = resolveVariable(v, value === undefined ? {} : { [`$${v.name}`]: value })
  if (v.type === 'constant') return <span className="text-xs text-brand-text-muted">{label}: <span className="text-brand-text">{v.values[0]}</span></span>
  if (v.type === 'text') return <label className="flex items-center gap-1.5 text-xs" htmlFor={id}>{label}<input id={id} value={typeof cur === 'string' ? cur : ''} onChange={(e) => onChange(e.target.value)} className={`${sel} w-32`} /></label>
  const options = v.type === 'interval' ? v.values : mockOptions(v)
  if (v.multi) {
    const picked = Array.isArray(cur) ? cur : cur ? [cur] : []
    return (
      <fieldset className="m-0 flex items-center gap-1.5 border-0 p-0 text-xs"><legend className="sr-only">{label}</legend>{label}
        {options.map((o) => <label key={o} className="flex items-center gap-1"><input type="checkbox" checked={picked.includes(o)} onChange={() => onChange(picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o])} className="size-3.5 accent-[var(--brand-accent)]" />{o}</label>)}
      </fieldset>
    )
  }
  return (
    <label className="flex items-center gap-1.5 text-xs" htmlFor={id}>{label}
      <select id={id} value={typeof cur === 'string' ? cur : v.includeAll ? 'All' : ''} onChange={(e) => onChange(e.target.value)} className={sel}>
        {v.includeAll ? <option value="All">All</option> : null}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

const PRESETS = ['Last 6 hours', 'Last 24 hours', 'Last 7 days', 'This week', 'Last week']

/**
 * Viewer toolbar: variables, time options, refresh, links. Time zone and week start here are DISPLAY and
 * picker presets only; they never change how data is bucketed or counted (R6: bucketing stays on
 * PORTAL_TIMEZONE and each dataset's own rules).
 */
export function BoardBar({ settings, values, onValue, systemTz, orgTz, tick, last, refreshInterval, onRefreshInterval, onRefreshNow, nodeHref, range = 'Last 24 hours', onRange }: {
  settings: DashSettings
  values: Record<string, VarValue>
  onValue: (name: string, v: VarValue) => void
  systemTz: string
  orgTz?: string | null
  tick: number
  last: Date
  refreshInterval: string
  onRefreshInterval: (s: string) => void
  onRefreshNow: () => void
  nodeHref: (id: string) => string
  range?: string
  onRange?: (s: string) => void
}) {
  const fmt = useFormat()
  const tz = resolveTimezone(settings.time.timezone, orgTz, systemTz)
  const week = settings.time.weekStart === 'default' ? 'monday' : settings.time.weekStart
  const stamp = createFormatter({ ...fmt.settings, timeZone: tz as typeof fmt.settings.timeZone }).time(last) // the dashboard's own display zone; 12/24h from the viewer; display zone and 12/24h follow the viewer's preferences (R6: display only)
  return (
    <div role="region" aria-label="Dashboard controls" className="mb-2 space-y-1.5 text-sm" data-tick={tick}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {settings.variables.map((v) => <VariableInput key={v.name} v={v} value={values[`$${v.name}`]} onChange={(x) => onValue(v.name, x)} />)}
        {settings.time.hideTimePicker ? null : (
          <label className="flex items-center gap-1.5 text-xs">Time range
            <select value={range} onChange={(e) => onRange?.(e.target.value)} className={sel}>{PRESETS.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
        )}
        {settings.time.hideTimePicker ? null : <span className="text-xs text-brand-text-muted" title="Display only. Data is still bucketed in the portal time zone.">Shown in {tz} · weeks start {WEEK_START_LABEL[week as 'monday']}{settings.time.nowDelay ? ` · now −${settings.time.nowDelay}` : ''}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <label className="flex items-center gap-1.5 text-xs">Refresh
            <select value={refreshInterval} onChange={(e) => onRefreshInterval(e.target.value)} className={sel}>
              <option value="off">Off</option>
              {settings.time.refreshIntervals.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <button type="button" onClick={onRefreshNow} className="flex h-8 items-center gap-1 rounded-md border border-brand-border-strong px-2 text-xs hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"><RefreshCw className="size-3.5" aria-hidden /> Refresh now</button>
          <span className="text-xs tabular-nums text-brand-text-muted">{stamp}</span>
        </span>
      </div>
      {settings.links.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs" aria-label="Dashboard links">
          {settings.links.map((l, i) => (
            <li key={i} className="list-none">
              {l.kind === 'dashboard'
                ? <Link href={nodeHref(l.target)} target={l.newTab ? '_blank' : undefined} rel={l.newTab ? 'noopener noreferrer' : undefined} className="rounded text-brand-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">{l.label}</Link>
                : <a href={l.target} target={l.newTab ? '_blank' : undefined} rel="noopener noreferrer" className="inline-flex items-center gap-0.5 rounded text-brand-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">{l.label}{l.newTab ? <ExternalLink className="size-3" aria-hidden /> : null}</a>}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
