import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import type { GrantAccess, Role } from '@omnimetrics/types'
import { withPlatform } from '@/lib/portal/pg/context'
import { requireOrg, type OrgCtx } from '@/lib/portal/pg/org'
import { inAppTx, type Tx } from '@/lib/portal/pg/tx'

/**
 * Test database access. Everything runs inside one transaction per role that is ALWAYS rolled back:
 * the repositories' own `begin` becomes a savepoint in it. Rolling back is the only possible cleanup
 * (neither role may delete users, memberships, nodes or versions).
 *
 * The two roles cannot see each other's uncommitted rows, so users AND memberships are seeded through
 * portal_test_app (as smoke_m5 does). The platform administrator cannot be created by either role: it is
 * seeded once, as postgres, by db/test/rebuild_portal_test.sh.example, together with itest_linkable.
 */

type Sql = ReturnType<typeof postgres>
const g = globalThis as unknown as { __omniSql?: unknown; __omniSqlApp?: unknown; __omniSqlPlatform?: unknown }

export const DIRECTOR = 'itest_director'
/** A committed login with no membership: the only kind the platform connection can link. */
export const LINKABLE = 'itest_linkable'

export async function connect(envName: 'TEST_DATABASE_URL_APP' | 'TEST_DATABASE_URL_PLATFORM'): Promise<Sql> {
  const url = process.env[envName]
  if (!url) throw new Error(`Missing ${envName} in apps/web/.env.test`)
  const role = envName === 'TEST_DATABASE_URL_APP' ? 'portal_test_app' : 'portal_test_platform'
  const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 5, connection: { statement_timeout: 10_000 } })
  try {
    const [row] = await sql<{ db: string; who: string }[]>`SELECT current_database() AS db, current_user AS who`
    if (row?.db !== 'portal_test' || row.who !== role) {
      throw new Error(`REFUSING to run: expected database portal_test as ${role}, got database ${row?.db} as ${row?.who}`)
    }
    return sql
  } catch (error) {
    await sql.end({ timeout: 1 })
    throw error
  }
}

class Rollback extends Error {}

/** Opens a transaction that stays open until the returned function rolls it back. */
async function hold(sql: Sql): Promise<{ tx: Tx; rollback: () => Promise<void> }> {
  let ready!: (tx: Tx) => void
  let finish!: () => void
  const opened = new Promise<Tx>((r) => (ready = r))
  const finished = new Promise<void>((r) => (finish = r))
  const done = sql
    .begin(async (tx) => {
      ready(tx)
      await finished
      throw new Rollback()
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e
    })
  const tx = await Promise.race([opened, done.then(() => Promise.reject(new Error('transaction did not open')))])
  return { tx, rollback: async () => (finish(), void (await done)) }
}

/** Stands in for a pooled client: each `begin` is a savepoint that behaves like its own transaction. */
const facade = (outer: Tx) => ({
  begin: <T>(fn: (tx: Tx) => Promise<T>) =>
    outer.savepoint(async (sp) => {
      const result = await fn(sp)
      // What COMMIT would do: run the deferred checks, drop the transaction-local settings.
      await sp`SET CONSTRAINTS ALL IMMEDIATE`
      await sp`SET CONSTRAINTS ALL DEFERRED`
      await sp`SELECT set_config('app.org_id', '', true), set_config('app.user_id', '', true)`
      return result
    }),
})

export interface Person { id: string; username: string }

