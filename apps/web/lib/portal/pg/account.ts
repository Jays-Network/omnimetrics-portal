import bcrypt from 'bcryptjs'
import { BCRYPT_COST, OWN_RESET, SHARED_LOGIN, WRONG_CURRENT, newOneTimePassword, passwordProblem } from '@/lib/admin/password'
import type { Result } from '@/lib/admin/types'
import { writeAudit } from '@/lib/audit'
import { invalidateUserCache } from '@/lib/auth'
import { sessionVersionEnabled } from '@/lib/session-version'
import type { Actor } from '../mock/admin' // type only
import { withOrg, withPlatform, withUser } from './context'
import { assertOrgCtx, type OrgCtx } from './org'
import { isUuid } from './tx'

// Passwords and sessions. A hash is read only to verify the caller's own current password and never leaves
// this module. With SESSION_VERSION=1 (needs 012) a change, reset or revoke bumps token_version in the same
// transaction, which ends the sessions signed with the old one. With the flag off nothing names that column.

const gone: Result<never> = { ok: false, code: 'not_found', error: 'Not found' }
const invalid = (error: string): Result<never> => ({ ok: false, code: 'invalid', error })

/** The signed-in person's own password. `actor` comes from the verified session, never from the request. */
/** `tokenVersion` (flag on) is for the route to re-issue this session's cookie; it is not sent to the browser. */
export async function changePassword(actor: Actor, current: string, next: string): Promise<Result<{ message: string; tokenVersion?: number }>> {
  if (!isUuid(actor.id)) return gone
  const problem = passwordProblem(current, next)
  if (problem) return invalid(problem)
  const [row] = await withUser(actor.id, (tx) => tx<{ hash: string }[]>`
    SELECT hashed_password AS hash FROM app_users WHERE id = ${actor.id} AND is_active`)
  if (!row) return gone
  if (!(await bcrypt.compare(current, row.hash))) return invalid(WRONG_CURRENT)
  const hash = await bcrypt.hash(next, BCRYPT_COST)
  const result = await withUser(actor.id, async (tx) => {
    // The old hash in the WHERE: a concurrent change or reset wins and this one is refused.
    const done = sessionVersionEnabled()
      ? await tx<{ id: string; version?: number }[]>`
      UPDATE app_users SET hashed_password = ${hash}, token_version = token_version + 1, updated_at = now()
       WHERE id = ${actor.id} AND hashed_password = ${row.hash}
      RETURNING id, token_version AS version`
      : await tx<{ id: string; version?: number }[]>`
      UPDATE app_users SET hashed_password = ${hash}, updated_at = now()
       WHERE id = ${actor.id} AND hashed_password = ${row.hash}
      RETURNING id`
    if (!done.length) return invalid(WRONG_CURRENT)
    await writeAudit({ userId: actor.id, action: 'user.password_change', targetType: 'user', targetId: actor.id, ip: actor.ip }, tx)
    const version = done[0]!.version
    return { ok: true as const, message: 'Password changed.', ...(version === undefined ? {} : { tokenVersion: version }) }
  })
  if (result.ok) invalidateUserCache(actor.id)
  return result
}

/** "Sign out everywhere": the signed-in person's own sessions, never anyone else's. The caller keeps theirs. */
export async function revokeSessions(actor: Actor): Promise<Result<{ message: string; tokenVersion?: number }>> {
  if (!isUuid(actor.id)) return gone
  if (!sessionVersionEnabled()) return invalid('Signing out everywhere is not available yet.')
  const result = await withUser(actor.id, async (tx) => {
    const [done] = await tx<{ version: number }[]>`
      UPDATE app_users SET token_version = token_version + 1
       WHERE id = ${actor.id} AND is_active
      RETURNING token_version AS version`
    if (!done) return gone
    await writeAudit({ userId: actor.id, action: 'user.sessions_revoke', targetType: 'user', targetId: actor.id, ip: actor.ip }, tx)
    return { ok: true as const, message: 'Signed out everywhere else.', tokenVersion: done.version }
  })
  if (result.ok) invalidateUserCache(actor.id)
  return result
}

/**
 * New one-time password for a member of this organisation, returned once. An org admin cannot reset a login
 * that also belongs to another organisation (they could then sign in as it and enter that organisation).
 */
export async function resetPassword(ctx: OrgCtx, actor: Actor, userId: string): Promise<Result<{ message: string; oneTimePassword: string }>> {
  assertOrgCtx(ctx)
  if (!ctx.capabilities.includes('admin.view') || !isUuid(userId)) return gone
  const [target] = await withOrg(ctx, (tx) => tx<{ is_platform_admin: boolean }[]>`
    SELECT u.is_platform_admin
      FROM app_memberships m
      JOIN app_users u ON u.id = m.user_id
     WHERE m.org_id = ${ctx.org.id} AND m.user_id = ${userId}`)
  if (!target) return gone
  if (userId === ctx.userId) return invalid(OWN_RESET)
  if (target.is_platform_admin) return { ok: false, code: 'forbidden', error: 'Not allowed.' }
  if (!ctx.capabilities.includes('orgs.manage')) {
    // The tenant path cannot see other organisations (RLS): this one yes/no question goes over the platform role.
    const elsewhere = await withPlatform((tx) => tx`
      SELECT 1 FROM app_memberships WHERE user_id = ${userId} AND org_id <> ${ctx.org.id} LIMIT 1`, ctx.userId)
    if (elsewhere.length) return { ok: false, code: 'forbidden', error: SHARED_LOGIN }
  }
  const oneTimePassword = newOneTimePassword()
  const hash = await bcrypt.hash(oneTimePassword, BCRYPT_COST)
  const result = await withOrg(ctx, async (tx) => {
    // app_users has no RLS: the membership condition is repeated in the write itself.
    const done = sessionVersionEnabled()
      ? await tx`
      UPDATE app_users SET hashed_password = ${hash}, token_version = token_version + 1, updated_at = now()
       WHERE id = ${userId} AND NOT is_platform_admin
         AND EXISTS (SELECT 1 FROM app_memberships m WHERE m.org_id = ${ctx.org.id} AND m.user_id = ${userId})
      RETURNING id`
      : await tx`
      UPDATE app_users SET hashed_password = ${hash}, updated_at = now()
       WHERE id = ${userId} AND NOT is_platform_admin
         AND EXISTS (SELECT 1 FROM app_memberships m WHERE m.org_id = ${ctx.org.id} AND m.user_id = ${userId})
      RETURNING id`
    if (!done.length) return gone
    await writeAudit({ ctx, action: 'user.password_reset', targetType: 'user', targetId: userId, ip: actor.ip }, tx)
    return { ok: true as const, message: 'Password reset. The new one-time password is shown only once.', oneTimePassword }
  })
  if (result.ok) invalidateUserCache(userId)
  return result
}
