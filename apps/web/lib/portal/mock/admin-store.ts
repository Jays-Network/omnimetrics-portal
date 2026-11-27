import type { Role } from '@omnimetrics/types'
import type { AllowedHost, AuditEntry, IntegrationRow, SessionRow } from '@/lib/admin/types'
import type { PartialSettings } from '@/lib/settings/model'

// MOCK admin data (M4): in memory on globalThis, keyed by organisation id. Nothing is stored or sent anywhere.
// Obviously fake names. The credentials vault is private to this module's service and never read by a response builder.
export interface MOrg { id: string; slug: string; name: string; status: 'active' | 'suspended' | 'archived'; dashboards: number }
export interface MUser { id: string; username: string; email: string; isPlatform: boolean }
export interface MMember { userId: string; orgId: string; role: Role; active: boolean; folders: string[] | null; grants: string }

export interface AdminDB {
  orgs: MOrg[]
  users: MUser[]
  members: MMember[]
  integrations: Map<string, IntegrationRow[]> // by org id
  vault: Map<string, string> // `${orgId}:${integrationId}` -> secret. WRITE-ONLY from the outside.
  hosts: AllowedHost[]
  audit: AuditEntry[]
  sessions: SessionRow[]
  /** Fake passwords the mock itself issued (and their replacements). Nothing here can sign in anywhere. */
  passwords: Map<string, string>
  tests: Map<string, number[]> // rate limit: `${orgId}:${actor}` -> timestamps
  settings: { system: PartialSettings; org: Map<string, PartialSettings>; user: Map<string, PartialSettings> }
  seq: number
}

export const FOLDERS: Record<string, string[]> = {
  worldrisk: ['Mock Fleet North', 'Mock Fleet South', 'Mock Cross-border', 'Mock Depot Yard'],
  adars: ['Mock Rail Line 1', 'Mock Rail Line 2', 'Mock Terminal'],
}

const iso = (m: number) => new Date(Date.UTC(2026, 10, 23, 8, 0) - m * 60_000).toISOString()

export const LOCAL_ROW: Omit<IntegrationRow, 'lastTest'> = {
  id: 'managed-local', name: 'Local database (read-only)', kind: 'postgres', host: 'localhost', port: 5432, database: 'jaysnet_data',
  relations: ['public'], sslMode: 'disable', status: 'managed', managed: true, hasCredentials: false, keyId: null, rotatedAt: null, usedBy: 5,
}

function seed(): AdminDB {
  const orgs: MOrg[] = [
    { id: 'mock-org-worldrisk', slug: 'worldrisk', name: 'WorldRisk', status: 'active', dashboards: 8 },
    { id: 'mock-org-adars', slug: 'adars', name: 'ADARS', status: 'active', dashboards: 3 },
  ]
  const users: MUser[] = [
    { id: 'u-director', username: 'director', email: 'director@mock.invalid', isPlatform: true },
    { id: 'u-maria', username: 'maria.mock', email: 'maria@mock.invalid', isPlatform: false },
    { id: 'u-sam', username: 'sam.mock', email: 'sam@mock.invalid', isPlatform: false },
    { id: 'u-lee', username: 'lee.mock', email: 'lee@mock.invalid', isPlatform: false },
    { id: 'u-ana', username: 'ana.mock', email: 'ana@mock.invalid', isPlatform: false },
    { id: 'u-tom', username: 'tom.mock', email: 'tom@mock.invalid', isPlatform: false },
  ]
  const wr = 'mock-org-worldrisk', ad = 'mock-org-adars'
  const members: MMember[] = [
    { userId: 'u-maria', orgId: wr, role: 'viewer', active: true, folders: ['Mock Fleet North'], grants: 'View: Fleet Operations' },
    { userId: 'u-sam', orgId: wr, role: 'builder', active: true, folders: ['Mock Fleet North', 'Mock Cross-border'], grants: 'Edit: Fleet Operations' },
    { userId: 'u-lee', orgId: wr, role: 'viewer', active: true, folders: ['Mock Fleet South'], grants: 'View: Safety and Compliance' },
    { userId: 'u-maria', orgId: ad, role: 'admin', active: true, folders: null, grants: 'Everything in this organisation' },
    { userId: 'u-ana', orgId: ad, role: 'builder', active: true, folders: ['Mock Rail Line 1'], grants: 'Edit: Rail Operations' },
    { userId: 'u-tom', orgId: ad, role: 'viewer', active: false, folders: ['Mock Terminal'], grants: 'View: Rail Operations' },
  ]
  const hosts: AllowedHost[] = [
    { id: 'h1', host: 'localhost', portMin: 5432, portMax: 5432 },
    { id: 'h2', host: 'db.mock-wr.internal', portMin: 5432, portMax: 5439 },
    { id: 'h3', host: 'warehouse.mock-adars.internal', portMin: 5432, portMax: 5432 },
  ]
  const integrations = new Map<string, IntegrationRow[]>()
  const vault = new Map<string, string>()
  integrations.set(wr, [
    { ...LOCAL_ROW, lastTest: { ok: true, at: iso(90), message: 'Connected (mock).' } },
    { id: 'int-wr-1', name: 'WorldRisk warehouse', kind: 'postgres', host: 'db.mock-wr.internal', port: 5432, database: 'wr_reporting', relations: ['reporting'], sslMode: 'verify-full', status: 'ok', managed: false, hasCredentials: true, keyId: 'k1', rotatedAt: iso(60 * 24 * 12), usedBy: 2, lastTest: { ok: true, at: iso(300), message: 'Connected (mock).' } },
  ])
  vault.set(`${wr}:int-wr-1`, 'seed-secret-not-a-real-password')
  integrations.set(ad, [{ ...LOCAL_ROW, lastTest: null }])
  const sessions: SessionRow[] = [
    { id: 's-dir-1', userId: 'u-director', device: 'Chrome on Linux (this browser)', ip: '10.0.0.x', startedAt: iso(120), lastSeenAt: iso(1), current: true },
    { id: 's-dir-2', userId: 'u-director', device: 'Safari on iPhone', ip: '10.0.1.x', startedAt: iso(60 * 30), lastSeenAt: iso(60 * 5), current: false },
    { id: 's-sam-1', userId: 'u-sam', device: 'Firefox on Windows', ip: '10.0.2.x', startedAt: iso(300), lastSeenAt: iso(20), current: false },
    { id: 's-sam-2', userId: 'u-sam', device: 'Edge on Windows', ip: '10.0.2.x', startedAt: iso(60 * 50), lastSeenAt: iso(60 * 26), current: false },
    { id: 's-maria-1', userId: 'u-maria', device: 'Chrome on macOS', ip: '10.0.3.x', startedAt: iso(500), lastSeenAt: iso(45), current: false },
    { id: 's-ana-1', userId: 'u-ana', device: 'Chrome on Android', ip: '10.0.4.x', startedAt: iso(900), lastSeenAt: iso(200), current: false },
  ]
  return { orgs, users, members, integrations, vault, hosts, audit: [], sessions, passwords: new Map(), tests: new Map(), settings: { system: {}, org: new Map(), user: new Map() }, seq: 100 }
}

const g = globalThis as unknown as { __omniMockAdmin?: AdminDB }
export const db = (): AdminDB => (g.__omniMockAdmin ??= seed())
export const resetMockAdmin = () => { g.__omniMockAdmin = undefined }
export const nextId = (p: string) => `${p}-${++db().seq}`

/** Injectable clock so tests can step through the 5-per-minute window. */
export const clock = { now: () => Date.now() }
