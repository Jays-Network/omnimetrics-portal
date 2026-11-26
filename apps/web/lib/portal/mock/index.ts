import { capabilitiesFor, type OrgAccess } from '@omnimetrics/types'
import type { Portal, PortalIdentity, OrgSummary } from '../types'
import { applyOp, pathOf, toClient, type StoredNode } from '../tree'
import { mockStore, setMockStore } from './content'
import { buildDashboardView } from './dashboard'
import { mockVersions, saveMockVersion } from './versions'
import { canManageGrants, storeGrants, storedGrants } from './grants'
import { grantsFor } from './dashboard'
import { canEditDashboard } from '@/lib/builder/settings'
import { normalizeSpec, type DashVersion } from '@/lib/builder/model'

import * as admin from './admin'

// MOCK DATA: development only (see ../index.ts). Obviously fake, deterministic.
const orgSummaries = (): OrgSummary[] => admin.listOrgs().map((o) => {
  const p = admin.organisations.list({ org: o, role: 'admin', isPlatform: true, capabilities: capabilitiesFor('admin', true) })
  return p.ok ? p.orgs.find((x) => x.id === o.id)! : { id: o.id, slug: o.slug, name: o.name, status: o.status, memberCount: 0, integrationCount: 0, dashboardCount: 0 }
})

/**
 * Mock memberships are keyed to the REAL signed-in user (auth is never
 * bypassed): the existing admin acts as the director in both organisations;
 * any other user gets WorldRisk with their real role. Unknown = no access.
 */
function accessFor(who: PortalIdentity): OrgAccess[] {
  if (who.role === 'admin') {
    return orgSummaries().map((o) => ({
      org: { id: o.id, slug: o.slug, name: o.name, status: o.status },
      role: 'admin',
      isPlatform: true,
      capabilities: capabilitiesFor('admin', true),
    }))
  }
  const wr = orgSummaries()[0]!
  if (wr.status === 'suspended') return [] // a suspended organisation is closed to everyone but the director
  return [
    {
      org: { id: wr.id, slug: wr.slug, name: wr.name, status: wr.status },
      role: who.role,
      isPlatform: false,
      capabilities: capabilitiesFor(who.role, false),
    },
  ]
}

function requireEdit(ctx: OrgAccess) {
  if (!ctx.capabilities.includes('dashboards.edit')) throw new Error('forbidden')
}

/** A read-only dashboard refuses builders even if they call the API directly; admins and the director can still change it. */
function requireEditable(ctx: OrgAccess, list: DashVersion[]) {
  if (!canEditDashboard(ctx, normalizeSpec(list[list.length - 1]!.spec).settings)) throw new Error('forbidden')
}

const isDashboard = (ctx: OrgAccess, nodeId: string) => toClient(mockStore(ctx)).some((n) => n.id === nodeId && n.kind === 'dashboard')

function requireView(ctx: OrgAccess) {
  if (!ctx.capabilities.includes('dashboards.view')) throw new Error('forbidden')
}

export const mockPortal: Portal = {
  mode: 'mock',
  orgs: {
    async listAccessible(who) {
      return accessFor(who)
    },
    async listAll() {
      return orgSummaries()
    },
  },
  integrations: admin.integrations,
  organisations: admin.organisations,
  users: admin.users,
  accounts: admin.accounts,
  account: admin.account,
  settings: admin.settings,
  content: {
    async tree(ctx) {
      requireView(ctx)
      return toClient(mockStore(ctx))
    },
    async apply(ctx, op) {
      requireView(ctx)
      const out: { stored?: StoredNode[] } = {}
      const result = applyOp(mockStore(ctx), ctx, op, out)
      if (result.ok && out.stored) setMockStore(ctx, out.stored)
      return result
    },
  },
  dashboards: {
    async get(ctx, nodeId) {
      requireView(ctx)
      const nodes = toClient(mockStore(ctx))
      const node = nodes.find((n) => n.id === nodeId)
      if (!node || node.kind !== 'dashboard') return null
      const versions = mockVersions(ctx, nodeId)
      return buildDashboardView(ctx, node, pathOf(nodes, nodeId), versions[versions.length - 1]!.spec)
    },
    async versions(ctx, nodeId) {
      requireEdit(ctx)
      if (!isDashboard(ctx, nodeId)) return null
      const list = mockVersions(ctx, nodeId)
      requireEditable(ctx, list)
      return list
    },
    async grants(ctx, nodeId) {
      requireEdit(ctx)
      const node = toClient(mockStore(ctx)).find((n) => n.id === nodeId && n.kind === 'dashboard')
      return node ? (storedGrants(ctx, nodeId) ?? grantsFor(node, ctx.org.name)) : null
    },
    async setGrants(ctx, nodeId, rows) {
      requireEdit(ctx)
      if (!canManageGrants(ctx)) return { ok: false, code: 'forbidden', error: 'Only an organisation admin changes who has access.' }
      if (!isDashboard(ctx, nodeId)) return { ok: false, code: 'not_found', error: 'Not found' }
      storeGrants(ctx, nodeId, rows)
      return { ok: true, grants: rows }
    },
    async saveVersion(ctx, nodeId, input, author) {
      requireEdit(ctx)
      if (!isDashboard(ctx, nodeId)) return { ok: false, code: 'not_found', error: 'Not found' }
      requireEditable(ctx, mockVersions(ctx, nodeId))
      return saveMockVersion(ctx, nodeId, input, author)
    },
  },
}
