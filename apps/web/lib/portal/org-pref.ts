import type { OrgAccess } from '@omnimetrics/types'

/** UI preference only: remembers the last organisation. It is NEVER used for authorization. */
export const LAST_ORG_COOKIE = 'omni_last_org'

/** The remembered organisation if the user can still enter it, otherwise the first accessible one. */
export function pickDefaultOrg(accessible: OrgAccess[], remembered: string | null | undefined): OrgAccess | undefined {
  return accessible.find((a) => a.org.slug === remembered) ?? accessible[0]
}
