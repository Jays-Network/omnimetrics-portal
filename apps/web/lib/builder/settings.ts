import { z } from 'zod'
import { PORTAL_TIMEZONE } from '@omnimetrics/types'
import { fieldById } from './fields'

// Dashboard settings: part of the dashboard spec (so they are validated, undoable and versioned with it).
// Everything here is PRESENTATION or behaviour of the viewer. None of it changes how data is bucketed or
// counted: day/week/month bucketing, the 60-day window and billing periods stay on PORTAL_TIMEZONE and
// the dataset's own rules (R6, docs/PLAN_BUILDER.md section E).

export const SETTINGS_V = 1
export const MIN_REFRESH_S = 30
export const MAX_NOW_DELAY_S = 3600

/** "30s", "5m", "2h", "1d" -> seconds, or null when it is not a duration. */
export function parseDuration(s: string): number | null {
  const m = /^(\d{1,5})(s|m|h|d)$/.exec(s.trim())
  if (!m) return null
  return Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's']
}
export const isRefreshOk = (s: string): boolean => { const n = parseDuration(s); return n !== null && n >= MIN_REFRESH_S }
/** Never refresh faster than the minimum, whatever the saved value says. */
export const effectiveRefreshSeconds = (s: string | undefined): number | null => {
  const n = s && s !== 'off' ? parseDuration(s) : null
  return n === null ? null : Math.max(MIN_REFRESH_S, n)
}

const duration = z.string().max(8).refine((s) => parseDuration(s) !== null, 'Use a duration like 30s, 5m, 2h or 1d')
const refreshDuration = duration.refine(isRefreshOk, `The shortest refresh interval is ${MIN_REFRESH_S}s`)

/** Same rule as links in text panels: http(s), mailto, or a same-site path. Never javascript: or data:. */
export const isSafeUrl = (u: string): boolean => /^(https?:\/\/[^\s]+|mailto:[^\s]+|\/(?!\/)[^\s]*)$/i.test(u)

const name = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'Use lowercase letters, digits and underscores, starting with a letter (max 32)')

export const VariableSchema = z
  .object({
    name,
    label: z.string().max(60).default(''),
    type: z.enum(['dropdown', 'custom', 'interval', 'text', 'constant']),
    /** dropdown: a text field of the dataset allowlist (the options are read from the dataset on the server in M5). */
    field: z.string().max(64).optional(),
    /** custom: the list. interval: the allowed durations. constant: the single value. */
    values: z.array(z.string().max(80)).max(100).default([]),
    multi: z.boolean().default(false),
    includeAll: z.boolean().default(false),
    default: z.union([z.string().max(80), z.array(z.string().max(80)).max(100)]).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    if (v.type === 'dropdown') {
      const f = v.field ? fieldById(v.field) : undefined
      if (!f) bad('field', 'Pick a dataset field')
      else if (f.type !== 'text') bad('field', 'A dropdown reads the values of a text field')
    }
    if (v.type === 'custom' && v.values.length === 0) bad('values', 'Add at least one value')
    if (v.type === 'interval' && (v.values.length === 0 || v.values.some((x) => parseDuration(x) === null))) bad('values', 'List durations like 1m, 5m, 1h')
    if (v.type === 'constant' && v.values.length !== 1) bad('values', 'A constant has exactly one value')
    if ((v.type === 'text' || v.type === 'constant' || v.type === 'interval') && (v.multi || v.includeAll)) bad('multi', 'Only dropdown and custom variables take several values or "All"')
    if (Array.isArray(v.default) && !v.multi) bad('default', 'Several default values need "multi-value"')
  })
export type Variable = z.infer<typeof VariableSchema>

export const LinkSchema = z
  .object({
    label: z.string().min(1).max(60),
    kind: z.enum(['dashboard', 'url']),
    /** dashboard: a dashboard id of THIS organisation. url: an http(s) or same-site address. */
    target: z.string().min(1).max(500),
    newTab: z.boolean().default(false),
  })
  .strict()
  .superRefine((l, ctx) => {
    if (l.kind === 'url' && !isSafeUrl(l.target)) ctx.addIssue({ code: 'custom', path: ['target'], message: 'Use an http(s) address, a mailto: address or a path starting with /' })
  })
export type DashLink = z.infer<typeof LinkSchema>

export const DEFAULT_REFRESH_LIST = ['30s', '1m', '5m', '15m', '30m', '1h', '2h', '1d']

