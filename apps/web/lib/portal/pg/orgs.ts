import type { Org, OrgAccess, Role } from '@omnimetrics/types'
import type { OrgSummary, PortalIdentity } from '../types'
import { toAccess, type OrgRow } from './access'
import { withPlatform } from './context'
import { isUuid, withUser } from './tx'

// These two run BEFORE any organisation is chosen, so they take no OrgCtx.

/** The organisations requireOrg() would admit this user to (for the switcher; never an authorisation). */
export async function listAccessible(who: PortalIdentity): Promise<OrgAccess[]> {
  if (!isUuid(who.id)) return []
  return withUser(who.id, async (tx) => {
    const [me] = await tx<{ is_platform_admin: boolean }[]>`
      SELECT is_platform_admin FROM app_users WHERE id = ${who.id} AND is_active`
    if (!me) return []
    if (me.is_platform_admin) {
      const orgs = await tx<OrgRow[]>`SELECT id, slug, name FROM app_orgs WHERE status = 'active' ORDER BY name`
      return orgs.map((o) => toAccess(o, 'admin', true))
    }
    const rows = await tx<(OrgRow & { role: Role })[]>`
      SELECT o.id, o.slug, o.name, m.role
        FROM app_memberships m
        JOIN app_orgs o ON o.id = m.org_id
       WHERE m.user_id = ${who.id} AND m.is_active AND o.status = 'active'
       ORDER BY o.name`
    return rows.map((r) => toAccess(r, r.role, false))
  })
}

/**
 * Every organisation. Director only: callers must hold `orgs.manage`.
 * integrationCount and dashboardCount are NOT computed (always 0): portal_platform has no grant on
 * content or integrations (010), and integrations are out of scope until their own stage.
 */
export async function listAll(): Promise<OrgSummary[]> {
  return withPlatform(async (tx) => {
    const rows = await tx<{ id: string; slug: string; name: string; status: string; members: number }[]>`
      SELECT o.id, o.slug, o.name, o.status, count(m.user_id)::int AS members
        FROM app_orgs o
        LEFT JOIN app_memberships m ON m.org_id = o.id
       GROUP BY o.id
       ORDER BY o.name`
    return rows.map((r) => {
      const status: Org['status'] = r.status === 'active' ? 'active' : 'suspended' // 'archived' is closed too
      return { id: r.id, slug: r.slug, name: r.name, status, memberCount: r.members, integrationCount: 0, dashboardCount: 0 }
    })
  })
}
