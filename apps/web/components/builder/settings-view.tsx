'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { Plus, Trash2, Undo2 } from 'lucide-react'
import type { ContentNode, GrantAccess, GrantRow } from '@omnimetrics/types'
import { parseSpec, type DashSpec, type DashVersion } from '@/lib/builder/model'
import { MOCK_FIELDS } from '@/lib/builder/fields'
import {
  DEFAULT_REFRESH_LIST, DashSettingsSchema, LinkSchema, MIN_REFRESH_S, VariableSchema, WEEK_START_LABEL, resolveTimezone,
  type DashLink, type DashSettings, type Variable,
} from '@/lib/builder/settings'
import { cn } from '@/lib/utils'
import { VersionsPane } from './versions-pane'

const input = 'h-8 w-full rounded-md border border-brand-border-strong bg-brand-primary px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:opacity-60'
const btn = 'flex items-center gap-1.5 rounded-md border border-brand-border-strong px-2.5 py-1.5 text-sm hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-50'
const primary = 'bg-brand-accent text-brand-accent-fg hover:bg-brand-accent'

export const SETTINGS_TABS = [
  ['general', 'General'], ['time', 'Time options'], ['panel', 'Panel options'], ['variables', 'Variables'], ['links', 'Links'],
  ['versions', 'Versions'], ['permissions', 'Permissions'], ['json', 'JSON Model'], ['annotations', 'Annotations'],
] as const
type TabId = (typeof SETTINGS_TABS)[number][0]

const COMMON_ZONES = ['UTC', 'Africa/Johannesburg', 'Africa/Nairobi', 'Africa/Lagos', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney']

/** First problem of a settings object, as readable text. */
export function settingsError(next: unknown): string | null {
  const r = DashSettingsSchema.safeParse(next)
  if (r.success) return null
  const i = r.error.issues[0]!
  return `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="block text-sm">
      <span className="mb-0.5 block text-xs font-medium text-brand-text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-0.5 block text-xs text-brand-text-muted">{hint}</span> : null}
    </div>
  )
}

/** Text field that commits on blur or Enter, validates, and shows the problem instead of applying a bad value. */
function CommitField({ id, label, value, onCommit, hint, disabled }: { id: string; label: string; value: string; onCommit: (v: string) => string | null; hint?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState(value)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => setDraft(value), [value])
  const commit = () => { if (draft !== value) { const e = onCommit(draft); setErr(e); if (e) return } else setErr(null) }
  return (
    <div className="text-sm">
      <label htmlFor={id} className="mb-0.5 block text-xs font-medium text-brand-text-muted">{label}</label>
      <input id={id} value={draft} disabled={disabled} aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-err` : undefined} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} className={cn(input, err && 'border-brand-danger')} />
      {err ? <p id={`${id}-err`} role="alert" className="mt-0.5 text-xs text-brand-danger">{err}</p> : hint ? <p className="mt-0.5 text-xs text-brand-text-muted">{hint}</p> : null}
    </div>
  )
}

async function api<T>(url: string, method: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as T & { error?: string }
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? `Request failed (${res.status})` }
  } catch {
    return { ok: false, error: 'Network error.' }
  }
}

export interface SettingsViewProps {
  dash: DashSpec
  onChange: (fn: (d: DashSpec) => DashSpec, key?: string) => void
  /** Replace the whole dashboard (JSON Model apply). One undo step. */
  onReplace: (d: DashSpec) => void
  versions: DashVersion[]
  note: string
  onNote: (s: string) => void
  busy: boolean
  onRestore: (n: number) => void
  isAdmin: boolean
  canDelete: boolean
  orgSlug: string
  nodeId: string
  dashboardName: string
  systemTz: string
  onRenamed: (name: string) => void
  onClose: () => void
}

