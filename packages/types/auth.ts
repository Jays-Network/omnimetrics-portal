export type Role = 'admin' | 'builder' | 'viewer'

export const ROLES: readonly Role[] = ['admin', 'builder', 'viewer'] as const

/**
 * The authenticated user as exposed to the client (GET /api/auth/me).
 * allowed_projects is null ONLY for role 'admin' (no folder_name filter).
 * For builder/viewer it is currently always [] (sees nothing): tracking scope
 * is per organisation and is loaded on demand from the tracking stage on.
 */
export interface User {
  id: string
  username: string
  email: string
  role: Role
  allowed_projects: string[] | null
}

/**
 * Claims carried in the omnimetrics_token JWT. Identity only: role, is_active
 * and allowed_projects are always loaded from the database by requireAuth().
 */
export interface JWTPayload {
  sub: string
  iat?: number
  exp: number
  /** app_users.token_version at signing. Only present with SESSION_VERSION=1 (migration 012). */
  tv?: number
}
