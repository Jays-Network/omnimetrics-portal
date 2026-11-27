// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A database error carries the statement's parameters (ciphertext, nonce): save() must pass none of it on.

const state = vi.hoisted(() => ({ error: null as null | Error }))
vi.mock('@/lib/portal/pg/org', () => ({ assertOrgCtx: () => {} }))
vi.mock('@/lib/portal/pg/context', () => ({ withOrg: async () => { throw state.error }, withPlatform: async () => {} }))

import { save } from '@/lib/portal/pg/integrations'
import type { OrgCtx } from '@/lib/portal/pg/org'

const ctx = { org: { id: 'o' }, userId: 'u', capabilities: ['integrations.manage'] } as unknown as OrgCtx
const input = { name: 'n', kind: 'postgres' as const, host: 'h', port: 1, database: 'd', relations: [], sslMode: 'require' as const, username: 'u', credentials: 'SENTINEL-pw' }
const driverError = (code: string) => Object.assign(new Error('Failing row contains SENTINEL-row'), { code, parameters: ['SENTINEL-param'], query: 'INSERT SENTINEL-query', detail: 'SENTINEL-detail' })
afterEach(() => vi.unstubAllEnvs())

describe('save() and database errors', () => {
  it('throws a new error with the SQLSTATE only', async () => {
    vi.stubEnv('INTEGRATION_KEYS', `k:${randomBytes(32).toString('base64')}`)
    state.error = driverError('23514')
    const thrown = await save(ctx, { id: 'u', username: 'u' }, input).catch((e: Error) => e)
    expect((thrown as Error).message).toBe('integrations: save failed (23514)')
    expect(JSON.stringify(thrown, Object.getOwnPropertyNames(thrown))).not.toContain('SENTINEL')
    state.error = driverError('SENTINEL-code')
    await expect(save(ctx, { id: 'u', username: 'u' }, input)).rejects.toThrow('integrations: save failed (unexpected)')
  })
  it('a unique violation is the name refusal', async () => {
    vi.stubEnv('INTEGRATION_KEYS', `k:${randomBytes(32).toString('base64')}`)
    state.error = driverError('23505')
    expect(await save(ctx, { id: 'u', username: 'u' }, input)).toMatchObject({ ok: false, code: 'invalid', error: 'Another integration already uses that name.' })
  })
})
