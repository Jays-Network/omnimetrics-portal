import { describe, expect, it } from 'vitest'
import { CATEGORIES, CONNECTORS, STATUS_LABEL, canAdd, filterCatalogue } from '@/lib/admin/connectors'

describe('connector registry', () => {
  it('has the eleven agreed entries with unique ids, a valid category, a status and a description', () => {
    expect(CONNECTORS.map((c) => c.id)).toEqual(['postgres', 'supabase', 'mysql', 'sqlserver', 'sqlite', 'smartsheet', 'telegram', 'webhook', 'rest', 'csv', 'wialon'])
    expect(new Set(CONNECTORS.map((c) => c.id)).size).toBe(CONNECTORS.length)
    for (const c of CONNECTORS) {
      expect(Object.keys(STATUS_LABEL), c.id).toContain(c.status)
      expect(CATEGORIES.map((x) => x.id), c.id).toContain(c.category)
      expect(c.description.length, c.id).toBeGreaterThan(5)
    }
  })
  it('every connector that is not functional carries a reason; only PostgreSQL is functional', () => {
    for (const c of CONNECTORS) {
      if (c.status === 'functional') expect(canAdd(c)).toBe(true)
      else { expect(canAdd(c), c.id).toBe(false); expect((c.reason ?? '').length, `${c.id} needs a reason`).toBeGreaterThan(15) }
    }
    expect(CONNECTORS.filter((c) => c.status === 'functional').map((c) => c.id)).toEqual(['postgres'])
  })
  it('the stated statuses are honest', () => {
    const s = Object.fromEntries(CONNECTORS.map((c) => [c.id, c.status]))
    expect(s).toMatchObject({ supabase: 'planned', mysql: 'later', sqlserver: 'later', sqlite: 'deferred', smartsheet: 'planned', telegram: 'planned', webhook: 'planned', rest: 'later', csv: 'later', wialon: 'later' })
    expect(CONNECTORS.find((c) => c.id === 'sqlite')!.reason).toMatch(/filesystem/i)
  })
  it('uses no third-party brand logos: icons come from the generic category set', () => {
    for (const c of CATEGORIES) expect(typeof c.icon === 'function' || typeof c.icon === 'object').toBe(true)
    expect(JSON.stringify(CONNECTORS)).not.toMatch(/\.(svg|png|jpg)|https?:\/\//)
  })
})

describe('filterCatalogue', () => {
  const rows = [
    { name: 'WR warehouse', kind: 'postgres', host: 'db.mock-wr.internal', database: 'wr_reporting' },
    { name: 'Local database (read-only)', kind: 'postgres', host: 'localhost', database: 'jaysnet_data' },
  ]
  const all = { q: '', type: 'all', state: 'all' } as const
  it('returns everything by default', () => {
    const r = filterCatalogue(all, rows)
    expect(r.connected).toHaveLength(2); expect(r.available).toHaveLength(CONNECTORS.length)
  })
  it('State: connected hides the catalogue, available hides connections', () => {
    expect(filterCatalogue({ ...all, state: 'connected' }, rows).available).toEqual([])
    expect(filterCatalogue({ ...all, state: 'available' }, rows).connected).toEqual([])
  })
  it('Type narrows both lists by category', () => {
    const n = filterCatalogue({ ...all, type: 'notifications' }, rows)
    expect(n.connected).toEqual([]); expect(n.available.map((c) => c.id)).toEqual(['telegram', 'webhook'])
    expect(filterCatalogue({ ...all, type: 'databases' }, rows).connected).toHaveLength(2)
    expect(filterCatalogue({ ...all, type: 'maps' }, rows).available).toEqual([])
  })
  it('search is case-insensitive over name, publisher, host and database', () => {
    expect(filterCatalogue({ ...all, q: 'WAREHOUSE' }, rows).connected.map((r) => r.name)).toEqual(['WR warehouse'])
    expect(filterCatalogue({ ...all, q: 'jaysnet' }, rows).connected).toHaveLength(1)
    expect(filterCatalogue({ ...all, q: 'telematics' }, rows).available.map((c) => c.id)).toEqual(['wialon'])
    expect(filterCatalogue({ ...all, q: 'zzz' }, rows)).toEqual({ connected: [], available: [] })
  })
})
