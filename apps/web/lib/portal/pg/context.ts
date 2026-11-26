import { getPlatformDb } from '@/lib/db'
import { assertOrgCtx, type OrgCtx } from './org'
import { inAppTx, type Tx } from './tx'

export { withUser, type Tx } from './tx'

/** Tenant path: RLS admits exactly ctx's organisation. Refuses a ctx that requireOrg() did not issue. */
export async function withOrg<T>(ctx: OrgCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertOrgCtx(ctx)
  return inAppTx(ctx.org.id, ctx.userId, fn)
}

/**
 * Director path: the portal_platform LOGIN is the switch (010), so there is no org setting.
 * Callers must already have established that the actor holds `orgs.manage`.
 */
export async function withPlatform<T>(fn: (tx: Tx) => Promise<T>, userId?: string): Promise<T> {
  return (await getPlatformDb().begin(async (tx) => {
    if (userId) await tx`SELECT set_config('app.user_id', ${userId}, true)`
    return fn(tx)
  })) as T
}
