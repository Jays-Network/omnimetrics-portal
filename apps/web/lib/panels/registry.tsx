import {
  Activity, AlignLeft, AreaChart as AreaIcon, BarChart2, BarChart3, Calendar, CalendarDays, CalendarRange, ChartNoAxesColumn, CircleGauge, Clock, Combine, Container, Flag,
  FolderTree, Funnel as FunnelIcon, Gauge, GitFork, Globe, Grid3x3, History, Hourglass, Image as ImageIcon, Layers, LineChart as LineIcon, Link as LinkIcon, ListChecks,
  ListOrdered, Map as MapIcon, MapPinned, Minus, PieChart as PieIcon, Radar as RadarIcon, Radio, Route, ScatterChart as ScatterIcon, Search, Shield, Sigma, Siren, SquareStack,
  Table2, Target, TrendingUp, Truck, Type,
} from 'lucide-react'
import { z } from 'zod'
import { autoTable } from './data'
import * as M from './mock-data'
import { hash, rng } from './rng'
import type { BlockKind, PanelCategory, PanelType, Filters } from './types'
import { AreaPanel, BarPanel, ComboPanel, FunnelPanel, HistogramPanel, LinePanel, PiePanel, RadarPanel, SankeyPanel, ScatterPanel, TreemapPanel } from '@/components/panels/charts'
import { DateRangeControl, MultiSelectControl, SearchControl, SelectControl, CONTROL_FIELD } from '@/components/panels/controls'
import { DividerPanel, ImagePanel, LinksPanel, TextPanel } from '@/components/panels/content'
import { MapPanel } from '@/components/panels/maps'
import { BarGaugePanel, GaugePanel, ProgressRingPanel, StatPanel, StatSparkPanel } from '@/components/panels/single'
import { CalendarPanel, HeatmapPanel, StatusHistoryPanel, TimelinePanel } from '@/components/panels/status'
import { DataTablePanel, ListPanel, TopNPanel } from '@/components/panels/tables'

// Adding a panel type = one `def(...)` entry below plus its renderer. Nothing else.
// Everything (asset bar, spec validation, mock data, accessible table) derives from this list.

/** Options every panel shares (the panel options form): a unit label and an accent colour from the brand chart palette. */
export const PANEL_COLORS = ['chart-2', 'chart-3', 'chart-4', 'chart-5'] as const
const none = z.object({ unit: z.string().max(12).optional(), color: z.enum(PANEL_COLORS).optional() })
const DATA_BLOCKS: BlockKind[] = ['filter', 'groupBy', 'measure', 'sort', 'limit']
const VALUE_BLOCKS: BlockKind[] = ['filter', 'measure']
const NO_BLOCKS: BlockKind[] = []

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyType = PanelType<any>

/** Smallest readable size per category (grid cells). Override per entry with `min`. */
const MIN_BY_CATEGORY: Record<PanelCategory, { w: number; h: number }> = {
  charts: { w: 3, h: 3 }, single: { w: 2, h: 2 }, tables: { w: 3, h: 3 }, status: { w: 4, h: 3 },
  maps: { w: 3, h: 3 }, content: { w: 2, h: 1 }, controls: { w: 2, h: 2 }, ready: { w: 3, h: 2 },
}

function def(e: Omit<PanelType<any>, 'a11y' | 'options' | 'blocks' | 'min'> & Partial<Pick<PanelType<any>, 'a11y' | 'options' | 'blocks' | 'min'>>): AnyType {
  const min = e.min ?? MIN_BY_CATEGORY[e.category]
  return { options: none, blocks: DATA_BLOCKS, a11y: autoTable, ...e, min: { w: Math.min(min.w, e.size.w), h: Math.min(min.h, e.size.h) } }
}

const ctl = (id: string, label: string, icon: AnyType['icon'], description: string, options: string[], render: AnyType['render']): AnyType =>
  def({ id, label, description, category: 'controls', icon, blocks: NO_BLOCKS, size: { w: 3, h: 2 }, mock: () => M.mockControl(options), render, visualAccessible: true, a11y: (_d, title) => ({ caption: title || label, columns: ['Control', 'Purpose', 'Options'], rows: [[label, description, options.join(', ') || 'free input']] }) })

