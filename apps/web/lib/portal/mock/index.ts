import { capabilitiesFor, type OrgAccess } from '@omnimetrics/types'
import type { Portal, PortalIdentity, OrgSummary } from '../types'

// MOCK DATA: development only (see ../index.ts). Obviously fake, deterministic.
const ORGS: OrgSummary[] = [
  { id: 'mock-org-worldrisk', slug: 'worldrisk', name: 'WorldRisk', status: 'active', memberCount: 6, integrationCount: 1, dashboardCount: 8 },
  { id: 'mock-org-adars', slug: 'adars', name: 'ADARS', status: 'active', memberCount: 4, integrationCount: 1, dashboardCount: 3 },
]

/**
 * Mock memberships are keyed to the REAL signed-in user (auth is never
 * bypassed): the existing admin acts as the director in both organisations;
 * any other user gets WorldRisk with their real role. Unknown = no access.
 */
function accessFor(who: PortalIdentity): OrgAccess[] {
  if (who.role === 'admin') {
    return ORGS.map((o) => ({
      org: { id: o.id, slug: o.slug, name: o.name, status: o.status },
      role: 'admin',
      isPlatform: true,
      capabilities: capabilitiesFor('admin', true),
    }))
  }
  const wr = ORGS[0]!
  return [
    {
      org: { id: wr.id, slug: wr.slug, name: wr.name, status: wr.status },
      role: who.role,
      isPlatform: false,
      capabilities: capabilitiesFor(who.role, false),
    },
  ]
}

export const mockPortal: Portal = {
  mode: 'mock',
  orgs: {
    async listAccessible(who) {
      return accessFor(who)
    },
    async listAll() {
      return ORGS.map((o) => ({ ...o }))
    },
  },
}
