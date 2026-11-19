import { z } from 'zod'
import {
  ALL_SENTINEL,
  COUNTRIES,
  DEFAULT_RANGE_HOURS,
  EXCLUDED_FOLDERS,
  MAX_RANGE_DAYS,
  type Country,
  type Filters,
  type ResolvedFilters,
  type User,
} from '@omnimetrics/types'

/**
 * Filter parsing and scoping for the WorldRisk Tracking Sheets dashboard.
 *
 * Rules (docs/CONTEXT.md):
 *  - R1: the folder `test sheets` is removed everywhere, for every role.
 *  - Scoping uses the RAW folder_name. Mapped project labels are display only and are
 *    never accepted here; an unknown value is an error, not a silent empty result.
 *  - "All" never means "no filter": it expands to an explicit folder list.
 *  - Nothing here touches the database. The folder universe is injected by the caller.
 */

export class FilterError extends Error {
  constructor(
    public readonly status: 400 | 403,
    public readonly code:
      | 'INVALID_FILTERS'
      | 'UNKNOWN_FOLDER'
      | 'FORBIDDEN_FOLDER'
      | 'NO_ACCESS'
      | 'EMPTY_SCOPE'
      | 'INVALID_RANGE',
    message: string,
  ) {
    super(message)
    this.name = 'FilterError'
  }
}

const MAX_LIST = 500
const folderName = z.string().trim().min(1).max(200)

export const FiltersSchema = z
  .object({
    projects: z.array(folderName).max(MAX_LIST).optional(),
    countries: z
      .array(z.enum([ALL_SENTINEL, ...COUNTRIES] as [string, ...string[]]))
      .max(COUNTRIES.length + 1)
      .optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    years: z.array(z.string().regex(/^\d{4}$/)).max(50).optional(),
  })
  .strict()

/** Build filter input from URL search params. Repeated keys (`projects=a&projects=b`), so commas in folder names are safe. */
export function filtersFromSearchParams(params: URLSearchParams): unknown {
  const list = (key: string) => {
    const values = params.getAll(key)
    return values.length ? values : undefined
  }
  const out: Record<string, unknown> = {}
  for (const key of ['projects', 'countries', 'years']) {
    const v = list(key)
    if (v) out[key] = v
  }
  for (const key of ['from', 'to']) {
    const v = params.get(key)
    if (v) out[key] = v
  }
  return out
}

export function isExcludedFolder(name: string): boolean {
  const n = name.trim().toLowerCase()
  return EXCLUDED_FOLDERS.some((f) => f === n)
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/**
 * Validate and scope request filters for a user.
 *
 * @param user      role + allowed_projects (null only for admin).
 * @param input     untrusted filters (parsed with FiltersSchema here).
 * @param universe  raw folder_name values the dropdown offers (caller supplies; Step 3 loads it).
 * @param now       injectable clock for the default range.
 */
export function resolveFilters(
  user: Pick<User, 'role' | 'allowed_projects'>,
  input: unknown,
  universe: readonly string[],
  now: Date = new Date(),
): ResolvedFilters {
  const parsed = FiltersSchema.safeParse(input ?? {})
  if (!parsed.success) {
    throw new FilterError(400, 'INVALID_FILTERS', 'Invalid filters')
  }
  const f: Filters = parsed.data

  // ---- folders -----------------------------------------------------------
  const isAdmin = user.role === 'admin' && user.allowed_projects === null
  let allowed: string[]
  if (isAdmin) {
    allowed = dedupe(universe).filter((n) => !isExcludedFolder(n))
  } else {
    // Fail closed: non-admin without a list, or an admin-shaped user without role, sees nothing.
    // A grant is not narrowed by the dropdown universe, only by R1.
    allowed = dedupe(user.allowed_projects ?? []).filter((n) => !isExcludedFolder(n))
    if (user.role === 'admin' || allowed.length === 0) {
      throw new FilterError(403, 'NO_ACCESS', 'No projects available')
    }
  }

  const requested = f.projects
  const wantsAll = !f.projects || f.projects.length === 0 || f.projects.includes(ALL_SENTINEL)

  let folders: string[]
  if (wantsAll) {
    folders = allowed
  } else {
    const wanted = dedupe(requested ?? []).filter((n) => !isExcludedFolder(n)) // R1
    if (wanted.length === 0) {
      throw new FilterError(400, 'EMPTY_SCOPE', 'No selectable projects in the request')
    }
    const allowedSet = new Set(allowed)
    const bad = wanted.filter((n) => !allowedSet.has(n))
    if (bad.length > 0) {
      // Do not echo the values back.
      throw isAdmin
        ? new FilterError(400, 'UNKNOWN_FOLDER', 'Unknown project')
        : new FilterError(403, 'FORBIDDEN_FOLDER', 'Project not permitted')
    }
    folders = wanted
  }
  if (folders.length === 0) {
    throw new FilterError(400, 'EMPTY_SCOPE', 'No projects available')
  }

  // ---- countries ---------------------------------------------------------
  let countries: Country[] | null = null
  if (f.countries && f.countries.length > 0 && !f.countries.includes(ALL_SENTINEL)) {
    countries = dedupe(f.countries) as Country[]
  }

  // ---- range -------------------------------------------------------------
  const hours = DEFAULT_RANGE_HOURS * 3_600_000
  const toMs = f.to ? Date.parse(f.to) : now.getTime()
  const fromMs = f.from ? Date.parse(f.from) : toMs - hours
  if (!Number.isFinite(toMs) || !Number.isFinite(fromMs) || fromMs > toMs) {
    throw new FilterError(400, 'INVALID_RANGE', 'Invalid time range')
  }
  if (toMs - fromMs > MAX_RANGE_DAYS * 86_400_000) {
    throw new FilterError(400, 'INVALID_RANGE', 'Time range too long')
  }

  return {
    folders,
    countries,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    years: f.years && f.years.length > 0 ? dedupe(f.years) : null,
  }
}
