'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Search, ShieldCheck, Trash2, X, Zap } from 'lucide-react'
import { useFormat } from '@/components/fx/format-context'
import { GlassPanel } from '@/components/fx/glass-panel'
import { INTEGRATION_KINDS, SSL_MODES, type AllowedHost, type AuditEntry, type IntegrationRow } from '@/lib/admin/types'
import { CATEGORIES, STATUS_LABEL, canAdd, categoryOf, connectorById, filterCatalogue, type Connector, type StateFilter, type TypeFilter } from '@/lib/admin/connectors'
import { cn } from '@/lib/utils'
import { Drawer, Field, MockBanner, Pill, SCROLL, Status, api, btnCls, dangerCls, inputCls, primaryCls, useBusy } from './ui'

interface Data { rows: IntegrationRow[]; hosts: AllowedHost[]; audit: AuditEntry[]; canManageHosts: boolean }
interface Draft { id?: string; name: string; kind: 'postgres'; host: string; port: string; database: string; relations: string; sslMode: (typeof SSL_MODES)[number]; credentials: string; replacing: boolean; saved: IntegrationRow | null }
type Msg = { text: string; error?: boolean } | null

const blank = (hosts: AllowedHost[]): Draft => ({ name: '', kind: 'postgres', host: hosts[0]?.host ?? '', port: String(hosts[0]?.portMin ?? 5432), database: '', relations: '', sslMode: 'verify-full', credentials: '', replacing: true, saved: null })
const fromRow = (r: IntegrationRow): Draft => ({ id: r.id, name: r.name, kind: r.kind, host: r.host, port: String(r.port), database: r.database, relations: r.relations.join(', '), sslMode: r.sslMode, credentials: '', replacing: !r.hasCredentials, saved: r })
const BANNER_KEY = 'omni.integrations.securityBannerDismissed'

/** Neutral icon tile, tinted by category. No brand logos. */
function Tile({ category }: { category: Connector['category'] }) {
  const c = categoryOf(category); const Icon = c.icon
  return <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg border border-current" style={{ color: `var(--chart-${c.tint})`, background: 'color-mix(in srgb, currentColor 14%, transparent)' }}><Icon className="size-5" /></span>
}

function testState(r: IntegrationRow): { label: string; tone: 'ok' | 'bad' | 'muted' } {
  if (!r.lastTest) return { label: 'Never tested', tone: 'muted' }
  return r.lastTest.ok ? { label: 'OK', tone: 'ok' } : { label: 'Failing', tone: 'bad' }
}

const cardBtn = 'block h-full w-full rounded-[inherit] p-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-accent aria-disabled:cursor-not-allowed'

