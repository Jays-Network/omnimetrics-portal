import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_TREE_DEPTH, type ContentNode, type ContentOp, type ContentResult, type GrantAccess, type GrantRow, type OrgAccess } from '@omnimetrics/types'
import { addPanel, type DashSpec } from '@/lib/builder/model'
import type { Portal } from '@/lib/portal'
import { childrenOf } from '@/lib/portal/tree'

// The behaviour both implementations must share: run against the mock (unit project) and pgPortal (test:db).

export interface ContractWorld {
  portal: Portal
  /** All in organisation A except `other`, an admin of organisation B. */
  director: OrgAccess
  orgAdmin: OrgAccess
  builder: OrgAccess
  viewer: OrgAccess
  other: OrgAccess
  /** A username that may be granted access in organisation A. */
  analyst: string
  /** The mock's role baseline: builder may edit and viewer may view the whole organisation. pg needs real grants for that. */
  grantBaseline(): Promise<void>
}

type Ok = Extract<ContentResult, { ok: true }>

export function portalContract(label: string, setup: () => Promise<ContractWorld>, teardown: () => Promise<void>): void {
  describe(`portal contract (${label})`, () => {
    let w: ContractWorld
    let root: string
    let tag = 0

    const apply = (who: OrgAccess, op: ContentOp) => w.portal.content.apply(who, op)
    const ok = async (who: OrgAccess, op: ContentOp): Promise<Ok> => {
      const r = await apply(who, op)
      if (!r.ok) throw new Error(`${op.op}: ${r.code} ${r.error}`)
      return r
    }
    const make = async (who: OrgAccess, kind: ContentNode['kind'], parentId: string | null, name: string) =>
      (await ok(who, { op: 'create', kind, parentId, name })).createdId!
    const nodes = (who: OrgAccess = w.orgAdmin) => w.portal.content.tree(who)
    const node = async (id: string) => (await nodes()).find((n) => n.id === id)

    beforeEach(async () => {
      w = await setup()
      await w.grantBaseline()
      root = await make(w.orgAdmin, 'folder', null, `Contract ${++tag}`)
    })
    afterEach(teardown)

    it('only admins create or change top-level folders; builders work inside; viewers change nothing', async () => {
      expect(await apply(w.builder, { op: 'create', kind: 'folder', parentId: null, name: 'Top B' })).toMatchObject({ ok: false, code: 'forbidden' })
      const sub = await make(w.builder, 'folder', root, 'Sub')
      await make(w.builder, 'dashboard', sub, 'Board')
      expect(await apply(w.viewer, { op: 'create', kind: 'folder', parentId: sub, name: 'X' })).toMatchObject({ ok: false, code: 'forbidden' })
      expect(await apply(w.viewer, { op: 'rename', id: sub, name: 'X' })).toMatchObject({ ok: false, code: 'forbidden' })
      expect(await apply(w.viewer, { op: 'delete', id: sub })).toMatchObject({ ok: false, code: 'forbidden' })
      expect(await apply(w.builder, { op: 'rename', id: root, name: 'Zed' })).toMatchObject({ ok: false, code: 'forbidden' })
      expect(await apply(w.builder, { op: 'delete', id: root })).toMatchObject({ ok: false, code: 'forbidden' })
      expect((await node(sub))?.name).toBe('Sub')
    })

    it('reports name rules with the same codes', async () => {
      await make(w.orgAdmin, 'folder', root, 'Ops')
      expect(await apply(w.orgAdmin, { op: 'create', kind: 'folder', parentId: root, name: 'OPS' })).toMatchObject({ ok: false, code: 'conflict' })
      for (const name of ['   ', 'a/b', 'x'.repeat(61)]) {
        expect(await apply(w.orgAdmin, { op: 'rename', id: root, name }), name).toMatchObject({ ok: false, code: 'invalid' })
      }
      expect(await apply(w.orgAdmin, { op: 'create', kind: 'dashboard', parentId: null, name: 'Loose' })).toMatchObject({ ok: false, code: 'forbidden' })
      const dash = await make(w.orgAdmin, 'dashboard', root, 'Leaf')
      expect(await apply(w.orgAdmin, { op: 'create', kind: 'folder', parentId: dash, name: 'Inside' })).toMatchObject({ ok: false, code: 'forbidden' })
      expect(await apply(w.orgAdmin, { op: 'rename', id: 'no-such-node', name: 'Q' })).toMatchObject({ ok: false, code: 'not_found' })
    })

    it('enforces maximum depth and refuses cycles', async () => {
      let parent = root
      for (let i = 2; i <= MAX_TREE_DEPTH; i++) parent = await make(w.orgAdmin, 'folder', parent, `L${i}`)
      expect(await apply(w.orgAdmin, { op: 'create', kind: 'folder', parentId: parent, name: 'L9' })).toMatchObject({ ok: false, code: 'forbidden' })
      const two = await make(w.orgAdmin, 'folder', root, 'Two')
      await make(w.orgAdmin, 'folder', two, 'Below')
      const l7 = (await nodes()).find((n) => n.name === 'L7')!.id
      expect(await apply(w.orgAdmin, { op: 'move', id: two, parentId: l7 })).toMatchObject({ ok: false, code: 'invalid' })
      expect(await apply(w.orgAdmin, { op: 'move', id: root, parentId: root })).toMatchObject({ ok: false, code: 'invalid' })
      expect(await apply(w.orgAdmin, { op: 'move', id: root, parentId: l7 })).toMatchObject({ ok: false, code: 'invalid' })
    })

    it('counts soft-deleted descendants against the depth limit of a move', async () => {
      let parent = root
      for (let i = 2; i <= 6; i++) parent = await make(w.orgAdmin, 'folder', parent, `L${i}`)
      const two = await make(w.orgAdmin, 'folder', root, 'Two')
      const below = await make(w.orgAdmin, 'folder', two, 'Below')
      await make(w.orgAdmin, 'folder', below, 'Deeper')
      await ok(w.orgAdmin, { op: 'delete', id: below })
      expect(await apply(w.orgAdmin, { op: 'move', id: two, parentId: parent })).toMatchObject({ ok: false, code: 'invalid' })
    })

    it('moves, reorders and keeps ids; a name clash at the target is a conflict', async () => {
      const a = await make(w.orgAdmin, 'folder', root, 'A')
      const b = await make(w.orgAdmin, 'folder', root, 'B')
      await make(w.orgAdmin, 'dashboard', b, 'First')
      const d = await make(w.orgAdmin, 'dashboard', a, 'Daily')
      const r = await ok(w.orgAdmin, { op: 'move', id: d, parentId: b, index: 0 })
      expect(childrenOf(r.nodes, b).map((n) => n.id)[0]).toBe(d)
      expect(childrenOf(r.nodes, b).map((n) => n.position)).toEqual([0, 1])
      await make(w.orgAdmin, 'dashboard', a, 'Daily')
      expect(await apply(w.orgAdmin, { op: 'move', id: d, parentId: a })).toMatchObject({ ok: false, code: 'conflict' })
    })

    it('soft-deletes a subtree and restores it exactly', async () => {
      const a = await make(w.orgAdmin, 'folder', root, 'A')
      const s = await make(w.orgAdmin, 'folder', a, 'S')
      await make(w.orgAdmin, 'dashboard', s, 'Deep')
      const before = (await nodes()).map((n) => n.id).sort()
      const del = await ok(w.orgAdmin, { op: 'delete', id: a })
      expect(del.deletedCount).toBe(3)
      expect(del.nodes.some((n) => n.id === a || n.id === s || n.name === 'Deep')).toBe(false)
      expect((await apply(w.viewer, { op: 'restore', batchId: del.batchId! })).ok).toBe(false)
      const back = await ok(w.orgAdmin, { op: 'restore', batchId: del.batchId! })
      expect(back.createdId).toBe(a)
      expect(back.nodes.map((n) => n.id).sort()).toEqual(before)
      expect(await apply(w.orgAdmin, { op: 'restore', batchId: del.batchId! })).toMatchObject({ ok: false, code: 'not_found' })
    })

    it('refuses to restore under a deleted folder, and renames on a clash', async () => {
      const a = await make(w.orgAdmin, 'folder', root, 'A')
      const d = await make(w.orgAdmin, 'dashboard', a, 'Fuel')
      const one = await ok(w.orgAdmin, { op: 'delete', id: d })
      const two = await ok(w.orgAdmin, { op: 'delete', id: a })
      expect(await apply(w.orgAdmin, { op: 'restore', batchId: one.batchId! })).toMatchObject({ ok: false, code: 'conflict' })
      const back = await ok(w.orgAdmin, { op: 'restore', batchId: two.batchId! })
      expect(back.nodes.some((n) => n.id === d)).toBe(false) // the earlier delete stays deleted
      await make(w.orgAdmin, 'dashboard', a, 'Fuel')
      const r = await ok(w.orgAdmin, { op: 'restore', batchId: one.batchId! })
      expect(r.nodes.find((n) => n.id === d)?.name).toBe('Fuel (restored)')
    })

    it('keeps organisations apart: foreign ids are absent and nothing changes', async () => {
      const d = await make(w.orgAdmin, 'dashboard', root, 'Mine')
      expect((await nodes(w.other)).some((n) => n.id === d || n.id === root)).toBe(false)
      expect(await w.portal.dashboards.get(w.other, d)).toBeNull()
      expect(await w.portal.dashboards.versions(w.other, d)).toBeNull()
      expect(await w.portal.dashboards.grants(w.other, d)).toBeNull()
      expect(await w.portal.dashboards.saveVersion(w.other, d, { restore: 1 }, 'x')).toMatchObject({ ok: false, code: 'not_found' })
      expect(await apply(w.other, { op: 'rename', id: d, name: 'Hacked' })).toMatchObject({ ok: false, code: 'not_found' })
      expect((await node(d))?.name).toBe('Mine')
    })

    it('gives the viewer path, access and no grant list', async () => {
      const d = await make(w.orgAdmin, 'dashboard', root, 'Board')
      expect((await w.portal.dashboards.get(w.orgAdmin, d))!.path.map((n) => n.id)).toEqual([root, d])
      expect((await w.portal.dashboards.get(w.director, d))!.yourAccess).toBe('manage')
      expect((await w.portal.dashboards.get(w.builder, d))!.yourAccess).toBe('edit')
      expect((await w.portal.dashboards.get(w.orgAdmin, d))!.grants.length).toBeGreaterThan(0)
      expect(await w.portal.dashboards.get(w.viewer, d)).toMatchObject({ yourAccess: 'view', grants: [] })
      expect(await w.portal.dashboards.get(w.orgAdmin, root)).toBeNull() // a folder is not a dashboard
    })

    it('appends versions; restore is a new copy; history is never rewritten', async () => {
      const d = await make(w.orgAdmin, 'dashboard', root, 'Board')
      const before = (await w.portal.dashboards.versions(w.builder, d))!
      expect(before.map((v) => v.n)).toEqual([1])
      const next = addPanel(before[0]!.spec, 'gauge', 'new1')
      const saved = await w.portal.dashboards.saveVersion(w.builder, d, { spec: next, note: 'added a gauge' }, 'tester')
      expect(saved.ok && saved.versions.map((v) => v.n)).toEqual([1, 2])
      const restored = await w.portal.dashboards.saveVersion(w.builder, d, { restore: 1 }, 'tester')
      expect(restored.ok && restored.versions.map((v) => v.n)).toEqual([1, 2, 3])
      if (!restored.ok) return
      expect(restored.versions[2]).toMatchObject({ note: 'Restored from v1' })
      expect(restored.versions[2]!.spec).toEqual(restored.versions[0]!.spec)
      expect(restored.versions[1]!.spec.panels).toHaveLength(before[0]!.spec.panels.length + 1)
      expect(((await w.portal.dashboards.get(w.orgAdmin, d))!.spec as DashSpec).panels).toHaveLength(before[0]!.spec.panels.length)
      expect(await w.portal.dashboards.saveVersion(w.builder, d, { spec: { v: 1, panels: [{ nope: true }] } }, 't')).toMatchObject({ ok: false, code: 'invalid' })
      expect(await w.portal.dashboards.saveVersion(w.builder, d, { restore: 42 }, 't')).toMatchObject({ ok: false, code: 'not_found' })
    })

    it('refuses viewers on history and saving, but lets them view', async () => {
      const d = await make(w.orgAdmin, 'dashboard', root, 'Board')
      await expect(w.portal.dashboards.versions(w.viewer, d)).rejects.toThrow('forbidden')
      await expect(w.portal.dashboards.saveVersion(w.viewer, d, { restore: 1 }, 'v')).rejects.toThrow('forbidden')
      expect(await w.portal.dashboards.get(w.viewer, d)).not.toBeNull()
    })

    it('closes a read-only dashboard to builders, not to admins', async () => {
      const d = await make(w.orgAdmin, 'dashboard', root, 'Board')
      const spec = (await w.portal.dashboards.versions(w.director, d))!.at(-1)!.spec
      const locked = { ...spec, settings: { ...spec.settings, general: { ...spec.settings.general, editable: false } } }
      expect((await w.portal.dashboards.saveVersion(w.orgAdmin, d, { spec: locked, note: 'read-only' }, 'a')).ok).toBe(true)
      expect((await w.portal.dashboards.get(w.builder, d))!.yourAccess).toBe('view')
      expect((await w.portal.dashboards.get(w.orgAdmin, d))!.yourAccess).toBe('manage')
      await expect(w.portal.dashboards.versions(w.builder, d)).rejects.toThrow('forbidden')
      await expect(w.portal.dashboards.saveVersion(w.builder, d, { restore: 1 }, 'b')).rejects.toThrow('forbidden')
      expect(await w.portal.dashboards.versions(w.orgAdmin, d)).not.toBeNull()
      expect((await w.portal.dashboards.saveVersion(w.director, d, { spec, note: 'editable again' }, 'd')).ok).toBe(true)
      expect((await w.portal.dashboards.get(w.builder, d))!.yourAccess).toBe('edit')
    })

    it('lets only admins change grants', async () => {
      const d = await make(w.orgAdmin, 'dashboard', root, 'Board')
      const row: GrantRow = { principal: w.analyst, kind: 'user', access: 'view' as GrantAccess, via: 'Direct grant' }
      expect(await w.portal.dashboards.setGrants(w.builder, d, [row])).toMatchObject({ ok: false, code: 'forbidden' })
      expect(await w.portal.dashboards.setGrants(w.orgAdmin, d, [row])).toMatchObject({ ok: true })
      for (const rows of [await w.portal.dashboards.grants(w.builder, d), (await w.portal.dashboards.get(w.orgAdmin, d))!.grants]) {
        expect(rows).toContainEqual(row)
      }
      expect(await w.portal.dashboards.grants(w.other, d)).toBeNull()
      await expect(w.portal.dashboards.setGrants(w.viewer, d, [row])).rejects.toThrow('forbidden')
    })
  })
}
