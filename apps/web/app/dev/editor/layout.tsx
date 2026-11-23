import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { MotionRoot } from '@/components/fx/motion-root'
import { AppShell } from '@/components/shell/app-shell'

// Development-only. Mirrors the real /dashboard chain (MotionRoot > AppShell > template > page) so the layout
// test measures the same wrappers production uses. No auth, because it renders mock data only; 404 in production.
export default function DevEditorLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <MotionRoot>
      <AppShell user={{ username: 'dev' }} orgs={[]} mode="mock">
        {children}
      </AppShell>
    </MotionRoot>
  )
}
