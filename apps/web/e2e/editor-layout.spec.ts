import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// Fixed-viewport editor layout, measured in a real browser (jsdom has no layout engine).
// Target: /dev/editor (mock data, 404 in production) on the dev server.
const VIEWPORTS = [
  { w: 1920, h: 1080 },
  { w: 1366, h: 768 },
  { w: 1024, h: 768 },
]
const SCALES = [0.5, 1, 1.5]
const SHOTS = path.join(__dirname, 'screenshots')
const TOL = 1 // sub-pixel rounding

async function open(page: Page) {
  page.on('pageerror', (e) => console.log('PAGEERROR ' + e.message.slice(0, 300)))
  page.on('console', (c) => c.type() === 'error' && console.log('CONSOLE ' + c.text().slice(0, 300)))
  page.on('response', (r) => r.status() >= 500 && console.log('HTTP' + r.status() + ' ' + r.url()))
  await page.goto('/dev/editor')
  await page.waitForSelector('[data-editor-root]', { timeout: 60_000 }).catch(async (e) => {
    console.log('NOROOT body: ' + (await page.evaluate(() => document.body.innerText.slice(0, 300))))
    throw e
  })
  await page.waitForSelector('[data-panel-id]')
  await page.evaluate(() => document.fonts.ready)
}

