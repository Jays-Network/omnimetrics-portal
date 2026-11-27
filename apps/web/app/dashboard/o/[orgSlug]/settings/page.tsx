import { notFound } from 'next/navigation'
import { SystemSettingsView } from '@/components/admin/system-settings-view'
import { requireOrgPage } from '@/lib/portal/org'

// Everyone sees Settings (their own preferences); organisation and system scopes appear only with the capability, and the portal re-checks on save.
export default async function SettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { access, portal, user } = await requireOrgPage(orgSlug, 'settings.view')
  const r = await portal.settings.get(access, { id: user.id, username: user.username })
  if (!r.ok) notFound()
  return <SystemSettingsView orgSlug={access.org.slug} orgName={access.org.name} initial={r.view} />
}
