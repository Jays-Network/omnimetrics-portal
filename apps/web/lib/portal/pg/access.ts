import { capabilitiesFor, type ContentNode, type GrantAccess, type OrgAccess, type Role } from '@omnimetrics/types'
import { toClient, type StoredNode } from '../tree'
import type { OrgCtx } from './org'
import type { Tx } from './tx'

// Shared helpers of the pg repositories (not repository functions themselves).

export interface OrgRow { id: string; slug: string; name: string }

/** Same role -> capability mapping as the mock (capabilitiesFor). Only active organisations get here. */
export function toAccess(org: OrgRow, role: Role, isPlatform: boolean): OrgAccess {
  return { org: { id: org.id, slug: org.slug, name: org.name, status: 'active' }, role, isPlatform, capabilities: capabilitiesFor(role, isPlatform) }
}

export const RANK: Record<GrantAccess, number> = { view: 1, edit: 2, manage: 3 }
export const isOrgAdmin = (a: Pick<OrgAccess, 'role' | 'isPlatform'>) => a.isPlatform || a.role === 'admin'

export interface LoadedTree {
  /** Every node of the organisation. `deletedBatch` is set on deleted nodes AND on everything below them. */
  stored: StoredNode[]
  /** Effective access of this user per node id (deleted nodes included); absent = none. */
  level: Map<string, GrantAccess>
  /** Live nodes the user may see: those with access, plus the folders leading to them. */
  visible: Set<string>
  currentVersion: Map<string, number | null>
}

interface NodeRow {
  id: string
  parent_id: string | null
  kind: ContentNode['kind']
  name: string
  position: number
  current_version: number | null
  stamp: string | null
}

/**
 * Loads the tree and applies the access rules:
 *  - org admins and the director: manage everything;
 *  - builders and viewers: default deny; the NEAREST grant wins (node, then folders upwards, then the
 *    organisation-wide grant); a viewer never exceeds view.
 */
export async function loadTree(tx: Tx, ctx: OrgCtx): Promise<LoadedTree> {
  const rows = await tx<NodeRow[]>`
    SELECT id, parent_id, kind, name, position, current_version,
           (extract(epoch FROM deleted_at) * 1000000)::bigint::text AS stamp
      FROM app_content_nodes
     WHERE org_id = ${ctx.org.id}`
  const byId = new Map(rows.map((r) => [r.id, r]))

  const batches = new Map<string, string | undefined>()
  const batchOf = (r: NodeRow): string | undefined => {
    if (!batches.has(r.id)) {
      const parent = r.parent_id ? byId.get(r.parent_id) : undefined
      // The batch id names the delete: node plus its timestamp, so a stale undo cannot restore a later delete.
      batches.set(r.id, r.stamp ? `${r.id}~${r.stamp}` : parent ? batchOf(parent) : undefined)
    }
    return batches.get(r.id)
  }

  const level = new Map<string, GrantAccess>()
  if (isOrgAdmin(ctx)) {
    for (const r of rows) level.set(r.id, 'manage')
  } else {
    const grants = await tx<{ node_id: string | null; access: GrantAccess }[]>`
      SELECT node_id, access FROM app_grants WHERE org_id = ${ctx.org.id} AND user_id = ${ctx.userId}`
    const own = new Map(grants.map((g) => [g.node_id, g.access]))
    const mayEdit = ctx.capabilities.includes('dashboards.edit')
    for (const r of rows) {
      let cur: NodeRow | undefined = r
      let found: GrantAccess | undefined
      for (let hops = 0; cur && !found && hops <= rows.length; hops++) {
        found = own.get(cur.id)
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
      }
      found ??= own.get(null)
      if (found) level.set(r.id, mayEdit ? found : 'view')
    }
  }

  const stored: StoredNode[] = rows.map((r) => {
    const batch = batchOf(r)
    return { id: r.id, parentId: r.parent_id, kind: r.kind, name: r.name, position: r.position, ...(batch ? { deletedBatch: batch } : {}) }
  })

  const visible = new Set<string>()
  for (const n of toClient(stored)) {
    if (!level.has(n.id)) continue
    let cur: string | null = n.id
    while (cur && !visible.has(cur)) {
      visible.add(cur)
      cur = byId.get(cur)?.parent_id ?? null
    }
  }

  return { stored, level, visible, currentVersion: new Map(rows.map((r) => [r.id, r.current_version])) }
}

export const visibleNodes = (t: LoadedTree): ContentNode[] => toClient(t.stored).filter((n) => t.visible.has(n.id))

export const atLeast = (t: LoadedTree, id: string, need: GrantAccess): boolean => {
  const have = t.level.get(id)
  return !!have && RANK[have] >= RANK[need]
}

export function requireView(ctx: OrgAccess): void {
  if (!ctx.capabilities.includes('dashboards.view')) throw new Error('forbidden')
}
export function requireEdit(ctx: OrgAccess): void {
  if (!ctx.capabilities.includes('dashboards.edit')) throw new Error('forbidden')
}
