import {
  MAX_NAME_LENGTH,
  MAX_TREE_DEPTH,
  type ContentErrorCode,
  type ContentNode,
  type ContentOp,
  type ContentResult,
  type OrgAccess,
} from '@omnimetrics/types'

/** Stored node: soft delete marks a whole subtree with one batch id so undo restores it exactly. */
export interface StoredNode extends ContentNode {
  deletedBatch?: string
}

/** Subset of OrgAccess the tree rules need. */
export type TreeActor = Pick<OrgAccess, 'role' | 'isPlatform' | 'capabilities'>

type Fail = Extract<ContentResult, { ok: false }>
const fail = (code: ContentErrorCode, error: string): Fail => ({ ok: false, code, error })

const live = (nodes: readonly StoredNode[]) => nodes.filter((n) => !n.deletedBatch)
const byPosition = (a: ContentNode, b: ContentNode) => a.position - b.position || a.name.localeCompare(b.name)

export function toClient(nodes: readonly StoredNode[]): ContentNode[] {
  return live(nodes)
    .map(({ id, parentId, kind, name, position }) => ({ id, parentId, kind, name, position }))
    .sort(byPosition)
}

export function childrenOf(nodes: readonly ContentNode[], parentId: string | null): ContentNode[] {
  return nodes.filter((n) => n.parentId === parentId).sort(byPosition)
}

/** Depth of a node: top level = 1. */
export function depthOf(nodes: readonly ContentNode[], id: string | null): number {
  let d = 0
  let cur = id
  const seen = new Set<string>()
  while (cur !== null) {
    if (seen.has(cur)) break
    seen.add(cur)
    const n = nodes.find((x) => x.id === cur)
    if (!n) break
    d++
    cur = n.parentId
  }
  return d
}

/** Root-first chain of nodes ending with `id`. */
export function pathOf(nodes: readonly ContentNode[], id: string): ContentNode[] {
  const out: ContentNode[] = []
  let cur: string | null = id
  const seen = new Set<string>()
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur)
    const n = nodes.find((x) => x.id === cur)
    if (!n) break
    out.unshift(n)
    cur = n.parentId
  }
  return out
}

export function descendantIds(nodes: readonly ContentNode[], id: string): string[] {
  const out: string[] = []
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const n of nodes) {
      if (n.parentId === cur) {
        out.push(n.id)
        stack.push(n.id)
      }
    }
  }
  return out
}

/** Number of levels below `id` (a leaf = 0). */
function height(nodes: readonly ContentNode[], id: string): number {
  const kids = nodes.filter((n) => n.parentId === id)
  return kids.length === 0 ? 0 : 1 + Math.max(...kids.map((k) => height(nodes, k.id)))
}

