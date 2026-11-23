import { notFound } from 'next/navigation'
import { DashboardViewer } from '@/components/dashboards/viewer'
import { PORTAL_TIMEZONE } from '@omnimetrics/types'
import { requireOrgPage } from '@/lib/portal/org'

export default async function DashboardPage({ params }: { params: Promise<{ orgSlug: string; nodeId: string }> }) {
  const { orgSlug, nodeId } = await params
  const { portal, access } = await requireOrgPage(orgSlug, 'dashboards.view')
  // Looked up inside THIS organisation only; an id from another organisation is just "not found".
  const view = await portal.dashboards.get(access, nodeId)
  if (!view) notFound()
  return <DashboardViewer view={view} systemTz={process.env.PORTAL_TIMEZONE || PORTAL_TIMEZONE} />
}
