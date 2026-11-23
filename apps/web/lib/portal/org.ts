import { cache } from 'react'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import type { Capability, OrgAccess, Role, User } from '@omnimetrics/types'
import { getCurrentUser } from '@/lib/auth'
import { getPortal, type Portal } from './index'
import { PREVIEW_COOKIE, parsePreview, reduceAccess, type PreviewRole } from './preview'

export interface PortalPageContext {
  user: User
  portal: Portal
  /** Every organisation this user may enter (already reduced by a dev preview, if any). */
  accessible: OrgAccess[]
  /** Unreduced access, only used to offer the dev "preview as role" options. */
  real: OrgAccess[]
  /** Active dev preview role (mock mode only). */
  preview: PreviewRole | null
}

const accessibleFor = cache(async (id: string, username: string, role: Role) => {
  const portal = await getPortal()
  return { portal, accessible: await portal.orgs.listAccessible({ id, username, role }) }
})

/**
 * Verified session -> accessible organisations. Applies the dev-only role
 * preview, which can only REDUCE access and exists only with the mock portal.
 * Shared by pages (requirePortalUser) and route handlers.
 */
export async function resolveAccess(user: User): Promise<Omit<PortalPageContext, 'user'>> {
  const { portal, accessible: real } = await accessibleFor(user.id, user.username, user.role)
  const preview = portal.mode === 'mock' ? parsePreview((await cookies()).get(PREVIEW_COOKIE)?.value) : null
  return { portal, real, preview, accessible: preview ? real.map((a) => reduceAccess(a, preview)) : real }
}

/** Signed-in user plus their organisations. Redirects to /login when unauthenticated. */
export async function requirePortalUser(): Promise<PortalPageContext> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return { user, ...(await resolveAccess(user)) }
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
