import { SignJWT, jwtVerify } from 'jose'
import type { JWTPayload } from '@omnimetrics/types'

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

/** Identity only. Never put role, is_active or allowed_projects in the token. */
export type TokenClaims = Pick<JWTPayload, 'sub'>

export async function signToken(claims: TokenClaims): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${getTokenLifetimeSeconds()}s`)
    .sign(getJwtSecret())
}

/** Verifies signature + expiry and the claim shapes. Returns null on any failure. */
export async function verifyToken(token: string | undefined | null): Promise<JWTPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] })
    const { sub, exp, iat } = payload
    if (typeof sub !== 'string' || sub.length === 0 || typeof exp !== 'number') return null
    return { sub, exp, iat: typeof iat === 'number' ? iat : undefined }
  } catch {
    return null
  }
}
