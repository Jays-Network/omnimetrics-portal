import { PageTitle, PlannedCard } from '@/components/shell/page-intro'
import { requireOrgPage } from '@/lib/portal/org'

export default async function OrganisationPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { access } = await requireOrgPage(orgSlug, 'admin.view')
  return (
    <>
      <PageTitle title={access.org.name} description="Organisation profile." />
      <PlannedCard milestone="M4" heading="Profile" items={['Name, status and defaults for this organisation (organisation-level settings).']} />
    </>
  )
}
