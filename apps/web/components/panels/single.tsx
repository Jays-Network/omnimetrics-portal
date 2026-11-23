'use client'

import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { formatStat, useCountUp } from '@/components/fx/stat-card'
import type { PanelProps } from '@/lib/panels/types'
import { cn } from '@/lib/utils'
import { COLORS } from './charts'
import { NoData } from './frame'

const num = (v: number, d = 0) => formatStat(v, d)

function Delta({ pct }: { pct?: number }) {
  if (pct === undefined) return null
  const up = pct >= 0
  return (
    <p className={cn('tabular mt-2 flex items-center gap-1 text-xs', up ? 'text-brand-accent' : 'text-brand-danger')}>
      {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
      {up ? '+' : ''}
      {num(pct, 1)}% <span className="text-brand-text-muted">vs last period</span>
    </p>
  )
}

export function StatPanel({ data, animate }: PanelProps) {
  const shown = useCountUp(data.kind === 'value' ? data.value : 0, animate)
  if (data.kind !== 'value') return <NoData kind="value" />
  return (
    <div className="flex h-full min-w-0 flex-col justify-center overflow-hidden">
      <p className="truncate font-medium uppercase tracking-wider text-brand-text-muted" style={{ fontSize: 'clamp(0.625rem, 7cqmin, 0.8rem)' }}>{data.label}</p>
      <p className="tabular mt-1 truncate font-semibold leading-none" style={{ fontSize: 'clamp(1.25rem, 24cqmin, 3.25rem)' }}>
        {num(shown, data.decimals)}
        {data.unit ? <span className="ml-1 font-normal text-brand-text-muted" style={{ fontSize: '0.5em' }}>{data.unit}</span> : null}
      </p>
      <div className="hidden [@container(min-height:5.5rem)]:block"><Delta pct={data.deltaPct} /></div>
    </div>
  )
}

/** Sparkline as a viewBox SVG: it stretches to whatever height is left, with no fixed pixel size. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - lo) / (hi - lo || 1)) * 26}`)
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-1 min-h-0 w-full flex-1" role="presentation">
      <polygon points={`0,30 ${pts.join(' ')} 100,30`} fill={COLORS[0]} fillOpacity={0.2} />
      <polyline points={pts.join(' ')} fill="none" stroke={COLORS[0]} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function StatSparkPanel({ data }: PanelProps) {
  if (data.kind !== 'value') return <NoData kind="value" />
  return (
    <div className="flex h-full min-w-0 flex-col justify-between overflow-hidden">
      <div className="min-w-0">
        <p className="truncate font-medium uppercase tracking-wider text-brand-text-muted" style={{ fontSize: 'clamp(0.625rem, 6cqmin, 0.8rem)' }}>{data.label}</p>
        <p className="tabular mt-1 truncate font-semibold leading-none" style={{ fontSize: 'clamp(1.25rem, 18cqmin, 3.25rem)' }}>
          {num(data.value, data.decimals)}
          {data.unit ? <span className="ml-1 font-normal text-brand-text-muted" style={{ fontSize: '0.5em' }}>{data.unit}</span> : null}
        </p>
      </div>
      <Spark values={data.spark ?? []} />
    </div>
  )
}

const frac = (v: number, min: number, max: number) => Math.max(0, Math.min(1, (v - min) / ((max - min) || 1)))
const polar = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + r * Math.cos(a), cy - r * Math.sin(a)]

export function GaugePanel({ data, animate }: PanelProps) {
  if (data.kind !== 'value') return <NoData kind="value" />
  const min = data.min ?? 0
  const max = data.max ?? 100
  const f = frac(data.value, min, max)
  const [x0, y0] = polar(60, 60, 48, Math.PI)
  const [x1, y1] = polar(60, 60, 48, 0)
  const [vx, vy] = polar(60, 60, 48, Math.PI * (1 - f))
  const tick = data.target === undefined ? null : [polar(60, 60, 40, Math.PI * (1 - frac(data.target, min, max))), polar(60, 60, 56, Math.PI * (1 - frac(data.target, min, max)))]
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden">
      <svg viewBox="0 0 120 72" preserveAspectRatio="xMidYMid meet" className="min-h-0 w-full flex-1" role="presentation">
        <path d={`M ${x0} ${y0} A 48 48 0 0 1 ${x1} ${y1}`} fill="none" stroke="var(--brand-border)" strokeWidth={10} strokeLinecap="round" />
        {f > 0 ? (
          <path d={`M ${x0} ${y0} A 48 48 0 0 1 ${vx} ${vy}`} fill="none" stroke="var(--chart-1)" strokeWidth={10} strokeLinecap="round" style={animate ? { transition: 'd var(--d-slow, 400ms)' } : undefined} />
        ) : null}
        {tick ? <line x1={tick[0]![0]} y1={tick[0]![1]} x2={tick[1]![0]} y2={tick[1]![1]} stroke="var(--brand-text)" strokeWidth={2} /> : null}
        <text x={60} y={58} textAnchor="middle" fontSize={18} fontWeight={600} fill="var(--brand-text)">
          {num(data.value, data.decimals)}
          {data.unit ?? ''}
        </text>
      </svg>
      <p className="max-w-full shrink-0 truncate text-brand-text-muted" style={{ fontSize: 'clamp(0.625rem, 6cqmin, 0.75rem)' }}>{data.label}{data.target !== undefined ? ` (target ${num(data.target, data.decimals)}${data.unit ?? ''})` : ''}</p>
    </div>
  )
}

export function BarGaugePanel({ data, animate }: PanelProps) {
  if (data.kind !== 'named') return <NoData kind="named" />
  const max = data.max ?? Math.max(...data.items.map((i) => i.value), 1)
  return (
    <ul className="m-0 flex h-full min-h-0 list-none flex-col gap-2.5 overflow-y-auto p-0">
      {data.items.map((i, k) => (
        <li key={i.name} className="list-none">
          <div className="mb-0.5 flex justify-between text-xs">
            <span>{i.name}</span>
            <span className="tabular text-brand-text-muted">{num(i.value)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-brand-border">
            <div className="h-full rounded-full" style={{ width: `${frac(i.value, 0, max) * 100}%`, background: COLORS[k % 5], transition: animate ? 'width var(--d-slow, 400ms)' : undefined }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function ProgressRingPanel({ data, animate }: PanelProps) {
  if (data.kind !== 'value') return <NoData kind="value" />
  const f = frac(data.value, data.min ?? 0, data.max ?? 100)
  const r = 40
  const c = 2 * Math.PI * r
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="min-h-0 w-full flex-1" role="presentation">
        <circle cx={50} cy={50} r={r} fill="none" stroke="var(--brand-border)" strokeWidth={10} />
        <circle cx={50} cy={50} r={r} fill="none" stroke="var(--chart-2)" strokeWidth={10} strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 50 50)" style={animate ? { transition: 'stroke-dasharray var(--d-slow, 400ms)' } : undefined} />
        <text x={50} y={55} textAnchor="middle" fontSize={18} fontWeight={600} fill="var(--brand-text)">
          {Math.round(f * 100)}%
        </text>
      </svg>
      <p className="max-w-full shrink-0 truncate text-brand-text-muted" style={{ fontSize: 'clamp(0.625rem, 6cqmin, 0.75rem)' }}>{data.label}</p>
    </div>
  )
}
