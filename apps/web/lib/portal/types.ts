import type { DashVersion } from '@/lib/builder/model'
import type { SaveInput, SaveResult } from './mock/versions'
import type * as A from './mock/admin'
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

/** The mock's admin signatures, where an implementation may also answer asynchronously (pg does). */
export type Service<T> = {
  [K in keyof T]: T[K] extends (...args: infer P) => infer R ? (...args: P) => R | Promise<R> : Service<T[K]>
}

/**
 * The single data-access interface (docs/PLAN_BUILDER.md section C). M1 covers
 * organisations only; content, dashboards, integrations, settings and admin
 * join in M2 to M4. UI code calls getPortal(), never an implementation.
 * Every org-scoped method takes the verified access first. The pg implementation additionally
 * refuses any object that requireOrg() did not issue (lib/portal/pg/org.ts, type OrgCtx).
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
    tree(ctx: OrgAccess): Promise<ContentNode[]>
    /** One tree mutation; permission, depth and name rules are enforced here, not in the UI. */
    apply(ctx: OrgAccess, op: ContentOp): Promise<ContentResult>
  }
  /** M4 admin surface. Typed from the mock module; callers always `await`. */
  integrations: typeof A.integrations
  organisations: Service<typeof A.organisations>
  users: Service<typeof A.users>
  accounts: Service<typeof A.accounts>
  account: Service<typeof A.account>
  settings: Service<typeof A.settings>
  dashboards: {
    /** A dashboard of this organisation, or null (also for ids of other organisations). */
    get(ctx: OrgAccess, nodeId: string): Promise<DashboardView | null>
    /** Version history (oldest first). Needs `dashboards.edit`; null for a dashboard of another organisation. */
    versions(ctx: OrgAccess, nodeId: string): Promise<DashVersion[] | null>
    /** Append a version (new spec, or a restore of an old one). Needs `dashboards.edit`; history is never rewritten. */
    saveVersion(ctx: OrgAccess, nodeId: string, input: SaveInput, author: string): Promise<SaveResult>
    /** Grants of one dashboard. Needs `dashboards.edit`; null for another organisation's id. */
    grants(ctx: OrgAccess, nodeId: string): Promise<GrantRow[] | null>
    /** Replace the grants. Org admins and the director only. `invalid` is raised by pg only (the mock accepts any principal). */
    setGrants(ctx: OrgAccess, nodeId: string, rows: GrantRow[]): Promise<{ ok: true; grants: GrantRow[] } | { ok: false; code: 'forbidden' | 'not_found' | 'invalid'; error: string }>
  }
}
