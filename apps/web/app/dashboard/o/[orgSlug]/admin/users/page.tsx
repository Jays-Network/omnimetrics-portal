import { UsersView } from '@/components/admin/users-view'
import { requireOrgPage } from '@/lib/portal/org'

export default async function UsersPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { access } = await requireOrgPage(orgSlug, 'admin.view')
  return <UsersView orgSlug={access.org.slug} orgName={access.org.name} isDirector={access.capabilities.includes('orgs.manage')} />
}
