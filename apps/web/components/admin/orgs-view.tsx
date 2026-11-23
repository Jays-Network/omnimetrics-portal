'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import type { OrgProfile } from '@/lib/admin/types'
import { DataTable, Field, MockBanner, PageFrame, Pill, Status, api, btnCls, inputCls, primaryCls, useBusy } from './ui'
import { GlassPanel } from '@/components/fx/glass-panel'

/** Director: every organisation (create, rename, suspend). Org admin: their own profile, read-only. */
export function OrgsView({ orgSlug, isDirector }: { orgSlug: string; isDirector: boolean }) {
  const base = `/api/portal/o/${encodeURIComponent(orgSlug)}/admin/organisations`
  const [orgs, setOrgs] = useState<OrgProfile[]>([])
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [busy, run] = useBusy()
  const load = useCallback(async () => { const r = await api<{ orgs: OrgProfile[] }>(base, 'GET'); if (r.ok) setOrgs(r.data.orgs); else setMsg({ text: r.error, error: true }) }, [base])
  useEffect(() => { void load() }, [load])
  const post = (body: unknown, ok: string) => run(async () => { const r = await api(base, 'POST', body); setMsg(r.ok ? { text: ok } : { text: r.error, error: true }); if (r.ok) { setName(''); setEditing(null) } await load() })

  if (!isDirector) {
    const o = orgs[0]
    return (
      <PageFrame title="Organisation" description="Your organisation's profile. The director manages organisations.">
        <MockBanner>Mock: nothing is stored or sent.</MockBanner>
        {o ? (
          <GlassPanel tone="data" className="max-w-md p-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-brand-text-muted">Name</dt><dd className="font-medium">{o.name}</dd>
              <dt className="text-brand-text-muted">Status</dt><dd><Pill tone={o.status === 'active' ? 'ok' : 'bad'}>{o.status}</Pill></dd>
              <dt className="text-brand-text-muted">Members</dt><dd className="tabular">{o.memberCount}</dd>
              <dt className="text-brand-text-muted">Integrations</dt><dd className="tabular">{o.integrationCount}</dd>
              <dt className="text-brand-text-muted">Dashboards</dt><dd className="tabular">{o.dashboardCount}</dd>
            </dl>
            <p className="mt-3 text-xs text-brand-text-muted">Organisation defaults for dates and numbers are under Settings.</p>
          </GlassPanel>
        ) : null}
      </PageFrame>
    )
  }
  return (
    <PageFrame title="Organisations" description="Every organisation on the platform (director only).">
      <MockBanner>Mock: nothing is stored or sent.</MockBanner>
      <Status msg={msg} />
      <DataTable caption="Organisations" head={['Name', 'Status', 'Members', 'Integrations', 'Dashboards', 'Actions']}>
        {orgs.map((o) => (
          <tr key={o.id} className="border-t border-brand-border/60">
            <th scope="row" className="px-3 py-2 text-left font-medium">
              {editing?.id === o.id ? (
                <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void post({ op: 'update', id: o.id, name: editing.name }, 'Renamed.') }}>
                  <input aria-label={`New name for ${o.name}`} className={inputCls} value={editing.name} onChange={(e) => setEditing({ id: o.id, name: e.target.value })} autoFocus onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
                  <button type="submit" className={primaryCls} disabled={busy}>Save</button>
                </form>
              ) : o.name}
            </th>
            <td className="px-3 py-2"><Pill tone={o.status === 'active' ? 'ok' : 'bad'}>{o.status}</Pill></td>
            <td className="tabular px-3 py-2">{o.memberCount}</td>
            <td className="tabular px-3 py-2">{o.integrationCount}</td>
            <td className="tabular px-3 py-2">{o.dashboardCount}</td>
            <td className="px-3 py-2">
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={btnCls} onClick={() => setEditing({ id: o.id, name: o.name })}>Rename</button>
                <button type="button" className={btnCls} disabled={busy} onClick={() => void post({ op: 'update', id: o.id, status: o.status === 'active' ? 'suspended' : 'active' }, o.status === 'active' ? 'Suspended.' : 'Reactivated.')}>{o.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
              </div>
            </td>
          </tr>
        ))}
      </DataTable>
      <GlassPanel tone="data" className="p-3">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void post({ op: 'create', name }, 'Organisation created.') }}>
          <Field id="o-new" label="New organisation"><input id="o-new" className={inputCls} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
          <button type="submit" className={primaryCls} disabled={busy || name.trim().length < 2}><Plus className="size-4" aria-hidden /> Create</button>
        </form>
      </GlassPanel>
    </PageFrame>
  )
}
