import { capabilitiesFor, type OrgAccess, type Role } from '@omnimetrics/types'
import { mockPortal } from '@/lib/portal/mock'
import { db, resetMockAdmin } from '@/lib/portal/mock/admin-store'
import { resetMockContent } from '@/lib/portal/mock/content'
import { resetMockGrants } from '@/lib/portal/mock/grants'
import { resetMockVersions } from '@/lib/portal/mock/versions'
import { adminContract } from './contract/admin-contract'
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

adminContract(
  'mock',
  async () => {
    resetMockAdmin()
    const person = (key: string, slug?: 'worldrisk' | 'adars', role: Role = 'viewer') => {
      const p = { id: `c-${key}`, username: `contract.${key}` }
      db().users.push({ ...p, email: `${key}@contract.invalid`, isPlatform: false })
      if (slug) db().members.push({ userId: p.id, orgId: `mock-org-${slug}`, role, active: true, folders: role === 'admin' ? null : [], grants: '' })
      return p
    }
    const people = {
      director: { id: 'u-director', username: 'director' },
      orgAdmin: person('admin', 'worldrisk', 'admin'),
      builder: person('builder', 'worldrisk', 'builder'),
      viewer: person('viewer', 'worldrisk', 'viewer'),
      other: person('other', 'adars', 'admin'),
    }
    const linkable = person('linkable')
    return {
      portal: mockPortal,
      director: org('worldrisk', 'admin', true),
      directorB: org('adars', 'admin', true),
      orgAdmin: org('worldrisk', 'admin'),
      builder: org('worldrisk', 'builder'),
      viewer: org('worldrisk', 'viewer'),
      other: org('adars', 'admin'),
      people,
      linkable,
      joinA: async (who) => {
        db().members.push({ userId: who.id, orgId: 'mock-org-worldrisk', role: 'viewer', active: true, folders: [], grants: '' })
      },
      tag: 'mock',
      audit: async () => db().audit.map((e) => ({ action: e.action, orgId: e.orgId, userId: Object.values(people).find((p) => p.username === e.actor)?.id ?? null, detail: e.detail })),
    }
  },
  async () => {},
)
