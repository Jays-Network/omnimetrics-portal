import { expect, test, type Page } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'

// M4 pages in a real browser at 1366x768: the page never scrolls, every internal scroller reaches its last row.
// Targets /dev/pages/<name> (the real views, real shell chain, no auth, 404 in production). The API is fulfilled with
// canned JSON here, so this checks layout only; access rules are covered by tests/admin-routes.test.ts.
test.use({ viewport: { width: 1366, height: 768 } })
const TOL = 1

const members = Array.from({ length: 24 }, (_, i) => ({ userId: `u-${i}`, username: `person.${i}.mock`, email: `p${i}@mock.invalid`, role: ['admin', 'builder', 'viewer'][i % 3], active: i % 5 !== 0, isPlatform: i === 0, grantsSummary: 'View: Fleet Operations', trackingFolders: i % 3 === 0 ? null : ['Mock Fleet North', 'Mock Fleet South'] }))
const sessions = Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, userId: 'u-1', device: `Browser ${i} on Linux`, ip: '10.0.0.x', startedAt: '2026-11-20T08:00:00Z', lastSeenAt: '2026-11-23T08:00:00Z', current: i === 0 }))
const rows = Array.from({ length: 14 }, (_, i) => ({ usedBy: i, id: `r${i}`, name: `Source ${i}`, kind: 'postgres', host: 'db.mock-wr.internal', port: 5432, database: `db_${i}`, relations: ['reporting'], sslMode: 'verify-full', status: i % 4 === 0 ? 'failed' : 'ok', managed: i === 0, hasCredentials: i !== 0, keyId: i === 0 ? null : 'k1', rotatedAt: '2026-11-01T08:00:00Z', lastTest: { ok: i % 4 !== 0, at: '2026-11-23T07:00:00Z', message: 'x' } }))
const hosts = Array.from({ length: 8 }, (_, i) => ({ id: `h${i}`, host: `host-${i}.mock.internal`, portMin: 5432, portMax: 5432 + i }))
const audit = Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, at: '2026-11-23T07:00:00Z', orgId: 'o', actor: 'jay', action: 'integration.test', targetType: 'integration', targetId: 'r1', detail: '{}' }))
const orgs = Array.from({ length: 12 }, (_, i) => ({ id: `o${i}`, slug: `org-${i}`, name: `Org ${i}`, status: 'active', memberCount: 4, integrationCount: 2, dashboardCount: 5 }))

