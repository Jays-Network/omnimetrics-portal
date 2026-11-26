import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as content from '@/lib/portal/pg/content'
import * as dashboards from '@/lib/portal/pg/dashboards'
import type { OrgCtx } from '@/lib/portal/pg/org'
import { inAppTx, withUser } from '@/lib/portal/pg/tx'
import { getAppDb } from '@/lib/db'
import { connect, startWorld, type World } from './harness'

// pg-only behaviour (the mock has no real grants), and the transaction-local context.

describe('grants', () => {
  let w: World
  let admin: OrgCtx
  let builder: OrgCtx
  let viewer: OrgCtx
  let top: string
  let open: string
  let closed: string
  let board: string

  const make = async (kind: 'folder' | 'dashboard', parentId: string | null, name: string) => {
    const r = await content.apply(admin, { op: 'create', kind, parentId, name })
    if (!r.ok) throw new Error(r.error)
    return r.createdId!
  }
  const ids = async (ctx: OrgCtx) => (await content.tree(ctx)).map((n) => n.id)

  beforeEach(async () => {
    w = await startWorld()
    admin = await w.ctx(w.aAdmin)
    builder = await w.ctx(w.aBuilder)
    viewer = await w.ctx(w.aViewer)
    top = await make('folder', null, `T ${randomUUID().slice(0, 8)}`)
    open = await make('folder', top, 'Open')
    closed = await make('folder', top, 'Closed')
    board = await make('dashboard', open, 'Board')
  })
  afterEach(() => w.close())

  it('default deny: without a grant a builder and a viewer see nothing', async () => {
    expect(await ids(builder)).toEqual([])
    expect(await ids(viewer)).toEqual([])
    expect(await dashboards.get(viewer, board)).toBeNull()
  })

  it('a folder grant covers its descendants and shows the path to it, but not the siblings', async () => {
    await w.grant(w.orgA.id, w.aBuilder.id, open, 'edit')
    expect((await ids(builder)).sort()).toEqual([top, open, board].sort())
    expect((await dashboards.get(builder, board))!.yourAccess).toBe('edit')
    expect((await content.apply(builder, { op: 'create', kind: 'dashboard', parentId: open, name: 'Mine' })).ok).toBe(true)
    expect(await content.apply(builder, { op: 'create', kind: 'dashboard', parentId: top, name: 'No' })).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await content.apply(builder, { op: 'create', kind: 'dashboard', parentId: closed, name: 'No' })).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('a viewer never exceeds view, whatever the grant says', async () => {
    await w.grant(w.orgA.id, w.aViewer.id, open, 'manage')
    expect((await dashboards.get(viewer, board))!.yourAccess).toBe('view')
    expect(await content.apply(viewer, { op: 'rename', id: board, name: 'X' })).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('the nearest grant wins, and a narrower one blocks deleting the folder above it', async () => {
    await w.grant(w.orgA.id, w.aBuilder.id, null, 'edit')
    await w.grant(w.orgA.id, w.aBuilder.id, board, 'view')
    expect((await dashboards.get(builder, board))!.yourAccess).toBe('view')
    await expect(dashboards.versions(builder, board)).rejects.toThrow('forbidden')
    await expect(dashboards.saveVersion(builder, board, { restore: 1 }, 'b')).rejects.toThrow('forbidden')
    await expect(dashboards.grants(builder, board)).rejects.toThrow('forbidden')
    expect(await content.apply(builder, { op: 'delete', id: open })).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('setGrants replaces direct grants only and refuses edits to inherited rows', async () => {
    await w.grant(w.orgA.id, w.aBuilder.id, open, 'edit')
    const shown = (await dashboards.grants(admin, board))!
    expect(shown.map((r) => [r.principal, r.via])).toContainEqual([w.aBuilder.username, 'Folder grant'])
    const mine = { principal: w.aViewer.username, kind: 'user' as const, access: 'view' as const, via: 'Direct grant' }
    expect(await dashboards.setGrants(admin, board, [...shown, mine])).toMatchObject({ ok: true })
    const changed = shown.map((r) => (r.via === 'Folder grant' ? { ...r, access: 'manage' as const } : r))
    expect(await dashboards.setGrants(admin, board, changed)).toMatchObject({ ok: false, code: 'invalid' })
    expect(await dashboards.setGrants(admin, board, [mine, mine])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await dashboards.setGrants(admin, board, [{ ...mine, kind: 'group' }])).toMatchObject({ ok: false, code: 'invalid' })
    expect((await dashboards.get(viewer, board))!.yourAccess).toBe('view')
    expect(await dashboards.setGrants(admin, board, [])).toMatchObject({ ok: true })
    expect(await dashboards.get(viewer, board)).toBeNull()
  })

  it('records who saved, whatever author label is passed', async () => {
    const r = await dashboards.saveVersion(admin, board, { restore: 1 }, 'someone else')
    expect(r.ok && r.versions.at(-1)!.author).toBe(w.aAdmin.username)
  })

  it('a node under a deleted folder is gone', async () => {
    await content.apply(admin, { op: 'delete', id: open })
    expect(await dashboards.get(admin, board)).toBeNull()
    expect(await dashboards.saveVersion(admin, board, { restore: 1 }, 'x')).toMatchObject({ ok: false, code: 'not_found' })
    expect(await content.apply(admin, { op: 'rename', id: board, name: 'X' })).toMatchObject({ ok: false, code: 'not_found' })
  })
})

describe('context is transaction-local', () => {
  // Real transactions on one pooled connection; reads only, nothing is written.
  const g = globalThis as unknown as { __omniSqlApp?: unknown }
  let sql: Awaited<ReturnType<typeof connect>>

  beforeEach(async () => {
    sql = await connect('TEST_DATABASE_URL_APP')
    g.__omniSqlApp = sql
  })
  afterEach(async () => {
    delete g.__omniSqlApp
    await sql.end({ timeout: 5 })
  })

  const settings = async () => {
    const [r] = await getAppDb()<{ org: string; user: string }[]>`
      SELECT coalesce(current_setting('app.org_id', true), '') AS org, coalesce(current_setting('app.user_id', true), '') AS "user"`
    return r
  }

  it('is set inside and gone after commit and after an error', async () => {
    const orgId = randomUUID()
    const userId = randomUUID()
    const inside = await inAppTx(orgId, userId, async (tx) => (await tx`SELECT current_setting('app.org_id') AS org, current_setting('app.user_id') AS "user"`)[0])
    expect(inside).toEqual({ org: orgId, user: userId })
    expect(await settings()).toEqual({ org: '', user: '' })
    await expect(withUser(userId, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(await settings()).toEqual({ org: '', user: '' })
  })
})