const FOLDERS = ['Mock folder A', 'Mock folder B', 'Mock folder C']
const COUNTRIES = ['Country A', 'Country B', 'Country C', 'Country D']
const STATUSES = ['Active', 'Idle', 'Offline']

const charts: AnyType[] = [
  def({ id: 'bar-grouped', label: 'Bar, grouped', description: 'Side-by-side bars per category.', category: 'charts', icon: BarChart3, size: { w: 6, h: 4 }, mock: (r) => M.mockSeries(r), render: (p) => <BarPanel {...p} layout="grouped" /> }),
  def({ id: 'bar-stacked', label: 'Bar, stacked', description: 'Bars stacked to show the total and its parts.', category: 'charts', icon: SquareStack, size: { w: 6, h: 4 }, mock: (r) => M.mockSeries(r), render: (p) => <BarPanel {...p} layout="stacked" /> }),
  def({ id: 'bar-horizontal', label: 'Bar, horizontal', description: 'Horizontal bars, good for long labels.', category: 'charts', icon: BarChart2, size: { w: 6, h: 4 }, mock: (r) => M.mockSeries(r, { n: 2 }), render: (p) => <BarPanel {...p} layout="horizontal" /> }),
  def({ id: 'line', label: 'Line', description: 'Trend over time.', category: 'charts', icon: LineIcon, size: { w: 6, h: 4 }, mock: (r) => M.mockSeries(r), render: LinePanel }),
  def({ id: 'area', label: 'Area', description: 'Filled trend over time.', category: 'charts', icon: AreaIcon, size: { w: 6, h: 4 }, mock: (r) => M.mockSeries(r), render: (p) => <AreaPanel {...p} /> }),
  def({ id: 'area-stacked', label: 'Area, stacked', description: 'Stacked areas showing parts of a total.', category: 'charts', icon: Layers, size: { w: 6, h: 4 }, mock: (r) => M.mockSeries(r), render: (p) => <AreaPanel {...p} stacked /> }),
  def({ id: 'pie', label: 'Pie', description: 'Share of a whole.', category: 'charts', icon: PieIcon, size: { w: 4, h: 4 }, mock: (r) => M.mockNamed(r, 4), render: (p) => <PiePanel {...p} /> }),
  def({ id: 'donut', label: 'Donut', description: 'Share of a whole with a hollow centre.', category: 'charts', icon: CircleGauge, size: { w: 4, h: 4 }, mock: (r) => M.mockNamed(r, 4), render: (p) => <PiePanel {...p} donut /> }),
  def({ id: 'scatter', label: 'Scatter', description: 'Two measures against each other.', category: 'charts', icon: ScatterIcon, size: { w: 6, h: 4 }, mock: (r) => M.mockXY(r), render: ScatterPanel }),
  def({ id: 'radar', label: 'Radar', description: 'Compare several measures at once.', category: 'charts', icon: RadarIcon, size: { w: 4, h: 4 }, mock: (r) => M.mockSeries(r, { n: 2 }), render: RadarPanel }),
  def({ id: 'combo', label: 'Combo (bar + line)', description: 'First series as bars, the rest as lines.', category: 'charts', icon: Combine, size: { w: 6, h: 4 }, mock: (r) => M.mockSeries(r, { n: 2 }), render: ComboPanel }),
  def({ id: 'histogram', label: 'Histogram', description: 'Distribution of a measure in buckets.', category: 'charts', icon: ChartNoAxesColumn, size: { w: 6, h: 4 }, mock: (r) => M.mockHistogram(r), render: HistogramPanel }),
  def({ id: 'treemap', label: 'Treemap', description: 'Nested rectangles sized by value.', category: 'charts', icon: Grid3x3, size: { w: 6, h: 4 }, mock: (r) => M.mockNamed(r, 5), render: TreemapPanel }),
  def({ id: 'funnel', label: 'Funnel', description: 'Stages and drop-off.', category: 'charts', icon: FunnelIcon, size: { w: 4, h: 4 }, mock: (r) => M.mockFunnel(r), render: FunnelPanel }),
  def({ id: 'sankey', label: 'Sankey', description: 'Flow between stages.', category: 'charts', icon: GitFork, size: { w: 8, h: 4 }, mock: (r) => M.mockFlow(r), render: SankeyPanel }),
]

