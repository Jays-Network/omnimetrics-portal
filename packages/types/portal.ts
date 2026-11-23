import type { Role } from './auth'

/** An organisation (tenant). Never called "client" or "project" (docs/PLAN_BUILDER.md section 0). */
export interface Org {
  id: string
  slug: string
  name: string
  status: 'active' | 'suspended'
}

/**
 * What the portal lets a user do inside one organisation. Presentation hint for
 * the shell; the server re-checks on every page and route (never trust the UI).
 * `terminal.run` is director (platform admin) only (R7).
 */
export type Capability =
  | 'dashboards.view'
  | 'dashboards.edit'
  | 'dashboards.delete'
  | 'integrations.manage'
  | 'admin.view'
  | 'settings.view'
  | 'settings.org'
  | 'orgs.manage'
  | 'hosts.manage'
  | 'settings.system'
  | 'terminal.run'

const ORG_ADMIN: readonly Capability[] = [
  'dashboards.view',
  'dashboards.edit',
  'dashboards.delete',
  'integrations.manage',
  'admin.view',
  'settings.view',
  'settings.org',
]
const BUILDER: readonly Capability[] = ['dashboards.view', 'dashboards.edit', 'dashboards.delete', 'settings.view']
const VIEWER: readonly Capability[] = ['dashboards.view', 'settings.view']

/** Pure role to capability map. Platform admin = every org capability plus orgs.manage and terminal.run. */
export function capabilitiesFor(role: Role, isPlatform: boolean): Capability[] {
  if (isPlatform) return [...ORG_ADMIN, 'orgs.manage', 'hosts.manage', 'settings.system', 'terminal.run']
  if (role === 'admin') return [...ORG_ADMIN]
  if (role === 'builder') return [...BUILDER]
  return [...VIEWER]
}

/** Client-safe view of one organisation the signed-in user may enter. */
export interface OrgAccess {
  org: Org
  /** Role inside this organisation. */
  role: Role
  /** The director: sees every organisation. */
  isPlatform: boolean
  capabilities: Capability[]
}
