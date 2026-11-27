import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeAudit } from '@/lib/audit'
import * as organisations from '@/lib/portal/pg/organisations'
import { NotFound } from '@/lib/portal/pg/errors'
import * as settings from '@/lib/portal/pg/settings'
import * as users from '@/lib/portal/pg/users'
import { startWorld, type World } from './harness'

// pg-only facts the mock cannot show: what is really stored, and what 010 admits.

describe('pg admin writes', () => {
  let w: World
  beforeEach(async () => {
    w = await startWorld()
  })
  afterEach(() => w.close())

  it('a new login is a bcrypt hash, legacy role viewer, never a platform admin; deactivation applies at once', async () => {
    const admin = await w.ctx(w.aAdmin)
    const me = { id: w.aAdmin.id, username: w.aAdmin.username }
    const username = `real.${randomUUID().slice(0, 8)}`
    const r = await users.add(admin, me, { username, email: `${username}@example.test`, role: 'admin' })
    if (!r.ok) throw new Error(r.error)
    const [row] = await w.asOrg(w.orgA.id, (tx) => tx<{ hash: string; role: string; platform: boolean }[]>`
      SELECT hashed_password AS hash, role, is_platform_admin AS platform FROM app_users WHERE id = ${r.member.userId}`)
    expect(row).toMatchObject({ role: 'viewer', platform: false })
    expect(await bcrypt.compare(r.oneTimePassword, row!.hash)).toBe(true)

    const person = { id: r.member.userId, username }
    expect(await w.ctx(person)).toMatchObject({ role: 'admin' })
    expect(await users.update(admin, me, person.id, { active: false })).toMatchObject({ ok: true })
    await expect(w.ctx(person)).rejects.toBeInstanceOf(NotFound)
  })

  it('platform writes carry the director as user_id', async () => {
    const director = await w.ctx(w.director)
    const boss = { id: w.director.id, username: w.director.username, ip: '192.0.2.7' }
    expect(await settings.set(director, boss, 'system', { region: 'de' })).toMatchObject({ ok: true })
    const made = await organisations.create(director, boss, `Itest ${randomUUID().slice(0, 8)}`)
    expect(made.ok).toBe(true)
    const rows = await w.asPlatform((tx) => tx<{ action: string; org: string | null; user: string; ip: string | null }[]>`
      SELECT action, org_id AS org, user_id AS "user", host(ip) AS ip FROM app_audit_log WHERE action IN ('settings.system', 'org.create') ORDER BY id`)
    expect(rows).toEqual([
      { action: 'settings.system', org: null, user: w.director.id, ip: '192.0.2.7' },
      { action: 'org.create', org: made.ok ? made.org.id : '', user: w.director.id, ip: '192.0.2.7' },
    ])
    const [stored] = await w.asPlatform((tx) => tx<{ value: string }[]>`SELECT value #>> '{}' AS value FROM app_settings WHERE scope = 'system' AND key = 'region'`)
    expect(stored?.value).toBe('de')
  })

  it('login events pass the 010 audit policy, and garbage addresses are stored as NULL', async () => {
    expect(await writeAudit({ userId: w.aViewer.id, action: 'login_success', ip: '2001:db8::1' })).toBe(true)
    expect(await writeAudit({ userId: null, action: 'login_failure', detail: { reason: 'unknown_user' }, ip: 'not an address' })).toBe(true)
    // Rows with an organisation can be read back before commit.
    expect(await writeAudit({ userId: w.aViewer.id, orgId: w.orgA.id, action: 'itest.ip', ip: "1.2.3.4'; --", detail: { token: 'abc' } })).toBe(true)
    const [row] = await w.asOrg(w.orgA.id, (tx) => tx<{ ip: string | null; detail: unknown }[]>`SELECT ip, detail FROM app_audit_log WHERE action = 'itest.ip'`)
    expect(row).toEqual({ ip: null, detail: { token: '[redacted]' } })
  })
})
