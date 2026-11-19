import { cookies } from 'next/headers'
import type { NextRequest, NextResponse } from 'next/server'
import type { JWTPayload } from '@omnimetrics/types'
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

const ACTIVE_CACHE_TTL_MS = 60_000
const ACTIVE_CACHE_MAX_ENTRIES = 1_000

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

// is_active cache: userId -> { active, expiresAt }. Per-process, ~60s TTL, so a
// deactivated user loses access within a minute.
const globalForAuth = globalThis as unknown as {
  __omniActiveCache?: Map<string, { active: boolean; expiresAt: number }>
}
const activeCache = (globalForAuth.__omniActiveCache ??= new Map())

/** Call after deactivating/reactivating a user so this process reflects it immediately. */
export function invalidateActiveCache(userId?: string): void {
  if (userId) activeCache.delete(userId)
  else activeCache.clear()
}

async function isUserActive(userId: string): Promise<boolean> {
  const now = Date.now()
  const cached = activeCache.get(userId)
  if (cached && cached.expiresAt > now) return cached.active

  const sql = getDb()
  const rows = await sql<{ is_active: boolean }[]>`
    SELECT is_active FROM app_users WHERE id = ${userId}
  `
  const active = rows[0]?.is_active === true

  if (activeCache.size >= ACTIVE_CACHE_MAX_ENTRIES) {
    for (const [key, entry] of activeCache) {
      if (entry.expiresAt <= now) activeCache.delete(key)
    }
    if (activeCache.size >= ACTIVE_CACHE_MAX_ENTRIES) activeCache.clear()
  }
  activeCache.set(userId, { active, expiresAt: now + ACTIVE_CACHE_TTL_MS })
  return active
}

async function authenticateToken(token: string | undefined): Promise<JWTPayload> {
  const payload = await verifyToken(token)
  if (!payload) throw new AuthError(401, 'Unauthorized')

  let active: boolean
  try {
    active = await isUserActive(payload.sub)
  } catch {
    // Fail closed if the active-status check cannot be made.
    throw new AuthError(503, 'Authentication service unavailable')
  }
  if (!active) throw new AuthError(401, 'Unauthorized')
  return payload
}

/**
 * For API route handlers. Verifies the omnimetrics_token cookie, then
 * re-checks app_users.is_active (cached ~60s). Throws AuthError (401/503).
 */
export async function requireAuth(request: NextRequest): Promise<JWTPayload> {
  return authenticateToken(request.cookies.get(AUTH_COOKIE_NAME)?.value)
}

/**
 * For server components / layouts. Returns null instead of throwing, so the
 * caller can redirect('/login').
 */
export async function getCurrentUser(): Promise<JWTPayload | null> {
  const store = await cookies()
  try {
    return await authenticateToken(store.get(AUTH_COOKIE_NAME)?.value)
  } catch (error) {
    if (error instanceof AuthError) return null
    throw error
  }
}
