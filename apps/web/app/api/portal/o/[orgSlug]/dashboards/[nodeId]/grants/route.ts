import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { resolveAccess } from '@/lib/portal/org'
import { GrantsSchema } from '@/lib/portal/mock/grants'

// MOCK grants (M3.3). Real grants arrive in M5. Reading needs edit; writing needs org admin or director (checked in the portal).
async function guard(orgSlug: string) {
  const user = await getCurrentUser()
  if (!user) return { res: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) }
  const { portal, accessible } = await resolveAccess(user)
  const access = accessible.find((a) => a.org.slug === orgSlug)
  if (!access || !access.capabilities.includes('dashboards.view')) return { res: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (!access.capabilities.includes('dashboards.edit')) return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { portal, access }
}
type Ctx = { params: Promise<{ orgSlug: string; nodeId: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { orgSlug, nodeId } = await params
  const g = await guard(orgSlug)
  if ('res' in g && g.res) return g.res
  const grants = await g.portal!.dashboards.grants(g.access!, nodeId)
  return grants ? NextResponse.json({ grants }, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  if (!request.headers.get('content-type')?.includes('application/json')) return NextResponse.json({ error: 'Expected JSON' }, { status: 415 })
  const { orgSlug, nodeId } = await params
  const g = await guard(orgSlug)
  if ('res' in g && g.res) return g.res
  const body = z.object({ grants: GrantsSchema }).strict().safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const r = await g.portal!.dashboards.setGrants(g.access!, nodeId, body.data.grants.map((x) => ({ ...x, via: x.via || 'Direct grant' })))
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.code === 'forbidden' ? 403 : 404 })
}
