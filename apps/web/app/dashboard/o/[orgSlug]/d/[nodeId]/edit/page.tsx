import { notFound } from 'next/navigation'
import { PORTAL_TIMEZONE } from '@omnimetrics/types'
import { LazyBuilder } from '@/components/builder/builder-loader'
import { normalizeSpec } from '@/lib/builder/model'
import { canEditDashboard } from '@/lib/builder/settings'
import { canSeeTerminal } from '@/lib/builder/terminal'
import { requireOrgPage } from '@/lib/portal/org'

// Builder (M3 on mock). Server-enforced: needs `dashboards.edit` (404 otherwise, existence not confirmed),
// and the node must belong to THIS organisation. A read-only dashboard is closed to builders here too
// (org admins and the director keep access). The builder bundle is lazy, so viewers never download it.
// The SQL terminal is passed only to the director (R7): for everyone else it is absent, not disabled.
export default async function EditDashboardPage({ params }: { params: Promise<{ orgSlug: string; nodeId: string }> }) {
  const { orgSlug, nodeId } = await params
  const { portal, access } = await requireOrgPage(orgSlug, 'dashboards.edit')
  const view = await portal.dashboards.get(access, nodeId)
  if (!view || !canEditDashboard(access, normalizeSpec(view.spec).settings)) notFound()
  const versions = await portal.dashboards.versions(access, nodeId)
  if (!versions) notFound()
  return (
    <LazyBuilder
      orgSlug={access.org.slug}
      nodeId={nodeId}
      orgName={access.org.name}
      dashboardName={view.node.name}
      initialVersions={versions}
      showTerminal={canSeeTerminal(access.capabilities)}
      isAdmin={access.isPlatform || access.role === 'admin'}
      canDelete={access.capabilities.includes('dashboards.delete')}
      systemTz={process.env.PORTAL_TIMEZONE || PORTAL_TIMEZONE}
    />
  )
}
