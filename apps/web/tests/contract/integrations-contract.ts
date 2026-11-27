import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OrgAccess } from '@omnimetrics/types'
import { CREDENTIALS_REQUIRED, CREDENTIALS_REQUIRED_ON_MOVE, HOST_LISTED, HOST_NOT_ALLOWED, HOST_RESERVED, INTEGRATION_NAME_TAKEN, MANAGED_NO_DELETE, MANAGED_NO_EDIT, hostInUse } from '@/lib/admin/integration-messages'
import type { IntegrationInput, IntegrationRow } from '@/lib/admin/types'
import type { Portal } from '@/lib/portal'

// Integrations and allowed hosts: the same assertions for the mock and for pgPortal.
// A database name containing "fail" is the one whose connection test fails (mock rule; the pg setup injects it).

export interface IntegrationsWorld {
  portal: Portal
  director: OrgAccess
  /** Organisation A. */
  orgAdmin: OrgAccess
  builder: OrgAccess
  viewer: OrgAccess
  /** Admin of organisation B. */
  other: OrgAccess
  actor: { id: string; username: string }
  directorActor: { id: string; username: string }
  /** Two allowed hosts, both with port 5432 open to every organisation. */
  host: string
  secondHost: string
}

const PASSWORD = 'contract-SENTINEL-password-51ab'
const USER = 'contract_sentinel_user'

