import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { capabilitiesFor, type OrgAccess } from '@omnimetrics/types'
import { DashSpecSchema, SPEC_V, appendVersion, emptyDash, migrateSpec, normalizeSpec, parseSpec, restoreVersion, type DashVersion } from '@/lib/builder/model'
import { defaultSettings } from '@/lib/builder/settings'
import { validateSpecText } from '@/components/builder/settings-view'
import { mockPortal } from '@/lib/portal/mock'
import { resetMockContent } from '@/lib/portal/mock/content'
import { resetMockVersions } from '@/lib/portal/mock/versions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }))

const director: OrgAccess = { org: { id: 'mock-org-worldrisk', slug: 'worldrisk', name: 'WorldRisk', status: 'active' }, role: 'admin', isPlatform: true, capabilities: capabilitiesFor('admin', true) }
const panelSpec = { v: 1, chart: 'stat', title: 'Stat', filters: [], groupBy: [], options: {} }

/** A spec as the OLD dev server stored it: current layout units but no `settings` object. */
const v2NoSettings = () => ({ v: 2, panels: [{ id: 'a', spec: panelSpec, layout: { x: 24, y: 24, w: 480, h: 200, z: 0 } }], variables: {} })
/** The oldest shape: 12-column grid cells, no z, no settings. */
const v1Grid = () => ({ v: 1, panels: [{ id: 'a', spec: panelSpec, layout: { x: 1, y: 2, w: 3, h: 2 } }], variables: {} })

beforeEach(() => { resetMockContent(); resetMockVersions() })

describe('migrate and parse', () => {
  it('fills settings at every level, however much is missing', () => {
    for (const raw of [v2NoSettings(), { ...v2NoSettings(), settings: {} }, { ...v2NoSettings(), settings: { time: {} } }, { ...v2NoSettings(), settings: { time: {}, panelOptions: {}, general: {}, variables: [], links: [] } }]) {
      const s = normalizeSpec(raw)
      expect(s.v).toBe(SPEC_V)
      expect(s.settings.time.autoRefresh).toBe('off') // the exact read that crashed the editor
      expect(s.settings.time.refreshIntervals.length).toBeGreaterThan(0)
      expect(s.settings.panelOptions.lazyLoad).toBe(true)
      expect(s.settings.general.editable).toBe(true)
      expect(s.panels).toHaveLength(1)
    }
  })
  it('upgrades a v1 grid spec: cells to artboard units, z from order, settings defaulted', () => {
    const s = normalizeSpec(v1Grid())
    expect(s.v).toBe(SPEC_V)
    expect(s.panels[0]!.layout).toEqual({ x: 160, y: 200, w: 480, h: 200, z: 0 })
    expect(s.settings).toEqual(defaultSettings())
    expect(DashSpecSchema.safeParse(s).success).toBe(true)
    expect((migrateSpec(v1Grid()) as { variables?: unknown }).variables).toBeUndefined() // the old top-level record is dropped
  })
  it('never throws: junk becomes an empty valid dashboard, bad settings fall back to defaults and keep the panels', () => {
    expect(normalizeSpec(null)).toEqual(emptyDash())
    expect(normalizeSpec('x')).toEqual(emptyDash())
    expect(normalizeSpec({ v: 99, panels: 'no' })).toEqual(emptyDash())
    const s = normalizeSpec({ ...v2NoSettings(), settings: { time: { refreshIntervals: ['5s'] } } }) // invalid: below 30s
    expect(s.panels).toHaveLength(1)
    expect(s.settings.time.refreshIntervals).toEqual(defaultSettings().time.refreshIntervals)
  })
  it('parseSpec reports problems for strict callers and still refuses SQL', () => {
    expect(parseSpec(v2NoSettings()).ok).toBe(true)
    const bad = parseSpec({ ...v2NoSettings(), sql: 'select 1' })
    expect(bad.ok).toBe(false)
    expect(parseSpec({ ...v2NoSettings(), settings: { time: { refreshIntervals: ['5s'] } } }).ok).toBe(false)
  })
  it('JSON Model apply accepts an old shape (migrated) and still rejects bad input', () => {
    const ok = validateSpecText(JSON.stringify(v2NoSettings()))
    expect(ok.ok && ok.spec.settings.time.autoRefresh).toBe('off')
    expect(validateSpecText(JSON.stringify(v1Grid())).ok).toBe(true)
    expect(validateSpecText('{ nope').ok).toBe(false)
  })
})

describe('restoring an old version', () => {
  const old = (spec: unknown, n = 1): DashVersion => ({ n, createdAt: new Date(0).toISOString(), author: 'old', note: 'old', spec: spec as DashVersion['spec'] })

  it('yields a full, valid, current spec', () => {
    const list = [old(v1Grid(), 1), old(v2NoSettings(), 2)]
    for (const n of [1, 2]) {
      const next = restoreVersion(list, n, 'me', new Date(1))!
      const restored = next[next.length - 1]!
      expect(restored.note).toBe(`Restored from v${n}`)
      expect(restored.spec.v).toBe(SPEC_V)
      expect(restored.spec.settings.time.autoRefresh).toBe('off')
      expect(DashSpecSchema.safeParse(restored.spec).success).toBe(true)
    }
    expect(list[0]!.spec).toEqual(v1Grid()) // history itself is untouched
  })

  it('works through the portal on a store that already holds old, settings-less versions', async () => {
    const tree = await mockPortal.content.tree(director)
    const id = tree.find((n) => n.kind === 'dashboard')!.id
    // Simulate the dev server's in-memory store from before settings existed.
    const g = globalThis as unknown as { __omniMockVersions: Map<string, DashVersion[]> }
    g.__omniMockVersions.set(`${director.org.id}:${id}`, [old(v1Grid(), 1), old(v2NoSettings(), 2)])
    const list = (await mockPortal.dashboards.versions(director, id))!
    for (const v of list) {
      expect(v.spec.v).toBe(SPEC_V)
      expect(v.spec.settings.time.autoRefresh).toBe('off') // upgraded on read
    }
    const view = await mockPortal.dashboards.get(director, id)
    expect((view!.spec as { settings: unknown }).settings).toBeTruthy()
    const r = await mockPortal.dashboards.saveVersion(director, id, { restore: 1 }, 'me')
    expect(r.ok && r.versions.at(-1)!.spec.settings.time.autoRefresh).toBe('off')
    expect(r.ok && r.versions).toHaveLength(3) // append-only
  })

  it('appendVersion keeps whatever it is given; the load paths do the upgrading', () => {
    expect(appendVersion([], emptyDash(), 'a', 'n', new Date(0))[0]!.spec.v).toBe(SPEC_V)
  })
})

describe('the editor opens an old dashboard without crashing', () => {
  it('renders from a settings-less version (the reported crash)', async () => {
    const { Builder } = await import('@/components/builder/builder')
    const versions = [old(v2NoSettings())]
    const { container } = render(<Builder orgSlug="worldrisk" nodeId="wr-d3" orgName="WorldRisk" dashboardName="Daily" initialVersions={versions} showTerminal={false} />)
    expect(container.querySelector('[data-editor-root]')).not.toBeNull()
    const v1 = render(<Builder orgSlug="worldrisk" nodeId="wr-d3" orgName="WorldRisk" dashboardName="Daily" initialVersions={[old(v1Grid())]} showTerminal={false} />)
    expect(v1.container.querySelector('[data-editor-root]')).not.toBeNull()
  })
  function old(spec: unknown, n = 1): DashVersion {
    return { n, createdAt: new Date(0).toISOString(), author: 'old', note: 'old', spec: spec as DashVersion['spec'] }
  }
})
