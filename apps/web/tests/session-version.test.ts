// @vitest-environment node
import bcrypt from 'bcryptjs'
import { decodeJwt, SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// SESSION_VERSION on and off, through the real login route, requireAuth, account route and pg repositories.
// Only the database is faked: one app_users row, and every SQL text is recorded.

const ID = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ADMIN = '33333333-3333-4333-8333-333333333333'
const PASSWORD = 'the-first-password'

const state = vi.hoisted(() => ({
  row: { hash: '', version: 0 },
  sql: [] as string[],
  audit: [] as unknown[][],
  cookie: undefined as string | undefined,
  gate: null as null | Promise<void>,
}))

vi.mock('@/lib/db', () => {
  const fake = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim()
      state.sql.push(text)
      const user = () => ({ id: ID, username: 'pat', email: 'pat@example.test', role: 'viewer', is_active: true, hashed_password: state.row.hash, ...(text.includes('token_version') ? { token_version: state.row.version } : {}) })
      if (text.startsWith('INSERT INTO app_audit_log')) { state.audit.push(values); return [] }
      if (text.startsWith('SELECT set_config')) return []
      if (text.startsWith('SELECT u.is_platform_admin')) return [{ is_platform_admin: false }]
      if (text.startsWith('SELECT hashed_password AS hash')) return [{ hash: state.row.hash }]
      if (text.startsWith('SELECT id, username, email')) {
        const read = user() // read now, answer later
        const gate = state.gate
        state.gate = null
        await gate
        return [read]
      }
      if (text.startsWith('UPDATE app_users')) {
        if (text.includes('hashed_password = ?')) state.row.hash = values[0] as string
        if (text.includes('token_version = token_version + 1')) state.row.version += 1
        return [{ id: ID, ...(text.includes('AS version') ? { version: state.row.version } : {}) }]
      }
      throw new Error(`unexpected SQL: ${text}`)
    },
    { json: (v: unknown) => v },
  )
  const client = { begin: async (fn: (tx: unknown) => unknown) => fn(fake) }
  return { getDb: () => fake, getAppDb: () => client, getPlatformDb: () => client }
})
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined) }) }))
vi.mock('@/lib/portal/pg/org', async (original) => ({ ...(await original<object>()), assertOrgCtx: () => {} }))
vi.mock('@/lib/portal/org', () => ({ resolveAccess: async () => ({ portal: (await import('@/lib/portal/pg')).pgPortal }), resolveOrg: async () => null }))

import { AuthError, getCurrentUserById, invalidateUserCache, requireAuth } from '@/lib/auth'
import { signToken, verifyToken } from '@/lib/jwt'
import * as account from '@/lib/portal/pg/account'
import type { OrgCtx } from '@/lib/portal/pg/org'

const SECRET = 'unit-test-secret-of-at-least-32-characters'
const FIRST_HASH = await bcrypt.hash(PASSWORD, 4)
const COOKIE = 'omnimetrics_token'
const actor = { id: ID, username: 'pat', ip: '192.0.2.1' }
const orgCtx = { org: { id: ORG }, userId: ADMIN, capabilities: ['admin.view', 'orgs.manage'] } as unknown as OrgCtx

