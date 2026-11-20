'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, Check, ChevronsUpDown } from 'lucide-react'
import type { OrgAccess } from '@omnimetrics/types'
import { cn } from '@/lib/utils'
import { switchOrgHref } from './nav'

/** Organisation switcher. One organisation = a static chip. Items are plain links, so keyboard use is native. */
export function OrgSwitcher({ orgs, activeSlug }: { orgs: OrgAccess[]; activeSlug: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const active = orgs.find((o) => o.org.slug === activeSlug) ?? orgs[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!active) return null
  const chip = 'flex h-9 items-center gap-2 rounded-lg border border-brand-border px-2.5 text-sm'

  if (orgs.length < 2) {
    return (
      <div className={cn(chip, 'text-brand-text')} title="Organisation">
        <Building2 className="size-4 text-brand-accent" aria-hidden />
        <span className="max-w-32 truncate font-medium">{active.org.name}</span>
      </div>
    )
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Organisation: ${active.org.name}. Switch organisation`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          chip,
          'text-brand-text transition-colors hover:border-brand-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
        )}
      >
        <Building2 className="size-4 text-brand-accent" aria-hidden />
        <span className="max-w-32 truncate font-medium">{active.org.name}</span>
        <ChevronsUpDown className="size-3.5 text-brand-text-muted" aria-hidden />
      </button>
      {open ? (
        <ul
          id={menuId}
          aria-label="Organisations"
          className="absolute left-0 top-full z-40 mt-2 min-w-52 rounded-lg border border-brand-border-strong bg-brand-surface-raised p-1 shadow-lg"
        >
          {orgs.map((o) => {
            const current = o.org.slug === active.org.slug
            return (
              <li key={o.org.id} className="list-none">
                <Link
                  href={switchOrgHref(pathname, active.org.slug, o.org.slug)}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => setOpen(false)}
                  className="flex h-9 items-center gap-2 rounded-md px-2.5 text-sm hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                >
                  <span className="min-w-0 flex-1 truncate">{o.org.name}</span>
                  <span className="text-xs capitalize text-brand-text-muted">{o.isPlatform ? 'Director' : o.role}</span>
                  {current ? <Check className="size-4 text-brand-accent" aria-hidden /> : <span className="size-4" aria-hidden />}
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
