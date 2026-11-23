import type { ContentNode, DashboardView, GrantAccess, GrantRow, OrgAccess } from '@omnimetrics/types'
import { normalizeSpec, type DashSpec } from '@/lib/builder/model'
import { canEditDashboard } from '@/lib/builder/settings'
import { storedGrants } from './grants'

// MOCK DATA: seeded, deterministic, obviously fake numbers.
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ACCESS_RANK: Record<GrantAccess, number> = { view: 1, edit: 2, manage: 3 }

/** Access the caller has on a dashboard in the mock (no real grants until M5). */
export function mockAccessFor(access: Pick<OrgAccess, 'role' | 'isPlatform'>): GrantAccess {
  if (access.isPlatform || access.role === 'admin') return 'manage'
  return access.role === 'builder' ? 'edit' : 'view'
}

export function grantsFor(node: ContentNode, orgName: string): GrantRow[] {
  const r = rng(hash(`grants:${node.id}`))
  const rows: GrantRow[] = [
    { principal: `${orgName} admins`, kind: 'role', access: 'manage', via: 'Organisation role' },
    { principal: `${orgName} builders`, kind: 'role', access: 'edit', via: 'Organisation role' },
    { principal: `${orgName} viewers`, kind: 'role', access: 'view', via: 'Organisation role' },
  ]
  const extra: GrantRow[] = [
    { principal: 'mock.analyst1', kind: 'user', access: 'edit', via: 'Folder grant' },
    { principal: 'mock.ops-leads', kind: 'group', access: 'view', via: 'Folder grant' },
    { principal: 'mock.contractor', kind: 'user', access: 'view', via: 'Direct grant' },
  ]
  for (const e of extra) if (r() > 0.35) rows.push(e)
  return rows.sort((a, b) => ACCESS_RANK[b.access] - ACCESS_RANK[a.access])
}

export function buildDashboardView(access: OrgAccess, node: ContentNode, path: ContentNode[], spec: DashSpec): DashboardView {
  let yourAccess = mockAccessFor(access)
  // Read-only dashboards: builders lose Edit (admins and the director keep it).
  if (yourAccess === 'edit' && !canEditDashboard(access, normalizeSpec(spec).settings)) yourAccess = 'view'
  return {
    node,
    path,
    spec: normalizeSpec(spec),
    // The grant list is for people who can edit; viewers see only their own access.
    grants: yourAccess === 'view' ? [] : (storedGrants(access, node.id) ?? grantsFor(node, access.org.name)),
    yourAccess,
  }
}
