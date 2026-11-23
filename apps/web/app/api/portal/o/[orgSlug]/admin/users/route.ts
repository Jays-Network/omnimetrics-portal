import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { AddUserSchema, UserPatchSchema } from '@/lib/admin/types'
import { BAD, badRequest, guardOrg, jsonBody, reply } from '@/lib/portal/route'

// MOCK users. Members of THIS organisation only; ?memberships=<userId> is the director's cross-organisation view.
type Ctx = { params: Promise<{ orgSlug: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await guardOrg((await params).orgSlug, 'admin.view')
  if ('res' in g && g.res) return g.res
  const m = req.nextUrl.searchParams.get('memberships')
  if (m) return reply(g.portal!.users.memberships(g.access!, m.slice(0, 40)))
  return reply(g.portal!.users.list(g.access!))
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await guardOrg((await params).orgSlug, 'admin.view')
  if ('res' in g && g.res) return g.res
  const raw = await jsonBody(req)
  if (raw === BAD) return badRequest(req.headers.get('content-type')?.includes('application/json') ? 400 : 415)
  const b = z.discriminatedUnion('op', [AddUserSchema, UserPatchSchema]).safeParse(raw)
  if (!b.success) return badRequest()
  if (b.data.op === 'add') return reply(g.portal!.users.add(g.access!, g.actor!, b.data))
  return reply(g.portal!.users.update(g.access!, g.actor!, b.data.userId, b.data))
}
