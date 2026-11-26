import type { ContentNode, ContentOp, ContentResult } from '@omnimetrics/types'
import { emptyDash } from '@/lib/builder/model'
import { applyOp, descendantIds, toClient, type StoredNode } from '../tree'
import { atLeast, isOrgAdmin, loadTree, requireView, visibleNodes, type LoadedTree } from './access'
import { withOrg } from './context'
import { contentErrorFrom } from './errors'
import type { OrgCtx } from './org'
import type { Tx } from './tx'

/** Live nodes of this organisation that this user may see. */
export async function tree(ctx: OrgCtx): Promise<ContentNode[]> {
  requireView(ctx)
  return withOrg(ctx, async (tx) => visibleNodes(await loadTree(tx, ctx)))
}

/**
 * One tree mutation. The rules (names, depth, cycles, top-level, restore) are the mock's own applyOp();
 * grants are checked first, and the result is written as a diff in the same locked transaction.
 */
export async function apply(ctx: OrgCtx, op: ContentOp): Promise<ContentResult> {
  requireView(ctx)
  try {
    return await withOrg(ctx, async (tx): Promise<ContentResult> => {
      // The same per-organisation lock the 006 trigger takes: read, decide and write without interleaving.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('app_content_nodes:' || ${ctx.org.id}::text, 0))`
      const before = await loadTree(tx, ctx)
      const denied = checkGrants(before, ctx, op)
      if (denied) return denied

      const out: { stored?: StoredNode[] } = {}
      const result = applyOp(before.stored, ctx, op, out)
      if (!result.ok) return result
      const extra = await persist(tx, ctx, op, before.stored, out.stored!, result)
      return { ok: true, nodes: visibleNodes(await loadTree(tx, ctx)), ...extra }
    })
  } catch (error) {
    const mapped = contentErrorFrom(error, op)
    if (mapped) return mapped
    throw error
  }
}

/**
 * Grant checks on top of the shared rules. An item the user cannot see is reported exactly like one that
 * does not exist (the same text applyOp uses). Returns null when applyOp may decide.
 */
function checkGrants(t: LoadedTree, ctx: OrgCtx, op: ContentOp): ContentResult | null {
  const mayEdit = ctx.capabilities.includes('dashboards.edit')
  const missing = (error: string): ContentResult => ({ ok: false, code: 'not_found', error })
  const forbidden = (error: string): ContentResult => ({ ok: false, code: 'forbidden', error })
  const needsGrant = mayEdit && !isOrgAdmin(ctx) // without the capability applyOp itself refuses
  const canEdit = (id: string) => atLeast(t, id, 'edit')

  switch (op.op) {
    case 'create':
      if (!mayEdit || op.parentId === null) return null
      if (!t.visible.has(op.parentId)) return missing('That folder no longer exists.')
      return needsGrant && !canEdit(op.parentId) ? forbidden('You do not have permission to edit dashboards here.') : null
    case 'rename':
      if (!t.visible.has(op.id)) return missing('That item no longer exists.')
      return needsGrant && !canEdit(op.id) ? forbidden('You do not have permission to rename this item.') : null
    case 'move':
      if (!t.visible.has(op.id)) return missing('That item no longer exists.')
      if (mayEdit && op.parentId !== null && !t.visible.has(op.parentId)) return { ok: false, code: 'invalid', error: 'Target folder not found.' }
      return needsGrant && (!canEdit(op.id) || (op.parentId !== null && !canEdit(op.parentId))) ? forbidden('You do not have permission to move this item.') : null
    case 'delete': {
      if (!t.visible.has(op.id)) return missing('That item no longer exists.')
      // Deleting a folder takes its contents with it, so a narrower grant further down blocks the delete.
      const all = [op.id, ...descendantIds(toClient(t.stored), op.id)]
      return needsGrant && !all.every(canEdit) ? forbidden('You do not have permission to delete this item.') : null
    }
    case 'restore': {
      const root = t.stored.find((n) => op.batchId.startsWith(`${n.id}~`) && n.deletedBatch === op.batchId)
      if (!root) return null // applyOp: "Nothing to restore."
      if (!t.level.has(root.id)) return missing('Nothing to restore.')
      return needsGrant && !canEdit(root.id) ? forbidden('You do not have permission to restore this item.') : null
    }
  }
}

type Extra = { createdId?: string; batchId?: string; deletedCount?: number }

/** Writes what applyOp changed. Soft delete stamps only the node itself; its children follow implicitly. */
async function persist(
  tx: Tx,
  ctx: OrgCtx,
  op: ContentOp,
  before: StoredNode[],
  after: StoredNode[],
  result: Extract<ContentResult, { ok: true }>,
): Promise<Extra> {
  const extra: Extra = {}
  const old = new Map(before.map((n) => [n.id, n]))

  for (const n of after) {
    const was = old.get(n.id)
    if (!was) {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO app_content_nodes (org_id, parent_id, kind, name, position, created_by)
        VALUES (${ctx.org.id}, ${n.parentId}, ${n.kind}, ${n.name}, ${n.position}, ${ctx.userId})
        RETURNING id`
      extra.createdId = row!.id
      if (n.kind === 'dashboard') await firstVersion(tx, ctx, row!.id)
      continue
    }
    const remove = op.op === 'delete' && n.id === op.id
    const revive = op.op === 'restore' && n.id === result.createdId
    if (!remove && !revive && was.parentId === n.parentId && was.name === n.name && was.position === n.position) continue
    const [row] = await tx<{ stamp: string | null }[]>`
      UPDATE app_content_nodes
         SET parent_id = ${n.parentId},
             name = ${n.name},
             position = ${n.position},
             deleted_at = CASE WHEN ${remove}::boolean THEN clock_timestamp() WHEN ${revive}::boolean THEN NULL ELSE deleted_at END,
             deleted_by = CASE WHEN ${remove}::boolean THEN ${ctx.userId}::uuid WHEN ${revive}::boolean THEN NULL ELSE deleted_by END,
             updated_at = now()
       WHERE org_id = ${ctx.org.id} AND id = ${n.id}
   RETURNING (extract(epoch FROM deleted_at) * 1000000)::bigint::text AS stamp`
    if (remove) extra.batchId = `${n.id}~${row!.stamp}`
  }

  if (op.op === 'delete') extra.deletedCount = result.deletedCount
  if (op.op === 'restore') extra.createdId = result.createdId
  return extra
}

/** A new dashboard starts with an empty version 1, so "current version" always points somewhere. */
async function firstVersion(tx: Tx, ctx: OrgCtx, nodeId: string): Promise<void> {
  await tx`
    INSERT INTO app_dashboard_versions (org_id, node_id, version, spec, note, created_by)
    VALUES (${ctx.org.id}, ${nodeId}, 1, ${tx.json(emptyDash() as never)}, 'Created', ${ctx.userId})`
  await tx`UPDATE app_content_nodes SET current_version = 1 WHERE org_id = ${ctx.org.id} AND id = ${nodeId}`
}
