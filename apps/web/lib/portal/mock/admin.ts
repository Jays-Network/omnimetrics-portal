import type { Capability, OrgAccess, Role } from '@omnimetrics/types'
import { LAST_ADMIN, NAME_UNAVAILABLE, OWN_MEMBERSHIP, OWN_RESET, SHARED_LOGIN, WRONG_CURRENT, newOneTimePassword, passwordProblem } from '@/lib/admin/password'
import type { AllowedHost, AuditEntry, HostInput, IntegrationInput, IntegrationRow, MemberRow, Membership, OrgProfile, Result, SessionRow } from '@/lib/admin/types'
import { redact } from '@/lib/admin/redact'
import { PartialSettingsSchema, SETTING_KEYS, resolveSettings, type PartialSettings, type Resolved, type Scope, type SettingKey } from '@/lib/settings/model'
import { LOCAL_ROW, FOLDERS, clock, db, nextId, type MMember } from './admin-store'

// MOCK implementation of the M4 admin surface. Every function takes the verified OrgAccess first and checks
// the capability itself (the UI and the routes are not the boundary). Other organisations' ids look like
// "not_found", never "forbidden" (existence is not confirmed). Secrets never leave the vault (redaction + tests).
type Ctx = Pick<OrgAccess, 'org' | 'role' | 'isPlatform' | 'capabilities'>
export interface Actor { id: string; username: string; ip?: string | null }

const forbid = (): Result<never> => ({ ok: false, code: 'forbidden', error: 'Not allowed.' })
const notFound = (what = 'Not found'): Result<never> => ({ ok: false, code: 'not_found', error: what })
const invalid = (error: string): Result<never> => ({ ok: false, code: 'invalid', error })
const can = (c: Ctx, cap: Capability) => c.capabilities.includes(cap)
const nowIso = () => new Date(clock.now()).toISOString()

/** The organisation an audit row of a platform action belongs to. */
const orgOf = (id: string): Ctx => ({ org: { id } as Ctx['org'], role: 'admin', isPlatform: true, capabilities: [] })

function audit(c: Ctx | null, actor: Actor, action: string, targetType: string, targetId: string, detail: Record<string, unknown> = {}) {
  const e: AuditEntry = { id: nextId('a'), at: nowIso(), orgId: c?.org.id ?? null, actor: actor.username, action, targetType, targetId, detail: JSON.stringify(redact(detail)) }
  db().audit.push(e)
}

// ------------------------------------------------------------------ integrations
const publicRow = (r: IntegrationRow): IntegrationRow => ({ ...r, relations: [...r.relations], lastTest: r.lastTest ? { ...r.lastTest } : null }) // no vault access here
const orgIntegrations = (c: Ctx) => db().integrations.get(c.org.id) ?? []

