import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import {
  ART_W, HANDLES, addPanel, applyCommand, artboardHeight, clampRect, commit, dragRect, dropPoint, duplicatePanel, emptyDash, fitScale, keyCommand, lockAxis, minSizeOf, movePanelBy,
  newHistory, reorderZ, resizePanelBy, resizeRect, scaleFor, setLocked, setRect, setZ, sizeUnits, tidyUp, undo, redo, type DashSpec, type Handle, type Rect,
} from '@/lib/builder/model'
import { Canvas } from '@/components/builder/canvas'
import { StaticBoard } from '@/components/panels/artboard'
import { stubPanelSize } from './size-stub'

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

const MIN = { w: 100, h: 60 }
const START: Rect = { x: 400, y: 300, w: 300, h: 200 }
const lay = (d: DashSpec, id: string) => d.panels.find((p) => p.id === id)!.layout
const two = (): DashSpec => addPanel(addPanel(emptyDash(), 'stat', 'a', { x: 100, y: 100 }), 'stat', 'b', { x: 900, y: 400 })
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const OFF = { guides: false, grid: null, threshold: 6 }

describe('layout math: clamp, bounds, minimum size', () => {
  it('keeps every rect inside the artboard and at least the minimum size', () => {
    expect(clampRect({ x: -50, y: -10, w: 300, h: 200 })).toEqual({ x: 0, y: 0, w: 300, h: 200 })
    expect(clampRect({ x: 1800, y: 50, w: 300, h: 200 })).toEqual({ x: 1620, y: 50, w: 300, h: 200 })
    expect(clampRect({ x: 0, y: 0, w: 5000, h: 200 }).w).toBe(ART_W)
    expect(clampRect({ x: 10, y: 10, w: 10, h: 10 }, MIN)).toMatchObject({ w: 100, h: 60 })
  })
  it('converts registry cell sizes to artboard units and enforces them on panels', () => {
    const { size, min } = sizeUnits('stat')
    expect(size).toEqual({ w: 480, h: 200 })
    expect(min).toEqual({ w: 320, h: 200 })
    const d = setRect(addPanel(emptyDash(), 'stat', 'a'), 'a', { x: 0, y: 0, w: 10, h: 10 })
    expect(lay(d, 'a')).toMatchObject({ w: 320, h: 200 })
  })
  it('is free-form: positions are whole units, not grid cells', () => {
    const d = movePanelBy(two(), 'a', 7, 3)
    expect(lay(d, 'a')).toMatchObject({ x: 107, y: 103 })
  })
  it('lets panels overlap', () => {
    const d = setRect(two(), 'b', { x: 150, y: 150, w: 480, h: 200 })
    expect(overlap(lay(d, 'a'), lay(d, 'b'))).toBe(true)
  })
})

