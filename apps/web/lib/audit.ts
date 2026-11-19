import { getDb } from '@/lib/db'

/**
 * Appends a row to app_audit_log. Never throws: a failed audit write must not
 * break (or reveal anything about) the request. Never put passwords, hashes or
 * tokens in `detail`.
 */
export async function writeAuditLog(
  userId: string | null,
  action: string,
  detail: Record<string, string | number | boolean | null>,
): Promise<void> {
  try {
    const sql = getDb()
    await sql`
      INSERT INTO app_audit_log (user_id, action, detail)
      VALUES (${userId}, ${action}, ${sql.json(detail)})
    `
  } catch (error) {
    console.error('audit log write failed:', error instanceof Error ? error.message : error)
  }
}