/** Full-width dashboard settings with tabs. Everything except Title, Folder, Delete and Permissions lives in the dashboard spec (undoable, versioned). */
export function SettingsView(p: SettingsViewProps) {
  const [tab, setTab] = useState<TabId>('general')
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const s = p.dash.settings
  const setS = useCallback((fn: (x: DashSettings) => DashSettings, key?: string) => p.onChange((d) => ({ ...d, settings: fn(d.settings) }), key), [p])
  /** Apply a settings object only if it passes the schema; otherwise return the reason. */
  const tryApply = (next: DashSettings, key?: string): string | null => {
    const r = DashSettingsSchema.safeParse(next)
    if (!r.success) return settingsError(next)
    setS(() => r.data, key)
    return null
  }

  const onTabKey = (e: KeyboardEvent) => {
    const i = SETTINGS_TABS.findIndex(([id]) => id === tab)
    const j = e.key === 'ArrowRight' ? (i + 1) % SETTINGS_TABS.length : e.key === 'ArrowLeft' ? (i - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? SETTINGS_TABS.length - 1 : -1
    if (j < 0) return
    e.preventDefault()
    const id = SETTINGS_TABS[j]![0]
    setTab(id)
    refs.current[id]?.focus()
  }

  return (
    <div data-editor-col="settings" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-brand-border px-3 py-2">
        <h2 className="mr-2 font-display text-base font-semibold">Dashboard settings</h2>
        <div role="tablist" aria-label="Dashboard settings" className="flex flex-wrap gap-1" onKeyDown={onTabKey}>
          {SETTINGS_TABS.map(([id, label]) => (
            <button key={id} ref={(el) => { refs.current[id] = el }} type="button" role="tab" id={`stab-${id}`} aria-selected={tab === id} aria-controls={`spane-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} className={cn('rounded-md px-2.5 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent', tab === id ? 'bg-brand-surface-raised font-semibold' : 'text-brand-text-muted hover:bg-brand-surface')}>{label}</button>
          ))}
        </div>
        <button type="button" className={cn(btn, 'ml-auto')} onClick={p.onClose}>Back to canvas</button>
      </div>
      <div data-scroll="settings" role="tabpanel" id={`spane-${tab}`} aria-labelledby={`stab-${tab}`} tabIndex={0} className="scroll-token min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain break-words p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {tab === 'general' ? <GeneralTab {...p} s={s} setS={setS} tryApply={tryApply} /> : null}
          {tab === 'time' ? <TimeTab s={s} tryApply={tryApply} systemTz={p.systemTz} /> : null}
          {tab === 'panel' ? <PanelTab s={s} setS={setS} /> : null}
          {tab === 'variables' ? <VariablesTab s={s} tryApply={tryApply} /> : null}
          {tab === 'links' ? <LinksTab s={s} tryApply={tryApply} orgSlug={p.orgSlug} nodeId={p.nodeId} /> : null}
          {tab === 'versions' ? <VersionsPane versions={p.versions} note={p.note} onNote={p.onNote} busy={p.busy} onRestore={p.onRestore} /> : null}
          {tab === 'permissions' ? <PermissionsTab orgSlug={p.orgSlug} nodeId={p.nodeId} isAdmin={p.isAdmin} /> : null}
          {tab === 'json' ? <JsonTab dash={p.dash} isAdmin={p.isAdmin} onReplace={p.onReplace} /> : null}
          {tab === 'annotations' ? (
            <section aria-label="Annotations">
              <h3 className="font-display text-sm font-semibold">Annotations <span className="ml-1 rounded-full border border-brand-border-strong px-2 py-0.5 text-[10px] uppercase tracking-wider text-brand-text-muted">Planned</span></h3>
              <p className="mt-2 text-sm text-brand-text-muted">Annotations (notes and event markers drawn on time charts) are planned for a later milestone. There is nothing to configure yet, and nothing here is saved.</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

type TabProps = { s: DashSettings; setS: (fn: (x: DashSettings) => DashSettings, key?: string) => void; tryApply: (n: DashSettings, key?: string) => string | null }

/* ------------------------------------------------------------------ General */

function GeneralTab(p: SettingsViewProps & TabProps) {
  const base = `/api/portal/o/${encodeURIComponent(p.orgSlug)}/content`
  const [nodes, setNodes] = useState<ContentNode[] | null>(null)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [deleted, setDeleted] = useState<{ batchId: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void api<{ nodes: ContentNode[] }>(base, 'GET').then((r) => { if (r.ok) setNodes(r.data.nodes) }) }, [base])
  const me = nodes?.find((n) => n.id === p.nodeId)
  const folders = (nodes ?? []).filter((n) => n.kind === 'folder')
  const label = (f: ContentNode): string => { const path: string[] = []; let c: ContentNode | undefined = f; while (c) { path.unshift(c.name); c = nodes?.find((n) => n.id === c!.parentId) } return path.join(' / ') }

  const rename = (name: string): string | null => {
    void api<{ nodes: ContentNode[] }>(base, 'POST', { op: 'rename', id: p.nodeId, name }).then((r) => {
      if (r.ok) { setNodes(r.data.nodes); p.onRenamed(name.trim()); setMsg({ text: 'Renamed.' }) } else setMsg({ text: r.error, error: true })
    })
    return name.trim() === '' ? 'Enter a title.' : null
  }
  const move = async (parentId: string) => {
    const r = await api<{ nodes: ContentNode[] }>(base, 'POST', { op: 'move', id: p.nodeId, parentId })
    if (r.ok) { setNodes(r.data.nodes); setMsg({ text: 'Moved.' }) } else setMsg({ text: r.error, error: true })
  }
  const del = async () => {
    setBusy(true)
    const r = await api<{ batchId?: string }>(base, 'POST', { op: 'delete', id: p.nodeId })
    setBusy(false)
    setConfirm(false)
    if (r.ok && r.data.batchId) setDeleted({ batchId: r.data.batchId })
    else setMsg({ text: r.ok ? 'Delete failed.' : r.error, error: true })
  }
  const undoDelete = async () => {
    if (!deleted) return
    const r = await api(base, 'POST', { op: 'restore', batchId: deleted.batchId })
    if (r.ok) { setDeleted(null); setMsg({ text: 'Dashboard restored.' }) } else setMsg({ text: r.error, error: true })
  }

  if (deleted) {
    return (
      <section aria-label="Dashboard deleted" role="alert" className="rounded-md border border-brand-border-strong p-4">
        <p className="text-sm font-medium">“{p.dashboardName}” was deleted.</p>
        <p className="mt-1 text-xs text-brand-text-muted">Deleting is a soft delete: you can undo it from here, or from the tree.</p>
        <div className="mt-3 flex gap-2">
          <button type="button" className={btn} onClick={() => void undoDelete()}><Undo2 className="size-4" aria-hidden /> Undo delete</button>
          <Link href={`/dashboard/o/${encodeURIComponent(p.orgSlug)}/dashboards`} className={cn(btn, primary)}>Back to dashboards</Link>
        </div>
      </section>
    )
  }
  return (
    <section aria-label="General" className="space-y-3">
      <p role={msg?.error ? 'alert' : 'status'} className={cn('min-h-4 text-xs', msg?.error ? 'text-brand-danger' : 'text-brand-text-muted')}>{msg?.text ?? 'Title and folder belong to the dashboard tree and are saved at once. Everything else is saved with the next version.'}</p>
      <CommitField id="set-title" label="Title" value={p.dashboardName} onCommit={rename} />
      <Field label="Description">
        <textarea value={p.s.general.description} maxLength={500} rows={3} onChange={(e) => p.setS((x) => ({ ...x, general: { ...x.general, description: e.target.value } }), 'set:desc')} className={cn(input, 'h-auto py-1.5')} />
      </Field>
      <CommitField id="set-tags" label="Tags" value={p.s.general.tags.join(', ')} hint="Comma separated, up to 20." onCommit={(v) => p.tryApply({ ...p.s, general: { ...p.s.general, tags: v.split(',').map((t) => t.trim()).filter(Boolean) } })} />
      <Field label="Folder" hint="Moves this dashboard inside your organisation's tree.">
        <select aria-label="Folder" value={me?.parentId ?? ''} disabled={!nodes} onChange={(e) => void move(e.target.value)} className={input}>
          {folders.map((f) => <option key={f.id} value={f.id}>{label(f)}</option>)}
        </select>
      </Field>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-0.5 text-xs font-medium text-brand-text-muted">Who can edit</legend>
        {([[true, 'Editable'], [false, 'Read-only']] as const).map(([val, text]) => (
          <label key={text} className="mr-4 inline-flex items-center gap-1.5 text-sm">
            <input type="radio" name="editable" checked={p.s.general.editable === val} disabled={!p.isAdmin} onChange={() => p.setS((x) => ({ ...x, general: { ...x.general, editable: val } }))} className="accent-[var(--brand-accent)]" /> {text}
          </label>
        ))}
        <p className="mt-0.5 text-xs text-brand-text-muted">Read-only hides Edit from builders. Organisation admins and the director can still change this.{p.isAdmin ? '' : ' Only an admin can change it.'}</p>
      </fieldset>
      <div className="rounded-md border border-brand-danger/50 p-3">
        <h3 className="font-display text-sm font-semibold">Delete dashboard</h3>
        <p className="mt-1 text-xs text-brand-text-muted">Soft delete: it leaves the tree and can be restored with Undo.</p>
        <button type="button" className={cn(btn, 'mt-2 text-brand-danger')} disabled={!p.canDelete} onClick={() => setConfirm(true)}><Trash2 className="size-4" aria-hidden /> Delete dashboard</button>
        {p.canDelete ? null : <p className="mt-1 text-xs text-brand-text-muted">You do not have permission to delete dashboards.</p>}
      </div>
      {confirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setConfirm(false) } }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="del-title" className="w-full max-w-sm rounded-lg border border-brand-border-strong bg-brand-surface p-5 shadow-xl">
            <h2 id="del-title" className="font-display text-base font-semibold">Delete “{p.dashboardName}”?</h2>
            <p className="mt-1 text-sm text-brand-text-muted">It is removed from the tree. You can undo this straight afterwards.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" autoFocus className={btn} onClick={() => setConfirm(false)}>Cancel</button>
              <button type="button" className={cn(btn, 'border-brand-danger text-brand-danger')} disabled={busy} onClick={() => void del()}>Delete</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/* ------------------------------------------------------------------ Time options */

function TimeTab({ s, tryApply, systemTz }: Pick<TabProps, 's' | 'tryApply'> & { systemTz: string }) {
  const t = s.time
  const upd = (patch: Partial<DashSettings['time']>) => tryApply({ ...s, time: { ...t, ...patch } })
  const [err, setErr] = useState<string | null>(null)
  const effective = resolveTimezone(t.timezone, null, systemTz)
  return (
    <section aria-label="Time options" className="space-y-3">
      <p className="rounded-md border border-brand-border bg-brand-surface p-2 text-xs text-brand-text-muted">
        These options change how the dashboard <strong className="text-brand-text">looks and when it refreshes</strong>. They never change how data is bucketed or counted: days, weeks and months, the 60-day window and billing periods always use the portal time zone ({systemTz}) and each dataset’s own rules (R6).
      </p>
      <Field label="Time zone (display only)" hint={`Showing times in ${effective}${t.timezone === 'default' ? ' (organisation setting, else the system default)' : ''}.`}>
        <select aria-label="Time zone" value={t.timezone} onChange={(e) => upd({ timezone: e.target.value })} className={input}>
          <option value="default">Default (organisation or system: {systemTz})</option>
          {[...new Set([systemTz, ...COMMON_ZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </Field>
      <Field label="Week starts on (display and date-picker presets only)" hint="Changes what “This week” means in the picker. It does not change weekly totals.">
        <select aria-label="Week start" value={t.weekStart} onChange={(e) => upd({ weekStart: e.target.value as DashSettings['time']['weekStart'] })} className={input}>
          {(Object.keys(WEEK_START_LABEL) as (keyof typeof WEEK_START_LABEL)[]).map((k) => <option key={k} value={k}>{WEEK_START_LABEL[k]}</option>)}
        </select>
      </Field>
      <CommitField id="set-refresh-list" label="Auto-refresh intervals" value={t.refreshIntervals.join(', ')} hint={`Comma separated, for example ${DEFAULT_REFRESH_LIST.slice(0, 4).join(', ')}. The shortest allowed is ${MIN_REFRESH_S}s.`} onCommit={(v) => upd({ refreshIntervals: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
      <Field label="Refresh when the dashboard opens">
        <select aria-label="Default refresh" value={t.autoRefresh} onChange={(e) => setErr(upd({ autoRefresh: e.target.value }))} className={input}>
          <option value="off">Off</option>
          {t.refreshIntervals.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      {err ? <p role="alert" className="text-xs text-brand-danger">{err}</p> : null}
      <p className="text-xs text-brand-text-muted">Refresh pauses while this browser tab is hidden and catches up once when you return.</p>
      <CommitField id="set-now-delay" label="“Now” delay" value={t.nowDelay} hint="Leave empty for none, or for example 1m. Hides the newest, still-arriving moment from the displayed range. Up to 1h." onCommit={(v) => upd({ nowDelay: v.trim() })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={t.hideTimePicker} onChange={(e) => upd({ hideTimePicker: e.target.checked })} className="size-4 accent-[var(--brand-accent)]" /> Hide time picker</label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={t.refreshLive} onChange={(e) => upd({ refreshLive: e.target.checked })} className="mt-0.5 size-4 accent-[var(--brand-accent)]" /><span>Refresh live dashboards<span className="block text-xs text-brand-text-muted">Re-evaluate relative ranges such as “Last 6 hours” on every refresh.</span></span></label>
    </section>
  )
}

/* ------------------------------------------------------------------ Panel options */

function PanelTab({ s, setS }: Pick<TabProps, 's' | 'setS'>) {
  return (
    <section aria-label="Panel options" className="space-y-3">
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1 text-xs font-medium text-brand-text-muted">Graph tooltip</legend>
        {([['default', 'Default', 'Each chart shows its own tooltip.'], ['sharedCrosshair', 'Shared crosshair', 'Hovering one chart marks the same position on the other charts.'], ['sharedTooltip', 'Shared tooltip', 'Hovering one chart shows the matching tooltip on the other charts.']] as const).map(([v, label, hint]) => (
          <label key={v} className="mb-1.5 flex items-start gap-2 text-sm">
            <input type="radio" name="tooltip" checked={s.panelOptions.tooltip === v} onChange={() => setS((x) => ({ ...x, panelOptions: { ...x.panelOptions, tooltip: v } }))} className="mt-0.5 accent-[var(--brand-accent)]" />
            <span>{label}<span className="block text-xs text-brand-text-muted">{hint}</span></span>
          </label>
        ))}
        <p className="text-xs text-brand-text-muted">Both shared modes link charts with the same kind of x axis. In this build they behave alike.</p>
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={s.panelOptions.lazyLoad} onChange={(e) => setS((x) => ({ ...x, panelOptions: { ...x.panelOptions, lazyLoad: e.target.checked } }))} className="mt-0.5 size-4 accent-[var(--brand-accent)]" />
        <span>Lazy-load off-screen panels<span className="block text-xs text-brand-text-muted">Panels load when they come near the screen. Turn off to load everything at once.</span></span>
      </label>
    </section>
  )
}

/* ------------------------------------------------------------------ Variables */

const blankVar = (): Variable => ({ name: '', label: '', type: 'dropdown', field: 'country', values: [], multi: false, includeAll: false })

function VariablesTab({ s, tryApply }: Pick<TabProps, 's' | 'tryApply'>) {
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState<Variable>(blankVar())
  const [err, setErr] = useState<string | null>(null)
  const start = (i: number | 'new') => { setEditing(i); setDraft(i === 'new' ? blankVar() : { ...s.variables[i]! }); setErr(null) }
  const parsed = VariableSchema.safeParse(draft)
  const problem = parsed.success ? null : `${parsed.error.issues[0]!.path.join('.') || 'variable'}: ${parsed.error.issues[0]!.message}`
  const save = () => {
    if (!parsed.success) return
    const list = editing === 'new' ? [...s.variables, parsed.data] : s.variables.map((v, i) => (i === editing ? parsed.data : v))
    const e = tryApply({ ...s, variables: list })
    setErr(e)
    if (!e) setEditing(null)
  }
  const remove = (i: number) => tryApply({ ...s, variables: s.variables.filter((_, k) => k !== i) })
  const set = <K extends keyof Variable>(k: K, v: Variable[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const textTypes = draft.type === 'custom' || draft.type === 'interval' || draft.type === 'constant'
  return (
    <section aria-label="Variables" className="space-y-3">
      <p className="text-xs text-brand-text-muted">Variables appear above the dashboard. Reference one in a panel’s Filter block by typing <code>$name</code> as the value. Control panels (dropdowns, pickers) publish into the filters they are bound to; variables are the dashboard-level inputs.</p>
      {s.variables.length === 0 ? <p className="text-sm text-brand-text-muted">No variables yet.</p> : (
        <ul className="m-0 list-none space-y-1.5 p-0" aria-label="Variables">
          {s.variables.map((v, i) => (
            <li key={v.name} className="flex items-center gap-2 rounded-md border border-brand-border p-2 text-sm">
              <code className="rounded bg-brand-primary px-1">${v.name}</code>
              <span className="min-w-0 flex-1 truncate">{v.label || v.name} <span className="text-xs text-brand-text-muted">· {v.type}{v.multi ? ' · multi' : ''}{v.includeAll ? ' · All' : ''}</span></span>
              <button type="button" className={btn} onClick={() => start(i)}>Edit</button>
              <button type="button" className={btn} aria-label={`Remove variable ${v.name}`} onClick={() => remove(i)}><Trash2 className="size-4" aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
      {editing === null ? <button type="button" className={btn} onClick={() => start('new')}><Plus className="size-4" aria-hidden /> Add variable</button> : (
        <form className="space-y-2 rounded-md border border-brand-border-strong p-3" onSubmit={(e) => { e.preventDefault(); save() }} aria-label="Variable editor">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Name"><input aria-label="Variable name" value={draft.name} onChange={(e) => set('name', e.target.value)} className={input} /></Field>
            <Field label="Label"><input aria-label="Variable label" value={draft.label} onChange={(e) => set('label', e.target.value)} className={input} /></Field>
            <Field label="Type">
              <select aria-label="Variable type" value={draft.type} onChange={(e) => set('type', e.target.value as Variable['type'])} className={input}>
                <option value="dropdown">Dropdown (from a dataset field)</option><option value="custom">Custom list</option><option value="interval">Interval</option><option value="text">Text box</option><option value="constant">Constant</option>
              </select>
            </Field>
            {draft.type === 'dropdown' ? (
              <Field label="Dataset field">
                <select aria-label="Dataset field" value={draft.field ?? ''} onChange={(e) => set('field', e.target.value)} className={input}>
                  {MOCK_FIELDS.filter((f) => f.type === 'text').map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </Field>
            ) : null}
          </div>
          {textTypes ? (
            <Field label={draft.type === 'constant' ? 'Value' : draft.type === 'interval' ? 'Intervals (one per line, e.g. 5m)' : 'Values (one per line)'}>
              <textarea aria-label="Variable values" rows={draft.type === 'constant' ? 1 : 4} value={draft.values.join('\n')} onChange={(e) => set('values', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} className={cn(input, 'h-auto py-1.5')} />
            </Field>
          ) : null}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={draft.multi} disabled={draft.type !== 'dropdown' && draft.type !== 'custom'} onChange={(e) => set('multi', e.target.checked)} className="size-4 accent-[var(--brand-accent)]" /> Multi-value</label>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={draft.includeAll} disabled={draft.type !== 'dropdown' && draft.type !== 'custom'} onChange={(e) => set('includeAll', e.target.checked)} className="size-4 accent-[var(--brand-accent)]" /> Include “All”</label>
          </div>
          {draft.type !== 'constant' ? (
            <Field label="Default value"><input aria-label="Default value" value={Array.isArray(draft.default) ? draft.default.join(', ') : (draft.default ?? '')} onChange={(e) => set('default', e.target.value === '' ? undefined : draft.multi ? e.target.value.split(',').map((x) => x.trim()).filter(Boolean) : e.target.value)} className={input} /></Field>
          ) : null}
          {problem || err ? <p role="alert" className="text-xs text-brand-danger">{err ?? problem}</p> : null}
          <div className="flex gap-2">
            <button type="submit" className={cn(btn, primary)} disabled={!parsed.success}>Save variable</button>
            <button type="button" className={btn} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ Links */

function LinksTab({ s, tryApply, orgSlug, nodeId }: Pick<TabProps, 's' | 'tryApply'> & { orgSlug: string; nodeId: string }) {
  const [nodes, setNodes] = useState<ContentNode[]>([])
  useEffect(() => { void api<{ nodes: ContentNode[] }>(`/api/portal/o/${encodeURIComponent(orgSlug)}/content`, 'GET').then((r) => { if (r.ok) setNodes(r.data.nodes.filter((n) => n.kind === 'dashboard' && n.id !== nodeId)) }) }, [orgSlug, nodeId])
  const blank: DashLink = { label: '', kind: 'dashboard', target: '', newTab: false }
  const [draft, setDraft] = useState<DashLink>(blank)
  const [err, setErr] = useState<string | null>(null)
  const parsed = LinkSchema.safeParse(draft)
  const add = () => {
    if (!parsed.success) return
    const e = tryApply({ ...s, links: [...s.links, parsed.data] })
    setErr(e)
    if (!e) setDraft(blank)
  }
  return (
    <section aria-label="Links" className="space-y-3">
      <p className="text-xs text-brand-text-muted">Links appear under the dashboard title. A link goes to another dashboard in this organisation, or to a web address.</p>
      {s.links.length === 0 ? <p className="text-sm text-brand-text-muted">No links yet.</p> : (
        <ul className="m-0 list-none space-y-1.5 p-0" aria-label="Links">
          {s.links.map((l, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md border border-brand-border p-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{l.label} <span className="text-xs text-brand-text-muted">· {l.kind === 'dashboard' ? nodes.find((n) => n.id === l.target)?.name ?? 'dashboard' : l.target}{l.newTab ? ' · new tab' : ''}</span></span>
              <button type="button" className={btn} aria-label={`Remove link ${l.label}`} onClick={() => tryApply({ ...s, links: s.links.filter((_, k) => k !== i) })}><Trash2 className="size-4" aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
      <form className="space-y-2 rounded-md border border-brand-border-strong p-3" onSubmit={(e) => { e.preventDefault(); add() }} aria-label="Add link">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Label"><input aria-label="Link label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className={input} /></Field>
          <Field label="Goes to">
            <select aria-label="Link type" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as DashLink['kind'], target: '' })} className={input}>
              <option value="dashboard">A dashboard in this organisation</option><option value="url">A web address</option>
            </select>
          </Field>
        </div>
        {draft.kind === 'dashboard' ? (
          <Field label="Dashboard"><select aria-label="Link dashboard" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} className={input}><option value="">Pick a dashboard</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></Field>
        ) : (
          <Field label="Address" hint="http(s)://…, mailto:… or a path starting with /"><input aria-label="Link address" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} className={input} /></Field>
        )}
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={draft.newTab} onChange={(e) => setDraft({ ...draft, newTab: e.target.checked })} className="size-4 accent-[var(--brand-accent)]" /> Open in a new tab</label>
        {err || (!parsed.success && draft.target) ? <p role="alert" className="text-xs text-brand-danger">{err ?? (parsed.success ? '' : parsed.error.issues[0]!.message)}</p> : null}
        <button type="submit" className={cn(btn, primary)} disabled={!parsed.success}><Plus className="size-4" aria-hidden /> Add link</button>
      </form>
    </section>
  )
}

/* ------------------------------------------------------------------ Permissions (mock) */

function PermissionsTab({ orgSlug, nodeId, isAdmin }: { orgSlug: string; nodeId: string; isAdmin: boolean }) {
  const url = `/api/portal/o/${encodeURIComponent(orgSlug)}/dashboards/${encodeURIComponent(nodeId)}/grants`
  const [rows, setRows] = useState<GrantRow[] | null>(null)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  useEffect(() => { void api<{ grants: GrantRow[] }>(url, 'GET').then((r) => (r.ok ? setRows(r.data.grants) : setMsg({ text: r.error, error: true }))) }, [url])
  const upd = (i: number, patch: Partial<GrantRow>) => setRows((r) => r!.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  const save = async () => {
    const r = await api<{ grants: GrantRow[] }>(url, 'PUT', { grants: rows })
    if (r.ok) { setRows(r.data.grants); setMsg({ text: 'Grants saved (mock).' }) } else setMsg({ text: r.error, error: true })
  }
  return (
    <section aria-label="Permissions" className="space-y-3">
      <p className="rounded-md border border-brand-border bg-brand-surface p-2 text-xs text-brand-text-muted">Mock only: these grants live in memory and do not protect anything. Real grants, enforced on the server for every request, arrive in M5.</p>
      <p role={msg?.error ? 'alert' : 'status'} className={cn('min-h-4 text-xs', msg?.error ? 'text-brand-danger' : 'text-brand-text-muted')}>{msg?.text}</p>
      {rows === null ? <p className="text-sm text-brand-text-muted">Loading…</p> : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Who can open this dashboard</caption>
          <thead className="text-xs uppercase tracking-wider text-brand-text-muted"><tr><th scope="col" className="py-1.5 pr-2 font-medium">Who</th><th scope="col" className="py-1.5 pr-2 font-medium">Type</th><th scope="col" className="py-1.5 pr-2 font-medium">Access</th><th scope="col" className="py-1.5 font-medium"><span className="sr-only">Remove</span></th></tr></thead>
          <tbody className="divide-y divide-brand-border">
            {rows.map((g, i) => (
              <tr key={i}>
                <td className="py-1 pr-2"><input aria-label={`Who, row ${i + 1}`} value={g.principal} disabled={!isAdmin} onChange={(e) => upd(i, { principal: e.target.value })} className={input} /></td>
                <td className="py-1 pr-2"><select aria-label={`Type, row ${i + 1}`} value={g.kind} disabled={!isAdmin} onChange={(e) => upd(i, { kind: e.target.value as GrantRow['kind'] })} className={input}><option value="user">User</option><option value="role">Role</option><option value="group">Group</option></select></td>
                <td className="py-1 pr-2"><select aria-label={`Access, row ${i + 1}`} value={g.access} disabled={!isAdmin} onChange={(e) => upd(i, { access: e.target.value as GrantAccess })} className={input}><option value="view">View</option><option value="edit">Edit</option><option value="manage">Manage</option></select></td>
                <td className="py-1">{isAdmin ? <button type="button" className={btn} aria-label={`Remove row ${i + 1}`} onClick={() => setRows((r) => r!.filter((_, k) => k !== i))}><Trash2 className="size-4" aria-hidden /></button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {isAdmin && rows ? (
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={() => setRows((r) => [...r!, { principal: '', kind: 'user', access: 'view', via: 'Direct grant' }])}><Plus className="size-4" aria-hidden /> Add grant</button>
          <button type="button" className={cn(btn, primary)} onClick={() => void save()} disabled={rows.some((r) => r.principal.trim() === '')}>Save grants</button>
        </div>
      ) : <p className="text-xs text-brand-text-muted">Only organisation admins and the director change who has access.</p>}
    </section>
  )
}

/* ------------------------------------------------------------------ JSON Model */

/** Parse text as a dashboard spec. Returns the spec or readable problems (first 12). Never applies anything itself. */
export function validateSpecText(text: string): { ok: true; spec: DashSpec } | { ok: false; errors: string[] } {
  let raw: unknown
  try { raw = JSON.parse(text) } catch (e) { return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] } }
  return parseSpec(raw) // migrates older shapes first, then validates strictly
}

function JsonTab({ dash, isAdmin, onReplace }: { dash: DashSpec; isAdmin: boolean; onReplace: (d: DashSpec) => void }) {
  const current = JSON.stringify(dash, null, 2)
  const [text, setText] = useState(current)
  const [edited, setEdited] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [ok, setOk] = useState(false)
  useEffect(() => { if (!edited) setText(current) }, [current, edited])
  const apply = () => {
    const r = validateSpecText(text)
    if (!r.ok) { setErrors(r.errors); setOk(false); return } // nothing is applied on error
    onReplace(r.spec)
    setErrors([]); setOk(true); setEdited(false)
  }
  return (
    <section aria-label="JSON Model" className="space-y-2">
      <p className="text-xs text-brand-text-muted">The whole dashboard spec (v3), exactly what Save stores. No SQL field exists in it: unknown keys are refused.{isAdmin ? '' : ' Only an admin can edit and apply it.'}</p>
      <textarea aria-label="Dashboard JSON" spellCheck={false} readOnly={!isAdmin} value={text} onChange={(e) => { setText(e.target.value); setEdited(true); setOk(false) }} rows={22} className="scroll-token w-full rounded-md border border-brand-border-strong bg-brand-primary p-2 font-mono text-xs leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" />
      {errors.length > 0 ? (
        <ul role="alert" aria-label="Validation errors" className="m-0 list-none space-y-0.5 rounded-md border border-brand-danger p-2 text-xs text-brand-danger">
          {errors.map((e, i) => <li key={i} className="list-none">{e}</li>)}
          <li className="list-none text-brand-text-muted">Nothing was applied.</li>
        </ul>
      ) : null}
      {ok ? <p role="status" className="text-xs text-brand-text-muted">Applied. You can undo it.</p> : null}
      {isAdmin ? (
        <div className="flex gap-2">
          <button type="button" className={cn(btn, primary)} onClick={apply} disabled={!edited}>Apply</button>
          <button type="button" className={btn} onClick={() => { setText(current); setEdited(false); setErrors([]) }} disabled={!edited}>Reset</button>
        </div>
      ) : null}
    </section>
  )
}
