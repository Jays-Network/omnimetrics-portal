import { describe, expect, it } from 'vitest'
import {
  FilterError,
  FiltersSchema,
  filtersFromSearchParams,
  isExcludedFolder,
  resolveFilters,
} from '@/lib/queries/filters'

const NOW = new Date('2026-11-20T12:00:00.000Z')
const UNIVERSE = ['FQM Tracking Sheets', 'Glencore', 'Reload', 'test sheets', 'Test Sheets ']
const admin = { role: 'admin' as const, allowed_projects: null }
const viewer = (p: string[]) => ({ role: 'viewer' as const, allowed_projects: p })

function err(fn: () => unknown): FilterError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(FilterError)
    return e as FilterError
  }
  throw new Error('expected FilterError')
}

describe('R1: test sheets excluded everywhere', () => {
  it('isExcludedFolder is trimmed and case-insensitive', () => {
    expect(isExcludedFolder('test sheets')).toBe(true)
    expect(isExcludedFolder(' Test Sheets ')).toBe(true)
    expect(isExcludedFolder('test sheets 2')).toBe(false)
  })

  it('admin All never includes it', () => {
    const r = resolveFilters(admin, {}, UNIVERSE, NOW)
    expect(r.folders).toEqual(['FQM Tracking Sheets', 'Glencore', 'Reload'])
  })

  it('admin explicit request: stripped, rest kept', () => {
    const r = resolveFilters(admin, { projects: ['test sheets', 'Glencore'] }, UNIVERSE, NOW)
    expect(r.folders).toEqual(['Glencore'])
  })

  it('request for only test sheets is an error, not "no filter"', () => {
    expect(err(() => resolveFilters(admin, { projects: ['test sheets'] }, UNIVERSE, NOW)).code).toBe('EMPTY_SCOPE')
  })

  it('stripped from a viewer grant too', () => {
    const r = resolveFilters(viewer(['Glencore', 'test sheets']), {}, UNIVERSE, NOW)
    expect(r.folders).toEqual(['Glencore'])
  })

  it('a viewer granted only test sheets has no access', () => {
    expect(err(() => resolveFilters(viewer(['test sheets']), {}, UNIVERSE, NOW)).code).toBe('NO_ACCESS')
  })
})

describe('scoping on raw folder_name', () => {
  it('admin: "All" sentinel and omitted both expand to the explicit list', () => {
    const a = resolveFilters(admin, { projects: ['All'] }, UNIVERSE, NOW).folders
    const b = resolveFilters(admin, {}, UNIVERSE, NOW).folders
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
  })

  it('admin: a mapped label is rejected as unknown', () => {
    const e = err(() => resolveFilters(admin, { projects: ['Steinweg Bridge'] }, UNIVERSE, NOW))
    expect(e.status).toBe(400)
    expect(e.code).toBe('UNKNOWN_FOLDER')
    expect(e.message).not.toContain('Steinweg')
  })

  it('viewer: subset of grant is fine', () => {
    const r = resolveFilters(viewer(['Glencore', 'Reload']), { projects: ['Reload'] }, UNIVERSE, NOW)
    expect(r.folders).toEqual(['Reload'])
  })

  it('viewer: All = whole grant', () => {
    const r = resolveFilters(viewer(['Glencore', 'Reload']), { projects: ['All'] }, UNIVERSE, NOW)
    expect(r.folders).toEqual(['Glencore', 'Reload'])
  })

  it('viewer: outside grant is 403 and does not echo the value', () => {
    const e = err(() => resolveFilters(viewer(['Glencore']), { projects: ['FQM Tracking Sheets'] }, UNIVERSE, NOW))
    expect(e.status).toBe(403)
    expect(e.code).toBe('FORBIDDEN_FOLDER')
    expect(e.message).not.toContain('FQM')
  })

  it('viewer: mixed request with one forbidden folder fails whole, not partially', () => {
    expect(err(() => resolveFilters(viewer(['Glencore']), { projects: ['Glencore', 'Reload'] }, UNIVERSE, NOW)).status).toBe(403)
  })

  it('empty grant = no access, even when asking for All', () => {
    expect(err(() => resolveFilters(viewer([]), {}, UNIVERSE, NOW)).code).toBe('NO_ACCESS')
  })

  it('fails closed on inconsistent users', () => {
    expect(err(() => resolveFilters({ role: 'viewer', allowed_projects: null }, {}, UNIVERSE, NOW)).code).toBe('NO_ACCESS')
    expect(err(() => resolveFilters({ role: 'admin', allowed_projects: ['Glencore'] }, {}, UNIVERSE, NOW)).code).toBe('NO_ACCESS')
  })

  it('empty universe for admin is an error, not "no filter"', () => {
    expect(err(() => resolveFilters(admin, {}, [], NOW)).code).toBe('EMPTY_SCOPE')
  })

  it('duplicates are collapsed', () => {
    const r = resolveFilters(admin, { projects: ['Glencore', 'Glencore'] }, UNIVERSE, NOW)
    expect(r.folders).toEqual(['Glencore'])
  })

  it('SQL-looking input is only ever a rejected value, never passed through', () => {
    const e = err(() => resolveFilters(admin, { projects: ["x'; DROP TABLE worldrisk_tracking;--"] }, UNIVERSE, NOW))
    expect(e.code).toBe('UNKNOWN_FOLDER')
  })
})

