'use client'

import { useEffect, useRef, useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { FN_FIELD, FN_LABEL, GRAINS, MOCK_FIELDS, OPS_FOR, OP_LABEL, fieldById, type FieldType, type MeasureFn } from '@/lib/builder/fields'
import {
  KIND_LABEL, allowedKinds, blockIssues, blocksToSpec, canAddBlock, changeChart, insertBlock, newBlock, reorderBlocks, setPanelOption, setPanelTitle, specToBlocks,
  type Block, type BlockKindId,
} from '@/lib/builder/model'
import { PANEL_COLORS, PANEL_TYPES, getPanelType, type PanelSpec } from '@/lib/panels/registry'
import { CATEGORIES } from '@/lib/panels/types'
import { cn } from '@/lib/utils'

// Brand chart colours per block kind (Scratch look: one colour per kind).
const KIND_STYLE: Record<BlockKindId, string> = {
  chart: 'border-l-chart-2 bg-chart-2/15',
  filter: 'border-l-chart-3 bg-chart-3/15',
  groupBy: 'border-l-chart-1 bg-chart-1/15',
  measure: 'border-l-chart-4 bg-chart-4/15',
  sort: 'border-l-chart-5 bg-chart-5/15',
  limit: 'border-l-brand-border-strong bg-brand-surface-raised/60',
}
const KIND_DOT: Record<BlockKindId, string> = { chart: 'bg-chart-2', filter: 'bg-chart-3', groupBy: 'bg-chart-1', measure: 'bg-chart-4', sort: 'bg-chart-5', limit: 'bg-brand-border-strong' }
const TYPE_RING: Record<FieldType, string> = { text: 'border-chart-1', number: 'border-chart-4', date: 'border-chart-2' }

const slot = 'h-8 rounded-full border bg-brand-primary px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent'
const COLOR_NAME: Record<string, string> = { 'chart-2': 'Purple', 'chart-3': 'Blue', 'chart-4': 'Indigo', 'chart-5': 'Pale blue' }

function FieldSelect({ label, value, onChange, accept }: { label: string; value: string; onChange: (v: string) => void; accept: FieldType[] }) {
  const f = fieldById(value)
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cn(slot, f ? TYPE_RING[f.type] : 'border-brand-border-strong')} title={f ? `${f.label} (${f.type})` : label}>
      {!f ? <option value="">Pick a field</option> : null}
      {MOCK_FIELDS.filter((x) => accept.includes(x.type)).map((x) => <option key={x.id} value={x.id}>{x.label} ({x.type})</option>)}
    </select>
  )
}

