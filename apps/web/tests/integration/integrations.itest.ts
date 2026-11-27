import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CREDENTIALS_REQUIRED_ON_MOVE, HOST_NOT_ALLOWED, HOST_RESERVED } from '@/lib/admin/integration-messages'
import type { IntegrationInput } from '@/lib/admin/types'
import { decrypt } from '@/lib/integrations/crypto'
import { connectPostgres, driver, probe, testConnection } from '@/lib/integrations/test-connection'
import * as integrations from '@/lib/portal/pg/integrations'
import type { OrgCtx } from '@/lib/portal/pg/org'
import { startWorld, type World } from './harness'
import { committedHost } from './hosts-fixture'

// pg-only facts: what is really stored, both layers of the managed rules, and ONE real connection to portal_test.

const KEY = randomBytes(32).toString('base64')
const PASSWORD = `deny-SENTINEL-${randomUUID()}`
const USER = 'deny_sentinel_user'
/** A stored integration may not point at localhost: a committed allowed host that only the replaced resolver answers. */
const HOST = 'stored.itest.invalid'
const ADDRESS = '203.0.113.10'

describe('pg integrations', () => {
  let w: World
  let admin: OrgCtx
  let me: { id: string; username: string }
  let cleanups: (() => Promise<void>)[] = []

  let removeHost: (() => Promise<void>) | undefined
  beforeAll(async () => { removeHost = await committedHost(HOST) })
  afterAll(async () => { await removeHost?.() })

  beforeEach(async () => {
    vi.stubEnv('INTEGRATION_KEYS', `itest:${KEY}`)
    vi.spyOn(driver, 'resolve').mockResolvedValue([ADDRESS])
    // The test limits live in the process and the organisations are the same in every test.
    ;(globalThis as { __omniIntegrationTests?: Map<string, number[]> }).__omniIntegrationTests?.clear()
    w = await startWorld()
    admin = await w.ctx(w.aAdmin)
    me = { id: w.aAdmin.id, username: w.aAdmin.username }
  })
  afterEach(async () => {
    await w.close()
    for (const c of cleanups.splice(0)) await c()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  const input = (over: Partial<IntegrationInput> = {}): IntegrationInput => ({
    name: `Itest ${randomUUID().slice(0, 8)}`, kind: 'postgres', host: HOST, port: 5432, database: 'portal_test', relations: [], sslMode: 'disable',
    username: USER, credentials: PASSWORD, ...over,
  })
  const make = async (over: Partial<IntegrationInput> = {}) => {
    const r = await integrations.save(admin, me, input(over))
    if (!r.ok) throw new Error(r.error)
    return r.row
  }
  const secret = async (id: string, orgId = w.orgA.id) => {
    const [row] = await w.asOrg(orgId, (tx) => tx<{ cred_ciphertext: Buffer; cred_nonce: Buffer; cred_key_id: string }[]>`
      SELECT cred_ciphertext, cred_nonce, cred_key_id FROM app_integration_credentials(${id})`)
    return row && { ciphertext: row.cred_ciphertext, nonce: row.cred_nonce, keyId: row.cred_key_id }
  }
  const stored = () => w.asOrg(w.orgA.id, (tx) => tx`
    SELECT id, name, host, port, database, ssl_mode, relation_allowlist, credential_source, cred_key_id, has_credentials, status, rotated_at
      FROM app_integrations WHERE org_id = ${w.orgA.id} ORDER BY id`)

  it('stores one encrypted credential bound to this organisation and row; only a new one replaces it', async () => {
    const row = await make({ relations: ['reporting', 'public.x'] })
    expect(row.relations).toEqual(['reporting', 'public.x'])
    expect(row.keyId).toBeNull()
    const first = (await secret(row.id))!
    expect(first.keyId).toBe('itest')
    expect(first.ciphertext.includes(PASSWORD)).toBe(false)
    expect(decrypt(first, { orgId: w.orgA.id, integrationId: row.id })).toEqual({ username: USER, password: PASSWORD })
    expect(() => decrypt(first, { orgId: w.orgB.id, integrationId: row.id })).toThrow()
    expect(await secret(row.id, w.orgB.id)).toBeUndefined()

    await integrations.save(admin, me, input({ id: row.id, name: 'Renamed', relations: [], username: undefined, credentials: undefined }))
    expect(await secret(row.id)).toEqual(first)
    await integrations.save(admin, me, input({ id: row.id, name: 'Renamed', credentials: 'second-password' }))
    const second = (await secret(row.id))!
    expect(second.nonce.equals(first.nonce)).toBe(false)
    expect(decrypt(second, { orgId: w.orgA.id, integrationId: row.id }).password).toBe('second-password')
    const [{ source }] = (await w.asOrg(w.orgA.id, (tx) => tx`SELECT credential_source AS source FROM app_integrations WHERE id = ${row.id}`)) as unknown as [{ source: string }]
    expect(source).toBe('stored')
  })

  it('a changed port needs the credentials again; a credential source cannot be asked for', async () => {
    cleanups.push(await committedHost('ports.itest.invalid'))
    const row = await make({ host: 'ports.itest.invalid' })
    const before = await stored()
    expect(await integrations.save(admin, me, input({ id: row.id, name: row.name, host: row.host, port: 5433, username: undefined, credentials: undefined }))).toMatchObject({ ok: false, error: CREDENTIALS_REQUIRED_ON_MOVE })
    const smuggled = { ...input(), credentialSource: 'env:DATABASE_URL_READONLY_WR' } as unknown as IntegrationInput
    expect(await integrations.save(admin, me, smuggled)).toMatchObject({ ok: false, code: 'invalid' })
    expect(await stored()).toEqual(before)
  })

  it("a host allowed for organisation B only is not allowed for A", async () => {
    cleanups.push(await committedHost('b-only.itest.invalid', w.orgB.id))
    expect(await integrations.save(admin, me, input({ host: 'b-only.itest.invalid' }))).toMatchObject({ ok: false, error: HOST_NOT_ALLOWED })
    const b = await w.ctx(w.bAdmin, w.orgB.slug)
    expect(await integrations.save(b, { id: w.bAdmin.id, username: 'b' }, input({ host: 'b-only.itest.invalid' }))).toMatchObject({ ok: true })
  })

  it('managed rows: the app refuses, and portal_app SQL changes nothing either', async () => {
    const list = await integrations.list(admin)
    const managed = list.ok ? list.rows.find((r) => r.managed)! : undefined
    expect(managed, 'run db/test/rebuild_portal_test.sh.example (011)').toBeDefined()
    const before = await stored()

    expect(await integrations.save(admin, me, input({ id: managed!.id }))).toMatchObject({ ok: false, code: 'invalid' })
    expect(await integrations.remove(admin, me, managed!.id)).toMatchObject({ ok: false, code: 'invalid' })

    const env = (tx: Parameters<Parameters<World['asOrg']>[1]>[0]) => [
      tx`UPDATE app_integrations SET name = 'taken over' WHERE id = ${managed!.id} RETURNING id`,
      tx`UPDATE app_integrations SET status = 'disabled' WHERE id = ${managed!.id} RETURNING id`,
      tx`DELETE FROM app_integrations WHERE id = ${managed!.id} RETURNING id`,
    ]
    for (let i = 0; i < 3; i++) expect(await w.asOrg(w.orgA.id, async (tx) => env(tx)[i]!)).toHaveLength(0)
    await expect(w.asOrg(w.orgA.id, (tx) => tx`
      INSERT INTO app_integrations (org_id, kind, name, host, port, database, credential_source)
      VALUES (${w.orgA.id}, 'postgres', 'planted', 'localhost', 5432, 'x', 'env:DATABASE_URL_READONLY_WR')`)).rejects.toMatchObject({ code: '42501' })
    const mine = await make()
    await expect(w.asOrg(w.orgA.id, (tx) => tx`
      UPDATE app_integrations SET credential_source = 'env:DATABASE_URL_READONLY_WR', cred_ciphertext = NULL, cred_nonce = NULL, cred_key_id = NULL
       WHERE id = ${mine.id}`)).rejects.toMatchObject({ code: '42501' })
    expect((await stored()).filter((r) => r.id !== mine.id)).toEqual(before)
  })

  it('delete takes the datasets over it with it (007 cascade)', async () => {
    const row = await make()
    const count = () => w.asOrg(w.orgA.id, async (tx) => (await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM app_datasets WHERE integration_id = ${row.id}`)[0]!.n)
    await w.asOrg(w.orgA.id, async (tx) => {
      await tx`INSERT INTO app_datasets (org_id, integration_id, key, label, relation) VALUES (${w.orgA.id}, ${row.id}, 'itest_ds', 'Itest', 't')`
    })
    expect(await count()).toBe(1)
    expect(await integrations.remove(admin, me, row.id)).toEqual({ ok: true })
    expect(await count()).toBe(0)
  })

  it('test connection: unsupported kind, disabled row, host no longer allowed, managed source from its variable', async () => {
    const connect = vi.fn(async () => ({ serverVersion: '18.0' }))
    const insert = (over: { kind?: string; host?: string; status?: string }) => w.asOrg(w.orgA.id, async (tx) => (await tx<{ id: string }[]>`
      INSERT INTO app_integrations (org_id, kind, name, host, port, database, status)
      VALUES (${w.orgA.id}, ${over.kind ?? 'postgres'}, ${randomUUID()}, ${over.host ?? HOST}, 5432, 'portal_test', ${over.status ?? 'active'})
      RETURNING id`)[0]!.id)
    expect(await testConnection(admin, await insert({ kind: 'mysql' }), connect)).toEqual({ ok: false, category: 'unsupported' })
    expect(await testConnection(admin, await insert({ status: 'disabled' }), connect)).toEqual({ ok: false, category: 'not_allowed' })
    // the database accepts a host that is on no list: only the app refuses it
    expect(await testConnection(admin, await insert({ host: 'unlisted.itest.invalid' }), connect)).toEqual({ ok: false, category: 'not_allowed' })
    expect(await testConnection(admin, await insert({}), connect)).toEqual({ ok: false, category: 'other' }) // no credential stored
    expect(connect).not.toHaveBeenCalled()

    const list = await integrations.list(admin)
    const managed = list.ok ? list.rows.find((r) => r.managed)! : undefined
    vi.stubEnv('DATABASE_URL_READONLY_WR', 'postgresql://wr_reader:wr-pass@ignored.example:1/ignored')
    expect(await testConnection(admin, managed!.id, connect)).toMatchObject({ ok: true })
    expect(connect).toHaveBeenCalledWith({ host: 'localhost', port: 5432, database: 'jaysnet_data', sslMode: 'disable', username: 'wr_reader', password: 'wr-pass' })
  })

  it('REAL connection to portal_test: ok with the right password, auth and tls failures are only categories', async () => {
    // The connector itself: portal_test is on this machine, which no stored integration may reach (see below).
    const url = new URL(process.env.TEST_DATABASE_URL_APP!)
    expect(url.pathname).toBe('/portal_test')
    const target = { host: 'localhost', port: Number(url.port || 5432), database: 'portal_test', sslMode: 'disable', username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }
    const ok = { ok: true, latencyMs: expect.any(Number), serverVersion: expect.stringMatching(/^\d+/) }
    expect(await probe(target, connectPostgres)).toEqual(ok)
    expect(await probe({ ...target, address: '127.0.0.1' }, connectPostgres)).toEqual(ok) // connecting to a given address
    expect(await probe({ ...target, password: 'not-the-password' }, connectPostgres)).toEqual({ ok: false, category: 'auth' })
    // Whatever certificate the local server has, it is not a publicly trusted one for "localhost": no downgrade.
    expect(await probe({ ...target, sslMode: 'verify-full' }, connectPostgres)).toEqual({ ok: false, category: 'tls' })
  })

  it('a stored row never reaches this machine: refused on save, and again on test however it got there', async () => {
    expect(await integrations.save(admin, me, input({ host: 'localhost' }))).toMatchObject({ ok: false, error: HOST_RESERVED })
    vi.stubEnv('DATABASE_URL', 'postgresql://x:y@portal-db.itest.invalid:5433/omnimetrics_portal')
    expect(await integrations.save(admin, me, input({ host: 'Portal-DB.itest.invalid', database: 'something_else' }))).toMatchObject({ ok: false, error: HOST_RESERVED })
    vi.unstubAllEnvs()
    vi.stubEnv('INTEGRATION_KEYS', `itest:${KEY}`)

    const connect = vi.fn(async () => ({}))
    const row = await make()
    expect(await testConnection(admin, row.id, connect)).toEqual({ ok: true, latencyMs: expect.any(Number) })
    expect(connect).toHaveBeenLastCalledWith(expect.objectContaining({ host: HOST, address: ADDRESS }))
    connect.mockClear()

    // saved while harmless, then the name starts pointing here
    for (const answer of [['127.0.0.1'], ['169.254.169.254'], ['::1'], [ADDRESS, '127.0.0.1']]) {
      vi.spyOn(driver, 'resolve').mockResolvedValue(answer)
      expect(await testConnection(admin, row.id, connect), answer.join()).toEqual({ ok: false, category: 'not_allowed' })
    }
    // a localhost row written past the app (the database does not stop it)
    const planted = await w.asOrg(w.orgA.id, async (tx) => (await tx<{ id: string }[]>`
      INSERT INTO app_integrations (org_id, kind, name, host, port, database)
      VALUES (${w.orgA.id}, 'postgres', ${randomUUID()}, 'localhost', 5432, 'portal_test') RETURNING id`)[0]!.id)
    expect(await testConnection(admin, planted, connect)).toEqual({ ok: false, category: 'not_allowed' })
    vi.spyOn(driver, 'resolve').mockRejectedValue(Object.assign(new Error('no'), { code: 'ENOTFOUND' }))
    expect(await testConnection(admin, row.id, connect)).toEqual({ ok: false, category: 'dns' })
    expect(connect).not.toHaveBeenCalled()
  })

  it('20 tests a minute for the organisation, however many integrations it has', async () => {
    vi.spyOn(driver, 'connect').mockResolvedValue({})
    const rows = [await make(), await make(), await make()]
    for (const row of rows.slice(0, 2)) for (let i = 0; i < 10; i++) expect(await integrations.test(admin, me, row.id)).toMatchObject({ ok: true })
    expect(await integrations.test(admin, me, rows[2]!.id)).toMatchObject({ ok: false, code: 'rate_limited', error: expect.stringMatching(/20 per minute for the organisation/) })
  })

  it('limits the 11th test in a minute and audits it', async () => {
    vi.spyOn(driver, 'connect').mockResolvedValue({})
    const row = await make()
    for (let i = 0; i < 10; i++) expect(await integrations.test(admin, me, row.id)).toMatchObject({ ok: true })
    expect(await integrations.test(admin, me, row.id)).toMatchObject({ ok: false, code: 'rate_limited' })
    const audit = await integrations.audit(admin)
    expect(audit.ok && audit.entries.map((e) => e.action)).toContain('integration.test.limited')
  })

  it('fails closed without a usable INTEGRATION_KEYS, with a key-free log line', async () => {
    const row = await make()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const raw of ['', `itest:${KEY.slice(0, 20)}`]) {
      vi.stubEnv('INTEGRATION_KEYS', raw)
      const results = [await integrations.list(admin), await integrations.save(admin, me, input()), await integrations.remove(admin, me, row.id), await integrations.test(admin, me, row.id), await integrations.audit(admin), await integrations.listHosts(admin)]
      for (const r of results) expect(r).toMatchObject({ ok: false, code: 'forbidden' })
      expect(await integrations.list(await w.ctx(w.aViewer))).toMatchObject({ ok: false, code: 'not_found' })
    }
    const logged = log.mock.calls.flat().join('\n')
    expect(logged).toContain('INTEGRATION_KEYS')
    expect(logged).not.toContain(KEY.slice(0, 20))
    expect(await stored()).toContainEqual(expect.objectContaining({ id: row.id }))
  })

  it('deny list: no result, audit row, error or log line carries the password, the user or the key', async () => {
    const lines: unknown[] = []
    for (const level of ['log', 'warn', 'error', 'info', 'debug'] as const) vi.spyOn(console, level).mockImplementation((...a) => void lines.push(a))
    const out: unknown[] = []
    const capture = async (p: Promise<unknown>) => out.push(await p.catch((e: Error) => ({ threw: e.message, stack: e.stack, own: JSON.stringify(e, Object.getOwnPropertyNames(e)) })))
    // a driver that puts everything it knows into its error
    vi.spyOn(driver, 'connect').mockImplementation(async (t) => { throw Object.assign(new Error(`failed ${JSON.stringify(t)}`), { code: '28P01' }) })

    const row = await make()
    await capture(Promise.resolve(row))
    await capture(integrations.list(admin))
    await capture(integrations.test(admin, me, row.id))
    await capture(integrations.save(admin, me, input({ id: row.id, name: row.name, host: 'evil.example' })))
    await capture(integrations.save(admin, me, input({ name: row.name })))
    await capture(integrations.save(admin, me, input({ username: undefined })))
    await capture(integrations.save(admin, me, input({ relations: [PASSWORD] }))) // refused by the schema
    await capture(integrations.save({ ...admin } as OrgCtx, me, input()))
    vi.stubEnv('INTEGRATION_KEYS', `other:${randomBytes(32).toString('base64')}`) // cannot decrypt
    await capture(integrations.test(admin, me, row.id))
    vi.stubEnv('INTEGRATION_KEYS', 'broken')
    await capture(integrations.list(admin))
    vi.stubEnv('INTEGRATION_KEYS', `itest:${KEY}`)
    await capture(integrations.audit(admin))
    await capture(integrations.remove(admin, me, row.id))
    await capture(w.asOrg(w.orgA.id, (tx) => tx`SELECT * FROM app_audit_log WHERE org_id = ${w.orgA.id}`))

    const text = JSON.stringify([out, lines])
    expect(text).toContain('integration.create')
    expect(text).toContain('could not be decrypted')
    const keyBytes = Buffer.from(KEY, 'base64')
    for (const forbidden of [PASSWORD, Buffer.from(PASSWORD).toString('base64'), USER, Buffer.from(USER).toString('base64'), KEY, keyBytes.toString('hex')]) {
      // the one place the sentinel may be is the input this test passed in itself
      expect(text.includes(forbidden), forbidden.slice(0, 12)).toBe(false)
    }
  })
})
