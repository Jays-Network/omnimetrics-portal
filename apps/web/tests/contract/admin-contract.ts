import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrgAccess } from '@omnimetrics/types'
import { LAST_ADMIN, NAME_UNAVAILABLE, OWN_MEMBERSHIP, OWN_RESET, SHARED_LOGIN, WRONG_CURRENT } from '@/lib/admin/password'
import type { Portal } from '@/lib/portal'
import type { PartialSettings } from '@/lib/settings/model'

// Organisations, members, passwords, settings and audit: the same assertions for the mock and for pgPortal.

export interface Person { id: string; username: string }

export interface AdminWorld {
  portal: Portal
  /** The director acting in organisation A, and in organisation B. */
  director: OrgAccess
  directorB: OrgAccess
  /** Organisation A: exactly ONE active admin (orgAdmin). */
  orgAdmin: OrgAccess
  builder: OrgAccess
  viewer: OrgAccess
  /** Admin of organisation B. */
  other: OrgAccess
  people: { director: Person; orgAdmin: Person; builder: Person; viewer: Person; other: Person }
  /** An existing login with no membership anywhere. */
  linkable: Person
  /** Fixture: makes an existing login a viewer of organisation A. */
  joinA(who: Person): Promise<void>
  /** Makes new names unique in a shared database. */
  tag: string
  /** Audit rows written during this test that the implementation can read back. */
  audit(): Promise<{ action: string; orgId: string | null; userId: string | null; detail: string }[]>
}