export const integrations = {
  list(c: Ctx): Result<{ rows: IntegrationRow[] }> {
    if (!can(c, 'integrations.manage')) return forbid()
    return { ok: true, rows: orgIntegrations(c).map(publicRow) }
  },
  save(c: Ctx, actor: Actor, input: IntegrationInput): Result<{ row: IntegrationRow }> {
    if (!can(c, 'integrations.manage')) return forbid()
    const list = db().integrations.get(c.org.id) ?? []
    db().integrations.set(c.org.id, list)
    // Host must be an allowlisted entry and the port inside its range. Free text is refused.
    const entry = db().hosts.find((h) => h.host.toLowerCase() === input.host.toLowerCase())
    if (!entry) return invalid('That host is not on the allowed list. Ask the director to add it.')
    if (input.port < entry.portMin || input.port > entry.portMax) return invalid(`Port ${input.port} is outside the allowed range ${entry.portMin} to ${entry.portMax} for this host.`)
    if (list.some((r) => r.name.toLowerCase() === input.name.toLowerCase() && r.id !== input.id)) return invalid('Another integration already uses that name.')
    const secret = input.credentials?.trim() ? input.credentials : undefined
    let row: IntegrationRow
    if (input.id) {
      const cur = list.find((r) => r.id === input.id)
      if (!cur) return notFound() // an id from another organisation lands here too
      if (cur.managed) return invalid('The managed local database cannot be edited.')
      row = { ...cur, name: input.name, host: entry.host, port: input.port, database: input.database, relations: input.relations, sslMode: input.sslMode }
      list[list.indexOf(cur)] = row
    } else {
      if (!secret) return invalid('Credentials are required for a new integration.')
      row = { id: nextId('int'), name: input.name, kind: 'postgres', host: entry.host, port: input.port, database: input.database, relations: input.relations, sslMode: input.sslMode, status: 'untested', managed: false, hasCredentials: false, keyId: null, rotatedAt: null, lastTest: null, usedBy: 0 }
      list.push(row)
    }
    if (secret) {
      db().vault.set(`${c.org.id}:${row.id}`, secret)
      Object.assign(row, { hasCredentials: true, keyId: 'k1', rotatedAt: nowIso() })
    }
    audit(c, actor, input.id ? 'integration.update' : 'integration.create', 'integration', row.id, { name: row.name, host: row.host, port: row.port, credentials: secret ? 'replaced' : 'kept', input })
    return { ok: true, row: publicRow(row) }
  },
  remove(c: Ctx, actor: Actor, id: string): Result {
    if (!can(c, 'integrations.manage')) return forbid()
    const list = orgIntegrations(c)
    const cur = list.find((r) => r.id === id)
    if (!cur) return notFound()
    if (cur.managed) return invalid('The managed local database cannot be deleted.')
    db().integrations.set(c.org.id, list.filter((r) => r !== cur))
    db().vault.delete(`${c.org.id}:${id}`)
    audit(c, actor, 'integration.delete', 'integration', id, { name: cur.name })
    return { ok: true }
  },
  /** Mock test: no network. 5 tests per minute per organisation and person. */
  test(c: Ctx, actor: Actor, id: string): Result<{ row: IntegrationRow }> {
    if (!can(c, 'integrations.manage')) return forbid()
    const cur = orgIntegrations(c).find((r) => r.id === id)
    if (!cur) return notFound()
    const key = `${c.org.id}:${actor.id}`
    const t = clock.now()
    const recent = (db().tests.get(key) ?? []).filter((x) => t - x < 60_000)
    if (recent.length >= 5) {
      const wait = Math.max(1, Math.ceil((60_000 - (t - recent[0]!)) / 1000))
      audit(c, actor, 'integration.test.limited', 'integration', id)
      return { ok: false, code: 'rate_limited', error: `Too many connection tests. Try again in ${wait} seconds (limit: 5 per minute).` }
    }
    db().tests.set(key, [...recent, t])
    const ok = cur.managed || (cur.hasCredentials && !/fail/i.test(cur.database))
    cur.lastTest = { ok, at: nowIso(), message: ok ? 'Connected (mock).' : 'Could not connect (mock). Check the host, port, database and credentials.' }
    if (!cur.managed) cur.status = ok ? 'ok' : 'failed'
    audit(c, actor, 'integration.test', 'integration', id, { ok })
    return { ok: true, row: publicRow(cur) }
  },
  audit(c: Ctx): Result<{ entries: AuditEntry[] }> {
    if (!can(c, 'integrations.manage')) return forbid()
    return { ok: true, entries: db().audit.filter((e) => e.orgId === c.org.id).slice(-30).reverse() }
  },
  hosts: {
    list(c: Ctx): Result<{ hosts: AllowedHost[] }> {
      if (!can(c, 'integrations.manage')) return forbid() // org admins read the list to pick from it
      return { ok: true, hosts: db().hosts.map((h) => ({ ...h })) }
    },
    add(c: Ctx, actor: Actor, h: HostInput): Result<{ host: AllowedHost }> {
      if (!can(c, 'hosts.manage')) return forbid() // director only
      if (db().hosts.some((x) => x.host.toLowerCase() === h.host.toLowerCase())) return invalid('That host is already on the list.')
      const row = { id: nextId('h'), ...h }
      db().hosts.push(row)
      audit(null, actor, 'host.add', 'host', row.id, { ...h })
      return { ok: true, host: row }
    },
    remove(c: Ctx, actor: Actor, id: string): Result {
      if (!can(c, 'hosts.manage')) return forbid()
      const h = db().hosts.find((x) => x.id === id)
      if (!h) return notFound()
      const used = [...db().integrations.values()].flat().filter((r) => !r.managed && r.host.toLowerCase() === h.host.toLowerCase()).length
      if (used > 0) return invalid(`In use by ${used} integration${used === 1 ? '' : 's'}. Remove those first.`)
      db().hosts = db().hosts.filter((x) => x !== h)
      audit(null, actor, 'host.remove', 'host', id, { host: h.host })
      return { ok: true }
    },
  },
}