const single: AnyType[] = [
  def({ id: 'stat', label: 'Stat', description: 'One big number with its change.', category: 'single', icon: Sigma, blocks: VALUE_BLOCKS, size: { w: 3, h: 2 }, mock: (r) => M.mockValue(r, { label: 'Active units', base: 400, spread: 200 }), render: StatPanel }),
  def({ id: 'stat-spark', label: 'Stat with sparkline', description: 'A number with its recent trend.', category: 'single', icon: TrendingUp, blocks: VALUE_BLOCKS, size: { w: 3, h: 3 }, mock: (r) => M.mockValue(r, { label: 'Trips today', base: 900, spread: 400, spark: true }), render: StatSparkPanel }),
  def({ id: 'gauge', label: 'Gauge', description: 'A value against a range and target.', category: 'single', icon: Gauge, blocks: VALUE_BLOCKS, size: { w: 3, h: 3 }, mock: (r) => M.mockValue(r, { label: 'On-time rate', base: 70, spread: 25, unit: '%', min: 0, max: 100, target: 90 }), render: GaugePanel }),
  def({ id: 'bar-gauge', label: 'Bar gauge', description: 'Several values as horizontal meters.', category: 'single', icon: AlignLeft, blocks: DATA_BLOCKS, size: { w: 4, h: 3 }, mock: (r) => M.mockNamed(r, 4, 30, 60, 100), render: BarGaugePanel }),
  def({ id: 'progress-ring', label: 'Progress ring', description: 'Completion as a ring.', category: 'single', icon: Target, blocks: VALUE_BLOCKS, size: { w: 3, h: 3 }, mock: (r) => M.mockValue(r, { label: 'Target reached', base: 40, spread: 55, min: 0, max: 100 }), render: ProgressRingPanel }),
]

const tables: AnyType[] = [
  def({ id: 'table', label: 'Table (sortable, paged)', description: 'Rows and columns; click a header to sort.', category: 'tables', icon: Table2, size: { w: 8, h: 5 }, mock: (r) => M.mockTable(r), render: DataTablePanel, visualAccessible: true }),
  def({ id: 'top-n', label: 'Top N list', description: 'Ranked list of the biggest items.', category: 'tables', icon: ListOrdered, size: { w: 4, h: 3 }, mock: (r) => M.mockNamed(r, 5), render: TopNPanel, visualAccessible: true }),
  def({ id: 'alert-list', label: 'Alert list', description: 'Recent alerts with severity.', category: 'tables', icon: Siren, size: { w: 4, h: 4 }, mock: (r) => M.mockAlerts(r), render: ListPanel, visualAccessible: true }),
  def({ id: 'activity-log', label: 'Activity log', description: 'Who did what, newest first.', category: 'tables', icon: History, size: { w: 4, h: 4 }, mock: (r) => M.mockActivity(r), render: ListPanel, visualAccessible: true }),
]

const status: AnyType[] = [
  def({ id: 'heatmap-hour-day', label: 'Heatmap, hour by day', description: 'Activity by hour of day and weekday.', category: 'status', icon: Grid3x3, size: { w: 8, h: 4 }, mock: (r) => M.mockMatrix(r), render: HeatmapPanel }),
  def({ id: 'heatmap-calendar', label: 'Heatmap, calendar', description: 'A value per day across half a year.', category: 'status', icon: CalendarDays, size: { w: 8, h: 3 }, mock: (r) => M.mockCalendar(r), render: CalendarPanel }),
  def({ id: 'state-timeline', label: 'State timeline', description: 'Each unit’s state over a day.', category: 'status', icon: Hourglass, size: { w: 8, h: 4 }, mock: (r) => M.mockTimeline(r), render: TimelinePanel }),
  def({ id: 'status-history', label: 'Status history', description: 'Daily status of feeds or services.', category: 'status', icon: Radio, size: { w: 8, h: 3 }, mock: (r) => M.mockStatusHistory(r), render: StatusHistoryPanel }),
]

