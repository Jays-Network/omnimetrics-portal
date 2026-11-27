import { randomUUID } from 'node:crypto'
import {
  CREDENTIALS_REQUIRED, CREDENTIALS_REQUIRED_ON_MOVE, HOST_LISTED, HOST_NOT_ALLOWED, HOST_RESERVED, INTEGRATION_NAME_TAKEN, MANAGED_NO_DELETE, MANAGED_NO_EDIT,
  hostInUse, portOutOfRange, testsLimited,
} from '@/lib/admin/integration-messages'
import { HostInputSchema, IntegrationInputSchema, type AllowedHost, type AuditEntry, type HostInput, type IntegrationInput, type IntegrationRow, type Result } from '@/lib/admin/types'
import { writeAudit } from '@/lib/audit'
import { covering, entriesFor } from '@/lib/integrations/allowlist'
import { encrypt, keyRing, type Sealed } from '@/lib/integrations/crypto'
import { reservedHost } from '@/lib/integrations/target-guard'
import { testConnection, type Category, type TestOutcome } from '@/lib/integrations/test-connection'
import { MAX_ORG_TESTS_PER_MINUTE, MAX_TESTS_PER_MINUTE, integrationTestKey, orgTestLimit, withRateLimit } from '@/lib/rate-limit'
import type { Actor } from '../mock/admin' // type only
import { withOrg, withPlatform } from './context'
import { assertOrgCtx, type OrgCtx } from './org'
import { inAppTx, isUuid, type Tx } from './tx'

// app_integrations and app_allowed_hosts (007, 010). cred_ciphertext and cred_nonce are WRITTEN here and never
// selected (portal_app has no grant). Nothing of a credential, the key id included, leaves this module.

const gone: Result<never> = { ok: false, code: 'not_found', error: 'Not found' }
const forbid: Result<never> = { ok: false, code: 'forbidden', error: 'Not allowed.' }
const invalid = (error: string): Result<never> => ({ ok: false, code: 'invalid', error })

/** Who may call anything here (builders and viewers: not_found) and whether the server is set up for it. */
function refusal(ctx: OrgCtx): Result<never> | null {
  assertOrgCtx(ctx)
  if (!ctx.capabilities.includes('integrations.manage')) return gone
  try {
    keyRing()
  } catch {
    console.error('integrations: disabled, INTEGRATION_KEYS is missing or malformed (expected "id:base64,..." with 32-byte keys)')
    return { ok: false, code: 'forbidden', error: 'Integrations are not configured on this server.' }
  }
  return null
}

const FAILURE: Record<Category, string> = {
  dns: 'The host name could not be resolved.',
  refused: 'The server refused the connection.',
  timeout: 'The connection timed out.',
  tls: 'A secure connection could not be established.',
  auth: 'The server refused the sign-in.',
  not_allowed: 'This connection is not allowed (host, port or status).',
  unsupported: 'Testing this kind of connection is not supported.',
  other: 'Could not connect. Check the database and credentials.',
}
const message = (o: TestOutcome) => (o.ok ? `Connected${o.serverVersion ? ` (PostgreSQL ${o.serverVersion})` : ''}.` : (FAILURE[o.category] ?? FAILURE.other))

interface Row {
  id: string; name: string; kind: string; host: string; port: number; database: string; relation_allowlist: string[]; ssl_mode: string
  credential_source: string; has_credentials: boolean; status: string; rotated_at: Date | null
}
type LastTest = IntegrationRow['lastTest']

const isManaged = (r: { credential_source: string }) => r.credential_source.startsWith('env:')

function publicRow(r: Row, lastTest: LastTest): IntegrationRow {
  const managed = isManaged(r)
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as IntegrationRow['kind'],
    host: r.host,
    port: r.port,
    database: r.database,
    relations: r.relation_allowlist,
    sslMode: r.ssl_mode as IntegrationRow['sslMode'],
    status: managed ? 'managed' : !lastTest ? 'untested' : lastTest.ok ? 'ok' : 'failed',
    managed,
    hasCredentials: r.has_credentials,
    keyId: null, // never sent
    rotatedAt: r.rotated_at?.toISOString() ?? null,
    lastTest,
    usedBy: 0, // dashboards cannot reference an integration until datasets exist
  }
}

const select = (tx: Tx, orgId: string, id: string | null) => tx<Row[]>`
  SELECT id, name, kind, host, port, database, relation_allowlist, ssl_mode, credential_source, has_credentials, status, rotated_at
    FROM app_integrations
   WHERE org_id = ${orgId} AND (${id}::uuid IS NULL OR id = ${id}::uuid)
   ORDER BY (credential_source = 'stored'), created_at, name`

