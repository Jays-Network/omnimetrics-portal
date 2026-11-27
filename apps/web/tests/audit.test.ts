// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The audit writer and the login-time user load, without a database.

const state = vi.hoisted(() => ({
  appTx: [] as { org: string; user: string }[],
  inserts: [] as unknown[][],
  fail: null as null | { code: string },
  legacy: [] as { text: string; values: unknown[] }[],
  userRow: null as null | Record<string, unknown>,
}))

const fakeTx = Object.assign(
  async (_s: TemplateStringsArray, ...values: unknown[]) => {
    if (state.fail) throw state.fail
    state.inserts.push(values)
    return []
  },
  { json: (v: unknown) => v },
)

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/portal/pg/tx', () => ({
  inAppTx: async (org: string, user: string, fn: (tx: unknown) => Promise<unknown>) => {
    state.appTx.push({ org, user })
    return fn(fakeTx)
  },
}))
vi.mock('@/lib/db', () => ({
  getDb: () =>
    Object.assign(
      async (s: TemplateStringsArray, ...values: unknown[]) => {
        state.legacy.push({ text: s.join('?'), values })
        return state.userRow ? [state.userRow] : []
      },
      { json: (v: unknown) => v },
    ),
}))

import { auditIp, safeDetail, writeAudit } from '@/lib/audit'
import { getCurrentUserById, invalidateUserCache } from '@/lib/auth'

beforeEach(() => {
  Object.assign(state, { appTx: [], inserts: [], fail: null, legacy: [], userRow: null })
  invalidateUserCache()
})

const SECRETS = ['hunter2-hunter2', '$2b$12$abcdefghijklmnopqrstuuJ9Kxq1', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', 'otp-value-1234567890']

describe('audit detail deny-list', () => {
  it('removes passwords, hashes and tokens at any depth', () => {
    const [password, hash, jwt, otp] = SECRETS
    const out = safeDetail({ password, nested: [{ hashed_password: hash, newPassword: password, oneTimePassword: otp, authToken: jwt }], note: hash, cookie: jwt, other: jwt, username: 'kept', reason: 'bad_password' })
    const text = JSON.stringify(out)
    for (const secret of SECRETS) expect(text).not.toContain(secret)
    expect(out).toMatchObject({ username: 'kept', reason: 'bad_password' })
  })
  it('is applied to what is written', async () => {
    await writeAudit({ userId: 'u', action: 'x', detail: { password: SECRETS[0] } })
    expect(JSON.stringify(state.inserts)).not.toContain(SECRETS[0])
  })
})

describe('audit ip', () => {
  it('keeps addresses and turns anything else into NULL', () => {
    expect(auditIp(' 192.0.2.1 ')).toBe('192.0.2.1')
    expect(auditIp('2001:db8::1')).toBe('2001:db8::1')
    for (const bad of [null, undefined, '', 'unknown', '999.1.1.1', '1.2.3.4, 5.6.7.8', 'fe80::1%eth0', "1.2.3.4'; drop"]) expect(auditIp(bad), String(bad)).toBeNull()
  })
})

describe('writeAudit', () => {
  it('writes best-effort as the user concerned, and as nobody for an unknown user', async () => {
    expect(await writeAudit({ userId: 'u1', action: 'login_success' })).toBe(true)
    expect(await writeAudit({ userId: null, action: 'login_failure' })).toBe(true)
    expect(state.appTx).toEqual([{ org: '', user: 'u1' }, { org: '', user: '' }])
    expect(state.inserts[0]!.slice(0, 2)).toEqual([null, 'u1'])
    expect(state.inserts[1]!.slice(0, 2)).toEqual([null, null])
  })
  it('never throws on its own, but does inside a caller transaction', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.fail = { code: '42501' }
    expect(await writeAudit({ userId: 'u1', action: 'login_success' })).toBe(false)
    expect(log).toHaveBeenCalled()
    await expect(writeAudit({ userId: 'u1', action: 'user.add' }, fakeTx as never)).rejects.toEqual({ code: '42501' })
  })
  it('keeps logging before migration 009 (undefined column)', async () => {
    state.fail = { code: '42703' }
    expect(await writeAudit({ userId: 'u1', action: 'login_success', ip: '192.0.2.1', detail: { username: 'j' } })).toBe(true)
    expect(state.legacy).toHaveLength(1)
    expect(state.legacy[0]!.values).toEqual(['u1', 'login_success', { username: 'j', ip: '192.0.2.1' }])
  })
})

describe('loadUser', () => {
  const row = (role: string) => ({ id: 'u1', username: 'j', email: 'j@example.test', role, is_active: true })
  it.each([
    ['admin', null],
    ['builder', []],
    ['viewer', []],
  ])('%s: reads app_users only and gets allowed_projects %o', async (role, allowed) => {
    state.userRow = row(role)
    expect(await getCurrentUserById('u1')).toMatchObject({ role, allowed_projects: allowed })
    expect(state.legacy).toHaveLength(1)
    expect(state.legacy[0]!.text).toContain('FROM app_users')
    expect(state.legacy[0]!.text).not.toContain('app_user_projects')
  })
})
