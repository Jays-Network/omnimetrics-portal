import { AccountView } from '@/components/admin/account-view'
import { FormatProvider } from '@/components/fx/format-context'
import { pickDefaultOrg } from '@/lib/portal/org-pref'
import { requirePortalUser } from '@/lib/portal/org'

export default async function MyAccountPage() {
  const { user, accessible, portal } = await requirePortalUser()
  const org = pickDefaultOrg(accessible, null)
  const s = org ? portal.settings.get(org, { id: user.id, username: user.username }) : null
  const page = <AccountView username={user.username} email={user.email} isDirector={accessible.some((a) => a.isPlatform)} />
  return s?.ok ? <FormatProvider settings={s.view.effective.value}>{page}</FormatProvider> : page
}
