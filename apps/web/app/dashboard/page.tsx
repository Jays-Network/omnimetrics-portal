import { redirect } from 'next/navigation'
import { LogoutButton } from '@/components/logout-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getCurrentUser } from '@/lib/auth'

// Phase 1 placeholder: proves the auth flow works. No dashboard content yet.
export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-primary px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Signed in</CardTitle>
          <CardDescription>Authentication is working.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-brand-text-muted">Username</dt>
            <dd className="font-medium">{user.username}</dd>
            <dt className="text-brand-text-muted">Role</dt>
            <dd className="font-medium">{user.role}</dd>
          </dl>
          <LogoutButton />
        </CardContent>
      </Card>
    </main>
  )
}
