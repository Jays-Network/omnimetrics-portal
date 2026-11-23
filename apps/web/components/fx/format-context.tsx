'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { createFormatter, defaultFormatter, type Formatter } from '@/lib/settings/format'
import type { Settings } from '@/lib/settings/model'

const Ctx = createContext<Formatter | null>(null)

/**
 * Module-level "current" settings so plain helpers (formatStat, panel renderers) follow the viewer's
 * preferences without every caller threading a prop. Set during render by the provider; null = legacy output.
 */
let active: Formatter | null = null
export const activeFormatter = (): Formatter | null => active

export function FormatProvider({ settings, children }: { settings: Settings; children: ReactNode }) {
  const f = useMemo(() => createFormatter(settings), [settings])
  active = f
  return <Ctx.Provider value={f}>{children}</Ctx.Provider>
}

/** The effective display formatter (user > org > system > default). Falls back to the built-in default. */
export const useFormat = (): Formatter => useContext(Ctx) ?? defaultFormatter()
