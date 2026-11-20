'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { GlowInput } from '@/components/fx/glow-input'
import { NeonButton } from '@/components/fx/neon-button'

export function LoginForm({ next, onSuccess }: { next: string; onSuccess?: () => void | Promise<void> }) {
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
        await onSuccess?.() // visual transition only; the redirect below is unchanged
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
    <form onSubmit={onSubmit} noValidate className="space-y-4 p-6">
      <div className="space-y-2">
        <label htmlFor="username" className="text-sm font-medium text-brand-text">
          Username
        </label>
        <GlowInput
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
        <GlowInput
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
      <NeonButton type="submit" className="w-full" loading={submitting} disabled={!username || !password}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </NeonButton>
    </form>
  )
}
