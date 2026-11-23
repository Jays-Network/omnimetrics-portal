'use client'

import type { PanelProps } from '@/lib/panels/types'
import { NoData } from './frame'

const RISK_FILL = { low: 'var(--chart-1)', medium: 'var(--chart-2)', high: 'var(--brand-danger)' } as const
const pts = (p: [number, number][]) => p.map((q) => q.join(',')).join(' ')

/**
 * PLACEHOLDER map: plain token background with a grid, no tile server and no
 * outside network calls (a tile source is a later decision). react-map-gl and
 * maplibre-gl are not installed; this SVG renders points, routes and zones.
 */
export function MapPanel({ data, mode }: PanelProps & { mode: 'points' | 'route' | 'zones' }) {
  if (data.kind !== 'map') return <NoData kind="map" />
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet" className="min-h-0 w-full flex-1 rounded-md border border-brand-border bg-brand-primary" role="presentation">
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`v${i}`} x1={(i + 1) * 10} y1={0} x2={(i + 1) * 10} y2={60} stroke="var(--brand-border)" strokeWidth={0.2} />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={(i + 1) * 10} x2={100} y2={(i + 1) * 10} stroke="var(--brand-border)" strokeWidth={0.2} />
        ))}
        {mode === 'zones'
          ? data.zones.map((z) => (
              <g key={z.id}>
                <polygon points={pts(z.path)} fill={RISK_FILL[z.risk]} fillOpacity={0.22} stroke={RISK_FILL[z.risk]} strokeWidth={0.5} strokeDasharray={z.risk === 'high' ? undefined : '2 1'}>
                  <title>{`${z.label}: ${z.risk} risk`}</title>
                </polygon>
                <text x={z.path[0]![0] + 1.5} y={z.path[0]![1] + 4} fontSize={3} fill="var(--brand-text)">{z.label} ({z.risk})</text>
              </g>
            ))
          : null}
        {mode === 'route'
          ? data.routes.map((r, i) => (
              <g key={r.id}>
                <polyline points={pts(r.path)} fill="none" stroke={i === 0 ? 'var(--chart-1)' : 'var(--chart-2)'} strokeWidth={0.8} strokeLinejoin="round">
                  <title>{r.label}</title>
                </polyline>
                {r.path.map((p, k) => (
                  <circle key={k} cx={p[0]} cy={p[1]} r={k === 0 || k === r.path.length - 1 ? 1.4 : 0.8} fill="var(--brand-primary)" stroke={i === 0 ? 'var(--chart-1)' : 'var(--chart-2)'} strokeWidth={0.5} />
                ))}
              </g>
            ))
          : null}
        {mode === 'points'
          ? data.points.map((p) => (
              <g key={p.id}>
                <circle cx={p.x} cy={p.y} r={1.4} fill="var(--chart-1)" fillOpacity={0.85} stroke="var(--brand-primary)" strokeWidth={0.4}>
                  <title>{p.label}</title>
                </circle>
              </g>
            ))
          : null}
      </svg>
      <p className="mt-1 shrink-0 truncate text-[11px] text-brand-text-muted">Placeholder map (no base map yet).</p>
    </div>
  )
}
