import type { OrgProfile, Result } from '@/lib/admin/types'
import { writeAudit } from '@/lib/audit'
import type { Actor } from '../mock/admin' // type only
import { withOrg, withPlatform } from './context'
import { assertOrgCtx, type OrgCtx } from './org'
import { isUuid, type Tx } from './tx'

// Organisations (005). Writing and the cross-organisation list are the director's, over portal_platform.
// integrationCount and dashboardCount are NOT computed (0): the platform role has no grant on them (010).

const forbid: Result<never> = { ok: false, code: 'forbidden', error: 'Not allowed.' }
const gone: Result<never> = { ok: false, code: 'not_found', error: 'Not found' }
const invalid = (error: string): Result<never> => ({ ok: false, code: 'invalid', error })
const NAME_LENGTH = 'Name must be 2 to 60 characters.'
const NAME_TAKEN = 'An organisation with that name exists.'
const SLUG_TAKEN = 'That address (slug) is already used.'

interface Row { id: string; slug: string; name: string; status: OrgProfile['status']; members: number }
const profile = (r: Row): OrgProfile => ({ id: r.id, slug: r.slug, name: r.name, status: r.status, memberCount: r.members, integrationCount: 0, dashboardCount: 0 })

const select = (tx: Tx, id: string | null) => tx<Row[]>`
  SELECT o.id, o.slug, o.name, o.status, count(m.user_id)::int AS members
    FROM app_orgs o
    LEFT JOIN app_memberships m ON m.org_id = o.id
   WHERE ${id}::uuid IS NULL OR o.id = ${id}::uuid
   GROUP BY o.id
   ORDER BY o.name`

/** One lock for name checks across organisations (names have no unique index). */
const lockNames = (tx: Tx) => tx`SELECT pg_advisory_xact_lock(hashtextextended('app_orgs.name', 0))`

const nameTaken = async (tx: Tx, name: string, except: string | null) =>
  (await tx`SELECT 1 FROM app_orgs WHERE lower(name) = lower(${name}) AND id IS DISTINCT FROM ${except}::uuid`).length > 0

/** Director: every organisation. Org admin: their own organisation only, over the tenant path. */
export async function list(ctx: OrgCtx): Promise<Result<{ orgs: OrgProfile[] }>> {
  assertOrgCtx(ctx)
  if (!ctx.capabilities.includes('admin.view')) return forbid
  const rows = ctx.capabilities.includes('orgs.manage')
    ? await withPlatform((tx) => select(tx, null), ctx.userId)
    : await withOrg(ctx, (tx) => tx<Row[]>`
        SELECT o.id, o.slug, o.name, o.status,
               (SELECT count(*)::int FROM app_memberships m WHERE m.org_id = ${ctx.org.id}) AS members
          FROM app_orgs o
         WHERE o.id = ${ctx.org.id}`)
  return { ok: true, orgs: rows.map(profile) }
}

/** The slug is checked by the 005 CHECK and never changes afterwards. Without one it is derived from the name. */
export async function create(ctx: OrgCtx, actor: Actor, rawName: string, rawSlug?: string): Promise<Result<{ org: OrgProfile }>> {
  assertOrgCtx(ctx)
  if (!ctx.capabilities.includes('orgs.manage')) return forbid
  const name = rawName.trim()
  if (name.length < 2 || name.length > 60) return invalid(NAME_LENGTH)
  const derived = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 36).replace(/^-|-$/g, '') || 'org'
  try {
    return await withPlatform(async (tx) => {
      await lockNames(tx)
      if (await nameTaken(tx, name, null)) return invalid(NAME_TAKEN)
      let id: string | undefined
      let slug = rawSlug ?? derived
      for (let n = 2; !id; n++) {
        ;[{ id } = { id: undefined }] = await tx<{ id: string }[]>`
          INSERT INTO app_orgs (slug, name) VALUES (${slug}, ${name}) ON CONFLICT (slug) DO NOTHING RETURNING id`
        if (!id) {
          if (rawSlug !== undefined || n > 20) return invalid(SLUG_TAKEN)
          slug = `${derived}-${n}`
        }
      }
      await writeAudit({ userId: ctx.userId, orgId: id, action: 'org.create', targetType: 'org', targetId: id, detail: { name, slug }, ip: actor.ip }, tx)
      const [row] = await select(tx, id)
      return { ok: true as const, org: profile(row!) }
    }, ctx.userId)
  } catch (error) {
    const e = error as { code?: string; constraint_name?: string }
    if (e.code === '23514' && e.constraint_name === 'app_orgs_slug_format') {
      return invalid('Slug: lower-case letters, digits and hyphens (1 to 40), not starting or ending with a hyphen.')
    }
    throw error
  }
}

export async function update(ctx: OrgCtx, actor: Actor, id: string, patch: { name?: string; status?: OrgProfile['status'] }): Promise<Result<{ org: OrgProfile }>> {
  assertOrgCtx(ctx)
  if (!ctx.capabilities.includes('orgs.manage')) return forbid
  if (!isUuid(id)) return gone
  const name = patch.name?.trim()
  if (name !== undefined && (name.length < 2 || name.length > 60)) return invalid(NAME_LENGTH)
  const status = patch.status
  if (status !== undefined && !['active', 'suspended', 'archived'].includes(status)) return invalid('Unknown status.')
  return withPlatform(async (tx) => {
    await lockNames(tx)
    if (name !== undefined && (await nameTaken(tx, name, id))) return invalid(NAME_TAKEN)
    const done = await tx`
      UPDATE app_orgs SET name = coalesce(${name ?? null}, name), status = coalesce(${status ?? null}, status)
       WHERE id = ${id} RETURNING id`
    if (!done.length) return gone
    const detail = { ...(name !== undefined ? { name } : {}), ...(status ? { status } : {}) }
    await writeAudit({ userId: ctx.userId, orgId: id, action: 'org.update', targetType: 'org', targetId: id, detail, ip: actor.ip }, tx)
    const [row] = await select(tx, id)
    return { ok: true as const, org: profile(row!) }
  }, ctx.userId)
}
