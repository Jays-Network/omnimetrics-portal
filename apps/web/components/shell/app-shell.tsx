'use client'

import type { CSSProperties, ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FxToggle } from '@/components/fx/fx-toggle'
import { GlassPanel } from '@/components/fx/glass-panel'
import { HoloBackground } from '@/components/fx/holo-background'
import { LogoutButton } from '@/components/logout-button'
import { cn } from '@/lib/utils'
import { NAV_ITEMS } from './nav'

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'OmniMetrics'

function activeIndex(pathname: string): number {
  let best = -1
  NAV_ITEMS.forEach((item, i) => {
    if (item.soon) return
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) best = i
  })
  return best
}

export interface ShellUser {
  username: string
  role: string
}

/** Sidebar + topbar on glass over the app HoloBackground. Content goes in <main>. */
export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const pathname = usePathname()
  const active = activeIndex(pathname)

  return (
    <div className="relative min-h-screen">
      <HoloBackground variant="app" />
      <div className="relative z-10 flex min-h-screen">
        <aside className="sticky top-0 h-screen shrink-0 p-3 pr-0">
          <GlassPanel tone={2} spotlight={false} sheen={false} halo={false} className="flex h-full w-14 flex-col md:w-56">
            <div className="flex h-14 items-center gap-2.5 border-b border-brand-border/60 px-3">
              <Image src="/brand/emblem-1024.png" alt="" width={32} height={32} sizes="32px" className="size-8 shrink-0" />
              <span className="hidden truncate font-display text-base font-semibold md:inline">{BRAND_NAME}</span>
            </div>
            <nav aria-label="Main" className="p-2">
              <ul
                className="relative flex flex-col gap-2"
                style={{ '--nav-item-h': '2.5rem', '--nav-pitch': '3rem' } as CSSProperties}
              >
                {active >= 0 ? (
                  <li aria-hidden className="fx-nav-indicator list-none" style={{ transform: `translate3d(0, calc(var(--nav-pitch) * ${active}), 0)` }} />
                ) : null}
                {NAV_ITEMS.map((item, i) => {
                  const Icon = item.icon
                  const body = (
                    <>
                      <Icon className="size-[18px] shrink-0" aria-hidden />
                      <span className="hidden truncate md:inline">{item.label}</span>
                      {item.soon ? (
                        <span className="ml-auto hidden rounded-full border border-brand-border px-1.5 text-[10px] uppercase tracking-wider text-brand-text-muted md:inline">
                          Soon
                        </span>
                      ) : null}
                    </>
                  )
                  const base = 'relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm'
                  return (
                    <li key={item.href} className="list-none">
                      {item.soon ? (
                        <span aria-disabled="true" title={`${item.label} (coming soon)`} className={cn(base, 'cursor-not-allowed text-brand-text-muted opacity-60')}>
                          {body}
                        </span>
                      ) : (
                        <Link
                          href={item.href}
                          aria-current={i === active ? 'page' : undefined}
                          className={cn(
                            base,
                            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
                            i === active ? 'font-medium text-brand-text' : 'text-brand-text-muted hover:text-brand-text',
                          )}
                        >
                          {body}
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            </nav>
          </GlassPanel>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 p-3 pb-0">
            <GlassPanel tone={2} spotlight={false} sheen={false} halo={false}>
              {/* GlassPanel wraps children in a block (.fx-content), so the flex row lives here. */}
              <div className="flex h-14 items-center justify-between gap-3 px-3">
                <h2 className="min-w-0 truncate font-display text-base font-semibold">
                  {NAV_ITEMS[active]?.label ?? BRAND_NAME}
                </h2>
                <div className="ml-auto flex shrink-0 items-center gap-3">
                  <FxToggle />
                  <div className="hidden text-right leading-tight sm:block">
                    <p className="text-sm font-medium">{user.username}</p>
                    <p className="text-xs capitalize text-brand-text-muted">{user.role}</p>
                  </div>
                  <LogoutButton />
                </div>
              </div>
            </GlassPanel>
          </header>
          <main className="flex-1 p-3">{children}</main>
        </div>
      </div>
    </div>
  )
}