/** There is no column for the last test (007): it is the newest integration.test audit row of each. */
async function lastTests(tx: Tx, orgId: string): Promise<Map<string, LastTest>> {
  const rows = await tx<{ target_id: string; detail: TestOutcome; created_at: Date }[]>`
    SELECT DISTINCT ON (target_id) target_id, detail, created_at
      FROM app_audit_log
     WHERE org_id = ${orgId} AND action = 'integration.test' AND target_type = 'integration'
     ORDER BY target_id, id DESC`
  return new Map(rows.map((r) => [r.target_id, { ok: r.detail.ok === true, at: r.created_at.toISOString(), message: message(r.detail) }]))
}

async function load(tx: Tx, ctx: OrgCtx, id: string): Promise<IntegrationRow | undefined> {
  const [row] = await select(tx, ctx.org.id, id)
  return row && publicRow(row, (await lastTests(tx, ctx.org.id)).get(row.id) ?? null)
}

export async function list(ctx: OrgCtx): Promise<Result<{ rows: IntegrationRow[] }>> {
  const no = refusal(ctx)
  if (no) return no
  return withOrg(ctx, async (tx) => {
    const tests = await lastTests(tx, ctx.org.id)
    return { ok: true as const, rows: (await select(tx, ctx.org.id, null)).map((r) => publicRow(r, tests.get(r.id) ?? null)) }
  })
}