export function integrationsContract(label: string, setup: () => Promise<IntegrationsWorld>, teardown: () => Promise<void>): void {
  describe(`integrations contract (${label})`, () => {
    let w: IntegrationsWorld
    beforeEach(async () => { w = await setup() })
    afterEach(teardown)

    const input = (over: Partial<IntegrationInput> = {}): IntegrationInput => ({
      name: 'Contract source', kind: 'postgres', host: w.host, port: 5432, database: 'contract_db', relations: ['reporting'], sslMode: 'disable',
      username: USER, credentials: PASSWORD, ...over,
    })
    const keep = (over: Partial<IntegrationInput>) => input({ username: undefined, credentials: undefined, ...over })
    const make = async (over: Partial<IntegrationInput> = {}, ctx = w.orgAdmin): Promise<IntegrationRow> => {
      const r = await w.portal.integrations.save(ctx, w.actor, input(over))
      if (!r.ok) throw new Error(`save: ${r.error}`)
      return r.row
    }
    const rows = async (ctx = w.orgAdmin) => {
      const r = await w.portal.integrations.list(ctx)
      if (!r.ok) throw new Error(r.error)
      return r.rows
    }
    const find = async (id: string) => (await rows()).find((r) => r.id === id)

    it('builders and viewers can do nothing', async () => {
      const row = await make()
      const p = w.portal.integrations
      for (const ctx of [w.builder, w.viewer]) {
        const results = [
          await p.list(ctx), await p.save(ctx, w.actor, input({ name: 'Nope' })), await p.save(ctx, w.actor, input({ id: row.id })),
          await p.remove(ctx, w.actor, row.id), await p.test(ctx, w.actor, row.id), await p.audit(ctx), await p.hosts.list(ctx),
          await p.hosts.add(ctx, w.actor, { host: 'nope.invalid', portMin: 1, portMax: 2 }), await p.hosts.remove(ctx, w.actor, 'x'),
        ]
        for (const r of results) {
          expect(r.ok).toBe(false)
          if (!r.ok) expect(['not_found', 'forbidden']).toContain(r.code)
        }
      }
      expect(await find(row.id)).toBeDefined()
    })

    it('creates with write-only credentials', async () => {
      const row = await make()
      expect(row).toMatchObject({ name: 'Contract source', host: w.host, port: 5432, database: 'contract_db', relations: ['reporting'], sslMode: 'disable', status: 'untested', managed: false, hasCredentials: true, lastTest: null })
      expect(row.rotatedAt).toBeTruthy()
      const all = JSON.stringify([row, await rows(), await w.portal.integrations.audit(w.orgAdmin)])
      expect(all).not.toContain(PASSWORD)
      expect(all).not.toContain(USER)
      expect(all).not.toContain(Buffer.from(PASSWORD).toString('base64'))
    })

    it('refuses without writing: no credentials, unlisted host, port out of range, taken name', async () => {
      const first = await make()
      const before = await rows()
      const p = w.portal.integrations
      expect(await p.save(w.orgAdmin, w.actor, keep({ name: 'No creds' }))).toMatchObject({ ok: false, error: CREDENTIALS_REQUIRED })
      expect(await p.save(w.orgAdmin, w.actor, input({ name: 'Evil', host: 'evil.example' }))).toMatchObject({ ok: false, error: HOST_NOT_ALLOWED })
      expect(await p.save(w.orgAdmin, w.actor, input({ name: 'Evil port', port: 6000 }))).toMatchObject({ ok: false, code: 'invalid', error: expect.stringContaining('range') })
      expect(await p.save(w.orgAdmin, w.actor, input({ name: first.name.toUpperCase() }))).toMatchObject({ ok: false, error: INTEGRATION_NAME_TAKEN })
      expect(await rows()).toEqual(before)
    })

    it('this machine and link-local addresses cannot be saved, on create or on edit, listed or not', async () => {
      const row = await make()
      const before = await rows()
      const p = w.portal.integrations
      for (const host of ['localhost', 'LOCALHOST.', '127.0.0.1', '127.5.6.7', '127.1', '::1', '[::1]', '0.0.0.0', '::', '169.254.169.254', 'fe80::1', '::ffff:127.0.0.1']) {
        for (const over of [{ name: 'Reserved' }, { id: row.id, name: row.name }]) {
          expect(await p.save(w.orgAdmin, w.actor, input({ ...over, host, port: 6000, database: 'anything' })), host).toMatchObject({ ok: false, code: 'invalid', error: HOST_RESERVED })
        }
      }
      expect(await rows()).toEqual(before)
    })

    it('changing the SSL mode needs the credentials again; other edits do not', async () => {
      const row = await make()
      const p = w.portal.integrations
      for (const sslMode of ['require', 'verify-ca', 'verify-full'] as const) {
        expect(await p.save(w.orgAdmin, w.actor, keep({ id: row.id, sslMode })), sslMode).toMatchObject({ ok: false, error: CREDENTIALS_REQUIRED_ON_MOVE })
      }
      expect(await find(row.id)).toMatchObject({ sslMode: 'disable' })
      expect(await p.save(w.orgAdmin, w.actor, keep({ id: row.id, name: 'Other name', relations: ['public.x'] }))).toMatchObject({ ok: true })
      const changed = await p.save(w.orgAdmin, w.actor, input({ id: row.id, sslMode: 'verify-ca' }))
      expect(changed.ok && changed.row.sslMode).toBe('verify-ca')
      expect(await p.save(w.orgAdmin, w.actor, keep({ id: row.id, sslMode: 'verify-ca', name: 'Kept' }))).toMatchObject({ ok: true })
    })

    it('compares hosts case-insensitively', async () => {
      expect((await make({ host: w.host.toUpperCase() })).host).toBe(w.host)
    })

    it('edits keep the credentials unless new ones are sent; moving the server needs new ones', async () => {
      const row = await make()
      const p = w.portal.integrations
      const renamed = await p.save(w.orgAdmin, w.actor, keep({ id: row.id, name: 'Renamed', host: w.host.toUpperCase() }))
      expect(renamed.ok && renamed.row).toMatchObject({ name: 'Renamed', hasCredentials: true, rotatedAt: row.rotatedAt })
      for (const move of [{ host: w.secondHost }, { database: 'other_db' }]) {
        expect(await p.save(w.orgAdmin, w.actor, keep({ id: row.id, name: 'Renamed', ...move })), JSON.stringify(move)).toMatchObject({ ok: false, error: CREDENTIALS_REQUIRED_ON_MOVE })
      }
      expect(await find(row.id)).toMatchObject({ host: w.host, database: 'contract_db' })
      expect(await p.save(w.orgAdmin, w.actor, input({ id: row.id, name: 'Renamed', host: 'evil.example' }))).toMatchObject({ ok: false, error: HOST_NOT_ALLOWED })
      const moved = await p.save(w.orgAdmin, w.actor, input({ id: row.id, name: 'Renamed', host: w.secondHost, database: 'other_db' }))
      expect(moved.ok && moved.row).toMatchObject({ host: w.secondHost, database: 'other_db', hasCredentials: true })
    })

    it("another organisation's id is not found, for its admin and for the director standing in B", async () => {
      const row = await make()
      const p = w.portal.integrations
      expect((await rows(w.other)).map((r) => r.id)).not.toContain(row.id)
      expect(await p.test(w.other, w.actor, row.id)).toMatchObject({ ok: false, code: 'not_found' })
      expect(await p.remove(w.other, w.actor, row.id)).toMatchObject({ ok: false, code: 'not_found' })
      expect(await p.save(w.other, w.actor, input({ id: row.id }))).toMatchObject({ ok: false, code: 'not_found' })
      const audit = await p.audit(w.other)
      expect(audit.ok && audit.entries.filter((e) => e.targetId === row.id)).toEqual([])
      expect(await find(row.id)).toMatchObject({ name: 'Contract source' })
    })

    it('the managed row is listed, testable, and never edited or deleted', async () => {
      const managed = (await rows()).find((r) => r.managed)!
      expect(managed).toMatchObject({ status: 'managed', hasCredentials: false, keyId: null })
      const p = w.portal.integrations
      expect(await p.save(w.orgAdmin, w.actor, input({ id: managed.id, host: 'localhost' }))).toMatchObject({ ok: false, error: MANAGED_NO_EDIT })
      expect(await p.remove(w.orgAdmin, w.actor, managed.id)).toMatchObject({ ok: false, error: MANAGED_NO_DELETE })
      expect((await rows()).find((r) => r.managed)).toMatchObject({ name: managed.name, host: managed.host, database: managed.database })
    })

    it('tests: result and last test on the row; a failure is generic text', async () => {
      const good = await make()
      const bad = await make({ name: 'Broken', database: 'will_fail' })
      const p = w.portal.integrations
      const ok = await p.test(w.orgAdmin, w.actor, good.id)
      expect(ok.ok && ok.row).toMatchObject({ status: 'ok', lastTest: { ok: true } })
      const failed = await p.test(w.orgAdmin, w.actor, bad.id)
      expect(failed.ok && failed.row).toMatchObject({ status: 'failed', lastTest: { ok: false } })
      expect(JSON.stringify(failed)).not.toContain(PASSWORD)
      expect(await find(good.id)).toMatchObject({ status: 'ok', lastTest: { ok: true } })
      expect(await find(bad.id)).toMatchObject({ status: 'failed', lastTest: { ok: false } })
    })

    it('limits repeated tests of one integration', async () => {
      const row = await make()
      let last = await w.portal.integrations.test(w.orgAdmin, w.actor, row.id)
      for (let i = 0; i < 10 && last.ok; i++) last = await w.portal.integrations.test(w.orgAdmin, w.actor, row.id)
      expect(last).toMatchObject({ ok: false, code: 'rate_limited', error: expect.stringMatching(/per minute/) })
    })

    it('deletes, and audits create, update, test and delete without secrets', async () => {
      const row = await make()
      const p = w.portal.integrations
      await p.save(w.orgAdmin, w.actor, keep({ id: row.id, name: 'Renamed' }))
      await p.test(w.orgAdmin, w.actor, row.id)
      expect(await p.remove(w.orgAdmin, w.actor, row.id)).toEqual({ ok: true })
      expect(await p.remove(w.orgAdmin, w.actor, row.id)).toMatchObject({ ok: false, code: 'not_found' })
      expect(await find(row.id)).toBeUndefined()
      const audit = await p.audit(w.orgAdmin)
      if (!audit.ok) throw new Error(audit.error)
      const mine = audit.entries.filter((e) => e.targetId === row.id)
      expect(mine.map((e) => e.action).sort()).toEqual(['integration.create', 'integration.delete', 'integration.test', 'integration.update'])
      expect(JSON.stringify(audit)).not.toContain(PASSWORD)
      expect(JSON.stringify(audit)).not.toContain(USER)
    })

    it('hosts: admins read, only the director writes; a host in use stays', async () => {
      const p = w.portal.integrations.hosts
      const listed = await p.list(w.orgAdmin)
      if (!listed.ok) throw new Error(listed.error)
      expect(listed.hosts.map((h) => h.host)).toEqual(expect.arrayContaining([w.host, w.secondHost]))
      const second = listed.hosts.find((h) => h.host === w.secondHost)!
      expect(await p.add(w.orgAdmin, w.actor, { host: 'x.invalid', portMin: 1, portMax: 2 })).toMatchObject({ ok: false, code: 'forbidden' })
      expect(await p.remove(w.orgAdmin, w.actor, second.id)).toMatchObject({ ok: false, code: 'forbidden' })
      expect(await p.add(w.director, w.directorActor, { host: 'New.Contract.invalid', portMin: 5432, portMax: 5433 })).toMatchObject({ ok: true, host: { portMin: 5432, portMax: 5433 } })
      expect(await p.add(w.director, w.directorActor, { host: 'new.contract.invalid', portMin: 1, portMax: 2 })).toMatchObject({ ok: false, error: HOST_LISTED })
      await make({ host: w.secondHost })
      await make({ host: w.secondHost }, w.other) // the count spans every organisation
      expect(await p.remove(w.director, w.directorActor, second.id)).toMatchObject({ ok: false, error: hostInUse(2) })
      expect(await p.remove(w.director, w.directorActor, '00000000-0000-4000-8000-000000000000')).toMatchObject({ ok: false, code: 'not_found' })
    })
  })
}
