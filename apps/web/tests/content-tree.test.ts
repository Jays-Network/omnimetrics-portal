import { beforeEach, describe, expect, it } from 'vitest'
import { capabilitiesFor, MAX_TREE_DEPTH, type OrgAccess, type Role } from '@omnimetrics/types'
import { mockPortal } from '@/lib/portal/mock'
import { resetMockContent } from '@/lib/portal/mock/content'
import { applyOp, childrenOf, depthOf, toClient, type StoredNode } from '@/lib/portal/tree'
import { seedFor } from '@/lib/portal/mock/seed'
import { pickDefaultOrg } from '@/lib/portal/org-pref'
import { previewOptions, reduceAccess } from '@/lib/portal/preview'
import { activeTabKey, switchOrgHref } from '@/components/shell/nav'

const org = (slug: string, role: Role, isPlatform = false): OrgAccess => ({
  org: { id: `mock-org-${slug}`, slug, name: slug, status: 'active' },
  role,
  isPlatform,
  capabilities: capabilitiesFor(role, isPlatform),
})
const admin = org('worldrisk', 'admin')
const builder = org('worldrisk', 'builder')
const viewer = org('worldrisk', 'viewer')
const wrSeed = () => seedFor('worldrisk')
const idOf = (nodes: StoredNode[], name: string, kind?: string) => nodes.find((n) => n.name === name && (!kind || n.kind === kind))!.id

beforeEach(() => resetMockContent())

