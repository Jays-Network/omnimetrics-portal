import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import type { Capability, OrgAccess, Role, User } from '@omnimetrics/types'
import { getCurrentUser } from '@/lib/auth'
import { getPortal, type Portal } from './index'

export interface PortalPageContext {
  user: User
  portal: Portal
  /** Every organisation this user may enter. */
  accessible: OrgAccess[]
}

const accessibleFor = cache(async (id: string, username: string, role: Role) => {
  const portal = await getPortal()
  return { portal, accessible: await portal.orgs.listAccessible({ id, username, role }) }
})

/** Signed-in user plus their organisations. Redirects to /login when unauthenticated. */
export async function requirePortalUser(): Promise<PortalPageContext> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const { portal, accessible } = await accessibleFor(user.id, user.username, user.role)
  return { user, portal, accessible }
}

/**
 * Guard for every org-scoped page. The slug in the URL is only a HINT: it must
 * match an organisation the user may enter (404 otherwise, so existence is not
 * confirmed) and the user must hold `cap`. Pages call this themselves; the
 * shell and middleware are not the security boundary.
 */
export async function requireOrgPage(orgSlug: string, cap?: Capability) {
  const ctx = await requirePortalUser()
  const access = ctx.accessible.find((a) => a.org.slug === orgSlug)
  if (!access || (cap && !access.capabilities.includes(cap))) notFound()
  return { ...ctx, access }
}

/** Guard for director-only platform pages (`orgs.manage`). */
export async function requirePlatformPage() {
  const ctx = await requirePortalUser()
  const access = ctx.accessible.find((a) => a.capabilities.includes('orgs.manage'))
  if (!access) notFound()
  return { ...ctx, access }
}
