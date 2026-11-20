import { LayoutGrid, Plug, Settings, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { Capability } from '@omnimetrics/types'

export type TabKey = 'dashboards' | 'integrations' | 'admin' | 'settings'

export interface NavTab {
  key: TabKey
  label: string
  icon: LucideIcon
  /** First path segment under /dashboard/o/[orgSlug]/. */
  segment: string
  /** Shown only with this capability (hidden, not disabled). Pages re-check on the server. */
  cap: Capability
}

// docs/PLAN_BUILDER.md section 1. Overview and Alerts placeholders are dropped (Jay, Q9).
export const NAV_TABS: NavTab[] = [
  { key: 'dashboards', label: 'Dashboards', icon: LayoutGrid, segment: 'dashboards', cap: 'dashboards.view' },
  { key: 'integrations', label: 'Integrations', icon: Plug, segment: 'integrations', cap: 'integrations.manage' },
  { key: 'admin', label: 'Admin', icon: ShieldCheck, segment: 'admin', cap: 'admin.view' },
  { key: 'settings', label: 'Settings', icon: Settings, segment: 'settings', cap: 'settings.view' },
]

export const orgBase = (slug: string) => `/dashboard/o/${encodeURIComponent(slug)}`
export const tabHref = (slug: string, tab: NavTab) => `${orgBase(slug)}/${tab.segment}`

/** Which top tab owns this path. Platform (director) pages belong to Admin; /dashboard/account to none. */
export function activeTabKey(pathname: string): TabKey | null {
  if (pathname.startsWith('/dashboard/platform')) return 'admin'
  const m = /^\/dashboard\/o\/[^/]+\/([^/]+)/.exec(pathname)
  return NAV_TABS.find((t) => t.segment === m?.[1])?.key ?? null
}

/** Swap the organisation in the current path, keeping the section; fall back to its Dashboards tab. */
export function switchOrgHref(pathname: string, fromSlug: string, toSlug: string): string {
  const prefix = orgBase(fromSlug)
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
    return `${orgBase(toSlug)}${pathname.slice(prefix.length)}`
  }
  return `${orgBase(toSlug)}/dashboards`
}
