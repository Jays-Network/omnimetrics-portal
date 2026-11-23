'use client'

import { memo, useEffect, type CSSProperties, type ReactNode, type Ref } from 'react'
import { GlassPanel } from '@/components/fx/glass-panel'
import { ART_W, artboardHeight, scaleFor, type DashPanel, type DashSpec, type Zoom } from '@/lib/builder/model'
import { variableFilters, type VarValue } from '@/lib/builder/settings'
import { ChartSyncContext } from './chart-sync'
import { LazyMount } from './lazy-mount'
import { getPanelType, mockDataFor } from '@/lib/panels/registry'
import type { Filters, FilterValue } from '@/lib/panels/types'
import { cn } from '@/lib/utils'
import { PanelView } from './panel-view'
import { useElementSize } from './use-size'

/**
 * The artboard used by BOTH the editor and the viewer: a fixed logical width (1920 units) and an
 * auto-growing height, scaled to the measured column width (or a zoom level) with one CSS transform,
 * so text scales with it. Panels measure their own unscaled box (use-size.ts), so renderers get the
 * same numbers in either place. `scroll` makes the column scroll inside itself (editor); otherwise the
 * page scrolls (viewer).
 */
export function Artboard({ panels, zoom = 'fit', scroll, className, artRef, onScale, children }: {
  panels: readonly DashPanel[]
  zoom?: Zoom
  scroll?: boolean
  className?: string
  artRef?: Ref<HTMLDivElement>
  onScale?: (scale: number) => void
  children: (ctx: { scale: number }) => ReactNode
}) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  const scale = scaleFor(zoom, size.width)
  useEffect(() => { if (scale > 0) onScale?.(scale) }, [scale, onScale])
  const h = artboardHeight(panels)
  return (
    <div ref={ref} data-artboard-viewport className={cn(scroll ? 'h-full min-h-0 overflow-auto overscroll-contain scroll-token' : 'w-full', className)}>
      {scale > 0 ? (
        <div style={{ width: ART_W * scale, height: h * scale }}>
          <div ref={artRef} data-artboard data-scale={scale} style={{ width: ART_W, height: h, transform: `scale(${scale})`, transformOrigin: '0 0', position: 'relative' }}>
            {children({ scale })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * One panel's visual: glass surface plus the registry renderer, filled to its box. Memoised: dragging other
 * panels does not re-render it. `extra` = values of the dashboard variables this panel's filters reference
 * (`$name`); `tick` re-seeds the mock data on each refresh.
 */
export const PanelCell = memo(function PanelCell({ panel, filters, extra, tick = 0, setFilter }: { panel: DashPanel; filters: Filters; extra?: Record<string, VarValue>; tick?: number; setFilter?: (field: string, value: FilterValue | null) => void }) {
  const t = getPanelType(panel.spec.chart)
  if (!t) return null
  const isControl = t.category === 'controls'
  const effective = extra && Object.keys(extra).length ? { ...filters, ...extra } : filters
  return (
    <GlassPanel tone="data" className="fx-fill h-full p-3">
      <PanelView type={t} title={panel.spec.title ?? t.label} data={mockDataFor(t, tick ? `${panel.id}:${tick}` : panel.id, isControl ? {} : effective)} options={panel.spec.options} filters={filters} setFilter={setFilter} />
    </GlassPanel>
  )
}, (a, b) => a.panel === b.panel && a.filters === b.filters && a.tick === b.tick && a.setFilter === b.setFilter && JSON.stringify(a.extra) === JSON.stringify(b.extra))

/** Link the cursor of cartesian charts when the dashboard setting asks for a shared crosshair or tooltip. */
export const syncIdFor = (spec: DashSpec) => (spec.settings.panelOptions.tooltip === 'default' ? undefined : 'dashboard')

/** Variable values that apply to one panel (from `$name` filter values). */
export const extraFor = (spec: DashSpec, p: DashPanel, picked: Record<string, VarValue>) => variableFilters(p.spec.filters, spec.settings.variables, picked)

export const panelBox = (r: { x: number; y: number; w: number; h: number; z: number }): CSSProperties => ({ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, zIndex: r.z })

/** Read-only board (viewer): same artboard, same cells, no editing chrome. Filters from control panels and dashboard variables work. */
export function StaticBoard({ spec, filters, setFilter, varValues = {}, tick = 0 }: { spec: DashSpec; filters: Filters; setFilter: (field: string, value: FilterValue | null) => void; varValues?: Record<string, VarValue>; tick?: number }) {
  return (
    <ChartSyncContext.Provider value={syncIdFor(spec)}>
      <Artboard panels={spec.panels} zoom="fit">
        {() => spec.panels.map((p) => (
          <div key={p.id} data-panel-id={p.id} data-chart={p.spec.chart} style={panelBox(p.layout)}>
            <LazyMount enabled={spec.settings.panelOptions.lazyLoad}>
              <PanelCell panel={p} filters={filters} extra={extraFor(spec, p, varValues)} tick={tick} setFilter={setFilter} />
            </LazyMount>
          </div>
        ))}
      </Artboard>
    </ChartSyncContext.Provider>
  )
}