// ------------------------------------------------------------------ admin: organisations, users, accounts
const counts = (orgId: string) => ({
  memberCount: db().members.filter((m) => m.orgId === orgId).length + 1, // + the director, who is in every organisation
  integrationCount: (db().integrations.get(orgId) ?? []).filter((r) => !r.managed).length + 1,
})
const profile = (o: ReturnType<typeof db>['orgs'][number]): OrgProfile => ({ id: o.id, slug: o.slug, name: o.name, status: o.status, dashboardCount: o.dashboards, ...counts(o.id) })

export const organisations = {
  /** Director: every organisation. Org admin: their own organisation only. */
  list(c: Ctx): Result<{ orgs: OrgProfile[] }> {
    if (!can(c, 'admin.view')) return forbid()
    const all = can(c, 'orgs.manage')
    return { ok: true, orgs: db().orgs.filter((o) => all || o.id === c.org.id).map(profile) }
  },
  create(c: Ctx, actor: Actor, name: string, wanted?: string): Result<{ org: OrgProfile }> {
    if (!can(c, 'orgs.manage')) return forbid()
    const n = name.trim()
    if (n.length < 2 || n.length > 60) return invalid('Name must be 2 to 60 characters.')
    if (db().orgs.some((o) => o.name.toLowerCase() === n.toLowerCase())) return invalid('An organisation with that name exists.')
    if (wanted !== undefined && !/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(wanted)) return invalid('Slug: lower-case letters, digits and hyphens (1 to 40), not starting or ending with a hyphen.')
    if (wanted !== undefined && db().orgs.some((o) => o.slug === wanted)) return invalid('That address (slug) is already used.')
    let slug = wanted ?? (n.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 36).replace(/^-|-$/g, '') || 'org')
    while (db().orgs.some((o) => o.slug === slug)) slug += '-2'
    const o = { id: nextId('mock-org'), slug, name: n, status: 'active' as const, dashboards: 0 }
    db().orgs.push(o)
    db().integrations.set(o.id, [{ ...LOCAL_ROW, lastTest: null }])
    audit(orgOf(o.id), actor, 'org.create', 'org', o.id, { name: n, slug })
    return { ok: true, org: profile(o) }
  },
  update(c: Ctx, actor: Actor, id: string, patch: { name?: string; status?: 'active' | 'suspended' | 'archived' }): Result<{ org: OrgProfile }> {
    if (!can(c, 'orgs.manage')) return forbid()
    const o = db().orgs.find((x) => x.id === id)
    if (!o) return notFound()
    if (patch.name !== undefined) {
      const n = patch.name.trim()
      if (n.length < 2 || n.length > 60) return invalid('Name must be 2 to 60 characters.')
      if (db().orgs.some((x) => x !== o && x.name.toLowerCase() === n.toLowerCase())) return invalid('An organisation with that name exists.')
      o.name = n
    }
    if (patch.status) o.status = patch.status
    audit(orgOf(id), actor, 'org.update', 'org', id, { ...(patch.name !== undefined ? { name: o.name } : {}), ...(patch.status ? { status: patch.status } : {}) })
    return { ok: true, org: profile(o) }
  },
}

