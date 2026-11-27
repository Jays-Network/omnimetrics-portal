import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { HostInputSchema, IntegrationInputSchema } from '@/lib/admin/types'
import { BAD, badRequest, guardOrg, jsonBody, reply } from '@/lib/portal/route'

// Integrations. Org admin and director only (404 for everyone else). Credentials are write-only:
// they enter through POST op "save" and are never returned, logged or audited.
type Ctx = { params: Promise<{ orgSlug: string }> }
const Body = z.discriminatedUnion('op', [
  z.object({ op: z.literal('save'), input: IntegrationInputSchema }).strict(),
  z.object({ op: z.literal('delete'), id: z.string().max(40) }).strict(),
  z.object({ op: z.literal('test'), id: z.string().max(40) }).strict(),
  z.object({ op: z.literal('host.add'), host: HostInputSchema }).strict(),
  z.object({ op: z.literal('host.remove'), id: z.string().max(40) }).strict(),
])

export async function GET(_req: NextRequest, { params }: Ctx) {
  const g = await guardOrg((await params).orgSlug, 'integrations.manage')
  if ('res' in g && g.res) return g.res
  const { portal, access } = g
  const rows = await portal!.integrations.list(access!)
  if (!rows.ok) return reply(rows)
  const hosts = await portal!.integrations.hosts.list(access!)
  if (!hosts.ok) return reply(hosts)
  const audit = await portal!.integrations.audit(access!)
  if (!audit.ok) return reply(audit)
  return reply({ ok: true as const, rows: rows.rows, hosts: hosts.hosts, audit: audit.entries, canManageHosts: access!.capabilities.includes('hosts.manage') })
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await guardOrg((await params).orgSlug, 'integrations.manage')
  if ('res' in g && g.res) return g.res
  const raw = await jsonBody(req)
  if (raw === BAD) return badRequest(req.headers.get('content-type')?.includes('application/json') ? 400 : 415)
  const b = Body.safeParse(raw)
  if (!b.success) return badRequest()
  const { portal, access } = g
  const actor = { ...g.actor!, ip: req.headers.get('x-real-ip') }
  const p = portal!.integrations
  switch (b.data.op) {
    case 'save': return reply(await p.save(access!, actor, b.data.input))
    case 'delete': return reply(await p.remove(access!, actor, b.data.id))
    case 'test': return reply(await p.test(access!, actor, b.data.id))
    case 'host.add': return reply(await p.hosts.add(access!, actor, b.data.host))
    case 'host.remove': return reply(await p.hosts.remove(access!, actor, b.data.id))
  }
}