export interface World {
  orgA: { id: string; slug: string; name: string }
  orgB: { id: string; slug: string; name: string }
  aAdmin: Person
  aBuilder: Person
  aViewer: Person
  bAdmin: Person
  nobody: Person
  inactive: Person
  director: Person
  linkable: Person
  ctx(who: Person, slug?: string): Promise<OrgCtx>
  grant(orgId: string, userId: string, nodeId: string | null, access: GrantAccess): Promise<void>
  /** Raw SQL inside one organisation's context (fixtures and "unchanged" snapshots). */
  asOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T>
  /** Raw SQL over the platform connection (it cannot see the app connection's uncommitted rows). */
  asPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export async function startWorld(): Promise<World> {
  const app = await connect('TEST_DATABASE_URL_APP')
  const platform = await connect('TEST_DATABASE_URL_PLATFORM')
  const heldApp = await hold(app)
  const heldPlatform = await hold(platform)
  g.__omniSql = heldApp.tx // getDb(): login's user load (lib/auth), same transaction as the repositories
  g.__omniSqlApp = facade(heldApp.tx)
  g.__omniSqlPlatform = facade(heldPlatform.tx)

  const close = async () => {
    delete g.__omniSql
    delete g.__omniSqlApp
    delete g.__omniSqlPlatform
    await heldApp.rollback()
    await heldPlatform.rollback()
    await app.end({ timeout: 5 })
    await platform.end({ timeout: 5 })
  }

  try {
    const asOrg = <T>(orgId: string, fn: (tx: Tx) => Promise<T>) => inAppTx(orgId, '', fn)
    const orgs = await asOrg('', (tx) => tx<World['orgA'][]>`SELECT id, slug, name FROM app_orgs WHERE slug IN ('worldrisk', 'adars')`)
    const orgA = orgs.find((o) => o.slug === 'worldrisk')
    const orgB = orgs.find((o) => o.slug === 'adars')
    if (!orgA || !orgB) throw new Error('portal_test has no worldrisk/adars organisations: run db/test/rebuild_portal_test.sh.example')

    const [director] = await asOrg('', (tx) => tx<Person[]>`SELECT id, username FROM app_users WHERE username = ${DIRECTOR} AND is_platform_admin AND is_active`)
    if (!director) {
      throw new Error(`portal_test has no platform admin "${DIRECTOR}" (only postgres can set the flag): run db/test/rebuild_portal_test.sh.example`)
    }

    const [linkable] = await asOrg('', (tx) => tx<Person[]>`SELECT id, username FROM app_users WHERE username = ${LINKABLE} AND is_active`)

    const run = randomUUID().slice(0, 8)
    const person = async (name: string, legacy: Role, org?: World['orgA'], active = true): Promise<Person> => {
      const username = `it_${name}_${run}`
      return asOrg(org?.id ?? '', async (tx) => {
        const [u] = await tx<Person[]>`
          INSERT INTO app_users (username, email, hashed_password, role)
          VALUES (${username}, ${`${username}@example.test`}, '!', ${legacy})
          RETURNING id, username`
        if (org) await tx`INSERT INTO app_memberships (org_id, user_id, role, is_active) VALUES (${org.id}, ${u!.id}, ${legacy}, ${active})`
        return u!
      })
    }

    return {
      orgA,
      orgB,
      director,
      // Only the linking tests need it, so a database built before it existed still runs everything else.
      get linkable(): Person {
        if (!linkable) throw new Error(`portal_test has no login "${LINKABLE}": run db/test/rebuild_portal_test.sh.example`)
        return linkable
      },
      aAdmin: await person('a_admin', 'admin', orgA),
      aBuilder: await person('a_builder', 'builder', orgA),
      aViewer: await person('a_viewer', 'viewer', orgA),
      bAdmin: await person('b_admin', 'admin', orgB),
      nobody: await person('nobody', 'viewer'),
      inactive: await person('inactive', 'admin', orgA, false),
      ctx: (who, slug = orgA.slug) => requireOrg(who, slug),
      grant: (orgId, userId, nodeId, access) =>
        asOrg(orgId, async (tx) => {
          await tx`INSERT INTO app_grants (org_id, user_id, node_id, access) VALUES (${orgId}, ${userId}, ${nodeId}, ${access})`
        }),
      asOrg,
      asPlatform: (fn) => withPlatform(fn),
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}
