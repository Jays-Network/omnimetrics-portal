import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { capabilitiesFor, type OrgAccess, type Role } from '@omnimetrics/types'
import { DashSpecSchema, emptyDash, addPanel, parseSpec, type DashSpec } from '@/lib/builder/model'
import {
  DashSettingsSchema, MIN_REFRESH_S, canEditDashboard, defaultSettings, effectiveRefreshSeconds, isSafeUrl, parseDuration, resolveTimezone, resolveVariable,
  shouldRefresh, variableFilters, type Variable,
} from '@/lib/builder/settings'
import { SettingsView, SETTINGS_TABS, validateSpecText, type SettingsViewProps } from '@/components/builder/settings-view'
import { useAutoRefresh } from '@/components/dashboards/use-refresh'

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

const org = (role: Role, isPlatform = false): OrgAccess => ({ org: { id: 'mock-org-worldrisk', slug: 'worldrisk', name: 'WorldRisk', status: 'active' }, role, isPlatform, capabilities: capabilitiesFor(role, isPlatform) })
const director = org('admin', true)
const orgAdmin = org('admin')
const builder = org('builder')
const viewer = org('viewer')

afterEach(() => vi.useRealTimers())

describe('settings schema', () => {
  it('has safe defaults: time zone from the system, no variables, lazy-load on, editable', () => {
    const s = defaultSettings()
    expect(s).toMatchObject({ v: 1, general: { editable: true, tags: [] }, time: { timezone: 'default', weekStart: 'default', autoRefresh: 'off', hideTimePicker: false }, panelOptions: { tooltip: 'default', lazyLoad: true }, variables: [], links: [] })
    expect(DashSettingsSchema.safeParse({}).success).toBe(true)
    expect(DashSpecSchema.safeParse({ v: 3, panels: [] }).success).toBe(true) // settings default in
    expect(parseSpec({ v: 2, panels: [] }).ok).toBe(true) // and an older spec is migrated first
  })
  it('rejects invalid settings', () => {
    const bad = (x: unknown) => expect(DashSettingsSchema.safeParse(x).success, JSON.stringify(x)).toBe(false)
    bad({ unknown: 1 })
    bad({ time: { weekStart: 'friday' } })
    bad({ time: { nowDelay: '2h' } })
    bad({ time: { nowDelay: 'soon' } })
    bad({ panelOptions: { tooltip: 'everywhere' } })
    bad({ general: { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) } })
    bad({ general: { sql: 'select 1' } }) // no SQL anywhere
    bad({ variables: [{ name: 'Bad Name', type: 'text' }] })
    bad({ variables: [{ name: 'a', type: 'text' }, { name: 'a', type: 'text' }] }) // duplicate names
    bad({ variables: [{ name: 'a', type: 'dropdown' }] }) // needs a field
    bad({ variables: [{ name: 'a', type: 'dropdown', field: 'trips' }] }) // a number field is not a dropdown source
    bad({ variables: [{ name: 'a', type: 'dropdown', field: 'nope' }] })
    bad({ variables: [{ name: 'a', type: 'custom' }] }) // empty list
    bad({ variables: [{ name: 'a', type: 'constant', values: ['x', 'y'] }] })
    bad({ variables: [{ name: 'a', type: 'interval', values: ['often'] }] })
    bad({ variables: [{ name: 'a', type: 'text', multi: true }] })
    bad({ links: [{ label: 'x', kind: 'url', target: 'javascript:alert(1)' }] })
    bad({ links: [{ label: 'x', kind: 'url', target: '//evil.example' }] })
    bad({ links: [{ label: '', kind: 'url', target: 'https://example.com' }] })
  })
  it('accepts valid variables, links and times', () => {
    const r = DashSettingsSchema.safeParse({
      general: { description: 'd', tags: ['a', 'b'], editable: false },
      time: { timezone: 'UTC', weekStart: 'sunday', refreshIntervals: ['30s', '5m'], autoRefresh: '5m', nowDelay: '1m', hideTimePicker: true, refreshLive: true },
      panelOptions: { tooltip: 'sharedCrosshair', lazyLoad: false },
      variables: [{ name: 'country', type: 'dropdown', field: 'country', includeAll: true, multi: true, default: ['Value A'] }, { name: 'env', type: 'constant', values: ['prod'] }, { name: 'step', type: 'interval', values: ['1m', '5m'] }],
      links: [{ label: 'Other', kind: 'dashboard', target: 'wr-d3' }, { label: 'Docs', kind: 'url', target: 'https://example.com/x', newTab: true }],
    })
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true)
  })
  it('settings are part of the dashboard spec (and travel in versions)', () => {
    const d: DashSpec = { ...emptyDash(), settings: { ...defaultSettings(), general: { ...defaultSettings().general, description: 'hello' } } }
    const parsed = DashSpecSchema.parse(JSON.parse(JSON.stringify(d)))
    expect(parsed.settings.general.description).toBe('hello')
    expect(DashSpecSchema.safeParse({ ...d, settings: { ...d.settings, time: { ...d.settings.time, refreshIntervals: ['10s'] } } }).success).toBe(false)
  })
})

