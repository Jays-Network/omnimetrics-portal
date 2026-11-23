import type { CellState, PanelData, Row } from './data'
import type { Rng } from './rng'

// MOCK DATA: obviously fake, seeded. Generators return the shape each panel renders.
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const GROUPS = ['Unit group A', 'Unit group B', 'Unit group C', 'Unit group D']
const CATS = ['Category A', 'Category B', 'Category C', 'Category D', 'Category E']

const seriesOf = (n: number) => GROUPS.slice(0, n).map((label, i) => ({ key: `s${i}`, label }))
const int = (r: Rng, base: number, spread: number) => Math.round(base + r() * spread)

export function mockSeries(r: Rng, o: { x?: 'day' | 'month'; n?: number; base?: number; spread?: number } = {}): PanelData {
  const labels = o.x === 'month' ? MONTHS : DAYS
  const series = seriesOf(o.n ?? 3)
  return {
    kind: 'series',
    x: o.x === 'month' ? 'Month' : 'Day',
    series,
    rows: labels.map((l) => Object.fromEntries([[o.x === 'month' ? 'Month' : 'Day', l], ...series.map((s) => [s.key, int(r, o.base ?? 30, o.spread ?? 60)])]) as Row),
  }
}
export const mockHistogram = (r: Rng): PanelData => ({
  kind: 'series',
  x: 'Bucket',
  series: [{ key: 's0', label: 'Units' }],
  rows: Array.from({ length: 10 }, (_, i) => ({ Bucket: `${i * 10}-${i * 10 + 9}`, s0: Math.round(60 * Math.exp(-(((i - 4) / 2.5) ** 2)) + r() * 12) })),
})
export const mockNamed = (r: Rng, n = 5, base = 20, spread = 80, max?: number): PanelData => ({
  kind: 'named',
  items: CATS.slice(0, n).map((name) => ({ name, value: int(r, base, spread) })).sort((a, b) => b.value - a.value),
  max,
})
export const mockFunnel = (r: Rng): PanelData => {
  let v = 1000 + r() * 500
  return { kind: 'named', items: ['Dispatched', 'En route', 'At border', 'Cleared', 'Delivered'].map((name) => ({ name, value: Math.round((v *= 0.6 + r() * 0.3)) })) }
}
export const mockXY = (r: Rng): PanelData => ({
  kind: 'xy',
  xLabel: 'Distance (km)',
  yLabel: 'Duration (h)',
  points: Array.from({ length: 24 }, (_, i) => {
    const x = Math.round(20 + r() * 480)
    return { x, y: Math.round((x / 60 + r() * 3) * 10) / 10, name: `Trip ${i + 1}` }
  }),
})
export const mockFlow = (r: Rng): PanelData => ({
  kind: 'flow',
  nodes: [{ name: 'Origin A' }, { name: 'Origin B' }, { name: 'Hub 1' }, { name: 'Hub 2' }, { name: 'Dest X' }, { name: 'Dest Y' }],
  links: [
    { source: 0, target: 2, value: int(r, 20, 30) },
    { source: 0, target: 3, value: int(r, 10, 20) },
    { source: 1, target: 2, value: int(r, 15, 20) },
    { source: 1, target: 3, value: int(r, 20, 30) },
    { source: 2, target: 4, value: int(r, 20, 20) },
    { source: 2, target: 5, value: int(r, 15, 20) },
    { source: 3, target: 4, value: int(r, 10, 20) },
    { source: 3, target: 5, value: int(r, 20, 20) },
  ],
})
export const mockValue = (r: Rng, o: { label: string; base: number; spread: number; unit?: string; decimals?: number; min?: number; max?: number; target?: number; spark?: boolean }): PanelData => ({
  kind: 'value',
  label: o.label,
  value: Number((o.base + r() * o.spread).toFixed(o.decimals ?? 0)),
  unit: o.unit,
  decimals: o.decimals,
  min: o.min,
  max: o.max,
  target: o.target,
  deltaPct: Number(((r() - 0.45) * 12).toFixed(1)),
  spark: o.spark ? Array.from({ length: 14 }, () => int(r, 20, 40)) : undefined,
})
export const mockTable = (r: Rng): PanelData => ({
  kind: 'table',
  columns: [
    { key: 'unit', label: 'Unit' },
    { key: 'group', label: 'Group' },
    { key: 'trips', label: 'Trips', numeric: true },
    { key: 'km', label: 'Distance (km)', numeric: true },
    { key: 'ontime', label: 'On time %', numeric: true },
  ],
  rows: Array.from({ length: 23 }, (_, i) => ({ unit: `UNIT-${String(i + 1).padStart(3, '0')}`, group: GROUPS[i % 4]!, trips: int(r, 5, 40), km: int(r, 400, 4000), ontime: int(r, 70, 30) })),
})
export const mockAlerts = (r: Rng): PanelData => ({
  kind: 'list',
  items: [
    ['critical', 'Signal lost', 'UNIT-014'],
    ['warning', 'Long idle at border', 'UNIT-007'],
    ['warning', 'Route deviation', 'UNIT-021'],
    ['info', 'Geofence entered', 'UNIT-003'],
    ['critical', 'Panic button', 'UNIT-018'],
    ['info', 'Battery low', 'UNIT-011'],
  ].map(([severity, title, detail], i) => ({ id: `a${i}`, time: `${String(int(r, 0, 23)).padStart(2, '0')}:${String(int(r, 0, 59)).padStart(2, '0')}`, title: title!, detail, severity: severity as 'info' | 'warning' | 'critical' })),
})
export const mockActivity = (r: Rng): PanelData => ({
  kind: 'list',
  items: ['Dashboard opened', 'Filter changed', 'Export requested', 'Panel added', 'Folder renamed', 'Dashboard saved'].map((title, i) => ({ id: `e${i}`, time: `${String(int(r, 0, 23)).padStart(2, '0')}:${String(int(r, 0, 59)).padStart(2, '0')}`, title, detail: `mock.user${(i % 3) + 1}`, severity: 'info' as const })),
})
export const mockMatrix = (r: Rng): PanelData => ({
  kind: 'matrix',
  xLabels: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')),
  yLabels: DAYS,
  values: DAYS.map(() => Array.from({ length: 24 }, (_, h) => Math.round(Math.max(0, Math.sin(((h - 6) / 24) * Math.PI * 2) * 40 + 45 + r() * 25)))),
})
export const mockCalendar = (r: Rng): PanelData => {
  const start = Date.UTC(2026, 0, 5)
  return { kind: 'calendar', days: Array.from({ length: 26 * 7 }, (_, i) => ({ date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), value: int(r, 0, 60) })) }
}
const pickState = (r: Rng): CellState => { const v = r(); return v < 0.7 ? 'ok' : v < 0.85 ? 'warn' : v < 0.93 ? 'down' : 'idle' }
export const mockTimeline = (r: Rng): PanelData => ({
  kind: 'timeline',
  span: 24,
  spanLabel: 'h',
  lanes: Array.from({ length: 5 }, (_, i) => {
    const segments: { from: number; to: number; state: CellState }[] = []
    for (let t = 0; t < 24; ) {
      const len = Math.min(24 - t, 1 + Math.floor(r() * 6))
      segments.push({ from: t, to: t + len, state: pickState(r) })
      t += len
    }
    return { label: `UNIT-${String(i + 1).padStart(3, '0')}`, segments }
  }),
})
export const mockStatusHistory = (r: Rng): PanelData => ({
  kind: 'statusHistory',
  labels: Array.from({ length: 30 }, (_, i) => `D-${30 - i}`),
  rows: ['Feed A', 'Feed B', 'Feed C', 'Feed D'].map((label) => ({ label, cells: Array.from({ length: 30 }, () => (r() < 0.9 ? 'ok' : pickState(r))) })),
})
export const mockMap = (r: Rng): PanelData => {
  const jitter = (n: number) => Math.round((n + (r() - 0.5) * 6) * 10) / 10
  return {
    kind: 'map',
    points: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, label: `Unit ${i + 1}`, x: Math.round(8 + r() * 84), y: Math.round(8 + r() * 44) })),
    routes: [
      { id: 'r1', label: 'Route 1', path: [[8, 48], [jitter(28), jitter(34)], [jitter(50), jitter(36)], [jitter(70), jitter(20)], [92, 12]] },
      { id: 'r2', label: 'Route 2', path: [[10, 14], [jitter(34), jitter(22)], [jitter(58), jitter(30)], [90, 46]] },
    ],
    zones: [
      { id: 'z1', label: 'Zone North', risk: 'high', path: [[40, 6], [62, 8], [66, 22], [44, 24]] },
      { id: 'z2', label: 'Zone Centre', risk: 'medium', path: [[22, 28], [42, 30], [44, 46], [20, 44]] },
      { id: 'z3', label: 'Zone East', risk: 'low', path: [[70, 30], [90, 28], [92, 48], [72, 50]] },
    ],
  }
}
export const mockText = (): PanelData => ({
  kind: 'text',
  markdown: '## Notes\n\nThis is **mock** text. Use *Markdown* for headings, lists and [links](https://example.com).\n\n- First point\n- Second point',
})
export const mockLinks = (): PanelData => ({
  kind: 'links',
  items: [
    { label: 'Operations handbook (mock)', href: 'https://example.com/handbook' },
    { label: 'Status page (mock)', href: 'https://example.com/status' },
    { label: 'Another dashboard', href: '/dashboard' },
  ],
})
export const mockImage = (): PanelData => ({ kind: 'image', alt: 'Portal emblem', src: '/brand/emblem-1024.png' })
export const mockDivider = (): PanelData => ({ kind: 'divider', title: 'Section heading' })
export const mockControl = (options: string[]): PanelData => ({ kind: 'control', options: options.map((o) => ({ value: o, label: o })) })
