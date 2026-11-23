import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { PAGE_FILL, PageTransition } from '@/components/fx/page-transition'
import { shellClasses } from '@/components/shell/editor-shell'

const ROOT = path.join(__dirname, '..')
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const FILL = ['h-full', 'min-h-0']
const hasFill = (cls: string) => FILL.every((c) => cls.split(/\s+/).includes(c)) || ['flex-1', 'min-h-0'].every((c) => cls.split(/\s+/).includes(c))

let level = 'off'
vi.mock('@/components/fx/use-fx', () => ({ useFxLevel: () => level }))

/*
 * The real editor route is app/dashboard/o/[orgSlug]/d/[nodeId]/edit/page.tsx. Its wrappers, outside in:
 * app/dashboard/layout.tsx (MotionRoot > AppShell > <main>), app/dashboard/template.tsx (PageTransition).
 * If any link stops passing a definite height down, the editor columns stop scrolling. Fail loudly here.
 */
describe('real editor route keeps the fill chain', () => {
  it('no layout or template between /dashboard and the edit page can break the chain', () => {
    const dirs = ['app/dashboard', 'app/dashboard/o', 'app/dashboard/o/[orgSlug]', 'app/dashboard/o/[orgSlug]/d', 'app/dashboard/o/[orgSlug]/d/[nodeId]', 'app/dashboard/o/[orgSlug]/d/[nodeId]/edit']
    const files = dirs.flatMap((d) => ['layout.tsx', 'template.tsx'].map((f) => `${d}/${f}`)).filter((f) => fs.existsSync(path.join(ROOT, f)))
    expect(files).toEqual(['app/dashboard/layout.tsx', 'app/dashboard/template.tsx', 'app/dashboard/o/[orgSlug]/layout.tsx']) // a new wrapper here must be reviewed, then listed
    expect(src('app/dashboard/layout.tsx')).toMatch(/<MotionRoot>[\s\S]*<AppShell[\s\S]*\{children\}[\s\S]*<\/AppShell>/)
    expect(src('app/dashboard/layout.tsx')).not.toMatch(/className=/) // the layout adds no wrapper element of its own
    expect(src('app/dashboard/template.tsx')).toMatch(/<PageTransition>\{children\}<\/PageTransition>/)
    expect(src('app/dashboard/template.tsx')).not.toMatch(/className=/)
    // The org layout only provides settings context: no element of its own, so no height can be lost.
    const org = src('app/dashboard/o/[orgSlug]/layout.tsx')
    expect(org).toMatch(/<FormatProvider[^>]*>\{children\}<\/FormatProvider>/)
    expect(org).not.toMatch(/className=|<div|<main|<section/)
  })

  it('PageTransition passes the fill classes through at every effects level', () => {
    expect(hasFill(PAGE_FILL)).toBe(true)
    for (const lv of ['off', 'reduced', 'full']) {
      level = lv
      const { container, unmount } = render(<PageTransition><i /></PageTransition>)
      expect(hasFill((container.firstElementChild as HTMLElement).className), `level ${lv}`).toBe(true)
      unmount()
    }
  })

  it('AppShell <main> is a flex-1 min-h-0 child in edit mode', () => {
    expect(src('components/shell/app-shell.tsx')).toMatch(/<main className=\{cn\('min-w-0 flex-1', shell\.main\)\}>/)
    expect(shellClasses(true).main).toContain('min-h-0')
  })

  it('/dev/editor uses the real modules, not copies', () => {
    const layout = src('app/dev/editor/layout.tsx')
    expect(layout).toContain("from '@/components/fx/motion-root'")
    expect(layout).toContain("from '@/components/shell/app-shell'")
    expect(src('app/dev/editor/template.tsx')).toContain("from '@/app/dashboard/template'")
  })
})
