import { GlassPanel } from '@/components/fx/glass-panel'
import { PageTitle, PlannedCard } from '@/components/shell/page-intro'
import { requirePortalUser } from '@/lib/portal/org'

export default async function MyAccountPage() {
  const { user } = await requirePortalUser()
  return (
    <>
      <PageTitle title="My account" description="Your own login details." />
      <GlassPanel tone="data" className="mb-3 max-w-md p-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-brand-text-muted">Username</dt>
          <dd className="font-medium">{user.username}</dd>
          <dt className="text-brand-text-muted">Email</dt>
          <dd className="font-medium">{user.email}</dd>
        </dl>
      </GlassPanel>
      <PlannedCard milestone="M4" heading="Login security" items={['Change password and review your sessions.', 'Personal overrides of the system settings.']} />
    </>
  )
}
