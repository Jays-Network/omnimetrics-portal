import bcrypt from 'bcryptjs'
import type { Role } from '@omnimetrics/types'
import { BCRYPT_COST, LAST_ADMIN, NAME_UNAVAILABLE, OWN_MEMBERSHIP, newOneTimePassword } from '@/lib/admin/password'
import { AddUserSchema, LinkUserSchema, type MemberRow, type Result } from '@/lib/admin/types'
import { writeAudit } from '@/lib/audit'
import { invalidateUserCache } from '@/lib/auth'
import type { Actor } from '../mock/admin' // type only
import { withOrg, withPlatform, withUser, type Tx } from './context'
import { assertOrgCtx, type OrgCtx } from './org'
import { isUuid } from './tx'

// Members of ONE organisation. hashed_password is written here and never selected.

const gone: Result<never> = { ok: false, code: 'not_found', error: 'Not found' }
const forbid: Result<never> = { ok: false, code: 'forbidden', error: 'Not allowed.' }
const invalid = (error: string): Result<never> => ({ ok: false, code: 'invalid', error })
const isAdminCtx = (ctx: OrgCtx) => ctx.capabilities.includes('admin.view')

interface Row { id: string; username: string; email: string; is_platform_admin: boolean; role: Role; is_active: boolean }

async function members(tx: Tx, ctx: OrgCtx, userId: string | null): Promise<MemberRow[]> {
  const rows = await tx<Row[]>`
    SELECT u.id, u.username, u.email, u.is_platform_admin, m.role, m.is_active
      FROM app_memberships m
      JOIN app_users u ON u.id = m.user_id
     WHERE m.org_id = ${ctx.org.id} AND (${userId}::uuid IS NULL OR m.user_id = ${userId}::uuid)
     ORDER BY u.username`
  const folders = await tx<{ user_id: string; folder_name: string }[]>`
    SELECT user_id, folder_name FROM app_user_projects WHERE org_id = ${ctx.org.id} ORDER BY folder_name`
  const grants = await tx<{ user_id: string; n: number }[]>`
    SELECT user_id, count(*)::int AS n FROM app_grants WHERE org_id = ${ctx.org.id} GROUP BY user_id`
  return rows.map((r) => {
    const unrestricted = r.is_platform_admin || r.role === 'admin'
    const n = grants.find((g) => g.user_id === r.id)?.n ?? 0
    return {
      userId: r.id,
      username: r.username,
      email: r.email,
      role: r.role,
      active: r.is_active,
      isPlatform: r.is_platform_admin,
      grantsSummary: unrestricted ? 'Everything in this organisation' : n ? `${n} grant${n === 1 ? '' : 's'}` : 'No grants yet',
      trackingFolders: unrestricted ? null : folders.filter((f) => f.user_id === r.id).map((f) => f.folder_name),
    }
  })
}

/** `folders` (the tracking-folder universe) is empty until the tracking stage. */
export async function list(ctx: OrgCtx): Promise<Result<{ members: MemberRow[]; folders: string[] }>> {
  assertOrgCtx(ctx)
  if (!isAdminCtx(ctx)) return gone
  return withOrg(ctx, async (tx) => ({ ok: true as const, members: await members(tx, ctx, null), folders: [] }))
}

/**
 * A NEW login plus its membership, in one transaction. A taken username or email answers the same way
 * whichever organisation (if any) holds it. The one-time password leaves the server only in this result.
 * app_users.role (legacy, still read by login) is always 'viewer': the org role lives in the membership.
 */
export async function add(ctx: OrgCtx, actor: Actor, input: { username: string; email: string; role: Role }): Promise<Result<{ member: MemberRow; oneTimePassword: string }>> {
  assertOrgCtx(ctx)
  if (!isAdminCtx(ctx)) return gone
  const parsed = AddUserSchema.safeParse({ op: 'add', username: input.username, email: input.email, role: input.role })
  if (!parsed.success) return invalid('Check the username, email and role.')
  const { username, email, role } = parsed.data
  const oneTimePassword = newOneTimePassword()
  const hash = await bcrypt.hash(oneTimePassword, BCRYPT_COST)
  try {
    return await withOrg(ctx, async (tx) => {
      const taken = await tx`SELECT 1 FROM app_users WHERE lower(username) = lower(${username}) OR lower(email) = lower(${email}) LIMIT 1`
      if (taken.length) return invalid(NAME_UNAVAILABLE)
      const [user] = await tx<{ id: string }[]>`
        INSERT INTO app_users (username, email, hashed_password, role, is_active)
        VALUES (${username}, ${email}, ${hash}, 'viewer', true)
        RETURNING id`
      await tx`
        INSERT INTO app_memberships (org_id, user_id, role, created_by)
        VALUES (${ctx.org.id}, ${user!.id}, ${role}, ${ctx.userId})`
      await writeAudit({ ctx, action: 'user.add', targetType: 'user', targetId: user!.id, detail: { username, role }, ip: actor.ip }, tx)
      const [member] = await members(tx, ctx, user!.id)
      return { ok: true as const, member: member!, oneTimePassword }
    })
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return invalid(NAME_UNAVAILABLE)
    throw error
  }
}