const memberRow = (m: MMember): MemberRow => {
  const u = db().users.find((x) => x.id === m.userId)!
  return { userId: u.id, username: u.username, email: u.email, role: m.role, active: m.active, isPlatform: false, grantsSummary: m.grants, trackingFolders: m.role === 'admin' ? null : [...(m.folders ?? [])] }
}
const directorRow = (): MemberRow => {
  const u = db().users.find((x) => x.isPlatform)!
  return { userId: u.id, username: u.username, email: u.email, role: 'admin', active: true, isPlatform: true, grantsSummary: 'Platform admin: everything, every organisation', trackingFolders: null }
}
const orgMember = (c: Ctx, userId: string) => db().members.find((m) => m.orgId === c.org.id && m.userId === userId)
function newMember(orgId: string, userId: string, role: Role): MMember {
  const m: MMember = { userId, orgId, role, active: true, folders: role === 'admin' ? null : [], grants: role === 'admin' ? 'Everything in this organisation' : 'No grants yet' }
  db().members.push(m)
  return m
}

export const users = {
  /** Members of THIS organisation with the role and scope they hold HERE (a shared user shows only this org's). */
  list(c: Ctx): Result<{ members: MemberRow[]; folders: string[] }> {
    if (!can(c, 'admin.view')) return notFound()
    return { ok: true, members: [directorRow(), ...db().members.filter((m) => m.orgId === c.org.id).map(memberRow)], folders: [...(FOLDERS[c.org.slug] ?? [])] }
  },
  /** NEW logins only; the same answer for any taken username or email. */
  add(c: Ctx, actor: Actor, i: { username: string; email: string; role: Role }): Result<{ member: MemberRow; oneTimePassword: string }> {
    if (!can(c, 'admin.view')) return notFound()
    if (db().users.some((x) => x.username.toLowerCase() === i.username.toLowerCase() || x.email.toLowerCase() === i.email.toLowerCase())) return invalid(NAME_UNAVAILABLE)
    const u = { id: nextId('u'), username: i.username, email: i.email, isPlatform: false }
    db().users.push(u)
    const m = newMember(c.org.id, u.id, i.role)
    const oneTimePassword = newOneTimePassword()
    db().passwords.set(u.id, oneTimePassword)
    audit(c, actor, 'user.add', 'user', u.id, { username: u.username, role: i.role })
    return { ok: true, member: memberRow(m), oneTimePassword }
  },
  /** Director only: an existing login joins this organisation. */
  link(c: Ctx, actor: Actor, i: { username: string; role: Role }): Result {
    if (!can(c, 'admin.view')) return notFound()
    if (!can(c, 'orgs.manage')) return forbid()
    const u = db().users.find((x) => x.username === i.username)
    if (!u) return invalid('No active login has that username.')
    if (u.isPlatform) return invalid('A platform admin already has access to every organisation.')
    if (orgMember(c, u.id)) return invalid('That person is already a member of this organisation.')
    newMember(c.org.id, u.id, i.role)
    audit(c, actor, 'user.link', 'user', u.id, { username: u.username, role: i.role })
    return { ok: true }
  },
  update(c: Ctx, actor: Actor, userId: string, patch: { role?: Role; active?: boolean; trackingFolders?: string[] }): Result<{ member: MemberRow }> {
    if (!can(c, 'admin.view')) return notFound()
    if (db().users.find((u) => u.id === userId)?.isPlatform && orgMember(c, userId) === undefined) return forbid() // nobody edits a platform admin
    const m = orgMember(c, userId)
    if (!m) return notFound() // not a member here, or a user id from another organisation
    if (userId === actor.id) return invalid(OWN_MEMBERSHIP)
    const leaves = m.role === 'admin' && m.active && ((patch.role !== undefined && patch.role !== 'admin') || patch.active === false)
    if (leaves && !db().members.some((x) => x !== m && x.orgId === c.org.id && x.role === 'admin' && x.active)) return invalid(LAST_ADMIN)
    const known = FOLDERS[c.org.slug] ?? []
    if (patch.trackingFolders?.some((f) => !known.includes(f))) return invalid('Unknown tracking folder.')
    if (patch.role) { m.role = patch.role; if (patch.role === 'admin') m.folders = null; else if (m.folders === null) m.folders = [] }
    if (patch.active !== undefined) m.active = patch.active
    if (patch.trackingFolders && m.role !== 'admin') m.folders = [...new Set(patch.trackingFolders)]
    audit(c, actor, 'user.update', 'user', userId, { ...(patch.role ? { role: patch.role } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}), ...(patch.trackingFolders ? { trackingFolders: patch.trackingFolders } : {}) })
    return { ok: true, member: memberRow(m) }
  },
  /** Director only: one person across every organisation. */
  memberships(c: Ctx, userId: string): Result<{ username: string; memberships: Membership[] }> {
    if (!can(c, 'orgs.manage')) return forbid()
    const u = db().users.find((x) => x.id === userId)
    if (!u) return notFound()
    if (u.isPlatform) return { ok: true, username: u.username, memberships: db().orgs.map((o) => ({ orgSlug: o.slug, orgName: o.name, role: 'admin' as const, active: true, folders: null })) }
    return { ok: true, username: u.username, memberships: db().members.filter((m) => m.userId === userId).map((m) => { const o = db().orgs.find((x) => x.id === m.orgId)!; return { orgSlug: o.slug, orgName: o.name, role: m.role, active: m.active, folders: m.folders ? [...m.folders] : null } }) }
  },
}

