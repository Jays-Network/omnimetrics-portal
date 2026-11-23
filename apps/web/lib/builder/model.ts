import { z } from 'zod'
import { PanelSpecSchema, defaultSpec, getPanelType, type PanelSpec } from '@/lib/panels/registry'
import type { BlockKind } from '@/lib/panels/types'
import { DashSettingsSchema, defaultSettings, type DashSettings } from './settings'
import { FN_FIELD, OPS_FOR, fieldById, type FilterOp, type Grain, type MeasureFn } from './fields'

// Pure builder model (M3, mock). No React, no I/O: blocks <-> typed spec, grid layout rules,
// undo history and append-only versions. The UI and the tests both go through this file.

/* ------------------------------------------------------------------ dashboard spec (v2: free-form layout) */

/** The artboard: fixed logical width, auto-growing height. All layout numbers are in these logical units. */
export const ART_W = 1920
export const ART_PAD_BOTTOM = 200
export const ART_MIN_H = 800
/** Registry sizes are in grid cells; the artboard uses units: one cell = 160 x 100. */
export const UNIT_COL = 160
export const UNIT_ROW = 100
/**
 * Dashboard spec version. v1 = 12-column grid cells; v2 = free-form layout in artboard units;
 * v3 = v2 plus the `settings` object. Older specs are upgraded by `migrateSpec` wherever a spec is read.
 */
export const SPEC_V = 3

export interface Rect { x: number; y: number; w: number; h: number }
export interface PanelLayout extends Rect { z: number; locked?: boolean }
export interface DashPanel { id: string; spec: PanelSpec; layout: PanelLayout }
export interface DashSpec { v: typeof SPEC_V; panels: DashPanel[]; settings: DashSettings }

export interface Size { w: number; h: number }
/** Default and minimum size of a registry type, in artboard units. */
export function sizeUnits(typeId: string): { size: Size; min: Size } {
  const t = getPanelType(typeId)
  if (!t) return { size: { w: UNIT_COL * 3, h: UNIT_ROW * 2 }, min: { w: UNIT_COL, h: UNIT_ROW } }
  return { size: { w: t.size.w * UNIT_COL, h: t.size.h * UNIT_ROW }, min: { w: t.min.w * UNIT_COL, h: t.min.h * UNIT_ROW } }
}
export const minSizeOf = (p: Pick<DashPanel, 'spec'>): Size => sizeUnits(p.spec.chart).min

const int = (min: number, max: number) => z.number().int().min(min).max(max)
/** Dashboard spec (current version). Strict, no SQL field anywhere; every panel must sit inside the artboard and respect its type's minimum size. */
export const DashSpecSchema = z
  .object({
    v: z.literal(SPEC_V),
    panels: z.array(z.object({
      id: z.string().min(1).max(64),
      spec: PanelSpecSchema,
      layout: z.object({ x: int(0, ART_W - 1), y: int(0, 100_000), w: int(1, ART_W), h: int(1, 20_000), z: int(0, 100_000), locked: z.boolean().optional() }).strict(),
    }).strict()).max(100),
    settings: DashSettingsSchema.default({}),
  })
  .strict()
  .superRefine((d, ctx) => {
    const seen = new Set<string>()
    d.panels.forEach((p, i) => {
      if (seen.has(p.id)) ctx.addIssue({ code: 'custom', path: ['panels', i, 'id'], message: 'Duplicate panel id' })
      seen.add(p.id)
      if (p.layout.x + p.layout.w > ART_W) ctx.addIssue({ code: 'custom', path: ['panels', i, 'layout'], message: 'Panel leaves the artboard' })
      const min = sizeUnits(p.spec.chart).min
      if (p.layout.w < min.w || p.layout.h < min.h) ctx.addIssue({ code: 'custom', path: ['panels', i, 'layout'], message: `Panel is smaller than the minimum ${min.w} x ${min.h}` })
    })
  })

export const emptyDash = (): DashSpec => ({ v: SPEC_V, panels: [], settings: defaultSettings() })

/* ------------------------------------------------------------------ migrate and parse (the ONLY way a spec is read) */

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/**
 * Upgrade any older spec shape to the current one (pure, never throws, never validates):
 *  v1 -> v2: grid cells become artboard units (x/w * 160, y/h * 100), z = array order.
 *  v2 -> v3: nothing to move; `settings` is filled in by the schema defaults.
 * Unknown or missing versions are treated as the oldest shape that fits (a missing `v` is read as v2).
 */
