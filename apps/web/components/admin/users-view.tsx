'use client'

import { useCallback, useEffect, useState } from 'react'
import { Network, UserPlus } from 'lucide-react'
import type { Role } from '@omnimetrics/types'
import type { MemberRow, Membership } from '@/lib/admin/types'
import { GlassPanel } from '@/components/fx/glass-panel'
import { DataTable, Drawer, Field, MockBanner, PageFrame, Pill, Status, api, btnCls, inputCls, primaryCls, useBusy } from './ui'

const ROLES: Role[] = ['admin', 'builder', 'viewer']

export function UsersView({ orgSlug, orgName, isDirector }: { orgSlug: string; orgName: string; isDirector: boolean }) {
  const base = `/api/portal/o/${encodeURIComponent(orgSlug)}/admin/users`
  const [members, setMembers] = useState<MemberRow[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [scope, setScope] = useState<MemberRow | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [across, setAcross] = useState<{ username: string; memberships: Membership[] } | null>(null)
  const [busy, run] = useBusy()
  const load = useCallback(async () => {
    const r = await api<{ members: MemberRow[]; folders: string[] }>(base, 'GET')
    if (r.ok) { setMembers(r.data.members); setFolders(r.data.folders) } else setMsg({ text: r.error, error: true })
  }, [base])
  useEffect(() => { void load() }, [load])

  const patch = (userId: string, p: { role?: Role; active?: boolean; trackingFolders?: string[] }, ok: string) => run(async () => {
    const r = await api(base, 'POST', { op: 'update', userId, ...p })
    setMsg(r.ok ? { text: ok } : { text: r.error, error: true }); if (r.ok) setScope(null)
    await load()
  })
  const showAcross = (m: MemberRow) => run(async () => {
    const r = await api<{ username: string; memberships: Membership[] }>(`${base}?memberships=${encodeURIComponent(m.userId)}`, 'GET')
    if (r.ok) setAcross(r.data); else setMsg({ text: r.error, error: true })
  })

  return (
    <PageFrame title="Users" description={`${orgName}: people, their role here, grants and tracking scope. A shared login shows only what it holds in this organisation.`} actions={
      <button type="button" className={primaryCls} onClick={() => setAdding(true)}><UserPlus className="size-4" aria-hidden /> Add user</button>
    }>
      <MockBanner>Mock: nothing is stored or sent.</MockBanner>
      <Status msg={msg} />
      <DataTable caption={`Members of ${orgName}`} head={['User', 'Role here', 'Active', 'Grants', 'Tracking scope', 'Actions']}>
        {members.map((m) => (
          <tr key={m.userId} className="border-t border-brand-border/60 align-top">
            <th scope="row" className="px-3 py-2 text-left font-medium">{m.username}{m.isPlatform ? <span className="ml-2"><Pill tone="info">Platform admin</Pill></span> : null}<span className="block text-xs font-normal text-brand-text-muted">{m.email}</span></th>
            <td className="px-3 py-2">
              {m.isPlatform ? <span className="capitalize">{m.role}</span> : (
                <select aria-label={`Role of ${m.username} in ${orgName}`} className={`${inputCls} w-28`} value={m.role} disabled={busy} onChange={(e) => void patch(m.userId, { role: e.target.value as Role }, `Role changed for ${m.username}.`)}>
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                </select>
              )}
            </td>
            <td className="px-3 py-2">
              {m.isPlatform ? <Pill tone="ok">active</Pill> : (
                <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" role="switch" checked={m.active} disabled={busy} onChange={(e) => void patch(m.userId, { active: e.target.checked }, `${m.username} ${e.target.checked ? 'activated' : 'deactivated'}.`)} className="size-4 accent-[var(--color-brand-accent)]" /> {m.active ? 'Active' : 'Inactive'}</label>
              )}
            </td>
            <td className="px-3 py-2 text-xs">{m.grantsSummary}</td>
            <td className="px-3 py-2 text-xs">{m.trackingFolders === null ? 'All folders' : m.trackingFolders.length === 0 ? <span className="text-brand-text-muted">None</span> : m.trackingFolders.join(', ')}</td>
            <td className="px-3 py-2">
              <div className="flex flex-wrap gap-1.5">
                {m.isPlatform || m.role === 'admin' ? null : <button type="button" className={btnCls} onClick={() => { setScope(m); setPicked(m.trackingFolders ?? []) }}>Scope</button>}
                {isDirector && !m.isPlatform ? <button type="button" className={btnCls} onClick={() => void showAcross(m)} aria-label={`Memberships of ${m.username} across organisations`}><Network className="size-3.5" aria-hidden /> Orgs</button> : null}
                {m.isPlatform ? <span className="text-xs text-brand-text-muted">Cannot be edited</span> : null}
              </div>
            </td>
          </tr>
        ))}
      </DataTable>

      {across ? (
        <GlassPanel tone="data" className="p-3" role="region" aria-label="Memberships across organisations">
          <div className="mb-1 flex items-center justify-between"><h2 className="font-display text-sm font-semibold">{across.username}: memberships across organisations</h2><button type="button" className={btnCls} onClick={() => setAcross(null)}>Close</button></div>
          <ul className="space-y-0.5 text-sm">{across.memberships.map((x) => <li key={x.orgSlug} className="list-none">{x.orgName}: <span className="capitalize">{x.role}</span>{x.active ? '' : ' (inactive)'} · {x.folders === null ? 'all folders' : x.folders.length ? x.folders.join(', ') : 'no folders'}</li>)}</ul>
        </GlassPanel>
      ) : null}

      {scope ? (
        <Drawer title={`Tracking scope: ${scope.username}`} onClose={() => setScope(null)} footer={<>
          <button type="button" className={btnCls} onClick={() => setScope(null)}>Cancel</button>
          <button type="button" className={primaryCls} disabled={busy} onClick={() => void patch(scope.userId, { trackingFolders: picked }, `Scope saved for ${scope.username}.`)}>Save scope</button>
        </>}>
          <p className="text-xs text-brand-text-muted">Which tracking folders {scope.username} may see in {orgName}. Builders and viewers only ever get these. Mock folder names.</p>
          <fieldset className="space-y-1.5"><legend className="sr-only">Tracking folders</legend>
            {folders.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--color-brand-accent)]" checked={picked.includes(f)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f] : p.filter((x) => x !== f)))} /> {f}</label>
            ))}
          </fieldset>
        </Drawer>
      ) : null}
      {adding ? <AddUser orgName={orgName} onClose={() => setAdding(false)} onAdd={async (b) => { const r = await api(base, 'POST', { op: 'add', ...b }); if (r.ok) { setAdding(false); setMsg({ text: `Added ${b.username} (mock).` }); await load(); return null } return r.error }} /> : null}
    </PageFrame>
  )
}

function AddUser({ orgName, onClose, onAdd }: { orgName: string; onClose: () => void; onAdd: (b: { username: string; email: string; role: Role }) => Promise<string | null> }) {
  const [username, setUsername] = useState(''); const [email, setEmail] = useState(''); const [role, setRole] = useState<Role>('viewer'); const [err, setErr] = useState<string | null>(null)
  const [busy, run] = useBusy()
  return (
    <Drawer title={`Add user to ${orgName}`} onClose={onClose} footer={<><button type="button" className={btnCls} onClick={onClose}>Cancel</button><button type="button" className={primaryCls} disabled={busy || !username || !email} onClick={() => void run(async () => setErr(await onAdd({ username, email, role })))}>Add user</button></>}>
      <MockBanner>Mock: nothing is stored or sent.</MockBanner>
      <Field id="u-name" label="Username" hint="Lower-case letters, digits . _ -. This creates a new login."><input id="u-name" className={inputCls} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} maxLength={40} /></Field>
      <Field id="u-email" label="Email"><input id="u-email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} /></Field>
      <Field id="u-role" label="Role in this organisation"><select id="u-role" className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
      <Status msg={err ? { text: err, error: true } : null} />
    </Drawer>
  )
}
