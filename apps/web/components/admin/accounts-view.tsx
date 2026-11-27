'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, LogOut } from 'lucide-react'
import { useFormat } from '@/components/fx/format-context'
import { GlassPanel } from '@/components/fx/glass-panel'
import type { MemberRow, SessionRow } from '@/lib/admin/types'
import { OneTimePassword, type IssuedPassword } from './one-time-password'
import { DataTable, MockBanner, PageFrame, Pill, Status, api, btnCls, dangerCls, useBusy } from './ui'

/** Login security for members of this organisation. Platform admins are shown but cannot be touched. */
export function AccountsView({ orgSlug, orgName }: { orgSlug: string; orgName: string }) {
  const u = `/api/portal/o/${encodeURIComponent(orgSlug)}/admin/users`
  const a = `/api/portal/o/${encodeURIComponent(orgSlug)}/admin/accounts`
  const fmt = useFormat()
  const [members, setMembers] = useState<MemberRow[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [unavailable, setUnavailable] = useState(false) // pg has no session list yet: "none" would be untrue
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, run] = useBusy()
  const [issued, setIssued] = useState<IssuedPassword | null>(null)
  const dismissIssued = useCallback(() => setIssued(null), [])
  const loadMembers = useCallback(async () => { const r = await api<{ members: MemberRow[] }>(u, 'GET'); if (r.ok) setMembers(r.data.members); else setMsg({ text: r.error, error: true }) }, [u])
  const loadSessions = useCallback(async (id: string) => { const r = await api<{ sessions: SessionRow[] }>(`${a}?userId=${encodeURIComponent(id)}`, 'GET'); if (r.ok) setSessions(r.data.sessions); setUnavailable(!r.ok) }, [a])
  useEffect(() => { void loadMembers() }, [loadMembers])
  useEffect(() => { if (sel) void loadSessions(sel) }, [sel, loadSessions])
  const selMember = members.find((m) => m.userId === sel)

  const reset = (m: MemberRow, trigger: HTMLElement) => run(async () => {
    const r = await api<{ message: string; oneTimePassword: string }>(a, 'POST', { op: 'reset', userId: m.userId })
    setMsg(r.ok ? { text: r.data.message } : { text: r.error, error: true })
    if (r.ok) setIssued({ username: m.username, password: r.data.oneTimePassword, trigger })
  })
  const deactivate = (m: MemberRow) => run(async () => { const r = await api(u, 'POST', { op: 'update', userId: m.userId, active: !m.active }); setMsg(r.ok ? { text: `${m.username} ${m.active ? 'deactivated' : 'activated'}.` } : { text: r.error, error: true }); await loadMembers() })
  const revoke = (s: SessionRow) => run(async () => { const r = await api(a, 'POST', { op: 'revoke', sessionId: s.id }); setMsg(r.ok ? { text: 'Session revoked.' } : { text: r.error, error: true }); if (sel) await loadSessions(sel) })

  return (
    <PageFrame title="Accounts" description={`${orgName}: login security for members. Your own page is under your name, top right (My account).`}>
      <MockBanner>Mock: nothing is stored or sent.</MockBanner>
      <Status msg={msg} />
      <div className="grid shrink-0 grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <DataTable caption="Members" head={['User', 'Status', 'Actions']} >
          {members.map((m) => (
            <tr key={m.userId} className="border-t border-brand-border/60" aria-selected={sel === m.userId}>
              <th scope="row" className="px-3 py-2 text-left font-medium"><button type="button" className="rounded text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" onClick={() => setSel(m.userId)}>{m.username}</button>{m.isPlatform ? <span className="ml-2"><Pill tone="info">Platform admin</Pill></span> : null}</th>
              <td className="px-3 py-2"><Pill tone={m.active ? 'ok' : 'muted'}>{m.active ? 'active' : 'inactive'}</Pill></td>
              <td className="px-3 py-2">
                {m.isPlatform ? <span className="text-xs text-brand-text-muted">Cannot be edited</span> : (
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className={btnCls} disabled={busy} onClick={(e) => void reset(m, e.currentTarget)} aria-label={`Reset password for ${m.username}`}><KeyRound className="size-3.5" aria-hidden /> Reset password</button>
                    <button type="button" className={btnCls} disabled={busy} onClick={() => void deactivate(m)}>{m.active ? 'Deactivate' : 'Activate'}</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
        <GlassPanel tone="data" className="overflow-hidden">
          <div data-scroll="sessions" className="max-h-[28rem] min-h-0 overflow-y-auto overscroll-contain p-3 scroll-token" tabIndex={0} role="region" aria-label="Active sessions">
            <h2 className="mb-2 font-display text-sm font-semibold">{selMember ? `Active sessions: ${selMember.username}` : 'Active sessions'}</h2>
            {!sel ? <p className="text-sm text-brand-text-muted">Select a member to see their sessions.</p> : unavailable ? <p className="text-sm text-brand-text-muted">The session list is not available.</p> : sessions.length === 0 ? <p className="text-sm text-brand-text-muted">No active sessions.</p> : (
              <ul className="space-y-2">
                {sessions.map((s) => (
                  <li key={s.id} className="flex list-none items-start justify-between gap-2 rounded-md border border-brand-border p-2 text-xs">
                    <span><span className="block text-sm font-medium">{s.device}</span>{s.ip} · started {fmt.dateTime(s.startedAt)}<span className="block text-brand-text-muted">last seen {fmt.dateTime(s.lastSeenAt)}</span></span>
                    {selMember?.isPlatform ? null : <button type="button" className={dangerCls} disabled={busy || s.current} onClick={() => void revoke(s)} aria-label={`Revoke session on ${s.device}`}><LogOut className="size-3.5" aria-hidden /> Revoke</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </GlassPanel>
      </div>
      {issued ? <OneTimePassword issued={issued} onClose={dismissIssued} /> : null}
    </PageFrame>
  )
}
