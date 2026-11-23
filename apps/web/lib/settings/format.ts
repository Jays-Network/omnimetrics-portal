import { REGIONS, DEFAULT_SETTINGS, type Settings } from './model'

/**
 * One shared, memoised Intl formatter per distinct settings value. Intl objects are expensive to build, so
 * every Intl.* instance is cached by locale + options. DISPLAY ONLY (R6): never use these to bucket data.
 */
const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>()
function dtf(locale: string, o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = 'd|' + locale + '|' + JSON.stringify(o)
  let f = cache.get(k) as Intl.DateTimeFormat | undefined
  if (!f) cache.set(k, (f = new Intl.DateTimeFormat(locale, o)))
  return f
}
function nf(locale: string, o: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = 'n|' + locale + '|' + JSON.stringify(o)
  let f = cache.get(k) as Intl.NumberFormat | undefined
  if (!f) cache.set(k, (f = new Intl.NumberFormat(locale, o)))
  return f
}

const SEPARATORS = { 'space-comma': { group: ' ', decimal: ',' }, 'comma-dot': { group: ',', decimal: '.' }, 'dot-comma': { group: '.', decimal: ',' } } as const

export interface Formatter {
  date(d: Date | number | string): string
  time(d: Date | number | string): string
  dateTime(d: Date | number | string): string
  number(n: number, decimals?: number): string
  currency(n: number): string
  weekStart: 0 | 1
  settings: Settings
}

const asDate = (d: Date | number | string) => (d instanceof Date ? d : new Date(d))
const built = new Map<string, Formatter>()

export function createFormatter(s: Settings): Formatter {
  const key = JSON.stringify(s)
  const hit = built.get(key)
  if (hit) return hit
  const region = REGIONS[s.region] ?? REGIONS[DEFAULT_SETTINGS.region]
  const tz = s.timeZone
  const parts = (d: Date) => {
    const p = dtf('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
    return { y: g('year'), m: g('month'), d: g('day') }
  }
  const fmtNum = (n: number, o: Intl.NumberFormatOptions) => {
    const f = nf(region.locale, o)
    if (s.numberFormat === 'auto') return f.format(n)
    const sep = SEPARATORS[s.numberFormat]
    return f.formatToParts(n).map((p) => (p.type === 'group' ? sep.group : p.type === 'decimal' ? sep.decimal : p.value)).join('')
  }
  const f: Formatter = {
    settings: s,
    weekStart: region.weekStart,
    date(v) {
      const d = asDate(v)
      if (s.dateFormat === 'long') return dtf('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(d)
      const { y, m, d: dd } = parts(d)
      return s.dateFormat === 'YMD' ? `${y}-${m}-${dd}` : s.dateFormat === 'DMY' ? `${dd}/${m}/${y}` : `${m}/${dd}/${y}`
    },
    time(v) {
      const d = asDate(v)
      if (s.timeFormat === '24') return dtf('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
      return dtf('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d).toLowerCase()
    },
    dateTime(v) { return `${f.date(v)} ${f.time(v)}` },
    number: (n, decimals = 0) => fmtNum(n, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
    currency: (n) => fmtNum(n, { style: 'currency', currency: region.currency }),
  }
  built.set(key, f)
  return f
}

export const defaultFormatter = () => createFormatter(DEFAULT_SETTINGS)

/** Test hook: how many distinct Intl instances exist (proves memoisation). */
export const formatterCacheSize = () => cache.size
