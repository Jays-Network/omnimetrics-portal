'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export function LoginForm({ next }: { next: string }) {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'same-origin',
      })
      if (res.ok) {
        router.replace(next)
        router.refresh()
        return
      }
      if (res.status === 429) {
        setError('Too many failed attempts. Please wait a few minutes and try again.')
      } else if (res.status === 401) {
        setError('Invalid username or password.')
      } else if (res.status === 400) {
        setError('Enter your username and password.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } catch {
      setError('Unable to reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader className="pb-4" />
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm font-medium text-brand-text">
              Username
            </label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus
              required
              maxLength={100}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-brand-text">
              Password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </div>
          <p role="alert" aria-live="polite" className="min-h-5 text-sm text-brand-danger">
            {error}
          </p>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={submitting || !username || !password}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
