import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_COOKIE_NAME, clearAuthCookie, verifyToken } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  // Best effort: record who logged out if the cookie is still a valid token.
  const payload = await verifyToken(request.cookies.get(AUTH_COOKIE_NAME)?.value)
  if (payload) {
    await writeAuditLog(payload.sub, 'logout', {
      username: payload.username,
      ip: getClientIp(request),
    })
  }

  const response = NextResponse.json({ ok: true })
  clearAuthCookie(response, request)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
