import { z } from 'zod'
import type { Role } from '@omnimetrics/types'

// Shapes shared by the mock portal, the routes and the screens. Client-safe: nothing here holds a secret.

export const INTEGRATION_KINDS = [
  { id: 'postgres', label: 'Postgres', available: true },
  { id: 'mysql', label: 'MySQL', available: false, note: 'Later' },
  { id: 'sqlite', label: 'SQLite', available: false, note: 'Deferred', reason: 'SQLite means filesystem access (paths, ATTACH, extensions), so it waits until uploads can be sandboxed.' },
] as const
export const SSL_MODES = ['require', 'verify-full', 'disable'] as const

export interface IntegrationRow {
  id: string
  name: string
  kind: 'postgres'
  host: string
  port: number
  database: string
  /** Schemas or relations the datasets may read; empty means none yet. */
  relations: string[]
  sslMode: (typeof SSL_MODES)[number]
  status: 'ok' | 'failed' | 'untested' | 'managed'
  managed: boolean
  /** Write-only credentials: only these three facts ever leave the server. */
  hasCredentials: boolean
  keyId: string | null
  rotatedAt: string | null
  lastTest: { ok: boolean; at: string; message: string } | null
  /** Dashboards using this connection (mock number until datasets exist in M5). */
  usedBy: number
}

export interface AllowedHost { id: string; host: string; portMin: number; portMax: number }

export const IntegrationInputSchema = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(1).max(60),
  kind: z.literal('postgres'),
  host: z.string().trim().min(1).max(120), // must equal an allowlisted host; never trusted as free text
  port: z.number().int().min(1).max(65535),
  database: z.string().trim().min(1).max(63).regex(/^[A-Za-z0-9_\-]+$/, 'Letters, digits, _ and - only'),
  relations: z.array(z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.]+$/, 'Letters, digits, _ and . only')).max(50),
  sslMode: z.enum(SSL_MODES),
  /** Empty or absent on edit = keep the stored credentials. Never echoed back. */
  credentials: z.string().max(500).optional(),
}).strict()
export type IntegrationInput = z.infer<typeof IntegrationInputSchema>

export const HostInputSchema = z.object({
  host: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9.\-]+$/, 'Host name characters only'),
  portMin: z.number().int().min(1).max(65535),
  portMax: z.number().int().min(1).max(65535),
}).strict().refine((h) => h.portMin <= h.portMax, 'Port range is backwards')
export type HostInput = z.infer<typeof HostInputSchema>

export interface AuditEntry { id: string; at: string; orgId: string | null; actor: string; action: string; targetType: string; targetId: string; detail: string }

// ---- Admin
export interface OrgProfile { id: string; slug: string; name: string; status: 'active' | 'suspended' | 'archived'; memberCount: number; integrationCount: number; dashboardCount: number }
export interface MemberRow {
  userId: string
  username: string
  email: string
  /** Role in THIS organisation only. */
  role: Role
  active: boolean
  /** Platform admin: nobody can edit or deactivate them. */
  isPlatform: boolean
  grantsSummary: string
  /** Tracking folders in scope for this org; null = unrestricted (org admin and director). */
  trackingFolders: string[] | null
}
export interface Membership { orgSlug: string; orgName: string; role: Role; active: boolean; folders: string[] | null }
export interface SessionRow { id: string; userId: string; device: string; ip: string; startedAt: string; lastSeenAt: string; current: boolean }

export const AddUserSchema = z.object({
  op: z.literal('add'),
  username: z.string().trim().min(3).max(40).regex(/^[a-z0-9._-]+$/, 'Lower-case letters, digits . _ -'),
  email: z.string().trim().email().max(120),
  role: z.enum(['admin', 'builder', 'viewer']),
}).strict()
/** Director only: an existing login joins this organisation. */
export const LinkUserSchema = z.object({
  op: z.literal('link'),
  username: z.string().trim().min(1).max(100),
  role: z.enum(['admin', 'builder', 'viewer']),
}).strict()
export const UserPatchSchema = z.object({
  op: z.literal('update'),
  userId: z.string().max(40),
  role: z.enum(['admin', 'builder', 'viewer']).optional(),
  active: z.boolean().optional(),
  trackingFolders: z.array(z.string().max(80)).max(50).optional(),
}).strict()

export type Result<T = object> = ({ ok: true } & T) | { ok: false; code: 'forbidden' | 'not_found' | 'invalid' | 'rate_limited'; error: string }
