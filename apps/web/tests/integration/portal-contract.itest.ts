import { pgPortal } from '@/lib/portal/pg'
import { portalContract } from '../contract/portal-contract'
import { startWorld, type World } from './harness'

let world: World | undefined

portalContract(
  'pg',
  async () => {
    const w = (world = await startWorld())
    return {
      portal: pgPortal,
      director: await w.ctx(w.director),
      orgAdmin: await w.ctx(w.aAdmin),
      builder: await w.ctx(w.aBuilder),
      viewer: await w.ctx(w.aViewer),
      other: await w.ctx(w.bAdmin, w.orgB.slug),
      analyst: w.aViewer.username,
      grantBaseline: async () => {
        await w.grant(w.orgA.id, w.aBuilder.id, null, 'edit')
        await w.grant(w.orgA.id, w.aViewer.id, null, 'view')
      },
    }
  },
  async () => {
    await world?.close()
    world = undefined
  },
)