export const accounts = {
  sessions(c: Ctx, userId: string): Result<{ sessions: SessionRow[] }> {
    if (!can(c, 'admin.view')) return forbid()
    if (!orgMember(c, userId) && !db().users.find((u) => u.id === userId)?.isPlatform) return notFound()
    return { ok: true, sessions: db().sessions.filter((s) => s.userId === userId).map((s) => ({ ...s })) }
  },
  revoke(c: Ctx, actor: Actor, sessionId: string): Result {
    if (!can(c, 'admin.view')) return forbid()
    const s = db().sessions.find((x) => x.id === sessionId)
    if (!s || (!orgMember(c, s.userId) && !db().users.find((u) => u.id === s.userId)?.isPlatform)) return notFound()
    if (db().users.find((u) => u.id === s.userId)?.isPlatform) return forbid() // a platform admin's sessions are not editable here
    if (s.current) return invalid('That is the current session.')
    db().sessions = db().sessions.filter((x) => x !== s)
    audit(c, actor, 'session.revoke', 'session', sessionId, { userId: s.userId })
    return { ok: true }
  },
  resetPassword(c: Ctx, actor: Actor, userId: string): Result<{ message: string; oneTimePassword: string }> {
    if (!can(c, 'admin.view')) return notFound()
    if (db().users.find((u) => u.id === userId)?.isPlatform) return forbid()
    if (!orgMember(c, userId)) return notFound()
    if (userId === actor.id) return invalid(OWN_RESET)
    if (!can(c, 'orgs.manage') && db().members.some((m) => m.userId === userId && m.orgId !== c.org.id)) return { ok: false, code: 'forbidden', error: SHARED_LOGIN }
    const oneTimePassword = newOneTimePassword()
    db().passwords.set(userId, oneTimePassword)
    audit(c, actor, 'user.password_reset', 'user', userId)
    return { ok: true, message: 'Mock: a one-time password was generated. It signs in nowhere.', oneTimePassword }
  },
}

