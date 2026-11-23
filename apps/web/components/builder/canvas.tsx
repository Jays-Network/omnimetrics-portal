'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { Copy, Lock, LockOpen, MoveDown, MoveUp, Trash2 } from 'lucide-react'
import { Artboard, PanelCell, StaticBoard, extraFor, panelBox, syncIdFor } from '@/components/panels/artboard'
import { ChartSyncContext } from '@/components/panels/chart-sync'
import type { VarValue } from '@/lib/builder/settings'
import {
  ART_W, HANDLES, HANDLE_CURSOR, artboardHeight, dragRect, keyCommand, lockAxis, minSizeOf, setRect,
  type Cmd, type DashPanel, type DashSpec, type Guide, type Handle, type Rect, type Zoom,
} from '@/lib/builder/model'
import type { Filters, FilterValue } from '@/lib/panels/types'
import { cn } from '@/lib/utils'

export const KEY_HELP = 'Arrows nudge, Shift+arrows nudge by 10, Alt+arrows resize, Delete removes, Ctrl+D duplicates, [ and ] change stacking, Esc deselects.'

export interface SnapSettings { guides: boolean; grid: number | null }

interface Live { id: string; mode: 'move' | 'resize'; rect: Rect }
interface DragState {
  id: string
  mode: 'move' | 'resize'
  handle?: Handle
  sx: number
  sy: number
  start: Rect
  min: { w: number; h: number }
  others: Rect[]
  scale: number
  artH: number
  pending: { cx: number; cy: number; shift: boolean; alt: boolean } | null
  raf: number
  result: Rect
  moved: boolean
}

const INTERACTIVE = 'button, input, select, textarea, a, label, summary, [data-no-drag]'

/** Handle positions as fractions of the rect: [fx, fy]. */
const HANDLE_POS: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] }

/**
 * Free-form editor canvas. Pointer events with pointer capture; during a drag only a throttled (rAF)
 * live rect changes (move uses a CSS transform), and the layout is committed once on pointer-up.
 * Snapping (guides to other panels / the artboard, optional grid) is OFF by default; Alt toggles it
 * while held, Shift locks a move to one axis. Resize handles and the selection toolbar live in an
 * overlay above all panels, so panel overflow never clips them.
 */
