import type { ReactNode } from 'react'
import { FormatProvider } from '@/components/fx/format-context'
import { requireOrgPage } from '@/lib/portal/org'

// Resolves the viewer's effective display settings (user > organisation > system > default) once per request and
// provides them to everything below. Adds no DOM wrapper, so the editor's fill chain is untouched. Pages still guard themselves.
export default async function OrgLayout({ children, params }: { children: ReactNode; params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { access, portal, user } = await requireOrgPage(orgSlug, 'settings.view')
  const r = portal.settings.get(access, { id: user.id, username: user.username })
  return r.ok ? <FormatProvider settings={r.view.effective.value}>{children}</FormatProvider> : <>{children}</>
}