const maps: AnyType[] = [
  def({ id: 'map-points', label: 'Map, points', description: 'Unit positions. Placeholder background, no base map yet.', category: 'maps', icon: MapPinned, size: { w: 6, h: 5 }, mock: (r) => M.mockMap(r), render: (p) => <MapPanel {...p} mode="points" /> }),
  def({ id: 'map-route', label: 'Map, routes', description: 'Routes and waypoints. Placeholder background.', category: 'maps', icon: Route, size: { w: 6, h: 5 }, mock: (r) => M.mockMap(r), render: (p) => <MapPanel {...p} mode="route" /> }),
  def({ id: 'map-zones', label: 'Map, risk zones', description: 'Corridor risk zones. Placeholder background.', category: 'maps', icon: MapIcon, size: { w: 6, h: 5 }, mock: (r) => M.mockMap(r), render: (p) => <MapPanel {...p} mode="zones" /> }),
]

const content: AnyType[] = [
  def({ id: 'text', label: 'Text / Markdown', description: 'Notes, headings and lists.', category: 'content', icon: Type, blocks: NO_BLOCKS, size: { w: 4, h: 3 }, mock: () => M.mockText(), render: TextPanel, visualAccessible: true }),
  def({ id: 'image', label: 'Image / logo', description: 'A picture from this portal (same-origin only).', category: 'content', icon: ImageIcon, blocks: NO_BLOCKS, size: { w: 3, h: 3 }, mock: () => M.mockImage(), render: ImagePanel, visualAccessible: true }),
  def({ id: 'divider', label: 'Divider / row header', description: 'A heading line that separates rows.', category: 'content', icon: Minus, blocks: NO_BLOCKS, size: { w: 12, h: 1 }, mock: () => M.mockDivider(), render: DividerPanel, visualAccessible: true }),
  def({ id: 'links', label: 'Links', description: 'A list of links.', category: 'content', icon: LinkIcon, blocks: NO_BLOCKS, size: { w: 4, h: 2 }, mock: () => M.mockLinks(), render: LinksPanel, visualAccessible: true }),
]

const controls: AnyType[] = [
  ctl('ctl-folder', 'Folder dropdown', FolderTree, 'Publishes folder_name into the panels’ filters.', FOLDERS, (p) => <SelectControl {...p} name="Folder" fieldName={CONTROL_FIELD.folder} />),
  ctl('ctl-country', 'Country selector', Globe, 'Publishes a country filter.', COUNTRIES, (p) => <SelectControl {...p} name="Country" fieldName={CONTROL_FIELD.country} />),
  ctl('ctl-dates', 'Date-range picker', CalendarRange, 'Publishes a from/to date range.', [], DateRangeControl),
  ctl('ctl-multi', 'Multi-select', ListChecks, 'Publishes several status values.', STATUSES, MultiSelectControl),
  ctl('ctl-search', 'Search box', Search, 'Publishes a free-text filter.', [], SearchControl),
]

/** The eight WorldRisk panels, as named datasets with fixed (server-owned) queries in M5. Mock data until then. */
const ready = (id: string, label: string, dataset: string, icon: AnyType['icon'], base: AnyType, mock: AnyType['mock'], size = base.size): AnyType =>
  def({ id, label, description: `Named dataset “${dataset}” (mock data; real wiring in M5).`, category: 'ready', icon, blocks: NO_BLOCKS, size, min: base.min, dataset, mock, render: base.render, visualAccessible: base.visualAccessible, options: none.extend({ dataset: z.literal(dataset).default(dataset) }) })
const byId = (id: string) => [...charts, ...single, ...tables, ...status].find((t) => t.id === id)!

