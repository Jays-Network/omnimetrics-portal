'use client'

import { STATE_LABEL, type CellState } from '@/lib/panels/data'
import type { PanelProps } from '@/lib/panels/types'
import { NoData } from './frame'

// Sequential ramp from tokens only.
const ramp = (f: number) => `color-mix(in srgb, var(--chart-1) ${Math.round(8 + f * 82)}%, var(--brand-surface))`
const STATE_FILL: Record<CellState, string> = { ok: 'var(--chart-1)', warn: 'var(--chart-2)', down: 'var(--brand-danger)', idle: 'var(--brand-border-strong)' }
// Non-colour cue: a letter in each state.
const STATE_MARK: Record<CellState, string> = { ok: '', warn: '!', down: '×', idle: '–' }

function StateLegend() {
  return (
    <ul className="m-0 mt-1 flex max-h-10 shrink-0 list-none flex-wrap overflow-hidden gap-3 p-0 text-xs text-brand-text-muted">
      {(Object.keys(STATE_LABEL) as CellState[]).map((s) => (
        <li key={s} className="flex list-none items-center gap-1">
          <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: STATE_FILL[s] }} />
          {STATE_LABEL[s]}
        </li>
      ))}
    </ul>
  )
}

export function HeatmapPanel({ data }: PanelProps) {
  if (data.kind !== 'matrix') return <NoData kind="matrix" />
  const max = Math.max(...data.values.flat(), 1)
  const cw = 20
  const ch = 18
  const left = 30
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden"><svg viewBox={`0 0 ${left + data.xLabels.length * cw} ${16 + data.yLabels.length * ch}`} preserveAspectRatio="xMidYMid meet" className="min-h-0 w-full flex-1" role="presentation">
      {data.xLabels.map((x, i) => (i % 2 === 0 ? <text key={x} x={left + i * cw + cw / 2} y={10} textAnchor="middle" fontSize={8} fill="var(--brand-text-muted)">{x}</text> : null))}
      {data.yLabels.map((y, j) => (
        <g key={y}>
          <text x={left - 4} y={16 + j * ch + ch / 2 + 3} textAnchor="end" fontSize={8} fill="var(--brand-text-muted)">{y}</text>
          {data.values[j]!.map((v, i) => (
            <rect key={i} x={left + i * cw + 1} y={16 + j * ch + 1} width={cw - 2} height={ch - 2} rx={2} fill={ramp(v / max)}>
              <title>{`${y} ${data.xLabels[i]}:00 — ${v}`}</title>
            </rect>
          ))}
        </g>
      ))}
    </svg></div>
  )
}

export function CalendarPanel({ data }: PanelProps) {
  if (data.kind !== 'calendar') return <NoData kind="calendar" />
  const max = Math.max(...data.days.map((d) => d.value), 1)
  const size = 12
  const weeks = Math.ceil(data.days.length / 7)
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden"><svg viewBox={`0 0 ${weeks * size + 2} ${7 * size + 2}`} preserveAspectRatio="xMidYMid meet" className="min-h-0 w-full flex-1" role="presentation">
      {data.days.map((d, i) => (
        <rect key={d.date} x={Math.floor(i / 7) * size + 1} y={(i % 7) * size + 1} width={size - 2} height={size - 2} rx={2} fill={ramp(d.value / max)}>
          <title>{`${d.date}: ${d.value}`}</title>
        </rect>
      ))}
    </svg></div>
  )
}

export function TimelinePanel({ data }: PanelProps) {
  if (data.kind !== 'timeline') return <NoData kind="timeline" />
  const lane = 22
  const left = 64
  const w = 400
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <svg viewBox={`0 0 ${left + w} ${data.lanes.length * lane + 14}`} preserveAspectRatio="xMidYMid meet" className="min-h-0 w-full flex-1" role="presentation">
        {data.lanes.map((l, j) => (
          <g key={l.label}>
            <text x={left - 6} y={j * lane + lane / 2 + 3} textAnchor="end" fontSize={8} fill="var(--brand-text-muted)">{l.label}</text>
            {l.segments.map((s, i) => (
              <g key={i}>
                <rect x={left + (s.from / data.span) * w} y={j * lane + 2} width={((s.to - s.from) / data.span) * w - 1} height={lane - 6} rx={2} fill={STATE_FILL[s.state]} fillOpacity={s.state === 'idle' ? 0.5 : 0.85}>
                  <title>{`${l.label}: ${STATE_LABEL[s.state]} ${s.from}-${s.to}${data.spanLabel}`}</title>
                </rect>
                {STATE_MARK[s.state] && s.to - s.from >= 1 ? <text x={left + ((s.from + s.to) / 2 / data.span) * w} y={j * lane + lane / 2 + 1} textAnchor="middle" fontSize={9} fill="var(--brand-primary)">{STATE_MARK[s.state]}</text> : null}
              </g>
            ))}
          </g>
        ))}
        {[0, 6, 12, 18, 24].map((t) => (
          <text key={t} x={left + (t / 24) * w} y={data.lanes.length * lane + 10} textAnchor="middle" fontSize={8} fill="var(--brand-text-muted)">{t}{data.spanLabel}</text>
        ))}
      </svg>
      <StateLegend />
    </div>
  )
}

export function StatusHistoryPanel({ data }: PanelProps) {
  if (data.kind !== 'statusHistory') return <NoData kind="statusHistory" />
  const cw = 11
  const rh = 18
  const left = 44
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <svg viewBox={`0 0 ${left + data.labels.length * cw} ${data.rows.length * rh + 2}`} preserveAspectRatio="xMidYMid meet" className="min-h-0 w-full flex-1" role="presentation">
        {data.rows.map((r, j) => (
          <g key={r.label}>
            <text x={left - 6} y={j * rh + rh / 2 + 3} textAnchor="end" fontSize={8} fill="var(--brand-text-muted)">{r.label}</text>
            {r.cells.map((c, i) => (
              <rect key={i} x={left + i * cw + 1} y={j * rh + 2} width={cw - 2} height={rh - 4} rx={2} fill={STATE_FILL[c]} fillOpacity={c === 'idle' ? 0.5 : 0.85}>
                <title>{`${r.label} ${data.labels[i]}: ${STATE_LABEL[c]}`}</title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      <StateLegend />
    </div>
  )
}
