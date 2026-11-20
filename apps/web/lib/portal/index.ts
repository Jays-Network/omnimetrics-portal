import type { Portal } from './types'

export type { Portal, PortalIdentity, OrgSummary } from './types'

/**
 * Picks the data-access implementation. Mock exists ONLY in development
 * (NODE_ENV is inlined at build time, so the mock chunk is dropped from
 * production builds) and never touches auth. The pg implementation arrives in
 * M5; until then production has no portal data layer and fails closed.
 */
export async function getPortal(): Promise<Portal> {
  const mode = process.env.PORTAL_DATA ?? 'mock'
  if (process.env.NODE_ENV !== 'production' && mode === 'mock') {
    return (await import('./mock')).mockPortal
  }
  throw new Error(
    process.env.NODE_ENV === 'production'
      ? 'Portal data layer unavailable: mock is never used in production and the pg implementation arrives in M5.'
      : `Unsupported PORTAL_DATA="${mode}" (development supports "mock").`,
  )
}
