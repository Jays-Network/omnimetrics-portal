import { AccountsView } from '@/components/admin/accounts-view'
import { requireOrgPage } from '@/lib/portal/org'

export default async function AccountsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { access } = await requireOrgPage(orgSlug, 'admin.view')
  return <AccountsView orgSlug={access.org.slug} orgName={access.org.name} />
}
