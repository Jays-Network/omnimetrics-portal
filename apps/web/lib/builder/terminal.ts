import type { Capability } from '@omnimetrics/types'

// MOCK SQL terminal (R7, M3). Nothing here talks to a database and no SQL leaves the browser:
// `runMock` is a pure function over the typed text. The REAL terminal (M5) parses with a PostgreSQL
// parser on the server; these string checks only imitate its refusals so the UI can be reviewed.

/** Hidden, not disabled, for everyone but the director (platform admin). The server re-checks in M5. */
export const canSeeTerminal = (capabilities: readonly Capability[]): boolean => capabilities.includes('terminal.run')

export const ROW_CAP = 1000
export const FORBIDDEN_FUNCTIONS = ['pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_sleep', 'dblink', 'lo_import', 'lo_export', 'lo_get', 'set_config', 'nextval', 'setval', 'pg_advisory_lock', 'pg_try_advisory_lock', 'pg_terminate_backend', 'pg_cancel_backend', 'copy']

export type Verdict = { ok: true } | { ok: false; reason: string }

/** Remove comments and string literals so keywords inside them are not mistaken for code. */
function stripped(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""')
}

export function checkSql(sql: string): Verdict {
  const s = stripped(sql).trim()
  if (s === '') return { ok: false, reason: 'Enter a statement.' }
  const body = s.replace(/;+\s*$/, '')
  if (body.includes(';')) return { ok: false, reason: 'Rejected: more than one statement. Run one SELECT at a time.' }
  const first = (body.match(/^\s*\(*\s*([a-z]+)/i)?.[1] ?? '').toLowerCase()
  if (!['select', 'with', 'values'].includes(first)) return { ok: false, reason: `Rejected: only SELECT, WITH ... SELECT or VALUES are allowed (found ${first ? first.toUpperCase() : 'something else'}).` }
  if (/\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|vacuum|call|do)\b/i.test(body) && first === 'with') return { ok: false, reason: 'Rejected: data-modifying statements are not allowed, including inside a WITH.' }
  if (/\binto\b/i.test(body)) return { ok: false, reason: 'Rejected: SELECT ... INTO is not allowed.' }
  if (/\bfor\s+(no\s+key\s+)?(update|share)\b/i.test(body)) return { ok: false, reason: 'Rejected: row-locking clauses (FOR UPDATE / FOR SHARE) are not allowed.' }
  if (/\bexplain\s+analy[sz]e\b/i.test(body)) return { ok: false, reason: 'Rejected: EXPLAIN ANALYZE is not allowed.' }
  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\s*\\(`, 'i').test(body)) return { ok: false, reason: `Rejected: the function "${fn}" is not allowed.` }
  }
  if (/\blo_[a-z_]+\s*\(/i.test(body)) return { ok: false, reason: 'Rejected: large-object functions (lo_*) are not allowed.' }
  return { ok: true }
}

export interface MockResult { columns: string[]; rows: (string | number)[][]; capped: boolean }

const CANNED: MockResult['rows'] = Array.from({ length: 12 }, (_, i) => [`Unit group ${String.fromCharCode(65 + (i % 4))}`, `Country ${String.fromCharCode(65 + (i % 3))}`, 40 + ((i * 37) % 90), Number((2 + ((i * 7) % 30) / 10).toFixed(1))])

export type RunOutcome = { ok: true; result: MockResult; ms: number; note: string } | { ok: false; reason: string }

/** Canned rows for any accepted statement. `ms` is fake. The row-cap note is always shown. */
export function runMock(sql: string): RunOutcome {
  const v = checkSql(sql)
  if (!v.ok) return v
  return {
    ok: true,
    ms: 12,
    result: { columns: ['unit_group', 'country', 'events', 'avg_dwell_hours'], rows: CANNED, capped: false },
    note: `MOCK result: canned rows, nothing was executed. Real runs are read-only, rolled back and capped at ${ROW_CAP.toLocaleString('en-ZA')} rows.`,
  }
}
