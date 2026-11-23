import type { OrgAccess } from '@omnimetrics/types'
import type { StoredNode } from '../tree'
import { seedFor } from './seed'

// In-memory per-organisation store, kept on globalThis so Next's dev bundler and
// route handlers share one copy. Keyed by org id: a node id from another
// organisation is simply absent here (isolation is asserted in tests).
const g = globalThis as unknown as { __omniMockContent?: Map<string, StoredNode[]> }

export function mockStore(access: Pick<OrgAccess, 'org'>): StoredNode[] {
  const map = (g.__omniMockContent ??= new Map())
  let nodes = map.get(access.org.id)
  if (!nodes) {
    nodes = seedFor(access.org.slug)
    map.set(access.org.id, nodes)
  }
  return nodes
}

export function setMockStore(access: Pick<OrgAccess, 'org'>, nodes: StoredNode[]): void {
  ;(g.__omniMockContent ??= new Map()).set(access.org.id, nodes)
}

/** Test helper and "reset demo data". */
export function resetMockContent(): void {
  g.__omniMockContent = new Map()
}
