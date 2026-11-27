import { isIP } from 'node:net'
import postgres from 'postgres'
import { withOrg } from '@/lib/portal/pg/context'
import type { OrgCtx } from '@/lib/portal/pg/org'
import type { StoredCredential } from '@/lib/admin/connectors'
import { covering, entriesFor } from './allowlist'
import { decrypt } from './crypto'
import { resolveTarget, systemResolve, type Resolve } from './target-guard'

/**
 * SERVER ONLY. "Test connection": SELECT 1 in a read-only transaction, and the server version.
 * The driver's own error is never returned or logged (it can echo hosts and users): only a category.
 */

export type Category = 'dns' | 'refused' | 'timeout' | 'tls' | 'auth' | 'not_allowed' | 'unsupported' | 'other'
export type TestOutcome = { ok: true; latencyMs: number; serverVersion?: string } | { ok: false; category: Category }
export interface Target extends StoredCredential {
  host: string; port: number; database: string; sslMode: string
  /** The already checked IP address to connect to. `host` stays the name the certificate is checked against. */
  address?: string
}
export type Connect = (target: Target) => Promise<{ serverVersion?: string }>

const CONNECT_SECONDS = 5
const STATEMENT_MS = 5_000
/** A server that accepts the connection and then goes silent. */
const DEADLINE_MS = 12_000

const coded = (code: string) => Object.assign(new Error(code), { code })

/** Exactly what ssl_mode says. postgres.js never falls back to plaintext for any value used here. */
function tlsFor(sslMode: string, host: string, pinned: boolean) {
  // When the driver is handed an address it would send no server name: set the configured one (never an IP).
  const name = pinned && !isIP(host) ? { servername: host } : {}
  if (sslMode === 'disable') return false
  // encrypted, certificate not checked (as libpq)
  if (sslMode === 'require') return 'servername' in name ? { rejectUnauthorized: false, ...name } : ('require' as const)
  // `host` is what the certificate is checked against; without it an IP address would be checked as "localhost".
  if (sslMode === 'verify-full') return { rejectUnauthorized: true, host, ...name }
  if (sslMode === 'verify-ca') return { rejectUnauthorized: true, host, ...name, checkServerIdentity: () => undefined }
  throw coded('SSL_MODE')
}

export function connectionOptions(t: Target) {
  // postgres.js reads "a:b,c" as host lists and "/..." as a socket path, and takes PGPASSWORD for an empty one.
  if (/[:,/\s]/.test(t.host) || !t.host) throw coded('HOST_FORM')
  if (!t.username || !t.password || !t.database) throw coded('INCOMPLETE')
  return {
    // As lists, the driver does not split an IPv6 address on its colons. An address means no second DNS lookup.
    host: t.address ? [t.address] : t.host,
    port: t.address ? [t.port] : t.port,
    database: t.database,
    username: t.username,
    password: t.password,
    ssl: tlsFor(t.sslMode, t.host, !!t.address),
    sslnegotiation: null,
    max: 1,
    connect_timeout: CONNECT_SECONDS,
    idle_timeout: 1,
    prepare: false,
    fetch_types: false,
    onnotice: () => {},
    connection: { application_name: 'omnimetrics-connection-test', statement_timeout: STATEMENT_MS },
  }
}

export const connectPostgres: Connect = async (target) => {
  // postgres.js accepts host and port as lists (its parseOptions); its types only name the single form.
  const sql = postgres(connectionOptions(target) as postgres.Options<Record<string, never>>)
  let timer: NodeJS.Timeout | undefined
  try {
    const run = sql.begin('read only', async (tx) => {
      await tx`SELECT 1`
    })
    run.catch(() => {}) // if the deadline wins, the late rejection is expected
    await Promise.race([run, new Promise((_, reject) => (timer = setTimeout(() => reject(coded('CONNECT_TIMEOUT')), DEADLINE_MS)))])
    const version: unknown = sql.parameters.server_version // reported by the server at startup: no extra query
    return { serverVersion: typeof version === 'string' ? version : undefined }
  } finally {
    clearTimeout(timer)
    await sql.end({ timeout: 1 }).catch(() => {})
  }
}

/** Replaceable in tests (no network). */
export const driver: { connect: Connect; resolve: Resolve } = { connect: connectPostgres, resolve: systemResolve }

