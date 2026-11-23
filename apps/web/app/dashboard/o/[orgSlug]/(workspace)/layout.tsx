import type { ReactNode } from 'react'
import { Workspace } from '@/components/dashboards/workspace'
import { requireOrgPage } from '@/lib/portal/org'

// Dashboards area shell. Pages below still call their own guard and fetch their own data.
export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { portal, access } = await requireOrgPage(orgSlug, 'dashboards.view')
  const nodes = await portal.content.tree(access)
  const { role, isPlatform, capabilities } = access
  return (
    <Workspace key={access.org.id} orgSlug={access.org.slug} initialNodes={nodes} actor={{ role, isPlatform, capabilities }}>
      {children}
    </Workspace>
  )
}
