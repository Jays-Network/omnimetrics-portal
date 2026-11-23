import { z } from 'zod'
import { PORTAL_TIMEZONE } from '@omnimetrics/types'

/**
 * System settings (docs/PLAN_BUILDER.md section E). Pure and client-safe.
 * Resolution order: my preference > organisation default > system default > code constant.
 * DISPLAY ONLY (R6): nothing here changes how rows are counted or bucketed; that stays on PORTAL_TIMEZONE.
 */
export const SETTING_KEYS = ['dateFormat', 'timeFormat', 'timeZone', 'region', 'language', 'numberFormat'] as const
export type SettingKey = (typeof SETTING_KEYS)[number]
export type Scope = 'system' | 'org' | 'user'
export type Source = Scope | 'default'

export const DATE_FORMATS = [
  { id: 'YMD', label: 'Year-month-day (2026-11-23)' },
  { id: 'DMY', label: 'Day/month/year (23/11/2026)' },
  { id: 'MDY', label: 'Month/day/year (11/23/2026)' },
  { id: 'long', label: 'Long (23 Nov 2026)' },
] as const
export const TIME_FORMATS = [{ id: '24', label: '24-hour (14:05)' }, { id: '12', label: '12-hour (2:05 pm)' }] as const
export const REGIONS = {
  za: { label: 'South Africa', locale: 'en-ZA', currency: 'ZAR', weekStart: 1 },
  gb: { label: 'United Kingdom', locale: 'en-GB', currency: 'GBP', weekStart: 1 },
  us: { label: 'United States', locale: 'en-US', currency: 'USD', weekStart: 0 },
  de: { label: 'Germany', locale: 'de-DE', currency: 'EUR', weekStart: 1 },
} as const
export type RegionId = keyof typeof REGIONS
export const NUMBER_FORMATS = [
  { id: 'auto', label: 'From region' },
  { id: 'space-comma', label: '1 234,56' },
  { id: 'comma-dot', label: '1,234.56' },
  { id: 'dot-comma', label: '1.234,56' },
] as const
export const LANGUAGES = [{ id: 'en', label: 'English' }] as const // structure ready; English only for now
export const TIMEZONES = ['Africa/Johannesburg', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Australia/Sydney'] as const

export const SettingsSchema = z.object({
  dateFormat: z.enum(['YMD', 'DMY', 'MDY', 'long']),
  timeFormat: z.enum(['12', '24']),
  timeZone: z.enum(TIMEZONES),
  region: z.enum(['za', 'gb', 'us', 'de']),
  language: z.enum(['en']),
  numberFormat: z.enum(['auto', 'space-comma', 'comma-dot', 'dot-comma']),
}).strict()
export type Settings = z.infer<typeof SettingsSchema>
export const PartialSettingsSchema = SettingsSchema.partial().strict()
export type PartialSettings = z.infer<typeof PartialSettingsSchema>

/** The code constants: what you get when nothing is set anywhere. */
export const DEFAULT_SETTINGS: Settings = {
  dateFormat: 'YMD',
  timeFormat: '24',
  timeZone: PORTAL_TIMEZONE as Settings['timeZone'],
  region: 'za',
  language: 'en',
  numberFormat: 'auto',
}

export interface Resolved { value: Settings; source: Record<SettingKey, Source> }

/** user > org > system > default. A missing key falls through to the next scope. */
export function resolveSettings(layers: { system?: PartialSettings; org?: PartialSettings; user?: PartialSettings }): Resolved {
  const value = { ...DEFAULT_SETTINGS } as Record<SettingKey, unknown>
  const source = {} as Record<SettingKey, Source>
  for (const k of SETTING_KEYS) {
    source[k] = 'default'
    for (const scope of ['system', 'org', 'user'] as const) {
      const v = layers[scope]?.[k]
      if (v !== undefined) { value[k] = v; source[k] = scope }
    }
  }
  return { value: value as Settings, source }
}

export const SCOPE_LABEL: Record<Source, string> = { user: 'My preferences', org: 'Organisation default', system: 'System default', default: 'Built-in default' }
