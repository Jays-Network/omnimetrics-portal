import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { WRONG_CURRENT } from '@/lib/admin/password'
import type { Result } from '@/lib/admin/types'
import { reissueSessionCookie } from '@/lib/auth'
import { BAD, badRequest, guardUser, jsonBody, reply, tooManyAttempts } from '@/lib/portal/route'
import { attemptKey, getClientIp, withAttemptLimit } from '@/lib/rate-limit'

// "My account": always the signed-in person, never an id from the request.
export async function GET() {
  const g = await guardUser()
  if ('res' in g && g.res) return g.res
  return reply(await g.portal!.account.sessions(g.actor!))
}

export async function POST(req: NextRequest) {
  const g = await guardUser()
  if ('res' in g && g.res) return g.res
  const raw = await jsonBody(req)
  if (raw === BAD) return badRequest(req.headers.get('content-type')?.includes('application/json') ? 400 : 415)
  const b = z.discriminatedUnion('op', [
    z.object({ op: z.literal('revoke'), sessionId: z.string().max(80) }).strict(),
    z.object({ op: z.literal('password'), current: z.string().max(200), next: z.string().max(200) }).strict(),
    z.object({ op: z.literal('revoke_all') }).strict(),
  ]).safeParse(raw)
  if (!b.success) return badRequest()
  const actor = { ...g.actor!, ip: req.headers.get('x-real-ip') }
  // The new session version stays on the server: it only goes into this session's re-issued cookie.
  const keepSignedIn = async (r: Result<{ message: string; tokenVersion?: number }>) => {
    const response = reply(r, ({ message }) => ({ ok: true, message }))
    if (r.ok && r.tokenVersion !== undefined) await reissueSessionCookie(response, req, actor.id, r.tokenVersion)
    return response
  }
  if (b.data.op === 'revoke') return reply(await g.portal!.account.revoke(actor, b.data.sessionId))
  if (b.data.op === 'revoke_all') return keepSignedIn(await g.portal!.account.revokeSessions(actor))
  const { current, next } = b.data
  const tried = await withAttemptLimit(
    attemptKey('password.change', actor.id, getClientIp(req)),
    async () => g.portal!.account.changePassword(actor, current, next),
    (r) => (r.ok ? 'success' : r.error === WRONG_CURRENT ? 'failure' : 'neutral'),
  )
  return tried.limited ? tooManyAttempts(tried.retryAfter) : keepSignedIn(tried.result)
}
