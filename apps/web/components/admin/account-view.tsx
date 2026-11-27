'use client'

import { useCallback, useEffect, useState } from 'react'
import { LogOut, ShieldAlert } from 'lucide-react'
import { useFormat } from '@/components/fx/format-context'
import { GlassPanel } from '@/components/fx/glass-panel'
import type { SessionRow } from '@/lib/admin/types'
import { Field, MockBanner, PageFrame, Pill, Status, api, dangerCls, inputCls, primaryCls, useBusy } from './ui'

/** My account: change password, my sessions, two-factor (planned). Always the signed-in person. */
export function AccountView({ username, email, isDirector }: { username: string; email: string; isDirector: boolean }) {
  const fmt = useFormat()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [unavailable, setUnavailable] = useState(false)
  const [cur, setCur] = useState(''); const [next, setNext] = useState('')
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, run] = useBusy()
  const load = useCallback(async () => { const r = await api<{ sessions: SessionRow[] }>('/api/portal/account', 'GET'); if (r.ok) setSessions(r.data.sessions); setUnavailable(!r.ok) }, [])
  useEffect(() => { void load() }, [load])
  const change = () => run(async () => {
    const r = await api<{ message: string }>('/api/portal/account', 'POST', { op: 'password', current: cur, next })
    setMsg(r.ok ? { text: r.data.message } : { text: r.error, error: true }); if (r.ok) { setCur(''); setNext('') }
  })
  const revoke = (s: SessionRow) => run(async () => { const r = await api('/api/portal/account', 'POST', { op: 'revoke', sessionId: s.id }); setMsg(r.ok ? { text: 'Session revoked.' } : { text: r.error, error: true }); await load() })
  return (
    <PageFrame title="My account" description="Your own login details and security.">
      <MockBanner>Mock: nothing is stored or sent. Do not enter your real password.</MockBanner>
      <Status msg={msg} />
      <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-3">
        <GlassPanel tone="data" className="p-4">
          <h2 className="mb-2 font-display text-sm font-semibold">Change password</h2>
          <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"><dt className="text-brand-text-muted">Username</dt><dd className="font-medium">{username}</dd><dt className="text-brand-text-muted">Email</dt><dd className="font-medium">{email}</dd></dl>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void change() }}>
            <Field id="pw-cur" label="Current password"><input id="pw-cur" type="password" autoComplete="current-password" className={inputCls} value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
            <Field id="pw-new" label="New password" hint="At least 12 characters."><input id="pw-new" type="password" autoComplete="new-password" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} /></Field>
            <button type="submit" className={primaryCls} disabled={busy || !cur || !next}>Change password</button>
          </form>
        </GlassPanel>
        <GlassPanel tone="data" className="min-h-0 p-4 lg:col-span-1">
          <h2 className="mb-2 font-display text-sm font-semibold">My sessions</h2>
          {unavailable ? <p className="text-sm text-brand-text-muted">The session list is not available.</p> : null}
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id} className="flex list-none items-start justify-between gap-2 rounded-md border border-brand-border p-2 text-xs">
                <span><span className="block text-sm font-medium">{s.device} {s.current ? <Pill tone="ok">This session</Pill> : null}</span>{s.ip} · last seen {fmt.dateTime(s.lastSeenAt)}</span>
                {s.current ? null : <button type="button" className={dangerCls} disabled={busy} onClick={() => void revoke(s)} aria-label={`Revoke session on ${s.device}`}><LogOut className="size-3.5" aria-hidden /> Revoke</button>}
              </li>
            ))}
          </ul>
        </GlassPanel>
        <GlassPanel tone="data" className="p-4">
          <h2 className="mb-1 flex items-center gap-2 font-display text-sm font-semibold"><ShieldAlert className="size-4" aria-hidden /> Two-factor authentication <Pill tone="muted">Planned</Pill></h2>
          <p className="text-sm text-brand-text-muted">TOTP is planned.{isDirector ? ' It will be required for the director account' : ' It will be required for the director account'} before any client logins are enabled. Nothing to set up yet.</p>
        </GlassPanel>
      </div>
    </PageFrame>
  )
}