async function mockApi(page: Page) {
  await page.route('**/api/portal/**', (route) => {
    const u = route.request().url()
    const json = (b: unknown) => route.fulfill({ json: b })
    if (u.includes('/integrations')) return json({ ok: true, rows, hosts, audit, canManageHosts: true })
    if (u.includes('/admin/users')) return json({ ok: true, members, folders: ['Mock Fleet North', 'Mock Fleet South', 'Mock Cross-border', 'Mock Depot Yard', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'] })
    if (u.includes('/admin/accounts') || u.endsWith('/api/portal/account')) return json({ ok: true, sessions })
    if (u.includes('/admin/organisations')) return json({ ok: true, orgs })
    return route.fulfill({ status: 404, json: { error: 'Not found' } })
  })
}

async function open(page: Page, name: string, ready: string) {
  await mockApi(page)
  page.on('response', (r) => r.status() >= 500 && console.log('HTTP' + r.status() + ' ' + r.url()))
  await page.goto(`/dev/pages/${name}`)
  await page.waitForSelector('[data-page-frame]', { timeout: 60_000 })
  await page.waitForSelector(ready, { timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
  // The route enter transition (translateY 12px -> 0) must be finished before anything is measured.
  await page.waitForFunction(() => { for (let e = document.querySelector('[data-page-frame]'); e; e = e.parentElement) { const t = getComputedStyle(e).transform; if (t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)') return false } return true })
}

/** Page never scrolls; every [data-scroll] scroller, scrolled to its end, shows its last child inside its box. */
async function assertFits(page: Page) {
  const frame = await page.evaluate(() => {
    const se = document.scrollingElement!
    const main = document.querySelector('main')!.getBoundingClientRect()
    const root = document.querySelector('[data-page-frame]')!.getBoundingClientRect()
    return { scrollH: se.scrollHeight, clientH: se.clientHeight, innerH: window.innerHeight, mainBottom: main.bottom, rootBottom: root.bottom, padB: parseFloat(getComputedStyle(document.querySelector('main')!).paddingBottom) }
  })
  expect(frame.scrollH, 'page scrollHeight == clientHeight').toBe(frame.clientH)
  expect(Math.abs(frame.mainBottom - frame.innerH), '<main> bottom == viewport bottom').toBeLessThanOrEqual(TOL)
  expect(frame.rootBottom, 'page frame inside main content box').toBeLessThanOrEqual(frame.mainBottom - frame.padB + TOL)
  const res = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-scroll]')].filter((e) => e.getClientRects().length > 0).map((sc) => {
    sc.scrollTop = sc.scrollHeight
    const box = sc.getBoundingClientRect(), last = sc.lastElementChild?.getBoundingClientRect()
    const pg = document.querySelector<HTMLElement>('[data-scroll="page"]') // absent on the catalogue page, whose grid is the only scroller
    const outer = pg && pg !== sc ? pg.getBoundingClientRect() : null
    return { kind: sc.dataset.scroll, h: box.height, bottom: box.bottom, lastBottom: last?.bottom ?? 0, overflow: sc.scrollHeight - sc.clientHeight, inView: box.bottom <= (outer?.bottom ?? 768) + 1 }
  }))
  for (const r of res) {
    expect(r.lastBottom, `${r.kind}: last child reachable`).toBeLessThanOrEqual(r.bottom + TOL)
    expect(r.inView, `${r.kind}: scroller box is not clipped by an ancestor`).toBe(true)
  }
  return res
}

for (const [name, ready, expectOverflow] of [
  ['integrations', 'text=Source 13', true], ['users', 'text=person.23.mock', true], ['accounts', 'text=person.23.mock', true],
  ['orgs', 'text=Org 11', true], ['account', 'text=Browser 13 on Linux', false], ['settings', '[data-sample="date"]', false],
] as const) {
  test(`${name}: no page scroll at 1366x768, scrollers reach their end`, async ({ page }) => {
    await open(page, name, ready)
    const res = await assertFits(page)
    console.log('PAGES ' + JSON.stringify({ name, scrollers: res.map((r) => [r.kind, Math.round(r.h), r.overflow]) }))
    if (expectOverflow) expect(res.some((r) => r.overflow > 0), 'with this much data something must scroll inside the page').toBe(true)
    await page.screenshot({ path: path.join(process.env.LAYOUT_OUT ? path.join(process.env.LAYOUT_OUT, 'screenshots') : path.join(os.tmpdir(), 'omni-e2e', 'screenshots'), `page-${name}.png`) }).catch(() => {})
  })
}

test('integrations catalogue: grid scrolls itself, columns are responsive, every card is keyboard reachable and filters work', async ({ page }) => {
  await open(page, 'integrations', 'text=Source 13')
  const m = await page.evaluate(() => {
    const g = document.querySelector<HTMLElement>('[data-scroll="grid"]')!
    const cols = getComputedStyle(g.querySelector('ul')!).gridTemplateColumns.split(' ').length
    return { cols, overflow: g.scrollHeight - g.clientHeight, cards: g.querySelectorAll('li button').length, minW: Math.min(...[...g.querySelectorAll('li button')].map((b) => b.getBoundingClientRect().width)) }
  })
  console.log('CATALOGUE ' + JSON.stringify(m))
  expect(m.cols).toBeGreaterThanOrEqual(3)
  expect(m.minW).toBeGreaterThanOrEqual(240) // about 16rem minimum
  expect(m.overflow).toBeGreaterThan(0)
  expect(m.cards).toBe(14 + 11)
  // Tab reaches a card and shows a visible focus ring
  await page.locator('[data-connector="telegram"]').focus()
  expect(await page.locator('[data-connector="telegram"]').evaluate((e) => getComputedStyle(e).boxShadow)).not.toBe('none')
  // Filters
  await page.getByLabel('Type').selectOption('notifications')
  await expect(page.locator('[data-connector="telegram"]')).toBeVisible()
  await expect(page.locator('[data-connector="postgres"]')).toHaveCount(0)
  await page.getByLabel('Type').selectOption('all')
  await page.getByLabel(/Search connectors/).fill('zzz-no-match')
  await expect(page.getByText(/No connectors or connections match/)).toBeVisible()
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight === document.scrollingElement!.clientHeight)).toBe(true)
})

test('integrations drawer fits the viewport and scrolls to its last field; Esc closes and returns focus', async ({ page }) => {
  await open(page, 'integrations', 'text=Source 13')
  const add = page.locator('[data-connector="postgres"]')
  await add.click()
  const dlg = page.getByRole('dialog', { name: 'Add integration' })
  await expect(dlg).toBeVisible()
  const m = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')!.getBoundingClientRect()
    const sc = document.querySelector<HTMLElement>('[data-scroll="drawer"]')!
    sc.scrollTop = sc.scrollHeight
    const last = sc.lastElementChild!.getBoundingClientRect(), box = sc.getBoundingClientRect()
    return { top: d.top, bottom: d.bottom, lastBottom: last.bottom, boxBottom: box.bottom }
  })
  expect(m.top).toBeGreaterThanOrEqual(0); expect(m.bottom).toBeLessThanOrEqual(768 + TOL)
  expect(m.lastBottom).toBeLessThanOrEqual(m.boxBottom + TOL)
  await expect(page.getByLabel('Credentials', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
  await expect(add).toBeFocused()
})
