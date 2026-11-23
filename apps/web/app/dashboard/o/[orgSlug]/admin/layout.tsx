import type { ReactNode } from 'react'
import { SubTabs } from '@/components/shell/sub-tabs'
import { orgBase } from '@/components/shell/nav'
import { requireOrgPage } from '@/lib/portal/org'

// Sub-tabs only; each admin page still calls requireOrgPage itself. Fixed-height column: tabs on top, the page fills the rest.
export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { access } = await requireOrgPage(orgSlug, 'admin.view')
  const base = orgBase(orgSlug)
  const tabs = [
    access.capabilities.includes('orgs.manage')
      ? { label: 'Organisations', href: '/dashboard/platform/organisations' }
      : { label: 'Organisation', href: `${base}/admin/organisation` },
    { label: 'Users', href: `${base}/admin/users` },
    { label: 'Accounts', href: `${base}/admin/accounts` },
  ]
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SubTabs tabs={tabs} label="Admin" />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
