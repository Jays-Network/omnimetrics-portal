import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { PREVIEW_COOKIE, parsePreview, previewOptions } from '@/lib/portal/preview'
import { getPortal } from '@/lib/portal'
import { resolveAccess } from '@/lib/portal/org'

const Body = z.object({ role: z.string().nullable() })

/** Dev-only. Sets or clears the reduce-only role preview. Refused outside the mock portal. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  let portal
  try {
    portal = await getPortal()
  } catch {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }
  if (portal.mode !== 'mock' || process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Not available' }, { status: 404 })

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const role = parsePreview(parsed.data.role)
  const res = NextResponse.json({ ok: true, role })
  if (role === null) {
    res.cookies.set(PREVIEW_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  }
  // Reduce-only: refuse a role at or above what this account really holds.
  const { real } = await resolveAccess(user)
  const allowed = previewOptions(real.sort((a, b) => Number(b.isPlatform) - Number(a.isPlatform))[0])
  if (!allowed.includes(role)) return NextResponse.json({ error: 'Preview can only reduce access' }, { status: 403 })
  res.cookies.set(PREVIEW_COOKIE, role, { path: '/', sameSite: 'strict', httpOnly: true, maxAge: 60 * 60 * 8 })
  return res
}
