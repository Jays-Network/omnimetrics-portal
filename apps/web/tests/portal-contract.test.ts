import { capabilitiesFor, type OrgAccess, type Role } from '@omnimetrics/types'
import { mockPortal } from '@/lib/portal/mock'
import { resetMockContent } from '@/lib/portal/mock/content'
import { resetMockGrants } from '@/lib/portal/mock/grants'
import { resetMockVersions } from '@/lib/portal/mock/versions'
import { portalContract } from './contract/portal-contract'

const org = (slug: string, role: Role, isPlatform = false): OrgAccess => ({
  org: { id: `mock-org-${slug}`, slug, name: slug, status: 'active' },
  role,
  isPlatform,
  capabilities: capabilitiesFor(role, isPlatform),
})

portalContract(
  'mock',
  async () => {
    resetMockContent()
    resetMockVersions()
    resetMockGrants()
    return {
      portal: mockPortal,
      director: org('worldrisk', 'admin', true),
      orgAdmin: org('worldrisk', 'admin'),
      builder: org('worldrisk', 'builder'),
      viewer: org('worldrisk', 'viewer'),
      other: org('adars', 'admin'),
      analyst: 'mock.analyst9',
      grantBaseline: async () => {}, // the mock's access IS the role baseline
    }
  },
  async () => {},
)
