// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db, resetMockAdmin } from '@/lib/portal/mock/admin-store'
import { attemptKey, MAX_FAILED_ATTEMPTS, rateLimitKey, retryAfterSeconds, TOO_MANY_ATTEMPTS, WINDOW_MS, withAttemptLimit } from '@/lib/rate-limit'

// Attempt limits for password change and reset: the limiter itself (injected clock), then the routes (mock portal).

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => ({ id: 'real-1', username: 'jay', email: 'j@mock.invalid', role: 'admin' }) }))

beforeEach(() => {
  ;(globalThis as { __omniLoginFailures?: Map<string, number[]> }).__omniLoginFailures?.clear()
  resetMockAdmin()
})

describe('withAttemptLimit', () => {
  let t = 0
  const now = () => t
  const run = (key: string, verdict: 'success' | 'failure' | 'neutral') => {
    const attempt = vi.fn(async () => verdict)
    return withAttemptLimit(key, attempt, (r) => r, now).then((r) => ({ ...r, ran: attempt.mock.calls.length }))
  }
  beforeEach(() => { t = 1_000_000 })

  it('locks after five failures without running the attempt, and opens again when the window passes', async () => {
    const key = attemptKey('password.change', 'u1', '192.0.2.1')
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) expect(await run(key, 'failure')).toMatchObject({ limited: false, ran: 1 })
    expect(await run(key, 'success')).toEqual({ limited: true, retryAfter: WINDOW_MS / 1000, ran: 0 })
    t += WINDOW_MS - 1_000
    expect(await run(key, 'success')).toEqual({ limited: true, retryAfter: 1, ran: 0 })
    t += 1_000
    expect(await run(key, 'success')).toMatchObject({ limited: false, ran: 1 })
  })

  it('counts only failures; success clears', async () => {
    const key = attemptKey('password.change', 'u2', '192.0.2.1')
    for (let i = 0; i < 20; i++) await run(key, 'neutral')
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) await run(key, 'failure')
    await run(key, 'success')
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) await run(key, 'failure')
    expect(await run(key, 'neutral')).toMatchObject({ limited: false })
  })

  it('is keyed by operation, user and address, apart from login keys', async () => {
    const key = attemptKey('password.change', 'u3', '192.0.2.1')
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await run(key, 'failure')
    for (const other of [attemptKey('password.change', 'u3', '192.0.2.2'), attemptKey('password.change', 'u4', '192.0.2.1'), attemptKey('password.reset', 'u3', '192.0.2.1'), rateLimitKey('password.change', 'u3|192.0.2.1')]) {
      expect(retryAfterSeconds(other, t), JSON.stringify(other)).toBe(0)
    }
  })

  it('a thrown error counts nothing', async () => {
    const key = attemptKey('password.change', 'u5', '192.0.2.1')
    for (let i = 0; i < 10; i++) await expect(withAttemptLimit(key, async () => { throw new Error('db down') }, () => 'failure', now)).rejects.toThrow('db down')
    expect(retryAfterSeconds(key, t)).toBe(0)
  })
})

const req = (body?: unknown, ip = '192.0.2.10') =>
  new NextRequest('http://localhost/x', body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify(body) })
const P = { params: Promise.resolve({ orgSlug: 'worldrisk' }) }

describe('account route: change password', () => {
  const KNOWN = 'the-current-password'
  const change = async (current: string, next = 'a-long-new-password', ip?: string) => {
    const { POST } = await import('@/app/api/portal/account/route')
    return POST(req({ op: 'password', current, next }, ip))
  }

  it('five wrong current passwords lock that user and address: 429, Retry-After, generic message', async () => {
    db().passwords.set('real-1', KNOWN)
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) expect((await change('wrong')).status).toBe(400)
    const locked = await change(KNOWN)
    expect(locked.status).toBe(429)
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await locked.json()).toMatchObject({ error: TOO_MANY_ATTEMPTS })
    expect((await change(KNOWN, undefined, '192.0.2.11')).status).toBe(200)
  })

  it('a refused new password is not a failed attempt; success clears', async () => {
    db().passwords.set('real-1', KNOWN)
    for (let i = 0; i < 10; i++) expect((await change(KNOWN, 'short')).status).toBe(400)
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) await change('wrong')
    expect((await change(KNOWN)).status).toBe(200)
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) expect((await change('wrong')).status).toBe(400)
  })
})

describe('admin routes: reset and add', () => {
  it('five refused resets lock the person resetting, whatever the target', async () => {
    const { POST } = await import('@/app/api/portal/o/[orgSlug]/admin/accounts/route')
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) expect((await POST(req({ op: 'reset', userId: `u-none-${i}` }), P)).status).toBe(404)
    const locked = await POST(req({ op: 'reset', userId: 'u-sam' }), P)
    expect(locked.status).toBe(429)
    expect(locked.headers.get('retry-after')).toBeTruthy()
    expect(await locked.json()).toMatchObject({ error: TOO_MANY_ATTEMPTS })
  })

  it('the one-time password is in the add and reset responses and never in the list', async () => {
    const users = await import('@/app/api/portal/o/[orgSlug]/admin/users/route')
    const accounts = await import('@/app/api/portal/o/[orgSlug]/admin/accounts/route')
    const added = await users.POST(req({ op: 'add', username: 'list.check', email: 'list.check@example.test', role: 'viewer' }), P)
    const first = (await added.json()) as { member: { userId: string }; oneTimePassword: string }
    expect(first.oneTimePassword.length).toBeGreaterThanOrEqual(16)
    const reset = await accounts.POST(req({ op: 'reset', userId: first.member.userId }), P)
    const second = (await reset.json()) as { oneTimePassword: string }
    expect(second.oneTimePassword.length).toBeGreaterThanOrEqual(16)
    expect(reset.headers.get('cache-control')).toBe('no-store')
    const list = await (await users.GET(req(), P)).text()
    expect(list).toContain('list.check')
    for (const secret of [first.oneTimePassword, second.oneTimePassword]) expect(list).not.toContain(secret)
  })
})
