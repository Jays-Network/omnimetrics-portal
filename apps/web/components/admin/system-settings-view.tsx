'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PORTAL_TIMEZONE } from '@omnimetrics/types'
import { GlassPanel } from '@/components/fx/glass-panel'
import { createFormatter } from '@/lib/settings/format'
import { DATE_FORMATS, LANGUAGES, NUMBER_FORMATS, REGIONS, SCOPE_LABEL, SETTING_KEYS, TIMEZONES, TIME_FORMATS, resolveSettings, type PartialSettings, type Scope, type SettingKey } from '@/lib/settings/model'
import type { SettingsView } from '@/lib/portal/mock/admin'
import { MockBanner, PageFrame, Pill, Status, api, btnCls, inputCls, primaryCls, useBusy } from './ui'
import { cn } from '@/lib/utils'

const LABEL: Record<SettingKey, string> = { dateFormat: 'Date format', timeFormat: 'Time format', timeZone: 'Time zone (display only)', region: 'Region (numbers, currency, week start)', language: 'Language', numberFormat: 'Number format' }
const OPTIONS: Record<SettingKey, readonly { id: string; label: string }[]> = {
  dateFormat: DATE_FORMATS, timeFormat: TIME_FORMATS, timeZone: TIMEZONES.map((t) => ({ id: t, label: t })),
  region: Object.entries(REGIONS).map(([id, r]) => ({ id, label: `${r.label} (${r.locale}, ${r.currency}, week starts ${r.weekStart === 1 ? 'Monday' : 'Sunday'})` })),
  language: LANGUAGES, numberFormat: NUMBER_FORMATS,
}
const SAMPLE = new Date('2026-11-23T14:05:09Z')

