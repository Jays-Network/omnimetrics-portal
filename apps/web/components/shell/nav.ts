import { Bell, LayoutDashboard, LayoutGrid, type LucideIcon } from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  /** Not built yet: shown dimmed, not focusable as a link. */
  soon?: boolean
}

// Only Overview exists today; the others are visual placeholders for the indicator.
export const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Dashboards', href: '/dashboard/dashboards', icon: LayoutGrid, soon: true },
  { label: 'Alerts', href: '/dashboard/alerts', icon: Bell, soon: true },
]
