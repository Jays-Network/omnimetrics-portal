import { Bell, Database, Globe, Plug, Truck, type LucideIcon } from 'lucide-react'

/**
 * Connector catalogue (docs/PLAN_BUILDER.md section 5), data-driven like the panel registry: add a connector =
 * one entry here. Honest by construction: only `functional` connectors can be added, and every other status
 * must carry the reason shown on its card. No third-party brand logos; icons are generic and tinted by category.
 */
export type ConnectorStatus = 'functional' | 'planned' | 'later' | 'deferred'
export type ConnectorCategory = 'databases' | 'logistics' | 'notifications' | 'maps' | 'other'

export const CATEGORIES: { id: ConnectorCategory; label: string; icon: LucideIcon; tint: number }[] = [
  { id: 'databases', label: 'Databases', icon: Database, tint: 1 },
  { id: 'logistics', label: 'Logistics', icon: Truck, tint: 2 },
  { id: 'notifications', label: 'Notifications', icon: Bell, tint: 3 },
  { id: 'maps', label: 'Maps', icon: Globe, tint: 4 },
  { id: 'other', label: 'Other', icon: Plug, tint: 5 },
]

export interface Connector {
  id: string
  name: string
  publisher: string
  category: ConnectorCategory
  status: ConnectorStatus
  description: string
  /** Required for every status except `functional`: why it cannot be added yet. */
  reason?: string
}

export const STATUS_LABEL: Record<ConnectorStatus, string> = { functional: 'Available (mock)', planned: 'Planned', later: 'Later', deferred: 'Deferred' }

export const CONNECTORS: Connector[] = [
  { id: 'postgres', name: 'PostgreSQL', publisher: 'Read-only SQL', category: 'databases', status: 'functional', description: 'Read tracking and reporting tables through an allowlisted host. Works in the mock; the real connector arrives in M5.' },
  { id: 'supabase', name: 'Supabase', publisher: 'PostgreSQL-compatible', category: 'databases', status: 'planned', description: 'A hosted Postgres you already run.', reason: 'Planned: it will reuse the PostgreSQL connector once real connections exist (M5).' },
  { id: 'mysql', name: 'MySQL', publisher: 'Read-only SQL', category: 'databases', status: 'later', description: 'Same connector interface as PostgreSQL.', reason: 'Later: after the PostgreSQL connector has passed the isolation tests.' },
  { id: 'sqlserver', name: 'SQL Server', publisher: 'Read-only SQL', category: 'databases', status: 'later', description: 'Microsoft SQL Server, read-only.', reason: 'Later: needs its own driver and a security review.' },
  { id: 'sqlite', name: 'SQLite', publisher: 'File database', category: 'databases', status: 'deferred', description: 'A database in a single file.', reason: 'Deferred: SQLite means filesystem access (paths, ATTACH, extensions), so it waits until uploads can be sandboxed.' },
  { id: 'smartsheet', name: 'Smartsheet', publisher: 'Sheets API', category: 'other', status: 'planned', description: 'Sheets as a data source.', reason: 'Planned: needs the encrypted credential store from M5.' },
  { id: 'telegram', name: 'Telegram bot', publisher: 'Messaging', category: 'notifications', status: 'planned', description: 'Send alerts to a chat.', reason: 'Planned: alerting is not built yet, and a bot token must be stored encrypted (M5).' },
  { id: 'webhook', name: 'Outgoing webhook', publisher: 'HTTP', category: 'notifications', status: 'planned', description: 'Post alert events to a URL you control.', reason: 'Planned: needs the same host allowlist and SSRF protection as databases (M5).' },
  { id: 'rest', name: 'REST / JSON API', publisher: 'HTTP', category: 'other', status: 'later', description: 'Read JSON from an HTTP endpoint.', reason: 'Later: outgoing HTTP needs the SSRF-hardened connector first.' },
  { id: 'csv', name: 'CSV upload', publisher: 'File upload', category: 'other', status: 'later', description: 'Upload a CSV and query it.', reason: 'Later: needs sandboxed file storage and size limits.' },
  { id: 'wialon', name: 'Wialon', publisher: 'Fleet telematics', category: 'logistics', status: 'later', description: 'Vehicle positions and events.', reason: 'Later: needs an API credential and a dataset design.' },
]

export const connectorById = (id: string) => CONNECTORS.find((c) => c.id === id)
export const categoryOf = (id: ConnectorCategory) => CATEGORIES.find((c) => c.id === id)!
export const canAdd = (c: Connector) => c.status === 'functional'

export type StateFilter = 'all' | 'connected' | 'available'
export type TypeFilter = 'all' | ConnectorCategory
export interface Filters { q: string; type: TypeFilter; state: StateFilter }
interface ConnRow { name: string; kind: string; host: string; database: string }

const hay = (...p: string[]) => p.join(' ').toLowerCase()
/** Pure catalogue filter (search matches name, publisher, kind, host and database; case-insensitive). */
export function filterCatalogue<R extends ConnRow>(f: Filters, rows: R[], connectors: Connector[] = CONNECTORS): { connected: R[]; available: Connector[] } {
  const q = f.q.trim().toLowerCase()
  const catOf = (kind: string) => connectorById(kind)?.category ?? 'other'
  const connected = f.state === 'available' ? [] : rows.filter((r) => (f.type === 'all' || catOf(r.kind) === f.type) && (!q || hay(r.name, r.kind, r.host, r.database, connectorById(r.kind)?.name ?? '').includes(q)))
  const available = f.state === 'connected' ? [] : connectors.filter((c) => (f.type === 'all' || c.category === f.type) && (!q || hay(c.name, c.publisher, c.description, c.id).includes(q)))
  return { connected, available }
}
