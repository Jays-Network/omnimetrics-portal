import { capabilitiesFor, type OrgAccess, type Role } from '@omnimetrics/types'

/** Dev-only "preview as role" cookie. Reduce-only: it can never grant more than the real session. */
export const PREVIEW_COOKIE = 'omni_preview_role'
export const PREVIEW_ROLES = ['admin', 'builder', 'viewer'] as const
export type PreviewRole = (typeof PREVIEW_ROLES)[number]

export function parsePreview(v: string | null | undefined): PreviewRole | null {
  return (PREVIEW_ROLES as readonly string[]).includes(v ?? '') ? (v as PreviewRole) : null
}

const RANK: Record<Role, number> = { viewer: 1, builder: 2, admin: 3 }
/** Director = 4, then admin 3, builder 2, viewer 1. */
export const rankOf = (a: Pick<OrgAccess, 'role' | 'isPlatform'>): number => (a.isPlatform ? 4 : RANK[a.role])

/** Only roles strictly below the real one are offered (reduce-only). */
export function previewOptions(real: Pick<OrgAccess, 'role' | 'isPlatform'> | undefined): PreviewRole[] {
  if (!real) return []
  return PREVIEW_ROLES.filter((r) => RANK[r] < rankOf(real))
}

/** Lower an access to the previewed role. A preview at or above the real rank changes nothing. */
export function reduceAccess(a: OrgAccess, preview: PreviewRole | null): OrgAccess {
  if (!preview || RANK[preview] >= rankOf(a)) return a
  return { ...a, role: preview, isPlatform: false, capabilities: capabilitiesFor(preview, false) }
}