export function IntegrationsView({ orgSlug, orgName }: { orgSlug: string; orgName: string }) {
  const base = `/api/portal/o/${encodeURIComponent(orgSlug)}/integrations`
  const fmt = useFormat()
  const [data, setData] = useState<Data | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [drawerMsg, setDrawerMsg] = useState<Msg>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [hostsOpen, setHostsOpen] = useState(false)
  const [bannerOpen, setBannerOpen] = useState(true)
  const [q, setQ] = useState(''); const [type, setType] = useState<TypeFilter>('all'); const [state, setState] = useState<StateFilter>('all')
  const [busy, run] = useBusy()

  useEffect(() => { try { if (localStorage.getItem(BANNER_KEY) === '1') setBannerOpen(false) } catch { /* storage blocked: banner stays */ } }, [])
  const dismiss = () => { setBannerOpen(false); try { localStorage.setItem(BANNER_KEY, '1') } catch { /* ignore */ } }

  const load = useCallback(async () => {
    const r = await api<Data>(base, 'GET')
    if (r.ok) setData(r.data); else setMsg({ text: r.error, error: true })
  }, [base])
  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => filterCatalogue({ q, type, state }, data?.rows ?? []), [q, type, state, data])
  const open = data?.rows.find((r) => r.id === detail) ?? null

  const test = (id: string) => run(async () => {
    const r = await api<{ row: IntegrationRow }>(base, 'POST', { op: 'test', id })
    setMsg(r.ok ? { text: r.data.row.lastTest?.ok ? 'Connection test passed (mock).' : 'Connection test failed (mock).', error: !r.data.row.lastTest?.ok } : { text: r.error, error: true })
    await load()
  })
  const remove = (r: IntegrationRow) => run(async () => {
    if (!window.confirm(`Delete "${r.name}"? Panels using it will stop loading.`)) return
    const x = await api(base, 'POST', { op: 'delete', id: r.id })
    setMsg(x.ok ? { text: `Deleted ${r.name}.` } : { text: x.error, error: true })
    if (x.ok) setDetail(null)
    await load()
  })
  const save = () => run(async () => {
    if (!draft) return
    const r = await api<{ row: IntegrationRow }>(base, 'POST', { op: 'save', input: { id: draft.id, name: draft.name, kind: draft.kind, host: draft.host, port: Number(draft.port), database: draft.database, relations: draft.relations.split(/[\s,]+/).filter(Boolean), sslMode: draft.sslMode, credentials: draft.credentials || undefined } })
    if (!r.ok) { setDrawerMsg({ text: r.error, error: true }); return }
    setDraft(null); setDrawerMsg(null); setMsg({ text: `Saved ${r.data.row.name}.` }); await load()
  })

  const hostEntry = data?.hosts.find((h) => h.host === draft?.host)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))
  const none = data && shown.connected.length === 0 && shown.available.length === 0
  const noConnections = data && data.rows.length === 0

  return (
    <div data-page-frame className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-semibold leading-tight">Integrations</h1>
          <p className="text-sm text-brand-text-muted">{orgName}: connect the data sources this organisation can read.</p>
        </div>
        {data?.canManageHosts ? <button type="button" className={btnCls} onClick={() => setHostsOpen(true)}><ShieldCheck className="size-4" aria-hidden /> Allowed hosts</button> : null}
      </div>

      {bannerOpen ? (
        <div role="note" className="mb-2 flex shrink-0 items-start justify-between gap-2 rounded-md border border-brand-border-strong px-3 py-1.5 text-xs">
          <span><ShieldCheck className="mr-1.5 inline size-3.5 align-text-bottom" aria-hidden />Credentials are encrypted and write-only. Hosts come from an allowlist.</span>
          <button type="button" aria-label="Dismiss security note" onClick={dismiss} className="rounded p-0.5 hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"><X className="size-3.5" aria-hidden /></button>
        </div>
      ) : null}
      <MockBanner />

      <div role="search" className="mb-2 flex shrink-0 flex-wrap items-end gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <label htmlFor="c-search" className="sr-only">Search connectors and connections</label>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-brand-text-muted" aria-hidden />
          <input id="c-search" type="search" className={cn(inputCls, 'pl-8')} placeholder="Search connectors and connections" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div><label htmlFor="c-type" className="mb-0.5 block text-xs font-medium">Type</label>
          <select id="c-type" className={cn(inputCls, 'w-40')} value={type} onChange={(e) => setType(e.target.value as TypeFilter)}>
            <option value="all">All</option>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select></div>
        <div><label htmlFor="c-state" className="mb-0.5 block text-xs font-medium">State</label>
          <select id="c-state" className={cn(inputCls, 'w-36')} value={state} onChange={(e) => setState(e.target.value as StateFilter)}>
            <option value="all">All</option><option value="connected">Connected</option><option value="available">Available</option>
          </select></div>
      </div>
      <Status msg={msg} />

      <div data-scroll="grid" className={cn(SCROLL, 'flex-1 space-y-4 pr-1')} tabIndex={-1}>
        {none ? (
          <GlassPanel tone="data" className="p-6 text-center text-sm text-brand-text-muted" role="status">
            No connectors or connections match “{q}”. <button type="button" className="ml-1 text-brand-accent underline" onClick={() => { setQ(''); setType('all'); setState('all') }}>Clear filters</button>
          </GlassPanel>
        ) : null}

        {state !== 'available' && data && !none ? (
          <section aria-labelledby="sec-connected">
            <h2 id="sec-connected" className="mb-1.5 font-display text-sm font-semibold">Connected <span className="font-normal text-brand-text-muted">({shown.connected.length})</span></h2>
            {shown.connected.length === 0 ? (
              <GlassPanel tone="data" className="p-4 text-sm text-brand-text-muted">{noConnections ? 'No connections yet. Pick PostgreSQL below to add the first one.' : 'No connection matches the filters.'}</GlassPanel>
            ) : (
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 p-0">
                {shown.connected.map((r) => {
                  const st = testState(r)
                  return (
                    <li key={r.id} className="list-none">
                      <GlassPanel tone={2} spotlight={false} className="h-full p-0">
                        <button type="button" className={cardBtn} onClick={() => setDetail(r.id)} aria-label={`${r.name}, ${connectorById(r.kind)?.name ?? r.kind}, ${st.label}. Open details`}>
                          <span className="flex items-start gap-3">
                            <Tile category={connectorById(r.kind)?.category ?? 'other'} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{r.name}</span>
                              <span className="block truncate text-xs text-brand-text-muted">{connectorById(r.kind)?.name ?? r.kind} · <span className="tabular">{r.host}:{r.port}</span></span>
                            </span>
                          </span>
                          <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            <Pill tone={st.tone}>{st.label}</Pill>
                            {r.managed ? <Pill tone="info">Managed</Pill> : null}
                            <span className="ml-auto text-xs text-brand-text-muted">Used by {r.usedBy} dashboard{r.usedBy === 1 ? '' : 's'}</span>
                          </span>
                        </button>
                      </GlassPanel>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ) : null}

        {state !== 'connected' && data && !none ? (
          <section aria-labelledby="sec-available">
            <h2 id="sec-available" className="mb-1.5 font-display text-sm font-semibold">Available connectors <span className="font-normal text-brand-text-muted">({shown.available.length})</span></h2>
            {shown.available.length === 0 ? <GlassPanel tone="data" className="p-4 text-sm text-brand-text-muted">No connector matches the filters.</GlassPanel> : (
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 p-0">
                {shown.available.map((c) => {
                  const ok = canAdd(c)
                  return (
                    <li key={c.id} className="list-none">
                      <GlassPanel tone={2} spotlight={false} className={cn('h-full p-0', !ok && 'opacity-80')}>
                        <button type="button" className={cardBtn} aria-disabled={!ok} aria-describedby={`why-${c.id}`} data-connector={c.id}
                          onClick={() => { if (ok && data) { setDraft(blank(data.hosts)); setDrawerMsg(null) } }}>
                          <span className="flex items-start gap-3">
                            <Tile category={c.category} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{c.name}</span>
                              <span className="block truncate text-xs text-brand-text-muted">{c.publisher}</span>
                            </span>
                            <Pill tone={ok ? 'ok' : 'muted'}>{STATUS_LABEL[c.status]}</Pill>
                          </span>
                          <span className="mt-2 block text-xs text-brand-text-muted">{c.description}</span>
                          <span id={`why-${c.id}`} className="mt-2 flex items-start gap-1.5 text-xs">
                            {ok ? <span className={cn(primaryCls, 'pointer-events-none px-2 py-1 text-xs')}><Plus className="size-3.5" aria-hidden /> Add connection</span>
                              : <><span className={cn(btnCls, 'pointer-events-none px-2 py-1 text-xs opacity-60')}><Plus className="size-3.5" aria-hidden /> Add connection (not available)</span><span className="text-brand-text-muted">{c.reason}</span></>}
                          </span>
                        </button>
                      </GlassPanel>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      {open ? (
        <Drawer title={open.name} onClose={() => setDetail(null)} footer={<>
          <button type="button" className={btnCls} onClick={() => void test(open.id)} disabled={busy} aria-label={`Test connection for ${open.name}`}><Zap className="size-3.5" aria-hidden /> Test connection</button>
          {open.managed ? null : (
            <>
              <button type="button" className={btnCls} onClick={() => { setDraft(fromRow(open)); setDrawerMsg(null); setDetail(null) }} aria-label={`Edit ${open.name}`}><Pencil className="size-3.5" aria-hidden /> Edit</button>
              <button type="button" className={dangerCls} onClick={() => void remove(open)} disabled={busy} aria-label={`Delete ${open.name}`}><Trash2 className="size-3.5" aria-hidden /> Delete</button>
            </>
          )}
        </>}>
          <div className="flex flex-wrap items-center gap-1.5"><Pill tone={testState(open).tone}>{testState(open).label}</Pill>{open.managed ? <Pill tone="info">Managed</Pill> : null}</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-brand-text-muted">Kind</dt><dd>{connectorById(open.kind)?.name ?? open.kind}</dd>
            <dt className="text-brand-text-muted">Host</dt><dd className="tabular">{open.host}:{open.port}</dd>
            <dt className="text-brand-text-muted">Database</dt><dd>{open.database}</dd>
            <dt className="text-brand-text-muted">Allowed</dt><dd>{open.relations.join(', ') || 'None yet'}</dd>
            <dt className="text-brand-text-muted">SSL mode</dt><dd>{open.sslMode}</dd>
            <dt className="text-brand-text-muted">Used by</dt><dd>{open.usedBy} dashboard{open.usedBy === 1 ? '' : 's'}</dd>
            <dt className="text-brand-text-muted">Credentials</dt><dd>{open.managed ? 'No stored secret. Read-only role from the server environment.' : open.hasCredentials ? `Saved, key ${open.keyId}, rotated ${open.rotatedAt ? fmt.date(open.rotatedAt) : 'never'}` : 'None'}</dd>
            <dt className="text-brand-text-muted">Last test</dt><dd>{open.lastTest ? `${open.lastTest.ok ? 'Passed' : 'Failed'}, ${fmt.dateTime(open.lastTest.at)}. ${open.lastTest.message}` : 'Never tested'}</dd>
          </dl>
          <h3 className="pt-1 text-xs font-medium text-brand-text-muted">Recent activity</h3>
          <ul className="space-y-0.5 text-xs text-brand-text-muted">
            {(data?.audit ?? []).filter((e) => e.targetId === open.id).slice(0, 6).map((e) => <li key={e.id} className="list-none"><span className="tabular">{fmt.dateTime(e.at)}</span> · {e.actor} · {e.action}</li>)}
          </ul>
          <Status msg={msg} />
        </Drawer>
      ) : null}

      {hostsOpen && data ? (
        <Drawer title="Allowed hosts" onClose={() => setHostsOpen(false)}>
          <HostsManager base={base} hosts={data.hosts} canManage={data.canManageHosts} onChange={load} setMsg={setMsg} />
          <Status msg={msg} />
        </Drawer>
      ) : null}

      {draft ? (
        <Drawer title={draft.id ? `Edit ${draft.saved?.name}` : 'Add integration'} onClose={() => setDraft(null)} footer={<>
          <button type="button" className={btnCls} onClick={() => setDraft(null)}>Cancel</button>
          <button type="button" className={primaryCls} onClick={() => void save()} disabled={busy}>Save</button>
        </>}>
          <MockBanner />
          <Field id="i-name" label="Name"><input id="i-name" className={inputCls} value={draft.name} maxLength={60} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field id="i-kind" label="Kind" hint={`SQLite: Deferred. ${INTEGRATION_KINDS[2].reason}`}>
            <select id="i-kind" className={inputCls} value="postgres" onChange={() => undefined} aria-describedby="i-kind-hint">
              {INTEGRATION_KINDS.map((k) => <option key={k.id} value={k.id} disabled={!k.available}>{k.label}{k.available ? '' : ` (${'note' in k ? k.note : ''})`}</option>)}
            </select>
          </Field>
          <Field id="i-host" label="Host" hint="Chosen from the list the director allows. It cannot be typed.">
            <select id="i-host" className={inputCls} value={draft.host} onChange={(e) => { const h = data?.hosts.find((x) => x.host === e.target.value); setDraft((d) => (d ? { ...d, host: e.target.value, port: String(h?.portMin ?? d.port) } : d)) }}>
              {(data?.hosts ?? []).map((h) => <option key={h.id} value={h.host}>{h.host} (ports {h.portMin === h.portMax ? h.portMin : `${h.portMin} to ${h.portMax}`})</option>)}
            </select>
          </Field>
          <Field id="i-port" label="Port" hint={hostEntry ? `Allowed: ${hostEntry.portMin} to ${hostEntry.portMax}` : undefined}><input id="i-port" className={inputCls} inputMode="numeric" value={draft.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, '').slice(0, 5))} /></Field>
          <Field id="i-db" label="Database"><input id="i-db" className={inputCls} value={draft.database} maxLength={63} onChange={(e) => set('database', e.target.value)} /></Field>
          <Field id="i-rel" label="Schemas or relations allowed" hint="Comma separated. Datasets can only read what is listed here."><input id="i-rel" className={inputCls} value={draft.relations} onChange={(e) => set('relations', e.target.value)} /></Field>
          <Field id="i-ssl" label="SSL mode"><select id="i-ssl" className={inputCls} value={draft.sslMode} onChange={(e) => set('sslMode', e.target.value as Draft['sslMode'])}>{SSL_MODES.map((m) => <option key={m}>{m}</option>)}</select></Field>
          {draft.saved?.hasCredentials && !draft.replacing ? (
            <div className="rounded-md border border-brand-border p-2.5 text-sm">
              <p>Credentials saved, key {draft.saved.keyId}, rotated {draft.saved.rotatedAt ? fmt.date(draft.saved.rotatedAt) : 'never'}.</p>
              <button type="button" className={`${btnCls} mt-2`} onClick={() => set('replacing', true)}>Replace credentials</button>
            </div>
          ) : (
            <Field id="i-cred" label={draft.saved?.hasCredentials ? 'New credentials' : 'Credentials'} hint={draft.saved?.hasCredentials ? 'Leave empty to keep the saved credentials. Saved credentials are never shown again.' : 'Write-only: after saving they are never shown again.'}>
              <input id="i-cred" type="password" autoComplete="new-password" spellCheck={false} className={inputCls} value={draft.credentials} onChange={(e) => set('credentials', e.target.value)} />
            </Field>
          )}
          <Status msg={drawerMsg} />
        </Drawer>
      ) : null}
    </div>
  )
}

function HostsManager({ base, hosts, canManage, onChange, setMsg }: { base: string; hosts: AllowedHost[]; canManage: boolean; onChange: () => Promise<void>; setMsg: (m: Msg) => void }) {
  const [host, setHost] = useState(''); const [min, setMin] = useState('5432'); const [max, setMax] = useState('5432')
  const [busy, run] = useBusy()
  const add = () => run(async () => {
    const r = await api(base, 'POST', { op: 'host.add', host: { host, portMin: Number(min), portMax: Number(max) } })
    setMsg(r.ok ? { text: `Allowed ${host}.` } : { text: r.error, error: true })
    if (r.ok) setHost('')
    await onChange()
  })
  const remove = (h: AllowedHost) => run(async () => {
    const r = await api(base, 'POST', { op: 'host.remove', id: h.id })
    setMsg(r.ok ? { text: `Removed ${h.host}.` } : { text: r.error, error: true })
    await onChange()
  })
  return (
    <div>
      <p className="mb-2 text-xs text-brand-text-muted">{canManage ? 'You manage this list. Organisation admins can only pick from it.' : 'Managed by the director. You can only pick from it.'}</p>
      <ul className="space-y-1 text-sm">
        {hosts.map((h) => (
          <li key={h.id} className="flex list-none items-center justify-between gap-2 rounded border border-brand-border px-2 py-1">
            <span><span className="tabular">{h.host}</span> <span className="text-xs text-brand-text-muted">ports {h.portMin === h.portMax ? h.portMin : `${h.portMin} to ${h.portMax}`}</span></span>
            {canManage ? <button type="button" className={dangerCls} onClick={() => void remove(h)} disabled={busy} aria-label={`Remove host ${h.host}`}><Trash2 className="size-3.5" aria-hidden /></button> : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
          <Field id="h-host" label="Host"><input id="h-host" className={inputCls} value={host} onChange={(e) => setHost(e.target.value)} maxLength={120} /></Field>
          <Field id="h-min" label="Port from"><input id="h-min" className={`${inputCls} w-24`} inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field id="h-max" label="Port to"><input id="h-max" className={`${inputCls} w-24`} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} /></Field>
          <button type="submit" className={primaryCls} disabled={busy || !host}>Allow host</button>
        </form>
      ) : null}
    </div>
  )
}
