import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, vi } from 'vitest'
import { driver } from '@/lib/integrations/test-connection'
import { pgPortal } from '@/lib/portal/pg'
import { integrationsContract } from '../contract/integrations-contract'
import { startWorld, type World } from './harness'
import { committedHost } from './hosts-fixture'

// NO NETWORK: the connector is replaced (the managed rows point at jaysnet_data, which tests never touch).

// Not localhost: stored integrations may not point at this machine. The names never resolve; the resolver is replaced.
const FIRST = 'first.itest.invalid'
const SECOND = 'second.itest.invalid'
let world: World | undefined
const removeHosts: (() => Promise<void>)[] = []

beforeAll(async () => {
  removeHosts.push(await committedHost(FIRST), await committedHost(SECOND))
})
afterAll(async () => {
  for (const remove of removeHosts.splice(0)) await remove()
})

integrationsContract(
  'pg',
  async () => {
    vi.stubEnv('INTEGRATION_KEYS', `itest:${randomBytes(32).toString('base64')}`)
    vi.stubEnv('DATABASE_URL_READONLY_WR', 'postgresql://nobody:nothing@localhost:5432/never')
    vi.spyOn(driver, 'connect').mockImplementation(async (t) => {
      if (t.database.includes('fail')) throw Object.assign(new Error('no'), { code: '3D000' })
      return { serverVersion: '18.0' }
    })
    vi.spyOn(driver, 'resolve').mockResolvedValue(['203.0.113.10'])
    ;(globalThis as { __omniIntegrationTests?: Map<string, number[]> }).__omniIntegrationTests?.clear()
    const w = (world = await startWorld())
    return {
      portal: pgPortal,
      director: await w.ctx(w.director),
      orgAdmin: await w.ctx(w.aAdmin),
      builder: await w.ctx(w.aBuilder),
      viewer: await w.ctx(w.aViewer),
      other: await w.ctx(w.bAdmin, w.orgB.slug),
      actor: w.aAdmin,
      directorActor: w.director,
      host: FIRST,
      secondHost: SECOND,
    }
  },
  async () => {
    await world?.close()
    world = undefined
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  },
)
