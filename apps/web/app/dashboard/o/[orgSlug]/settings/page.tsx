import { PageTitle, PlannedCard } from '@/components/shell/page-intro'
import { requireOrgPage } from '@/lib/portal/org'

export default async function SettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  await requireOrgPage(orgSlug, 'settings.view')
  return (
    <>
      <PageTitle title="Settings" description="Date format, time format, time zone, region and language." />
      <PlannedCard
        milestone="M4"
        heading="System settings"
        items={[
          'Order of precedence: your override, then the organisation default, then the system default.',
          'Time zone changes display only; counting stays on Africa/Johannesburg.',
          'English only for now; the structure stays ready for more languages.',
        ]}
      />
    </>
  )
}
