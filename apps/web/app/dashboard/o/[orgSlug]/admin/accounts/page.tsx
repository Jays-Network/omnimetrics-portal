import { PageTitle, PlannedCard } from '@/components/shell/page-intro'
import { requireOrgPage } from '@/lib/portal/org'

export default async function AccountsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  await requireOrgPage(orgSlug, 'admin.view')
  return (
    <>
      <PageTitle title="Accounts" description="Login security for this organisation's members." />
      <PlannedCard
        milestone="M4"
        heading="Login security"
        items={['Reset password, deactivate, and review active sessions.', 'Your own page is under your name, top right (My account).']}
      />
    </>
  )
}
