import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { MotionRoot } from '@/components/fx/motion-root'
import { AppShell } from '@/components/shell/app-shell'
import { requirePortalUser } from '@/lib/portal/org'
import { LAST_ORG_COOKIE } from '@/lib/portal/org-pref'
import { previewOptions } from '@/lib/portal/preview'

// Shell for every /dashboard route. Pages still call their own guard
// (requireOrgPage / requirePlatformPage / requirePortalUser): the shell is
// presentation, not the security boundary.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, portal, accessible, real, preview } = await requirePortalUser()
  const lastOrgSlug = (await cookies()).get(LAST_ORG_COOKIE)?.value ?? null
  const top = [...real].sort((a, b) => Number(b.isPlatform) - Number(a.isPlatform))[0]
  return (
    <MotionRoot>
      <AppShell
        user={{ username: user.username }}
        orgs={accessible}
        mode={portal.mode}
        lastOrgSlug={lastOrgSlug}
        preview={portal.mode === 'mock' ? { current: preview, options: previewOptions(top) } : undefined}
      >
        {children}
      </AppShell>
    </MotionRoot>
  )
}
