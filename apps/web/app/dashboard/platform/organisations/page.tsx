import { OrgsView } from '@/components/admin/orgs-view'
import { SubTabs } from '@/components/shell/sub-tabs'
import { orgBase } from '@/components/shell/nav'
import { requirePlatformPage } from '@/lib/portal/org'

// Director only (orgs.manage). Everyone else gets the standard not-found.
export default async function PlatformOrganisationsPage() {
  const { access } = await requirePlatformPage()
  const base = orgBase(access.org.slug)
  const tabs = [
    { label: 'Organisations', href: '/dashboard/platform/organisations' },
    { label: 'Users', href: `${base}/admin/users` },
    { label: 'Accounts', href: `${base}/admin/accounts` },
  ]
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SubTabs tabs={tabs} label="Admin" />
      <div className="min-h-0 flex-1"><OrgsView orgSlug={access.org.slug} isDirector /></div>
    </div>
  )
}
