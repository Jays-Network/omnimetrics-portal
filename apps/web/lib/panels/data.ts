/** Data shapes panels render. M3 is mock data; M5 fills the same shapes from named datasets / the compiler. */
export type Row = Record<string, string | number>
export type Severity = 'info' | 'warning' | 'critical'
export type CellState = 'ok' | 'warn' | 'down' | 'idle'

export type PanelData =
  | { kind: 'series'; x: string; series: { key: string; label: string }[]; rows: Row[] }
  | { kind: 'xy'; xLabel: string; yLabel: string; points: { x: number; y: number; name: string }[] }
  | { kind: 'value'; label: string; value: number; unit?: string; decimals?: number; min?: number; max?: number; target?: number; deltaPct?: number; spark?: number[] }
  | { kind: 'named'; items: { name: string; value: number }[]; max?: number }
  | { kind: 'table'; columns: { key: string; label: string; numeric?: boolean }[]; rows: Row[] }
  | { kind: 'list'; items: { id: string; time: string; title: string; detail?: string; severity: Severity }[] }
  | { kind: 'matrix'; xLabels: string[]; yLabels: string[]; values: number[][] }
  | { kind: 'calendar'; days: { date: string; value: number }[] }
  | { kind: 'timeline'; span: number; spanLabel: string; lanes: { label: string; segments: { from: number; to: number; state: CellState }[] }[] }
  | { kind: 'statusHistory'; labels: string[]; rows: { label: string; cells: CellState[] }[] }
  | {
      kind: 'map'
      points: { id: string; label: string; x: number; y: number }[]
      routes: { id: string; label: string; path: [number, number][] }[]
      zones: { id: string; label: string; risk: 'low' | 'medium' | 'high'; path: [number, number][] }[]
    }
  | { kind: 'flow'; nodes: { name: string }[]; links: { source: number; target: number; value: number }[] }
  | { kind: 'text'; markdown: string }
  | { kind: 'links'; items: { label: string; href: string }[] }
  | { kind: 'image'; alt: string; src: string }
  | { kind: 'divider'; title: string }
  | { kind: 'control'; options: { value: string; label: string }[] }

/** Screen-reader (and "view as table") form of a panel's data. */
export interface A11yTable {
  caption: string
  columns: string[]
  rows: (string | number)[][]
}

export const STATE_LABEL: Record<CellState, string> = { ok: 'OK', warn: 'Warning', down: 'Down', idle: 'Idle' }

/** Default data-table strategy; a registry entry may supply its own. */
export function autoTable(data: PanelData, caption: string): A11yTable {
  switch (data.kind) {
    case 'series':
      return { caption, columns: [data.x, ...data.series.map((s) => s.label)], rows: data.rows.map((r) => [String(r[data.x] ?? ''), ...data.series.map((s) => r[s.key] ?? '')]) }
    case 'xy':
      return { caption, columns: ['Name', data.xLabel, data.yLabel], rows: data.points.map((p) => [p.name, p.x, p.y]) }
    case 'value':
      return {
        caption,
        columns: ['Measure', 'Value', 'Unit', 'Target', 'Change %'],
        rows: [[data.label, data.value, data.unit ?? '', data.target ?? '', data.deltaPct ?? '']],
      }
    case 'named':
      return { caption, columns: ['Name', 'Value'], rows: data.items.map((i) => [i.name, i.value]) }
    case 'table':
      return { caption, columns: data.columns.map((c) => c.label), rows: data.rows.map((r) => data.columns.map((c) => r[c.key] ?? '')) }
    case 'list':
      return { caption, columns: ['Time', 'Severity', 'Item', 'Detail'], rows: data.items.map((i) => [i.time, i.severity, i.title, i.detail ?? '']) }
    case 'matrix':
      return { caption, columns: ['', ...data.xLabels], rows: data.yLabels.map((y, i) => [y, ...(data.values[i] ?? [])]) }
    case 'calendar':
      return { caption, columns: ['Date', 'Value'], rows: data.days.map((d) => [d.date, d.value]) }
    case 'timeline':
      return {
        caption,
        columns: ['Lane', 'State', `From (${data.spanLabel})`, `To (${data.spanLabel})`],
        rows: data.lanes.flatMap((l) => l.segments.map((s) => [l.label, STATE_LABEL[s.state], s.from, s.to])),
      }
    case 'statusHistory':
      return { caption, columns: ['Item', ...data.labels], rows: data.rows.map((r) => [r.label, ...r.cells.map((c) => STATE_LABEL[c])]) }
    case 'map':
      return {
        caption,
        columns: ['Type', 'Name', 'Detail'],
        rows: [
          ...data.points.map((p) => ['Point', p.label, `${p.x}, ${p.y}`]),
          ...data.routes.map((r) => ['Route', r.label, `${r.path.length} waypoints`]),
          ...data.zones.map((z) => ['Zone', z.label, `${z.risk} risk`]),
        ],
      }
    case 'flow':
      return { caption, columns: ['From', 'To', 'Value'], rows: data.links.map((l) => [data.nodes[l.source]?.name ?? '', data.nodes[l.target]?.name ?? '', l.value]) }
    case 'text':
      return { caption, columns: ['Text'], rows: [[data.markdown]] }
    case 'links':
      return { caption, columns: ['Label', 'Link'], rows: data.items.map((i) => [i.label, i.href]) }
    case 'image':
      return { caption, columns: ['Image'], rows: [[data.alt]] }
    case 'divider':
      return { caption, columns: ['Heading'], rows: [[data.title]] }
    case 'control':
      return { caption, columns: ['Option'], rows: data.options.map((o) => [o.label]) }
  }
}
