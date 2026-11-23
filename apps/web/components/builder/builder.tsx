'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { ArrowLeft, Eye, EyeOff, LayoutGrid, Magnet, MoreHorizontal, Redo2, Save, Settings, Undo2 } from 'lucide-react'
import { GlassPanel } from '@/components/fx/glass-panel'
import { addPanel, applyCommand, normalizeSpec, commit, dropPoint, newHistory, redo, removePanel, setPanelSpec, setRect, setZ, tidyUp, undo, ZOOMS, type Cmd, type DashSpec, type DashVersion, type History, type Rect, type Zoom } from '@/lib/builder/model'
import { getPanelType } from '@/lib/panels/registry'
import type { Filters, FilterValue } from '@/lib/panels/types'
import { CATEGORIES } from '@/lib/panels/types'
import { cn } from '@/lib/utils'
import { AssetBar } from './asset-bar'
import { BlocksPanel } from './blocks-panel'
import { Canvas, type SnapSettings } from './canvas'
import { LayoutPanel } from './layout-panel'
import { VersionsPane } from './versions-pane'
import { SettingsView } from './settings-view'
import { BoardBar } from '@/components/dashboards/board-bar'
import { useAutoRefresh } from '@/components/dashboards/use-refresh'
import type { VarValue } from '@/lib/builder/settings'

// Only mounted for the director (server-derived capability), and loaded as its own chunk.
const SqlTerminal = dynamic(() => import('./sql-terminal'), { ssr: false })

type Tab = 'config' | 'json' | 'versions'
const btn = 'flex items-center gap-1.5 rounded-md border border-brand-border-strong px-2.5 py-1.5 text-sm hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-50'

/** Editing needs room for three columns. Below this width we say so instead of showing a broken layout. */
const MIN_EDIT_WIDTH = 1024
const WIDE = `(min-width: ${MIN_EDIT_WIDTH}px)`
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  )
}

/** Every version that enters the editor goes through migrate-and-parse, whatever its age. */
const upgrade = (v: DashVersion): DashVersion => ({ ...v, spec: normalizeSpec(v.spec) })

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Dashboard builder (M3, mock data). The dashboard spec is the single state, kept in an undo
 * history. The canvas, the block panel and the keyboard all produce spec changes through the pure
 * functions in lib/builder/model.ts. Versions are saved through the server route (append-only).
 */