/** "New folder", "New folder 2", ... unique among the siblings under `parentId`. */
export function uniqueName(nodes: readonly ContentNode[], parentId: string | null, base: string): string {
  const taken = new Set(nodes.filter((n) => n.parentId === parentId).map((n) => n.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

export function validName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (!name) return { ok: false, error: 'Name cannot be empty.' }
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `Name is longer than ${MAX_NAME_LENGTH} characters.` }
  // Control characters and path separators only; names are plain text, rendered escaped.
  if (/[\u0000-\u001f\u007f/\\]/.test(name)) return { ok: false, error: 'Name contains characters that are not allowed.' }
  return { ok: true, name }
}

const isAdmin = (a: TreeActor) => a.isPlatform || a.role === 'admin'
const canEdit = (a: TreeActor) => a.capabilities.includes('dashboards.edit')

/**
 * Who may change a node: needs `dashboards.edit`, and top-level folders are
 * admin-only (Jay F3: a builder works inside folders, only an admin creates
 * top-level ones). Mock rule until real grants arrive in M5.
 */
export function canChangeNode(actor: TreeActor, node: ContentNode): boolean {
  return canEdit(actor) && (node.parentId !== null || isAdmin(actor))
}

/** Can a node of `kind` be created directly under `parentId` by this actor? Returns an error text or null. */
export function createError(nodes: readonly ContentNode[], actor: TreeActor, kind: ContentNode['kind'], parentId: string | null): string | null {
  if (!canEdit(actor)) return 'You do not have permission to edit dashboards here.'
  if (parentId === null) {
    if (kind !== 'folder') return 'Dashboards live inside a folder.'
    return isAdmin(actor) ? null : 'Only an admin creates top-level folders.'
  }
  const parent = nodes.find((n) => n.id === parentId)
  if (!parent) return 'That folder no longer exists.'
  if (parent.kind !== 'folder') return 'Items can only be created inside a folder.'
  if (depthOf(nodes, parentId) + 1 > MAX_TREE_DEPTH) return `Folders can be nested at most ${MAX_TREE_DEPTH} levels deep.`
  return null
}

/** Why `id` cannot move under `parentId` (or null when it can). Shared by the UI move menu and the server. */
export function moveError(nodes: readonly ContentNode[], actor: TreeActor, id: string, parentId: string | null): string | null {
  const node = nodes.find((n) => n.id === id)
  if (!node) return 'That item no longer exists.'
  if (!canChangeNode(actor, node)) return 'You do not have permission to move this item.'
  if (parentId === null) {
    if (node.kind !== 'folder') return 'Dashboards live inside a folder.'
    if (!isAdmin(actor)) return 'Only an admin creates top-level folders.'
  } else {
    const target = nodes.find((n) => n.id === parentId)
    if (!target || target.kind !== 'folder') return 'Target folder not found.'
    if (parentId === id || descendantIds(nodes, id).includes(parentId)) return 'A folder cannot move into itself.'
    if (depthOf(nodes, parentId) + 1 + height(nodes, id) > MAX_TREE_DEPTH) return `That would nest deeper than ${MAX_TREE_DEPTH} levels.`
  }
  if (node.parentId !== parentId) {
    const clash = nodes.some((n) => n.id !== id && n.parentId === parentId && n.name.toLowerCase() === node.name.toLowerCase())
    if (clash) return `An item named “${node.name}” already exists there.`
  }
  return null
}

function reindex(nodes: StoredNode[], orderedIds: string[]): void {
  orderedIds.forEach((id, i) => {
    const n = nodes.find((x) => x.id === id)
    if (n) n.position = i
  })
}

let counter = 0
export function newId(prefix = 'n'): string {
  counter += 1
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : `${Date.now().toString(36)}${counter}`
  return `${prefix}-${rand}`
}

/**
 * Applies one operation to an organisation's stored nodes. Pure apart from the
 * id generator; the input is not mutated. On success `out.stored` (when given)
 * receives the new stored list, including soft-deleted nodes. `nodes` must already be scoped to ONE
 * organisation: ids from another organisation simply do not exist here.
 */
export function applyOp(stored: readonly StoredNode[], actor: TreeActor, op: ContentOp, out?: { stored?: StoredNode[] }): ContentResult {
  const nodes: StoredNode[] = stored.map((n) => ({ ...n }))
  const visible = toClient(nodes)
  const done = (extra: Partial<Extract<ContentResult, { ok: true }>> = {}): ContentResult => {
    if (out) out.stored = nodes
    return { ok: true, nodes: toClient(nodes), ...extra }
  }

  switch (op.op) {
    case 'create': {
      const nm = validName(op.name)
      if (!nm.ok) return fail('invalid', nm.error)
      const err = createError(visible, actor, op.kind, op.parentId)
      if (err) return fail(err.startsWith('That folder no longer') ? 'not_found' : 'forbidden', err)
      if (visible.some((n) => n.parentId === op.parentId && n.name.toLowerCase() === nm.name.toLowerCase())) {
        return fail('conflict', `An item named “${nm.name}” already exists here.`)
      }
      const siblings = childrenOf(visible, op.parentId)
      const id = newId(op.kind === 'folder' ? 'f' : 'd')
      nodes.push({ id, parentId: op.parentId, kind: op.kind, name: nm.name, position: siblings.length })
      return done({ createdId: id })
    }

    case 'rename': {
      const node = visible.find((n) => n.id === op.id)
      if (!node) return fail('not_found', 'That item no longer exists.')
      if (!canChangeNode(actor, node)) return fail('forbidden', 'You do not have permission to rename this item.')
      const nm = validName(op.name)
      if (!nm.ok) return fail('invalid', nm.error)
      if (visible.some((n) => n.id !== op.id && n.parentId === node.parentId && n.name.toLowerCase() === nm.name.toLowerCase())) {
        return fail('conflict', `An item named “${nm.name}” already exists here.`)
      }
      nodes.find((n) => n.id === op.id)!.name = nm.name
      return done()
    }

    case 'move': {
      const node = visible.find((n) => n.id === op.id)
      if (!node) return fail('not_found', 'That item no longer exists.')
      const err = moveError(visible, actor, op.id, op.parentId)
      if (err) return fail(err.includes('already exists') ? 'conflict' : err.includes('permission') || err.includes('Only an admin') ? 'forbidden' : 'invalid', err)
      // Soft-deleted descendants move along and can be restored later, so they count towards the depth limit too (as in the database).
      if (op.parentId !== null && depthOf(visible, op.parentId) + 1 + height(nodes, op.id) > MAX_TREE_DEPTH) {
        return fail('invalid', `That would nest deeper than ${MAX_TREE_DEPTH} levels.`)
      }
      const target = nodes.find((n) => n.id === op.id)!
      const oldParent = target.parentId
      target.parentId = op.parentId
      const siblings = childrenOf(toClient(nodes), op.parentId)
        .filter((n) => n.id !== op.id)
        .map((n) => n.id)
      const at = op.index === undefined ? siblings.length : Math.max(0, Math.min(op.index, siblings.length))
      siblings.splice(at, 0, op.id)
      reindex(nodes, siblings)
      if (oldParent !== op.parentId) {
        reindex(nodes, childrenOf(toClient(nodes), oldParent).map((n) => n.id))
      }
      return done()
    }

    case 'delete': {
      const node = visible.find((n) => n.id === op.id)
      if (!node) return fail('not_found', 'That item no longer exists.')
      if (!canChangeNode(actor, node)) return fail('forbidden', 'You do not have permission to delete this item.')
      const batchId = newId('del')
      const ids = new Set([op.id, ...descendantIds(visible, op.id)])
      for (const n of nodes) if (ids.has(n.id)) n.deletedBatch = batchId
      reindex(nodes, childrenOf(toClient(nodes), node.parentId).map((n) => n.id))
      return done({ batchId, deletedCount: ids.size })
    }

    case 'restore': {
      const batch = nodes.filter((n) => n.deletedBatch === op.batchId)
      if (batch.length === 0) return fail('not_found', 'Nothing to restore.')
      const inBatch = new Set(batch.map((n) => n.id))
      const root = batch.find((n) => n.parentId === null || !inBatch.has(n.parentId))!
      if (!canChangeNode(actor, root)) return fail('forbidden', 'You do not have permission to restore this item.')
      if (root.parentId !== null && !visible.some((n) => n.id === root.parentId)) {
        return fail('conflict', 'Its folder was deleted too. Restore the folder first.')
      }
      const others = visible.filter((n) => n.parentId === root.parentId)
      let name = root.name
      for (let i = 1; others.some((n) => n.name.toLowerCase() === name.toLowerCase()); i++) {
        name = i === 1 ? `${root.name} (restored)` : `${root.name} (restored ${i})`
      }
      root.name = name
      root.position = others.length
      for (const n of batch) delete n.deletedBatch
      return done({ createdId: root.id })
    }
  }
}
