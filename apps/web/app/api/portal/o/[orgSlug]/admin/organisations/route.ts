import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { BAD, badRequest, guardOrg, jsonBody, reply } from '@/lib/portal/route'

// Organisations. Director sees all and manages them (403 for an org admin who tries); an org admin sees their own profile.
type Ctx = { params: Promise<{ orgSlug: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const g = await guardOrg((await params).orgSlug, 'admin.view')
  if ('res' in g && g.res) return g.res
  return reply(await g.portal!.organisations.list(g.access!))
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await guardOrg((await params).orgSlug, 'admin.view')
  if ('res' in g && g.res) return g.res
  const raw = await jsonBody(req)
  if (raw === BAD) return badRequest(req.headers.get('content-type')?.includes('application/json') ? 400 : 415)
  const b = z.discriminatedUnion('op', [
    z.object({ op: z.literal('create'), name: z.string().max(80), slug: z.string().max(60).optional() }).strict(),
    z.object({ op: z.literal('update'), id: z.string().max(60), name: z.string().max(80).optional(), status: z.enum(['active', 'suspended', 'archived']).optional() }).strict(),
  ]).safeParse(raw)
  if (!b.success) return badRequest()
  const o = g.portal!.organisations
  const actor = { ...g.actor!, ip: req.headers.get('x-real-ip') }
  return b.data.op === 'create'
    ? reply(await o.create(g.access!, actor, b.data.name, b.data.slug))
    : reply(await o.update(g.access!, actor, b.data.id, b.data))
}
