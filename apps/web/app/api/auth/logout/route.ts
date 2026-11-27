import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_COOKIE_NAME, clearAuthCookie, invalidateUserCache, verifyToken } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  // Best effort: record who logged out if the cookie is still a valid token.
  const payload = await verifyToken(request.cookies.get(AUTH_COOKIE_NAME)?.value)
  if (payload) {
    invalidateUserCache(payload.sub)
    await writeAudit({ userId: payload.sub, action: 'logout', ip: request.headers.get('x-real-ip') })
  }

  const response = NextResponse.json({ ok: true })
  clearAuthCookie(response, request)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
