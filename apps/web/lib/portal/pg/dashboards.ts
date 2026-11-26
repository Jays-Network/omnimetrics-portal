import type { ContentNode, DashboardView, GrantAccess, GrantRow } from '@omnimetrics/types'
import { appendVersion, emptyDash, normalizeSpec, parseSpec, restoreVersion, type DashSpec, type DashVersion } from '@/lib/builder/model'
import { canEditDashboard } from '@/lib/builder/settings'
import { canManageGrants } from '../mock/grants'
import type { SaveInput, SaveResult } from '../mock/versions'
import { pathOf } from '../tree'
import { RANK, atLeast, isOrgAdmin, loadTree, requireEdit, requireView, visibleNodes, type LoadedTree } from './access'
import { withOrg } from './context'
import type { OrgCtx } from './org'
import { isUuid, type Tx } from './tx'

type SetGrantsResult = { ok: true; grants: GrantRow[] } | { ok: false; code: 'forbidden' | 'not_found' | 'invalid'; error: string }

const DIRECT = 'Direct grant'

/** A live dashboard of this organisation that the user may see. */
const dashboardIn = (t: LoadedTree, nodeId: string): ContentNode | undefined =>
  visibleNodes(t).find((n) => n.id === nodeId && n.kind === 'dashboard')

/** Row lock on the node: version numbers and grant replacements are serialised per dashboard. */
async function lockNode(tx: Tx, ctx: OrgCtx, nodeId: string): Promise<void> {
  if (isUuid(nodeId)) await tx`SELECT id FROM app_content_nodes WHERE org_id = ${ctx.org.id} AND id = ${nodeId} FOR UPDATE`
}

/** Oldest first; with `only`, just that version. */
async function readVersions(tx: Tx, ctx: OrgCtx, nodeId: string, only: number | null = null): Promise<DashVersion[]> {
  const rows = await tx<{ version: number; created_at: Date; username: string | null; note: string | null; spec: unknown }[]>`
    SELECT v.version, v.created_at, u.username, v.note, v.spec
      FROM app_dashboard_versions v
      LEFT JOIN app_users u ON u.id = v.created_by
     WHERE v.org_id = ${ctx.org.id} AND v.node_id = ${nodeId}
       AND (${only}::int IS NULL OR v.version = ${only}::int)
     ORDER BY v.version`
  return rows.map((r) => ({ n: r.version, createdAt: r.created_at.toISOString(), author: r.username ?? 'system', note: r.note ?? '', spec: normalizeSpec(r.spec) }))
}

const latestSpec = (list: DashVersion[]): DashSpec => list[list.length - 1]?.spec ?? emptyDash()

/** Needs an edit grant, and a read-only dashboard refuses builders even if they call the API directly. */
function requireEditable(t: LoadedTree, ctx: OrgCtx, nodeId: string, list: DashVersion[]): void {
  if (!atLeast(t, nodeId, 'edit') || !canEditDashboard(ctx, latestSpec(list).settings)) throw new Error('forbidden')
}

/**
 * The admins' implicit access, plus one row per user holding a grant that applies here: their nearest one
 * (this dashboard, then folders upwards, then organisation-wide). Only "Direct grant" rows are editable.
 */
async function grantRows(tx: Tx, ctx: OrgCtx, t: LoadedTree, nodeId: string): Promise<GrantRow[]> {
  const chain = pathOf(t.stored, nodeId).map((n) => n.id).reverse()
  const rows = await tx<{ node_id: string | null; access: GrantAccess; username: string }[]>`
    SELECT g.node_id, g.access, u.username
      FROM app_grants g
      JOIN app_users u ON u.id = g.user_id
     WHERE g.org_id = ${ctx.org.id}`
  const distance = (id: string | null) => (id === null ? chain.length : chain.indexOf(id))
  const nearest = new Map<string, { d: number; access: GrantAccess }>()
  for (const r of rows) {
    const d = distance(r.node_id)
    const seen = nearest.get(r.username)
    if (d >= 0 && (!seen || d < seen.d)) nearest.set(r.username, { d, access: r.access })
  }
  const out: GrantRow[] = [{ principal: `${ctx.org.name} admins`, kind: 'role', access: 'manage', via: 'Organisation role' }]
  for (const [principal, g] of nearest) {
    out.push({ principal, kind: 'user', access: g.access, via: g.d === 0 ? DIRECT : g.d === chain.length ? 'Organisation grant' : 'Folder grant' })
  }
  return out.sort((a, b) => RANK[b.access] - RANK[a.access] || a.principal.localeCompare(b.principal))
}

/** A dashboard of this organisation, or null (unknown, foreign, deleted or not granted: all the same). */
export async function get(ctx: OrgCtx, nodeId: string): Promise<DashboardView | null> {
  requireView(ctx)
  return withOrg(ctx, async (tx) => {
    const t = await loadTree(tx, ctx)
    const node = dashboardIn(t, nodeId)
    if (!node) return null
    const current = t.currentVersion.get(nodeId) ?? null
    const spec = latestSpec(await readVersions(tx, ctx, nodeId, current))
    let yourAccess: GrantAccess = isOrgAdmin(ctx) ? 'manage' : t.level.get(nodeId)!
    // Read-only dashboards: builders lose Edit (admins and the director keep it).
    if (yourAccess !== 'view' && !canEditDashboard(ctx, spec.settings)) yourAccess = 'view'
    return {
      node,
      path: pathOf(visibleNodes(t), nodeId),
      spec,
      grants: yourAccess === 'view' ? [] : await grantRows(tx, ctx, t, nodeId),
      yourAccess,
    }
  })
}

