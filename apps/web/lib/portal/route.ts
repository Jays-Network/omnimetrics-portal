import { NextResponse, type NextRequest } from 'next/server'
import type { Capability } from '@omnimetrics/types'
import { getCurrentUser } from '@/lib/auth'
import { redact } from '@/lib/admin/redact'
import type { Result } from '@/lib/admin/types'
import { TOO_MANY_ATTEMPTS } from '@/lib/rate-limit'
import { resolveAccess, resolveOrg } from './org'

// Shared guard for every org-scoped API route. Order matters and fails closed:
// 401 no session; 404 when the organisation is not one the user may enter OR the user lacks the section capability
// (existence and the section are not confirmed); finer actions inside a visible section answer 403 from the portal.
export async function guardOrg(orgSlug: string, cap: Capability) {
  const user = await getCurrentUser()
  if (!user) return { res: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) }
  const resolved = await resolveAccess(user)
  const access = await resolveOrg(user, resolved, orgSlug, cap)
  if (!access) return { res: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { portal: resolved.portal, access, actor: { id: user.id, username: user.username } }
}

export async function guardUser() {
  const user = await getCurrentUser()
  if (!user) return { res: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) }
  const { portal } = await resolveAccess(user)
  return { portal, actor: { id: user.id, username: user.username } }
}

const STATUS = { forbidden: 403, not_found: 404, invalid: 400, rate_limited: 429 } as const
/** Every response goes through redact(): even a bug upstream cannot echo a credentials field. */
export function reply<T extends object>(r: Result<T>, pick?: (r: Extract<Result<T>, { ok: true }>) => unknown) {
  const headers = { 'Cache-Control': 'no-store' }
  if (r.ok) return NextResponse.json(redact(pick ? pick(r) : r), { headers })
  return NextResponse.json({ error: r.error, code: r.code }, { status: STATUS[r.code], headers })
}

/** Locked out: the same message and Retry-After as login. */
export const tooManyAttempts = (retryAfter: number) =>
  NextResponse.json({ error: TOO_MANY_ATTEMPTS, code: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } })

export async function jsonBody(req: NextRequest): Promise<unknown | typeof BAD> {
  if (!req.headers.get('content-type')?.includes('application/json')) return BAD
  return (await req.json().catch(() => BAD)) as unknown
}
export const BAD = Symbol('bad')
export const badRequest = (status = 400) => NextResponse.json({ error: status === 415 ? 'Expected JSON' : 'Invalid request' }, { status })
