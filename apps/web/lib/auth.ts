import { cookies } from 'next/headers'
import type { NextRequest, NextResponse } from 'next/server'
import { ROLES, type Role, type User } from '@omnimetrics/types'
import { getDb } from '@/lib/db'
import {
  AUTH_COOKIE_NAME,
  getTokenLifetimeSeconds,
  signToken,
  verifyToken,
  type TokenClaims,
} from '@/lib/jwt'

// JWT helpers live in lib/jwt.ts (edge-safe, used by middleware); re-exported here.
export { AUTH_COOKIE_NAME, getTokenLifetimeSeconds, signToken, verifyToken }
export type { TokenClaims }

const USER_CACHE_TTL_MS = 60_000
const USER_CACHE_MAX_ENTRIES = 1_000

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Secure is always on in production. In development it is set only when the
 * request itself arrived over HTTPS, because browsers drop Secure cookies
 * received over plain http:// (except on localhost).
 */
function shouldUseSecureCookie(request: Request): boolean {
  if (process.env.NODE_ENV === 'production') return true
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const proto = forwarded ?? new URL(request.url).protocol.replace(':', '')
  return proto === 'https'
}

export function setAuthCookie(response: NextResponse, request: Request, token: string): void {
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: 'strict',
    path: '/',
    maxAge: getTokenLifetimeSeconds(),
  })
}

export function clearAuthCookie(response: NextResponse, request: Request): void {
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })
}

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 503,
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

/** Turn an AuthError into a JSON Response; rethrow anything else. */
export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  throw error
}

// Permission cache: userId -> { user | null, expiresAt }. Per-process, 60s TTL.
// A role / project / is_active change therefore takes up to 60s to apply in
// other processes; call invalidateUserCache(userId) after such changes so this
// process reflects them immediately. null = missing or inactive user.
const globalForAuth = globalThis as unknown as {
  __omniUserCache?: Map<string, { user: User | null; expiresAt: number }>
}
const userCache = (globalForAuth.__omniUserCache ??= new Map())

/** Drop one user's cached permissions (or all). Call on logout and on role/project/is_active changes. */
export function invalidateUserCache(userId?: string): void {
  if (userId) userCache.delete(userId)
  else userCache.clear()
}

interface UserRow {
  id: string
  username: string
  email: string
  role: string
  is_active: boolean
}

async function loadUser(userId: string): Promise<User | null> {
  const sql = getDb()
  const rows = await sql<UserRow[]>`
    SELECT id, username, email, role, is_active FROM app_users WHERE id = ${userId}
  `
  const row = rows[0]
  if (!row || !row.is_active || !(ROLES as readonly string[]).includes(row.role)) return null
  const role = row.role as Role

  // Only app_users is read (no RLS), so this works before and after migration 010. Tracking scope is per
  // organisation (app_user_projects) and will be loaded on demand through withOrg in the tracking stage; until
  // then non-admins carry [] (sees nothing). allowed_projects is null ONLY for the legacy global admin.
  const allowedProjects: string[] | null = role === 'admin' ? null : []
  return { id: row.id, username: row.username, email: row.email, role, allowed_projects: allowedProjects }
}

async function getUserCached(userId: string): Promise<User | null> {
  const now = Date.now()
  const cached = userCache.get(userId)
  if (cached && cached.expiresAt > now) return cached.user

  const user = await loadUser(userId)

  if (userCache.size >= USER_CACHE_MAX_ENTRIES) {
    for (const [key, entry] of userCache) {
      if (entry.expiresAt <= now) userCache.delete(key)
    }
    if (userCache.size >= USER_CACHE_MAX_ENTRIES) userCache.clear()
  }
  userCache.set(userId, { user, expiresAt: now + USER_CACHE_TTL_MS })
  return user
}

/** For login: permissions for a user whose credentials were just verified. */
export async function getCurrentUserById(userId: string): Promise<User | null> {
  return getUserCached(userId)
}

async function authenticateToken(token: string | undefined): Promise<User> {
  const payload = await verifyToken(token)
  if (!payload) throw new AuthError(401, 'Unauthorized')

  let user: User | null
  try {
    user = await getUserCached(payload.sub)
  } catch {
    // Fail closed if permissions cannot be loaded.
    throw new AuthError(503, 'Authentication service unavailable')
  }
  if (!user) throw new AuthError(401, 'Unauthorized')
  return user
}

/**
 * For API route handlers. Verifies the omnimetrics_token cookie (identity), then
 * loads role, is_active and allowed_projects from the database (cached 60s).
 * Throws AuthError (401/503). Every protected API route must call this.
 */
export async function requireAuth(request: NextRequest): Promise<User> {
  return authenticateToken(request.cookies.get(AUTH_COOKIE_NAME)?.value)
}

/**
 * For server components / layouts. Returns null instead of throwing, so the
 * caller can redirect('/login'). Every protected page must call this.
 */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies()
  try {
    return await authenticateToken(store.get(AUTH_COOKIE_NAME)?.value)
  } catch (error) {
    if (error instanceof AuthError) return null
    throw error
  }
}
