/**
 * WorldRisk Tracking Sheets: shared filter types and constants.
 * Rulings: docs/CONTEXT.md R1 (test sheets) and the scoping rule (raw folder_name).
 */

/** R1: this folder is excluded from every query, dropdown and count, for every role. Compared trimmed and case-insensitively. */
export const EXCLUDED_FOLDERS = ['test sheets'] as const

/** Selectable countries (the Grafana `$country` list, minus the 'All' sentinel). 'Other' is not selectable. */
export const COUNTRIES = [
  'DRC',
  'Zambia',
  'Tanzania',
  'Namibia',
  'Zimbabwe',
  'Botswana',
  'Mozambique',
  'South Africa',
] as const
export type Country = (typeof COUNTRIES)[number]

/** Sentinel accepted in `projects` and `countries` meaning "everything I am allowed to see". */
export const ALL_SENTINEL = 'All'

/** Day boundaries and the date picker use this zone (Jay, 2026-11-20). */
export const PORTAL_TIMEZONE = 'Africa/Johannesburg'

/** Grafana's default dashboard range is now-6h. */
export const DEFAULT_RANGE_HOURS = 6

/** Largest accepted from..to span. */
export const MAX_RANGE_DAYS = 3660

/** Parsed request filters (what the browser may send). */
export interface Filters {
  /** Raw `folder_name` values, or ['All'], or omitted = all allowed. Never mapped labels. */
  projects?: string[]
  /** Countries, or ['All'], or omitted = all. */
  countries?: string[]
  /** ISO instants. Defaults: to = now, from = to - 6h. */
  from?: string
  to?: string
  /** Heatmap only (deferred). Four-digit years. */
  years?: string[]
}

/** Filters after scoping. Safe to bind as SQL parameters. */
export interface ResolvedFilters {
  /** Raw folder_name values, never empty, never an excluded folder. Bind as `folder_name = ANY($n)`. */
  folders: string[]
  /** null = All countries (no country predicate). */
  countries: Country[] | null
  /** ISO instants (UTC). */
  from: string
  to: string
  /** null = all years. */
  years: string[] | null
}
