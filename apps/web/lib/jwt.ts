import { SignJWT, jwtVerify } from 'jose'
import { ROLES, type JWTPayload, type Role } from '@omnimetrics/types'

/**
 * Edge-safe JWT helpers (jose only: no database, no next/headers), so
 * middleware.ts can import this file. Re-exported from lib/auth.ts.
 */

export const AUTH_COOKIE_NAME = 'omnimetrics_token'

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to a random string of at least 32 characters')
  }
  return new TextEncoder().encode(secret)
}

export function getTokenLifetimeSeconds(): number {
  const hours = Number(process.env.JWT_EXPIRE_HOURS ?? '24')
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 3600
}

export type TokenClaims = Pick<JWTPayload, 'sub' | 'username' | 'role' | 'allowed_projects'>

export async function signToken(claims: TokenClaims): Promise<string> {
  return new SignJWT({
    username: claims.username,
    role: claims.role,
    allowed_projects: claims.allowed_projects,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${getTokenLifetimeSeconds()}s`)
    .sign(getJwtSecret())
}

/** Verifies signature + expiry and validates the claim shapes. Returns null on any failure. */
export async function verifyToken(token: string | undefined | null): Promise<JWTPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] })
    const { sub, username, role, allowed_projects, exp, iat } = payload as Record<string, unknown>

    if (typeof sub !== 'string' || typeof username !== 'string' || typeof exp !== 'number') {
      return null
    }
    if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) return null

    let projects: string[] | null
    if (allowed_projects === null) {
      projects = null
    } else if (
      Array.isArray(allowed_projects) &&
      allowed_projects.every((p) => typeof p === 'string')
    ) {
      projects = allowed_projects as string[]
    } else {
      return null
    }
    // allowed_projects is null ONLY for admin.
    if ((role === 'admin') !== (projects === null)) return null

    return {
      sub,
      username,
      role: role as Role,
      allowed_projects: projects,
      exp,
      iat: typeof iat === 'number' ? iat : undefined,
    }
  } catch {
    return null
  }
}
