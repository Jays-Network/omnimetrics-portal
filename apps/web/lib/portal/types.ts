import type { Org, OrgAccess, Role } from '@omnimetrics/types'

/** Who is asking. Comes from the verified session (getCurrentUser), never from the browser. */
export interface PortalIdentity {
  id: string
  username: string
  /** Legacy global role from app_users; M5 replaces it with per-organisation memberships. */
  role: Role
}

/** An organisation row for the director's Organisations screen. */
export interface OrgSummary extends Org {
  memberCount: number
  integrationCount: number
  dashboardCount: number
}

/**
 * The single data-access interface (docs/PLAN_BUILDER.md section C). M1 covers
 * organisations only; content, dashboards, integrations, settings and admin
 * join in M2 to M4. UI code calls getPortal(), never an implementation.
 */
export interface Portal {
  mode: 'mock' | 'pg'
  orgs: {
    /** Organisations this identity may enter, with role and capabilities. Empty = no access (fail closed). */
    listAccessible(who: PortalIdentity): Promise<OrgAccess[]>
    /** Every organisation with counts. Director only: callers must hold `orgs.manage`. */
    listAll(): Promise<OrgSummary[]>
  }
}