describe('refresh minimum and pausing', () => {
  it('parses durations and refuses anything below the minimum', () => {
    expect(parseDuration('30s')).toBe(30)
    expect(parseDuration('5m')).toBe(300)
    expect(parseDuration('1d')).toBe(86400)
    expect(parseDuration('x')).toBeNull()
    expect(MIN_REFRESH_S).toBe(30)
    for (const bad of ['1s', '10s', '29s']) expect(DashSettingsSchema.safeParse({ time: { refreshIntervals: [bad] } }).success, bad).toBe(false)
    expect(DashSettingsSchema.safeParse({ time: { refreshIntervals: ['30s'] } }).success).toBe(true)
    expect(DashSettingsSchema.safeParse({ time: { autoRefresh: '10s' } }).success).toBe(false)
  })
  it('never refreshes faster than 30s even if a bad value slips in', () => {
    expect(effectiveRefreshSeconds('5s')).toBe(30)
    expect(effectiveRefreshSeconds('1m')).toBe(60)
    expect(effectiveRefreshSeconds('off')).toBeNull()
    expect(effectiveRefreshSeconds(undefined)).toBeNull()
  })
  it('pauses while the tab is hidden and catches up once when it is shown again', () => {
    vi.useFakeTimers()
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    expect(shouldRefresh('hidden')).toBe(false)
    expect(shouldRefresh('visible')).toBe(true)
    const { result } = renderHook(() => useAutoRefresh('30s'))
    expect(result.current.tick).toBe(0)
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(result.current.tick).toBe(1)
    visibility = 'hidden'
    act(() => { vi.advanceTimersByTime(90_000) })
    expect(result.current.tick).toBe(1) // nothing while hidden
    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(result.current.tick).toBe(2) // one catch-up
  })
  it('a too-small interval is clamped to 30s by the hook', () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => 'visible')
    const { result } = renderHook(() => useAutoRefresh('5s'))
    act(() => { vi.advanceTimersByTime(29_000) })
    expect(result.current.tick).toBe(0)
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(result.current.tick).toBe(1)
  })
})

describe('time zone is display only', () => {
  it('resolves dashboard > organisation > system, falling back on a bad zone', () => {
    expect(resolveTimezone('default', null, 'Africa/Johannesburg')).toBe('Africa/Johannesburg')
    expect(resolveTimezone('default', 'Europe/London', 'Africa/Johannesburg')).toBe('Europe/London')
    expect(resolveTimezone('UTC', 'Europe/London')).toBe('UTC')
    expect(resolveTimezone('Not/AZone', null, 'Africa/Johannesburg')).toBe('Africa/Johannesburg')
  })
})

