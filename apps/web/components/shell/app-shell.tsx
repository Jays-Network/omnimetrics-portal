'use client'

import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import type { OrgAccess } from '@omnimetrics/types'
import { FxToggle } from '@/components/fx/fx-toggle'
import { GlassPanel } from '@/components/fx/glass-panel'
import { HoloBackground } from '@/components/fx/holo-background'
import { LogoutButton } from '@/components/logout-button'
import { cn } from '@/lib/utils'
import { NAV_TABS, activeTabKey, tabHref } from './nav'
import { OrgSwitcher } from './org-switcher'

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'OmniMetrics'

export interface ShellUser {
  username: string
}

/**
 * Header (brand, organisation switcher, top tabs, controls) on glass over the
 * app HoloBackground. Content goes in <main>. Tab visibility is a presentation
 * hint from the organisation's capabilities; every page re-checks on the server.
 */
export function AppShell({
  user,
  orgs,
  mode,
  children,
}: {
  user: ShellUser
  orgs: OrgAccess[]
  mode: 'mock' | 'pg'
  children: ReactNode
}) {
  const pathname = usePathname()
  const params = useParams<{ orgSlug?: string }>()
  const active = orgs.find((o) => o.org.slug === params.orgSlug) ?? orgs[0]
  const activeKey = activeTabKey(pathname)
  const tabs = active ? NAV_TABS.filter((t) => active.capabilities.includes(t.cap)) : []
  const roleLabel = active ? (active.isPlatform ? 'Director' : active.role) : ''

  return (
    <div className="relative min-h-screen">
      <HoloBackground variant="app" />
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 p-3 pb-0">
          <GlassPanel tone={2} spotlight={false} sheen={false} halo={false}>
            {/* GlassPanel wraps children in a block (.fx-content), so the flex row lives here. */}
            <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
              <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
                <Image src="/brand/emblem-1024.png" alt="" width={32} height={32} sizes="32px" className="size-8 shrink-0" />
                <span className="hidden font-display text-base font-semibold lg:inline">{BRAND_NAME}</span>
              </Link>

              {active ? <OrgSwitcher orgs={orgs} activeSlug={active.org.slug} /> : null}

              {active && tabs.length > 0 ? (
                <nav aria-label="Main" className="order-last w-full md:order-none md:w-auto">
                  <ul className="flex gap-1">
                    {tabs.map((tab) => {
                      const Icon = tab.icon
                      const on = tab.key === activeKey
                      return (
                        <li key={tab.key} className="list-none">
                          <Link
                            href={tabHref(active.org.slug, tab)}
                            aria-current={on ? 'page' : undefined}
                            className={cn(
                              'relative flex h-10 items-center gap-2 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
                              on ? 'font-medium text-brand-text' : 'text-brand-text-muted hover:text-brand-text',
                            )}
                          >
                            <Icon className="size-[18px] shrink-0" aria-hidden />
                            <span>{tab.label}</span>
                            {on ? (
                              <span
                                aria-hidden
                                className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-accent shadow-[0_0_8px_var(--glow-1-mid)]"
                              />
                            ) : null}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </nav>
              ) : null}

              <div className="ml-auto flex shrink-0 items-center gap-3">
                {mode === 'mock' ? (
                  <span
                    title="Development mock data. Nothing shown here is real."
                    className="rounded-full border border-[var(--chart-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--chart-2)]"
                  >
                    Mock data
                  </span>
                ) : null}
                <FxToggle />
                <Link
                  href="/dashboard/account"
                  aria-label="My account"
                  className="hidden rounded-md text-right leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent sm:block"
                >
                  <span className="block text-sm font-medium">{user.username}</span>
                  <span className="block text-xs capitalize text-brand-text-muted">{roleLabel}</span>
                </Link>
                <LogoutButton />
              </div>
            </div>
          </GlassPanel>
        </header>
        <main className="min-w-0 flex-1 p-3">{children}</main>
      </div>
    </div>
  )
}