/** Director only: give an EXISTING login a membership of this organisation. */
export async function link(ctx: OrgCtx, actor: Actor, input: { username: string; role: Role }): Promise<Result> {
  assertOrgCtx(ctx)
  if (!isAdminCtx(ctx)) return gone
  if (!ctx.capabilities.includes('orgs.manage')) return forbid
  const parsed = LinkUserSchema.safeParse({ op: 'link', username: input.username, role: input.role })
  if (!parsed.success) return invalid('Check the username and role.')
  const { username, role } = parsed.data
  // The platform role has no grant on app_users (010): the login is looked up on the app path.
  const [user] = await withUser(ctx.userId, (tx) => tx<{ id: string; is_platform_admin: boolean }[]>`
    SELECT id, is_platform_admin FROM app_users WHERE username = ${username} AND is_active`)
  if (!user) return invalid('No active login has that username.')
  if (user.is_platform_admin) return invalid('A platform admin already has access to every organisation.')
  const result = await withPlatform(async (tx) => {
    const done = await tx`
      INSERT INTO app_memberships (org_id, user_id, role, created_by)
      VALUES (${ctx.org.id}, ${user.id}, ${role}, ${ctx.userId})
      ON CONFLICT (org_id, user_id) DO NOTHING
      RETURNING id`
    if (!done.length) return invalid('That person is already a member of this organisation.')
    await writeAudit({ ctx, action: 'user.link', targetType: 'user', targetId: user.id, detail: { username, role }, ip: actor.ip }, tx)
    return { ok: true as const }
  }, ctx.userId)
  if (result.ok) invalidateUserCache(user.id)
  return result
}

/** Role and active flag of one membership of this organisation. Tracking scope arrives with the tracking stage. */
export async function update(ctx: OrgCtx, actor: Actor, userId: string, patch: { role?: Role; active?: boolean; trackingFolders?: string[] }): Promise<Result<{ member: MemberRow }>> {
  assertOrgCtx(ctx)
  if (!isAdminCtx(ctx)) return gone
  if (!isUuid(userId)) return gone
  const { role, active } = patch
  if (role !== undefined && !['admin', 'builder', 'viewer'].includes(role)) return invalid('Unknown role.')
  const result = await withOrg(ctx, async (tx) => {
    // Serialises membership changes per organisation, so the admin count below cannot go stale.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`app_memberships:${ctx.org.id}`}, 0))`
    const [target] = await members(tx, ctx, userId)
    if (!target) return gone
    if (userId === ctx.userId) return invalid(OWN_MEMBERSHIP)
    if (target.isPlatform) return forbid
    if (patch.trackingFolders) return invalid('Tracking scope cannot be changed yet.')
    const leaves = target.role === 'admin' && target.active && ((role !== undefined && role !== 'admin') || active === false)
    if (leaves) {
      const [{ n } = { n: 0 }] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM app_memberships m
          JOIN app_users u ON u.id = m.user_id
         WHERE m.org_id = ${ctx.org.id} AND m.role = 'admin' AND m.is_active AND u.is_active AND m.user_id <> ${userId}`
      if (n === 0) return invalid(LAST_ADMIN)
    }
    await tx`
      UPDATE app_memberships
         SET role = coalesce(${role ?? null}, role), is_active = coalesce(${active ?? null}::boolean, is_active), updated_at = now()
       WHERE org_id = ${ctx.org.id} AND user_id = ${userId}`
    const detail = { ...(role !== undefined ? { role } : {}), ...(active !== undefined ? { active } : {}) }
    await writeAudit({ ctx, action: 'user.update', targetType: 'user', targetId: userId, detail, ip: actor.ip }, tx)
    const [member] = await members(tx, ctx, userId)
    return { ok: true as const, member: member! }
  })
  if (result.ok) invalidateUserCache(userId)
  return result
}
