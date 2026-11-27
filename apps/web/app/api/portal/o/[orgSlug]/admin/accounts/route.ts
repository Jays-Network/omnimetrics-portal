import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { BAD, badRequest, guardOrg, jsonBody, reply, tooManyAttempts } from '@/lib/portal/route'
import { attemptKey, getClientIp, withAttemptLimit } from '@/lib/rate-limit'

// Login security for members of this organisation: sessions, revoke, reset password.
type Ctx = { params: Promise<{ orgSlug: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await guardOrg((await params).orgSlug, 'admin.view')
  if ('res' in g && g.res) return g.res
  return reply(await g.portal!.accounts.sessions(g.access!, (req.nextUrl.searchParams.get('userId') ?? '').slice(0, 40)))
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await guardOrg((await params).orgSlug, 'admin.view')
  if ('res' in g && g.res) return g.res
  const raw = await jsonBody(req)
  if (raw === BAD) return badRequest(req.headers.get('content-type')?.includes('application/json') ? 400 : 415)
  const b = z.discriminatedUnion('op', [
    z.object({ op: z.literal('revoke'), sessionId: z.string().max(60) }).strict(),
    z.object({ op: z.literal('reset'), userId: z.string().max(40) }).strict(),
  ]).safeParse(raw)
  if (!b.success) return badRequest()
  const actor = { ...g.actor!, ip: req.headers.get('x-real-ip') }
  if (b.data.op === 'revoke') return reply(await g.portal!.accounts.revoke(g.access!, actor, b.data.sessionId))
  const { userId } = b.data
  // Keyed by the person resetting (not the target), so trying one id after another is what gets limited.
  const tried = await withAttemptLimit(
    attemptKey('password.reset', actor.id, getClientIp(req)),
    async () => g.portal!.accounts.resetPassword(g.access!, actor, userId),
    (r) => (r.ok ? 'success' : 'failure'),
  )
  return tried.limited ? tooManyAttempts(tried.retryAfter) : reply(tried.result)
}