const readyMade: AnyType[] = [
  ready('wr-monthly-total-trucks', 'Monthly Total Trucks', 'worldrisk.monthly_total_trucks', Truck, byId('bar-grouped'), (r) => M.mockSeries(r, { x: 'month', n: 1, base: 300, spread: 200 })),
  ready('wr-escorts', 'Escorts', 'worldrisk.escorts', Shield, byId('stat-spark'), (r) => M.mockValue(r, { label: 'Escorts', base: 120, spread: 60, spark: true })),
  ready('wr-heatmap', 'Heatmap', 'worldrisk.heatmap', Grid3x3, byId('heatmap-hour-day'), (r) => M.mockMatrix(r)),
  ready('wr-active-tracks', 'Active Tracks', 'worldrisk.active_tracks', Activity, byId('stat'), (r) => M.mockValue(r, { label: 'Active tracks', base: 80, spread: 90 })),
  ready('wr-grand-total', 'Grand Total', 'worldrisk.grand_total', Container, byId('stat'), (r) => M.mockValue(r, { label: 'Grand total', base: 8000, spread: 4000 })),
  ready('wr-dispatched', 'Dispatched', 'worldrisk.dispatched', Flag, byId('bar-stacked'), (r) => M.mockSeries(r, { n: 2 })),
  ready('wr-daily', 'Daily', 'worldrisk.daily', Clock, byId('line'), (r) => M.mockSeries(r, { n: 1 })),
  ready('wr-weekly', 'Weekly', 'worldrisk.weekly', Calendar, byId('area'), (r) => M.mockSeries(r, { n: 1 })),
]

export const PANEL_TYPES: AnyType[] = [...charts, ...single, ...tables, ...status, ...maps, ...content, ...controls, ...readyMade]

const BY_ID = new Map(PANEL_TYPES.map((t) => [t.id, t]))
export const getPanelType = (id: string): AnyType | undefined => BY_ID.get(id)
export const panelTypesIn = (c: PanelCategory) => PANEL_TYPES.filter((t) => t.category === c)

/** Mock data for a type; stable per seed. Filters change the seed so controls visibly drive panels. */
export function mockDataFor(type: AnyType, seed: string, filters: Filters = {}) {
  const options = type.options.parse({})
  return type.mock(rng(hash(`${type.id}:${seed}:${JSON.stringify(filters)}`)), options)
}

const f = z.string().min(1).max(64)
/** Typed panel spec (docs/PLAN_BUILDER.md 4.1). `chart` is any registry id; options and blocks are checked against that entry. */
export const PanelSpecSchema = z
  .object({
    v: z.literal(1),
    chart: z.string().min(1).max(64),
    title: z.string().max(80).optional(),
    dataset: z.string().max(80).optional(),
    filters: z.array(z.object({ field: f, op: z.enum(['eq', 'neq', 'in', 'between', 'contains']), value: z.union([z.string().max(200), z.number(), z.array(z.string().max(200)).max(50)]) }).strict()).max(20).default([]),
    groupBy: z.array(z.object({ field: f, grain: z.enum(['hour', 'day', 'week', 'month']).optional() }).strict()).max(2).default([]),
    measure: z.object({ fn: z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max']), field: f.optional() }).strict().optional(),
    sort: z.object({ field: f, dir: z.enum(['asc', 'desc']) }).strict().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    options: z.record(z.unknown()).default({}),
  })
  .strict()
  .superRefine((s, ctx) => {
    const t = getPanelType(s.chart)
    if (!t) return void ctx.addIssue({ code: 'custom', path: ['chart'], message: `Unknown panel type "${s.chart}"` })
    if (t.soon) ctx.addIssue({ code: 'custom', path: ['chart'], message: `"${t.label}" is not available yet` })
    const o = t.options.safeParse(s.options)
    if (!o.success) for (const i of o.error.issues) ctx.addIssue({ ...i, path: ['options', ...i.path] })
    const used: [BlockKind, boolean][] = [['filter', s.filters.length > 0], ['groupBy', s.groupBy.length > 0], ['measure', !!s.measure], ['sort', !!s.sort], ['limit', s.limit !== undefined]]
    for (const [b, on] of used) if (on && !t.blocks.includes(b)) ctx.addIssue({ code: 'custom', path: [b], message: `"${t.label}" does not accept the ${b} block` })
  })
export type PanelSpec = z.infer<typeof PanelSpecSchema>

/** The spec a freshly dropped panel starts with. */
export function defaultSpec(id: string): PanelSpec {
  const t = getPanelType(id)
  if (!t) throw new Error(`Unknown panel type ${id}`)
  return PanelSpecSchema.parse({ v: 1, chart: id, title: t.label, dataset: t.dataset, options: t.options.parse({}) })
}
