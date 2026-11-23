import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { BAD, badRequest, guardOrg, jsonBody, reply } from '@/lib/portal/route'

// MOCK login security for members of this organisation: sessions, revoke, reset password.
type Ctx = { params: Promise<{ orgSlug: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await guardOrg((await params).orgSlug, 'admin.view')
  if ('res' in g && g.res) return g.res
  return reply(g.portal!.accounts.sessions(g.access!, (req.nextUrl.searchParams.get('userId') ?? '').slice(0, 40)))
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
  return b.data.op === 'revoke' ? reply(g.portal!.accounts.revoke(g.access!, g.actor!, b.data.sessionId)) : reply(g.portal!.accounts.resetPassword(g.access!, g.actor!, b.data.userId))
}
