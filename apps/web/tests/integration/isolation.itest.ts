import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContentOp } from '@omnimetrics/types'
import * as content from '@/lib/portal/pg/content'
import * as dashboards from '@/lib/portal/pg/dashboards'
import { NotFound } from '@/lib/portal/pg/errors'
import * as org from '@/lib/portal/pg/org'
import * as orgs from '@/lib/portal/pg/orgs'
import { connect, startWorld, type Person, type World } from './harness'

// The core of stage 2a: with A's ctx, B's ids behave exactly like ids that do not exist.

let w: World
/** Ids in organisation B (and one dashboard in A to aim cross-references from). */
let b: { folder: string; dash: string; deletedBatch: string }
let a: { folder: string; dash: string }
let actors: org.OrgCtx[] // A admin, A builder, A viewer: each with the most access its role can hold

async function seed() {
  const bCtx = await w.ctx(w.bAdmin, w.orgB.slug)
  const aCtx = await w.ctx(w.aAdmin)
  const make = async (ctx: org.OrgCtx, kind: 'folder' | 'dashboard', parentId: string | null, name: string) => {
    const r = await content.apply(ctx, { op: 'create', kind, parentId, name })
    if (!r.ok) throw new Error(r.error)
    return r.createdId!
  }
  const tag = randomUUID().slice(0, 8)
  const bFolder = await make(bCtx, 'folder', null, `B secret ${tag}`)
  const bDash = await make(bCtx, 'dashboard', bFolder, 'B secret board')
  await dashboards.saveVersion(bCtx, bDash, { restore: 1 }, 'b') // v2 exists only in B
  await w.grant(w.orgB.id, w.bAdmin.id, bDash, 'view')
  const gone = await make(bCtx, 'dashboard', bFolder, 'B deleted board')
  const del = await content.apply(bCtx, { op: 'delete', id: gone })
  if (!del.ok) throw new Error(del.error)
  b = { folder: bFolder, dash: bDash, deletedBatch: del.batchId! }

  const aFolder = await make(aCtx, 'folder', null, `A ${tag}`)
  a = { folder: aFolder, dash: await make(aCtx, 'dashboard', aFolder, 'A board') }
  await w.grant(w.orgA.id, w.aBuilder.id, null, 'edit')
  await w.grant(w.orgA.id, w.aViewer.id, null, 'view')
  actors = [aCtx, await w.ctx(w.aBuilder), await w.ctx(w.aViewer)]
}

const snapshot = () =>
  w.asOrg(w.orgB.id, async (tx) => ({
    nodes: await tx`SELECT * FROM app_content_nodes WHERE org_id = ${w.orgB.id} ORDER BY id`,
    versions: await tx`SELECT * FROM app_dashboard_versions WHERE org_id = ${w.orgB.id} ORDER BY id`,
    grants: await tx`SELECT * FROM app_grants WHERE org_id = ${w.orgB.id} ORDER BY id`,
    members: await tx`SELECT * FROM app_memberships WHERE org_id = ${w.orgB.id} ORDER BY id`,
  }))

/** A value or the message it threw, so "same answer" can be compared. */
const outcome = (p: Promise<unknown>) => p.then((value) => ({ value }), (e: Error) => ({ threw: e.message }))

/** B's id must answer exactly like a random id, for every A role. */
async function sameAsMissing(call: (ctx: org.OrgCtx, id: string) => Promise<unknown>, foreign: string, missing = randomUUID() as string) {
  for (const ctx of actors) {
    const got = await outcome(call(ctx, foreign))
    expect(got, ctx.role).toEqual(await outcome(call(ctx, missing)))
    expect(JSON.stringify(got), ctx.role).not.toContain('B secret')
    if ('value' in got) {
      const v = got.value as { ok?: boolean; code?: string } | null
      expect(v === null || (v.ok === false && v.code !== 'conflict'), `${ctx.role}: ${JSON.stringify(v)}`).toBe(true)
    } else expect(got.threw).toBe('forbidden') // capability refusal, identical for any id
  }
}

