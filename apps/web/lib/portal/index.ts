import type { Portal } from './types'

export type { Portal, PortalIdentity, OrgSummary } from './types'

/**
 * Picks the data-access implementation. Neither the mock nor pg is reachable in
 * production (NODE_ENV is inlined at build time) until the M5 cut-over; neither
 * touches auth. PORTAL_DATA defaults to "mock"; "pg" is development-only for now.
 */
export async function getPortal(): Promise<Portal> {
  const mode = process.env.PORTAL_DATA ?? 'mock'
  if (process.env.NODE_ENV !== 'production') {
    if (mode === 'mock') return (await import('./mock')).mockPortal
    if (mode === 'pg') return (await import('./pg')).pgPortal
  }
  throw new Error(
    process.env.NODE_ENV === 'production'
      ? 'Portal data layer unavailable: mock is never used in production and pg is not enabled there before the M5 cut-over.'
      : `Unsupported PORTAL_DATA="${mode}" (development supports "mock" and "pg").`,
  )
}
