'use client'

import { useFxLevel } from '@/components/fx/use-fx'
import type { PanelData } from '@/lib/panels/data'
import type { Filters, PanelType, FilterValue } from '@/lib/panels/types'
import { PanelFrame } from './frame'

/** Renders any registry panel: chrome, renderer and its accessible data table. */
export function PanelView({
  type,
  title,
  data,
  options,
  filters = {},
  setFilter,
}: {
  type: PanelType<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  title: string
  data: PanelData
  options?: Record<string, unknown>
  filters?: Filters
  setFilter?: (field: string, value: FilterValue | null) => void
}) {
  const animate = useFxLevel() === 'full'
  const Render = type.render
  if (!Render) {
    return <p className="flex h-full items-center justify-center text-xs text-brand-text-muted">{type.label}: coming soon</p>
  }
  const opts = options ?? type.options.parse({})
  const unit = typeof opts.unit === 'string' && opts.unit ? opts.unit : ''
  const color = typeof opts.color === 'string' && /^chart-[2-5]$/.test(opts.color) ? opts.color : ''
  // The colour option re-points the first series colour at another brand chart colour (CSS variables only).
  const style = color ? ({ '--chart-1': `var(--${color})`, '--color-chart-1': `var(--${color})` } as React.CSSProperties) : undefined
  return (
    <div className="h-full min-h-0 w-full min-w-0" style={style}>
    <PanelFrame title={type.category === 'controls' ? '' : unit ? `${title} (${unit})` : title} table={type.a11y(data, title || type.label)} visualAccessible={type.visualAccessible}>
      {({ width, height }) => <Render title={title} options={opts} data={data} animate={animate} filters={filters} setFilter={setFilter} width={width} height={height} />}
    </PanelFrame>
    </div>
  )
}
