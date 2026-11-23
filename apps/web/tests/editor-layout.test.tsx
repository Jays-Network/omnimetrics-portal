import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { appendVersion, emptyDash } from '@/lib/builder/model'
import { isEditorPath, shellClasses, SCROLL_COLUMN } from '@/components/shell/editor-shell'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }))

const has = (el: Element | null, ...classes: string[]) => classes.every((c) => (el?.className ?? '').toString().split(/\s+/).includes(c))

/*
 * jsdom has no layout engine, so it cannot measure that a column really scrolls. This test asserts the
 * CHAIN of classes that makes it work in a browser. Manual check (Chrome and Firefox, zoom 50%, 75%, 100%,
 * 125%, 150%): open an editor, then (1) the page has no scrollbar; (2) scroll the left column to the last
 * category (Ready-made panels) and open it, the last asset must be reachable; (3) select a panel and scroll
 * the right column to the last block; (4) both columns show a thin token-coloured scrollbar and scrolling
 * them never scrolls the page behind; (5) open Settings: its tab content scrolls on its own.
 */
describe('editor layout chain (viewport-fixed, columns scroll)', () => {
  it('the shell goes to the viewport height on the edit route only', () => {
    expect(isEditorPath('/dashboard/o/worldrisk/d/wr-d3/edit')).toBe(true)
    expect(isEditorPath('/dashboard/o/worldrisk/d/wr-d3')).toBe(false)
    const e = shellClasses(true)
    expect(e.outer).toContain('h-dvh')
    expect(e.outer).toContain('overflow-hidden')
    expect(e.inner).toContain('h-dvh')
    expect(e.main).toContain('min-h-0')
    expect(e.main).toContain('overflow-hidden')
    expect(shellClasses(false).outer).toContain('min-h-screen')
    for (const c of ['min-h-0', 'overflow-y-auto', 'overscroll-contain', 'scroll-token']) expect(SCROLL_COLUMN).toContain(c)
  })

  it('every link from the editor root to the scrolling columns is definite and shrinkable', async () => {
    const { Builder } = await import('@/components/builder/builder')
    const versions = appendVersion([], emptyDash(), 'a', 'first', new Date(0))
    const { container } = render(
      <div style={{ height: 600 }} className="h-[600px]">
        <Builder orgSlug="worldrisk" nodeId="wr-d3" orgName="WorldRisk" dashboardName="Daily" initialVersions={versions} showTerminal={false} />
      </div>,
    )
    const root = container.querySelector('[data-editor-root]')
    expect(has(root, 'grid', 'h-full', 'min-h-0'), 'root grid fills its parent and can shrink').toBe(true)
    expect(root!.className).toContain('grid-rows-[auto_minmax(0,1fr)_auto]') // toolbar, flexible middle, terminal
    const cols = container.querySelector('[data-editor-columns]')
    expect(has(cols, 'grid', 'min-h-0'), 'columns grid can shrink').toBe(true)
    expect(cols!.className, 'the implicit row must be minmax(0,1fr), an auto row grows with content and nothing scrolls').toContain('grid-rows-[minmax(0,1fr)]')
    expect(cols!.parentElement).toBe(root) // direct grid child of the root: it receives the flexible row

    for (const which of ['assets', 'config'] as const) {
      const scroller = container.querySelector(`[data-scroll="${which}"]`)!
      expect(scroller, which).not.toBeNull()
      for (const c of ['min-h-0', 'overflow-y-auto', 'overscroll-contain', 'scroll-token']) expect(has(scroller, c), `${which} scroller needs ${c}`).toBe(true)
      expect(has(scroller, 'overflow-x-hidden'), `${which}: no horizontal scrolling`).toBe(true)
      // Walk up to the columns grid: every wrapper must be able to pass a height down (h-full) or shrink (min-h-0).
      let el: Element | null = scroller.parentElement
      const walked: string[] = []
      while (el && el !== cols) {
        const cls = (el.className ?? '').toString()
        const passes = /\b(h-full|min-h-0|fx-content|flex-1)\b/.test(cls) || el.classList.contains('fx-content')
        walked.push(el.tagName + '.' + cls.slice(0, 40))
        expect(passes, `${which}: ${el.tagName}.${cls} breaks the height chain (${walked.join(' > ')})`).toBe(true)
        el = el.parentElement
      }
      expect(el, `${which} reaches the columns grid`).toBe(cols)
    }
    // The GlassPanel host of each column opts into the fill rule that gives .fx-content a definite height.
    for (const col of ['assets', 'config']) expect(has(container.querySelector(`[data-editor-col="${col}"]`), 'fx-fill', 'min-h-0', 'overflow-hidden'), col).toBe(true)
    // The canvas column scrolls inside itself too.
    const canvas = container.querySelector('[data-editor-col="canvas"]')!
    expect(has(canvas, 'min-h-0', 'flex-col')).toBe(true)
    expect(container.querySelector('[data-artboard-viewport]')!.className).toMatch(/overflow-auto/)
  })
})
