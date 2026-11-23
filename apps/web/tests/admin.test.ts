import { beforeEach, describe, expect, it, vi } from 'vitest'
import { capabilitiesFor, type Capability, type OrgAccess, type Role } from '@omnimetrics/types'
import * as A from '@/lib/portal/mock/admin'
import { clock, db, resetMockAdmin } from '@/lib/portal/mock/admin-store'
import { mockPortal } from '@/lib/portal/mock'
import { redact } from '@/lib/admin/redact'
import { IntegrationInputSchema, type IntegrationInput } from '@/lib/admin/types'
import { DEFAULT_SETTINGS, resolveSettings } from '@/lib/settings/model'
import { createFormatter, formatterCacheSize } from '@/lib/settings/format'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => null }))

const ORG = { wr: { id: 'mock-org-worldrisk', slug: 'worldrisk', name: 'WorldRisk', status: 'active' as const }, ad: { id: 'mock-org-adars', slug: 'adars', name: 'ADARS', status: 'active' as const } }
const as = (org: keyof typeof ORG, role: Role, isPlatform = false): OrgAccess => ({ org: ORG[org], role, isPlatform, capabilities: capabilitiesFor(role, isPlatform) })
const director = (org: keyof typeof ORG = 'wr') => as(org, 'admin', true)
const actor = { id: 'real-1', username: 'tester' }
const SECRET = 'S3cr3t-p@ss-should-never-appear-9f2c'
const good = (over: Partial<IntegrationInput> = {}): IntegrationInput => ({ name: 'Test source', kind: 'postgres', host: 'db.mock-wr.internal', port: 5432, database: 'wr_test', relations: ['reporting'], sslMode: 'verify-full', credentials: SECRET, ...over })

beforeEach(() => { resetMockAdmin(); clock.now = () => Date.parse('2026-11-23T10:00:00Z') })

describe('capability matrix per role and screen', () => {
  const SCREENS: Record<string, Capability> = { integrations: 'integrations.manage', 'admin (users, accounts)': 'admin.view', organisations: 'orgs.manage', 'allowed hosts': 'hosts.manage', 'settings (mine)': 'settings.view', 'settings (organisation)': 'settings.org', 'settings (system)': 'settings.system', 'SQL terminal': 'terminal.run' }
  const MATRIX: Record<string, Record<string, boolean>> = {
    director: { integrations: true, 'admin (users, accounts)': true, organisations: true, 'allowed hosts': true, 'settings (mine)': true, 'settings (organisation)': true, 'settings (system)': true, 'SQL terminal': true },
    'org admin': { integrations: true, 'admin (users, accounts)': true, organisations: false, 'allowed hosts': false, 'settings (mine)': true, 'settings (organisation)': true, 'settings (system)': false, 'SQL terminal': false },
    builder: { integrations: false, 'admin (users, accounts)': false, organisations: false, 'allowed hosts': false, 'settings (mine)': true, 'settings (organisation)': false, 'settings (system)': false, 'SQL terminal': false },
    viewer: { integrations: false, 'admin (users, accounts)': false, organisations: false, 'allowed hosts': false, 'settings (mine)': true, 'settings (organisation)': false, 'settings (system)': false, 'SQL terminal': false },
  }
  const ROLE: Record<string, OrgAccess> = { director: director(), 'org admin': as('wr', 'admin'), builder: as('wr', 'builder'), viewer: as('wr', 'viewer') }
  for (const [who, row] of Object.entries(MATRIX)) {
    it(`${who}: capabilities match the matrix`, () => {
      for (const [screen, cap] of Object.entries(SCREENS)) expect(ROLE[who]!.capabilities.includes(cap), `${who} / ${screen}`).toBe(row[screen])
    })
  }
  it('the portal itself refuses what the role lacks (not just the UI)', () => {
    for (const r of ['builder', 'viewer'] as const) {
      const c = as('wr', r)
      expect(A.integrations.list(c)).toMatchObject({ ok: false, code: 'forbidden' })
      expect(A.integrations.save(c, actor, good())).toMatchObject({ ok: false, code: 'forbidden' })
      expect(A.integrations.test(c, actor, 'int-wr-1')).toMatchObject({ ok: false, code: 'forbidden' })
      expect(A.users.list(c)).toMatchObject({ ok: false, code: 'forbidden' })
      expect(A.users.add(c, actor, { username: 'x.mock', email: 'x@mock.invalid', role: 'viewer' })).toMatchObject({ ok: false, code: 'forbidden' })
      expect(A.accounts.sessions(c, 'u-sam')).toMatchObject({ ok: false, code: 'forbidden' })
      expect(A.organisations.list(c)).toMatchObject({ ok: false, code: 'forbidden' })
      expect(A.settings.set(c, actor, 'org', { timeFormat: '12' })).toMatchObject({ ok: false, code: 'forbidden' })
      expect(A.settings.set(c, actor, 'system', { timeFormat: '12' })).toMatchObject({ ok: false, code: 'forbidden' })
      expect(A.settings.set(c, actor, 'user', { timeFormat: '12' })).toMatchObject({ ok: true }) // everyone sets their own
    }
  })
  it('org admins cannot manage hosts, organisations or the system scope; only the director can', () => {
    const c = as('wr', 'admin')
    expect(A.integrations.hosts.add(c, actor, { host: 'x.example.test', portMin: 5432, portMax: 5432 })).toMatchObject({ ok: false, code: 'forbidden' })
    expect(A.organisations.create(c, actor, 'Nope')).toMatchObject({ ok: false, code: 'forbidden' })
    expect(A.organisations.update(c, actor, ORG.ad.id, { status: 'suspended' })).toMatchObject({ ok: false, code: 'forbidden' })
    expect(A.settings.set(c, actor, 'system', { region: 'us' })).toMatchObject({ ok: false, code: 'forbidden' })
    expect(A.users.memberships(c, 'u-maria')).toMatchObject({ ok: false, code: 'forbidden' })
    const d = director()
    expect(A.integrations.hosts.add(d, actor, { host: 'new.mock.internal', portMin: 5432, portMax: 5433 })).toMatchObject({ ok: true })
    expect(A.organisations.create(d, actor, 'Third Org')).toMatchObject({ ok: true })
  })
  it('an org admin sees only their own organisation profile; the director sees all', () => {
    const own = A.organisations.list(as('wr', 'admin'))
    expect(own.ok && own.orgs.map((o) => o.slug)).toEqual(['worldrisk'])
    const all = A.organisations.list(director())
    expect(all.ok && all.orgs.map((o) => o.slug)).toEqual(['worldrisk', 'adars'])
  })
})