export const DashSettingsSchema = z
  .object({
    v: z.literal(SETTINGS_V).default(SETTINGS_V),
    general: z.object({
      description: z.string().max(500).default(''),
      tags: z.array(z.string().min(1).max(32)).max(20).default([]),
      /** Read-only hides Edit from builders. Org admins and the director can still change it. */
      editable: z.boolean().default(true),
    }).strict().default({}),
    time: z.object({
      /** 'default' = the organisation setting, else the system setting (PORTAL_TIMEZONE). DISPLAY ONLY. */
      timezone: z.string().max(64).default('default'),
      /** Display and date-picker presets ONLY: never changes how weeks are bucketed in data. */
      weekStart: z.enum(['default', 'monday', 'sunday', 'saturday']).default('default'),
      refreshIntervals: z.array(refreshDuration).min(1).max(20).default(DEFAULT_REFRESH_LIST),
      /** The interval picked when the dashboard opens, or 'off'. */
      autoRefresh: z.union([z.literal('off'), refreshDuration]).default('off'),
      /** Display delay for "now" so the newest, still-arriving points are not shown. Not a data rule. */
      nowDelay: z.union([z.literal(''), duration.refine((s) => (parseDuration(s) ?? 0) <= MAX_NOW_DELAY_S, 'At most 1h')]).default(''),
      hideTimePicker: z.boolean().default(false),
      refreshLive: z.boolean().default(false),
    }).strict().default({}),
    panelOptions: z.object({
      tooltip: z.enum(['default', 'sharedCrosshair', 'sharedTooltip']).default('default'),
      /** Mount a panel only when it nears the viewport (replaces Grafana's "preload panels"). */
      lazyLoad: z.boolean().default(true),
    }).strict().default({}),
    variables: z.array(VariableSchema).max(30).default([]),
    links: z.array(LinkSchema).max(20).default([]),
  })
  .strict()
  .superRefine((s, ctx) => {
    const seen = new Set<string>()
    s.variables.forEach((v, i) => {
      if (seen.has(v.name)) ctx.addIssue({ code: 'custom', path: ['variables', i, 'name'], message: `Another variable is already called "${v.name}"` })
      seen.add(v.name)
    })
    if (s.time.autoRefresh !== 'off' && !s.time.refreshIntervals.includes(s.time.autoRefresh)) ctx.addIssue({ code: 'custom', path: ['time', 'autoRefresh'], message: 'The default refresh must be one of the interval list' })
  })
export type DashSettings = z.infer<typeof DashSettingsSchema>

export const defaultSettings = (): DashSettings => DashSettingsSchema.parse({})

/* ------------------------------------------------------------------ pure helpers */

/** Which zone dates are DISPLAYED in: dashboard > organisation > system. Never used for bucketing. */
export function resolveTimezone(setting: string, orgTz?: string | null, systemTz: string = PORTAL_TIMEZONE): string {
  const pick = setting !== 'default' ? setting : orgTz || systemTz
  try {
    new Intl.DateTimeFormat('en-ZA', { timeZone: pick })
    return pick
  } catch {
    return systemTz
  }
}
export const isValidTimezone = (tz: string): boolean => { try { new Intl.DateTimeFormat('en-ZA', { timeZone: tz }); return true } catch { return false } }

export const WEEK_START_LABEL = { default: 'Default (Monday)', monday: 'Monday', sunday: 'Sunday', saturday: 'Saturday' } as const

export type VarValue = string | string[]
/** Current value of a variable: what the user picked, else its default, else (All / first value). `null` = no restriction ("All"). */
export function resolveVariable(v: Variable, picked: Record<string, VarValue>): VarValue | null {
  if (v.type === 'constant') return v.values[0] ?? ''
  const cur = picked[`$${v.name}`] ?? v.default
  if (cur === undefined || cur === 'All' || (Array.isArray(cur) && cur.length === 0)) return v.includeAll ? null : v.type === 'custom' ? (v.values[0] ?? null) : null
  return cur
}

/** `$name` references in a panel's filter values -> the variable's current value (mock data reacts to it). */
export function variableFilters(filters: readonly { field: string; value: unknown }[], vars: readonly Variable[], picked: Record<string, VarValue>): Record<string, VarValue> {
  const out: Record<string, VarValue> = {}
  for (const f of filters) {
    if (typeof f.value !== 'string' || !/^\$[a-z][a-z0-9_]*$/.test(f.value)) continue
    const v = vars.find((x) => `$${x.name}` === f.value)
    if (!v) continue
    const r = resolveVariable(v, picked)
    if (r !== null) out[f.field] = r
  }
  return out
}

/** Edit rule: builders lose Edit when the dashboard is read-only; org admins and the director keep it. */
export function canEditDashboard(a: { role: string; isPlatform: boolean; capabilities: readonly string[] }, settings: Pick<DashSettings, 'general'>): boolean {
  if (!a.capabilities.includes('dashboards.edit')) return false
  if (a.isPlatform || a.role === 'admin') return true
  return settings.general.editable
}

/** Pause rule for auto refresh: a hidden tab never refreshes. */
export const shouldRefresh = (visibility: string): boolean => visibility !== 'hidden'
