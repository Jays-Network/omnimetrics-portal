import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { capabilitiesFor, type OrgAccess, type Role } from '@omnimetrics/types'
import {
  DashSpecSchema, addPanel, appendVersion, blockIssue, blocksToSpec, canAddBlock, changeChart, commit, emptyDash, insertBlock, newBlock, newHistory,
  redo, reorderBlocks, restoreVersion, setPanelOption, specToBlocks, undo, type Block, type DashSpec,
} from '@/lib/builder/model'
import { canSeeTerminal, checkSql, runMock } from '@/lib/builder/terminal'
import { PanelSpecSchema, defaultSpec } from '@/lib/panels/registry'
import { resetMockContent } from '@/lib/portal/mock/content'
import { resetMockVersions, saveMockVersion } from '@/lib/portal/mock/versions'
import SqlTerminal from '@/components/builder/sql-terminal'

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

const org = (slug: string, role: Role, isPlatform = false): OrgAccess => ({ org: { id: `mock-org-${slug}`, slug, name: slug, status: 'active' }, role, isPlatform, capabilities: capabilitiesFor(role, isPlatform) })
const builder = org('worldrisk', 'builder')
const viewer = org('worldrisk', 'viewer')

beforeEach(() => { resetMockContent(); resetMockVersions() })

describe('block to spec mapping', () => {
  it('maps filter, group by, measure, sort and limit blocks to a v:1 spec that passes the schema', () => {
    const base = defaultSpec('bar-grouped')
    let blocks = specToBlocks(base)
    const filter = { ...(newBlock('filter', 'f1') as Extract<Block, { kind: 'filter' }>), field: 'country', op: 'in' as const, value: 'A, B' }
    const group = { ...(newBlock('groupBy', 'g1') as Extract<Block, { kind: 'groupBy' }>), field: 'event_time', grain: 'day' as const }
    const measure = { ...(newBlock('measure', 'm1') as Extract<Block, { kind: 'measure' }>), fn: 'sum' as const, field: 'trips' }
    for (const b of [filter, group, measure, newBlock('sort', 's1'), newBlock('limit', 'l1')]) blocks = insertBlock(blocks, b)
    const spec = blocksToSpec(base, blocks)
    expect(spec).toMatchObject({ v: 1, chart: 'bar-grouped', filters: [{ field: 'country', op: 'in', value: ['A', 'B'] }], groupBy: [{ field: 'event_time', grain: 'day' }], measure: { fn: 'sum', field: 'trips' }, sort: { field: 'trips', dir: 'desc' }, limit: 10 })
    expect(PanelSpecSchema.safeParse(spec).success).toBe(true)
    expect(specToBlocks(spec).map((b) => b.kind)).toEqual(['chart', 'filter', 'groupBy', 'measure', 'sort', 'limit'])
  })

  it('leaves blocks with a problem out of the spec and flags them', () => {
    const base = defaultSpec('line')
    const empty = newBlock('filter', 'f1') // empty value
    const badSum = { ...(newBlock('measure', 'm1') as Extract<Block, { kind: 'measure' }>), fn: 'sum' as const, field: 'country' } // sum of text
    const blocks = insertBlock(insertBlock(specToBlocks(base), empty), badSum)
    expect(blockIssue(empty, blocks)).toMatch(/value/i)
    expect(blockIssue(badSum, blocks)).toMatch(/needs number/)
    const spec = blocksToSpec(base, blocks)
    expect(spec.filters).toEqual([])
    expect(spec.measure).toBeUndefined()
  })

  it('changing the chart type drops blocks it does not take and resets options', () => {
    let spec = blocksToSpec(defaultSpec('bar-grouped'), insertBlock(specToBlocks(defaultSpec('bar-grouped')), { ...(newBlock('groupBy', 'g1') as Extract<Block, { kind: 'groupBy' }>), field: 'country' }))
    spec = setPanelOption(spec, 'unit', 'km')
    expect(spec.groupBy).toHaveLength(1)
    const r = changeChart(spec, 'stat') // a stat takes no group by
    expect(r.dropped).toEqual(['groupBy'])
    expect(r.spec.chart).toBe('stat')
    expect(r.spec.groupBy).toEqual([])
    expect(r.spec.options).toEqual({})
    expect(PanelSpecSchema.safeParse(r.spec).success).toBe(true)
    expect(changeChart(spec, 'no-such-type').spec).toBe(spec)
  })
})

