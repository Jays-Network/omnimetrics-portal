import { IntegrationsView } from '@/components/admin/integrations-view'
import { requireOrgPage } from '@/lib/portal/org'

// Org admin and director only: everyone else gets the standard not-found (the API refuses them too).
export default async function IntegrationsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { access } = await requireOrgPage(orgSlug, 'integrations.manage')
  return <IntegrationsView orgSlug={access.org.slug} orgName={access.org.name} />
}
