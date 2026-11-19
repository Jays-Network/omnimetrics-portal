import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_COOKIE_NAME, verifyToken } from '@/lib/jwt'

/**
 * Redirect convenience ONLY, not the security boundary. Every protected page
 * and API route must call requireAuth() / getCurrentUser() itself.
 * Route guard: unauthenticated requests for /dashboard/* and /admin/* go to
 * /login. This verifies the JWT signature and expiry (not just that the cookie
 * exists). It runs on the edge, so it cannot check app_users.is_active;
 * requireAuth() / getCurrentUser() do that on the server for every real request.
 */
export async function middleware(request: NextRequest) {
  const payload = await verifyToken(request.cookies.get(AUTH_COOKIE_NAME)?.value)
  if (payload) return NextResponse.next()

  const loginUrl = new URL('/login', request.url)
  const { pathname, search } = request.nextUrl
  loginUrl.searchParams.set('next', `${pathname}${search}`)

  const response = NextResponse.redirect(loginUrl)
  // Drop a stale/forged cookie so it is not resent on every request.
  if (request.cookies.has(AUTH_COOKIE_NAME)) {
    response.cookies.delete(AUTH_COOKIE_NAME)
  }
  return response
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
}