describe('countries', () => {
  it('omitted, empty and All mean null (no country predicate)', () => {
    expect(resolveFilters(admin, {}, UNIVERSE, NOW).countries).toBeNull()
    expect(resolveFilters(admin, { countries: [] }, UNIVERSE, NOW).countries).toBeNull()
    expect(resolveFilters(admin, { countries: ['DRC', 'All'] }, UNIVERSE, NOW).countries).toBeNull()
  })
  it('keeps a valid list', () => {
    expect(resolveFilters(admin, { countries: ['DRC', 'South Africa', 'DRC'] }, UNIVERSE, NOW).countries).toEqual(['DRC', 'South Africa'])
  })
  it('rejects Other and unknown names', () => {
    expect(err(() => resolveFilters(admin, { countries: ['Other'] }, UNIVERSE, NOW)).code).toBe('INVALID_FILTERS')
    expect(err(() => resolveFilters(admin, { countries: ['Malawi'] }, UNIVERSE, NOW)).code).toBe('INVALID_FILTERS')
  })
})

describe('time range', () => {
  it('defaults to now-6h .. now', () => {
    const r = resolveFilters(admin, {}, UNIVERSE, NOW)
    expect(r.to).toBe('2026-11-20T12:00:00.000Z')
    expect(r.from).toBe('2026-11-20T06:00:00.000Z')
  })
  it('only to: from is to-6h; only from: to is now', () => {
    expect(resolveFilters(admin, { to: '2026-11-01T10:00:00Z' }, UNIVERSE, NOW).from).toBe('2026-11-01T04:00:00.000Z')
    expect(resolveFilters(admin, { from: '2026-11-01T00:00:00Z' }, UNIVERSE, NOW).to).toBe('2026-11-20T12:00:00.000Z')
  })
  it('accepts offsets and normalises to UTC', () => {
    const r = resolveFilters(admin, { from: '2026-11-01T00:00:00+02:00', to: '2026-11-02T00:00:00+02:00' }, UNIVERSE, NOW)
    expect(r.from).toBe('2026-10-31T22:00:00.000Z')
    expect(r.to).toBe('2026-11-01T22:00:00.000Z')
  })
  it('rejects from > to, bad dates and spans over the cap', () => {
    expect(err(() => resolveFilters(admin, { from: '2026-11-02T00:00:00Z', to: '2026-11-01T00:00:00Z' }, UNIVERSE, NOW)).code).toBe('INVALID_RANGE')
    expect(err(() => resolveFilters(admin, { from: 'yesterday' }, UNIVERSE, NOW)).code).toBe('INVALID_FILTERS')
    expect(err(() => resolveFilters(admin, { from: '2000-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }, UNIVERSE, NOW)).code).toBe('INVALID_RANGE')
  })
})

describe('schema', () => {
  it('is strict: unknown keys are rejected', () => {
    expect(FiltersSchema.safeParse({ projects: ['a'], sql: 'select 1' }).success).toBe(false)
  })
  it('rejects oversized lists, empty strings and bad years', () => {
    expect(FiltersSchema.safeParse({ projects: Array.from({ length: 501 }, (_, i) => `f${i}`) }).success).toBe(false)
    expect(FiltersSchema.safeParse({ projects: [''] }).success).toBe(false)
    expect(FiltersSchema.safeParse({ projects: ['x'.repeat(201)] }).success).toBe(false)
    expect(FiltersSchema.safeParse({ years: ['26'] }).success).toBe(false)
  })
  it('years pass through for the deferred heatmap', () => {
    expect(resolveFilters(admin, { years: ['2026', '2026', '2025'] }, UNIVERSE, NOW).years).toEqual(['2026', '2025'])
    expect(resolveFilters(admin, {}, UNIVERSE, NOW).years).toBeNull()
  })
  it('rejects non-object input', () => {
    expect(err(() => resolveFilters(admin, 'x', UNIVERSE, NOW)).code).toBe('INVALID_FILTERS')
  })
})

describe('filtersFromSearchParams', () => {
  it('uses repeated keys so commas in folder names survive', () => {
    const p = new URLSearchParams()
    p.append('projects', 'A, B Ltd')
    p.append('projects', 'Glencore')
    p.append('countries', 'DRC')
    p.set('from', '2026-11-01T00:00:00Z')
    expect(filtersFromSearchParams(p)).toEqual({
      projects: ['A, B Ltd', 'Glencore'],
      countries: ['DRC'],
      from: '2026-11-01T00:00:00Z',
    })
  })
  it('returns {} when nothing is set', () => {
    expect(filtersFromSearchParams(new URLSearchParams())).toEqual({})
  })
})