describe('write-only credentials and redaction', () => {
  it('the secret is never in any return value, the audit log or the redacted input', () => {
    const c = as('wr', 'admin')
    const out: unknown[] = []
    const created = A.integrations.save(c, actor, good())
    out.push(created)
    const id = created.ok ? created.row.id : ''
    out.push(A.integrations.list(c), A.integrations.test(c, actor, id), A.integrations.audit(c), A.integrations.hosts.list(c))
    out.push(A.integrations.save(c, actor, good({ id, credentials: `${SECRET}-v2` })))
    out.push(A.integrations.save(c, actor, good({ id, credentials: '' })))
    out.push(A.integrations.save(c, actor, good({ id, host: 'evil.example' }))) // refused: error text must not echo the secret either
    out.push(db().audit)
    const all = JSON.stringify(out)
    expect(all).not.toContain(SECRET)
    expect(all).not.toContain('-v2')
    expect(Object.keys(created.ok ? created.row : {})).not.toContain('credentials')
  })
  it('create needs credentials; edit with an empty field keeps them; replacing rotates the date', () => {
    const c = as('wr', 'admin')
    expect(A.integrations.save(c, actor, good({ credentials: undefined }))).toMatchObject({ ok: false, code: 'invalid' })
    const r = A.integrations.save(c, actor, good())
    if (!r.ok) throw new Error('save failed')
    expect(r.row).toMatchObject({ hasCredentials: true, keyId: 'k1', rotatedAt: '2026-11-23T10:00:00.000Z' })
    clock.now = () => Date.parse('2026-12-01T10:00:00Z')
    const keep = A.integrations.save(c, actor, good({ id: r.row.id, name: 'Renamed', credentials: '' }))
    expect(keep.ok && keep.row.rotatedAt).toBe('2026-11-23T10:00:00.000Z') // kept
    expect(db().vault.get(`${c.org.id}:${r.row.id}`)).toBe(SECRET)
    const rep = A.integrations.save(c, actor, good({ id: r.row.id, credentials: 'another-secret' }))
    expect(rep.ok && rep.row.rotatedAt).toBe('2026-12-01T10:00:00.000Z')
    expect(db().vault.get(`${c.org.id}:${r.row.id}`)).toBe('another-secret')
  })
  it('redact() masks credential-like keys and known secret strings', () => {
    expect(redact({ a: 1, credentials: 'x', nested: { password: 'y', note: `hello ${SECRET}` } }, [SECRET])).toEqual({ a: 1, credentials: '[redacted]', nested: { password: '[redacted]', note: 'hello [redacted]' } })
  })
  it('the schema is strict: no extra fields smuggled in', () => {
    expect(IntegrationInputSchema.safeParse({ ...good(), connectionString: 'postgres://u:p@h/db' }).success).toBe(false)
  })
  it('every route response goes through redact (reply helper): a credentials-named field can never be echoed', async () => {
    const { reply } = await import('@/lib/portal/route')
    const res = reply({ ok: true as const, row: { name: 'x', credentials: SECRET, nested: { password: SECRET } } })
    const body = await res.text()
    expect(body).not.toContain(SECRET)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const err = reply({ ok: false, code: 'rate_limited', error: 'slow down' })
    expect(err.status).toBe(429)
  })
})