describe('resize from each of the 8 handles', () => {
  const cases: [Handle, number, number, Rect][] = [
    ['e', 50, 99, { x: 400, y: 300, w: 350, h: 200 }],
    ['w', 50, 99, { x: 450, y: 300, w: 250, h: 200 }],
    ['s', 99, 40, { x: 400, y: 300, w: 300, h: 240 }],
    ['n', 99, 40, { x: 400, y: 340, w: 300, h: 160 }],
    ['se', 50, 40, { x: 400, y: 300, w: 350, h: 240 }],
    ['sw', 50, 40, { x: 450, y: 300, w: 250, h: 240 }],
    ['ne', 50, 40, { x: 400, y: 340, w: 350, h: 160 }],
    ['nw', 50, 40, { x: 450, y: 340, w: 250, h: 160 }],
  ]
  it.each(cases)('%s moves only its own edges; the opposite edges stay fixed', (h, dx, dy, want) => {
    const r = resizeRect(START, h, dx, dy, MIN)
    expect(r).toEqual(want)
    if (h.includes('w')) expect(r.x + r.w).toBe(START.x + START.w) // right edge fixed
    if (h.includes('e')) expect(r.x).toBe(START.x) // left edge fixed
    if (h.includes('n')) expect(r.y + r.h).toBe(START.y + START.h) // bottom edge fixed
    if (h.includes('s')) expect(r.y).toBe(START.y) // top edge fixed
  })
  it('covers all 8 handles', () => expect([...HANDLES].sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']))
  it('never shrinks below the minimum and the fixed edge does not move', () => {
    for (const h of HANDLES) {
      const r = resizeRect(START, h, h.includes('w') ? 5000 : -5000, h.includes('n') ? 5000 : -5000, MIN)
      expect(r.w, h).toBeGreaterThanOrEqual(MIN.w)
      expect(r.h, h).toBeGreaterThanOrEqual(MIN.h)
      if (h.includes('w')) expect(r.x + r.w, h).toBe(700)
      if (h.includes('n')) expect(r.y + r.h, h).toBe(500)
    }
  })
  it('never leaves the artboard', () => {
    expect(resizeRect(START, 'e', 9999, 0, MIN)).toMatchObject({ x: 400, w: ART_W - 400 })
    expect(resizeRect(START, 'w', -9999, 0, MIN)).toMatchObject({ x: 0, w: 700 })
    expect(resizeRect(START, 'n', 0, -9999, MIN)).toMatchObject({ y: 0, h: 500 })
  })
})

describe('snapping and guides (off by default)', () => {
  const others: Rect[] = [{ x: 1000, y: 100, w: 400, h: 300 }]
  it('does nothing when snapping is off', () => {
    const { rect, guides } = dragRect(START, undefined, 297, 0, MIN, others, OFF)
    expect(rect.x).toBe(697)
    expect(guides).toEqual([])
  })
  it('aligns the moving panel to another panel edge within the threshold and reports a vertical guide', () => {
    // right edge would be 1000+3 -> snaps to the neighbour's left edge at 1000
    const { rect, guides } = dragRect(START, undefined, 303, 0, MIN, others, { ...OFF, guides: true })
    expect(rect.x + rect.w).toBe(1000)
    expect(guides.find((g) => g.axis === 'x')?.pos).toBe(1000)
  })
  it('ignores targets farther than the threshold', () => {
    const { rect, guides } = dragRect(START, undefined, 320, 0, MIN, others, { ...OFF, guides: true })
    expect(rect.x).toBe(720)
    expect(guides.filter((g) => g.axis === 'x')).toEqual([])
  })
  it('snaps to centres and to the artboard edges', () => {
    const c = dragRect({ x: 0, y: 500, w: 400, h: 100 }, undefined, 757, 0, MIN, [], { ...OFF, guides: true })
    expect(c.rect.x + c.rect.w / 2).toBe(ART_W / 2) // centre of the artboard
    const edge = dragRect(START, undefined, -397, 0, MIN, [], { ...OFF, guides: true })
    expect(edge.rect.x).toBe(0)
  })
  it('snaps only the dragged edge while resizing', () => {
    const { rect } = dragRect(START, 'e', 297, 50, MIN, others, { ...OFF, guides: true })
    expect(rect.x).toBe(START.x)
    expect(rect.x + rect.w).toBe(1000)
  })
  it('snaps to a grid of 8, 16 or 24 units', () => {
    for (const g of [8, 16, 24]) {
      const { rect } = dragRect(START, undefined, 13, 29, MIN, [], { ...OFF, grid: g })
      expect(rect.x % g).toBe(0)
      expect(rect.y % g).toBe(0)
    }
  })
  it('Shift locks a move to the dominant axis', () => {
    expect(lockAxis(80, 20)).toEqual([80, 0])
    expect(lockAxis(-10, 90)).toEqual([0, 90])
  })
})

describe('keyboard on the selected panel', () => {
  const key = (k: string, o: Partial<{ shiftKey: boolean; altKey: boolean; ctrlKey: boolean }> = {}) => keyCommand({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...o })
  it('maps keys to commands', () => {
    expect(key('ArrowRight')).toEqual({ t: 'nudge', dx: 1, dy: 0 })
    expect(key('ArrowUp', { shiftKey: true })).toEqual({ t: 'nudge', dx: 0, dy: -10 })
    expect(key('ArrowRight', { altKey: true })).toEqual({ t: 'resize', dw: 1, dh: 0 })
    expect(key('ArrowDown', { altKey: true, shiftKey: true })).toEqual({ t: 'resize', dw: 0, dh: 10 })
    expect(key('Delete')).toEqual({ t: 'delete' })
    expect(key('d', { ctrlKey: true })).toEqual({ t: 'duplicate' })
    expect(key('[')).toEqual({ t: 'backward' })
    expect(key(']')).toEqual({ t: 'forward' })
    expect(key('Escape')).toEqual({ t: 'deselect' })
    expect(key('x')).toBeNull()
  })
  it('nudges 1 unit, Shift 10; Alt resizes; clamps at the artboard edge', () => {
    let d = two()
    d = applyCommand(d, 'a', { t: 'nudge', dx: 1, dy: 0 }).dash
    d = applyCommand(d, 'a', { t: 'nudge', dx: 0, dy: 10 }).dash
    expect(lay(d, 'a')).toMatchObject({ x: 101, y: 110 })
    d = applyCommand(d, 'a', { t: 'resize', dw: 1, dh: 10 }).dash
    expect(lay(d, 'a')).toMatchObject({ w: 481, h: 210 })
    for (let i = 0; i < 400; i++) d = movePanelBy(d, 'a', -10, -10)
    expect(lay(d, 'a')).toMatchObject({ x: 0, y: 0 })
    d = resizePanelBy(d, 'a', -9999, -9999)
    expect(lay(d, 'a')).toMatchObject({ w: 320, h: 200 }) // type minimum
  })
  it('deletes, duplicates (offset, on top, never locked) and deselects', () => {
    const d = setLocked(two(), 'a', true)
    const dup = applyCommand(d, 'a', { t: 'duplicate' }, 'a2')
    expect(dup.selectedId).toBe('a2')
    expect(lay(dup.dash, 'a2')).toMatchObject({ x: 124, y: 124 })
    expect(lay(dup.dash, 'a2').locked).toBeUndefined()
    expect(lay(dup.dash, 'a2').z).toBeGreaterThan(lay(dup.dash, 'b').z)
    expect(applyCommand(d, 'a', { t: 'delete' })).toMatchObject({ selectedId: null, dash: { panels: [{ id: 'b' }] } })
    expect(applyCommand(d, 'a', { t: 'deselect' }).selectedId).toBeNull()
  })
})

describe('lock', () => {
  it('a locked panel cannot be moved or resized, by any route', () => {
    const d = setLocked(two(), 'a', true)
    const before = lay(d, 'a')
    expect(movePanelBy(d, 'a', 50, 50)).toBe(d)
    expect(resizePanelBy(d, 'a', 50, 50)).toBe(d)
    expect(setRect(d, 'a', { x: 5, y: 5, w: 500, h: 500 })).toBe(d)
    expect(lay(d, 'a')).toEqual(before)
    const un = applyCommand(d, 'a', { t: 'lock' }).dash
    expect(lay(un, 'a').locked).toBeUndefined()
    expect(lay(movePanelBy(un, 'a', 5, 0), 'a').x).toBe(105)
  })
})

describe('z-order', () => {
  const three = () => addPanel(two(), 'stat', 'c', { x: 300, y: 700 })
  const order = (d: DashSpec) => [...d.panels].sort((x, y) => x.layout.z - y.layout.z).map((p) => p.id)
  it('new panels go on top; front/back/forward/backward reorder', () => {
    let d = three()
    expect(order(d)).toEqual(['a', 'b', 'c'])
    d = reorderZ(d, 'a', 'front')
    expect(order(d)).toEqual(['b', 'c', 'a'])
    d = reorderZ(d, 'a', 'back')
    expect(order(d)).toEqual(['a', 'b', 'c'])
    d = reorderZ(d, 'a', 'forward')
    expect(order(d)).toEqual(['b', 'a', 'c'])
    d = reorderZ(d, 'a', 'backward')
    expect(order(d)).toEqual(['a', 'b', 'c'])
    expect(order(reorderZ(d, 'c', 'forward'))).toEqual(['a', 'b', 'c']) // already on top
  })
  it('the Z field sets stacking directly and is clamped', () => {
    expect(lay(setZ(two(), 'a', 7), 'a').z).toBe(7)
    expect(lay(setZ(two(), 'a', -4), 'a').z).toBe(0)
  })
  it('duplicate copies the spec', () => {
    const d = duplicatePanel(two(), 'a', 'a2')
    expect(d.panels.find((p) => p.id === 'a2')!.spec).toEqual(d.panels.find((p) => p.id === 'a')!.spec)
  })
})

describe('tidy up', () => {
  it('arranges overlapping panels into non-overlapping rows inside the artboard', () => {
    let d = emptyDash()
    for (let i = 0; i < 9; i++) d = addPanel(d, i % 2 ? 'bar-grouped' : 'stat', `p${i}`, { x: 100, y: 100 }) // all stacked on one spot
    const t = tidyUp(d)
    const rs = t.panels.map((p) => p.layout)
    for (let i = 0; i < rs.length; i++) {
      expect(rs[i]!.x).toBeGreaterThanOrEqual(0)
      expect(rs[i]!.x + rs[i]!.w).toBeLessThanOrEqual(ART_W)
      for (let j = i + 1; j < rs.length; j++) expect(overlap(rs[i]!, rs[j]!), `${i} vs ${j}`).toBe(false)
    }
    expect(t.panels.map((p) => p.id)).toEqual(d.panels.map((p) => p.id))
  })
  it('keeps locked panels where they are and avoids them', () => {
    let d = addPanel(addPanel(emptyDash(), 'stat', 'a', { x: 24, y: 24 }), 'stat', 'b', { x: 600, y: 600 })
    d = setLocked(d, 'a', true)
    const t = tidyUp(d)
    expect(lay(t, 'a')).toEqual(lay(d, 'a'))
    expect(overlap(lay(t, 'a'), lay(t, 'b'))).toBe(false)
  })
  it('is one undo step', () => {
    let h = newHistory(setRect(two(), 'b', { x: 110, y: 110, w: 480, h: 200 }))
    h = commit(h, tidyUp(h.present))
    expect(overlap(lay(h.present, 'a'), lay(h.present, 'b'))).toBe(false)
    h = undo(h)
    expect(overlap(lay(h.present, 'a'), lay(h.present, 'b'))).toBe(true)
  })
})

describe('undo and redo of layout changes', () => {
  it('moves, resizes, z and lock all undo and redo', () => {
    let h = newHistory(two())
    const steps: ((d: DashSpec) => DashSpec)[] = [
      (d) => movePanelBy(d, 'a', 40, 0),
      (d) => resizePanelBy(d, 'a', 100, 0),
      (d) => reorderZ(d, 'a', 'front'),
      (d) => setLocked(d, 'a', true),
    ]
    for (const s of steps) h = commit(h, s(h.present))
    expect(lay(h.present, 'a')).toMatchObject({ x: 140, w: 580, locked: true })
    for (let i = 0; i < 4; i++) h = undo(h)
    expect(lay(h.present, 'a')).toMatchObject({ x: 100, w: 480 })
    for (let i = 0; i < 4; i++) h = redo(h)
    expect(lay(h.present, 'a')).toMatchObject({ x: 140, w: 580, locked: true })
  })
})

describe('scale to fit', () => {
  it('fits the artboard width to the measured column and clamps silly values', () => {
    expect(fitScale(960)).toBeCloseTo(0.5)
    expect(fitScale(1920)).toBe(1)
    expect(fitScale(0)).toBe(0)
    expect(fitScale(100000)).toBe(4)
    expect(scaleFor('fit', 1440)).toBeCloseTo(0.75)
    expect(scaleFor(50, 1440)).toBe(0.5)
    expect(scaleFor(150, 1440)).toBe(1.5)
  })
  it('grows the artboard to the lowest panel bottom plus 200', () => {
    expect(artboardHeight([])).toBe(800)
    const d = addPanel(emptyDash(), 'stat', 'a', { x: 0, y: 1000 })
    expect(artboardHeight(d.panels)).toBe(1000 + 200 + 200)
  })
  it('drops an asset under the cursor at its default size, clamped', () => {
    expect(dropPoint('stat', 960, 500)).toEqual({ x: 720, y: 400 })
    expect(dropPoint('stat', 5, 5)).toEqual({ x: 0, y: 0 })
    expect(dropPoint('stat', 1919, 500).x).toBe(ART_W - 480)
    const d = addPanel(emptyDash(), 'bar-grouped', 'x', dropPoint('bar-grouped', 960, 500))
    expect(lay(d, 'x')).toMatchObject({ w: 960, h: 400 })
  })
  it('the minimum size of a type is never above its default', () => {
    for (const t of ['stat', 'bar-grouped', 'table', 'heatmap-hour-day', 'divider']) {
      const p = { spec: { chart: t } } as never
      expect(minSizeOf(p).w).toBeLessThanOrEqual(sizeUnits(t).size.w)
      expect(minSizeOf(p).h).toBeLessThanOrEqual(sizeUnits(t).size.h)
    }
  })
})

describe('editor canvas (pointer)', () => {
  const noop = () => {}
  const mountEditor = (dash: DashSpec, selectedId: string | null, onCommit = vi.fn()) => {
    const r = render(
      <DndContext>
        <Canvas dash={dash} selectedId={selectedId} preview={false} filters={{}} zoom="fit" snap={{ guides: false, grid: null }} onSelect={noop} onCommit={onCommit} onCommand={noop} setFilter={noop} />
      </DndContext>,
    )
    return { ...r, onCommit }
  }

  it('renders 8 resize handles on the selected panel, none on a locked one, with the right cursors and >= 12px hit areas', () => {
    const restore = stubPanelSize(() => ({ width: 400, height: 200 }), 960) // scale 0.5
    try {
      const { container, unmount } = mountEditor(two(), 'a')
      const hs = Array.from(container.querySelectorAll<HTMLElement>('[data-handle]'))
      expect(hs.map((h) => h.dataset.handle).sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'])
      expect(container.querySelector<HTMLElement>('[data-handle=se]')!.style.cursor).toBe('nwse-resize')
      expect(container.querySelector<HTMLElement>('[data-handle=n]')!.style.cursor).toBe('ns-resize')
      expect(container.querySelector<HTMLElement>('[data-handle=e]')!.style.cursor).toBe('ew-resize')
      expect(container.querySelector<HTMLElement>('[data-handle=ne]')!.style.cursor).toBe('nesw-resize')
      const corner = container.querySelector<HTMLElement>('[data-handle=se]')!
      expect(parseFloat(corner.style.width) * 0.5).toBeGreaterThanOrEqual(12) // on-screen size after the 0.5 scale
      unmount()
      const locked = mountEditor(setLocked(two(), 'a', true), 'a')
      expect(locked.container.querySelectorAll('[data-handle]').length).toBe(0)
    } finally {
      restore()
    }
  })

  it('dragging the south-east handle resizes with the opposite corner fixed, committed once on pointer-up', () => {
    const restore = stubPanelSize(() => ({ width: 400, height: 200 }), 960)
    try {
      const { container, onCommit } = mountEditor(two(), 'a')
      const h = container.querySelector<HTMLElement>('[data-handle=se]')!
      fireEvent.pointerDown(h, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(h, { pointerId: 1, clientX: 50, clientY: 25 }) // 50px / 0.5 = 100 units
      expect(onCommit).not.toHaveBeenCalled() // nothing committed mid-drag
      fireEvent.pointerUp(h, { pointerId: 1, clientX: 50, clientY: 25 })
      expect(onCommit).toHaveBeenCalledTimes(1)
      const next = onCommit.mock.calls[0]![0] as DashSpec
      expect(lay(next, 'a')).toMatchObject({ x: 100, y: 100, w: 580, h: 250 })
    } finally {
      restore()
    }
  })

  it('a plain click does not commit anything, and a locked panel cannot be dragged', () => {
    const restore = stubPanelSize(() => ({ width: 400, height: 200 }), 960)
    try {
      const { container, onCommit } = mountEditor(two(), 'a')
      const strip = container.querySelector<HTMLElement>('[data-panel-id=a] [data-strip]')!
      fireEvent.pointerDown(strip, { button: 0, pointerId: 1, clientX: 5, clientY: 5 })
      fireEvent.pointerUp(strip, { pointerId: 1, clientX: 5, clientY: 5 })
      expect(onCommit).not.toHaveBeenCalled()
      fireEvent.pointerDown(strip, { button: 0, pointerId: 1, clientX: 5, clientY: 5 })
      fireEvent.pointerMove(strip, { pointerId: 1, clientX: 105, clientY: 5 })
      fireEvent.pointerUp(strip, { pointerId: 1, clientX: 105, clientY: 5 })
      expect(onCommit).toHaveBeenCalledTimes(1)
      expect(lay(onCommit.mock.calls[0]![0] as DashSpec, 'a').x).toBe(300) // 100px / 0.5 = 200 units
      const locked = mountEditor(setLocked(two(), 'a', true), 'a')
      const s2 = locked.container.querySelector<HTMLElement>('[data-panel-id=a] [data-strip]')!
      fireEvent.pointerDown(s2, { button: 0, pointerId: 1, clientX: 5, clientY: 5 })
      fireEvent.pointerMove(s2, { pointerId: 1, clientX: 205, clientY: 5 })
      fireEvent.pointerUp(s2, { pointerId: 1, clientX: 205, clientY: 5 })
      expect(locked.onCommit).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('keyboard on a focused panel is routed as commands', () => {
    const restore = stubPanelSize(() => ({ width: 400, height: 200 }), 960)
    try {
      const onCommand = vi.fn()
      const { container } = render(
        <DndContext>
          <Canvas dash={two()} selectedId="a" preview={false} filters={{}} zoom="fit" snap={{ guides: false, grid: null }} onSelect={noop} onCommit={noop} onCommand={onCommand} setFilter={noop} />
        </DndContext>,
      )
      const panel = container.querySelector<HTMLElement>('[data-panel-id=a]')!
      fireEvent.keyDown(panel, { key: 'ArrowRight', shiftKey: true })
      fireEvent.keyDown(panel, { key: 'ArrowDown', altKey: true })
      expect(onCommand).toHaveBeenNthCalledWith(1, 'a', { t: 'nudge', dx: 10, dy: 0 })
      expect(onCommand).toHaveBeenNthCalledWith(2, 'a', { t: 'resize', dw: 0, dh: 1 })
    } finally {
      restore()
    }
  })
})

describe('viewer and editor share the artboard', () => {
  it('render the same panel types for the same spec', () => {
    const restore = stubPanelSize(() => ({ width: 400, height: 200 }), 960)
    try {
      let d = emptyDash()
      for (const [t, id, x, y] of [['stat', 'a', 24, 24], ['bar-grouped', 'b', 24, 300], ['table', 'c', 24, 760], ['gauge', 'd', 700, 24]] as const) d = addPanel(d, t, id, { x, y })
      const chartsIn = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-panel-id]')).map((e) => `${e.dataset.panelId}:${e.dataset.chart}`)
      const viewer = render(<StaticBoard spec={d} filters={{}} setFilter={() => {}} />)
      const v = chartsIn(viewer.container)
      const viewerContent = viewer.container.querySelectorAll('[data-panel-content]').length
      viewer.unmount()
      const editor = render(<DndContext><Canvas dash={d} selectedId={null} preview={false} filters={{}} zoom="fit" snap={{ guides: false, grid: null }} onSelect={() => {}} onCommit={() => {}} onCommand={() => {}} setFilter={() => {}} /></DndContext>)
      expect(chartsIn(editor.container)).toEqual(v)
      expect(v).toEqual(['a:stat', 'b:bar-grouped', 'c:table', 'd:gauge'])
      expect(editor.container.querySelectorAll('[data-panel-content]').length).toBe(viewerContent)
      expect(viewerContent).toBe(4)
      const ab = editor.container.querySelector<HTMLElement>('[data-artboard]')!
      expect(ab.style.width).toBe('1920px') // same logical artboard
      expect(ab.dataset.scale).toBe('0.5')
    } finally {
      restore()
    }
  })
})
