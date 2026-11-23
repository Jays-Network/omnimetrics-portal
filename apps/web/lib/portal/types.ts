import type { DashVersion } from '@/lib/builder/model'
import type { SaveInput, SaveResult } from './mock/versions'
import type { GrantRow, ContentNode, ContentOp, ContentResult, DashboardView, Org, OrgAccess, Role } from '@omnimetrics/types'

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

/** Verified access to ONE organisation (from the page/route guard). Every org-scoped method takes it first. */
export type OrgCtx = OrgAccess

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
  content: {
    /** Live (not deleted) nodes of this organisation only. Needs `dashboards.view`. */
    tree(ctx: OrgCtx): Promise<ContentNode[]>
    /** One tree mutation; permission, depth and name rules are enforced here, not in the UI. */
    apply(ctx: OrgCtx, op: ContentOp): Promise<ContentResult>
  }
  dashboards: {
    /** A dashboard of this organisation, or null (also for ids of other organisations). */
    get(ctx: OrgCtx, nodeId: string): Promise<DashboardView | null>
    /** Version history (oldest first). Needs `dashboards.edit`; null for a dashboard of another organisation. */
    versions(ctx: OrgCtx, nodeId: string): Promise<DashVersion[] | null>
    /** Append a version (new spec, or a restore of an old one). Needs `dashboards.edit`; history is never rewritten. */
    saveVersion(ctx: OrgCtx, nodeId: string, input: SaveInput, author: string): Promise<SaveResult>
    /** Grants of one dashboard (mock until M5). Needs `dashboards.edit`; null for another organisation's id. */
    grants(ctx: OrgCtx, nodeId: string): Promise<GrantRow[] | null>
    /** Replace the grants. Org admins and the director only. Mock only: real grants arrive in M5. */
    setGrants(ctx: OrgCtx, nodeId: string, rows: GrantRow[]): Promise<{ ok: true; grants: GrantRow[] } | { ok: false; code: 'forbidden' | 'not_found'; error: string }>
  }
}