for (const vp of VIEWPORTS) {
  for (const dsf of SCALES) {
    test.describe(`${vp.w}x${vp.h} @${dsf}x`, () => {
      test.use({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: dsf })

      test('editor fits the viewport and every column scrolls to its end', async ({ page }) => {
        fs.mkdirSync(SHOTS, { recursive: true })
        const tag = `${vp.w}x${vp.h}@${dsf}`
        await open(page)
        const m: Record<string, number | string> = { tag }
        try {

        // 1. The page never scrolls; the editor root ends at the viewport bottom.
        const frame = await page.evaluate(() => {
          const se = document.scrollingElement!
          const root = document.querySelector('[data-editor-root]')!.getBoundingClientRect()
          const main = document.querySelector('main')!.getBoundingClientRect()
          return { scrollH: se.scrollHeight, clientH: se.clientHeight, innerH: window.innerHeight, rootBottom: root.bottom, rootH: root.height, mainH: main.height, mainBottom: main.bottom, mainPadB: parseFloat(getComputedStyle(document.querySelector('main')!).paddingBottom) }
        })
        Object.assign(m, frame)
        expect(frame.scrollH, 'page scrollHeight == clientHeight').toBe(frame.clientH)
        // <main> has p-3, so "the editor ends at the viewport bottom" means: at the bottom of main's content box,
        // and main itself ends at the viewport bottom.
        expect(Math.abs(frame.mainBottom - frame.innerH), '<main> bottom == viewport bottom').toBeLessThanOrEqual(TOL)
        expect(Math.abs(frame.rootBottom - (frame.mainBottom - frame.mainPadB)), 'editor root bottom == main content bottom').toBeLessThanOrEqual(TOL)

        // 2. Terminal dock: fully visible when open.
        const term = page.getByLabel('SQL terminal')
        await expect(term).toBeVisible()
        const open0 = await term.getByRole('button', { name: /SQL terminal/ }).getAttribute('aria-expanded')
        if (open0 !== 'true') await term.getByRole('button', { name: /SQL terminal/ }).click()
        const tb = await term.boundingBox()
        m.termTop = tb!.y; m.termBottom = tb!.y + tb!.height
        expect(tb!.y + tb!.height, 'terminal bottom within viewport').toBeLessThanOrEqual(vp.h + TOL)
        expect(tb!.y, 'terminal top within viewport').toBeGreaterThanOrEqual(0)

        // 3. Left column: each category in turn (the accordion allows one open at a time), scroll to the end,
        //    the last asset must be fully inside the scroller. The tallest category must actually overflow.
        const cats = await page.locator('[id^="assets-"][aria-expanded]').evaluateAll((els) => els.map((e) => e.id))
        let maxOverflow = -1
        for (const id of cats) {
          const btn = page.locator(`#${id}`)
          if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click()
          const isLast = id === cats[cats.length - 1]
          // Last category: scrolled to the very bottom its last asset is the last thing in the column.
          // Other categories have more headers below, so reach their last asset by scrolling it into view.
          if (!isLast) await page.locator(`#${id}-panel li`).last().scrollIntoViewIfNeeded()
          const r = await page.evaluate(([cid, bottomOut]) => {
            const sc = document.querySelector<HTMLElement>('[data-scroll="assets"]')!
            const items = document.querySelectorAll(`#${cid}-panel li`)
            if (bottomOut) sc.scrollTop = sc.scrollHeight
            const last = items[items.length - 1]!.getBoundingClientRect()
            const box = sc.getBoundingClientRect()
            return { sh: sc.scrollHeight, ch: sc.clientHeight, lastTop: last.top, lastBottom: last.bottom, top: box.top, bottom: box.bottom }
          }, [id, isLast] as const)
          maxOverflow = Math.max(maxOverflow, r.sh - r.ch)
          if (isLast) Object.assign(m, { assetsScrollH: r.sh, assetsClientH: r.ch })
          expect(r.lastBottom, `${id}: last asset bottom inside the column`).toBeLessThanOrEqual(r.bottom + TOL)
          expect(r.lastTop, `${id}: last asset top inside the column`).toBeGreaterThanOrEqual(r.top - TOL)
        }
        m.assetsMaxOverflow = maxOverflow
        expect(maxOverflow, 'left column overflows (so it must scroll) for the tallest category').toBeGreaterThan(0)

        // 4. Right column: select a chart with many block kinds, add every block, scroll to the last block.
        await page.locator('[data-panel-id="seed-3"]').first().click({ position: { x: 20, y: 20 } })
        const group = page.getByRole('group', { name: 'Add a block' })
        await expect(group).toBeVisible()
        for (let guard = 0; guard < 40; guard++) {
          const chip = group.locator('button:not([aria-disabled="true"])').first()
          if ((await chip.count()) === 0) break
          await chip.click()
        }
        const right = await page.evaluate(() => {
          const sc = document.querySelector<HTMLElement>('[data-scroll="config"]')!
          sc.scrollTop = sc.scrollHeight
          const items = document.querySelectorAll('[aria-label="Block stack"] > li')
          const last = items[items.length - 1]!.getBoundingClientRect()
          const box = sc.getBoundingClientRect()
          return { sh: sc.scrollHeight, ch: sc.clientHeight, blocks: items.length, lastBottom: last.bottom, bottom: box.bottom, top: box.top, lastTop: last.top }
        })
        Object.assign(m, { configScrollH: right.sh, configClientH: right.ch, blocks: right.blocks })
        expect(right.blocks).toBeGreaterThan(1)
        expect(right.lastBottom, 'last block bottom inside the right column').toBeLessThanOrEqual(right.bottom + TOL)
        expect(right.lastTop, 'last block top inside the right column').toBeGreaterThanOrEqual(right.top - TOL)

        // 5. Every panel sits inside the artboard.
        const out = await page.evaluate(() => {
          const art = document.querySelector('[data-artboard]')!.getBoundingClientRect()
          return [...document.querySelectorAll<HTMLElement>('[data-artboard] [data-panel-id]')]
            .map((el) => ({ id: el.dataset.panelId, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.left < art.left - 1 || r.top < art.top - 1 || r.right > art.right + 1 || r.bottom > art.bottom + 1)
            .map((x) => x.id)
        })
        expect(out, 'panels outside the artboard').toEqual([])

        } finally {
          await page.screenshot({ path: path.join(SHOTS, `${tag}.png`) }).catch(() => {})
          console.log('LAYOUT ' + JSON.stringify(m))
        }
      })
    })
  }
}