export function Canvas({ dash, selectedId, preview, filters, varValues = {}, tick = 0, zoom, snap, onSelect, onCommit, onCommand, setFilter, onScale }: {
  dash: DashSpec
  selectedId: string | null
  preview: boolean
  filters: Filters
  varValues?: Record<string, VarValue>
  tick?: number
  zoom: Zoom
  snap: SnapSettings
  onSelect: (id: string | null) => void
  /** Final dashboard after a pointer drag or resize (one undo step). */
  onCommit: (d: DashSpec) => void
  onCommand: (id: string, c: Cmd) => void
  setFilter: (field: string, value: FilterValue | null) => void
  onScale?: (scale: number) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas' })
  const [live, setLive] = useState<Live | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const drag = useRef<DragState | null>(null)
  const dashRef = useRef(dash)
  dashRef.current = dash
  const snapRef = useRef(snap)
  snapRef.current = snap

  const compute = useCallback((d: DragState) => {
    const p = d.pending
    if (!p) return { rect: d.result, guides: [] as Guide[] }
    let dx = (p.cx - d.sx) / d.scale
    let dy = (p.cy - d.sy) / d.scale
    if (d.mode === 'move' && p.shift) [dx, dy] = lockAxis(dx, dy)
    const s = snapRef.current
    const active = s.guides || s.grid !== null
    // Alt toggles snapping while held: off if anything is on, otherwise smart guides on.
    const useGuides = p.alt ? !active : s.guides
    const grid = p.alt ? null : s.grid
    return dragRect(d.start, d.handle, dx, dy, d.min, d.others, { guides: useGuides, grid, threshold: 6 / d.scale, artH: d.artH })
  }, [])

  const flush = useCallback(() => {
    const d = drag.current
    if (!d) return
    d.raf = 0
    const { rect, guides: g } = compute(d)
    d.result = rect
    setLive({ id: d.id, mode: d.mode, rect })
    setGuides(g)
  }, [compute])

  const begin = (e: React.PointerEvent, p: DashPanel, mode: 'move' | 'resize', handle: Handle | undefined, scale: number) => {
    if (e.button !== 0 || p.layout.locked || preview) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = {
      id: p.id, mode, handle, sx: e.clientX, sy: e.clientY, start: { x: p.layout.x, y: p.layout.y, w: p.layout.w, h: p.layout.h },
      min: minSizeOf(p), others: dashRef.current.panels.filter((q) => q.id !== p.id).map((q) => ({ x: q.layout.x, y: q.layout.y, w: q.layout.w, h: q.layout.h })),
      scale, artH: artboardHeight(dashRef.current.panels), pending: null, raf: 0, result: { x: p.layout.x, y: p.layout.y, w: p.layout.w, h: p.layout.h }, moved: false,
    }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    d.pending = { cx: e.clientX, cy: e.clientY, shift: e.shiftKey, alt: e.altKey }
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return // a click is not a drag
    d.moved = true
    if (!d.raf) d.raf = requestAnimationFrame(flush)
  }
  const end = (e: React.PointerEvent, cancel = false) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (d.raf) cancelAnimationFrame(d.raf)
    try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch { /* already released */ }
    setLive(null)
    setGuides([])
    if (cancel || !d.moved) return
    d.pending = { cx: e.clientX, cy: e.clientY, shift: e.shiftKey, alt: e.altKey }
    const { rect } = compute(d)
    const next = setRect(dashRef.current, d.id, rect)
    if (next !== dashRef.current) onCommit(next)
  }
  const dragProps = { onPointerMove: onMove, onPointerUp: (e: React.PointerEvent) => end(e), onPointerCancel: (e: React.PointerEvent) => end(e, true), onLostPointerCapture: () => { if (drag.current) { const d = drag.current; drag.current = null; if (d.raf) cancelAnimationFrame(d.raf); setLive(null); setGuides([]) } } }

  useEffect(() => () => { if (drag.current?.raf) cancelAnimationFrame(drag.current.raf) }, [])

  const rectOf = (p: DashPanel): Rect => (live && live.id === p.id && live.mode === 'resize' ? live.rect : p.layout)
  const sel = !preview ? dash.panels.find((p) => p.id === selectedId) : undefined

  return (
    <div ref={setNodeRef} aria-label="Dashboard canvas" className={cn('h-full min-h-0 rounded-lg', isOver && 'ring-2 ring-brand-accent')}>
      {dash.panels.length === 0 && !preview ? <p className="pointer-events-none absolute inset-x-0 top-24 z-10 text-center text-sm text-brand-text-muted">Drag an asset here, or select one and press Enter.</p> : null}
      <ChartSyncContext.Provider value={syncIdFor(dash)}>
      <Artboard panels={dash.panels} zoom={zoom} scroll onScale={onScale}>
        {({ scale }) => preview ? (
          dash.panels.map((p) => (
            <div key={p.id} data-panel-id={p.id} data-chart={p.spec.chart} style={panelBox(p.layout)}>
              <PanelCell panel={p} filters={filters} extra={extraFor(dash, p, varValues)} tick={tick} setFilter={setFilter} />
            </div>
          ))
        ) : (
          <>
            {/* Empty artboard area: click to deselect */}
            <div className="absolute inset-0" onPointerDown={() => onSelect(null)} />
            {dash.panels.map((p) => {
              const on = selectedId === p.id
              const box = rectOf(p)
              const moving = live && live.id === p.id && live.mode === 'move'
              const stripH = Math.max(28, 16 / scale)
              return (
                <div
                  key={p.id}
                  data-panel-id={p.id}
                  data-chart={p.spec.chart}
                  role="group"
                  tabIndex={0}
                  aria-label={`${p.spec.title ?? p.spec.chart}${p.layout.locked ? ' (locked)' : ''}. ${KEY_HELP}`}
                  style={{ ...panelBox({ ...box, z: p.layout.z }), transform: moving ? `translate(${live!.rect.x - p.layout.x}px, ${live!.rect.y - p.layout.y}px)` : undefined, willChange: moving ? 'transform' : undefined }}
                  className={cn('outline-none', on && 'ring-2 ring-brand-accent')}
                  onFocus={(e) => { if (e.target === e.currentTarget) onSelect(p.id) }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onSelect(p.id)
                    const target = e.target as HTMLElement
                    if (target.closest(INTERACTIVE)) return
                    const onStrip = target.closest('[data-strip]') !== null
                    if (on || onStrip) begin(e, p, 'move', undefined, scale)
                    if (!(target.closest('input, select, textarea'))) e.currentTarget.focus({ preventScroll: true })
                  }}
                  {...dragProps}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return
                    const c = keyCommand(e)
                    if (!c) return
                    e.preventDefault()
                    e.stopPropagation()
                    onCommand(p.id, c)
                  }}
                >
                  <PanelCell panel={p} filters={filters} extra={extraFor(dash, p, varValues)} tick={tick} setFilter={setFilter} />
                  <div data-strip aria-hidden className={cn('absolute inset-x-0 top-0 rounded-t', p.layout.locked ? 'cursor-not-allowed' : on ? 'cursor-grab bg-brand-accent/15' : 'cursor-grab hover:bg-brand-accent/10')} style={{ height: stripH }} title={p.layout.locked ? 'Locked' : 'Drag to move'} />
                  {p.layout.locked ? <Lock aria-hidden className="absolute right-2 top-2 text-brand-text-muted" style={{ width: 14 / scale, height: 14 / scale }} /> : null}
                </div>
              )
            })}

            {/* Overlay above every panel (z above any panel z): guides, resize handles, selection toolbar. */}
            <div className="pointer-events-none absolute inset-0" style={{ zIndex: 200_000 }}>
              {guides.map((g, i) => (
                <div key={i} aria-hidden className="absolute bg-chart-2" style={g.axis === 'x' ? { left: g.pos - 0.5 / scale, top: g.from, width: 1 / scale, height: Math.max(1, g.to - g.from) } : { top: g.pos - 0.5 / scale, left: g.from, height: 1 / scale, width: Math.max(1, g.to - g.from) }} />
              ))}
              {sel ? <SelectionOverlay key={sel.id} panel={sel} rect={live && live.id === sel.id ? live.rect : sel.layout} scale={scale} onBegin={(e, h) => begin(e, sel, 'resize', h, scale)} dragProps={dragProps} onCommand={(c) => onCommand(sel.id, c)} /> : null}
            </div>
          </>
        )}
      </Artboard>
      </ChartSyncContext.Provider>
    </div>
  )
}