const request = (token?: string, body?: unknown) =>
  new NextRequest('http://localhost/x', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { cookie: `${COOKIE}=${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function login(): Promise<string> {
  const { POST } = await import('@/app/api/auth/login/route')
  const res = await POST(request(undefined, { username: 'pat', password: PASSWORD }))
  expect(res.status).toBe(200)
  expect(JSON.stringify(await res.json())).not.toMatch(/token_?version|"tv"/i)
  return res.cookies.get(COOKIE)!.value
}
async function accountPost(token: string, body: object) {
  state.cookie = token
  const { POST } = await import('@/app/api/portal/account/route')
  const res = await POST(request(token, body))
  return { status: res.status, body: (await res.json()) as object, token: res.cookies.get(COOKIE)?.value }
}
const change = (token: string) => accountPost(token, { op: 'password', current: PASSWORD, next: 'a-long-new-password' })
const signedIn = async (token: string) => requireAuth(request(token)).then(() => true, (e: unknown) => {
  expect(e).toBeInstanceOf(AuthError)
  expect(e).toMatchObject({ status: 401, message: 'Unauthorized' }) // the same answer as an expired token
  return false
})
const actions = () => state.audit.map((v) => v[2])

beforeEach(() => {
  vi.stubEnv('JWT_SECRET', SECRET)
  Object.assign(state, { row: { hash: FIRST_HASH, version: 0 }, sql: [], audit: [], cookie: undefined, gate: null })
  invalidateUserCache()
})
afterEach(() => vi.unstubAllEnvs())

describe.each([undefined, '', '0', 'true'])('SESSION_VERSION=%j is off', (value) => {
  beforeEach(() => vi.stubEnv('SESSION_VERSION', value))

  it('tokens have today\'s shape, no SQL names token_version, nothing is compared or re-issued', async () => {
    const token = await login()
    expect(Object.keys(decodeJwt(token)).sort()).toEqual(['exp', 'iat', 'sub'])
    expect(Object.keys(decodeJwt(await signToken({ sub: ID, tv: 7 }))).sort()).toEqual(['exp', 'iat', 'sub'])
    expect(await verifyToken(token)).not.toHaveProperty('tv')

    const changed = await change(token)
    expect(changed).toEqual({ status: 200, body: { ok: true, message: 'Password changed.' }, token: undefined })
    expect(await account.resetPassword(orgCtx, { id: ADMIN, username: 'boss' }, ID)).toMatchObject({ ok: true })
    expect(await account.revokeSessions(actor)).toMatchObject({ ok: false, code: 'invalid' })
    expect(await signedIn(token)).toBe(true)
    expect(state.sql.length).toBeGreaterThan(5)
    expect(state.sql.join('\n')).not.toContain('token_version')
    expect(actions()).not.toContain('user.sessions_revoke')
  })
})

describe('SESSION_VERSION=1', () => {
  beforeEach(() => vi.stubEnv('SESSION_VERSION', '1'))

  it('login signs the current version', async () => {
    state.row.version = 4
    expect(decodeJwt(await login())).toMatchObject({ sub: ID, tv: 4 })
  })

  it('change: this session continues with the same expiry, every other one ends at once', async () => {
    const mine = await signToken({ sub: ID, tv: 0 }, Math.floor(Date.now() / 1000) + 600)
    const other = await login()
    expect(await signedIn(other)).toBe(true) // cached now
    const changed = await change(mine)
    expect(changed.body).toEqual({ ok: true, message: 'Password changed.' })
    expect(decodeJwt(changed.token!)).toMatchObject({ tv: 1, exp: decodeJwt(mine).exp })
    expect(await signedIn(changed.token!)).toBe(true)
    expect(await signedIn(other)).toBe(false)
    expect(await signedIn(mine)).toBe(false)
    expect(actions()).toContain('user.password_change')
  })

  it('a refused change bumps nothing', async () => {
    const token = await login()
    const refused = await accountPost(token, { op: 'password', current: 'not-it', next: 'a-long-new-password' })
    expect(refused).toMatchObject({ status: 400, token: undefined })
    expect(state.row.version).toBe(0)
    expect(await signedIn(token)).toBe(true)
  })

  it('reset: every session of that person ends, and the version is not returned', async () => {
    const token = await login()
    expect(await signedIn(token)).toBe(true)
    const r = await account.resetPassword(orgCtx, { id: ADMIN, username: 'boss' }, ID)
    expect(r).toMatchObject({ ok: true })
    expect(r).not.toHaveProperty('tokenVersion')
    expect(await signedIn(token)).toBe(false)
    expect(actions()).toContain('user.password_reset')
  })

  it('sign out everywhere: this session continues, the others end, audited without secrets', async () => {
    const mine = await login()
    const other = await login()
    state.audit = []
    const revoked = await accountPost(mine, { op: 'revoke_all' })
    expect(revoked.body).toEqual({ ok: true, message: 'Signed out everywhere else.' })
    expect(await signedIn(revoked.token!)).toBe(true)
    expect(await signedIn(other)).toBe(false)
    expect(await signedIn(mine)).toBe(false)
    expect(actions()).toEqual(['user.sessions_revoke'])
    expect(JSON.stringify(state.audit)).not.toMatch(/\$2[aby]\$|eyJ/)
    // an ended session cannot start another revoke
    expect(await accountPost(other, { op: 'revoke_all' })).toMatchObject({ status: 401, token: undefined })
  })

  it('a token without tv works only while the version is 0', async () => {
    const old = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(ID).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))
    expect(await signedIn(old)).toBe(true)
    await account.revokeSessions(actor)
    expect(await signedIn(old)).toBe(false)
  })

  it('a tv that is not a whole number is no token at all', async () => {
    for (const tv of ['0', -1, 1.5, null]) {
      const bad = await new SignJWT({ tv }).setProtectedHeader({ alg: 'HS256' }).setSubject(ID).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))
      if (tv === null) expect(await verifyToken(bad)).toMatchObject({ tv: 0 })
      else expect(await verifyToken(bad), String(tv)).toBeNull()
    }
  })

  it('a user load that was in flight during a bump is not cached', async () => {
    const token = await login()
    invalidateUserCache()
    let release!: () => void
    state.gate = new Promise<void>((r) => (release = r))
    const slow = getCurrentUserById(ID) // reads version 0, then waits
    await Promise.resolve()
    await account.revokeSessions(actor)
    release()
    await slow
    expect(await signedIn(token)).toBe(false)
  })
})
