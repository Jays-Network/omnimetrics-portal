/** Portal content tree (docs/PLAN_BUILDER.md section 2). Portal-owned, separate from tracking `folder_name`. */

export const MAX_TREE_DEPTH = 8
export const MAX_NAME_LENGTH = 60

export type NodeKind = 'folder' | 'dashboard'

/** One tree node as the UI sees it. Soft-deleted nodes are never sent to clients. */
export interface ContentNode {
  id: string
  /** null = top level (folders only). */
  parentId: string | null
  kind: NodeKind
  name: string
  /** Order among siblings. */
  position: number
}

/** Every tree mutation. The server resolves ids inside the caller's organisation only. */
export type ContentOp =
  | { op: 'create'; kind: NodeKind; parentId: string | null; name: string }
  | { op: 'rename'; id: string; name: string }
  | { op: 'move'; id: string; parentId: string | null; index?: number }
  | { op: 'delete'; id: string }
  | { op: 'restore'; batchId: string }

export type ContentErrorCode = 'forbidden' | 'not_found' | 'conflict' | 'invalid'

export type ContentResult =
  | { ok: true; nodes: ContentNode[]; createdId?: string; batchId?: string; deletedCount?: number }
  | { ok: false; code: ContentErrorCode; error: string }

export type GrantAccess = 'view' | 'edit' | 'manage'

/** One row of the read-only Access panel. */
export interface GrantRow {
  principal: string
  kind: 'role' | 'user' | 'group'
  access: GrantAccess
  /** Where the access comes from, e.g. "Organisation role" or "Folder grant". */
  via: string
}

export interface DashboardView {
  node: ContentNode
  /** Root-first, ends with the dashboard itself. */
  path: ContentNode[]
  /** The dashboard spec (latest version), validated server side; the viewer renders it with the same artboard as the editor. */
  spec: unknown
  /** Empty for roles that may not see the grant list. */
  grants: GrantRow[]
  yourAccess: GrantAccess
}