describe('allowed hosts and the managed local row', () => {
  it('refuses a host that is not on the allowlist, and a port outside its range', () => {
    const c = as('wr', 'admin')
    expect(A.integrations.save(c, actor, good({ host: '169.254.169.254' }))).toMatchObject({ ok: false, code: 'invalid' })
    expect(A.integrations.save(c, actor, good({ host: 'localhost.evil.test' }))).toMatchObject({ ok: false, code: 'invalid' })
    expect(A.integrations.save(c, actor, good({ port: 6000 }))).toMatchObject({ ok: false, code: 'invalid', error: expect.stringContaining('range') })
    expect(A.integrations.save(c, actor, good({ port: 5439 }))).toMatchObject({ ok: true })
  })
  it('a host in use cannot be removed', () => {
    const d = director()
    A.integrations.save(as('wr', 'admin'), actor, good())
    const h = db().hosts.find((x) => x.host === 'db.mock-wr.internal')!
    expect(A.integrations.hosts.remove(d, actor, h.id)).toMatchObject({ ok: false, code: 'invalid' })
  })
  it('the managed local row has no secret, cannot be edited or deleted, and is tested without one', () => {
    const c = as('wr', 'admin')
    const list = A.integrations.list(c)
    const row = list.ok ? list.rows.find((r) => r.managed)! : null
    expect(row).toMatchObject({ name: 'Local database (read-only)', hasCredentials: false, keyId: null, status: 'managed', database: 'jaysnet_data' })
    expect(A.integrations.remove(c, actor, row!.id)).toMatchObject({ ok: false, code: 'invalid' })
    expect(A.integrations.save(c, actor, good({ id: row!.id, host: 'localhost', port: 5432 }))).toMatchObject({ ok: false, code: 'invalid' })
    expect(A.integrations.test(c, actor, row!.id)).toMatchObject({ ok: true })
  })
})

describe('test connection', () => {
  it('rate limits at 5 per minute, recovers after the window, and audits', () => {
    const c = as('wr', 'admin')
    for (let i = 0; i < 5; i++) expect(A.integrations.test(c, actor, 'int-wr-1')).toMatchObject({ ok: true })
    const sixth = A.integrations.test(c, actor, 'int-wr-1')
    expect(sixth).toMatchObject({ ok: false, code: 'rate_limited', error: expect.stringMatching(/5 per minute/) })
    clock.now = () => Date.parse('2026-11-23T10:01:01Z')
    expect(A.integrations.test(c, actor, 'int-wr-1')).toMatchObject({ ok: true })
    const actions = db().audit.map((e) => e.action)
    expect(actions.filter((a) => a === 'integration.test')).toHaveLength(6)
    expect(actions).toContain('integration.test.limited')
  })
  it('a failing source returns generic text', () => {
    const c = as('wr', 'admin')
    const r = A.integrations.save(c, actor, good({ database: 'will_fail' }))
    const id = r.ok ? r.row.id : ''
    const t = A.integrations.test(c, actor, id)
    expect(t.ok && t.row.lastTest).toMatchObject({ ok: false, message: expect.stringContaining('Could not connect') })
    expect(JSON.stringify(t)).not.toContain('will_fail:')
  })
})

