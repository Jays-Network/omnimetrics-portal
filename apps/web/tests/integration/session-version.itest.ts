import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateUserCache, requireAuth } from '@/lib/auth'
import { signToken } from '@/lib/jwt'
import * as account from '@/lib/portal/pg/account'
import * as users from '@/lib/portal/pg/users'
import { startWorld, type Person, type World } from './harness'

// SESSION_VERSION=1 against the real column and grants (migration 012 in portal_test).

describe('session version on pg', () => {
  let w: World
  let person: Person
  let otp: string

  const version = async () => {
    const [row] = await w.asOrg(w.orgA.id, (tx) => tx<{ v: number }[]>`SELECT token_version AS v FROM app_users WHERE id = ${person.id}`)
    return row!.v
  }
  const signedIn = (token: string) =>
    requireAuth({ cookies: { get: () => ({ value: token }) } } as unknown as NextRequest).then(() => true, () => false)
  const token = (tv: number) => signToken({ sub: person.id, tv })

  beforeEach(async () => {
    vi.stubEnv('JWT_SECRET', 'integration-test-secret-of-32-characters!')
    vi.stubEnv('SESSION_VERSION', '1')
    invalidateUserCache()
    w = await startWorld()
    const username = `sv.${randomUUID().slice(0, 8)}`
    const added = await users.add(await w.ctx(w.aAdmin), { id: w.aAdmin.id, username: w.aAdmin.username }, { username, email: `${username}@example.test`, role: 'viewer' })
    if (!added.ok) throw new Error(added.error)
    person = { id: added.member.userId, username }
    otp = added.oneTimePassword
  })
  afterEach(async () => {
    await w.close()
    vi.unstubAllEnvs()
  })

  it('a new login is at version 0; change, reset and revoke each bump it and end the older tokens', async () => {
    expect(await version()).toBe(0)
    const first = await token(0)
    expect(await signedIn(first)).toBe(true)

    expect(await account.changePassword(person, otp, 'a-brand-new-password')).toMatchObject({ ok: true, tokenVersion: 1 })
    expect(await version()).toBe(1)
    expect(await signedIn(first)).toBe(false)
    expect(await signedIn(await token(1))).toBe(true)

    const admin = await w.ctx(w.aAdmin)
    expect(await account.resetPassword(admin, { id: w.aAdmin.id, username: w.aAdmin.username }, person.id)).toMatchObject({ ok: true })
    expect(await version()).toBe(2)
    expect(await signedIn(await token(1))).toBe(false)

    expect(await signedIn(await token(2))).toBe(true)
    expect(await account.revokeSessions(person)).toMatchObject({ ok: true, tokenVersion: 3 })
    expect(await signedIn(await token(2))).toBe(false)
    expect(await signedIn(await token(3))).toBe(true)
  })

  it('a refused change bumps nothing', async () => {
    expect(await account.changePassword(person, 'not-the-password', 'a-brand-new-password')).toMatchObject({ ok: false })
    expect(await version()).toBe(0)
  })
})