/** Create (no id) or update. credential_source is never taken from the input: the app only makes 'stored' rows. */
export async function save(ctx: OrgCtx, actor: Actor, input: IntegrationInput): Promise<Result<{ row: IntegrationRow }>> {
  const no = refusal(ctx)
  if (no) return no
  const parsed = IntegrationInputSchema.safeParse(input)
  if (!parsed.success) return invalid('Check the connection details.')
  const v = parsed.data
  if (v.id !== undefined && !isUuid(v.id)) return gone
  const password = v.credentials?.trim() ? v.credentials : undefined
  const username = v.username?.trim() || undefined
  if (password && !username) return invalid('Enter the database user for these credentials.')
  if (!password && username) return invalid('Enter the password as well, or leave both empty.')
  const credential = password && username ? { username, password } : undefined

  try {
    return await withOrg(ctx, async (tx) => {
      // Serialises writes per organisation: the name check and the "has it moved" check cannot go stale.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`app_integrations:${ctx.org.id}`}, 0))`
      let current: Row | undefined
      if (v.id) {
        ;[current] = await select(tx, ctx.org.id, v.id)
        if (!current) return gone
        if (isManaged(current)) return invalid(MANAGED_NO_EDIT)
      }
      // The app only writes 'stored' rows (managed ones were refused above), and those never reach this machine.
      if (reservedHost(v.host)) return invalid(HOST_RESERVED)
      const entries = await entriesFor(tx, ctx.org.id, v.host)
      if (!entries.length) return invalid(HOST_NOT_ALLOWED)
      const entry = covering(entries, v.port)
      if (!entry) return invalid(portOutOfRange(v.port, entries[0]!.port_min, entries[0]!.port_max))
      const clash = await tx`
        SELECT 1 FROM app_integrations
         WHERE org_id = ${ctx.org.id} AND lower(name) = lower(${v.name}) AND id IS DISTINCT FROM ${v.id ?? null}::uuid`
      if (clash.length) return invalid(INTEGRATION_NAME_TAKEN)
      const moved = current && (current.host.toLowerCase() !== entry.host || current.port !== v.port || current.database !== v.database || current.ssl_mode !== v.sslMode)
      if (!current && !credential) return invalid(CREDENTIALS_REQUIRED)
      if (moved && !credential) return invalid(CREDENTIALS_REQUIRED_ON_MOVE)

      // The database's own id (not the request's spelling of it) is what the ciphertext is bound to.
      const id = current?.id ?? randomUUID()
      const sealed: Sealed | undefined = credential && encrypt(credential, { orgId: ctx.org.id, integrationId: id })
      if (!current) {
        await tx`
          INSERT INTO app_integrations
                 (id, org_id, kind, name, host, port, database, ssl_mode, relation_allowlist, credential_source,
                  cred_ciphertext, cred_nonce, cred_key_id, rotated_at, created_by)
          VALUES (${id}, ${ctx.org.id}, ${v.kind}, ${v.name}, ${entry.host}, ${v.port}, ${v.database}, ${v.sslMode}, ${tx.array(v.relations, 1009)}, 'stored',
                  ${sealed!.ciphertext}, ${sealed!.nonce}, ${sealed!.keyId}, now(), ${ctx.userId})`
      } else {
        await tx`
          UPDATE app_integrations
             SET name = ${v.name}, host = ${entry.host}, port = ${v.port}, database = ${v.database}, ssl_mode = ${v.sslMode},
                 relation_allowlist = ${tx.array(v.relations, 1009)}, updated_at = now()
           WHERE id = ${id} AND org_id = ${ctx.org.id} AND credential_source = 'stored'`
        if (sealed) {
          await tx`
            UPDATE app_integrations
               SET cred_ciphertext = ${sealed.ciphertext}, cred_nonce = ${sealed.nonce}, cred_key_id = ${sealed.keyId}, rotated_at = now()
             WHERE id = ${id} AND org_id = ${ctx.org.id} AND credential_source = 'stored'`
        }
      }
      const before: Partial<Record<string, unknown>> = current
        ? { name: current.name, host: current.host, port: current.port, database: current.database, sslMode: current.ssl_mode, relations: current.relation_allowlist }
        : {}
      const after = { name: v.name, host: entry.host, port: v.port, database: v.database, sslMode: v.sslMode, relations: v.relations }
      const fields = Object.entries(after).filter(([k, x]) => JSON.stringify(before[k]) !== JSON.stringify(x)).map(([k]) => k)
      await writeAudit({ ctx, action: current ? 'integration.update' : 'integration.create', targetType: 'integration', targetId: id, detail: { fields, credentialReplaced: !!sealed }, ip: actor.ip }, tx)
      return { ok: true as const, row: (await load(tx, ctx, id))! }
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === '23505') return invalid(INTEGRATION_NAME_TAKEN)
    // A driver error carries the statement's parameters: nothing of it is passed on.
    throw new Error(`integrations: save failed (${/^[0-9A-Z]{5}$/.test(code ?? '') ? code : 'unexpected'})`)
  }
}

/** Datasets over it go too (007: ON DELETE CASCADE), as the mock deletes an integration that is in use. */
export async function remove(ctx: OrgCtx, actor: Actor, id: string): Promise<Result> {
  const no = refusal(ctx)
  if (no) return no
  if (!isUuid(id)) return gone
  return withOrg(ctx, async (tx) => {
    const [current] = await select(tx, ctx.org.id, id)
    if (!current) return gone
    if (isManaged(current)) return invalid(MANAGED_NO_DELETE)
    const done = await tx`DELETE FROM app_integrations WHERE id = ${id} AND org_id = ${ctx.org.id} AND credential_source = 'stored' RETURNING id`
    if (!done.length) return gone
    await writeAudit({ ctx, action: 'integration.delete', targetType: 'integration', targetId: current.id, detail: { fields: [], credentialReplaced: false, name: current.name }, ip: actor.ip }, tx)
    return { ok: true as const }
  })
}

export async function test(ctx: OrgCtx, actor: Actor, id: string): Promise<Result<{ row: IntegrationRow }>> {
  const no = refusal(ctx)
  if (no) return no
  if (!isUuid(id)) return gone
  const row = await withOrg(ctx, (tx) => load(tx, ctx, id))
  if (!row) return gone
  const audit = (action: string, detail: Record<string, unknown>) => writeAudit({ ctx, action, targetType: 'integration', targetId: row.id, detail, ip: actor.ip })

  const tried = await withRateLimit(integrationTestKey(ctx.org.id, row.id), () => testConnection(ctx, row.id), Date.now, orgTestLimit(ctx.org.id))
  if (tried.limited) {
    await audit('integration.test.limited', {})
    const error = tried.shared ? testsLimited(tried.retryAfter, MAX_ORG_TESTS_PER_MINUTE, ' for the organisation') : testsLimited(tried.retryAfter, MAX_TESTS_PER_MINUTE)
    return { ok: false, code: 'rate_limited', error }
  }
  const outcome = tried.result
  if (!outcome) return gone
  await audit('integration.test', { ...outcome }) // best effort: the answer does not depend on it
  const lastTest = { ok: outcome.ok, at: new Date().toISOString(), message: message(outcome) }
  return { ok: true, row: { ...row, lastTest, status: row.managed ? 'managed' : outcome.ok ? 'ok' : 'failed' } }
}

/** This organisation's latest audit entries. */
export async function audit(ctx: OrgCtx): Promise<Result<{ entries: AuditEntry[] }>> {
  const no = refusal(ctx)
  if (no) return no
  const rows = await withOrg(ctx, (tx) => tx<{ id: string; at: Date; actor: string | null; action: string; target_type: string | null; target_id: string | null; detail: unknown }[]>`
    SELECT a.id::text AS id, a.created_at AS at, u.username AS actor, a.action, a.target_type, a.target_id, a.detail
      FROM app_audit_log a
      LEFT JOIN app_users u ON u.id = a.user_id
     WHERE a.org_id = ${ctx.org.id}
     ORDER BY a.id DESC
     LIMIT 30`)
  const entries = rows.map((r) => ({ id: r.id, at: r.at.toISOString(), orgId: ctx.org.id, actor: r.actor ?? '', action: r.action, targetType: r.target_type ?? '', targetId: r.target_id ?? '', detail: JSON.stringify(r.detail ?? {}) }))
  return { ok: true, entries }
}

// ------------------------------------------------------------------ allowed hosts (read: tenant path; write: director, platform path)
interface HostRow { id: string; host: string; port_min: number; port_max: number }
const publicHost = (h: HostRow): AllowedHost => ({ id: h.id, host: h.host, portMin: h.port_min, portMax: h.port_max })

export async function listHosts(ctx: OrgCtx): Promise<Result<{ hosts: AllowedHost[] }>> {
  const no = refusal(ctx)
  if (no) return no
  const rows = await withOrg(ctx, (tx) => tx<HostRow[]>`
    SELECT id, host, port_min, port_max FROM app_allowed_hosts
     WHERE org_id IS NULL OR org_id = ${ctx.org.id}
     ORDER BY host, port_min`)
  return { ok: true, hosts: rows.map(publicHost) }
}

/** Always a global entry (the input has no organisation), stored in lower case. */
export async function addHost(ctx: OrgCtx, actor: Actor, input: HostInput): Promise<Result<{ host: AllowedHost }>> {
  const no = refusal(ctx)
  if (no) return no
  if (!ctx.capabilities.includes('hosts.manage')) return forbid
  const parsed = HostInputSchema.safeParse(input)
  if (!parsed.success) return invalid('Check the host and port range.')
  const { portMin, portMax } = parsed.data
  const host = parsed.data.host.toLowerCase()
  try {
    return await withPlatform(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('app_allowed_hosts', 0))`
      const listed = await tx`SELECT 1 FROM app_allowed_hosts WHERE org_id IS NULL AND host = ${host}`
      if (listed.length) return invalid(HOST_LISTED)
      const [row] = await tx<HostRow[]>`
        INSERT INTO app_allowed_hosts (org_id, host, port_min, port_max, added_by)
        VALUES (NULL, ${host}, ${portMin}, ${portMax}, ${ctx.userId})
        RETURNING id, host, port_min, port_max`
      await writeAudit({ userId: ctx.userId, orgId: null, action: 'host.add', targetType: 'host', targetId: row!.id, detail: { host, portMin, portMax }, ip: actor.ip }, tx)
      return { ok: true as const, host: publicHost(row!) }
    }, ctx.userId)
  } catch (error) {
    if ((error as { code?: string }).code === '23514') return invalid('That is not a valid host name.')
    throw error
  }
}

/**
 * Refused while a stored integration uses the host. The platform role cannot read app_integrations (010), so the
 * director's check counts organisation by organisation over the tenant path; only the number is used.
 */
export async function removeHost(ctx: OrgCtx, actor: Actor, id: string): Promise<Result> {
  const no = refusal(ctx)
  if (no) return no
  if (!ctx.capabilities.includes('hosts.manage')) return forbid
  if (!isUuid(id)) return gone
  const found = await withPlatform(async (tx) => {
    const [entry] = await tx<{ host: string; org_id: string | null }[]>`SELECT host, org_id FROM app_allowed_hosts WHERE id = ${id}`
    if (!entry) return null
    const orgs = entry.org_id ? [{ id: entry.org_id }] : await tx<{ id: string }[]>`SELECT id FROM app_orgs`
    return { host: entry.host, orgIds: orgs.map((o) => o.id) }
  }, ctx.userId)
  if (!found) return gone
  let used = 0
  for (const orgId of found.orgIds) {
    // Not withOrg: this is the director looking at every organisation, which no single ctx covers.
    const [row] = await inAppTx(orgId, ctx.userId, (tx) => tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM app_integrations
       WHERE org_id = ${orgId} AND credential_source = 'stored' AND lower(host) = ${found.host}`)
    used += row?.n ?? 0
  }
  if (used > 0) return invalid(hostInUse(used))
  return withPlatform(async (tx) => {
    const done = await tx`DELETE FROM app_allowed_hosts WHERE id = ${id} RETURNING id`
    if (!done.length) return gone
    await writeAudit({ userId: ctx.userId, orgId: null, action: 'host.remove', targetType: 'host', targetId: id, detail: { host: found.host }, ip: actor.ip }, tx)
    return { ok: true as const }
  }, ctx.userId)
}
