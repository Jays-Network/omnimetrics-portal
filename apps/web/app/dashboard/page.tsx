import { redirect } from 'next/navigation'
import { GlassPanel } from '@/components/fx/glass-panel'
import { orgBase } from '@/components/shell/nav'
import { requirePortalUser } from '@/lib/portal/org'

// Landing: first accessible organisation's Dashboards tab; fail closed with a notice when none.
export default async function DashboardIndex() {
  const { accessible } = await requirePortalUser()
  const first = accessible[0]
  if (first) redirect(`${orgBase(first.org.slug)}/dashboards`)
  return (
    <GlassPanel tone="data" className="max-w-md p-6">
      <h1 className="font-display text-xl font-semibold">No organisation access</h1>
      <p className="mt-1.5 text-sm text-brand-text-muted">Your account is not a member of any organisation yet. Ask the director to add you.</p>
    </GlassPanel>
  )
}
