import { afterEach, describe, expect, it, vi } from 'vitest'
import { capabilitiesFor } from '@omnimetrics/types'
import { getPortal } from '@/lib/portal'
import { mockPortal } from '@/lib/portal/mock'
import { activeTabKey, switchOrgHref } from '@/components/shell/nav'

afterEach(() => vi.unstubAllEnvs())

describe('capabilitiesFor', () => {
  it('gives the SQL terminal and org management to the director only', () => {
    expect(capabilitiesFor('admin', true)).toEqual(expect.arrayContaining(['terminal.run', 'orgs.manage']))
    for (const role of ['admin', 'builder', 'viewer'] as const) {
      const caps = capabilitiesFor(role, false)
      expect(caps).not.toContain('terminal.run')
      expect(caps).not.toContain('orgs.manage')
    }
  })
  it('keeps builders and viewers out of integrations and admin', () => {
    for (const role of ['builder', 'viewer'] as const) {
      const caps = capabilitiesFor(role, false)
      expect(caps).not.toContain('integrations.manage')
      expect(caps).not.toContain('admin.view')
    }
    expect(capabilitiesFor('builder', false)).toContain('dashboards.edit')
    expect(capabilitiesFor('viewer', false)).not.toContain('dashboards.edit')
  })
})

describe('getPortal', () => {
  it('serves the mock in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect((await getPortal()).mode).toBe('mock')
  })
  it('refuses mock in production (fail closed)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(getPortal()).rejects.toThrow(/never used in production/)
  })
  it('rejects unknown PORTAL_DATA values', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PORTAL_DATA', 'pg')
    await expect(getPortal()).rejects.toThrow(/Unsupported/)
  })
})

describe('mock memberships follow the real session role', () => {
  it('admin is the director in every organisation', async () => {
    const a = await mockPortal.orgs.listAccessible({ id: 'u1', username: 'jay', role: 'admin' })
    expect(a.map((x) => x.org.slug)).toEqual(['worldrisk', 'adars'])
    expect(a.every((x) => x.isPlatform)).toBe(true)
  })
  it('a viewer sees only WorldRisk, with no director powers', async () => {
    const a = await mockPortal.orgs.listAccessible({ id: 'u2', username: 'v', role: 'viewer' })
    expect(a).toHaveLength(1)
    expect(a[0]!.org.slug).toBe('worldrisk')
    expect(a[0]!.isPlatform).toBe(false)
    expect(a[0]!.capabilities).not.toContain('terminal.run')
  })
})

describe('nav helpers', () => {
  it('maps paths to tabs, platform pages to Admin, account to none', () => {
    expect(activeTabKey('/dashboard/o/adars/dashboards/x')).toBe('dashboards')
    expect(activeTabKey('/dashboard/o/adars/admin/users')).toBe('admin')
    expect(activeTabKey('/dashboard/platform/organisations')).toBe('admin')
    expect(activeTabKey('/dashboard/account')).toBeNull()
  })
  it('switches organisation keeping the section', () => {
    expect(switchOrgHref('/dashboard/o/worldrisk/settings', 'worldrisk', 'adars')).toBe('/dashboard/o/adars/settings')
    expect(switchOrgHref('/dashboard/account', 'worldrisk', 'adars')).toBe('/dashboard/o/adars/dashboards')
  })
})
