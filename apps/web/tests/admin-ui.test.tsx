import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { isEditorPath, isFixedPath } from '@/components/shell/editor-shell'
import { NAV_TABS } from '@/components/shell/nav'
import { capabilitiesFor } from '@omnimetrics/types'
import { FormatProvider, useFormat } from '@/components/fx/format-context'
import { formatStat } from '@/components/fx/stat-card'
import { DEFAULT_SETTINGS } from '@/lib/settings/model'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/x' }))

const row = (o: object = {}) => ({ usedBy: 2, id: 'r1', name: 'WR warehouse', kind: 'postgres', host: 'db.mock-wr.internal', port: 5432, database: 'wr', relations: ['reporting'], sslMode: 'verify-full', status: 'ok', managed: false, hasCredentials: true, keyId: 'k1', rotatedAt: '2026-11-01T08:00:00Z', lastTest: null, ...o })
const managed = row({ id: 'managed-local', name: 'Local database (read-only)', managed: true, hasCredentials: false, keyId: null, status: 'managed', host: 'localhost' })
const hosts = [{ id: 'h1', host: 'db.mock-wr.internal', portMin: 5432, portMax: 5439 }, { id: 'h2', host: 'localhost', portMin: 5432, portMax: 5432 }]

function stubApi(canManageHosts: boolean) {
  const calls: { url: string; body?: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body as string | undefined })
    return new Response(JSON.stringify({ ok: true, rows: [managed, row()], hosts, audit: [], canManageHosts, row: row() }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}

describe('shell: new sections are fixed-viewport and gated by capability', () => {
  it('the M4 sections use the fixed layout; dashboards stay scrolling', () => {
    for (const p of ['/dashboard/o/worldrisk/integrations', '/dashboard/o/worldrisk/admin/users', '/dashboard/o/worldrisk/settings', '/dashboard/account', '/dashboard/platform/organisations', '/dev/pages/users']) expect(isFixedPath(p), p).toBe(true)
    expect(isFixedPath('/dashboard/o/worldrisk/dashboards')).toBe(false)
    expect(isEditorPath('/dashboard/o/worldrisk/integrations')).toBe(false)
  })
  it('builders and viewers get no Integrations or Admin tab; org admins and the director do', () => {
    const visible = (role: 'admin' | 'builder' | 'viewer', platform = false) => NAV_TABS.filter((t) => capabilitiesFor(role, platform).includes(t.cap)).map((t) => t.key)
    expect(visible('builder')).toEqual(['dashboards', 'settings'])
    expect(visible('viewer')).toEqual(['dashboards', 'settings'])
    expect(visible('admin')).toEqual(['dashboards', 'integrations', 'admin', 'settings'])
    expect(visible('admin', true)).toEqual(['dashboards', 'integrations', 'admin', 'settings'])
  })
})

describe('Integrations screen (card catalogue)', () => {
  it('shows the managed local connection as a card with a Managed badge, status and usage', async () => {
    stubApi(false)
    const { IntegrationsView } = await import('@/components/admin/integrations-view')
    render(<IntegrationsView orgSlug="worldrisk" orgName="WorldRisk" />)
    const card = await screen.findByRole('button', { name: /Local database \(read-only\), PostgreSQL, Never tested/ })
    expect(card.textContent).toMatch(/Managed/)
    expect(card.textContent).toMatch(/Used by 2 dashboards/)
    expect(screen.getByRole('heading', { name: /Connected/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Available connectors/ })).toBeInTheDocument()
    expect(screen.getByText(/Mock: nothing is stored or sent. Do not enter real credentials./)).toBeInTheDocument()
    expect(screen.getByText(/Credentials are encrypted and write-only. Hosts come from an allowlist./)).toBeInTheDocument()
  })
  it('the detail shows facts only; the managed row has no Edit or Delete; Edit never prefills a credential', async () => {
    const calls = stubApi(false)
    const { IntegrationsView } = await import('@/components/admin/integrations-view')
    render(<IntegrationsView orgSlug="worldrisk" orgName="WorldRisk" />)
    fireEvent.click(await screen.findByRole('button', { name: /Local database/ }))
    let dlg = await screen.findByRole('dialog', { name: /Local database/ })
    expect(dlg.textContent).toMatch(/No stored secret/)
    expect(screen.queryByRole('button', { name: /Delete Local database/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Edit Local database/ })).toBeNull()
    fireEvent.keyDown(dlg, { key: 'Escape' })
    fireEvent.click(await screen.findByRole('button', { name: /WR warehouse, PostgreSQL/ }))
    dlg = await screen.findByRole('dialog', { name: /WR warehouse/ })
    expect(dlg.textContent).toMatch(/Saved, key k1, rotated/)
    fireEvent.click(screen.getByRole('button', { name: 'Edit WR warehouse' }))
    const edit = await screen.findByRole('dialog', { name: /Edit WR warehouse/ })
    expect(edit.textContent).toMatch(/Credentials saved, key k1, rotated/)
    expect(edit.querySelector('input[type="password"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.body?.includes('"op":"save"'))).toBe(true))
    expect(calls.find((c) => c.body?.includes('"op":"save"'))!.body).not.toContain('"credentials"')
    fireEvent.click(await screen.findByRole('button', { name: /WR warehouse, PostgreSQL/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit WR warehouse' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Replace credentials' }))
    const field = document.querySelector<HTMLInputElement>('input[type="password"]')!
    expect(field.value).toBe('')
    expect(field.autocomplete).toBe('new-password')
  })
  it('only PostgreSQL can be added; every other card says why and does nothing', async () => {
    stubApi(true)
    const { IntegrationsView } = await import('@/components/admin/integrations-view')
    const { CONNECTORS } = await import('@/lib/admin/connectors')
    render(<IntegrationsView orgSlug="worldrisk" orgName="WorldRisk" />)
    await screen.findByText('Available connectors', { exact: false })
    for (const c of CONNECTORS.filter((x) => x.status !== 'functional')) {
      const card = document.querySelector<HTMLElement>(`[data-connector="${c.id}"]`)!
      expect(card.getAttribute('aria-disabled'), c.id).toBe('true')
      expect(card.textContent, c.id).toContain(c.reason!)
      expect(card.textContent, c.id).toMatch(/not available/)
      fireEvent.click(card)
      expect(screen.queryByRole('dialog'), `${c.id} must not open a drawer`).toBeNull()
    }
    const pg = document.querySelector<HTMLElement>('[data-connector="postgres"]')!
    expect(pg.getAttribute('aria-disabled')).toBe('false')
    fireEvent.click(pg)
    const kind = (await screen.findByLabelText('Kind')) as HTMLSelectElement
    const opt = (t: RegExp) => [...kind.options].find((o) => t.test(o.text))!
    expect(opt(/Postgres/).disabled).toBe(false)
    expect(opt(/SQLite \(Deferred\)/).disabled).toBe(true)
    const host = screen.getByLabelText('Host', { selector: 'select' }) as HTMLSelectElement
    expect([...host.options].map((o) => o.value)).toEqual(['db.mock-wr.internal', 'localhost'])
  })
  it('search, Type and State filters narrow the catalogue; empty results offer Clear filters', async () => {
    stubApi(false)
    const { IntegrationsView } = await import('@/components/admin/integrations-view')
    render(<IntegrationsView orgSlug="worldrisk" orgName="WorldRisk" />)
    await screen.findByRole('button', { name: /WR warehouse/ })
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'available' } })
    expect(screen.queryByRole('heading', { name: /Connected/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'connected' } })
    expect(screen.queryByRole('heading', { name: /Available connectors/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'notifications' } })
    expect(document.querySelector('[data-connector="telegram"]')).not.toBeNull()
    expect(document.querySelector('[data-connector="postgres"]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText(/Search connectors/), { target: { value: 'zzz-nothing' } })
    expect(await screen.findByText(/No connectors or connections match/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(document.querySelector('[data-connector="postgres"]')).not.toBeNull()
  })
  it('the Allowed hosts button and its form exist only for the director', async () => {
    stubApi(false)
    const { IntegrationsView } = await import('@/components/admin/integrations-view')
    const a = render(<IntegrationsView orgSlug="worldrisk" orgName="WorldRisk" />)
    await screen.findByRole('button', { name: /WR warehouse/ })
    expect(screen.queryByRole('button', { name: 'Allowed hosts' })).toBeNull()
    a.unmount()
    stubApi(true)
    render(<IntegrationsView orgSlug="worldrisk" orgName="WorldRisk" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Allowed hosts' }))
    expect(await screen.findByRole('button', { name: 'Allow host' })).toBeInTheDocument()
  })
  it('the security banner can be dismissed and stays dismissed', async () => {
    stubApi(false); localStorage.clear()
    const { IntegrationsView } = await import('@/components/admin/integrations-view')
    const a = render(<IntegrationsView orgSlug="worldrisk" orgName="WorldRisk" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss security note' }))
    expect(screen.queryByText(/encrypted and write-only/)).toBeNull()
    a.unmount()
    render(<IntegrationsView orgSlug="worldrisk" orgName="WorldRisk" />)
    await waitFor(() => expect(screen.queryByText(/encrypted and write-only/)).toBeNull())
    localStorage.clear()
  })
})

describe('shared formatter reaches the UI helpers', () => {
  it('formatStat follows the provider and falls back to legacy output without one', () => {
    expect(formatStat(1234567.5, 1)).toBeTruthy()
    function Probe() { const f = useFormat(); return <p data-testid="p">{f.number(1234567.891, 2)}|{formatStat(1234567.891, 2)}</p> }
    render(<FormatProvider settings={{ ...DEFAULT_SETTINGS, numberFormat: 'dot-comma' }}><Probe /></FormatProvider>)
    expect(screen.getByTestId('p').textContent).toBe('1.234.567,89|1.234.567,89')
    cleanup()
    render(<FormatProvider settings={{ ...DEFAULT_SETTINGS, numberFormat: 'comma-dot' }}><Probe /></FormatProvider>)
    expect(screen.getByTestId('p').textContent).toBe('1,234,567.89|1,234,567.89')
  })
})
