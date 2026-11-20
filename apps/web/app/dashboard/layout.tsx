import type { ReactNode } from 'react'
import { MotionRoot } from '@/components/fx/motion-root'
import { AppShell } from '@/components/shell/app-shell'
import { requirePortalUser } from '@/lib/portal/org'

// Shell for every /dashboard route. Pages still call their own guard
// (requireOrgPage / requirePlatformPage / requirePortalUser): the shell is
// presentation, not the security boundary.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, portal, accessible } = await requirePortalUser()
  return (
    <MotionRoot>
      <AppShell user={{ username: user.username }} orgs={accessible} mode={portal.mode}>
        {children}
      </AppShell>
    </MotionRoot>
  )
}
