import { GlassPanel } from '@/components/fx/glass-panel'
import { SubTabs } from '@/components/shell/sub-tabs'
import { PageTitle, PlannedCard } from '@/components/shell/page-intro'
import { orgBase } from '@/components/shell/nav'
import { requirePlatformPage } from '@/lib/portal/org'

// Director only (orgs.manage). Everyone else gets the standard not-found.
export default async function PlatformOrganisationsPage() {
  const { portal, access } = await requirePlatformPage()
  const orgs = await portal.orgs.listAll()
  const base = orgBase(access.org.slug)
  const tabs = [
    { label: 'Organisations', href: '/dashboard/platform/organisations' },
    { label: 'Users', href: `${base}/admin/users` },
    { label: 'Accounts', href: `${base}/admin/accounts` },
  ]
  return (
    <>
      <SubTabs tabs={tabs} label="Admin" />
      <PageTitle title="Organisations" description="Every organisation on the platform (director only)." />
      <GlassPanel tone="data" className="mb-3 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <caption className="sr-only">Organisations</caption>
          <thead className="bg-brand-surface-raised text-left text-xs uppercase tracking-wider text-brand-text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Name</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
              <th scope="col" className="tabular px-3 py-2 text-right font-medium">Members</th>
              <th scope="col" className="tabular px-3 py-2 text-right font-medium">Integrations</th>
              <th scope="col" className="tabular px-3 py-2 text-right font-medium">Dashboards</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="h-9 border-t border-brand-border/60">
                <th scope="row" className="px-3 text-left font-medium">{o.name}</th>
                <td className="px-3 capitalize">{o.status}</td>
                <td className="tabular px-3 text-right">{o.memberCount}</td>
                <td className="tabular px-3 text-right">{o.integrationCount}</td>
                <td className="tabular px-3 text-right">{o.dashboardCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassPanel>
      <PlannedCard
        milestone="M4"
        heading="Organisation management"
        items={['Create, suspend and edit organisations; manage the allowed-hosts list (director only).', 'Counts above are mock data.']}
      />
    </>
  )
}