/** My account: not organisation-scoped; always the signed-in person. */
export const account = {
  sessions(actor: Actor): Result<{ sessions: SessionRow[] }> {
    const key = myKey(actor)
    ensureMine(key)
    return { ok: true, sessions: db().sessions.filter((s) => s.userId === key).map((s) => ({ ...s })) }
  },
  revoke(actor: Actor, id: string): Result {
    const s = db().sessions.find((x) => x.id === id && x.userId === myKey(actor))
    if (!s) return notFound()
    if (s.current) return invalid('That is the session you are using. Sign out instead.')
    db().sessions = db().sessions.filter((x) => x !== s)
    audit(null, actor, 'session.revoke', 'session', id)
    return { ok: true }
  },
  /** "Sign out everywhere": own sessions only; the one in use stays. */
  revokeSessions(actor: Actor): Result<{ message: string; tokenVersion?: number }> {
    const key = myKey(actor)
    db().sessions = db().sessions.filter((s) => s.userId !== key || s.current)
    audit(null, actor, 'user.sessions_revoke', 'user', actor.id)
    return { ok: true, message: 'Mock: your other sessions were removed from the list. No real session was ended.' }
  },
  changePassword(actor: Actor, current: string, next: string): Result<{ message: string; tokenVersion?: number }> {
    const problem = passwordProblem(current, next)
    if (problem) return invalid(problem)
    // Only passwords the mock generated are known here; a real person's input is never kept.
    const known = db().passwords.get(actor.id)
    if (known !== undefined) {
      if (current !== known) return invalid(WRONG_CURRENT)
      db().passwords.set(actor.id, next)
    }
    audit(null, actor, 'user.password_change', 'user', actor.id) // never the password itself
    return { ok: true, message: 'Mock: nothing was changed. The real change arrives with the database in M5.' }
  },
}
const myKey = (a: Actor) => (a.username === 'director' || db().users.some((u) => u.id === a.id) ? a.id : `me-${a.id}`)
function ensureMine(key: string) {
  if (db().sessions.some((s) => s.userId === key)) return
  db().sessions.push(
    { id: `${key}-s1`, userId: key, device: 'This browser', ip: '10.0.0.x', startedAt: nowIso(), lastSeenAt: nowIso(), current: true },
    { id: `${key}-s2`, userId: key, device: 'Safari on iPhone', ip: '10.0.1.x', startedAt: new Date(clock.now() - 86_400_000 * 3).toISOString(), lastSeenAt: new Date(clock.now() - 3_600_000 * 8).toISOString(), current: false },
  )
}

// ------------------------------------------------------------------ settings
export interface SettingsView { system: PartialSettings; org: PartialSettings; user: PartialSettings; effective: Resolved; can: { system: boolean; org: boolean } }
const layers = (c: Ctx, actor: Actor) => ({ system: db().settings.system, org: db().settings.org.get(c.org.id) ?? {}, user: db().settings.user.get(actor.id) ?? {} })

export const settings = {
  get(c: Ctx, actor: Actor): Result<{ view: SettingsView }> {
    if (!can(c, 'settings.view')) return forbid()
    const l = layers(c, actor)
    return { ok: true, view: { ...structuredClone(l), effective: resolveSettings(l), can: { system: can(c, 'settings.system'), org: can(c, 'settings.org') } } }
  },
  set(c: Ctx, actor: Actor, scope: Scope, set: PartialSettings, unset: SettingKey[] = []): Result<{ view: SettingsView }> {
    const need: Capability = scope === 'system' ? 'settings.system' : scope === 'org' ? 'settings.org' : 'settings.view'
    if (!can(c, need)) return forbid()
    if (!PartialSettingsSchema.safeParse(set).success || unset.some((k) => !SETTING_KEYS.includes(k))) return invalid('Unknown setting or value.')
    const target: PartialSettings = scope === 'system' ? db().settings.system : scope === 'org' ? (db().settings.org.get(c.org.id) ?? (db().settings.org.set(c.org.id, {}), db().settings.org.get(c.org.id)!)) : (db().settings.user.get(actor.id) ?? (db().settings.user.set(actor.id, {}), db().settings.user.get(actor.id)!))
    Object.assign(target, set)
    for (const k of unset) delete target[k]
    if (scope !== 'user') audit(scope === 'system' ? null : c, actor, `settings.${scope}`, 'settings', scope, { set, unset })
    return settings.get(c, actor) as Result<{ view: SettingsView }>
  },
}

export const listOrgs = () => db().orgs
