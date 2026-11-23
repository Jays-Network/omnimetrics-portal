'use client'

import { cloneElement, type ReactElement } from 'react'
import { useChartSync } from './chart-sync'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Funnel, FunnelChart, LabelList, Legend, Line, LineChart,
  Pie, PieChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, Sankey, Scatter,
  ScatterChart, Tooltip, Treemap, XAxis, YAxis, ZAxis,
} from 'recharts'
import type { PanelProps } from '@/lib/panels/types'
import { NoData } from './frame'

export const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
const AXIS = { fontSize: 11, fill: 'var(--brand-text-muted)' }
const GRID = 'var(--brand-border)'
const MARGIN = { top: 6, right: 8, bottom: 0, left: 0 }
const LEGEND = { fontSize: 11, color: 'var(--brand-text-muted)' }

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string; payload?: { name?: string } }[]; label?: string | number }) {
  if (!active || !payload?.length) return null
  const head = label !== undefined && label !== '' ? label : payload[0]?.payload?.name
  return (
    <div className="rounded-md border border-brand-border-strong bg-brand-surface-raised px-2.5 py-1.5 text-xs shadow-lg">
      {head ? <p className="mb-1 font-medium">{head}</p> : null}
      {payload.map((p, i) => (
        <p key={i} className="tabular flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-brand-text-muted">{p.name}</span>
          <span className="ml-auto pl-3 font-medium">{p.value}</span>
        </p>
      ))}
    </div>
  )
}

/** Recharts gets the measured pixel size of its cell (no ResponsiveContainer, no percentage heights that can collapse to 0). */
function Box({ width, height, sync, children }: { width: number; height: number; /** Cartesian charts only: link the cursor to other charts when the dashboard asks for it. */ sync?: boolean; children: ReactElement<{ width?: number; height?: number; syncId?: string }> }) {
  const syncId = useChartSync()
  return <div style={{ width, height }}>{cloneElement(children, { width, height, ...(sync && syncId ? { syncId } : {}) })}</div>
}

const tip = <Tooltip content={<ChartTip />} cursor={{ stroke: GRID, fill: 'var(--brand-surface-raised)', fillOpacity: 0.4 }} isAnimationActive={false} />
const legendIf = (n: number) => (n > 1 ? <Legend iconType="square" wrapperStyle={LEGEND} /> : null)

function Axes({ x, horizontal, width = 400 }: { x: string; horizontal?: boolean; width?: number }) {
  return horizontal ? (
    <>
      <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
      <XAxis type="number" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
      <YAxis type="category" dataKey={x} tick={AXIS} tickLine={false} axisLine={false} width={Math.min(64, Math.round(width * 0.25))} />
    </>
  ) : (
    <>
      <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey={x} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36} />
    </>
  )
}

export function BarPanel({ data, animate, layout, width, height }: PanelProps & { layout: 'grouped' | 'stacked' | 'horizontal' }) {
  if (data.kind !== 'series') return <NoData kind="series" />
  const horizontal = layout === 'horizontal'
  return (
    <Box width={width} height={height} sync>
      <BarChart data={data.rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={MARGIN}>
        <Axes x={data.x} horizontal={horizontal} width={width} />
        {tip}
        {legendIf(data.series.length)}
        {data.series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % 5]} stackId={layout === 'stacked' ? 'a' : undefined} radius={layout === 'stacked' ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]} isAnimationActive={animate} />
        ))}
      </BarChart>
    </Box>
  )
}

export function LinePanel({ data, animate, width, height }: PanelProps) {
  if (data.kind !== 'series') return <NoData kind="series" />
  return (
    <Box width={width} height={height} sync>
      <LineChart data={data.rows} margin={MARGIN}>
        <Axes x={data.x} />
        {tip}
        {legendIf(data.series.length)}
        {data.series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={COLORS[i % 5]} strokeWidth={2} dot={false} isAnimationActive={animate} />
        ))}
      </LineChart>
    </Box>
  )
}

export function AreaPanel({ data, animate, stacked, width, height }: PanelProps & { stacked?: boolean }) {
  if (data.kind !== 'series') return <NoData kind="series" />
  return (
    <Box width={width} height={height} sync>
      <AreaChart data={data.rows} margin={MARGIN}>
        <Axes x={data.x} />
        {tip}
        {legendIf(data.series.length)}
        {data.series.map((s, i) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stackId={stacked ? 'a' : undefined} stroke={COLORS[i % 5]} fill={COLORS[i % 5]} fillOpacity={stacked ? 0.35 : 0.18} strokeWidth={2} isAnimationActive={animate} />
        ))}
      </AreaChart>
    </Box>
  )
}

export function PiePanel({ data, animate, donut, width, height }: PanelProps & { donut?: boolean }) {
  if (data.kind !== 'named') return <NoData kind="named" />
  return (
    <Box width={width} height={height}>
      <PieChart>
        <Tooltip content={<ChartTip />} isAnimationActive={false} />
        <Legend iconType="square" wrapperStyle={LEGEND} />
        <Pie data={data.items} dataKey="value" nameKey="name" innerRadius={donut ? '55%' : 0} outerRadius="80%" stroke="var(--brand-surface)" strokeWidth={2} isAnimationActive={animate}>
          {data.items.map((_, i) => (
            <Cell key={i} fill={COLORS[i % 5]} />
          ))}
        </Pie>
      </PieChart>
    </Box>
  )
}

