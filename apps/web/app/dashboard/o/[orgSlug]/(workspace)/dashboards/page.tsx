import { DashboardList } from '@/components/dashboards/dashboard-list'
import { PageTitle } from '@/components/shell/page-intro'
import { requireOrgPage } from '@/lib/portal/org'

export default async function DashboardsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { access } = await requireOrgPage(orgSlug, 'dashboards.view')
  return (
    <>
      <PageTitle title="Dashboards" description={`${access.org.name}: pick one from the tree, or from the list below.`} />
      <DashboardList />
    </>
  )
}
