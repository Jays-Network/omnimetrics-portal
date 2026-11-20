import { PageTitle, PlannedCard } from '@/components/shell/page-intro'
import { requireOrgPage } from '@/lib/portal/org'

export default async function IntegrationsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { access } = await requireOrgPage(orgSlug, 'integrations.manage')
  return (
    <>
      <PageTitle title="Integrations" description={`${access.org.name}: data sources this organisation can read.`} />
      <PlannedCard
        milestone="M4"
        heading="Data sources"
        items={[
          'Postgres first; MySQL later; SQLite deferred (filesystem access).',
          'Host picked from the director-managed allowlist, never typed freely.',
          'Credentials are write-only: saved, never shown again. UI on mock data until the isolation tests pass (M5).',
        ]}
      />
    </>
  )
}
