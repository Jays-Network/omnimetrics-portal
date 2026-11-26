import { NextResponse, type NextRequest } from 'next/server'
import { guardOrg } from '@/lib/portal/route'
import { ContentOpSchema } from '@/lib/portal/content-schema'

const STATUS = { forbidden: 403, not_found: 404, conflict: 409, invalid: 400 } as const

export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgSlug: string }> }) {
  const g = await guardOrg((await params).orgSlug, 'dashboards.view')
  if ('res' in g && g.res) return g.res
  const nodes = await g.portal!.content.tree(g.access!)
  return NextResponse.json({ nodes }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ orgSlug: string }> }) {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Expected JSON' }, { status: 415 })
  }
  const g = await guardOrg((await params).orgSlug, 'dashboards.view')
  if ('res' in g && g.res) return g.res
  const parsed = ContentOpSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  // Deleting needs its own capability, checked here on the server (the tree rules still apply on top).
  if (parsed.data.op === 'delete' && !g.access!.capabilities.includes('dashboards.delete')) return NextResponse.json({ error: 'You do not have permission to delete.', code: 'forbidden' }, { status: 403 })
  const result = await g.portal!.content.apply(g.access!, parsed.data)
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: STATUS[result.code] })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