export function migrateSpec(raw: unknown): unknown {
  if (!isObj(raw)) return raw
  let spec: Record<string, unknown> = { ...raw }
  if (spec.v === 1 && Array.isArray(spec.panels)) {
    spec = {
      ...spec,
      v: 2,
      panels: spec.panels.map((p, i) => {
        if (!isObj(p) || !isObj(p.layout)) return p
        const l = p.layout as Record<string, number>
        return { ...p, layout: { x: (l.x ?? 0) * UNIT_COL, y: (l.y ?? 0) * UNIT_ROW, w: (l.w ?? 1) * UNIT_COL, h: (l.h ?? 1) * UNIT_ROW, z: i } }
      }),
    }
  }
  if (spec.v === 2 || spec.v === undefined) spec = { ...spec, v: SPEC_V }
  delete spec.variables // the old top-level variables record; variables now live in settings
  return spec
}

export type ParseSpecResult = { ok: true; spec: DashSpec } | { ok: false; errors: string[] }
/** migrate + strict validate. Use where problems must be shown (JSON Model apply, save). */
export function parseSpec(raw: unknown): ParseSpecResult {
  const r = DashSpecSchema.safeParse(migrateSpec(raw))
  if (r.success) return { ok: true, spec: r.data as DashSpec }
  return { ok: false, errors: r.error.issues.slice(0, 12).map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`) }
}

/**
 * migrate + parse that always returns a full, valid spec, for LOAD paths (dashboard load, version list,
 * restore, viewer). If the settings are unusable they fall back to defaults and the panels are kept; if the
 * panels themselves are unusable the dashboard opens empty rather than crashing the editor.
 */
export function normalizeSpec(raw: unknown): DashSpec {
  const a = parseSpec(raw)
  if (a.ok) return a.spec
  const m = migrateSpec(raw)
  if (isObj(m)) {
    const b = parseSpec({ ...m, settings: undefined })
    if (b.ok) return b.spec
  }
  return emptyDash()
}

/* ------------------------------------------------------------------ layout math (pure) */

/** Fit a rect into the artboard: at least the minimum size, at most the artboard width, x and y never negative. */
export function clampRect(r: Rect, min: Size = { w: 1, h: 1 }): Rect {
  const w = Math.min(ART_W, Math.max(min.w, Math.round(r.w)))
  const h = Math.max(min.h, Math.round(r.h))
  return { w, h, x: Math.min(ART_W - w, Math.max(0, Math.round(r.x))), y: Math.max(0, Math.round(r.y)) }
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
export const HANDLE_CURSOR: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }

/**
 * Resize from one of the 8 handles by a pointer delta (in artboard units). The opposite edge(s) stay fixed;
 * the minimum size and the artboard bounds are respected.
 */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, min: Size): Rect {
  let { x, y, w, h } = start
  const right = start.x + start.w
  const bottom = start.y + start.h
  if (handle.includes('e')) w = Math.min(ART_W - start.x, Math.max(min.w, start.w + dx))
  if (handle.includes('w')) {
    x = Math.min(right - min.w, Math.max(0, start.x + dx))
    w = right - x
  }
  if (handle.includes('s')) h = Math.max(min.h, start.h + dy)
  if (handle.includes('n')) {
    y = Math.min(bottom - min.h, Math.max(0, start.y + dy))
    h = bottom - y
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/** Move by a delta, kept inside the artboard. */
export const moveRect = (start: Rect, dx: number, dy: number): Rect => clampRect({ ...start, x: start.x + dx, y: start.y + dy })

/** Shift held while moving: keep only the axis with the larger movement. */
export const lockAxis = (dx: number, dy: number): [number, number] => (Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy])

export interface Guide { axis: 'x' | 'y'; pos: number; from: number; to: number }
export interface SnapOpts {
  /** Smart alignment to other panels and the artboard. */
  guides: boolean
  /** Grid size in units, or null for none. */
  grid: number | null
  /** Snap distance in artboard units (about 6 screen px divided by the scale). */
  threshold: number
  /** Total artboard height, for full-height guide lines. */
  artH?: number
}
const closest = (value: number, targets: number[], max: number): number | null => {
  let best: number | null = null
  for (const t of targets) if (Math.abs(t - value) <= max && (best === null || Math.abs(t - value) < Math.abs(best - value))) best = t
  return best
}

/** Pointer delta -> snapped, clamped rect plus the guide lines to draw. `handle` undefined = move. */
export function dragRect(start: Rect, handle: Handle | undefined, dx: number, dy: number, min: Size, others: Rect[], o: SnapOpts): { rect: Rect; guides: Guide[] } {
  const compute = (ddx: number, ddy: number) => (handle ? resizeRect(start, handle, ddx, ddy, min) : moveRect(start, ddx, ddy))
  let rect = compute(dx, dy)
  // Which edges of the rect follow the pointer: all (move) or only the dragged ones (resize).
  const xs: ('l' | 'c' | 'r')[] = handle ? [...(handle.includes('w') ? ['l' as const] : []), ...(handle.includes('e') ? ['r' as const] : [])] : ['l', 'c', 'r']
  const ys: ('t' | 'm' | 'b')[] = handle ? [...(handle.includes('n') ? ['t' as const] : []), ...(handle.includes('s') ? ['b' as const] : [])] : ['t', 'm', 'b']
  const xv = (r: Rect, k: 'l' | 'c' | 'r') => (k === 'l' ? r.x : k === 'c' ? r.x + r.w / 2 : r.x + r.w)
  const yv = (r: Rect, k: 't' | 'm' | 'b') => (k === 't' ? r.y : k === 'm' ? r.y + r.h / 2 : r.y + r.h)

  if (o.grid && o.grid > 0) {
    const g = o.grid
    const k = xs[0]
    const kk = ys[0]
    if (k) dx += Math.round(xv(rect, k) / g) * g - xv(rect, k)
    if (kk) dy += Math.round(yv(rect, kk) / g) * g - yv(rect, kk)
    rect = compute(dx, dy)
  }
  const guides: Guide[] = []
  if (o.guides) {
    const tx = [0, ART_W / 2, ART_W]
    const ty = [0]
    for (const r of others) { tx.push(r.x, r.x + r.w / 2, r.x + r.w); ty.push(r.y, r.y + r.h / 2, r.y + r.h) }
    let bx: { from: number; to: number } | null = null
    let by: { from: number; to: number } | null = null
    for (const k of xs) {
      const t = closest(xv(rect, k), tx, o.threshold)
      if (t !== null) { dx += t - xv(rect, k); bx = { from: xv(rect, k), to: t }; break }
    }
    for (const k of ys) {
      const t = closest(yv(rect, k), ty, o.threshold)
      if (t !== null) { dy += t - yv(rect, k); by = { from: yv(rect, k), to: t }; break }
    }
    if (bx || by) rect = compute(dx, dy)
    if (bx) {
      const pos = bx.to
      const hit = others.filter((r) => [r.x, r.x + r.w / 2, r.x + r.w].some((v) => Math.abs(v - pos) < 0.5))
      const art = tx.slice(0, 3).includes(pos) && hit.length === 0
      guides.push({ axis: 'x', pos, from: art ? 0 : Math.min(rect.y, ...hit.map((r) => r.y)), to: art ? (o.artH ?? rect.y + rect.h) : Math.max(rect.y + rect.h, ...hit.map((r) => r.y + r.h)) })
    }
    if (by) {
      const pos = by.to
      const hit = others.filter((r) => [r.y, r.y + r.h / 2, r.y + r.h].some((v) => Math.abs(v - pos) < 0.5))
      guides.push({ axis: 'y', pos, from: Math.min(rect.x, ...hit.map((r) => r.x), hit.length ? Infinity : 0), to: Math.max(rect.x + rect.w, ...hit.map((r) => r.x + r.w), hit.length ? 0 : ART_W) })
    }
  }
  return { rect, guides }
}

/** Scale that fits the artboard width into a column of `columnWidth` px. */
export const fitScale = (columnWidth: number): number => (columnWidth > 0 ? Math.min(4, Math.max(0.05, columnWidth / ART_W)) : 0)
export type Zoom = 'fit' | 50 | 75 | 100 | 150
export const ZOOMS: Zoom[] = ['fit', 50, 75, 100, 150]
export const scaleFor = (zoom: Zoom, columnWidth: number): number => (zoom === 'fit' ? fitScale(columnWidth) : zoom / 100)
/** Artboard height: lowest panel bottom plus 200 units, never below the minimum. */
export const artboardHeight = (panels: readonly DashPanel[]): number => Math.max(ART_MIN_H, panels.reduce((m, p) => Math.max(m, p.layout.y + p.layout.h), 0) + ART_PAD_BOTTOM)

/* ------------------------------------------------------------------ panel operations */

const find = (d: DashSpec, id: string) => d.panels.find((p) => p.id === id)
const topZ = (d: DashSpec) => d.panels.reduce((m, p) => Math.max(m, p.layout.z), -1)
const mapPanel = (d: DashSpec, id: string, fn: (p: DashPanel) => DashPanel): DashSpec => ({ ...d, panels: d.panels.map((p) => (p.id === id ? fn(p) : p)) })

/** Add a panel at its default size. `at` is the top-left corner; default is below everything else. Result is clamped to the artboard. */
export function addPanel(d: DashSpec, typeId: string, id: string, at?: { x: number; y: number }): DashSpec {
  const t = getPanelType(typeId)
  if (!t || t.soon || !t.render) return d
  const { size, min } = sizeUnits(typeId)
  const bottom = d.panels.reduce((m, p) => Math.max(m, p.layout.y + p.layout.h), 0)
  const r = clampRect({ x: at?.x ?? 24, y: at?.y ?? (bottom ? bottom + 24 : 24), ...size }, min)
  return { ...d, panels: [...d.panels, { id, spec: defaultSpec(typeId), layout: { ...r, z: topZ(d) + 1 } }] }
}

/** Where an asset dropped with its CENTRE at (cx, cy) lands: default size, clamped to the artboard. */
export function dropPoint(typeId: string, cx: number, cy: number): { x: number; y: number } {
  const { size, min } = sizeUnits(typeId)
  const r = clampRect({ x: cx - size.w / 2, y: cy - size.h / 2, ...size }, min)
  return { x: r.x, y: r.y }
}

export const removePanel = (d: DashSpec, id: string): DashSpec => ({ ...d, panels: d.panels.filter((p) => p.id !== id) })
export const setPanelSpec = (d: DashSpec, id: string, spec: PanelSpec): DashSpec => mapPanel(d, id, (p) => ({ ...p, spec }))

/** Set position and size (clamped, minimum respected). A locked panel is not moved or resized. */
export function setRect(d: DashSpec, id: string, r: Rect): DashSpec {
  const p = find(d, id)
  if (!p || p.layout.locked) return d
  const c = clampRect(r, minSizeOf(p))
  if (c.x === p.layout.x && c.y === p.layout.y && c.w === p.layout.w && c.h === p.layout.h) return d
  return mapPanel(d, id, (q) => ({ ...q, layout: { ...q.layout, ...c } }))
}
export const movePanelBy = (d: DashSpec, id: string, dx: number, dy: number): DashSpec => {
  const p = find(d, id)
  return p ? setRect(d, id, { ...p.layout, x: p.layout.x + dx, y: p.layout.y + dy }) : d
}
export const resizePanelBy = (d: DashSpec, id: string, dw: number, dh: number): DashSpec => {
  const p = find(d, id)
  return p ? setRect(d, id, { ...p.layout, w: p.layout.w + dw, h: p.layout.h + dh }) : d
}

export const setLocked = (d: DashSpec, id: string, locked: boolean): DashSpec => mapPanel(d, id, (p) => ({ ...p, layout: { ...p.layout, locked: locked || undefined } }))
export const setZ = (d: DashSpec, id: string, zv: number): DashSpec => mapPanel(d, id, (p) => ({ ...p, layout: { ...p.layout, z: Math.min(100_000, Math.max(0, Math.round(zv))) } }))

/** Stack order as a list (back to front), ties broken by array order. */
const stackOrder = (d: DashSpec) => d.panels.map((p, i) => ({ id: p.id, z: p.layout.z, i })).sort((a, b) => a.z - b.z || a.i - b.i).map((s) => s.id)
const applyOrder = (d: DashSpec, order: string[]): DashSpec => ({ ...d, panels: d.panels.map((p) => ({ ...p, layout: { ...p.layout, z: order.indexOf(p.id) } })) })
export function reorderZ(d: DashSpec, id: string, how: 'front' | 'back' | 'forward' | 'backward'): DashSpec {
  const o = stackOrder(d)
  const i = o.indexOf(id)
  if (i < 0) return d
  o.splice(i, 1)
  o.splice(how === 'front' ? o.length : how === 'back' ? 0 : how === 'forward' ? Math.min(o.length, i + 1) : Math.max(0, i - 1), 0, id)
  return applyOrder(d, o)
}

/** Copy of a panel, offset by 24 units, on top. The copy is never locked. */
export function duplicatePanel(d: DashSpec, id: string, newId: string): DashSpec {
  const p = find(d, id)
  if (!p) return d
  const r = clampRect({ ...p.layout, x: p.layout.x + 24, y: p.layout.y + 24 }, minSizeOf(p))
  return { ...d, panels: [...d.panels, { id: newId, spec: structuredClone(p.spec), layout: { ...r, z: topZ(d) + 1 } }] }
}

const TIDY_GAP = 24
/** Arrange panels into rows that do not overlap (reading order by y then x). Locked panels stay where they are and are stepped around. */
export function tidyUp(d: DashSpec): DashSpec {
  const locked = d.panels.filter((p) => p.layout.locked).map((p) => p.layout)
  const hit = (r: Rect) => locked.find((l) => r.x < l.x + l.w && l.x < r.x + r.w && r.y < l.y + l.h && l.y < r.y + r.h)
  const movable = d.panels.filter((p) => !p.layout.locked).sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)
  const pos = new Map<string, Rect>()
  let x = TIDY_GAP
  let y = TIDY_GAP
  let rowH = 0
  for (const p of movable) {
    const { w, h } = p.layout
    for (let guard = 0; guard < 5000; guard++) {
      if (x + w > ART_W - TIDY_GAP + 0.5 && x > TIDY_GAP) { x = TIDY_GAP; y += rowH + TIDY_GAP; rowH = 0 }
      const l = hit({ x, y, w, h })
      if (!l) break
      x = l.x + l.w + TIDY_GAP
      if (x + w > ART_W) { x = TIDY_GAP; y = l.y + l.h + TIDY_GAP; rowH = 0 }
    }
    const r = clampRect({ x, y, w, h }, minSizeOf(p))
    pos.set(p.id, r)
    x += w + TIDY_GAP
    rowH = Math.max(rowH, h)
  }
  return { ...d, panels: d.panels.map((p) => (pos.has(p.id) ? { ...p, layout: { ...p.layout, ...pos.get(p.id)! } } : p)) }
}

/* ------------------------------------------------------------------ keyboard commands on the selected panel */

export type Cmd =
  | { t: 'nudge'; dx: number; dy: number }
  | { t: 'resize'; dw: number; dh: number }
  | { t: 'delete' } | { t: 'duplicate' } | { t: 'forward' } | { t: 'backward' } | { t: 'front' } | { t: 'back' } | { t: 'lock' } | { t: 'deselect' }

/** Arrows nudge 1 (Shift 10); Alt+arrows resize 1 (Shift+Alt 10); Delete; Ctrl+D; [ and ]; Esc. */
export function keyCommand(e: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): Cmd | null {
  const n = e.shiftKey ? 10 : 1
  const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key]
  if (dir && !e.ctrlKey && !e.metaKey) return e.altKey ? { t: 'resize', dw: dir[0] * n, dh: dir[1] * n } : { t: 'nudge', dx: dir[0] * n, dy: dir[1] * n }
  if (e.key === 'Delete') return { t: 'delete' }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') return { t: 'duplicate' }
  if (e.key === '[') return { t: 'backward' }
  if (e.key === ']') return { t: 'forward' }
  if (e.key === 'Escape') return { t: 'deselect' }
  return null
}

/** Apply a command to the selected panel. Returns the new dashboard and the selection that should follow. */
export function applyCommand(d: DashSpec, id: string, c: Cmd, newId = `${id}-copy`): { dash: DashSpec; selectedId: string | null } {
  switch (c.t) {
    case 'nudge': return { dash: movePanelBy(d, id, c.dx, c.dy), selectedId: id }
    case 'resize': return { dash: resizePanelBy(d, id, c.dw, c.dh), selectedId: id }
    case 'delete': return { dash: removePanel(d, id), selectedId: null }
    case 'duplicate': { const next = duplicatePanel(d, id, newId); return { dash: next, selectedId: next === d ? id : newId } }
    case 'forward': case 'backward': case 'front': case 'back': return { dash: reorderZ(d, id, c.t), selectedId: id }
    case 'lock': return { dash: setLocked(d, id, !find(d, id)?.layout.locked), selectedId: id }
    case 'deselect': return { dash: d, selectedId: null }
  }
}

/* ------------------------------------------------------------------ blocks <-> spec */

export type Block =
  | { id: string; kind: 'chart'; chart: string }
  | { id: string; kind: 'filter'; field: string; op: FilterOp; value: string }
  | { id: string; kind: 'groupBy'; field: string; grain?: Grain }
  | { id: string; kind: 'measure'; fn: MeasureFn; field?: string }
  | { id: string; kind: 'sort'; field: string; dir: 'asc' | 'desc' }
  | { id: string; kind: 'limit'; n: number }

export type BlockKindId = Block['kind']
/** Stack order, top to bottom. A block may only be dropped where this order holds. */
export const KIND_ORDER: BlockKindId[] = ['chart', 'filter', 'groupBy', 'measure', 'sort', 'limit']
export const KIND_LABEL: Record<BlockKindId, string> = { chart: 'Chart type', filter: 'Filter', groupBy: 'Group by', measure: 'Measure', sort: 'Sort', limit: 'Limit' }
const MAX: Record<BlockKindId, number> = { chart: 1, filter: 20, groupBy: 2, measure: 1, sort: 1, limit: 1 }

const isArrayOp = (op: FilterOp) => op === 'in' || op === 'between'

function filterValueOut(b: Extract<Block, { kind: 'filter' }>): string | number | string[] {
  if (isArrayOp(b.op)) return b.value.split(',').map((s) => s.trim()).filter(Boolean)
  const f = fieldById(b.field)
  if (f?.type === 'number' && b.value.trim() !== '' && Number.isFinite(Number(b.value))) return Number(b.value)
  return b.value
}

/** The blocks that represent a spec, in canonical stack order, with stable per-render ids. */
export function specToBlocks(spec: PanelSpec): Block[] {
  const out: Block[] = [{ id: 'chart-0', kind: 'chart', chart: spec.chart }]
  spec.filters.forEach((f, i) => out.push({ id: `filter-${i}`, kind: 'filter', field: f.field, op: f.op, value: Array.isArray(f.value) ? f.value.join(', ') : String(f.value) }))
  spec.groupBy.forEach((g, i) => out.push({ id: `groupBy-${i}`, kind: 'groupBy', field: g.field, grain: g.grain }))
  if (spec.measure) out.push({ id: 'measure-0', kind: 'measure', fn: spec.measure.fn, field: spec.measure.field })
  if (spec.sort) out.push({ id: 'sort-0', kind: 'sort', field: spec.sort.field, dir: spec.sort.dir })
  if (spec.limit !== undefined) out.push({ id: 'limit-0', kind: 'limit', n: spec.limit })
  return out
}

/** Why a block cannot be used as it stands (shown on the block; the block is left out of the spec until fixed). */
export function blockIssue(b: Block, all: Block[]): string | null {
  switch (b.kind) {
    case 'chart':
      return getPanelType(b.chart) ? null : 'Unknown chart type'
    case 'filter': {
      const f = fieldById(b.field)
      if (!f) return 'Pick a field'
      if (!OPS_FOR[f.type].includes(b.op)) return `"${f.label}" cannot use that comparison`
      if (b.value.trim() === '') return 'Enter a value'
      if (b.op === 'between' && b.value.split(',').filter((s) => s.trim()).length !== 2) return 'Enter two values, separated by a comma'
      if (f.type === 'number' && !isArrayOp(b.op) && !/^\$[a-z][a-z0-9_]*$/.test(b.value) && !Number.isFinite(Number(b.value))) return 'Enter a number, or a $variable'
      return null
    }
    case 'groupBy': {
      const f = fieldById(b.field)
      if (!f) return 'Pick a field'
      if (b.grain && f.type !== 'date') return 'Only a date can be grouped by hour, day, week or month'
      if (all.some((o) => o.kind === 'groupBy' && o.id !== b.id && o.field === b.field)) return 'Already grouped by this field'
      return null
    }
    case 'measure': {
      const need = FN_FIELD[b.fn]
      if (need === null) return b.field ? 'Count takes no field' : null
      const f = b.field ? fieldById(b.field) : undefined
      if (!f) return 'Pick a field'
      return need.includes(f.type) ? null : `${f.label} is ${f.type === 'text' ? 'text' : f.type}: this measure needs ${need.join(' or ')}`
    }
    case 'sort':
      return fieldById(b.field) ? null : 'Pick a field'
    case 'limit':
      return Number.isInteger(b.n) && b.n >= 1 && b.n <= 1000 ? null : 'Enter a whole number from 1 to 1000'
  }
}

export const blockIssues = (blocks: Block[]): Record<string, string> => {
  const m: Record<string, string> = {}
  for (const b of blocks) {
    const i = blockIssue(b, blocks)
    if (i) m[b.id] = i
  }
  return m
}

/** Blocks of this kind the chart type accepts (the chart-type block itself is always there). */
export const allowedKinds = (chartId: string): BlockKindId[] => ['chart', ...((getPanelType(chartId)?.blocks ?? []) as BlockKind[])]

/** Reason a new block of `kind` cannot be added to this stack, or null. Drives disabled palette items and un-droppable drops. */
export function canAddBlock(chartId: string, blocks: Block[], kind: BlockKindId): string | null {
  const t = getPanelType(chartId)
  if (!t) return 'Unknown chart type'
  if (kind === 'chart') return 'There is always exactly one chart type block'
  if (!allowedKinds(chartId).includes(kind)) return `${t.label} does not take a ${KIND_LABEL[kind]} block`
  if (blocks.filter((b) => b.kind === kind).length >= MAX[kind]) return kind === 'groupBy' ? 'At most 2 Group by blocks' : `Only ${MAX[kind] === 1 ? 'one' : MAX[kind]} ${KIND_LABEL[kind]} block${MAX[kind] === 1 ? '' : 's'}`
  return null
}

/** A new block with valid defaults for its kind. */
export function newBlock(kind: Exclude<BlockKindId, 'chart'>, id: string): Block {
  switch (kind) {
    case 'filter': return { id, kind, field: 'country', op: 'eq', value: '' }
    case 'groupBy': return { id, kind, field: 'unit_group' }
    case 'measure': return { id, kind, fn: 'count' }
    case 'sort': return { id, kind, field: 'trips', dir: 'desc' }
    case 'limit': return { id, kind, n: 10 }
  }
}

/** Insert in canonical position (after the last block of an equal or earlier kind). */
export function insertBlock(blocks: Block[], b: Block): Block[] {
  const rank = KIND_ORDER.indexOf(b.kind)
  let at = 0
  blocks.forEach((x, i) => { if (KIND_ORDER.indexOf(x.kind) <= rank) at = i + 1 })
  return [...blocks.slice(0, at), b, ...blocks.slice(at)]
}

/** Drag-reorder. Returns null (un-droppable) when the move would put a block above one that must come first. */
export function reorderBlocks(blocks: Block[], from: number, to: number): Block[] | null {
  if (from === to || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return null
  const next = [...blocks]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  const ranks = next.map((b) => KIND_ORDER.indexOf(b.kind))
  return ranks.every((r, i) => i === 0 || ranks[i - 1]! <= r) ? next : null
}

/**
 * The spec these blocks describe. Blocks with an issue are left out (the panel keeps
 * working with the valid part); blocks the chart type does not accept are dropped;
 * changing the chart type resets that type's options. The result always passes PanelSpecSchema.
 */
export function blocksToSpec(base: PanelSpec, blocks: Block[]): PanelSpec {
  const chartBlock = blocks.find((b): b is Extract<Block, { kind: 'chart' }> => b.kind === 'chart')
  const chart = chartBlock && getPanelType(chartBlock.chart) ? chartBlock.chart : base.chart
  const t = getPanelType(chart)!
  const ok = blocks.filter((b) => !blockIssue(b, blocks) && (b.kind === 'chart' || t.blocks.includes(b.kind)))
  const filters = ok.filter((b): b is Extract<Block, { kind: 'filter' }> => b.kind === 'filter').slice(0, MAX.filter).map((b) => ({ field: b.field, op: b.op, value: filterValueOut(b) }))
  const groupBy = ok.filter((b): b is Extract<Block, { kind: 'groupBy' }> => b.kind === 'groupBy').slice(0, MAX.groupBy).map((b) => (b.grain ? { field: b.field, grain: b.grain } : { field: b.field }))
  const m = ok.find((b): b is Extract<Block, { kind: 'measure' }> => b.kind === 'measure')
  const s = ok.find((b): b is Extract<Block, { kind: 'sort' }> => b.kind === 'sort')
  const l = ok.find((b): b is Extract<Block, { kind: 'limit' }> => b.kind === 'limit')
  const changed = chart !== base.chart
  const spec: PanelSpec = {
    v: 1,
    chart,
    title: base.title,
    dataset: changed ? t.dataset : base.dataset,
    filters,
    groupBy,
    options: changed ? t.options.parse({}) : base.options,
    ...(m ? { measure: m.field ? { fn: m.fn, field: m.field } : { fn: m.fn } } : {}),
    ...(s ? { sort: { field: s.field, dir: s.dir } } : {}),
    ...(l ? { limit: l.n } : {}),
  }
  return PanelSpecSchema.parse(spec)
}

/** Swap the chart-type block; incompatible blocks are removed and listed so the UI can say so. */
export function changeChart(spec: PanelSpec, chart: string): { spec: PanelSpec; dropped: BlockKindId[] } {
  const t = getPanelType(chart)
  if (!t || t.soon || !t.render) return { spec, dropped: [] }
  const before = specToBlocks(spec)
  const blocks = before.map((b) => (b.kind === 'chart' ? { ...b, chart } : b))
  const next = blocksToSpec(spec, blocks)
  const dropped = [...new Set(before.filter((b) => b.kind !== 'chart' && !t.blocks.includes(b.kind as BlockKind)).map((b) => b.kind))]
  return { spec: next, dropped }
}

/** Panel options form values (title, unit, colour) merged into the spec. */
export function setPanelOption(spec: PanelSpec, key: 'unit' | 'color', value: string): PanelSpec {
  const options = { ...spec.options }
  if (value === '') delete options[key]
  else options[key] = value
  return PanelSpecSchema.parse({ ...spec, options })
}
export const setPanelTitle = (spec: PanelSpec, title: string): PanelSpec => PanelSpecSchema.parse({ ...spec, title: title.slice(0, 80) })

/* ------------------------------------------------------------------ undo / redo */

export interface History<T> { past: T[]; present: T; future: T[]; key?: string }
const HISTORY_LIMIT = 100

export const newHistory = <T,>(present: T): History<T> => ({ past: [], present, future: [] })

/** Record a change. Edits sharing a `key` (typing in one field) collapse into a single undo step. */
export function commit<T>(h: History<T>, next: T, key?: string): History<T> {
  if (JSON.stringify(next) === JSON.stringify(h.present)) return h
  if (key && h.key === key) return { ...h, present: next, future: [] }
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [], key }
}
export const undo = <T,>(h: History<T>): History<T> => (h.past.length === 0 ? h : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future], key: undefined })
export const redo = <T,>(h: History<T>): History<T> => (h.future.length === 0 ? h : { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1), key: undefined })

/* ------------------------------------------------------------------ versions (append-only) */

export interface DashVersion { n: number; createdAt: string; author: string; note: string; spec: DashSpec }

/** A new list with one more version. The input list and every earlier version are untouched. */
export function appendVersion(list: readonly DashVersion[], spec: DashSpec, author: string, note: string, now: Date): DashVersion[] {
  return [...list, { n: (list[list.length - 1]?.n ?? 0) + 1, createdAt: now.toISOString(), author, note: note.slice(0, 120), spec: structuredClone(spec) }]
}

/** Restoring never rewrites history: it appends a copy of version `n` as the newest version. Null if `n` does not exist. */
export function restoreVersion(list: readonly DashVersion[], n: number, author: string, now: Date): DashVersion[] | null {
  const v = list.find((x) => x.n === n)
  // An old version is upgraded on the way back in, so a restore always yields a full, valid, current spec.
  return v ? appendVersion(list, normalizeSpec(v.spec), author, `Restored from v${n}`, now) : null
}