export function Builder({ orgSlug, nodeId, orgName, dashboardName: initialName, initialVersions, showTerminal, isAdmin = false, canDelete = false, systemTz = 'Africa/Johannesburg' }: { orgSlug: string; nodeId: string; orgName: string; dashboardName: string; initialVersions: DashVersion[]; showTerminal: boolean; isAdmin?: boolean; canDelete?: boolean; systemTz?: string }) {
  const [versions, setVersions] = useState<DashVersion[]>(() => initialVersions.map(upgrade))
  const [hist, setHist] = useState<History<DashSpec>>(() => newHistory(structuredClone(normalizeSpec(initialVersions[initialVersions.length - 1]!.spec))))
  const dash = hist.present
  const [filters, setFilters] = useState<Filters>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [assetSel, setAssetSel] = useState<string | null>(null)
  const [dragType, setDragType] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [tab, setTab] = useState<Tab>('config')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const wide = useWide()
  const [confirmExit, setConfirmExit] = useState(false)
  const [dashboardName, setDashboardName] = useState(initialName)
  const [view, setView] = useState<'canvas' | 'settings'>('canvas')
  const [varValues, setVarValues] = useState<Record<string, VarValue>>({})
  const [refreshSel, setRefreshSel] = useState<string | null>(null)
  const [range, setRange] = useState('Last 24 hours')
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!moreOpen) return
    const away = (e: PointerEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [moreOpen])
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [scale, setScale] = useState(1)
  const [guides, setGuides] = useState(false) // snapping is OFF by default
  const [grid, setGrid] = useState<number | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const change = useCallback((fn: (d: DashSpec) => DashSpec, key?: string) => setHist((h) => commit(h, fn(h.present), key)), [])

  const add = (typeId: string, at?: { x: number; y: number }) => {
    const t = getPanelType(typeId)
    if (!t || t.soon || !t.render) return
    const id = `p${Date.now().toString(36)}${++seq.current}`
    change((d) => addPanel(d, typeId, id, at))
    setSelectedId(id)
  }
  const remove = (id: string) => {
    change((d) => removePanel(d, id))
    setSelectedId((s) => (s === id ? null : s))
  }
  const setFilter = (field: string, value: FilterValue | null) =>
    setFilters((f) => {
      const next = { ...f }
      if (value === null) delete next[field]
      else next[field] = value
      return next
    })

  const onCommand = (id: string, c: Cmd) => {
    const newId = `p${Date.now().toString(36)}${++seq.current}`
    const r = applyCommand(dash, id, c, newId)
    // Nudges and resizes by key share one undo step per run; everything else is its own step.
    if (r.dash !== dash) setHist((h) => commit(h, r.dash, c.t === 'nudge' || c.t === 'resize' ? `kbd:${id}:${c.t}` : undefined))
    setSelectedId(r.selectedId)
  }

  const doUndo = () => setHist(undo)
  const doRedo = () => setHist(redo)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return // native text undo wins
      const k = e.key.toLowerCase()
      if (k === 'z') { e.preventDefault(); setHist(e.shiftKey ? redo : undo) }
      else if (k === 'y') { e.preventDefault(); setHist(redo) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const url = `/api/portal/o/${encodeURIComponent(orgSlug)}/dashboards/${encodeURIComponent(nodeId)}/versions`
  async function post(body: unknown, ok: string): Promise<DashVersion[] | null> {
    setBusy(true)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const json = (await res.json().catch(() => ({}))) as { versions?: DashVersion[]; error?: string }
      if (!res.ok || !json.versions) {
        setStatus({ text: json.error ?? `Save failed (${res.status})`, error: true })
        return null
      }
      const upgraded = json.versions.map(upgrade)
      setVersions(upgraded)
      setStatus({ text: ok })
      return upgraded
    } catch {
      setStatus({ text: 'Network error: nothing was saved.', error: true })
      return null
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    const v = await post({ spec: dash, note: note.trim() || undefined }, 'Saved as a new version.')
    if (v) setNote('')
  }
  const restore = async (n: number) => {
    const v = await post({ restore: n }, `Restored v${n} as a new version.`)
    const latest = v?.[v.length - 1]
    if (latest) {
      setHist((h) => commit(h, structuredClone(normalizeSpec(latest.spec))))
      setSelectedId(null)
    }
  }

  function onDragEnd(e: DragEndEvent) {
    setDragType(null)
    if (e.over?.id !== 'canvas' || !String(e.active.id).startsWith('asset:')) return
    const typeId = String(e.active.id).slice(6).split('~')[0]!
    // Place the panel under the cursor: pointer position -> artboard units (undo the CSS scale), clamped.
    const art = document.querySelector<HTMLElement>('[data-artboard]')
    const ev = e.activatorEvent as { clientX?: number; clientY?: number }
    if (art && typeof ev.clientX === 'number' && typeof ev.clientY === 'number') {
      const r = art.getBoundingClientRect()
      const k = Number(art.dataset.scale) || 1
      add(typeId, dropPoint(typeId, (ev.clientX + e.delta.x - r.left) / k, (ev.clientY + e.delta.y - r.top) / k))
    } else add(typeId)
  }

  const refreshInterval = refreshSel ?? dash.settings.time.autoRefresh
  // Preview behaves like the viewer: variables bar, links, refresh (paused while the tab is hidden, never faster than 30s).
  const { tick, last, refreshNow } = useAutoRefresh(preview ? refreshInterval : undefined)
  const orgBase = `/dashboard/o/${encodeURIComponent(orgSlug)}`
  const snap: SnapSettings = { guides, grid }
  const sel = dash.panels.find((p) => p.id === selectedId)
  const selType = sel ? getPanelType(sel.spec.chart) : undefined
  const assetType = assetSel ? getPanelType(assetSel) : undefined
  const latest = versions[versions.length - 1]
  const dirty = !latest || !same(latest.spec, dash)
  const filterChips = Object.entries(filters)
  const backHref = `/dashboard/o/${encodeURIComponent(orgSlug)}/d/${encodeURIComponent(nodeId)}`
  const goBack = () => (dirty ? setConfirmExit(true) : router.push(backHref))
  const saveAndExit = async () => {
    const v = await post({ spec: dash, note: note.trim() || undefined }, 'Saved as a new version.')
    if (v) router.push(backHref)
    else setConfirmExit(false) // the error is shown in the status line; stay in the editor
  }

  // Leaving the page (close tab, reload, typed URL) with unsaved changes asks the browser to confirm.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // Esc goes back (with the confirm if there are unsaved changes), unless Esc already did something else.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || confirmExit) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (document.querySelector('[aria-expanded="true"][aria-haspopup]')) return
      e.preventDefault()
      if (view === 'settings') setView('canvas')
      else if (selectedId) setSelectedId(null)
      else goBack()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  if (!wide) {
    return (
      <div role="status" className="mx-auto mt-10 max-w-md rounded-lg border border-brand-border-strong bg-brand-surface p-6 text-center">
        <h1 className="font-display text-lg font-semibold">Widen the window to edit</h1>
        <p className="mt-2 text-sm text-brand-text-muted">The builder needs at least {MIN_EDIT_WIDTH}px of width. Viewing this dashboard still works at any width.</p>
        <a href={backHref} className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-brand-border-strong px-3 py-1.5 text-sm hover:bg-brand-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"><ArrowLeft className="size-4" aria-hidden /> Back to dashboard</a>
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} onDragStart={(e) => String(e.active.id).startsWith('asset:') && setDragType(String(e.active.id).slice(6).split('~')[0]!)} onDragCancel={() => setDragType(null)} onDragEnd={onDragEnd}>
      <div ref={rootRef} data-editor-root className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-2">
        <div>
          {/* One toolbar row. Secondary canvas tools live in "More"; every control is kept. */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <button type="button" className={btn} onClick={goBack} title="Back to dashboard (Esc)"><ArrowLeft className="size-4" aria-hidden /> Back</button>
              <h1 className="min-w-0 truncate font-display text-base font-semibold">Edit: {dashboardName} <span className="ml-1 text-xs font-normal text-brand-text-muted">v{latest?.n}{dirty ? ' · unsaved changes' : ''}</span></h1>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Builder toolbar">
              <div role="group" aria-label="Zoom" className="flex items-center gap-1">
                {ZOOMS.map((z) => (
                  <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)} className={cn(btn, 'px-2 py-1 text-xs', zoom === z && 'bg-brand-surface-raised font-semibold')}>{z === 'fit' ? 'Fit width' : `${z}%`}</button>
                ))}
                <span className="ml-1 text-xs tabular-nums text-brand-text-muted" aria-live="polite">{Math.round(scale * 100)}%</span>
              </div>
              <button type="button" className={btn} onClick={doUndo} disabled={hist.past.length === 0} title="Undo (Ctrl+Z)"><Undo2 className="size-4" aria-hidden /> Undo</button>
              <button type="button" className={btn} onClick={doRedo} disabled={hist.future.length === 0} title="Redo (Ctrl+Shift+Z)"><Redo2 className="size-4" aria-hidden /> Redo</button>
              <button type="button" className={btn} aria-pressed={preview} onClick={() => { setPreview((p) => !p); setSelectedId(null) }}>
                {preview ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />} Preview
              </button>
              <button type="button" className={btn} aria-pressed={view === 'settings'} onClick={() => setView((v) => (v === 'settings' ? 'canvas' : 'settings'))} title="Dashboard settings"><Settings className="size-4" aria-hidden /> Settings</button>
              <div className="relative" ref={moreRef}>
                <button type="button" className={btn} aria-haspopup="true" aria-expanded={moreOpen} aria-controls="more-tools" onClick={() => setMoreOpen((o) => !o)}><MoreHorizontal className="size-4" aria-hidden /> More</button>
                {moreOpen ? (
                  <div id="more-tools" role="group" aria-label="Canvas tools" className="absolute right-0 top-full z-30 mt-1 w-72 space-y-2 rounded-lg border border-brand-border-strong bg-brand-surface p-3 shadow-xl" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMoreOpen(false) } }}>
                    <button type="button" className={cn(btn, 'w-full px-2 py-1 text-xs')} aria-pressed={guides} onClick={() => setGuides((g) => !g)} title="Smart alignment guides and snapping to other panels and the artboard edges. Hold Alt to flip it while dragging."><Magnet className="size-3.5" aria-hidden /> Snap to panels</button>
                    <label className="flex items-center justify-between gap-2 text-xs">Grid snap
                      <select value={grid ?? ''} onChange={(e) => setGrid(e.target.value === '' ? null : Number(e.target.value))} className="h-7 rounded-md border border-brand-border-strong bg-brand-primary px-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
                        <option value="">Off</option><option value="8">8</option><option value="16">16</option><option value="24">24</option>
                      </select>
                    </label>
                    <button type="button" className={cn(btn, 'w-full px-2 py-1 text-xs')} onClick={() => { change((d) => tidyUp(d)); setMoreOpen(false) }} disabled={dash.panels.length < 2} title="Arrange panels into rows that do not overlap"><LayoutGrid className="size-3.5" aria-hidden /> Tidy up</button>
                    <p className="text-xs text-brand-text-muted">Shift locks one axis · Alt flips snapping</p>
                  </div>
                ) : null}
              </div>
              <button type="button" className={cn(btn, 'bg-brand-accent text-brand-accent-fg hover:bg-brand-accent')} onClick={() => void save()} disabled={busy || !dirty}><Save className="size-4" aria-hidden /> Save version</button>
            </div>
          </div>
          {status ? <p className={cn('mt-1 truncate text-xs', status.error ? 'text-brand-danger' : 'text-brand-text-muted')} role={status.error ? 'alert' : 'status'} aria-live="polite">{status.text}</p> : null}
        </div>

        {view === 'settings' ? (
          <GlassPanel data-editor-col="settings-host" tone={2} spotlight={false} sheen={false} className="fx-fill min-h-0 overflow-hidden">
            <SettingsView dash={dash} onChange={(fn, key) => change(fn, key)} onReplace={(d) => { change(() => d); setSelectedId(null) }} versions={versions} note={note} onNote={setNote} busy={busy} onRestore={(n) => void restore(n)} isAdmin={isAdmin} canDelete={canDelete} orgSlug={orgSlug} nodeId={nodeId} dashboardName={dashboardName} systemTz={systemTz} onRenamed={setDashboardName} onClose={() => setView('canvas')} />
          </GlassPanel>
        ) : (
        <>
        {/* The implicit row MUST be minmax(0,1fr): an auto row grows to its content and the columns never scroll. */}
        <div data-editor-columns className={cn('grid min-h-0 grid-rows-[minmax(0,1fr)] gap-3', preview ? 'grid-cols-1' : 'grid-cols-[18rem_minmax(0,1fr)_22rem]')}>
          {preview ? null : (
            <GlassPanel data-editor-col="assets" tone={2} spotlight={false} sheen={false} className="fx-fill min-h-0 overflow-hidden">
              <AssetBar selectedId={assetType?.id ?? null} onSelect={setAssetSel} onAdd={add} />
            </GlassPanel>
          )}

          <div data-editor-col="canvas" className="flex min-h-0 min-w-0 flex-col">
            {filterChips.length > 0 ? (
              <p className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5 text-xs" aria-live="polite">
                <span className="text-brand-text-muted">Filters:</span>
                {filterChips.map(([k, v]) => <span key={k} className="rounded-full border border-brand-border-strong px-2 py-0.5">{k} = {Array.isArray(v) ? v.join(' to ') : v}</span>)}
                <button type="button" onClick={() => setFilters({})} className="rounded px-1 text-brand-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">Clear</button>
              </p>
            ) : null}
            {preview ? <BoardBar settings={dash.settings} values={varValues} onValue={(n, v) => setVarValues((x) => ({ ...x, ['$' + n]: v }))} systemTz={systemTz} tick={tick} last={last} refreshInterval={refreshInterval} onRefreshInterval={setRefreshSel} onRefreshNow={refreshNow} nodeHref={(id) => orgBase + '/d/' + encodeURIComponent(id)} range={range} onRange={setRange} /> : null}
            <div className="min-h-0 flex-1">
              <Canvas dash={dash} varValues={varValues} tick={tick} selectedId={selectedId} preview={preview} filters={filters} zoom={zoom} snap={snap} onSelect={setSelectedId} onCommit={(d) => change(() => d)} onCommand={onCommand} setFilter={setFilter} onScale={setScale} />
            </div>
          </div>

          {preview ? null : (
            <GlassPanel data-editor-col="config" tone={2} spotlight={false} sheen={false} className="fx-fill min-h-0 overflow-hidden">
              <div data-scroll="config" className="scroll-token h-full min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain break-words p-3">
                <div role="tablist" aria-label="Panel editor" className="mb-3 flex flex-wrap gap-1">
                  {([['config', 'Blocks'], ['json', 'Spec JSON'], ['versions', `Versions (${versions.length})`]] as const).map(([id, label]) => (
                    <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`pane-${id}`} onClick={() => setTab(id)} className={cn('rounded-md px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent', tab === id ? 'bg-brand-surface-raised font-semibold' : 'text-brand-text-muted hover:bg-brand-surface')}>{label}</button>
                  ))}
                </div>
                {tab === 'config' ? (
                  <div role="tabpanel" id="pane-config" aria-labelledby="tab-config">
                    {sel && selType ? (
                      <>
                      <LayoutPanel panel={sel} onRect={(r: Rect, key) => change((d) => setRect(d, sel.id, r), key)} onZ={(z, key) => change((d) => setZ(d, sel.id, z), key)} onCommand={(c) => onCommand(sel.id, c)} />
                      <BlocksPanel key={sel.id} panelId={sel.id} spec={sel.spec} onChange={(s, key) => change((d) => setPanelSpec(d, sel.id, s), key ? `${key}` : undefined)} />
                      </>
                    ) : assetType ? (
                      <div className="space-y-1.5 text-xs">
                        <p className="text-sm font-medium">{assetType.label}</p>
                        <p className="text-brand-text-muted">{assetType.description}</p>
                        <p><span className="text-brand-text-muted">Category:</span> {CATEGORIES.find((c) => c.id === assetType.category)?.label}</p>
                        <p><span className="text-brand-text-muted">Default size:</span> {assetType.size.w} × {assetType.size.h} <span className="text-brand-text-muted">· smallest:</span> {assetType.min.w} × {assetType.min.h}</p>
                        <p className="text-brand-text-muted">Press Enter on it, or drag it onto the canvas.</p>
                      </div>
                    ) : (
                      <p className="text-xs text-brand-text-muted">Select a panel on the canvas to edit its blocks, or select an asset to see its details.</p>
                    )}
                  </div>
                ) : null}
                {tab === 'json' ? (
                  <div role="tabpanel" id="pane-json" aria-labelledby="tab-json">
                    <p className="mb-1 text-xs text-brand-text-muted">Dashboard spec v3 (free-form layout in artboard units, with settings). This is exactly what Save stores. There is no SQL in it.</p>
                    <pre tabIndex={0} aria-label="Dashboard spec JSON" className="whitespace-pre-wrap break-all rounded-md border border-brand-border bg-brand-primary p-2 text-[11px] leading-snug">{JSON.stringify(dash, null, 2)}</pre>
                  </div>
                ) : null}
                {tab === 'versions' ? (
                  <div role="tabpanel" id="pane-versions" aria-labelledby="tab-versions">
                    <VersionsPane versions={versions} note={note} onNote={setNote} busy={busy} onRestore={(n) => void restore(n)} />
                  </div>
                ) : null}
              </div>
            </GlassPanel>
          )}
        </div>

        </>
        )}

        {/* Terminal row: docked, never overlays anything. Absent (not disabled) for everyone but the director. */}
        {!preview && showTerminal ? <SqlTerminal orgName={orgName} capPx={() => Math.floor((rootRef.current?.clientHeight ?? window.innerHeight) * 0.5)} /> : null}
      </div>

      {confirmExit ? <ExitDialog busy={busy} onSave={() => void saveAndExit()} onDiscard={() => router.push(backHref)} onCancel={() => setConfirmExit(false)} /> : null}
      <DragOverlay dropAnimation={null}>{dragType ? <div className="rounded-md border border-brand-border-strong bg-brand-surface-raised px-2 py-1 text-sm shadow-lg">{getPanelType(dragType)?.label}</div> : null}</DragOverlay>
    </DndContext>
  )
}

/** Unsaved-changes confirm: Save and exit / Discard / Cancel. Esc cancels; focus starts on the safe choice. */
export function ExitDialog({ busy, onSave, onDiscard, onCancel }: { busy: boolean; onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() } }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="exit-title" aria-describedby="exit-desc" className="w-full max-w-sm rounded-lg border border-brand-border-strong bg-brand-surface p-5 shadow-xl">
        <h2 id="exit-title" className="font-display text-base font-semibold">Unsaved changes</h2>
        <p id="exit-desc" className="mt-1 text-sm text-brand-text-muted">This dashboard has changes that are not saved as a version yet.</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button ref={first} type="button" className={btn} onClick={onCancel}>Cancel</button>
          <button type="button" className={btn} onClick={onDiscard}>Discard</button>
          <button type="button" className={cn(btn, 'bg-brand-accent text-brand-accent-fg hover:bg-brand-accent')} disabled={busy} onClick={onSave}>Save and exit</button>
        </div>
      </div>
    </div>
  )
}
