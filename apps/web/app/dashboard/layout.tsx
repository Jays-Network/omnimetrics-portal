import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { MotionRoot } from '@/components/fx/motion-root'
import { AppShell } from '@/components/shell/app-shell'
import { getCurrentUser } from '@/lib/auth'

// Shell for every /dashboard route. Pages still call getCurrentUser() themselves
// (the shell is presentation, not the security boundary).
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return (
    <MotionRoot>
      <AppShell user={{ username: user.username, role: user.role }}>{children}</AppShell>
    </MotionRoot>
  )
}
