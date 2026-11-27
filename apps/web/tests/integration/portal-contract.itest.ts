import { randomUUID } from 'node:crypto'
import { pgPortal } from '@/lib/portal/pg'
import type { Tx } from '@/lib/portal/pg/tx'
import { adminContract } from '../contract/admin-contract'
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

adminContract(
  'pg',
  async () => {
    const w = (world = await startWorld())
    return {
      portal: pgPortal,
      director: await w.ctx(w.director),
      directorB: await w.ctx(w.director, w.orgB.slug),
      orgAdmin: await w.ctx(w.aAdmin),
      builder: await w.ctx(w.aBuilder),
      viewer: await w.ctx(w.aViewer),
      other: await w.ctx(w.bAdmin, w.orgB.slug),
      people: { director: w.director, orgAdmin: w.aAdmin, builder: w.aBuilder, viewer: w.aViewer, other: w.bAdmin },
      get linkable() {
        return w.linkable
      },
      // Seeded over the app connection, which the member functions read.
      joinA: (who) =>
        w.asOrg(w.orgA.id, async (tx) => {
          await tx`INSERT INTO app_memberships (org_id, user_id, role) VALUES (${w.orgA.id}, ${who.id}, 'viewer')`
        }),
      tag: randomUUID().slice(0, 8),
      // The app connection sees its own organisation's rows, the platform connection its own writes. Rows with
      // org_id NULL written by the app path are readable by neither before commit (010).
      audit: async () => {
        const read = (tx: Tx) => tx<{ id: string; action: string; orgId: string | null; userId: string | null; detail: string }[]>`
          SELECT id::text AS id, action, org_id AS "orgId", user_id AS "userId", coalesce(detail::text, '') AS detail
            FROM app_audit_log ORDER BY app_audit_log.id`
        const rows = [...(await w.asOrg(w.orgA.id, read)), ...(await w.asOrg(w.orgB.id, read)), ...(await w.asPlatform(read))]
        return [...new Map(rows.map((r) => [r.id, r])).values()]
      },
    }
  },
  async () => {
    await world?.close()
    world = undefined
  },
)
