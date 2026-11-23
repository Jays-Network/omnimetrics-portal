'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { ContentNode, ContentOp, ContentResult } from '@omnimetrics/types'
import type { TreeActor } from '@/lib/portal/tree'
import { orgBase } from '@/components/shell/nav'
import { ContentTree } from './content-tree'

interface WorkspaceValue {
  orgSlug: string
  basePath: string
  nodes: ContentNode[]
  actor: TreeActor
  /** Sends one mutation to the server; the server re-checks everything. */
  run: (op: ContentOp) => Promise<ContentResult>
}

const Ctx = createContext<WorkspaceValue | null>(null)

export function useWorkspace(): WorkspaceValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspace outside <Workspace>')
  return v
}

/**
 * Dashboards area: file tree on the left, page on the right. The tree state is
 * seeded by the server layout and then owned here; every change goes through
 * the content route handler, which enforces organisation scope and rules.
 */
export function Workspace({ orgSlug, initialNodes, actor, children }: { orgSlug: string; initialNodes: ContentNode[]; actor: TreeActor; children: ReactNode }) {
  const router = useRouter()
  const [nodes, setNodes] = useState(initialNodes)

  const run = useCallback(
    async (op: ContentOp): Promise<ContentResult> => {
      try {
        const res = await fetch(`/api/portal/o/${encodeURIComponent(orgSlug)}/content`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(op),
        })
        const body = (await res.json().catch(() => ({}))) as Partial<Extract<ContentResult, { ok: true }>> & { error?: string; code?: string }
        if (!res.ok || !body.nodes) {
          const code = res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found' : res.status === 409 ? 'conflict' : 'invalid'
          return { ok: false, code, error: body.error ?? 'Something went wrong.' }
        }
        setNodes(body.nodes)
        router.refresh() // re-render the open dashboard (title, breadcrumbs) from the server
        return { ok: true, nodes: body.nodes, createdId: body.createdId, batchId: body.batchId, deletedCount: body.deletedCount }
      } catch {
        return { ok: false, code: 'invalid', error: 'Network error. Try again.' }
      }
    },
    [orgSlug, router],
  )

  const value = useMemo<WorkspaceValue>(() => ({ orgSlug, basePath: `${orgBase(orgSlug)}/dashboards`, nodes, actor, run }), [orgSlug, nodes, actor, run])

  return (
    <Ctx.Provider value={value}>
      <div className="grid gap-3 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
        <aside aria-label="Content tree" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <ContentTree />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </Ctx.Provider>
  )
}