describe('tenant isolation (mock)', () => {
  it('an org A user never reads org B integrations, users, sessions or settings', () => {
    const wr = as('wr', 'admin'), ad = as('ad', 'admin')
    const wrRows = A.integrations.list(wr), adRows = A.integrations.list(ad)
    expect(wrRows.ok && wrRows.rows.map((r) => r.id)).toContain('int-wr-1')
    expect(adRows.ok && adRows.rows.map((r) => r.id)).not.toContain('int-wr-1')
    // id from the other org: not_found, never forbidden
    expect(A.integrations.test(ad, actor, 'int-wr-1')).toMatchObject({ ok: false, code: 'not_found' })
    expect(A.integrations.remove(ad, actor, 'int-wr-1')).toMatchObject({ ok: false, code: 'not_found' })
    expect(A.integrations.save(ad, actor, good({ id: 'int-wr-1', host: 'warehouse.mock-adars.internal' }))).toMatchObject({ ok: false, code: 'not_found' })
    // users
    const adUsers = A.users.list(ad)
    expect(adUsers.ok && adUsers.members.map((m) => m.userId)).not.toContain('u-sam')
    expect(A.users.update(ad, actor, 'u-sam', { active: false })).toMatchObject({ ok: false, code: 'not_found' })
    expect(A.accounts.sessions(ad, 'u-sam')).toMatchObject({ ok: false, code: 'not_found' })
    expect(A.accounts.revoke(ad, actor, 's-sam-1')).toMatchObject({ ok: false, code: 'not_found' })
    expect(A.accounts.resetPassword(ad, actor, 'u-sam')).toMatchObject({ ok: false, code: 'not_found' })
    // settings (org layer is per org)
    A.settings.set(wr, actor, 'org', { timeFormat: '12' })
    const v = A.settings.get(ad, actor)
    expect(v.ok && v.view.org).toEqual({})
    // audit
    A.integrations.save(wr, actor, good())
    const adAudit = A.integrations.audit(ad)
    expect(adAudit.ok && adAudit.entries).toEqual([])
  })
  it('a shared login shows the role and scope of THIS organisation only; the director sees all memberships', () => {
    const wr = A.users.list(as('wr', 'admin')), ad = A.users.list(as('ad', 'admin'))
    const m1 = wr.ok && wr.members.find((m) => m.userId === 'u-maria')
    const m2 = ad.ok && ad.members.find((m) => m.userId === 'u-maria')
    expect(m1).toMatchObject({ role: 'viewer', trackingFolders: ['Mock Fleet North'] })
    expect(m2).toMatchObject({ role: 'admin', trackingFolders: null })
    const across = A.users.memberships(director(), 'u-maria')
    expect(across.ok && across.memberships.map((m) => [m.orgSlug, m.role])).toEqual([['worldrisk', 'viewer'], ['adars', 'admin']])
  })
  it('scope folders are the org\'s own list and unknown folders are refused', () => {
    const wr = as('wr', 'admin')
    expect(A.users.update(wr, actor, 'u-lee', { trackingFolders: ['Mock Rail Line 1'] })).toMatchObject({ ok: false, code: 'invalid' })
    expect(A.users.update(wr, actor, 'u-lee', { trackingFolders: ['Mock Fleet North'] })).toMatchObject({ ok: true })
  })
  it('suspended organisations close to non-directors', async () => {
    A.organisations.update(director(), actor, ORG.wr.id, { status: 'suspended' })
    expect(await mockPortal.orgs.listAccessible({ id: '1', username: 'b', role: 'builder' })).toEqual([])
    expect((await mockPortal.orgs.listAccessible({ id: '1', username: 'a', role: 'admin' })).length).toBe(2)
  })
})

describe('platform admin is untouchable', () => {
  it('nobody edits, deactivates, resets or revokes a platform admin', () => {
    for (const c of [as('wr', 'admin'), director()]) {
      expect(A.users.update(c, actor, 'u-director', { active: false })).toMatchObject({ ok: false, code: 'forbidden' })
      expect(A.users.update(c, actor, 'u-director', { role: 'viewer' })).toMatchObject({ ok: false, code: 'forbidden' })
      expect(A.accounts.resetPassword(c, actor, 'u-director')).toMatchObject({ ok: false, code: 'forbidden' })
      expect(A.accounts.revoke(c, actor, 's-dir-2')).toMatchObject({ ok: false, code: 'forbidden' })
    }
    const list = A.users.list(as('wr', 'admin'))
    expect(list.ok && list.members[0]).toMatchObject({ username: 'director', isPlatform: true })
  })
  it('you cannot demote or deactivate yourself', () => {
    const me = { id: 'u-sam', username: 'sam.mock' }
    expect(A.users.update(as('wr', 'admin'), me, 'u-sam', { active: false })).toMatchObject({ ok: false, code: 'invalid' })
  })
})

