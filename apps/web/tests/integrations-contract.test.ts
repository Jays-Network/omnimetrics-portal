import { capabilitiesFor, type OrgAccess, type Role } from '@omnimetrics/types'
import { mockPortal } from '@/lib/portal/mock'
import { resetMockAdmin } from '@/lib/portal/mock/admin-store'
import { integrationsContract } from './contract/integrations-contract'

const org = (slug: string, role: Role, isPlatform = false): OrgAccess => ({ org: { id: `mock-org-${slug}`, slug, name: slug, status: 'active' }, role, isPlatform, capabilities: capabilitiesFor(role, isPlatform) })

integrationsContract(
  'mock',
  async () => {
    resetMockAdmin()
    return {
      portal: mockPortal,
      director: org('worldrisk', 'admin', true),
      orgAdmin: org('worldrisk', 'admin'),
      builder: org('worldrisk', 'builder'),
      viewer: org('worldrisk', 'viewer'),
      other: org('adars', 'admin'),
      actor: { id: 'c-admin', username: 'contract.admin' },
      directorActor: { id: 'u-director', username: 'director' },
      host: 'db.mock-wr.internal', // not localhost: stored integrations may not point at this machine
      secondHost: 'warehouse.mock-adars.internal', // no seeded integration uses it
    }
  },
  async () => {},
)
