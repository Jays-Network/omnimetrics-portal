import type { GrantRow, OrgAccess } from '@omnimetrics/types'
import { z } from 'zod'

// MOCK grants store (M3.3): in memory, per organisation AND dashboard. Real grants arrive in M5 with the
// database; until then edits live only in this process and vanish on restart.
export const GrantRowSchema = z.object({
  principal: z.string().trim().min(1).max(128), // pg role rows carry the organisation name (up to 120)
  kind: z.enum(['role', 'user', 'group']),
  access: z.enum(['view', 'edit', 'manage']),
  via: z.string().max(60).default('Direct grant'),
}).strict()
export const GrantsSchema = z.array(GrantRowSchema).max(100)

const g = globalThis as unknown as { __omniMockGrants?: Map<string, GrantRow[]> }
const store = () => (g.__omniMockGrants ??= new Map())
const key = (c: Pick<OrgAccess, 'org'>, nodeId: string) => `${c.org.id}:${nodeId}`

export const storedGrants = (c: Pick<OrgAccess, 'org'>, nodeId: string): GrantRow[] | undefined => store().get(key(c, nodeId))
export const storeGrants = (c: Pick<OrgAccess, 'org'>, nodeId: string, rows: GrantRow[]) => void store().set(key(c, nodeId), rows)
export const resetMockGrants = () => { g.__omniMockGrants = new Map() }

/** Only org admins and the director change grants. */
export const canManageGrants = (a: Pick<OrgAccess, 'role' | 'isPlatform'>) => a.isPlatform || a.role === 'admin'
