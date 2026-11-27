import { isIP } from 'node:net'
import type postgres from 'postgres'
import { redact } from '@/lib/admin/redact'
import { getDb } from '@/lib/db'
import { inAppTx, type Tx } from '@/lib/portal/pg/tx'

export interface AuditInput {
  /** The verified organisation context of an admin action: supplies org_id and user_id. */
  ctx?: { org: { id: string }; userId: string }
  /** Overrides ctx.userId. null = unknown user (failed login). */
  userId?: string | null
  /** Overrides ctx.org.id. null = platform or account event. */
  orgId?: string | null
  action: string
  targetType?: string
  targetId?: string
  detail?: Record<string, unknown>
  /** The X-Real-IP header, unvalidated. Anything that is not an address is stored as NULL. */
  ip?: string | null
}

const SECRET_KEY = /passw|pwd|secret|token|hash|credential|api_?key|private_?key|cookie|authori[sz]ation/i
const SECRET_VALUE = /\$2[abxy]\$\d{2}\$|eyJ[\w-]{8,}\.[\w-]{8,}\./ // bcrypt hash, JWT

/** Deny-list over the detail JSON: secret-looking keys and values never reach the log. */
export function safeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return SECRET_VALUE.test(v) ? '[redacted]' : v
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) ? '[redacted]' : walk(x)]))
    return v
  }
  return walk(redact(detail)) as Record<string, unknown>
}

/** A value `inet` accepts, or null. */
export function auditIp(value: string | null | undefined): string | null {
  const ip = value?.trim() ?? ''
  return !ip.includes('%') && isIP(ip) ? ip : null
}

function resolve(input: AuditInput) {
  return {
    userId: input.userId !== undefined ? input.userId : (input.ctx?.userId ?? null),
    orgId: input.orgId !== undefined ? input.orgId : (input.ctx?.org.id ?? null),
    detail: safeDetail(input.detail ?? {}),
    ip: auditIp(input.ip),
  }
}

// No RETURNING: it would need the SELECT policy to admit the new row (010).
async function insert(tx: Tx, input: AuditInput): Promise<void> {
  const e = resolve(input)
  await tx`
    INSERT INTO app_audit_log (org_id, user_id, action, target_type, target_id, detail, ip)
    VALUES (${e.orgId}, ${e.userId}, ${input.action}, ${input.targetType ?? null}, ${input.targetId?.slice(0, 128) ?? null},
            ${tx.json(e.detail as postgres.JSONValue)}, ${e.ip})`
}

/**
 * Appends a row to app_audit_log.
 *  - With `tx` (admin mutations): part of that transaction; a failure throws and rolls the change back.
 *  - Without (login events): best effort in its own transaction as `userId`; never throws, returns false.
 * Never put passwords, hashes or tokens in `detail` (safeDetail is a backstop, not a licence).
 */
export async function writeAudit(input: AuditInput, tx?: Tx): Promise<boolean> {
  if (tx) {
    await insert(tx, input)
    return true
  }
  const { userId, orgId, detail, ip } = resolve(input)
  try {
    try {
      await inAppTx(orgId ?? '', userId ?? '', (own) => insert(own, input))
    } catch (error) {
      // 42703 undefined_column: migration 009 is not applied yet. Keep logging in the 001 shape.
      if ((error as { code?: string }).code !== '42703') throw error
      const sql = getDb()
      await sql`
        INSERT INTO app_audit_log (user_id, action, detail)
        VALUES (${userId}, ${input.action}, ${sql.json({ ...detail, ip } as postgres.JSONValue)})`
    }
    return true
  } catch (error) {
    console.error('audit log write failed:', error instanceof Error ? error.message : error)
    return false
  }
}
