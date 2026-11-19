export type Role = 'admin' | 'builder' | 'viewer'

export const ROLES: readonly Role[] = ['admin', 'builder', 'viewer'] as const

/**
 * The authenticated user as exposed to the client (GET /api/auth/me).
 * allowed_projects is null ONLY for role 'admin' (no folder_name filter).
 * For builder/viewer it is the list from app_user_projects; an empty array
 * means the user can see nothing.
 */
export interface User {
  id: string
  username: string
  email: string
  role: Role
  allowed_projects: string[] | null
}

/** Claims carried in the omnimetrics_token JWT. */
export interface JWTPayload {
  sub: string
  username: string
  role: Role
  allowed_projects: string[] | null
  iat?: number
  exp: number
}
