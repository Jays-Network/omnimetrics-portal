import { PageTitle, PlannedCard } from '@/components/shell/page-intro'
import { requireOrgPage } from '@/lib/portal/org'

export default async function DashboardsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { access } = await requireOrgPage(orgSlug, 'dashboards.view')
  return (
    <>
      <PageTitle title="Dashboards" description={`${access.org.name}: folders, sub-folders and dashboards.`} />
      <PlannedCard
        milestone="M2"
        heading="Content tree and viewer"
        items={[
          'File tree on the left: organisation > folder > sub-folder > dashboard (portal-owned, not the tracking folder_name).',
          'Dashboard viewer on the right, rendering mock panel specs.',
          'Create, rename, move, nest and delete with undo; grants shown read-only.',
          'Switching organisation (top left) shows a different tree.',
        ]}
      />
    </>
  )
}
