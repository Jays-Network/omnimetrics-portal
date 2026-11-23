import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { BAD, badRequest, guardUser, jsonBody, reply } from '@/lib/portal/route'

// MOCK "My account": always the signed-in person, never an id from the request.
export async function GET() {
  const g = await guardUser()
  if ('res' in g && g.res) return g.res
  return reply(g.portal!.account.sessions(g.actor!))
}

export async function POST(req: NextRequest) {
  const g = await guardUser()
  if ('res' in g && g.res) return g.res
  const raw = await jsonBody(req)
  if (raw === BAD) return badRequest(req.headers.get('content-type')?.includes('application/json') ? 400 : 415)
  const b = z.discriminatedUnion('op', [
    z.object({ op: z.literal('revoke'), sessionId: z.string().max(80) }).strict(),
    z.object({ op: z.literal('password'), current: z.string().max(200), next: z.string().max(200) }).strict(),
  ]).safeParse(raw)
  if (!b.success) return badRequest()
  return b.data.op === 'revoke' ? reply(g.portal!.account.revoke(g.actor!, b.data.sessionId)) : reply(g.portal!.account.changePassword(g.actor!, b.data.current, b.data.next))
}