export function ScatterPanel({ data, animate, width, height }: PanelProps) {
  if (data.kind !== 'xy') return <NoData kind="xy" />
  return (
    <Box width={width} height={height}>
      <ScatterChart margin={MARGIN}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis type="number" dataKey="x" name={data.xLabel} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis type="number" dataKey="y" name={data.yLabel} tick={AXIS} tickLine={false} axisLine={false} width={36} />
        <ZAxis range={[50, 50]} />
        <Tooltip content={<ChartTip />} cursor={{ stroke: GRID }} isAnimationActive={false} />
        <Scatter name="Trips" data={data.points} fill={COLORS[0]} fillOpacity={0.75} isAnimationActive={animate} />
      </ScatterChart>
    </Box>
  )
}

export function RadarPanel({ data, animate, width, height }: PanelProps) {
  if (data.kind !== 'series') return <NoData kind="series" />
  return (
    <Box width={width} height={height}>
      <RadarChart data={data.rows} outerRadius="72%">
        <PolarGrid stroke={GRID} />
        <PolarAngleAxis dataKey={data.x} tick={AXIS} />
        <PolarRadiusAxis tick={AXIS} axisLine={false} />
        <Tooltip content={<ChartTip />} isAnimationActive={false} />
        {legendIf(data.series.length)}
        {data.series.map((s, i) => (
          <Radar key={s.key} dataKey={s.key} name={s.label} stroke={COLORS[i % 5]} fill={COLORS[i % 5]} fillOpacity={0.2} isAnimationActive={animate} />
        ))}
      </RadarChart>
    </Box>
  )
}

export function ComboPanel({ data, animate, width, height }: PanelProps) {
  if (data.kind !== 'series') return <NoData kind="series" />
  return (
    <Box width={width} height={height} sync>
      <ComposedChart data={data.rows} margin={MARGIN}>
        <Axes x={data.x} />
        {tip}
        <Legend iconType="square" wrapperStyle={LEGEND} />
        {data.series.map((s, i) =>
          i === 0 ? (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[0]} radius={[3, 3, 0, 0]} isAnimationActive={animate} />
          ) : (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={COLORS[i % 5]} strokeWidth={2} dot={false} isAnimationActive={animate} />
          ),
        )}
      </ComposedChart>
    </Box>
  )
}

export function HistogramPanel({ data, animate, width, height }: PanelProps) {
  if (data.kind !== 'series') return <NoData kind="series" />
  return (
    <Box width={width} height={height} sync>
      <BarChart data={data.rows} margin={MARGIN} barCategoryGap={0}>
        <Axes x={data.x} />
        {tip}
        <Bar dataKey={data.series[0]?.key ?? 's0'} name={data.series[0]?.label ?? 'Count'} fill={COLORS[2]} stroke="var(--brand-surface)" isAnimationActive={animate} />
      </BarChart>
    </Box>
  )
}

function TreeCell(props: { x?: number; y?: number; width?: number; height?: number; index?: number; name?: string }) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, name } = props
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={COLORS[index % 5]} fillOpacity={0.55} stroke="var(--brand-surface)" strokeWidth={2} />
      {width > 60 && height > 22 ? (
        <text x={x + 6} y={y + 16} fontSize={11} fill="var(--brand-text)">
          {name}
        </text>
      ) : null}
    </g>
  )
}

export function TreemapPanel({ data, animate, width, height }: PanelProps) {
  if (data.kind !== 'named') return <NoData kind="named" />
  return (
    <Box width={width} height={height}>
      <Treemap data={data.items.map((i) => ({ name: i.name, size: i.value }))} dataKey="size" content={<TreeCell />} isAnimationActive={animate} />
    </Box>
  )
}

export function FunnelPanel({ data, animate, width, height }: PanelProps) {
  if (data.kind !== 'named') return <NoData kind="named" />
  const items = data.items.map((i, k) => ({ ...i, fill: COLORS[k % 5] }))
  return (
    <Box width={width} height={height}>
      <FunnelChart>
        <Tooltip content={<ChartTip />} isAnimationActive={false} />
        <Funnel dataKey="value" nameKey="name" data={items} isAnimationActive={animate} stroke="var(--brand-surface)">
          <LabelList position="right" dataKey="name" fill="var(--brand-text-muted)" stroke="none" fontSize={11} />
        </Funnel>
      </FunnelChart>
    </Box>
  )
}

function SankeyNode(props: { x?: number; y?: number; width?: number; height?: number; index?: number; payload?: { name?: string } }) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, payload } = props
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={COLORS[index % 5]} />
      <text x={x + width + 6} y={y + height / 2} fontSize={11} dominantBaseline="middle" fill="var(--brand-text-muted)">
        {payload?.name}
      </text>
    </g>
  )
}

export function SankeyPanel({ data, width, height }: PanelProps) {
  if (data.kind !== 'flow') return <NoData kind="flow" />
  return (
    <Box width={width} height={height}>
      <Sankey data={{ nodes: data.nodes, links: data.links }} nodePadding={24} margin={{ top: 6, right: Math.min(90, Math.round(width * 0.3)), bottom: 6, left: 6 }} node={<SankeyNode />} link={{ stroke: 'var(--chart-3)', strokeOpacity: 0.3 }}>
        <Tooltip content={<ChartTip />} isAnimationActive={false} />
      </Sankey>
    </Box>
  )
}