describe('variables', () => {
  const v = (x: Partial<Variable>): Variable => ({ name: 'country', label: '', type: 'custom', values: ['A', 'B'], multi: false, includeAll: true, ...x })
  it('resolves defaults, "All" and constants', () => {
    expect(resolveVariable(v({ default: 'B' }), {})).toBe('B')
    expect(resolveVariable(v({}), { $country: 'A' })).toBe('A')
    expect(resolveVariable(v({}), { $country: 'All' })).toBeNull()
    expect(resolveVariable(v({ type: 'constant', values: ['prod'], includeAll: false }), {})).toBe('prod')
  })
  it('panel filters that reference $name pick up the variable value', () => {
    const f = [{ field: 'country', op: 'eq', value: '$country' }, { field: 'status', op: 'eq', value: 'Active' }]
    expect(variableFilters(f, [v({})], { $country: 'A' })).toEqual({ country: 'A' })
    expect(variableFilters(f, [v({})], { $country: 'All' })).toEqual({}) // All = no restriction
    expect(variableFilters(f, [], {})).toEqual({}) // unknown variable
  })
  it('only safe link targets pass', () => {
    expect(isSafeUrl('https://example.com')).toBe(true)
    expect(isSafeUrl('/dashboard')).toBe(true)
    for (const x of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', 'ftp://x']) expect(isSafeUrl(x), x).toBe(false)
  })
})

describe('read-only hides Edit from builders', () => {
  const ro = (on: boolean) => ({ general: { ...defaultSettings().general, editable: !on } })
  it('decides by role', () => {
    expect(canEditDashboard(builder, ro(false))).toBe(true)
    expect(canEditDashboard(builder, ro(true))).toBe(false)
    expect(canEditDashboard(orgAdmin, ro(true))).toBe(true)
    expect(canEditDashboard(director, ro(true))).toBe(true)
    expect(canEditDashboard(viewer, ro(false))).toBe(false)
  })
})

describe('delete with undo', () => {
  it('needs dashboards.delete: builders and admins have it, viewers do not', () => {
    expect(capabilitiesFor('viewer', false)).not.toContain('dashboards.delete')
    for (const r of ['builder', 'admin'] as const) expect(capabilitiesFor(r, false)).toContain('dashboards.delete')
    expect(director.capabilities).toContain('dashboards.delete')
  })
})

const baseProps = (over: Partial<SettingsViewProps> = {}): SettingsViewProps => ({
  dash: addPanel(emptyDash(), 'stat', 'a'), onChange: vi.fn(), onReplace: vi.fn(), versions: [], note: '', onNote: vi.fn(), busy: false, onRestore: vi.fn(),
  isAdmin: true, canDelete: true, orgSlug: 'worldrisk', nodeId: 'wr-d3', dashboardName: 'Daily Overview', systemTz: 'Africa/Johannesburg', onRenamed: vi.fn(), onClose: vi.fn(), ...over,
})


describe('settings view (UI)', () => {
  it('reaches every tab by keyboard and click, with arrow-key navigation', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ nodes: [], grants: [] }) })))
    render(<SettingsView {...baseProps()} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(SETTINGS_TABS.map(([, l]) => l))
    expect(tabs.map((t) => t.textContent)).toEqual(['General', 'Time options', 'Panel options', 'Variables', 'Links', 'Versions', 'Permissions', 'JSON Model', 'Annotations'])
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Time options' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Time options' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Annotations' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/Planned/)).toBeInTheDocument()
    for (const t of tabs) { fireEvent.click(t); expect(screen.getByRole('tabpanel')).toBeInTheDocument() }
    vi.unstubAllGlobals()
  })

  it('has no "default grid" option (the canvas is free-form) and states that time options are display only', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ nodes: [] }) })))
    render(<SettingsView {...baseProps()} />)
    expect(screen.queryByText(/default grid/i)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Time options' }))
    expect(screen.getByText(/never change how data is bucketed or counted/i)).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('a refresh interval below 30s is refused with a message and nothing is applied', () => {
    const onChange = vi.fn()
    render(<SettingsView {...baseProps({ onChange })} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Time options' }))
    const box = screen.getByLabelText('Auto-refresh intervals')
    fireEvent.change(box, { target: { value: '10s, 1m' } })
    fireEvent.blur(box)
    expect(screen.getByRole('alert')).toHaveTextContent(/30s/)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: '30s, 1m' } })
    fireEvent.blur(box)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('deletes with a confirmation and offers Undo', async () => {
    const calls: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (body) calls.push(body)
      return { ok: true, json: async () => (body?.op === 'delete' ? { ok: true, batchId: 'b1', nodes: [] } : { ok: true, nodes: [] }) }
    }))
    render(<SettingsView {...baseProps()} />)
    fireEvent.click(screen.getByRole('button', { name: /^Delete dashboard$/ }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(calls).toEqual([]) // nothing happens before confirming
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByText(/was deleted/)
    expect(calls).toEqual([{ op: 'delete', id: 'wr-d3' }])
    fireEvent.click(screen.getByRole('button', { name: /Undo delete/ }))
    await waitFor(() => expect(calls).toContainEqual({ op: 'restore', batchId: 'b1' }))
    await screen.findByText(/Dashboard restored/)
    vi.unstubAllGlobals()
  })

  it('hides the ability to delete without the capability', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ nodes: [] }) })))
    render(<SettingsView {...baseProps({ canDelete: false })} />)
    expect(screen.getByRole('button', { name: /^Delete dashboard$/ })).toBeDisabled()
    vi.unstubAllGlobals()
  })

  it('Variables: validates the draft and adds a valid one', () => {
    const onChange = vi.fn()
    render(<SettingsView {...baseProps({ onChange })} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Variables' }))
    fireEvent.click(screen.getByRole('button', { name: /Add variable/ }))
    expect(screen.getByRole('button', { name: 'Save variable' })).toBeDisabled() // empty name
    fireEvent.change(screen.getByLabelText('Variable name'), { target: { value: 'country' } })
    expect(screen.getByRole('button', { name: 'Save variable' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save variable' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = (onChange.mock.calls[0]![0] as (d: DashSpec) => DashSpec)(emptyDash())
    expect(next.settings.variables).toMatchObject([{ name: 'country', type: 'dropdown', field: 'country' }])
  })

  it('Links: refuses an unsafe address', () => {
    render(<SettingsView {...baseProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Links' }))
    fireEvent.change(screen.getByLabelText('Link type'), { target: { value: 'url' } })
    fireEvent.change(screen.getByLabelText('Link label'), { target: { value: 'Bad' } })
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'javascript:alert(1)' } })
    expect(screen.getByRole('button', { name: /Add link/ })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/http/)
  })
})

describe('JSON Model', () => {
  const good = () => JSON.stringify(addPanel(emptyDash(), 'stat', 'a'))
  it('validates text: syntax, unknown keys (no SQL), bad settings, bad layout', () => {
    expect(validateSpecText(good())).toMatchObject({ ok: true })
    expect(validateSpecText('{ nope')).toMatchObject({ ok: false, errors: [expect.stringMatching(/Not valid JSON/)] })
    const d = JSON.parse(good())
    expect(validateSpecText(JSON.stringify({ ...d, sql: 'select 1' }))).toMatchObject({ ok: false })
    const noSql = validateSpecText(JSON.stringify({ ...d, panels: [{ ...d.panels[0], spec: { ...d.panels[0].spec, sql: 'drop table x' } }] }))
    expect(noSql.ok).toBe(false)
    const refresh = validateSpecText(JSON.stringify({ ...d, settings: { time: { refreshIntervals: ['5s'] } } }))
    expect(refresh.ok === false && refresh.errors.join(' ')).toMatch(/settings\.time\.refreshIntervals/)
    const off = validateSpecText(JSON.stringify({ ...d, panels: [{ ...d.panels[0], layout: { x: 1800, y: 0, w: 480, h: 200, z: 0 } }] }))
    expect(off.ok === false && off.errors.join(' ')).toMatch(/artboard/)
  })
  it('Apply shows errors inline and applies nothing on error; a valid spec is applied', () => {
    const onReplace = vi.fn()
    const dash = addPanel(emptyDash(), 'stat', 'a')
    render(<SettingsView {...baseProps({ onReplace, dash })} />)
    fireEvent.click(screen.getByRole('tab', { name: 'JSON Model' }))
    const box = screen.getByLabelText('Dashboard JSON')
    fireEvent.change(box, { target: { value: JSON.stringify({ ...dash, settings: { time: { refreshIntervals: ['5s'] } } }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/refreshIntervals/)
    expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was applied/)
    expect(onReplace).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: JSON.stringify({ ...dash, settings: { general: { description: 'edited' } } }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onReplace).toHaveBeenCalledTimes(1)
    expect((onReplace.mock.calls[0]![0] as DashSpec).settings.general.description).toBe('edited')
  })
  it('is read-only for non-admins (no Apply)', () => {
    render(<SettingsView {...baseProps({ isAdmin: false })} />)
    fireEvent.click(screen.getByRole('tab', { name: 'JSON Model' }))
    expect(screen.getByLabelText('Dashboard JSON')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })
})
