import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { MotionRoot } from '@/components/fx/motion-root'
import { AppShell } from '@/components/shell/app-shell'

// Development-only, no auth, 404 in production. Renders the REAL M4 views inside the REAL shell chain so
// e2e/pages-layout.spec.ts can measure them; the spec fulfils the /api/portal calls with canned JSON.
export default function DevPagesLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <MotionRoot>
      <AppShell user={{ username: 'dev' }} orgs={[]} mode="mock">{children}</AppShell>
    </MotionRoot>
  )
}
