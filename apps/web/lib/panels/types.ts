import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ZodType, ZodTypeDef } from 'zod'
import type { A11yTable, PanelData } from './data'
import type { Rng } from './rng'

export type PanelCategory = 'charts' | 'single' | 'tables' | 'status' | 'maps' | 'content' | 'controls' | 'ready'

export const CATEGORIES: { id: PanelCategory; label: string }[] = [
  { id: 'charts', label: 'Charts' },
  { id: 'single', label: 'Single value' },
  { id: 'tables', label: 'Tables and lists' },
  { id: 'status', label: 'Time and status' },
  { id: 'maps', label: 'Maps' },
  { id: 'content', label: 'Content' },
  { id: 'controls', label: 'Controls' },
  { id: 'ready', label: 'Ready-made panels' },
]

/** Builder blocks a panel type accepts (docs/PLAN_BUILDER.md section 4.1). The chart-type block is the registry itself. */
export type BlockKind = 'filter' | 'groupBy' | 'measure' | 'sort' | 'limit'

export type FilterValue = string | string[]
export type Filters = Record<string, FilterValue>

export interface PanelProps<O = Record<string, unknown>> {
  title: string
  options: O
  data: PanelData
  /** Measured size in px of the box the renderer fills. Always > 0 when render runs. Never use fixed pixel sizes instead. */
  width: number
  height: number
  /** True only at data-fx "full". Renderers must not animate otherwise. */
  animate: boolean
  filters: Filters
  /** Controls publish values here; null clears. */
  setFilter?: (field: string, value: FilterValue | null) => void
}

/**
 * One dashboard asset. Adding a panel type = one entry in lib/panels/registry.tsx
 * plus its renderer; the asset bar, spec validation, mock data and the
 * accessible table all derive from it.
 */
export interface PanelType<O = Record<string, unknown>> {
  id: string
  label: string
  description: string
  category: PanelCategory
  icon: LucideIcon
  /** Blocks the config panel offers for this type. Controls and content take none. */
  blocks: BlockKind[]
  /** Default grid size on a 12-column canvas (rows of ~80px). */
  size: { w: number; h: number }
  /** Smallest readable size in grid cells (the artboard converts cells to units: 160 x 100). Never larger than `size`. */
  min: { w: number; h: number }
  /** Shape of the spec's `options`. Every key must have a default: `schema.parse({})` is the default spec. */
  options: ZodType<O, ZodTypeDef, unknown>
  /** Mock data generator (M3). Real data arrives through datasets in M5. */
  mock: (r: Rng, options: O) => PanelData
  /** Accessible data-table strategy for this type's data. */
  a11y: (data: PanelData, title: string) => A11yTable
  /** The renderer; null only while `soon` is set. */
  render: ComponentType<PanelProps<O>> | null
  /** True when the visual itself is the accessible form (tables, text, controls): no extra hidden table. */
  visualAccessible?: boolean
  /** Listed in the asset bar but not yet draggable. */
  soon?: boolean
  /** Ready-made panels: the fixed named dataset behind it (mock until M5). */
  dataset?: string
}