/** History, oldest first. Throws 'forbidden' without edit access; null when there is no such dashboard. */
export async function versions(ctx: OrgCtx, nodeId: string): Promise<DashVersion[] | null> {
  requireEdit(ctx)
  return withOrg(ctx, async (tx) => {
    const t = await loadTree(tx, ctx)
    if (!dashboardIn(t, nodeId)) return null
    const list = await readVersions(tx, ctx, nodeId)
    requireEditable(t, ctx, nodeId, list)
    return list
  })
}

/**
 * Appends a version (a new spec, or a copy of an old one) and moves current_version, under the row lock.
 * created_by is always ctx's user; the `author` label of the interface is not trusted or stored.
 */
export async function saveVersion(ctx: OrgCtx, nodeId: string, input: SaveInput, author: string): Promise<SaveResult> {
  requireEdit(ctx)
  return withOrg(ctx, async (tx): Promise<SaveResult> => {
    await lockNode(tx, ctx, nodeId)
    const t = await loadTree(tx, ctx)
    if (!dashboardIn(t, nodeId)) return { ok: false, code: 'not_found', error: 'Not found' }
    const list = await readVersions(tx, ctx, nodeId)
    requireEditable(t, ctx, nodeId, list)

    let next: DashVersion[] | null
    if ('restore' in input) {
      next = restoreVersion(list, input.restore, author, new Date())
      if (!next) return { ok: false, code: 'not_found', error: 'No such version' }
    } else {
      const parsed = parseSpec(input.spec)
      if (!parsed.ok) return { ok: false, code: 'invalid', error: 'The dashboard spec is not valid' }
      next = appendVersion(list, parsed.spec, author, input.note?.trim() || 'Saved', new Date())
    }
    const added = next[next.length - 1]!
    await tx`
      INSERT INTO app_dashboard_versions (org_id, node_id, version, spec, note, created_by)
      VALUES (${ctx.org.id}, ${nodeId}, ${added.n}, ${tx.json(added.spec as never)}, ${added.note}, ${ctx.userId})`
    await tx`
      UPDATE app_content_nodes SET current_version = ${added.n}, updated_at = now()
       WHERE org_id = ${ctx.org.id} AND id = ${nodeId}`
    return { ok: true, versions: await readVersions(tx, ctx, nodeId) }
  })
}

/** Needs `dashboards.edit` and edit access on the dashboard. */
export async function grants(ctx: OrgCtx, nodeId: string): Promise<GrantRow[] | null> {
  requireEdit(ctx)
  return withOrg(ctx, async (tx) => {
    const t = await loadTree(tx, ctx)
    if (!dashboardIn(t, nodeId)) return null
    if (!atLeast(t, nodeId, 'edit')) throw new Error('forbidden')
    return grantRows(tx, ctx, t, nodeId)
  })
}

/**
 * Replaces the DIRECT grants of one dashboard. Inherited and role rows may be sent back unchanged (the UI
 * sends the whole list) and are ignored; changing one is refused. Principals are usernames of members of
 * this organisation; any other name gets the same answer, whether or not such a user exists elsewhere.
 */
export async function setGrants(ctx: OrgCtx, nodeId: string, rows: GrantRow[]): Promise<SetGrantsResult> {
  requireEdit(ctx)
  if (!canManageGrants(ctx)) return { ok: false, code: 'forbidden', error: 'Only an organisation admin changes who has access.' }
  const invalid = (error: string): SetGrantsResult => ({ ok: false, code: 'invalid', error })
  return withOrg(ctx, async (tx): Promise<SetGrantsResult> => {
    await lockNode(tx, ctx, nodeId)
    const t = await loadTree(tx, ctx)
    if (!dashboardIn(t, nodeId)) return { ok: false, code: 'not_found', error: 'Not found' }

    const derived = (await grantRows(tx, ctx, t, nodeId)).filter((r) => r.via !== DIRECT)
    const isDirect = (r: GrantRow) => r.kind === 'user' && r.via === DIRECT
    const unchanged = (r: GrantRow) => derived.some((d) => d.principal === r.principal && d.kind === r.kind && d.access === r.access && d.via === r.via)
    if (rows.some((r) => !isDirect(r) && !unchanged(r))) return invalid('Only direct user grants can be added or changed here.')

    const direct = rows.filter(isDirect)
    const names = direct.map((r) => r.principal)
    if (new Set(names).size !== names.length) return invalid('Each person can be listed only once.')
    const members = names.length
      ? await tx<{ user_id: string; username: string }[]>`
          SELECT m.user_id, u.username
            FROM app_memberships m
            JOIN app_users u ON u.id = m.user_id
           WHERE m.org_id = ${ctx.org.id} AND u.username IN ${tx(names)}`
      : []
    const idOf = new Map(members.map((m) => [m.username, m.user_id]))
    if (names.some((n) => !idOf.has(n))) return invalid('Every grant must name a member of this organisation.')

    await tx`DELETE FROM app_grants WHERE org_id = ${ctx.org.id} AND node_id = ${nodeId}`
    for (const r of direct) {
      await tx`
        INSERT INTO app_grants (org_id, user_id, node_id, access, created_by)
        VALUES (${ctx.org.id}, ${idOf.get(r.principal)!}, ${nodeId}, ${r.access}, ${ctx.userId})`
    }
    return { ok: true, grants: await grantRows(tx, ctx, await loadTree(tx, ctx), nodeId) }
  })
}
