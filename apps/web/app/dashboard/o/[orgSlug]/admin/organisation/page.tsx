import { OrgsView } from '@/components/admin/orgs-view'
import { requireOrgPage } from '@/lib/portal/org'

// Org admin: own organisation's profile only. (The director's all-organisations list lives under /dashboard/platform.)
export default async function OrganisationPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { access } = await requireOrgPage(orgSlug, 'admin.view')
  return <OrgsView orgSlug={access.org.slug} isDirector={access.capabilities.includes('orgs.manage')} />
}