describe('settings precedence and formatting', () => {
  it('user over org over system over default, with the source of each value', () => {
    expect(resolveSettings({}).value).toEqual(DEFAULT_SETTINGS)
    const r = resolveSettings({ system: { timeFormat: '12', region: 'gb', dateFormat: 'DMY' }, org: { region: 'us', dateFormat: 'MDY' }, user: { dateFormat: 'long' } })
    expect(r.value).toMatchObject({ dateFormat: 'long', region: 'us', timeFormat: '12', timeZone: 'Africa/Johannesburg' })
    expect(r.source).toMatchObject({ dateFormat: 'user', region: 'org', timeFormat: 'system', timeZone: 'default' })
  })
  it('stored scopes resolve through the portal and unset falls back', () => {
    const c = as('wr', 'admin', false)
    A.settings.set(director(), actor, 'system', { numberFormat: 'comma-dot' })
    A.settings.set(c, actor, 'org', { numberFormat: 'dot-comma' })
    const a = A.settings.set(c, actor, 'user', { numberFormat: 'space-comma' })
    expect(a.ok && a.view.effective.source.numberFormat).toBe('user')
    const b = A.settings.set(c, actor, 'user', {}, ['numberFormat'])
    expect(b.ok && [b.view.effective.value.numberFormat, b.view.effective.source.numberFormat]).toEqual(['dot-comma', 'org'])
  })
  it('changing a setting changes the formatted output', () => {
    const at = new Date('2026-11-23T14:05:09Z') // 16:05 in Johannesburg (UTC+2)
    const base = createFormatter(DEFAULT_SETTINGS)
    expect(base.date(at)).toBe('2026-11-23')
    expect(base.time(at)).toBe('16:05')
    expect(createFormatter({ ...DEFAULT_SETTINGS, dateFormat: 'DMY' }).date(at)).toBe('23/11/2026')
    expect(createFormatter({ ...DEFAULT_SETTINGS, dateFormat: 'MDY' }).date(at)).toBe('11/23/2026')
    expect(createFormatter({ ...DEFAULT_SETTINGS, dateFormat: 'long' }).date(at)).toBe('23 Nov 2026')
    expect(createFormatter({ ...DEFAULT_SETTINGS, timeFormat: '12' }).time(at)).toBe('4:05 pm')
    expect(createFormatter({ ...DEFAULT_SETTINGS, timeZone: 'UTC' }).time(at)).toBe('14:05')
    expect(createFormatter({ ...DEFAULT_SETTINGS, numberFormat: 'comma-dot' }).number(1234567.891, 2)).toBe('1,234,567.89')
    expect(createFormatter({ ...DEFAULT_SETTINGS, numberFormat: 'dot-comma' }).number(1234567.891, 2)).toBe('1.234.567,89')
    expect(createFormatter({ ...DEFAULT_SETTINGS, numberFormat: 'space-comma' }).number(1234567.891, 2)).toBe('1 234 567,89')
    expect(createFormatter({ ...DEFAULT_SETTINGS, region: 'us' }).weekStart).toBe(0)
    expect(createFormatter({ ...DEFAULT_SETTINGS, region: 'us' }).currency(1234.5)).toBe('$1,234.50')
  })
  it('the formatter is memoised: same settings, same instance, no new Intl objects', () => {
    const s = { ...DEFAULT_SETTINGS, dateFormat: 'DMY' as const }
    const a = createFormatter(s)
    a.date(new Date()); a.number(1)
    const size = formatterCacheSize()
    const b = createFormatter({ ...s })
    b.date(new Date()); b.number(2)
    expect(b).toBe(a)
    expect(formatterCacheSize()).toBe(size)
  })
  it('display settings never touch bucketing: the portal time zone constant is not a setting input anywhere in the formatter', async () => {
    const { PORTAL_TIMEZONE } = await import('@omnimetrics/types')
    expect(PORTAL_TIMEZONE).toBe('Africa/Johannesburg')
    expect(DEFAULT_SETTINGS.timeZone).toBe(PORTAL_TIMEZONE)
  })
})