/** From the error CODE only; messages are never read. */
export function categorise(error: unknown, sslMode: string): Category {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns'
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'refused'
  if (code === 'CONNECT_TIMEOUT' || code === 'ETIMEDOUT' || code === '57014') return 'timeout'
  if (code === '28P01' || code === '28000' || code === 'SASL_SIGNATURE_MISMATCH') return 'auth'
  if (/^ERR_(TLS|SSL)|CERT|SELF_SIGNED|UNABLE_TO_|^EPROTO$/.test(code)) return 'tls'
  // A server without TLS drops the connection when the handshake starts.
  if (sslMode !== 'disable' && (code === 'ECONNRESET' || code === 'CONNECTION_CLOSED')) return 'tls'
  if (code === 'HOST_FORM') return 'not_allowed'
  return 'other'
}

export async function probe(target: Target, connect: Connect = driver.connect): Promise<TestOutcome> {
  const started = Date.now()
  try {
    const { serverVersion } = await connect(target)
    // The server chooses this string: keep a version number and nothing else.
    const version = serverVersion?.match(/^\d{1,3}(\.\d{1,3}){0,2}/)?.[0]
    return { ok: true, latencyMs: Date.now() - started, ...(version ? { serverVersion: version } : {}) }
  } catch (error) {
    return { ok: false, category: categorise(error, target.sslMode) }
  }
}

/**
 * A managed source: user and password from the URL in the variable NAMED by credential_source. Only the
 * names the 007 CHECK allows are ever read. Host, port, database and TLS come from the row, not the URL.
 */
export function envCredential(source: string, env: Record<string, string | undefined> = process.env): StoredCredential | null {
  const name = /^env:(DATABASE_URL_READONLY_[A-Z0-9_]{1,32})$/.exec(source)?.[1]
  const value = name ? env[name] : undefined
  if (!value) return null
  try {
    const url = new URL(value)
    const username = decodeURIComponent(url.username)
    const password = decodeURIComponent(url.password)
    return username && password ? { username, password } : null
  } catch {
    return null
  }
}

interface Row { kind: string; host: string; port: number; database: string; ssl_mode: string; credential_source: string; status: string }
interface Secret { cred_ciphertext: Buffer | null; cred_nonce: Buffer | null; cred_key_id: string | null; credential_source: string }

/** Null when this organisation has no such integration. The connection is opened outside any app transaction. */
export async function testConnection(ctx: OrgCtx, integrationId: string, connect: Connect = driver.connect): Promise<TestOutcome | null> {
  const no = (category: Category) => ({ outcome: { ok: false as const, category } })
  const prepared = await withOrg(ctx, async (tx) => {
    const [row] = await tx<(Row & { id: string })[]>`
      SELECT id, kind, host, port, database, ssl_mode, credential_source, status
        FROM app_integrations
       WHERE id = ${integrationId} AND org_id = ${ctx.org.id}`
    if (!row) return null
    if (row.kind !== 'postgres') return no('unsupported')
    // Asked again now: the list can have changed since the integration was saved.
    if (row.status !== 'active' || !covering(await entriesFor(tx, ctx.org.id, row.host), row.port)) return no('not_allowed')
    // The only reader of the secret columns (010).
    const [secret] = await tx<Secret[]>`
      SELECT cred_ciphertext, cred_nonce, cred_key_id, credential_source FROM app_integration_credentials(${row.id})`
    return { row, secret }
  })
  if (!prepared) return null
  if ('outcome' in prepared) return prepared.outcome ?? null

  const { row, secret } = prepared
  // Stored rows only: managed rows are the ones that may point at this machine, and no org admin can change them.
  let address: string | undefined
  if (!row.credential_source.startsWith('env:')) {
    try {
      const resolved = await resolveTarget(row.host, { resolve: driver.resolve })
      if (!resolved.ok) return { ok: false, category: 'not_allowed' }
      address = resolved.address
    } catch (error) {
      return { ok: false, category: categorise(error, row.ssl_mode) }
    }
  }
  let credential: StoredCredential | null = null
  if (row.credential_source.startsWith('env:')) {
    credential = envCredential(row.credential_source)
  } else if (secret?.cred_ciphertext && secret.cred_nonce && secret.cred_key_id) {
    try {
      credential = decrypt(
        { ciphertext: secret.cred_ciphertext, nonce: secret.cred_nonce, keyId: secret.cred_key_id },
        { orgId: ctx.org.id, integrationId: row.id },
      )
    } catch {
      console.error(`integrations: the stored credential of integration ${row.id} could not be decrypted`)
    }
  }
  if (!credential) return { ok: false, category: 'other' }
  return probe({ host: row.host, port: row.port, database: row.database, sslMode: row.ssl_mode, ...credential, ...(address ? { address } : {}) }, connect)
}
