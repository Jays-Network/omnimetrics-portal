'use client'

import { useEffect, useMemo, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ChevronDown, Search, Star } from 'lucide-react'
import { CATEGORIES, type PanelType } from '@/lib/panels/types'
import { PANEL_TYPES } from '@/lib/panels/registry'
import { cn } from '@/lib/utils'

const FAV_KEY = 'omni-fav-panels'
const RECENT_KEY = 'omni-recent-panels'
const OPEN_KEY = 'omni-assets-open'
const RECENT_MAX = 5

function loadList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function Asset({ scope, type, fav, onFav, selected, onSelect, onAdd }: { scope?: string; type: PanelType<any>; fav: boolean; onFav: () => void; selected: boolean; onSelect: () => void; onAdd: () => void }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const soon = !!type.soon || !type.render
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `asset:${type.id}${scope ? `~${scope}` : ''}`, disabled: soon })
  const Icon = type.icon
  return (
    <li ref={setNodeRef} className={cn('flex list-none items-center gap-1 rounded-md pr-1 hover:bg-brand-surface', selected && 'bg-brand-surface', isDragging && 'opacity-40')}>
      <button
        type="button"
        {...listeners}
        aria-disabled={soon || undefined}
        aria-pressed={selected}
        title={soon ? `${type.label}: coming soon` : `${type.description} Drag onto the canvas, or press Enter to add.`}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !soon) {
            e.preventDefault()
            onAdd()
          }
        }}
        className={cn('flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent', soon ? 'cursor-not-allowed text-brand-text-muted' : 'cursor-grab')}
      >
        <Icon className={cn('size-4 shrink-0', soon ? 'text-brand-text-muted' : 'text-brand-accent')} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{type.label}</span>
        {soon ? <span className="rounded-full border border-brand-border-strong px-1.5 text-[10px] uppercase tracking-wider text-brand-text-muted">Soon</span> : null}
      </button>
      <button type="button" aria-label={fav ? `Remove ${type.label} from favourites` : `Add ${type.label} to favourites`} aria-pressed={fav} onClick={onFav} className="flex size-7 items-center justify-center rounded text-brand-text-muted hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
        <Star className={cn('size-3.5', fav && 'fill-current text-brand-accent')} aria-hidden />
      </button>
    </li>
  )
}

/** Remembered per user in this browser: UI preference only, never read by the server. */
function readOpen(): string | null {
  try {
    const v = localStorage.getItem(OPEN_KEY)
    return v === null ? 'charts' : v === '' ? null : CATEGORIES.some((c) => c.id === v) ? v : 'charts'
  } catch {
    return 'charts'
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* preference only */
  }
}

/**
 * Dashboard assets: search (sticky), a Favourites and Recent row on top, then categories as an accordion
 * (one open at a time). Searching shows flat results across categories. Nothing is hidden: unfinished
 * assets show "Soon" and cannot be dragged.
 */
export function AssetBar({ selectedId, onSelect, onAdd }: { selectedId: string | null; onSelect: (id: string) => void; onAdd: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [favs, setFavs] = useState<string[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const [open, setOpen] = useState<string | null>('charts')
  useEffect(() => {
    setFavs(loadList(FAV_KEY))
    setRecent(loadList(RECENT_KEY))
    setOpen(readOpen())
  }, [])
  const toggleFav = (id: string) =>
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      save(FAV_KEY, JSON.stringify(next))
      return next
    })
  const add = (id: string) => {
    onAdd(id)
    setRecent((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_MAX)
      save(RECENT_KEY, JSON.stringify(next))
      return next
    })
  }
  const toggleOpen = (id: string) =>
    setOpen((cur) => {
      const next = cur === id ? null : id
      save(OPEN_KEY, next ?? '')
      return next
    })

  const needle = q.trim().toLowerCase()
  const match = (t: PanelType<any>) => // eslint-disable-line @typescript-eslint/no-explicit-any
    !needle || `${t.label} ${t.description} ${CATEGORIES.find((c) => c.id === t.category)?.label}`.toLowerCase().includes(needle)
  const shown = PANEL_TYPES.filter(match)
  const byId = (ids: string[]) => ids.map((id) => PANEL_TYPES.find((t) => t.id === id)).filter((t): t is PanelType<any> => !!t) // eslint-disable-line @typescript-eslint/no-explicit-any

  const row = (t: PanelType<any>, scope?: string) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
    <Asset key={`${scope ?? ''}${t.id}`} scope={scope} type={t} fav={favs.includes(t.id)} onFav={() => toggleFav(t.id)} selected={selectedId === t.id} onSelect={() => onSelect(t.id)} onAdd={() => add(t.id)} />
  )
  const quick = (id: string, title: string, list: PanelType<any>[], scope: string) => // eslint-disable-line @typescript-eslint/no-explicit-any
    list.length === 0 ? null : (
      <section aria-labelledby={id} className="mb-1">
        <h3 id={id} className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-brand-text-muted">{title}</h3>
        <ul className="m-0 p-0">{list.map((t) => row(t, scope))}</ul>
      </section>
    )

  return (
    <nav aria-label="Dashboard assets" className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 shrink-0 border-b border-brand-border bg-brand-surface/90 pb-1 backdrop-blur-sm">
        <label className="relative m-2 mb-1 block">
          <span className="sr-only">Search assets</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-brand-text-muted" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assets" className="h-9 w-full rounded-md border border-brand-border bg-brand-surface pl-8 pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" />
        </label>
        <p className="px-3 text-xs text-brand-text-muted" aria-live="polite">{shown.length} of {PANEL_TYPES.length} assets</p>
      </div>
      <div data-scroll="assets" className="scroll-token min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-1.5 py-1.5">
        {needle ? (
          <ul className="m-0 p-0" aria-label="Search results">{shown.map((t) => row(t, 'q'))}</ul>
        ) : (
          <>
            {quick('assets-fav', 'Favourites', byId(favs), 'fav')}
            {quick('assets-recent', 'Recent', byId(recent), 'recent')}
            {CATEGORIES.map((c) => {
              const items = PANEL_TYPES.filter((t) => t.category === c.id)
              const on = open === c.id
              return (
                <section key={c.id} className="mb-1 rounded-md border border-brand-border">
                  <h3 className="m-0">
                    <button type="button" id={`assets-${c.id}`} aria-expanded={on} aria-controls={`assets-${c.id}-panel`} onClick={() => toggleOpen(c.id)} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-text-muted hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
                      <ChevronDown className={cn('size-4 shrink-0 transition-transform', !on && '-rotate-90')} aria-hidden />
                      <span className="flex-1">{c.label}</span>
                      <span className="font-normal">{items.length}</span>
                    </button>
                  </h3>
                  {on ? <ul id={`assets-${c.id}-panel`} aria-labelledby={`assets-${c.id}`} className="m-0 p-0 pb-1">{items.map((t) => row(t))}</ul> : null}
                </section>
              )
            })}
          </>
        )}
        {shown.length === 0 ? <p className="px-2 py-6 text-center text-sm text-brand-text-muted">No assets match “{q}”.</p> : null}
      </div>
    </nav>
  )
}
