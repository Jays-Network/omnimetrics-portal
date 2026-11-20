'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function LogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function logout() {
    setBusy(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } finally {
      router.replace('/login')
      router.refresh()
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={logout} disabled={busy}>
      <LogOut className="size-4" />
      Sign out
    </Button>
  )
}
