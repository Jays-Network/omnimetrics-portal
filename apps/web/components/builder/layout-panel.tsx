'use client'

import { Copy, Lock, LockOpen, MoveDown, MoveUp } from 'lucide-react'
import { ART_W, minSizeOf, type Cmd, type DashPanel, type Rect } from '@/lib/builder/model'

const field = 'mt-0.5 h-8 w-full rounded-md border border-brand-border-strong bg-brand-primary px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:opacity-50'
const btn = 'flex items-center gap-1.5 rounded-md border border-brand-border-strong px-2 py-1 text-xs hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent'

/**
 * "Layout" section of the config panel: numeric X, Y, W, H, Z (artboard units), stacking buttons, Lock,
 * Duplicate. Values are clamped by the model (artboard bounds, per-type minimum). A locked panel's
 * position and size fields are read-only.
 */
export function LayoutPanel({ panel, onRect, onZ, onCommand }: { panel: DashPanel; onRect: (r: Rect, key: string) => void; onZ: (z: number, key: string) => void; onCommand: (c: Cmd) => void }) {
  const l = panel.layout
  const min = minSizeOf(panel)
  const locked = !!l.locked
  const num = (label: string, k: 'x' | 'y' | 'w' | 'h', hint?: string) => (
    <label className="block text-xs">{label}
      <input type="number" value={l[k]} disabled={locked} min={k === 'w' ? min.w : k === 'h' ? min.h : 0} max={k === 'w' ? ART_W : k === 'x' ? ART_W - l.w : undefined} step={1} title={hint}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && e.target.value !== '') onRect({ x: l.x, y: l.y, w: l.w, h: l.h, [k]: v }, `lay:${panel.id}:${k}`) }}
        className={field} />
    </label>
  )
  return (
    <section aria-label="Layout" className="mb-3 space-y-2">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-brand-text-muted">Layout (artboard units)</h3>
      <div className="grid grid-cols-2 gap-2">
        {num('X', 'x')}
        {num('Y', 'y')}
        {num('W', 'w', `Minimum ${min.w}`)}
        {num('H', 'h', `Minimum ${min.h}`)}
        <label className="block text-xs">Z (stacking)
          <input type="number" value={l.z} min={0} step={1} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && e.target.value !== '') onZ(v, `lay:${panel.id}:z`) }} className={field} />
        </label>
      </div>
      <p className="text-xs text-brand-text-muted">Smallest size: {min.w} × {min.h}. Overlap is allowed.</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={btn} onClick={() => onCommand({ t: 'front' })}><MoveUp className="size-3.5" aria-hidden /> Bring to front</button>
        <button type="button" className={btn} onClick={() => onCommand({ t: 'back' })}><MoveDown className="size-3.5" aria-hidden /> Send to back</button>
        <button type="button" className={btn} aria-pressed={locked} onClick={() => onCommand({ t: 'lock' })}>{locked ? <LockOpen className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />} {locked ? 'Unlock' : 'Lock'}</button>
        <button type="button" className={btn} onClick={() => onCommand({ t: 'duplicate' })}><Copy className="size-3.5" aria-hidden /> Duplicate</button>
      </div>
      {locked ? <p className="text-xs text-brand-text-muted">Locked: it cannot be moved or resized until unlocked.</p> : null}
    </section>
  )
}
