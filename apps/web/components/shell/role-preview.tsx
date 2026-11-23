'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PreviewRole } from '@/lib/portal/preview'

/**
 * Dev-only "preview as role" (mock portal only). Reduce-only: the list holds
 * only roles below the real one, and the server refuses anything else.
 */
export function RolePreview({ current, options }: { current: PreviewRole | null; options: PreviewRole[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  if (options.length === 0 && !current) return null

  async function change(value: string) {
    setBusy(true)
    try {
      await fetch('/api/portal/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: value === '' ? null : value }),
      })
    } finally {
      setBusy(false)
      router.refresh()
    }
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-brand-text-muted">
      <span className="hidden md:inline">Preview as</span>
      <select
        value={current ?? ''}
        disabled={busy}
        onChange={(e) => void change(e.target.value)}
        aria-label="Preview the portal as a lower role (development only)"
        className="h-8 rounded-md border border-brand-border bg-brand-surface px-1.5 text-xs capitalize text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
      >
        <option value="">My role</option>
        {options.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
        {current && !options.includes(current) ? <option value={current}>{current}</option> : null}
      </select>
    </label>
  )
}
