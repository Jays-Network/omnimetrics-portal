import { NextResponse, type NextRequest } from 'next/server'
import { guardOrg } from '@/lib/portal/route'
import { z } from 'zod'

const Body = z.union([z.object({ spec: z.record(z.unknown()), note: z.string().max(120).optional() }).strict(), z.object({ restore: z.number().int().min(1) }).strict()])
const STATUS = { invalid: 400, not_found: 404 } as const

const FORBIDDEN = Symbol('forbidden')
const forbidden = (e: unknown): typeof FORBIDDEN => { if (e instanceof Error && e.message === 'forbidden') return FORBIDDEN; throw e }

type Ctx = { params: Promise<{ orgSlug: string; nodeId: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { orgSlug, nodeId } = await params
  const g = await guardOrg(orgSlug, 'dashboards.view')
  if ('res' in g && g.res) return g.res
  // The EDIT capability is checked here on the server too (the UI only hides buttons).
  if (!g.access!.capabilities.includes('dashboards.edit')) return NextResponse.json({ error: 'You can view dashboards but not edit them' }, { status: 403 })
  const versions = await g.portal!.dashboards.versions(g.access!, nodeId).catch(forbidden)
  if (versions === FORBIDDEN) return NextResponse.json({ error: 'This dashboard is read-only for builders.' }, { status: 403 })
  if (!versions) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ versions }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest, { params }: Ctx) {
  if (!request.headers.get('content-type')?.includes('application/json')) return NextResponse.json({ error: 'Expected JSON' }, { status: 415 })
  const { orgSlug, nodeId } = await params
  const g = await guardOrg(orgSlug, 'dashboards.view')
  if ('res' in g && g.res) return g.res
  // The EDIT capability is checked here on the server too (the UI only hides buttons).
  if (!g.access!.capabilities.includes('dashboards.edit')) return NextResponse.json({ error: 'You can view dashboards but not edit them' }, { status: 403 })
  const body = Body.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const result = await g.portal!.dashboards.saveVersion(g.access!, nodeId, body.data as never, g.actor!.username).catch(forbidden)
  if (result === FORBIDDEN) return NextResponse.json({ error: 'This dashboard is read-only for builders.' }, { status: 403 })
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: STATUS[result.code] })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
