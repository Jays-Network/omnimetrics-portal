import { NextResponse, type NextRequest } from 'next/server'
import { guardOrg } from '@/lib/portal/route'
import { z } from 'zod'
import { GrantsSchema } from '@/lib/portal/mock/grants'

// Reading needs edit; writing needs org admin or director (checked in the portal).
const STATUS = { forbidden: 403, not_found: 404, invalid: 400 } as const
const FORBIDDEN = Symbol('forbidden')
const forbidden = (e: unknown): typeof FORBIDDEN => { if (e instanceof Error && e.message === 'forbidden') return FORBIDDEN; throw e }
type Ctx = { params: Promise<{ orgSlug: string; nodeId: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { orgSlug, nodeId } = await params
  const g = await guardOrg(orgSlug, 'dashboards.view')
  if ('res' in g && g.res) return g.res
  if (!g.access!.capabilities.includes('dashboards.edit')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const grants = await g.portal!.dashboards.grants(g.access!, nodeId).catch(forbidden)
  if (grants === FORBIDDEN) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return grants ? NextResponse.json({ grants }, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  if (!request.headers.get('content-type')?.includes('application/json')) return NextResponse.json({ error: 'Expected JSON' }, { status: 415 })
  const { orgSlug, nodeId } = await params
  const g = await guardOrg(orgSlug, 'dashboards.view')
  if ('res' in g && g.res) return g.res
  if (!g.access!.capabilities.includes('dashboards.edit')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = z.object({ grants: GrantsSchema }).strict().safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const r = await g.portal!.dashboards.setGrants(g.access!, nodeId, body.data.grants.map((x) => ({ ...x, via: x.via || 'Direct grant' })))
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: STATUS[r.code] })
}
