import postgres from 'postgres'

type Sql = ReturnType<typeof postgres>

/**
 * Two lazily-created postgres.js clients, cached on globalThis so Next.js dev
 * hot reloads do not leak connection pools.
 *
 *  - getDb()         DATABASE_URL           portal_app role: app_* tables only (auth, users, audit log)
 *  - getReadonlyDb() DATABASE_URL_READONLY  grafana_reader: tracking-data reads, 10s statement_timeout
 *
 * Clients are created on first use, so `next build` does not need a database.
 * All queries MUST use tagged-template parameters (sql`... ${value}`); never
 * concatenate user input into SQL.
 */

const STATEMENT_TIMEOUT_MS = 10_000

const globalForDb = globalThis as unknown as {
  __omniSql?: Sql
  __omniSqlReadonly?: Sql
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`)
  }
  return value
}

export function getDb(): Sql {
  if (!globalForDb.__omniSql) {
    globalForDb.__omniSql = postgres(requireEnv('DATABASE_URL'), {
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
    })
  }
  return globalForDb.__omniSql
}

export function getReadonlyDb(): Sql {
  if (!globalForDb.__omniSqlReadonly) {
    globalForDb.__omniSqlReadonly = postgres(requireEnv('DATABASE_URL_READONLY'), {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      // Sent as a startup parameter: applies to every statement on this connection.
      connection: { statement_timeout: STATEMENT_TIMEOUT_MS },
    })
  }
  return globalForDb.__omniSqlReadonly
}
