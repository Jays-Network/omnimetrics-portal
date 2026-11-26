import type postgres from 'postgres'
import { getAppDb } from '@/lib/db'

export type Tx = postgres.TransactionSql

export const isUuid = (v: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/**
 * One portal_app transaction with the RLS settings as its FIRST statement. set_config(..., true) is
 * transaction-local, so nothing survives into the next request on a pooled connection.
 * Internal: use withOrg / withUser from ./context.
 */
export async function inAppTx<T>(orgId: string, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await getAppDb().begin(async (tx) => {
    await tx`SELECT set_config('app.org_id', ${orgId}, true), set_config('app.user_id', ${userId}, true)`
    return fn(tx)
  })) as T
}

/** User context only (no organisation): the user reads their own memberships (self_read). */
export const withUser = <T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> => inAppTx('', userId, fn)
