'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { ChevronRight, FolderInput, FolderOpen, Folder, FolderPlus, LayoutDashboard, Pencil, Plus, Trash2, Undo2 } from 'lucide-react'
import type { ContentNode } from '@omnimetrics/types'
import { GlassPanel } from '@/components/fx/glass-panel'
import { cn } from '@/lib/utils'
import type { TreeActor } from '@/lib/portal/tree'
import { canChangeNode, childrenOf, createError, descendantIds, depthOf, moveError, pathOf, uniqueName } from '@/lib/portal/tree'
import { useWorkspace } from './workspace'

interface Row {
  node: ContentNode
  level: number
  hasChildren: boolean
  expanded: boolean
}

interface Notice {
  text: string
  tone: 'info' | 'error'
  undoBatch?: string
}

const rowDomId = (id: string) => `tree-item-${id}`

/**
 * ARIA tree over the organisation's content. Keyboard: arrows, Home/End,
 * Enter, F2 rename, Delete, M move, Alt+Up/Down reorder, Ctrl+Z undo delete.
 * Every change is sent to the server, which re-checks permission and rules.
 */
export function ContentTree() {
  const { nodes, actor, run, basePath, orgSlug } = useWorkspace()
  const router = useRouter()
  const params = useParams<{ nodeId?: string }>()
  const activeId = params.nodeId ?? null

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set(nodes.filter((n) => n.kind === 'folder' && n.parentId === null).map((n) => n.id))
    if (activeId) for (const p of pathOf(nodes, activeId)) open.add(p.id)
    return open
  })
  const [focusId, setFocusId] = useState<string | null>(activeId)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [moveFor, setMoveFor] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [undoStack, setUndoStack] = useState<{ batchId: string; name: string }[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  // Pointer drag only; the keyboard path is the M move picker, so no KeyboardSensor.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const wantFocus = useRef(false)
  const renameGuard = useRef<string | null>(null)
  const treeRef = useRef<HTMLUListElement>(null)

  // Reveal the open dashboard when navigating from elsewhere (list, link).
  useEffect(() => {
    if (!activeId) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const p of pathOf(nodes, activeId).slice(0, -1)) next.add(p.id)
      return next.size === prev.size ? prev : next
    })
    // nodes intentionally omitted: reveal on navigation only, not on every edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (parentId: string | null, level: number) => {
      for (const node of childrenOf(nodes, parentId)) {
        const kids = node.kind === 'folder' ? childrenOf(nodes, node.id) : []
        const isOpen = expanded.has(node.id)
        out.push({ node, level, hasChildren: kids.length > 0, expanded: isOpen })
        if (node.kind === 'folder' && isOpen) walk(node.id, level + 1)
      }
    }
    walk(null, 1)
    return out
  }, [nodes, expanded])

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const focusNode = focusId ? byId.get(focusId) : undefined
  // Roving tabindex: exactly one item is in the tab order.
  const tabStopId = focusNode && rows.some((r) => r.node.id === focusNode.id) ? focusNode.id : (rows.find((r) => r.node.id === activeId)?.node.id ?? rows[0]?.node.id)

  useEffect(() => {
    if (!wantFocus.current || !focusId) return
    wantFocus.current = false
    document.getElementById(rowDomId(focusId))?.focus()
  })

  useEffect(() => {
    if (renamingId) renameGuard.current = null
  }, [renamingId])

  const moveFocus = useCallback((id: string | undefined) => {
    if (!id) return
    wantFocus.current = true
    setFocusId(id)
  }, [])

  const toggle = useCallback((id: string, open?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      const want = open ?? !next.has(id)
      if (want) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const showError = (error: string) => setNotice({ text: error, tone: 'error' })

  // ---- actions ----
  async function create(kind: 'folder' | 'dashboard') {
    const parentId = focusNode ? (focusNode.kind === 'folder' ? focusNode.id : focusNode.parentId) : null
    const err = createError(nodes, actor, kind, parentId)
    if (err) return showError(err)
    const res = await run({ op: 'create', kind, parentId, name: uniqueName(nodes, parentId, kind === 'folder' ? 'New folder' : 'New dashboard') })
    if (!res.ok) return showError(res.error)
    if (parentId) toggle(parentId, true)
    setNotice(null)
    if (res.createdId) {
      wantFocus.current = false
      setFocusId(res.createdId)
      setRenamingId(res.createdId)
    }
  }

  async function commitRename(id: string, raw: string) {
    if (renameGuard.current === id) return // Enter and the following blur both land here
    renameGuard.current = id
    setRenamingId(null)
    const current = byId.get(id)
    if (!current) return
    wantFocus.current = true
    setFocusId(id)
    if (raw.trim() === current.name) return
    const res = await run({ op: 'rename', id, name: raw })
    if (!res.ok) showError(res.error)
    else setNotice(null)
  }

  async function remove(id: string) {
    const node = byId.get(id)
    if (!node) return
    if (!canChangeNode(actor, node)) return showError('You do not have permission to delete this item.')
    const list = rows.map((r) => r.node.id)
    const i = list.indexOf(id)
    const next = list[i + 1] && byId.get(list[i + 1]!)?.parentId === node.parentId ? list[i + 1] : (list[i - 1] ?? undefined)
    const res = await run({ op: 'delete', id })
    if (!res.ok) return showError(res.error)
    const count = (res.deletedCount ?? 1) - 1
    setUndoStack((s) => [...s, { batchId: res.batchId!, name: node.name }])
    setNotice({ text: `Deleted “${node.name}”${count > 0 ? ` and ${count} item${count === 1 ? '' : 's'} inside` : ''}.`, tone: 'info', undoBatch: res.batchId })
    const open = activeId && (activeId === id || descendantIds(nodes, id).includes(activeId))
    if (open) router.push(basePath)
    moveFocus(next && next !== id ? next : undefined)
  }

  async function undo(batchId?: string) {
    const target = batchId ?? undoStack[undoStack.length - 1]?.batchId
    if (!target) return
    const res = await run({ op: 'restore', batchId: target })
    if (!res.ok) return showError(res.error)
    setUndoStack((s) => s.filter((x) => x.batchId !== target))
    setNotice({ text: 'Restored.', tone: 'info' })
    if (res.createdId) moveFocus(res.createdId)
  }

  async function moveTo(id: string, parentId: string | null, index?: number) {
    setMoveFor(null)
    const err = moveError(nodes, actor, id, parentId)
    if (err) return showError(err)
    const res = await run({ op: 'move', id, parentId, index })
    if (!res.ok) return showError(res.error)
    if (parentId) toggle(parentId, true)
    setNotice({ text: `Moved “${byId.get(id)?.name}”.`, tone: 'info' })
    moveFocus(id)
  }

  async function reorder(id: string, dir: -1 | 1) {
    const node = byId.get(id)
    if (!node) return
    const sibs = childrenOf(nodes, node.parentId)
    const at = sibs.findIndex((s) => s.id === id)
    const to = at + dir
    if (to < 0 || to >= sibs.length) return
    if (!canChangeNode(actor, node)) return showError('You do not have permission to move this item.')
    const res = await run({ op: 'move', id, parentId: node.parentId, index: to })
    if (!res.ok) return showError(res.error)
    moveFocus(id)
  }

  function onDragEnd(e: DragEndEvent) {
    setDragId(null)
    const over = e.over?.id
    if (typeof over !== 'string' || !over.startsWith('drop-')) return
    const target = over === 'drop-root' ? null : over.slice(5)
    const id = String(e.active.id)
    if (byId.get(id)?.parentId === target) return
    void moveTo(id, target)
  }

  function open(row: Row) {
    if (row.node.kind === 'dashboard') router.push(`/dashboard/o/${encodeURIComponent(orgSlug)}/d/${encodeURIComponent(row.node.id)}`)
    else toggle(row.node.id)
  }

  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (renamingId || moveFor) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      void undo()
      return
    }
    if (e.ctrlKey || e.metaKey) return
    const list = rows
    const i = list.findIndex((r) => r.node.id === focusId)
    const row = list[i]
    if (!row) {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault()
        moveFocus(list[0]?.node.id)
      }
      return
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      void reorder(row.node.id, e.key === 'ArrowUp' ? -1 : 1)
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveFocus(list[Math.min(i + 1, list.length - 1)]?.node.id)
        break
      case 'ArrowUp':
        e.preventDefault()
        moveFocus(list[Math.max(i - 1, 0)]?.node.id)
        break
      case 'Home':
        e.preventDefault()
        moveFocus(list[0]?.node.id)
        break
      case 'End':
        e.preventDefault()
        moveFocus(list[list.length - 1]?.node.id)
        break
      case 'ArrowRight':
        e.preventDefault()
        if (row.node.kind === 'folder' && row.hasChildren) {
          if (!row.expanded) toggle(row.node.id, true)
          else moveFocus(list[i + 1]?.node.id)
        }
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (row.node.kind === 'folder' && row.expanded) toggle(row.node.id, false)
        else if (row.node.parentId) moveFocus(row.node.parentId)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        open(row)
        break
      case 'F2':
        e.preventDefault()
        if (canChangeNode(actor, row.node)) setRenamingId(row.node.id)
        else showError('You do not have permission to rename this item.')
        break
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        void remove(row.node.id)
        break
      case 'm':
      case 'M':
        e.preventDefault()
        if (canChangeNode(actor, row.node)) setMoveFor(row.node.id)
        else showError('You do not have permission to move this item.')
        break
    }
  }

  const canEdit = actor.capabilities.includes('dashboards.edit')
  const createParent = focusNode ? (focusNode.kind === 'folder' ? focusNode.id : focusNode.parentId) : null
  const folderBlocked = canEdit ? createError(nodes, actor, 'folder', createParent) : 'You can view dashboards but not change them.'
  const dashBlocked = canEdit ? createError(nodes, actor, 'dashboard', createParent) : 'You can view dashboards but not change them.'
  const focusChangeable = !!focusNode && canChangeNode(actor, focusNode)

  const tool = (label: string, icon: React.ReactNode, onClick: () => void, disabledReason: string | null, extra?: string) => (
    <button
      type="button"
      aria-label={label}
      title={disabledReason ? `${label}: ${disabledReason}` : label}
      aria-disabled={disabledReason ? true : undefined}
      onClick={() => (disabledReason ? undefined : onClick())}
      className={cn(
        'flex size-8 items-center justify-center rounded-md text-brand-text transition-colors hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
        disabledReason && 'cursor-not-allowed opacity-40 hover:bg-transparent',
        extra,
      )}
    >
      {icon}
    </button>
  )

  return (
    <GlassPanel tone={2} spotlight={false} sheen={false} className="flex max-h-[calc(100vh-8rem)] min-h-64 flex-col">
      <div className="flex items-center gap-0.5 border-b border-brand-border px-2 py-1.5" role="toolbar" aria-label="Tree actions">
        <span className="mr-auto px-1 font-display text-sm font-semibold">Dashboards</span>
        {tool('New folder', <FolderPlus className="size-4" aria-hidden />, () => void create('folder'), folderBlocked)}
        {tool('New dashboard', <Plus className="size-4" aria-hidden />, () => void create('dashboard'), dashBlocked)}
        {tool('Rename (F2)', <Pencil className="size-4" aria-hidden />, () => focusNode && setRenamingId(focusNode.id), focusNode ? (focusChangeable ? null : 'not allowed here') : 'select an item first')}
        {tool('Move (M)', <FolderInput className="size-4" aria-hidden />, () => focusNode && setMoveFor(focusNode.id), focusNode ? (focusChangeable ? null : 'not allowed here') : 'select an item first')}
        {tool('Delete', <Trash2 className="size-4" aria-hidden />, () => focusNode && void remove(focusNode.id), focusNode ? (focusChangeable ? null : 'not allowed here') : 'select an item first')}
        {tool('Undo delete (Ctrl+Z)', <Undo2 className="size-4" aria-hidden />, () => void undo(), undoStack.length ? null : 'nothing to undo')}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-brand-text-muted">
            Nothing here yet.{' '}
            {folderBlocked ? 'Ask an admin to create a top-level folder.' : 'Use the New folder button to start.'}
          </p>
        ) : (
          <DndContext sensors={sensors} onDragStart={(e) => setDragId(String(e.active.id))} onDragCancel={() => setDragId(null)} onDragEnd={onDragEnd}>
          <ul ref={treeRef} role="tree" aria-label="Dashboards and folders" onKeyDown={onKeyDown} className="m-0 list-none p-0">
            {rows.map((row) => {
              const { node, level } = row
              const isFolder = node.kind === 'folder'
              const isActive = node.id === activeId
              const renaming = renamingId === node.id
              const Icon = isFolder ? (row.expanded ? FolderOpen : Folder) : LayoutDashboard
              const canDrag = canChangeNode(actor, node)
              const canDrop = isFolder && !!dragId && node.id !== dragId && byId.get(dragId)?.parentId !== node.id && !moveError(nodes, actor, dragId, node.id)
              return (
                <DndItem key={node.id} id={node.id} drag={canDrag && !renaming} drop={canDrop}>
                {({ setRef, listeners, isOver, isDragging }) => (
                <li
                  ref={setRef}
                  {...listeners}
                  id={rowDomId(node.id)}
                  role="treeitem"
                  aria-level={level}
                  aria-expanded={isFolder ? row.expanded : undefined}
                  aria-selected={isActive}
                  tabIndex={node.id === tabStopId ? 0 : -1}
                  onFocus={(e) => {
                    if (e.target === e.currentTarget) setFocusId(node.id)
                  }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('input')) return
                    setFocusId(node.id)
                    open(row)
                  }}
                  className={cn(
                    'group relative flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md pr-2 text-sm outline-none transition-colors hover:bg-brand-surface focus-visible:ring-2 focus-visible:ring-brand-accent',
                    isActive && 'bg-brand-surface font-medium',
                    isDragging && 'opacity-40',
                    isOver && 'bg-brand-surface ring-2 ring-brand-accent',
                  )}
                  style={{ paddingLeft: `${(level - 1) * 14 + 6}px` }}
                >
                  {isActive ? <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-brand-accent shadow-[0_0_8px_var(--glow-1-mid)]" /> : null}
                  <ChevronRight
                    aria-hidden
                    className={cn('size-3.5 shrink-0 text-brand-text-muted transition-transform', row.expanded && 'rotate-90', !(isFolder && row.hasChildren) && 'invisible')}
                  />
                  <Icon aria-hidden className={cn('size-4 shrink-0', isFolder ? 'text-brand-text-muted' : 'text-brand-accent')} />
                  {renaming ? (
                    <input
                      autoFocus
                      defaultValue={node.name}
                      aria-label={`Rename ${node.name}`}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') void commitRename(node.id, e.currentTarget.value)
                        if (e.key === 'Escape') {
                          renameGuard.current = node.id
                          setRenamingId(null)
                          moveFocus(node.id)
                        }
                      }}
                      onBlur={(e) => void commitRename(node.id, e.currentTarget.value)}
                      className="h-6 min-w-0 flex-1 rounded border border-brand-border-strong bg-brand-surface px-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-accent"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  )}
                </li>
                )}
                </DndItem>
              )
            })}
          </ul>
          {dragId && byId.get(dragId)?.kind === 'folder' && !moveError(nodes, actor, dragId, null) && byId.get(dragId)?.parentId !== null ? <RootDrop /> : null}
          <DragOverlay dropAnimation={null}>
            {dragId ? <div className="rounded-md border border-brand-border-strong bg-brand-surface-raised px-2 py-1 text-sm shadow-lg">{byId.get(dragId)?.name}</div> : null}
          </DragOverlay>
          </DndContext>
        )}
      </div>

      {moveFor ? <MovePicker nodes={nodes} actor={actor} id={moveFor} onPick={(parentId) => void moveTo(moveFor, parentId)} onClose={() => { setMoveFor(null); moveFocus(moveFor) }} /> : null}

      <div className="min-h-9 border-t border-brand-border px-2 pb-10 pt-1.5 text-xs leading-snug break-words" role="status" aria-live="polite">
        {notice ? (
          <p className={cn('flex items-center gap-2', notice.tone === 'error' ? 'text-brand-danger' : 'text-brand-text-muted')} role={notice.tone === 'error' ? 'alert' : undefined}>
            <span className="min-w-0 flex-1">{notice.text}</span>
            {notice.undoBatch ? (
              <button type="button" onClick={() => void undo(notice.undoBatch)} className="rounded px-1.5 py-0.5 font-medium text-brand-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
                Undo
              </button>
            ) : null}
          </p>
        ) : (
          <p className="text-brand-text-muted">Arrows to move, F2 rename, M move, Delete, Ctrl+Z undo.</p>
        )}
      </div>
    </GlassPanel>
  )
}

