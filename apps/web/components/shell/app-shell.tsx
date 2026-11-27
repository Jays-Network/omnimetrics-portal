'use client'

import { PortalModeProvider } from '@/components/admin/portal-mode'
import { useEffect, type ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import type { OrgAccess } from '@omnimetrics/types'
import { FxToggle } from '@/components/fx/fx-toggle'
import { GlassPanel } from '@/components/fx/glass-panel'
import { HoloBackground } from '@/components/fx/holo-background'
import { LogoutButton } from '@/components/logout-button'
import { cn } from '@/lib/utils'
import { isEditorPath, isFixedPath, shellClasses } from './editor-shell'
import { NAV_TABS, activeTabKey, tabHref } from './nav'
import { LAST_ORG_COOKIE, pickDefaultOrg } from '@/lib/portal/org-pref'
import type { PreviewRole } from '@/lib/portal/preview'
import { OrgSwitcher } from './org-switcher'
import { RolePreview } from './role-preview'

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
  lastOrgSlug,
  preview,
  children,
}: {
  user: ShellUser
  orgs: OrgAccess[]
  mode: 'mock' | 'pg'
  /** Remembered organisation (UI preference only, never authorization). */
  lastOrgSlug?: string | null
  /** Dev-only role preview state; present in mock mode. */
  preview?: { current: PreviewRole | null; options: PreviewRole[] }
  children: ReactNode
}) {
  const pathname = usePathname()
  const params = useParams<{ orgSlug?: string }>()
  const active = orgs.find((o) => o.org.slug === params.orgSlug) ?? pickDefaultOrg(orgs, lastOrgSlug)
  const activeKey = activeTabKey(pathname)
  // The builder is a fixed-viewport editor: the page itself never scrolls, its columns do.
  const editor = isEditorPath(pathname)
  const shell = shellClasses(isFixedPath(pathname))
  const tabs = active ? NAV_TABS.filter((t) => active.capabilities.includes(t.cap)) : []
  const viewedSlug = orgs.find((o) => o.org.slug === params.orgSlug)?.org.slug
  useEffect(() => {
    // Remember the last organisation. Preference only: read back solely to choose a default among orgs the server already verified.
    if (viewedSlug) document.cookie = `${LAST_ORG_COOKIE}=${encodeURIComponent(viewedSlug)}; path=/; max-age=31536000; samesite=lax`
  }, [viewedSlug])
  const roleLabel = active ? (active.isPlatform ? 'Director' : active.role) : ''

  return (
    <div className={cn('relative', shell.outer)}>
      <HoloBackground variant="app" />
      <div className={cn('relative z-10 flex flex-col', shell.inner)}>
        <header className={cn('sticky top-0 z-20', shell.header)}>
          <GlassPanel tone={2} spotlight={false} sheen={false} halo={false}>
            {/* GlassPanel wraps children in a block (.fx-content), so the flex row lives here. */}
            <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3', shell.row)}>
              <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
                <Image src="/brand/emblem-1024.png" alt="" width={32} height={32} sizes="32px" className={cn('shrink-0', shell.emblem)} />
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
                              shell.tab, 'relative flex items-center gap-2 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
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
                    title={editor ? 'Development mock data. Nothing shown here is real. The builder runs on mock data and nothing in it touches real tracking data.' : 'Development mock data. Nothing shown here is real.'}
                    className="rounded-full border border-[var(--chart-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--chart-2)]"
                  >
                    Mock data
                  </span>
                ) : null}
                {mode === 'mock' && preview ? <RolePreview current={preview.current} options={preview.options} /> : null}
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
        <main className={cn('min-w-0 flex-1', shell.main)}>
          <PortalModeProvider value={mode}>{children}</PortalModeProvider>
        </main>
      </div>
    </div>
  )
}