/** Eight resize handles (hit areas >= 12 screen px) and the floating toolbar for the selected panel. */
function SelectionOverlay({ panel, rect, scale, onBegin, dragProps, onCommand }: { panel: DashPanel; rect: Rect; scale: number; onBegin: (e: React.PointerEvent, h: Handle) => void; dragProps: Record<string, unknown>; onCommand: (c: Cmd) => void }) {
  const locked = !!panel.layout.locked
  const hit = 14 / scale // >= 12 px on screen after scaling
  const dot = 8 / scale
  const flip = rect.y * scale < 44 // not enough room above: put the toolbar just inside the top edge
  const btn = 'flex size-7 items-center justify-center rounded text-brand-text hover:bg-brand-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent'
  return (
    <>
      <div aria-hidden className="absolute rounded-sm border border-brand-accent" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderWidth: 1 / scale }} />
      {!locked
        ? HANDLES.map((h) => {
            const [fx, fy] = HANDLE_POS[h]
            const edge = h.length === 1
            // Edge handles span the edge (minus the corners); corner handles are squares. All centred on the edge line.
            const long = edge ? Math.max(0, (h === 'n' || h === 's' ? rect.w : rect.h) - 2 * hit) : hit
            const w = h === 'n' || h === 's' ? long : hit
            const ht = h === 'e' || h === 'w' ? long : hit
            return (
              <div
                key={h}
                data-handle={h}
                role="presentation"
                className="pointer-events-auto absolute flex items-center justify-center"
                style={{ left: rect.x + fx * rect.w - w / 2, top: rect.y + fy * rect.h - ht / 2, width: w, height: ht, cursor: HANDLE_CURSOR[h], touchAction: 'none' }}
                onPointerDown={(e) => { e.stopPropagation(); onBegin(e, h) }}
                {...dragProps}
              >
                {!edge ? <span aria-hidden className="rounded-sm border border-brand-accent bg-brand-primary" style={{ width: dot, height: dot, borderWidth: 1 / scale }} /> : null}
              </div>
            )
          })
        : null}
      <div
        role="toolbar"
        aria-label="Selected panel"
        className="pointer-events-auto absolute flex items-center gap-0.5 rounded-md border border-brand-border-strong bg-brand-surface p-0.5 shadow-lg"
        style={{ left: rect.x, top: flip ? rect.y + 4 / scale : rect.y - 36 / scale, transform: `scale(${1 / scale})`, transformOrigin: '0 0' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" className={btn} title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={() => onCommand({ t: 'duplicate' })}><Copy className="size-4" aria-hidden /></button>
        <button type="button" className={btn} title="Bring to front" aria-label="Bring to front" onClick={() => onCommand({ t: 'front' })}><MoveUp className="size-4" aria-hidden /></button>
        <button type="button" className={btn} title="Send to back" aria-label="Send to back" onClick={() => onCommand({ t: 'back' })}><MoveDown className="size-4" aria-hidden /></button>
        <button type="button" className={btn} aria-pressed={locked} title={locked ? 'Unlock' : 'Lock'} aria-label={locked ? 'Unlock' : 'Lock'} onClick={() => onCommand({ t: 'lock' })}>{locked ? <LockOpen className="size-4" aria-hidden /> : <Lock className="size-4" aria-hidden />}</button>
        <button type="button" className={btn} title="Delete" aria-label="Delete panel" onClick={() => onCommand({ t: 'delete' })}><Trash2 className="size-4" aria-hidden /></button>
      </div>
    </>
  )
}

export { StaticBoard, ART_W }
