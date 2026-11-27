import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { PartialSettingsSchema, SETTING_KEYS } from '@/lib/settings/model'
import { BAD, badRequest, guardOrg, jsonBody, reply } from '@/lib/portal/route'

// Settings in three scopes. DISPLAY ONLY (R6): nothing here changes how data is counted or bucketed.
type Ctx = { params: Promise<{ orgSlug: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const g = await guardOrg((await params).orgSlug, 'settings.view')
  if ('res' in g && g.res) return g.res
  return reply(await g.portal!.settings.get(g.access!, g.actor!))
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const g = await guardOrg((await params).orgSlug, 'settings.view')
  if ('res' in g && g.res) return g.res
  const raw = await jsonBody(req)
  if (raw === BAD) return badRequest(req.headers.get('content-type')?.includes('application/json') ? 400 : 415)
  const b = z.object({ scope: z.enum(['system', 'org', 'user']), set: PartialSettingsSchema.default({}), unset: z.array(z.enum(SETTING_KEYS)).default([]) }).strict().safeParse(raw)
  if (!b.success) return badRequest()
  return reply(await g.portal!.settings.set(g.access!, { ...g.actor!, ip: req.headers.get('x-real-ip') }, b.data.scope, b.data.set, b.data.unset))
}
