import { notFound } from 'next/navigation'
import { AccountView } from '@/components/admin/account-view'
import { AccountsView } from '@/components/admin/accounts-view'
import { IntegrationsView } from '@/components/admin/integrations-view'
import { OrgsView } from '@/components/admin/orgs-view'
import { SystemSettingsView } from '@/components/admin/system-settings-view'
import { UsersView } from '@/components/admin/users-view'
import { SubTabs } from '@/components/shell/sub-tabs'
import { resolveSettings } from '@/lib/settings/model'

export const dynamic = 'force-dynamic'

const tabs = (p: string) => [{ label: 'Organisations', href: '/dev/pages/orgs' }, { label: 'Users', href: '/dev/pages/users' }, { label: 'Accounts', href: '/dev/pages/accounts' }].filter((t) => t.href.endsWith(p) || true)

export default async function DevPage({ params }: { params: Promise<{ page: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { page } = await params
  const admin = (el: React.ReactNode) => (
    <div className="flex h-full min-h-0 flex-col"><SubTabs tabs={tabs(page)} label="Admin" /><div className="min-h-0 flex-1">{el}</div></div>
  )
  switch (page) {
    case 'integrations': return <IntegrationsView orgSlug="dev" orgName="Dev" />
    case 'users': return admin(<UsersView orgSlug="dev" orgName="Dev" isDirector />)
    case 'accounts': return admin(<AccountsView orgSlug="dev" orgName="Dev" />)
    case 'orgs': return admin(<OrgsView orgSlug="dev" isDirector />)
    case 'account': return <AccountView username="dev" email="dev@mock.invalid" isDirector />
    case 'settings': return <SystemSettingsView orgSlug="dev" orgName="Dev" initial={{ system: {}, org: {}, user: {}, effective: resolveSettings({}), can: { system: true, org: true } }} />
    default: notFound()
  }
}
