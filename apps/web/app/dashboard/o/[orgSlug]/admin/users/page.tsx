import { PageTitle, PlannedCard } from '@/components/shell/page-intro'
import { requireOrgPage } from '@/lib/portal/org'

export default async function UsersPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { access } = await requireOrgPage(orgSlug, 'admin.view')
  return (
    <>
      <PageTitle title="Users" description={`${access.org.name}: people, their role here, grants and tracking scope.`} />
      <PlannedCard
        milestone="M4"
        heading="Members and access"
        items={[
          'Role per organisation (admin, builder, viewer); one login can differ between organisations.',
          'Grants on folders and dashboards; tracking scope for tracking data.',
          'Builders create only inside folders where they hold edit; only an admin creates top-level folders.',
        ]}
      />
    </>
  )
}