const noForeign = (value: unknown) => {
  const s = JSON.stringify(value)
  for (const secret of [b.folder, b.dash, w.orgB.id, 'B secret', w.bAdmin.username]) expect(s).not.toContain(secret)
}

const contentOps: ((id: string) => ContentOp)[] = [
  (id) => ({ op: 'rename', id, name: 'Hacked' }),
  (id) => ({ op: 'delete', id }),
  (id) => ({ op: 'move', id, parentId: a.folder }),
  (id) => ({ op: 'move', id: a.dash, parentId: id }),
  (id) => ({ op: 'create', kind: 'dashboard', parentId: id, name: 'Planted' }),
]

/** One entry per exported function of the repository modules. A new export fails until it is covered. */
const matrix: Record<string, () => Promise<void>> = {
  'content.tree': async () => {
    for (const ctx of actors) noForeign(await content.tree(ctx))
  },
  'content.apply': async () => {
    for (const op of contentOps) await sameAsMissing((ctx, id) => content.apply(ctx, op(id)), op === contentOps[3] || op === contentOps[4] ? b.folder : b.dash)
    await sameAsMissing((ctx, id) => content.apply(ctx, { op: 'rename', id, name: 'Hacked' }), b.folder)
    await sameAsMissing((ctx, batchId) => content.apply(ctx, { op: 'restore', batchId }), b.deletedBatch, `${randomUUID()}~1`)
  },
  'dashboards.get': async () => {
    await sameAsMissing((ctx, id) => dashboards.get(ctx, id), b.dash)
    for (const ctx of actors) noForeign(await dashboards.get(ctx, a.dash))
  },
  'dashboards.versions': async () => sameAsMissing((ctx, id) => dashboards.versions(ctx, id), b.dash),
  'dashboards.saveVersion': async () => {
    await sameAsMissing((ctx, id) => dashboards.saveVersion(ctx, id, { restore: 1 }, 'x'), b.dash)
    await sameAsMissing((ctx, id) => dashboards.saveVersion(ctx, id, { spec: { v: 3, panels: [] } }, 'x'), b.dash)
    // version 2 exists only on B's dashboard
    expect(await dashboards.saveVersion(actors[0]!, a.dash, { restore: 2 }, 'x')).toMatchObject({ ok: false, code: 'not_found' })
  },
  'dashboards.grants': async () => {
    await sameAsMissing((ctx, id) => dashboards.grants(ctx, id), b.dash)
    noForeign(await dashboards.grants(actors[0]!, a.dash))
  },
  'dashboards.setGrants': async () => {
    await sameAsMissing((ctx, id) => dashboards.setGrants(ctx, id, []), b.dash)
    // B's user cannot be granted in A, and answers like a name nobody has
    const row = (principal: string) => [{ principal, kind: 'user' as const, access: 'view' as const, via: 'Direct grant' }]
    const foreign = await dashboards.setGrants(actors[0]!, a.dash, row(w.bAdmin.username))
    expect(foreign).toMatchObject({ ok: false, code: 'invalid' })
    expect(foreign).toEqual(await dashboards.setGrants(actors[0]!, a.dash, row('nobody_has_this_name')))
  },
  'orgs.listAccessible': async () => {
    for (const who of [w.aAdmin, w.aBuilder, w.aViewer]) {
      const list = await orgs.listAccessible({ id: who.id, username: who.username, role: 'admin' })
      expect(list.map((x) => x.org.slug)).toEqual([w.orgA.slug])
      noForeign(list)
    }
    for (const who of [w.nobody, w.inactive]) expect(await orgs.listAccessible({ id: who.id, username: who.username, role: 'admin' })).toEqual([])
    const both = await orgs.listAccessible({ id: w.director.id, username: w.director.username, role: 'viewer' })
    expect(both.map((x) => x.org.slug).sort()).toEqual([w.orgB.slug, w.orgA.slug].sort())
    expect(both.every((x) => x.isPlatform)).toBe(true)
  },
  // Takes no ctx: director only, guarded by its callers. It carries counts, never content.
  'orgs.listAll': async () => {
    const all = await orgs.listAll()
    expect(all.map((o) => o.slug)).toEqual(expect.arrayContaining([w.orgA.slug, w.orgB.slug]))
    expect(JSON.stringify(all)).not.toContain('B secret')
  },
  'org.requireOrg': async () => {
    const refused = async (who: Person, slug: string) => expect(org.requireOrg(who, slug)).rejects.toBeInstanceOf(NotFound)
    expect(await org.requireOrg(w.aViewer, w.orgA.slug)).toMatchObject({ role: 'viewer', isPlatform: false, userId: w.aViewer.id })
    await refused(w.aAdmin, w.orgB.slug)
    await refused(w.bAdmin, w.orgA.slug)
    await refused(w.aAdmin, 'no-such-org')
    await refused(w.nobody, w.orgA.slug)
    await refused(w.inactive, w.orgA.slug)
    await refused({ id: randomUUID(), username: 'ghost' }, w.orgA.slug)
    await expect(org.requireOrg(w.aViewer, w.orgA.slug, 'dashboards.edit')).rejects.toBeInstanceOf(NotFound)
    for (const slug of [w.orgA.slug, w.orgB.slug]) expect(await org.requireOrg(w.director, slug)).toMatchObject({ role: 'admin', isPlatform: true })
  },
  'org.assertOrgCtx': async () => {
    const real = actors[0]!
    expect(() => org.assertOrgCtx(real)).not.toThrow()
    const forged = { ...real, org: { ...real.org, id: w.orgB.id } } as org.OrgCtx
    expect(() => org.assertOrgCtx(forged)).toThrow(/requireOrg/)
    await expect(content.tree(forged)).rejects.toThrow(/requireOrg/)
  },
}

