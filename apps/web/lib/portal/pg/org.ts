import type { Capability, OrgAccess, Role } from '@omnimetrics/types'
import { toAccess, type OrgRow } from './access'
import { NotFound } from './errors'
import { isUuid, withUser } from './tx'

declare const orgCtxBrand: unique symbol

/** Verified access of ONE user to ONE organisation. Only requireOrg() below can make one. */
export type OrgCtx = OrgAccess & { readonly userId: string; readonly [orgCtxBrand]: true }

// Runtime half of the brand: a literal, a spread copy or a cast is not in here.
const issued = new WeakSet<object>()

export function assertOrgCtx(ctx: OrgAccess): asserts ctx is OrgCtx {
  if (!issued.has(ctx)) throw new Error('OrgCtx was not issued by requireOrg()')
}

/**
 * (user, slug) -> ctx. A member resolves the slug only through their own membership (self_read); a
 * platform admin through app_orgs. No membership, inactive user or membership, suspended or archived
 * organisation, missing capability: NotFound, so existence is never confirmed. Not cached.
 */
export async function requireOrg(user: { id: string }, orgSlug: string, cap?: Capability): Promise<OrgCtx> {
  if (!isUuid(user.id)) throw new NotFound()
  const access = await withUser(user.id, async (tx) => {
    const [me] = await tx<{ is_platform_admin: boolean }[]>`
      SELECT is_platform_admin FROM app_users WHERE id = ${user.id} AND is_active`
    if (!me) return null
    if (me.is_platform_admin) {
      const [org] = await tx<OrgRow[]>`SELECT id, slug, name FROM app_orgs WHERE slug = ${orgSlug} AND status = 'active'`
      return org ? toAccess(org, 'admin', true) : null
    }
    const [row] = await tx<(OrgRow & { role: Role })[]>`
      SELECT o.id, o.slug, o.name, m.role
        FROM app_memberships m
        JOIN app_orgs o ON o.id = m.org_id
       WHERE m.user_id = ${user.id} AND m.is_active AND o.slug = ${orgSlug} AND o.status = 'active'`
    return row ? toAccess(row, row.role, false) : null
  })
  if (!access || (cap && !access.capabilities.includes(cap))) throw new NotFound()

  Object.freeze(access.org)
  Object.freeze(access.capabilities)
  const ctx = Object.freeze({ ...access, userId: user.id }) as OrgCtx
  issued.add(ctx)
  return ctx
}