/** Keyboard-friendly move target list: every folder the item may legally move into. */
function MovePicker({ nodes, actor, id, onPick, onClose }: { nodes: ContentNode[]; actor: TreeActor; id: string; onPick: (parentId: string | null) => void; onClose: () => void }) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const node = byId.get(id)
  const folders = nodes.filter((n) => n.kind === 'folder')
  const options: { parentId: string | null; label: string; level: number; reason: string | null }[] = []
  const showRoot = node?.kind === 'folder'
  if (showRoot) options.push({ parentId: null, label: 'Top level', level: 0, reason: moveError(nodes, actor, id, null) })
  const walk = (parentId: string | null, level: number) => {
    for (const f of childrenOf(folders, parentId)) {
      options.push({ parentId: f.id, label: f.name, level: level + 1, reason: f.id === node?.parentId ? 'already here' : moveError(nodes, actor, id, f.id) })
      walk(f.id, level + 1)
    }
  }
  walk(null, 0)
  return (
    <div role="dialog" aria-label={`Move “${node?.name ?? ''}” to`} className="border-t border-brand-border bg-brand-surface-raised p-1.5">
      <div className="mb-1 flex items-center justify-between px-1 text-xs text-brand-text-muted">
        <span>Move “{node?.name}” to…</span>
        <button type="button" onClick={onClose} className="rounded px-1 hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
          Cancel (Esc)
        </button>
      </div>
      <ul
        className="max-h-48 overflow-y-auto"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
      >
        {options.map((o, idx) => (
          <li key={o.parentId ?? 'root'} className="list-none">
            <button
              type="button"
              autoFocus={idx === options.findIndex((x) => !x.reason)}
              aria-disabled={o.reason ? true : undefined}
              title={o.reason ?? undefined}
              onClick={() => (o.reason ? undefined : onPick(o.parentId))}
              className={cn(
                'flex h-7 w-full items-center gap-1.5 rounded px-1 text-left text-sm hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
                o.reason && 'cursor-not-allowed opacity-40 hover:bg-transparent',
              )}
              style={{ paddingLeft: `${o.level * 12 + 4}px` }}
            >
              <Folder className="size-3.5 shrink-0 text-brand-text-muted" aria-hidden />
              <span className="truncate">{o.label}</span>
              {o.parentId && depthOf(nodes, o.parentId) >= 8 ? <span className="ml-auto text-[10px] text-brand-text-muted">max depth</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
  }

/** Row wrapper: draggable and (for folders) droppable. Only pointer listeners are spread, so the treeitem keeps its own ARIA and keyboard handling. */
function DndItem({ id, drag, drop, children }: { id: string; drag: boolean; drop: boolean; children: (a: { setRef: (el: HTMLElement | null) => void; listeners: ReturnType<typeof useDraggable>['listeners']; isOver: boolean; isDragging: boolean }) => ReactNode }) {
  const d = useDraggable({ id, disabled: !drag })
  const o = useDroppable({ id: `drop-${id}`, disabled: !drop })
  return children({
    setRef: (el) => {
      d.setNodeRef(el)
      o.setNodeRef(el)
    },
    listeners: d.listeners,
    isOver: o.isOver && drop,
    isDragging: d.isDragging,
  })
}

/** Shown while dragging a folder (admins only): drop to make it a top-level folder. */
function RootDrop() {
  const { setNodeRef, isOver } = useDroppable({ id: 'drop-root' })
  return (
    <div ref={setNodeRef} className={cn('mt-1 rounded-md border border-dashed border-brand-border px-2 py-2 text-center text-xs text-brand-text-muted', isOver && 'border-brand-accent text-brand-text')}>
      Drop here for top level
    </div>
  )
}
