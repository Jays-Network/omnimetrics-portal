import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { AddUserSchema, LinkUserSchema, UserPatchSchema } from '@/lib/admin/types'
import { BAD, badRequest, guardOrg, jsonBody, reply } from '@/lib/portal/route'

// Users. Members of THIS organisation only; ?memberships=<userId> is the director's cross-organisation view.
type Ctx = { params: Promise<{ orgSlug: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await guardOrg((await params).orgSlug, 'admin.view')
  if ('res' in g && g.res) return g.res
  const m = req.nextUrl.searchParams.get('memberships')
  if (m) return reply(await g.portal!.users.memberships(g.access!, m.slice(0, 40)))
  return reply(await g.portal!.users.list(g.access!))
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await guardOrg((await params).orgSlug, 'admin.view')
  if ('res' in g && g.res) return g.res
  const raw = await jsonBody(req)
  if (raw === BAD) return badRequest(req.headers.get('content-type')?.includes('application/json') ? 400 : 415)
  const b = z.discriminatedUnion('op', [AddUserSchema, LinkUserSchema, UserPatchSchema]).safeParse(raw)
  if (!b.success) return badRequest()
  const actor = { ...g.actor!, ip: req.headers.get('x-real-ip') }
  if (b.data.op === 'add') return reply(await g.portal!.users.add(g.access!, actor, b.data))
  if (b.data.op === 'link') return reply(await g.portal!.users.link(g.access!, actor, b.data))
  return reply(await g.portal!.users.update(g.access!, actor, b.data.userId, b.data))
}
