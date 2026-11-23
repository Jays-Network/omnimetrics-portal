import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { CATEGORIES } from '@/lib/panels/types'
import { PANEL_TYPES, PanelSpecSchema, defaultSpec, getPanelType, mockDataFor } from '@/lib/panels/registry'
import { PanelView } from '@/components/panels/panel-view'
import { safeHref } from '@/components/panels/content'
import { stubPanelSize } from './size-stub'

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

describe('panel registry', () => {
  it('has unique ids, a renderer or a "soon" flag, and a non-empty label for every entry', () => {
    const ids = PANEL_TYPES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of PANEL_TYPES) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.render !== null || t.soon === true, `${t.id} needs a renderer or soon`).toBe(true)
      expect(CATEGORIES.some((c) => c.id === t.category)).toBe(true)
      expect(t.size.w).toBeGreaterThan(0)
      expect(t.size.w).toBeLessThanOrEqual(12)
    }
  })

  it('covers every requested category and asset', () => {
    for (const c of CATEGORIES) expect(PANEL_TYPES.some((t) => t.category === c.id), c.label).toBe(true)
    const need = ['bar-grouped', 'bar-stacked', 'bar-horizontal', 'line', 'area-stacked', 'pie', 'donut', 'scatter', 'radar', 'combo', 'histogram', 'treemap', 'funnel', 'sankey',
      'stat', 'stat-spark', 'gauge', 'bar-gauge', 'progress-ring', 'table', 'top-n', 'alert-list', 'activity-log', 'heatmap-hour-day', 'heatmap-calendar', 'state-timeline', 'status-history',
      'map-points', 'map-route', 'map-zones', 'text', 'image', 'divider', 'links', 'ctl-folder', 'ctl-country', 'ctl-dates', 'ctl-multi', 'ctl-search']
    for (const id of need) expect(getPanelType(id), id).toBeDefined()
    expect(PANEL_TYPES.filter((t) => t.category === 'ready').map((t) => t.label)).toEqual(['Monthly Total Trucks', 'Escorts', 'Heatmap', 'Active Tracks', 'Grand Total', 'Dispatched', 'Daily', 'Weekly'])
  })

  it('parses a default spec for every entry and rejects bad ones', () => {
    for (const t of PANEL_TYPES) expect(PanelSpecSchema.safeParse(defaultSpec(t.id)).success, t.id).toBe(true)
    expect(PanelSpecSchema.safeParse({ v: 1, chart: 'nope' }).success).toBe(false)
    expect(PanelSpecSchema.safeParse({ v: 2, chart: 'line' }).success).toBe(false)
    expect(PanelSpecSchema.safeParse({ v: 1, chart: 'line', sql: 'select 1' }).success).toBe(false) // never SQL from the browser
    expect(PanelSpecSchema.safeParse({ v: 1, chart: 'line', groupBy: [{ field: 'a' }, { field: 'b' }, { field: 'c' }] }).success).toBe(false)
    // blocks are enforced per type: text takes none, a stat takes no group-by
    expect(PanelSpecSchema.safeParse({ v: 1, chart: 'text', filters: [{ field: 'a', op: 'eq', value: 'x' }] }).success).toBe(false)
    expect(PanelSpecSchema.safeParse({ v: 1, chart: 'stat', groupBy: [{ field: 'a' }] }).success).toBe(false)
    expect(PanelSpecSchema.safeParse({ v: 1, chart: 'line', filters: [{ field: 'a', op: 'eq', value: 'x' }], groupBy: [{ field: 'day' }], measure: { fn: 'count' } }).success).toBe(true)
  })

  it('renders every available entry with mock data and an accessible table', () => {
    for (const t of PANEL_TYPES.filter((x) => x.render)) {
      const data = mockDataFor(t, 'test')
      const table = t.a11y(data, t.label)
      expect(table.columns.length, t.id).toBeGreaterThan(0)
      expect(table.rows.length, t.id).toBeGreaterThan(0)
      const { container, unmount } = render(<PanelView type={t} title={t.label} data={data} />)
      // Either a hidden data table (visual is aria-hidden) or the visual is itself accessible.
      if (!t.visualAccessible) {
        expect(container.querySelector('table.sr-only'), `${t.id} sr table`).not.toBeNull()
        expect(container.querySelector('[aria-hidden="true"]'), `${t.id} hides visual`).not.toBeNull()
      }
      expect(container.textContent, `${t.id} rendered "no data"`).not.toMatch(/No data of the expected shape/)
      unmount()
    }
  })

  it('keeps mock data deterministic and lets filters change it', () => {
    const t = getPanelType('bar-grouped')!
    expect(mockDataFor(t, 's')).toEqual(mockDataFor(t, 's'))
    expect(mockDataFor(t, 's', { country: 'Country A' })).not.toEqual(mockDataFor(t, 's'))
  })
})

