import { describe, expect, it } from 'vitest'
import type { ContentOp } from '@omnimetrics/types'
import { pgPortal } from '@/lib/portal/pg'
import { contentErrorFrom } from '@/lib/portal/pg/errors'

const create: ContentOp = { op: 'create', kind: 'folder', parentId: 'p', name: 'n' }
const move: ContentOp = { op: 'move', id: 'a', parentId: 'b' }
const db = (code: string, message: string) => ({ code, message })

describe('database refusals map to the mock ContentResult codes', () => {
  it.each([
    [db('23505', 'duplicate key value violates unique constraint "app_content_nodes_sibling_name_uq"'), create, 'conflict'],
    [db('23514', 'app_content_nodes: maximum nesting depth (8) exceeded'), create, 'forbidden'],
    [db('23514', 'app_content_nodes: maximum nesting depth (8) exceeded'), move, 'invalid'],
    [db('23514', 'app_content_nodes: a node cannot be moved under itself'), move, 'invalid'],
    [db('23514', 'app_content_nodes: parent must be a folder'), create, 'forbidden'],
    [db('23514', 'app_content_nodes: parent must be a folder'), move, 'invalid'],
    [db('23514', 'app_content_nodes: parent is deleted'), create, 'not_found'],
    [db('23503', 'app_content_nodes: parent not found in this organisation'), create, 'not_found'],
  ] as const)('%o on %o -> %s', (error, op, code) => {
    expect(contentErrorFrom(error, op)).toMatchObject({ ok: false, code })
  })
  it('does not swallow anything else', () => {
    expect(contentErrorFrom(db('57014', 'canceling statement due to statement timeout'), create)).toBeNull()
    expect(contentErrorFrom(db('42501', 'new row violates row-level security policy'), create)).toBeNull()
    expect(contentErrorFrom(new Error('boom'), create)).toBeNull()
  })
})

describe('pg portal fails closed where nothing is built yet', () => {
  it('throws instead of falling back to the mock', () => {
    const calls: (() => unknown)[] = [
      pgPortal.users.memberships, pgPortal.accounts.sessions, pgPortal.accounts.revoke, pgPortal.account.sessions, pgPortal.account.revoke,
      ...Object.values(pgPortal.integrations.hosts),
      pgPortal.integrations.list, pgPortal.integrations.save, pgPortal.integrations.remove, pgPortal.integrations.test, pgPortal.integrations.audit,
    ] as never
    for (const call of calls) expect(call).toThrow(/not implemented/)
  })
  it('refuses an access object that requireOrg did not issue, before touching the database', async () => {
    const forged = { org: { id: 'x', slug: 'x', name: 'x', status: 'active' as const }, role: 'admin' as const, isPlatform: true, capabilities: [], userId: 'u' }
    await expect(pgPortal.content.tree(forged)).rejects.toThrow(/not issued by requireOrg/)
    await expect(pgPortal.dashboards.get(forged, 'n')).rejects.toThrow(/not issued by requireOrg/)
    const actor = { id: 'u', username: 'u' }
    for (const call of [
      pgPortal.organisations.list(forged), pgPortal.organisations.create(forged, actor, 'n'), pgPortal.organisations.update(forged, actor, 'i', {}),
      pgPortal.users.list(forged), pgPortal.users.add(forged, actor, { username: 'abc', email: 'a@b.test', role: 'viewer' }),
      pgPortal.users.link(forged, actor, { username: 'abc', role: 'viewer' }), pgPortal.users.update(forged, actor, 'i', {}),
      pgPortal.accounts.resetPassword(forged, actor, 'i'), pgPortal.settings.get(forged, actor), pgPortal.settings.set(forged, actor, 'user', {}),
    ]) await expect(call).rejects.toThrow(/not issued by requireOrg/)
  })
})