describe('mock seeds', () => {
  it('are different per organisation, nest at least 3 levels, and use only unique sibling names', () => {
    const wr = seedFor('worldrisk')
    const ad = seedFor('adars')
    expect(wr.length).toBeGreaterThan(30)
    expect(ad.length).toBeGreaterThan(20)
    expect(new Set(wr.map((n) => n.name)).has('Fleet Operations')).toBe(true)
    expect(new Set(ad.map((n) => n.name)).has('Fleet Operations')).toBe(false)
    expect(Math.max(...wr.map((n) => depthOf(wr, n.id)))).toBeGreaterThanOrEqual(4)
    for (const nodes of [wr, ad]) {
      const seen = new Set<string>()
      for (const n of nodes) {
        const key = `${n.parentId}/${n.name.toLowerCase()}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
  })
})

describe('tree rules', () => {
  it('lets only admins create top-level folders; builders work inside folders; viewers change nothing', () => {
    const nodes = wrSeed()
    expect(applyOp(nodes, admin, { op: 'create', kind: 'folder', parentId: null, name: 'Ops' }).ok).toBe(true)
    const b = applyOp(nodes, builder, { op: 'create', kind: 'folder', parentId: null, name: 'Ops' })
    expect(b.ok).toBe(false)
    expect(applyOp(nodes, builder, { op: 'create', kind: 'folder', parentId: idOf(nodes, 'Domestic'), name: 'Sub' }).ok).toBe(true)
    expect(applyOp(nodes, viewer, { op: 'create', kind: 'folder', parentId: idOf(nodes, 'Domestic'), name: 'Sub' })).toMatchObject({ ok: false, code: 'forbidden' })
    expect(applyOp(nodes, viewer, { op: 'rename', id: idOf(nodes, 'Domestic'), name: 'X' }).ok).toBe(false)
    expect(applyOp(nodes, viewer, { op: 'delete', id: idOf(nodes, 'Domestic') }).ok).toBe(false)
    // builders cannot touch top-level folders
    expect(applyOp(nodes, builder, { op: 'delete', id: idOf(nodes, 'Fleet Operations') }).ok).toBe(false)
    expect(applyOp(nodes, builder, { op: 'rename', id: idOf(nodes, 'Fleet Operations'), name: 'Zed' }).ok).toBe(false)
  })

  it('rejects dashboards at top level, duplicate sibling names (case-insensitive), bad names', () => {
    const nodes = wrSeed()
    expect(applyOp(nodes, admin, { op: 'create', kind: 'dashboard', parentId: null, name: 'Loose' }).ok).toBe(false)
    const fo = idOf(nodes, 'Fleet Operations')
    expect(applyOp(nodes, admin, { op: 'create', kind: 'folder', parentId: fo, name: 'cross-BORDER' })).toMatchObject({ ok: false, code: 'conflict' })
    expect(applyOp(nodes, admin, { op: 'rename', id: fo, name: '   ' })).toMatchObject({ ok: false, code: 'invalid' })
    expect(applyOp(nodes, admin, { op: 'rename', id: fo, name: 'a/b' }).ok).toBe(false)
    expect(applyOp(nodes, admin, { op: 'rename', id: fo, name: 'x'.repeat(61) }).ok).toBe(false)
    // dashboards cannot hold children
    const dash = idOf(nodes, 'Fleet Utilisation', 'dashboard')
    expect(applyOp(nodes, admin, { op: 'create', kind: 'folder', parentId: dash, name: 'Inside' }).ok).toBe(false)
  })

  it('enforces the maximum depth on create and move, and forbids moving a folder into itself', () => {
    let nodes = wrSeed()
    let parent: string | null = null
    for (let i = 0; i < MAX_TREE_DEPTH; i++) {
      const out: { stored?: StoredNode[] } = {}
      const r = applyOp(nodes, admin, { op: 'create', kind: 'folder', parentId: parent, name: `Deep ${i}` }, out)
      expect(r.ok).toBe(true)
      nodes = out.stored!
      parent = nodes.find((n) => n.name === `Deep ${i}`)!.id
    }
    expect(applyOp(nodes, admin, { op: 'create', kind: 'folder', parentId: parent, name: 'Too deep' }).ok).toBe(false)
    const fo = idOf(nodes, 'Fleet Operations')
    expect(applyOp(nodes, admin, { op: 'move', id: fo, parentId: parent }).ok).toBe(false) // would exceed depth
    const cb = idOf(nodes, 'Cross-border')
    expect(applyOp(nodes, admin, { op: 'move', id: fo, parentId: cb })).toMatchObject({ ok: false })
    expect(applyOp(nodes, admin, { op: 'move', id: fo, parentId: fo }).ok).toBe(false)
  })

  it('moves between folders, reorders siblings, and keeps ids stable', () => {
    const nodes = wrSeed()
    const dom = idOf(nodes, 'Domestic')
    const dash = idOf(nodes, 'Fleet Utilisation', 'dashboard')
    const out: { stored?: StoredNode[] } = {}
    const r = applyOp(nodes, admin, { op: 'move', id: dash, parentId: dom, index: 0 }, out)
    expect(r.ok).toBe(true)
    const next = toClient(out.stored!)
    expect(next.find((n) => n.id === dash)?.parentId).toBe(dom)
    expect(childrenOf(next, dom)[0]!.id).toBe(dash)
    // unique-name clash on move is refused: "Daily Overview" exists in both Cross-border and Domestic
    const dailyDom = nodes.find((n) => n.name === 'Daily Overview' && n.parentId === dom)!.id
    expect(applyOp(nodes, admin, { op: 'move', id: dailyDom, parentId: idOf(nodes, 'Cross-border') })).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('soft-deletes a subtree and restores it exactly (undo)', () => {
    const nodes = wrSeed()
    const cb = idOf(nodes, 'Cross-border')
    const out: { stored?: StoredNode[] } = {}
    const del = applyOp(nodes, admin, { op: 'delete', id: cb }, out)
    expect(del.ok && del.deletedCount).toBeGreaterThan(5)
    if (!del.ok) return
    expect(del.nodes.some((n) => n.id === cb)).toBe(false)
    expect(del.nodes.some((n) => n.name === 'Transit Times')).toBe(false)
    const out2: { stored?: StoredNode[] } = {}
    const res = applyOp(out.stored!, admin, { op: 'restore', batchId: del.batchId! }, out2)
    expect(res.ok).toBe(true)
    expect(toClient(out2.stored!).map((n) => n.id).sort()).toEqual(toClient(nodes).map((n) => n.id).sort())
    // viewers and builders without rights cannot restore either
    expect(applyOp(out.stored!, viewer, { op: 'restore', batchId: del.batchId! }).ok).toBe(false)
  })

  it('refuses to restore under a deleted parent and renames on a name clash', () => {
    const nodes = wrSeed()
    const dom = idOf(nodes, 'Domestic')
    const child = nodes.find((n) => n.name === 'Fuel and Idle')!.id
    const o1: { stored?: StoredNode[] } = {}
    const d1 = applyOp(nodes, admin, { op: 'delete', id: child }, o1)
    const o2: { stored?: StoredNode[] } = {}
    const d2 = applyOp(o1.stored!, admin, { op: 'delete', id: dom }, o2)
    if (!d1.ok || !d2.ok) throw new Error('setup')
    expect(applyOp(o2.stored!, admin, { op: 'restore', batchId: d1.batchId! })).toMatchObject({ ok: false, code: 'conflict' })
    // clash: recreate a same-named sibling, then restore the original
    const o3: { stored?: StoredNode[] } = {}
    applyOp(o1.stored!, admin, { op: 'create', kind: 'dashboard', parentId: dom, name: 'Fuel and Idle' }, o3)
    const r = applyOp(o3.stored!, admin, { op: 'restore', batchId: d1.batchId! })
    expect(r.ok && r.nodes.some((n) => n.name === 'Fuel and Idle (restored)')).toBe(true)
  })
})

describe('mock portal isolation (R: orgs never bleed)', () => {
  const adarsAdmin = org('adars', 'admin')
  it('returns a different tree per organisation and hides foreign ids', async () => {
    const wr = await mockPortal.content.tree(admin)
    const ad = await mockPortal.content.tree(adarsAdmin)
    expect(wr.map((n) => n.id).some((id) => ad.some((a) => a.id === id))).toBe(false)
    const wrDash = wr.find((n) => n.kind === 'dashboard')!
    expect(await mockPortal.dashboards.get(admin, wrDash.id)).not.toBeNull()
    expect(await mockPortal.dashboards.get(adarsAdmin, wrDash.id)).toBeNull()
    // mutating a foreign id through the other org fails closed
    expect(await mockPortal.content.apply(adarsAdmin, { op: 'rename', id: wrDash.id, name: 'Hacked' })).toMatchObject({ ok: false, code: 'not_found' })
    expect((await mockPortal.content.tree(admin)).find((n) => n.id === wrDash.id)?.name).toBe(wrDash.name)
  })
  it('persists edits per organisation and gives viewers no grant list', async () => {
    const created = await mockPortal.content.apply(admin, { op: 'create', kind: 'folder', parentId: null, name: 'Scratch' })
    expect(created.ok).toBe(true)
    expect((await mockPortal.content.tree(adarsAdmin)).some((n) => n.name === 'Scratch')).toBe(false)
    const d = (await mockPortal.content.tree(admin)).find((n) => n.kind === 'dashboard')!
    expect((await mockPortal.dashboards.get(admin, d.id))!.grants.length).toBeGreaterThan(0)
    expect((await mockPortal.dashboards.get(viewer, d.id))!.grants).toEqual([])
    expect((await mockPortal.dashboards.get(viewer, d.id))!.yourAccess).toBe('view')
  })
})

describe('preview as role is reduce-only', () => {
  it('lowers a director but never raises a lower role', () => {
    const director = org('worldrisk', 'admin', true)
    expect(reduceAccess(director, 'viewer')).toMatchObject({ role: 'viewer', isPlatform: false })
    expect(reduceAccess(director, 'viewer').capabilities).not.toContain('terminal.run')
    expect(reduceAccess(director, 'admin').capabilities).not.toContain('orgs.manage')
    expect(reduceAccess(viewer, 'admin')).toBe(viewer)
    expect(reduceAccess(builder, 'builder')).toBe(builder)
    expect(reduceAccess(builder, 'admin')).toBe(builder)
    expect(reduceAccess(builder, null)).toBe(builder)
    expect(previewOptions(director)).toEqual(['admin', 'builder', 'viewer'])
    expect(previewOptions(builder)).toEqual(['viewer'])
    expect(previewOptions(viewer)).toEqual([])
  })
})

describe('last organisation preference and nav', () => {
  it('only picks among organisations the user can already enter', () => {
    const list = [org('worldrisk', 'admin'), org('adars', 'admin')]
    expect(pickDefaultOrg(list, 'adars')?.org.slug).toBe('adars')
    expect(pickDefaultOrg(list, 'someone-elses')?.org.slug).toBe('worldrisk')
    expect(pickDefaultOrg(list, undefined)?.org.slug).toBe('worldrisk')
    expect(pickDefaultOrg([], 'adars')).toBeUndefined()
  })
  it('treats the viewer route as the Dashboards tab and never carries node ids across organisations', () => {
    expect(activeTabKey('/dashboard/o/worldrisk/d/wr-d3')).toBe('dashboards')
    expect(switchOrgHref('/dashboard/o/worldrisk/d/wr-d3', 'worldrisk', 'adars')).toBe('/dashboard/o/adars/dashboards')
    expect(switchOrgHref('/dashboard/o/worldrisk/settings', 'worldrisk', 'adars')).toBe('/dashboard/o/adars/settings')
  })
})