export function SystemSettingsView({ orgSlug, orgName, initial }: { orgSlug: string; orgName: string; initial: SettingsView }) {
  const router = useRouter()
  const [view, setView] = useState(initial)
  const scopes = useMemo(() => ([
    { id: 'user' as const, label: 'My preferences', allowed: true },
    { id: 'org' as const, label: `${orgName} defaults`, allowed: view.can.org },
    { id: 'system' as const, label: 'System defaults', allowed: view.can.system },
  ]).filter((s) => s.allowed), [view.can, orgName])
  const [scope, setScope] = useState<Scope>('user')
  const [draft, setDraft] = useState<PartialSettings>(initial.user)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, run] = useBusy()

  const pick = (s: Scope) => { setScope(s); setDraft({ ...view[s] }); setMsg(null) }
  // Effective value as it WOULD be once this scope's draft is saved (live sample before saving).
  const preview = useMemo(() => resolveSettings({ system: scope === 'system' ? draft : view.system, org: scope === 'org' ? draft : view.org, user: scope === 'user' ? draft : view.user }), [scope, draft, view])
  const f = createFormatter(preview.value)
  const dirty = JSON.stringify(draft) !== JSON.stringify(view[scope])

  const save = () => run(async () => {
    const unset = SETTING_KEYS.filter((k) => draft[k] === undefined && view[scope][k] !== undefined)
    const set = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined))
    const r = await api<{ view: SettingsView }>(`/api/portal/o/${encodeURIComponent(orgSlug)}/settings`, 'PUT', { scope, set, unset })
    if (!r.ok) { setMsg({ text: r.error, error: true }); return }
    setView(r.data.view); setDraft({ ...r.data.view[scope] }); setMsg({ text: 'Saved. Dates and numbers across the portal now use these values.' })
    router.refresh() // the server layout re-resolves the effective settings for every viewer and builder screen
  })

  return (
    <PageFrame title="Settings" description="Date, time, region and language. Your override wins over the organisation default, which wins over the system default.">
      <MockBanner>Mock: nothing is stored beyond this running server.</MockBanner>
      <p className="shrink-0 rounded-md border border-brand-border px-3 py-1.5 text-xs text-brand-text-muted" role="note">These settings change how values are <strong>displayed</strong>, never how data is counted or bucketed. Day, week and month bucketing, the 60-day window and billing periods stay on {PORTAL_TIMEZONE} (R6).</p>
      <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <GlassPanel tone="data" className="p-4">
          <div role="tablist" aria-label="Settings scope" className="mb-3 flex flex-wrap gap-1">
            {scopes.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={scope === s.id} onClick={() => pick(s.id)} className={cn('rounded-md px-2.5 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent', scope === s.id ? 'bg-brand-surface-raised font-semibold' : 'text-brand-text-muted hover:bg-brand-surface')}>{s.label}</button>
            ))}
          </div>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save() }}>
            {SETTING_KEYS.map((k) => (
              <div key={k}>
                <label htmlFor={`s-${k}`} className="mb-0.5 block text-xs font-medium">{LABEL[k]}</label>
                <select id={`s-${k}`} className={inputCls} value={(draft[k] as string | undefined) ?? ''} disabled={k === 'language' && false} onChange={(e) => setDraft((d) => { const n = { ...d } as Record<string, unknown>; if (e.target.value === '') delete n[k]; else n[k] = e.target.value; return n as PartialSettings })}>
                  <option value="">{scope === 'system' ? 'Built-in default' : 'Use the inherited value'}</option>
                  {OPTIONS[k].map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <button type="submit" className={primaryCls} disabled={busy || !dirty}>Save {SCOPE_LABEL[scope].toLowerCase()}</button>
              <button type="button" className={btnCls} disabled={!dirty} onClick={() => setDraft({ ...view[scope] })}>Discard changes</button>
            </div>
            <Status msg={msg} />
          </form>
        </GlassPanel>

        <GlassPanel tone="data" className="p-4" role="region" aria-label="Effective for you">
          <h2 className="mb-2 font-display text-sm font-semibold">Effective for you</h2>
          <table className="mb-3 w-full text-sm">
            <caption className="sr-only">Effective settings and where each value comes from</caption>
            <thead className="text-left text-xs uppercase tracking-wider text-brand-text-muted"><tr><th scope="col" className="py-1 font-medium">Setting</th><th scope="col" className="py-1 font-medium">Value</th><th scope="col" className="py-1 font-medium">From</th></tr></thead>
            <tbody>
              {SETTING_KEYS.map((k) => (
                <tr key={k} className="border-t border-brand-border/60">
                  <th scope="row" className="py-1 pr-2 text-left font-normal text-brand-text-muted">{LABEL[k].replace(/ \(.*/, '')}</th>
                  <td className="py-1 pr-2" data-effective={k}>{OPTIONS[k].find((o) => o.id === preview.value[k])?.label.replace(/ \(.*/, '') ?? String(preview.value[k])}</td>
                  <td className="py-1" data-source={k}><Pill tone={preview.source[k] === 'user' ? 'ok' : 'muted'}>{SCOPE_LABEL[preview.source[k]]}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="mb-1 text-xs font-medium text-brand-text-muted">Live sample{dirty ? ' (unsaved)' : ''}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" aria-live="polite">
            <dt className="text-brand-text-muted">Date</dt><dd data-sample="date" className="tabular">{f.date(SAMPLE)}</dd>
            <dt className="text-brand-text-muted">Time</dt><dd data-sample="time" className="tabular">{f.time(SAMPLE)}</dd>
            <dt className="text-brand-text-muted">Number</dt><dd data-sample="number" className="tabular">{f.number(1234567.891, 2)}</dd>
            <dt className="text-brand-text-muted">Currency</dt><dd data-sample="currency" className="tabular">{f.currency(1234.5)}</dd>
            <dt className="text-brand-text-muted">Week starts</dt><dd>{f.weekStart === 1 ? 'Monday' : 'Sunday'} (display and date-picker presets only)</dd>
          </dl>
        </GlassPanel>
      </div>
    </PageFrame>
  )
}
