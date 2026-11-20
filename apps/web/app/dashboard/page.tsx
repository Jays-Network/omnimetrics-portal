import { redirect } from 'next/navigation'
import { GlassPanel } from '@/components/fx/glass-panel'
import { getCurrentUser } from '@/lib/auth'

// Phase 1 placeholder: proves the auth flow works. No dashboard content yet.
export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <div className="max-w-md">
      <GlassPanel tone="data" className="p-6">
        <h1 className="font-display text-xl font-semibold leading-none tracking-tight">Signed in</h1>
        <p className="mt-1.5 text-sm text-brand-text-muted">Authentication is working.</p>
        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-brand-text-muted">Username</dt>
          <dd className="font-medium">{user.username}</dd>
          <dt className="text-brand-text-muted">Role</dt>
          <dd className="font-medium">{user.role}</dd>
        </dl>
      </GlassPanel>
    </div>
  )
}
