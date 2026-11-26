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

describe('pg portal fails closed outside stage 2a', () => {
  it('throws instead of falling back to the mock', () => {
    const calls: (() => unknown)[] = [
      ...Object.values(pgPortal.organisations), ...Object.values(pgPortal.users), ...Object.values(pgPortal.accounts),
      ...Object.values(pgPortal.account), ...Object.values(pgPortal.settings), ...Object.values(pgPortal.integrations.hosts),
      pgPortal.integrations.list, pgPortal.integrations.save, pgPortal.integrations.remove, pgPortal.integrations.test, pgPortal.integrations.audit,
    ] as never
    for (const call of calls) expect(call).toThrow(/not implemented in stage 2a/)
  })
  it('refuses an access object that requireOrg did not issue, before touching the database', async () => {
    const forged = { org: { id: 'x', slug: 'x', name: 'x', status: 'active' as const }, role: 'admin' as const, isPlatform: true, capabilities: [], userId: 'u' }
    await expect(pgPortal.content.tree(forged)).rejects.toThrow(/not issued by requireOrg/)
    await expect(pgPortal.dashboards.get(forged, 'n')).rejects.toThrow(/not issued by requireOrg/)
  })
})
