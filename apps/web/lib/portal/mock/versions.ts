import type { OrgAccess } from '@omnimetrics/types'
import { SPEC_V, appendVersion, addPanel, emptyDash, normalizeSpec, parseSpec, restoreVersion, type DashSpec, type DashVersion } from '@/lib/builder/model'

// MOCK version store: in memory, per organisation AND dashboard id, append-only.
// A dashboard id from another organisation is simply absent (keys include the org id).
const g = globalThis as unknown as { __omniMockVersions?: Map<string, DashVersion[]> }
const store = () => (g.__omniMockVersions ??= new Map())
const key = (org: Pick<OrgAccess, 'org'>, nodeId: string) => `${org.org.id}:${nodeId}`

function seedSpec(): DashSpec {
  let d = emptyDash()
  // Free-form layout in artboard units (1920 wide).
  for (const [t, id, x, y] of [['stat', 'seed-1', 24, 24], ['stat-spark', 'seed-2', 528, 24], ['bar-grouped', 'seed-3', 24, 348], ['table', 'seed-4', 24, 772]] as const) d = addPanel(d, t, id, { x, y })
  return d
}

export function mockVersions(ctx: Pick<OrgAccess, 'org'>, nodeId: string): DashVersion[] {
  const k = key(ctx, nodeId)
  let list: DashVersion[] | undefined = store().get(k)
  // Versions stored before a spec change (e.g. no `settings`) are upgraded on read and written back.
  if (list && list.some((v: DashVersion) => (v.spec as { v?: unknown }).v !== SPEC_V || !(v.spec as { settings?: unknown }).settings)) {
    list = list.map((v: DashVersion) => ({ ...v, spec: normalizeSpec(v.spec) }))
    store().set(k, list)
  }
  if (!list) {
    list = appendVersion([], seedSpec(), 'system', 'Initial layout (mock)', new Date('2026-11-01T08:00:00Z'))
    store().set(k, list)
  }
  return list
}

export type SaveInput = { spec: unknown; note?: string } | { restore: number }
export type SaveResult = { ok: true; versions: DashVersion[] } | { ok: false; code: 'invalid' | 'not_found'; error: string }

export function saveMockVersion(ctx: Pick<OrgAccess, 'org'>, nodeId: string, input: SaveInput, author: string, now = new Date()): SaveResult {
  const list = mockVersions(ctx, nodeId)
  let next: DashVersion[] | null
  if ('restore' in input) {
    next = restoreVersion(list, input.restore, author, now)
    if (!next) return { ok: false, code: 'not_found', error: 'No such version' }
  } else {
    const parsed = parseSpec(input.spec)
    if (!parsed.ok) return { ok: false, code: 'invalid', error: 'The dashboard spec is not valid' }
    next = appendVersion(list, parsed.spec, author, input.note?.trim() || 'Saved', now)
  }
  store().set(key(ctx, nodeId), next)
  return { ok: true, versions: next }
}

export function resetMockVersions(): void {
  g.__omniMockVersions = new Map()
}
