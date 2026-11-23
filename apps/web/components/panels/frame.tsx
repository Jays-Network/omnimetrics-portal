'use client'

import type { ReactNode } from 'react'
import type { A11yTable } from '@/lib/panels/data'
import { useElementSize, type Size } from './use-size'

/** Hidden-from-sight table that gives screen readers the chart's numbers. */
export function A11yDataTable({ table }: { table: A11yTable }) {
  return (
    <table className="sr-only">
      <caption>{table.caption}</caption>
      <thead>
        <tr>
          {table.columns.map((c, i) => (
            <th key={i} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r, i) => (
          <tr key={i}>
            {r.map((cell, j) => (j === 0 ? <th key={j} scope="row">{String(cell)}</th> : <td key={j}>{String(cell)}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Title + visual. The frame never overflows its grid cell: it is h-full min-h-0 flex-col overflow-hidden,
 * and the content area measures its OWN box and hands the size to `children`, which is only called once
 * the size is real. The content area is also a size container (cqmin units scale text with the cell).
 * `visual` is aria-hidden unless it is itself accessible.
 */
export function PanelFrame({ title, table, visualAccessible, children, className }: { title: string; table: A11yTable; visualAccessible?: boolean; children: (size: Size) => ReactNode; className?: string }) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  return (
    <figure className={`relative m-0 flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden ${className ?? ''}`}>
      {title ? <figcaption className="mb-1 shrink-0 truncate font-display text-sm font-semibold">{title}</figcaption> : null}
      <div ref={ref} data-panel-content aria-hidden={visualAccessible ? undefined : true} className="relative min-h-0 min-w-0 flex-1 overflow-hidden" style={{ containerType: 'size' }}>
        {size.width > 0 && size.height > 0 ? children(size) : null}
      </div>
      {visualAccessible ? null : <A11yDataTable table={table} />}
    </figure>
  )
}

export function NoData({ kind }: { kind: string }) {
  return <p className="p-3 text-xs text-brand-text-muted">No data of the expected shape ({kind}).</p>
}