describe('allowed and un-droppable combinations', () => {
  it('offers only the blocks the registry entry allows', () => {
    expect(canAddBlock('bar-grouped', specToBlocks(defaultSpec('bar-grouped')), 'groupBy')).toBeNull()
    expect(canAddBlock('stat', specToBlocks(defaultSpec('stat')), 'groupBy')).toMatch(/does not take/)
    expect(canAddBlock('text', specToBlocks(defaultSpec('text')), 'filter')).toMatch(/does not take/)
    expect(canAddBlock('line', specToBlocks(defaultSpec('line')), 'chart')).toMatch(/exactly one/)
  })

  it('caps group by at 2, measure at 1 and filters at 20', () => {
    let blocks = specToBlocks(defaultSpec('line'))
    blocks = insertBlock(insertBlock(blocks, newBlock('groupBy', 'g1')), newBlock('groupBy', 'g2'))
    expect(canAddBlock('line', blocks, 'groupBy')).toMatch(/At most 2/)
    blocks = insertBlock(blocks, newBlock('measure', 'm1'))
    expect(canAddBlock('line', blocks, 'measure')).toMatch(/one/)
    for (let i = 0; i < 20; i++) blocks = insertBlock(blocks, newBlock('filter', `f${i}`))
    expect(canAddBlock('line', blocks, 'filter')).not.toBeNull()
  })

  it('rejects a reorder that breaks the stack order and accepts one inside a kind', () => {
    let blocks = specToBlocks(defaultSpec('line'))
    blocks = insertBlock(insertBlock(insertBlock(blocks, newBlock('filter', 'f1')), newBlock('filter', 'f2')), newBlock('measure', 'm1'))
    expect(blocks.map((b) => b.id)).toEqual(['chart-0', 'f1', 'f2', 'm1'])
    expect(reorderBlocks(blocks, 3, 1)).toBeNull() // measure above a filter
    expect(reorderBlocks(blocks, 1, 0)).toBeNull() // filter above the chart type
    expect(reorderBlocks(blocks, 1, 2)?.map((b) => b.id)).toEqual(['chart-0', 'f2', 'f1', 'm1'])
  })

  it('flags type mismatches: grain on text, duplicate group by, number filter with text value', () => {
    const g = { ...(newBlock('groupBy', 'g1') as Extract<Block, { kind: 'groupBy' }>), field: 'country', grain: 'day' as const }
    expect(blockIssue(g, [g])).toMatch(/date/)
    const g2 = { ...g, id: 'g2', grain: undefined }
    const g1 = { ...g, grain: undefined }
    expect(blockIssue(g2, [g1, g2])).toMatch(/Already/)
    const f = { ...(newBlock('filter', 'f1') as Extract<Block, { kind: 'filter' }>), field: 'trips', op: 'eq' as const, value: 'many' }
    expect(blockIssue(f, [f])).toMatch(/number/)
  })
})

describe('dashboard spec schema (v2, free-form)', () => {
  const ok = (): DashSpec => addPanel(addPanel(emptyDash(), 'stat', 'a'), 'bar-grouped', 'b')
  it('accepts a built dashboard and rejects invalid combinations', () => {
    expect(DashSpecSchema.safeParse(ok()).success).toBe(true)
    const dup = ok(); dup.panels[1]!.id = 'a'
    expect(DashSpecSchema.safeParse(dup).success).toBe(false)
    const off = ok(); off.panels[0]!.layout = { x: 1700, y: 0, w: 480, h: 200, z: 0 }
    expect(DashSpecSchema.safeParse(off).success).toBe(false) // leaves the artboard
    const small = ok(); small.panels[0]!.layout = { x: 0, y: 0, w: 10, h: 10, z: 0 }
    expect(DashSpecSchema.safeParse(small).success).toBe(false) // below the type minimum
    const sql = { ...ok(), panels: [{ ...ok().panels[0]!, spec: { ...ok().panels[0]!.spec, sql: 'select 1' } }] }
    expect(DashSpecSchema.safeParse(sql).success).toBe(false) // never SQL from the browser
    const badBlock = ok(); badBlock.panels[0]!.spec = { ...badBlock.panels[0]!.spec, groupBy: [{ field: 'country' }] } // stat takes no group by
    expect(DashSpecSchema.safeParse(badBlock).success).toBe(false)
    expect(DashSpecSchema.safeParse({ ...ok(), v: 1 }).success).toBe(false) // the old grid layout version is refused
  })
})

describe('undo and redo', () => {
  it('steps back and forward, clears redo on a new change and coalesces keyed edits', () => {
    let h = newHistory(emptyDash())
    h = commit(h, addPanel(h.present, 'stat', 'a'))
    h = commit(h, addPanel(h.present, 'stat', 'b'))
    expect(h.present.panels).toHaveLength(2)
    h = undo(h)
    expect(h.present.panels).toHaveLength(1)
    h = redo(h)
    expect(h.present.panels).toHaveLength(2)
    h = undo(undo(h))
    h = commit(h, addPanel(h.present, 'gauge', 'c'))
    expect(h.future).toHaveLength(0)
    let t = newHistory(addPanel(emptyDash(), 'stat', 'a'))
    for (const title of ['A', 'Ab', 'Abc']) t = commit(t, { ...t.present, panels: [{ ...t.present.panels[0]!, spec: { ...t.present.panels[0]!.spec, title } }] }, 'title:a')
    expect(t.past).toHaveLength(1) // one undo step for the whole typing run
    expect(undo(t).present.panels[0]!.spec.title).toBe('Stat')
    expect(undo(newHistory(1))).toEqual(newHistory(1))
  })
})

describe('versions: append-only save and restore', () => {
  const ctx = builder
  const nodeId = 'wr-d3' // any id; the mock checks it is a dashboard of THIS org below

  it('appends instead of overwriting and restore appends a copy', () => {
    const v1 = appendVersion([], emptyDash(), 'a', 'first', new Date(0))
    const v2 = appendVersion(v1, addPanel(emptyDash(), 'stat', 'p'), 'b', 'second', new Date(1))
    expect(v1).toHaveLength(1) // input untouched
    expect(v2.map((v) => v.n)).toEqual([1, 2])
    expect(v2[0]!.spec.panels).toHaveLength(0)
    const v3 = restoreVersion(v2, 1, 'c', new Date(2))!
    expect(v3.map((v) => v.n)).toEqual([1, 2, 3])
    expect(v3[2]).toMatchObject({ note: 'Restored from v1', author: 'c' })
    expect(v3[2]!.spec.panels).toHaveLength(0)
    expect(v3[1]!.spec.panels).toHaveLength(1) // history unchanged
    expect(restoreVersion(v2, 99, 'c', new Date(2))).toBeNull()
  })

  it('the mock store validates the spec (no SQL, no unknown keys)', () => {
    const r = saveMockVersion(ctx, 'wr-d3', { spec: { ...emptyDash(), sql: 'drop table x' } }, 'a')
    expect(r.ok).toBe(false)
  })
})
