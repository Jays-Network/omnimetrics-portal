import type postgres from 'postgres'
import type { Capability } from '@omnimetrics/types'
import type { Result } from '@/lib/admin/types'
import { writeAudit } from '@/lib/audit'
import { PartialSettingsSchema, SETTING_KEYS, SettingsSchema, resolveSettings, type PartialSettings, type Scope, type SettingKey } from '@/lib/settings/model'
import type { Actor, SettingsView } from '../mock/admin' // types only
import { withOrg, withPlatform, withUser, type Tx } from './context'
import { assertOrgCtx, type OrgCtx } from './org'

// app_settings (008): DISPLAY only (R6). Keys and value shapes are the Zod allowlist of lib/settings.

const forbid: Result<never> = { ok: false, code: 'forbidden', error: 'Not allowed.' }
const NEED: Record<Scope, Capability> = { system: 'settings.system', org: 'settings.org', user: 'settings.view' }

/** Rows -> one layer. A row the allowlist no longer accepts is ignored. */
function layer(rows: { key: string; value: unknown }[]): PartialSettings {
  const out: Record<string, unknown> = {}
  for (const { key, value } of rows) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) continue
    const parsed = SettingsSchema.shape[key as SettingKey].safeParse(value)
    if (parsed.success) out[key] = parsed.data
  }
  return out as PartialSettings
}

export async function get(ctx: OrgCtx): Promise<Result<{ view: SettingsView }>> {
  assertOrgCtx(ctx)
  if (!ctx.capabilities.includes('settings.view')) return forbid
  const rows = await withOrg(ctx, (tx) => tx<{ scope: Scope; key: string; value: unknown }[]>`
    SELECT scope, key, value FROM app_settings
     WHERE scope = 'system'
        OR (scope = 'org' AND org_id = ${ctx.org.id})
        OR (scope = 'user' AND user_id = ${ctx.userId})`)
  const of = (scope: Scope) => layer(rows.filter((r) => r.scope === scope))
  const layers = { system: of('system'), org: of('org'), user: of('user') }
  const can = { system: ctx.capabilities.includes('settings.system'), org: ctx.capabilities.includes('settings.org') }
  return { ok: true, view: { ...layers, effective: resolveSettings(layers), can } }
}

export async function set(ctx: OrgCtx, actor: Actor, scope: Scope, values: PartialSettings, unset: SettingKey[] = []): Promise<Result<{ view: SettingsView }>> {
  assertOrgCtx(ctx)
  if (!(scope in NEED) || !ctx.capabilities.includes(NEED[scope])) return forbid
  // Unknown keys and values are refused before any SQL.
  const parsed = PartialSettingsSchema.safeParse(values)
  if (!parsed.success || unset.some((k) => !SETTING_KEYS.includes(k))) return { ok: false, code: 'invalid', error: 'Unknown setting or value.' }
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  const orgId = scope === 'org' ? ctx.org.id : null
  const userId = scope === 'user' ? ctx.userId : null

  const write = async (tx: Tx) => {
    for (const [key, value] of entries) {
      await tx`
        INSERT INTO app_settings (scope, org_id, user_id, key, value, updated_by)
        VALUES (${scope}, ${orgId}, ${userId}, ${key}, ${tx.json(value as postgres.JSONValue)}, ${ctx.userId})
        ON CONFLICT ON CONSTRAINT app_settings_unique
        DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`
    }
    for (const key of unset) {
      await tx`
        DELETE FROM app_settings
         WHERE scope = ${scope} AND org_id IS NOT DISTINCT FROM ${orgId}::uuid
           AND user_id IS NOT DISTINCT FROM ${userId}::uuid AND key = ${key}`
    }
    if (scope !== 'user') {
      await writeAudit({ ctx, orgId, action: `settings.${scope}`, targetType: 'settings', targetId: scope, detail: { set: parsed.data, unset }, ip: actor.ip }, tx)
    }
  }
  if (scope === 'system') await withPlatform(write, ctx.userId)
  else if (scope === 'org') await withOrg(ctx, write)
  else await withUser(ctx.userId, write)
  return get(ctx)
}