function BlockBody({ b, update, onChart }: { b: Block; update: (b: Block) => void; onChart: (id: string) => void }) {
  const border = 'border-brand-border-strong'
  switch (b.kind) {
    case 'chart':
      return (
        <select aria-label="Chart type" value={b.chart} onChange={(e) => onChart(e.target.value)} className={cn(slot, border)}>
          {CATEGORIES.map((c) => (
            <optgroup key={c.id} label={c.label}>
              {PANEL_TYPES.filter((t) => t.category === c.id && !t.soon && t.render).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </optgroup>
          ))}
        </select>
      )
    case 'filter': {
      const f = fieldById(b.field)
      return (
        <>
          <FieldSelect label="Filter field" value={b.field} accept={['text', 'number', 'date']} onChange={(v) => { const t = fieldById(v)!.type; update({ ...b, field: v, op: OPS_FOR[t].includes(b.op) ? b.op : OPS_FOR[t][0]! }) }} />
          <select aria-label="Comparison" value={b.op} onChange={(e) => update({ ...b, op: e.target.value as typeof b.op })} className={cn(slot, border)}>
            {OPS_FOR[f?.type ?? 'text'].map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
          </select>
          <input aria-label="Value" value={b.value} onChange={(e) => update({ ...b, value: e.target.value })} placeholder={b.op === 'between' ? 'from, to' : b.op === 'in' ? 'a, b, c' : 'value'} className={cn(slot, border, 'w-28')} />
        </>
      )
    }
    case 'groupBy': {
      const f = fieldById(b.field)
      return (
        <>
          <FieldSelect label="Group by field" value={b.field} accept={['text', 'date']} onChange={(v) => update({ ...b, field: v, grain: fieldById(v)?.type === 'date' ? b.grain ?? 'day' : undefined })} />
          {f?.type === 'date' ? (
            <select aria-label="Time grain" value={b.grain ?? 'day'} onChange={(e) => update({ ...b, grain: e.target.value as typeof GRAINS[number] })} className={cn(slot, border)}>
              {GRAINS.map((g) => <option key={g} value={g}>per {g}</option>)}
            </select>
          ) : null}
        </>
      )
    }
    case 'measure': {
      const need = FN_FIELD[b.fn]
      return (
        <>
          <select aria-label="Function" value={b.fn} onChange={(e) => { const fn = e.target.value as MeasureFn; const n = FN_FIELD[fn]; const cur = b.field ? fieldById(b.field) : undefined; update({ ...b, fn, field: n && cur && n.includes(cur.type) ? b.field : undefined }) }} className={cn(slot, border)}>
            {(Object.keys(FN_LABEL) as MeasureFn[]).map((fn) => <option key={fn} value={fn}>{FN_LABEL[fn]}</option>)}
          </select>
          {need ? <FieldSelect label="Measure field" value={b.field ?? ''} accept={need} onChange={(v) => update({ ...b, field: v })} /> : <span className="text-xs text-brand-text-muted">of rows</span>}
        </>
      )
    }
    case 'sort':
      return (
        <>
          <FieldSelect label="Sort field" value={b.field} accept={['text', 'number', 'date']} onChange={(v) => update({ ...b, field: v })} />
          <select aria-label="Direction" value={b.dir} onChange={(e) => update({ ...b, dir: e.target.value as 'asc' | 'desc' })} className={cn(slot, border)}>
            <option value="desc">high to low</option>
            <option value="asc">low to high</option>
          </select>
        </>
      )
    case 'limit':
      return <input aria-label="Row limit" type="number" min={1} max={1000} value={Number.isFinite(b.n) ? b.n : ''} onChange={(e) => update({ ...b, n: e.target.value === '' ? NaN : Number(e.target.value) })} className={cn(slot, border, 'w-20')} />
  }
}

function SortableBlock({ b, index, issue, update, onChart, remove, move }: { b: Block; index: number; issue?: string; update: (b: Block) => void; onChart: (id: string) => void; remove: () => void; move: (dir: -1 | 1) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: b.id, disabled: b.kind === 'chart' })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onKeyDown={(e) => {
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && b.kind !== 'chart') { e.preventDefault(); move(e.key === 'ArrowUp' ? -1 : 1) }
        else if (e.key === 'Delete' && b.kind !== 'chart' && e.target === e.currentTarget) { e.preventDefault(); remove() }
      }}
      tabIndex={-1}
      aria-label={`${KIND_LABEL[b.kind]} block ${index + 1}`}
      className={cn('relative mb-2 list-none rounded-md border border-brand-border border-l-4 p-2 pt-2.5', KIND_STYLE[b.kind], isDragging && 'z-10 opacity-70', issue && 'border-brand-danger')}
    >
      {/* Scratch notch (top, carved) and bump (bottom): decorative */}
      {b.kind !== 'chart' ? <span aria-hidden className="absolute -top-px left-5 h-1.5 w-5 rounded-b bg-brand-surface" /> : null}
      <span aria-hidden className="absolute -bottom-1.5 left-5 z-[1] h-1.5 w-5 rounded-b" style={{ backgroundColor: 'var(--brand-surface-raised)' }} />
      <div className="flex flex-wrap items-center gap-1.5">
        {b.kind !== 'chart' ? (
          <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Reorder ${KIND_LABEL[b.kind]} block. Alt+Up or Alt+Down also moves it.`} className="flex size-6 cursor-grab items-center justify-center rounded text-brand-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
            <GripVertical className="size-4" aria-hidden />
          </button>
        ) : null}
        <span className="flex items-center gap-1 text-xs font-semibold"><span aria-hidden className={cn('size-2 rounded-full', KIND_DOT[b.kind])} />{KIND_LABEL[b.kind]}</span>
        <BlockBody b={b} update={update} onChart={onChart} />
        {b.kind !== 'chart' ? (
          <button type="button" onClick={remove} aria-label={`Remove ${KIND_LABEL[b.kind]} block`} className="ml-auto flex size-6 items-center justify-center rounded text-brand-text-muted hover:text-brand-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      {issue ? <p role="alert" className="mt-1 text-xs text-brand-danger">{issue} (left out of the panel until fixed)</p> : null}
    </li>
  )
}

function PaletteChip({ kind, reason, onAdd }: { kind: Exclude<BlockKindId, 'chart'>; reason: string | null; onAdd: () => void }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: `new:${kind}`, disabled: !!reason })
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-disabled={reason ? true : undefined}
      title={reason ?? `Add a ${KIND_LABEL[kind]} block (click, Enter, or drag onto the stack)`}
      onClick={() => { if (!reason) onAdd() }}
      className={cn('flex items-center gap-1 rounded-full border border-brand-border-strong px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent', reason ? 'cursor-not-allowed opacity-50' : 'cursor-grab hover:bg-brand-surface-raised', isDragging && 'opacity-40')}
    >
      <Plus className="size-3" aria-hidden /> <span aria-hidden className={cn('size-2 rounded-full', KIND_DOT[kind])} />{KIND_LABEL[kind]}
    </button>
  )
}

function Stack({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'stack' })
  return <div ref={setNodeRef} className={cn('rounded-md', isOver && 'ring-2 ring-brand-accent')}>{children}</div>
}

/**
 * Scratch-style block panel for the selected panel. Blocks are the editing surface; the typed
 * spec (v:1) is derived from them on every change. Blocks with a problem stay visible, flagged,
 * and are left out of the spec until fixed, so the panel always renders a valid spec.
 * `onChange(spec, key)`: edits sharing a key collapse into one undo step.
 */
export function BlocksPanel({ panelId, spec, onChange }: { panelId: string; spec: PanelSpec; onChange: (s: PanelSpec, key?: string) => void }) {
  const [blocks, setBlocks] = useState<Block[]>(() => specToBlocks(spec))
  const [notice, setNotice] = useState('')
  const seq = useRef(0)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  // Re-derive the blocks when the spec changed from outside (selection, undo, restore). Our own edits
  // always satisfy `blocksToSpec(blocks) == spec`, so they never reset the drafts.
  useEffect(() => {
    if (JSON.stringify(blocksToSpec(spec, blocks)) !== JSON.stringify(spec)) setBlocks(specToBlocks(spec))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, spec])

  const issues = blockIssues(blocks)
  const apply = (next: Block[], key?: string) => {
    setBlocks(next)
    onChange(blocksToSpec(spec, next), key)
  }
  const chartId = spec.chart
  const type = getPanelType(chartId)
  const add = (kind: Exclude<BlockKindId, 'chart'>) => {
    const why = canAddBlock(chartId, blocks, kind)
    if (why) return setNotice(why)
    apply(insertBlock(blocks, newBlock(kind, `${kind}-n${++seq.current}`)))
    setNotice(`${KIND_LABEL[kind]} block added`)
  }
  const move = (from: number, to: number) => {
    const next = reorderBlocks(blocks, from, to)
    if (!next) return setNotice('That position is not allowed: blocks stay in the order chart type, filters, group by, measure, sort, limit.')
    apply(next)
    setNotice('Block moved')
  }
  const onChart = (id: string) => {
    const { spec: next, dropped } = changeChart(spec, id)
    setBlocks(specToBlocks(next))
    onChange(next)
    setNotice(dropped.length ? `Removed blocks this chart type does not take: ${dropped.map((k) => KIND_LABEL[k]).join(', ')}` : 'Chart type changed')
  }
  function onDragEnd(e: DragEndEvent) {
    const a = String(e.active.id)
    const over = e.over ? String(e.over.id) : null
    if (a.startsWith('new:')) return void (over && add(a.slice(4) as Exclude<BlockKindId, 'chart'>))
    if (over && over !== a) move(blocks.findIndex((b) => b.id === a), blocks.findIndex((b) => b.id === over))
  }

  const palette = allowedKinds(chartId).filter((k): k is Exclude<BlockKindId, 'chart'> => k !== 'chart')
  return (
    <div className="space-y-3">
      <section aria-label="Panel options" className="space-y-2">
        <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-brand-text-muted">Panel options</h3>
        <label className="block text-xs">Title
          <input value={spec.title ?? ''} onChange={(e) => onChange(setPanelTitle(spec, e.target.value), `title:${panelId}`)} className="mt-0.5 h-8 w-full rounded-md border border-brand-border-strong bg-brand-primary px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" />
        </label>
        <div className="flex gap-2">
          <label className="block flex-1 text-xs">Unit
            <input value={typeof spec.options.unit === 'string' ? spec.options.unit : ''} maxLength={12} placeholder="e.g. km" onChange={(e) => onChange(setPanelOption(spec, 'unit', e.target.value), `unit:${panelId}`)} className="mt-0.5 h-8 w-full rounded-md border border-brand-border-strong bg-brand-primary px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" />
          </label>
          <label className="block flex-1 text-xs">Colour
            <select value={typeof spec.options.color === 'string' ? spec.options.color : ''} onChange={(e) => onChange(setPanelOption(spec, 'color', e.target.value))} className="mt-0.5 h-8 w-full rounded-md border border-brand-border-strong bg-brand-primary px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent">
              <option value="">Default (cyan)</option>
              {PANEL_COLORS.map((c) => <option key={c} value={c}>{COLOR_NAME[c]}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section aria-label="Blocks">
        <h3 className="mb-1 font-display text-xs font-semibold uppercase tracking-wide text-brand-text-muted">Blocks · {type?.label}</h3>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Add a block">
            {palette.length === 0 ? <span className="text-xs text-brand-text-muted">{type?.label} takes no data blocks.</span> : null}
            {palette.map((k) => <PaletteChip key={k} kind={k} reason={canAddBlock(chartId, blocks, k)} onAdd={() => add(k)} />)}
          </div>
          <Stack>
            <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              <ol className="m-0 p-0" aria-label="Block stack">
                {blocks.map((b, i) => (
                  <SortableBlock key={b.id} b={b} index={i} issue={issues[b.id]} update={(nb) => apply(blocks.map((x) => (x.id === b.id ? nb : x)), `blk:${panelId}:${b.id}`)} onChart={onChart} remove={() => { apply(blocks.filter((x) => x.id !== b.id)); setNotice(`${KIND_LABEL[b.kind]} block removed`) }} move={(d) => move(i, i + d)} />
                ))}
              </ol>
            </SortableContext>
          </Stack>
        </DndContext>
        <p className="text-xs text-brand-text-muted" role="status" aria-live="polite">{notice || 'Click a chip or drag it onto the stack. Alt+Up/Down reorders a focused block.'}</p>
      </section>
    </div>
  )
}