describe('content safety', () => {
  it('only links to http(s), mailto and same-site paths', () => {
    expect(safeHref('https://example.com')).toBeTruthy()
    expect(safeHref('/dashboard')).toBe('/dashboard')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('//evil.example')).toBeNull()
    expect(safeHref('data:text/html,x')).toBeNull()
  })
})

describe('panels fit their cell (default and minimum size)', () => {
  const COL = 160 // logical units per grid cell, minus the 12-unit frame padding on each side and the title row
  const cell = (w: number, h: number) => ({ width: w * COL - 24, height: h * 100 - 24 - 20 })
  let size = cell(1, 1)

  it('has a minimum no larger than the default for every type, and never below 1x1 cell', () => {
    for (const t of PANEL_TYPES) {
      expect(t.min.w, t.id).toBeGreaterThanOrEqual(1)
      expect(t.min.h, t.id).toBeGreaterThanOrEqual(1)
      expect(t.min.w, t.id).toBeLessThanOrEqual(t.size.w)
      expect(t.min.h, t.id).toBeLessThanOrEqual(t.size.h)
    }
  })

  it('renders non-empty content with no overflowing fixed sizes, at default size and at minimum size', () => {
    const restore = stubPanelSize(() => size)
    try {
      const available = PANEL_TYPES.filter((t) => t.render)
      expect(available.length).toBe(48) // none are "soon": all 48 render
      for (const t of available) {
        for (const [label, s] of [['default', t.size], ['minimum', t.min]] as const) {
          size = cell(s.w, s.h)
          const { container, unmount } = render(<PanelView type={t} title={t.label} data={mockDataFor(t, 'fit')} />)
          const where = `${t.id} at ${label} ${s.w}x${s.h}`
          const frame = container.querySelector('figure')!
          expect(frame.className, where).toMatch(/overflow-hidden/)
          expect(frame.className, where).toMatch(/min-h-0/)
          const content = container.querySelector('[data-panel-content]')!
          expect(content.children.length, `${where} rendered nothing`).toBeGreaterThan(0)
          expect((content.textContent ?? '').trim().length > 0 || content.querySelector('svg, input, select, img, table, ul, ol, div') !== null, `${where} is empty`).toBe(true)
          for (const el of [content, ...Array.from(content.querySelectorAll<HTMLElement | SVGElement>('*'))]) {
            const st = (el as HTMLElement).style
            expect(st?.overflow, where).not.toBe('visible')
            for (const dim of ['width', 'height'] as const) {
              const m = /^(\d+(?:\.\d+)?)px$/.exec(st?.[dim] ?? '')
              if (m) expect(Number(m[1]), `${where}: inline ${dim} ${m[1]}px exceeds the ${dim === 'width' ? size.width : size.height}px cell`).toBeLessThanOrEqual(dim === 'width' ? size.width : size.height)
            }
          }
          expect(container.textContent, where).not.toMatch(/No data of the expected shape/)
          unmount()
        }
      }
    } finally {
      restore()
    }
  })

  it('a dropped grouped bar chart renders its chart immediately (the blank-panel bug)', () => {
    size = { width: 500, height: 300 }
    const restore = stubPanelSize(() => size)
    try {
      const t = getPanelType('bar-grouped')!
      const { container } = render(<PanelView type={t} title="Bar" data={mockDataFor(t, 'drop')} />)
      expect(container.querySelector('.recharts-wrapper')).not.toBeNull()
      expect(container.querySelectorAll('.recharts-bar-rectangle, .recharts-rectangle').length).toBeGreaterThan(0)
    } finally {
      restore()
    }
  })
})