const modules = { content, dashboards, org, orgs }

describe('isolation matrix: coverage', () => {
  it('has an entry for every exported repository function', () => {
    const exported = Object.entries(modules).flatMap(([name, m]) => Object.entries(m).filter(([, v]) => typeof v === 'function').map(([fn]) => `${name}.${fn}`))
    expect(Object.keys(matrix).sort()).toEqual(exported.sort())
  })
  it('knows every file of the pg layer', () => {
    // A new repository module must be added to `modules` above; helpers are listed here.
    const helpers = ['access.ts', 'context.ts', 'errors.ts', 'index.ts', 'tx.ts']
    const files = readdirSync(path.resolve(__dirname, '../../lib/portal/pg')).sort()
    expect(files).toEqual([...helpers, ...Object.keys(modules).map((m) => `${m}.ts`)].sort())
  })
})

describe('isolation matrix: organisation A against organisation B', () => {
  beforeEach(async () => {
    w = await startWorld()
    await seed()
  })
  afterEach(() => w.close())

  it.each(Object.keys(matrix))('%s', async (name) => {
    const before = await snapshot()
    await matrix[name]!()
    expect(await snapshot()).toEqual(before)
  })
})

describe('organisation status', () => {
  // Needs a committed change: the platform role suspends, the test restores. Nothing else is committed.
  let platform: Awaited<ReturnType<typeof connect>>
  const status = (value: string) => platform`UPDATE app_orgs SET status = ${value} WHERE slug = 'adars'`
  afterAll(async () => {
    await platform?.end({ timeout: 5 })
  })

  it.each(['suspended', 'archived'])('a %s organisation is NotFound for members and for the director', async (value) => {
    platform ??= await connect('TEST_DATABASE_URL_PLATFORM')
    w = await startWorld()
    try {
      await status(value)
      for (const who of [w.bAdmin, w.director]) {
        await expect(org.requireOrg(who, w.orgB.slug)).rejects.toBeInstanceOf(NotFound)
        const list = await orgs.listAccessible({ id: who.id, username: who.username, role: 'admin' })
        expect(list.map((x) => x.org.slug)).not.toContain(w.orgB.slug)
      }
    } finally {
      await status('active')
      await w.close()
    }
  })
})