export function adminContract(label: string, setup: () => Promise<AdminWorld>, teardown: () => Promise<void>): void {
  describe(`admin contract (${label})`, () => {
    let w: AdminWorld

    beforeEach(async () => {
      w = await setup()
    })
    afterEach(teardown)

    const NOT_FOUND = { ok: false, code: 'not_found' }
    const FORBIDDEN = { ok: false, code: 'forbidden' }
    const newName = () => `ct.${randomUUID().slice(0, 10)}`
    const add = async (ctx: OrgAccess, actor: Person, role: 'admin' | 'builder' | 'viewer' = 'viewer') => {
      const username = newName()
      const r = await w.portal.users.add(ctx, actor, { username, email: `${username}@contract.invalid`, role })
      if (!r.ok) throw new Error(`add: ${r.code} ${r.error}`)
      return r
    }
    const memberIds = async (ctx: OrgAccess) => {
      const r = await w.portal.users.list(ctx)
      if (!r.ok) throw new Error(r.error)
      return r.members.map((m) => m.userId)
    }

    it('builders and viewers get not_found on every member function', async () => {
      const { users, accounts } = w.portal
      for (const [ctx, who] of [[w.builder, w.people.builder], [w.viewer, w.people.viewer]] as const) {
        expect(await users.list(ctx)).toMatchObject(NOT_FOUND)
        expect(await users.add(ctx, who, { username: newName(), email: `${newName()}@contract.invalid`, role: 'viewer' })).toMatchObject(NOT_FOUND)
        expect(await users.link(ctx, who, { username: 'any.login', role: 'viewer' })).toMatchObject(NOT_FOUND)
        expect(await users.update(ctx, who, w.people.orgAdmin.id, { active: false })).toMatchObject(NOT_FOUND)
        expect(await accounts.resetPassword(ctx, who, w.people.orgAdmin.id)).toMatchObject(NOT_FOUND)
      }
    })

    it('lists the members of this organisation only, with role and active flag', async () => {
      const r = await w.portal.users.list(w.orgAdmin)
      if (!r.ok) throw new Error(r.error)
      expect(r.members).toContainEqual(expect.objectContaining({ userId: w.people.builder.id, role: 'builder', active: true }))
      expect(r.members.map((m) => m.userId)).not.toContain(w.people.other.id)
      expect(JSON.stringify(r)).not.toMatch(/password|\$2[aby]\$/i)
    })

    it('adds a new login and returns the one-time password in that response only', async () => {
      const r = await add(w.orgAdmin, w.people.orgAdmin, 'builder')
      expect(r.oneTimePassword.length).toBeGreaterThanOrEqual(16)
      expect(r.member).toMatchObject({ role: 'builder', active: true, isPlatform: false })
      expect(JSON.stringify(r.member)).not.toContain(r.oneTimePassword)
      expect(JSON.stringify(await w.portal.users.list(w.orgAdmin))).not.toContain(r.oneTimePassword)
      expect(JSON.stringify(await w.audit())).not.toContain(r.oneTimePassword)
      expect((await add(w.orgAdmin, w.people.orgAdmin)).oneTimePassword).not.toBe(r.oneTimePassword)
    })

    it('answers every taken username or email with the same generic conflict', async () => {
      const mine = await add(w.orgAdmin, w.people.orgAdmin)
      const theirs = await add(w.other, w.people.other)
      const free = () => `${newName()}@contract.invalid`
      const attempts = [
        { username: mine.member.username, email: free() }, // a member here
        { username: theirs.member.username, email: free() }, // a login of the other organisation
        { username: newName(), email: theirs.member.email.toUpperCase() },
        { username: w.people.director.username, email: free() }, // the director's
      ]
      for (const a of attempts) {
        const r = await w.portal.users.add(w.orgAdmin, w.people.orgAdmin, { ...a, role: 'viewer' })
        // A seeded username may not satisfy the new-login pattern; that answer says nothing about existence either.
        expect(r, a.username).toMatchObject({ ok: false, code: 'invalid' })
        if (!r.ok && /^[a-z0-9._-]{3,40}$/.test(a.username)) expect(r.error).toBe(NAME_UNAVAILABLE)
      }
    })

    it('an admin of A cannot list, update or reset a member of B', async () => {
      const theirs = await add(w.other, w.people.other, 'builder')
      expect(await memberIds(w.orgAdmin)).not.toContain(theirs.member.userId)
      for (const id of [theirs.member.userId, w.people.other.id, randomUUID()]) {
        expect(await w.portal.users.update(w.orgAdmin, w.people.orgAdmin, id, { active: false })).toMatchObject(NOT_FOUND)
        expect(await w.portal.users.update(w.orgAdmin, w.people.orgAdmin, id, { role: 'viewer' })).toMatchObject(NOT_FOUND)
        expect(await w.portal.accounts.resetPassword(w.orgAdmin, w.people.orgAdmin, id)).toMatchObject(NOT_FOUND)
      }
      const after = await w.portal.users.list(w.other)
      expect(after.ok && after.members.find((m) => m.userId === theirs.member.userId)).toMatchObject({ role: 'builder', active: true })
    })

    it('nobody changes, deactivates or resets themselves', async () => {
      const me = w.people.orgAdmin
      for (const patch of [{ role: 'viewer' as const }, { active: false }]) {
        expect(await w.portal.users.update(w.orgAdmin, me, me.id, patch)).toMatchObject({ ok: false, code: 'invalid', error: OWN_MEMBERSHIP })
      }
      expect(await w.portal.accounts.resetPassword(w.orgAdmin, me, me.id)).toMatchObject({ ok: false, code: 'invalid', error: OWN_RESET })
    })

    it('keeps at least one active admin per organisation', async () => {
      const { users } = w.portal
      const d = w.people.director
      const only = w.people.orgAdmin.id
      for (const patch of [{ role: 'builder' as const }, { active: false }]) {
        expect(await users.update(w.director, d, only, patch)).toMatchObject({ ok: false, code: 'invalid', error: LAST_ADMIN })
      }
      const second = (await add(w.orgAdmin, w.people.orgAdmin, 'admin')).member.userId
      expect(await users.update(w.director, d, only, { role: 'builder' })).toMatchObject({ ok: true, member: { role: 'builder' } })
      expect(await users.update(w.director, d, second, { active: false })).toMatchObject({ ok: false, error: LAST_ADMIN })
      // an inactive admin does not count
      expect(await users.update(w.director, d, only, { role: 'admin', active: false })).toMatchObject({ ok: true })
      expect(await users.update(w.director, d, second, { role: 'viewer' })).toMatchObject({ ok: false, error: LAST_ADMIN })
    })

    it('only the director links an existing login', async () => {
      const { users } = w.portal
      const d = w.people.director
      const input = { username: w.linkable.username, role: 'viewer' as const }
      expect(await users.link(w.orgAdmin, w.people.orgAdmin, input)).toMatchObject(FORBIDDEN)
      expect(await users.link(w.directorB, d, { username: 'nobody.has.this', role: 'viewer' })).toMatchObject({ ok: false, code: 'invalid' })
      expect(await users.link(w.directorB, d, input)).toMatchObject({ ok: true })
      expect(await users.link(w.directorB, d, input)).toMatchObject({ ok: false, code: 'invalid' })
      expect((await w.audit()).filter((e) => e.action === 'user.link').map((e) => [e.orgId, e.userId])).toEqual([[w.directorB.org.id, d.id]])
    })

    it('an org admin cannot reset a login shared with another organisation; the director can', async () => {
      const d = w.people.director
      await w.joinA(w.linkable)
      expect(await w.portal.users.link(w.directorB, d, { username: w.linkable.username, role: 'viewer' })).toMatchObject({ ok: true })
      expect(await w.portal.accounts.resetPassword(w.orgAdmin, w.people.orgAdmin, w.linkable.id)).toMatchObject({ ...FORBIDDEN, error: SHARED_LOGIN })
      expect(await w.portal.accounts.resetPassword(w.director, d, w.linkable.id)).toMatchObject({ ok: true })
    })

    it('resets a member of its own organisation with a new password returned once', async () => {
      const m = await add(w.orgAdmin, w.people.orgAdmin)
      const r = await w.portal.accounts.resetPassword(w.orgAdmin, w.people.orgAdmin, m.member.userId)
      if (!r.ok) throw new Error(r.error)
      expect(r.oneTimePassword.length).toBeGreaterThanOrEqual(16)
      expect(r.oneTimePassword).not.toBe(m.oneTimePassword)
      expect(r.message).not.toContain(r.oneTimePassword)
      const person = { id: m.member.userId, username: m.member.username }
      expect(await w.portal.account.changePassword(person, m.oneTimePassword, 'a-brand-new-password')).toMatchObject({ ok: false, error: WRONG_CURRENT })
      expect(await w.portal.account.changePassword(person, r.oneTimePassword, 'a-brand-new-password')).toMatchObject({ ok: true })
    })

    it('changes your own password only with the current one and a valid new one', async () => {
      const m = await add(w.orgAdmin, w.people.orgAdmin)
      const person = { id: m.member.userId, username: m.member.username }
      const change = (current: string, next: string) => w.portal.account.changePassword(person, current, next)
      const otp = m.oneTimePassword
      for (const [current, next] of [['', 'long-enough-password'], [otp, 'short'], [otp, otp], [otp, 'x'.repeat(73)], ['not-the-password', 'long-enough-password']] as const) {
        expect(await change(current, next)).toMatchObject({ ok: false, code: 'invalid' })
      }
      const ok = await change(otp, 'first-chosen-password')
      expect(ok).toMatchObject({ ok: true })
      expect(JSON.stringify(ok)).not.toContain('first-chosen-password')
      expect(await change(otp, 'second-chosen-password')).toMatchObject({ ok: false, error: WRONG_CURRENT })
      expect(JSON.stringify(await w.audit())).not.toMatch(/chosen-password|\$2[aby]\$/)
    })

    it('with SESSION_VERSION on: sign out everywhere, change and reset still work', async () => {
      vi.stubEnv('SESSION_VERSION', '1')
      try {
        const m = await add(w.orgAdmin, w.people.orgAdmin)
        const person = { id: m.member.userId, username: m.member.username }
        const revoked = await w.portal.account.revokeSessions(person)
        expect(revoked).toMatchObject({ ok: true })
        expect(await w.portal.account.changePassword(person, m.oneTimePassword, 'a-brand-new-password')).toMatchObject({ ok: true })
        expect(await w.portal.accounts.resetPassword(w.orgAdmin, w.people.orgAdmin, person.id)).toMatchObject({ ok: true })
        expect(JSON.stringify(revoked)).not.toMatch(/\$2[aby]\$|eyJ/)
      } finally {
        vi.unstubAllEnvs()
      }
    })

    it('manages organisations for the director only; the slug is checked and never changes', async () => {
      const { organisations } = w.portal
      const d = w.people.director
      expect(await organisations.create(w.orgAdmin, w.people.orgAdmin, 'Nope Ltd')).toMatchObject(FORBIDDEN)
      expect(await organisations.update(w.orgAdmin, w.people.orgAdmin, w.orgAdmin.org.id, { status: 'suspended' })).toMatchObject(FORBIDDEN)
      expect(await organisations.list(w.builder)).toMatchObject(FORBIDDEN)
      const own = await organisations.list(w.orgAdmin)
      expect(own.ok && own.orgs.map((o) => o.id)).toEqual([w.orgAdmin.org.id])

      const name = `Contract Co ${w.tag}`
      const slug = `contract-${w.tag}`
      for (const bad of ['Bad Slug', '-lead', 'trail-', 'x'.repeat(41)]) {
        expect(await organisations.create(w.director, d, name, bad), bad).toMatchObject({ ok: false, code: 'invalid' })
      }
      const made = await organisations.create(w.director, d, name, slug)
      if (!made.ok) throw new Error(made.error)
      expect(made.org).toMatchObject({ slug, name, status: 'active' })
      expect(await organisations.create(w.director, d, name.toUpperCase())).toMatchObject({ ok: false, code: 'invalid' })
      expect(await organisations.create(w.director, d, `${name} two`, slug)).toMatchObject({ ok: false, code: 'invalid' })
      const changed = await organisations.update(w.director, d, made.org.id, { name: `${name} renamed`, status: 'archived' })
      expect(changed.ok && changed.org).toMatchObject({ slug, name: `${name} renamed`, status: 'archived' })
      expect(await organisations.update(w.director, d, randomUUID(), { status: 'active' })).toMatchObject(NOT_FOUND)
      const all = await organisations.list(w.director)
      expect(all.ok && all.orgs.map((o) => o.id)).toContain(made.org.id)
      expect((await w.audit()).filter((e) => e.orgId === made.org.id).map((e) => [e.action, e.userId])).toEqual(
        expect.arrayContaining([['org.create', d.id], ['org.update', d.id]]),
      )
    })

    it('settings: system for the director, organisation for its admins, user values only your own', async () => {
      const { settings } = w.portal
      const view = async (ctx: OrgAccess, who: Person) => {
        const r = await settings.get(ctx, who)
        if (!r.ok) throw new Error(r.error)
        return r.view
      }
      expect(await settings.set(w.viewer, w.people.viewer, 'org', { timeFormat: '12' })).toMatchObject(FORBIDDEN)
      expect(await settings.set(w.viewer, w.people.viewer, 'system', { timeFormat: '12' })).toMatchObject(FORBIDDEN)
      expect(await settings.set(w.orgAdmin, w.people.orgAdmin, 'system', { timeFormat: '12' })).toMatchObject(FORBIDDEN)
      expect(await settings.set(w.director, w.people.director, 'system', { region: 'gb' })).toMatchObject({ ok: true })
      for (const bad of [{ nope: 'x' }, { timeFormat: '13' }]) {
        expect(await settings.set(w.orgAdmin, w.people.orgAdmin, 'org', bad as unknown as PartialSettings)).toMatchObject({ ok: false, code: 'invalid' })
      }
      expect(await settings.set(w.viewer, w.people.viewer, 'user', {}, ['nope' as never])).toMatchObject({ ok: false, code: 'invalid' })

      expect(await settings.set(w.orgAdmin, w.people.orgAdmin, 'org', { dateFormat: 'DMY' })).toMatchObject({ ok: true })
      expect(await settings.set(w.viewer, w.people.viewer, 'user', { dateFormat: 'long' })).toMatchObject({ ok: true })
      expect((await view(w.viewer, w.people.viewer)).effective).toMatchObject({ value: { dateFormat: 'long' }, source: { dateFormat: 'user' } })
      expect((await view(w.builder, w.people.builder)).user).toEqual({})
      expect((await view(w.builder, w.people.builder)).effective.source.dateFormat).toBe('org')
      expect((await view(w.other, w.people.other)).org).toEqual({})
      expect(await settings.set(w.viewer, w.people.viewer, 'user', {}, ['dateFormat'])).toMatchObject({ ok: true })
      expect((await view(w.viewer, w.people.viewer)).effective.value.dateFormat).toBe('DMY')
    })

    it('audits admin changes with the organisation and the actor, and no secrets', async () => {
      const me = w.people.orgAdmin
      const orgId = w.orgAdmin.org.id
      const m = await add(w.orgAdmin, me)
      await w.portal.users.update(w.orgAdmin, me, m.member.userId, { role: 'builder' })
      const r = await w.portal.accounts.resetPassword(w.orgAdmin, me, m.member.userId)
      await w.portal.settings.set(w.orgAdmin, me, 'org', { timeFormat: '12' })
      const rows = (await w.audit()).filter((e) => e.userId === me.id)
      expect(rows.map((e) => [e.action, e.orgId])).toEqual(
        expect.arrayContaining([['user.add', orgId], ['user.update', orgId], ['user.password_reset', orgId], ['settings.org', orgId]]),
      )
      const text = JSON.stringify(rows)
      expect(text).not.toContain(m.oneTimePassword)
      if (r.ok) expect(text).not.toContain(r.oneTimePassword)
      expect(text).not.toMatch(/\$2[aby]\$|eyJ/)
    })

    it('writes no audit row for a refused change', async () => {
      const before = (await w.audit()).length
      await w.portal.users.update(w.director, w.people.director, w.people.orgAdmin.id, { active: false })
      await w.portal.users.update(w.orgAdmin, w.people.orgAdmin, w.people.other.id, { active: false })
      expect((await w.audit()).length).toBe(before)
    })
  })
}
