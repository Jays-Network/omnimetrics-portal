import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { resetMockAdmin } from '@/lib/portal/mock/admin-store'

// Route-level enforcement. The mock maps the REAL session role admin -> director; the dev preview cookie can only
// reduce it, so "org admin", "builder" and "viewer" are exercised through that cookie, exactly as in the browser.
let session: { id: string; username: string; email: string; role: 'admin' | 'builder' | 'viewer' } | null = null
let preview: string | undefined
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (k === 'omni_preview_role' && preview ? { value: preview } : undefined) }) }))
vi.mock('@/lib/auth', () => ({ getCurrentUser: async () => session }))

const SECRET = 'route-level-secret-7731'
const P = (slug: string) => ({ params: Promise.resolve({ orgSlug: slug }) })
const post = (body: unknown, ct = 'application/json') => new NextRequest('http://localhost/x', { method: 'POST', headers: { 'content-type': ct }, body: JSON.stringify(body) })
const save = { op: 'save', input: { name: 'Route src', kind: 'postgres', host: 'db.mock-wr.internal', port: 5432, database: 'wr_x', relations: ['reporting'], sslMode: 'verify-full', credentials: SECRET } }

beforeEach(() => { resetMockAdmin(); session = { id: 'real-1', username: 'jay', email: 'j@mock.invalid', role: 'admin' }; preview = undefined })

describe('integrations route', () => {
  it('401 without a session', async () => {
    session = null
    const { GET } = await import('@/app/api/portal/o/[orgSlug]/integrations/route')
    expect((await GET(new NextRequest('http://localhost/x'), P('worldrisk'))).status).toBe(401)
  })
  it('builders and viewers get 404 (the section is not confirmed), on read and write', async () => {
    const { GET, POST } = await import('@/app/api/portal/o/[orgSlug]/integrations/route')
    for (const p of ['builder', 'viewer']) {
      preview = p
      expect((await GET(new NextRequest('http://localhost/x'), P('worldrisk'))).status, p).toBe(404)
      expect((await POST(post(save), P('worldrisk'))).status, p).toBe(404)
    }
  })
  it('an unknown organisation is 404 for the director too, never 403', async () => {
    const { GET } = await import('@/app/api/portal/o/[orgSlug]/integrations/route')
    expect((await GET(new NextRequest('http://localhost/x'), P('nope'))).status).toBe(404)
  })
  it('an org admin lists and saves, the response never contains the secret, hosts are director-only (403)', async () => {
    preview = 'admin'
    const { GET, POST } = await import('@/app/api/portal/o/[orgSlug]/integrations/route')
    const saved = await POST(post(save), P('worldrisk'))
    expect(saved.status).toBe(200)
    const texts = [await saved.text(), await (await GET(new NextRequest('http://localhost/x'), P('worldrisk'))).text()]
    for (const t of texts) expect(t).not.toContain(SECRET)
    expect(JSON.parse(texts[1]!).canManageHosts).toBe(false)
    const host = await POST(post({ op: 'host.add', host: { host: 'x.example.test', portMin: 1, portMax: 2 } }), P('worldrisk'))
    expect(host.status).toBe(403)
    const bad = await POST(post({ ...save, input: { ...save.input, host: 'not-allowed.example' } }), P('worldrisk'))
    expect(bad.status).toBe(400)
    expect(await bad.text()).not.toContain(SECRET)
  })
  it('the director adds a host; wrong content type is 415; extra fields are 400', async () => {
    const { POST } = await import('@/app/api/portal/o/[orgSlug]/integrations/route')
    expect((await POST(post({ op: 'host.add', host: { host: 'ok.mock.internal', portMin: 5432, portMax: 5432 } }), P('worldrisk'))).status).toBe(200)
    expect((await POST(post(save, 'text/plain'), P('worldrisk'))).status).toBe(415)
    expect((await POST(post({ ...save, extra: 1 }), P('worldrisk'))).status).toBe(400)
  })
  it('the sixth test in a minute is 429', async () => {
    const { POST } = await import('@/app/api/portal/o/[orgSlug]/integrations/route')
    let last = 0
    for (let i = 0; i < 6; i++) last = (await POST(post({ op: 'test', id: 'int-wr-1' }), P('worldrisk'))).status
    expect(last).toBe(429)
  })
  it('another organisation\'s integration id is 404 through the route', async () => {
    const { POST } = await import('@/app/api/portal/o/[orgSlug]/integrations/route')
    expect((await POST(post({ op: 'test', id: 'int-wr-1' }), P('adars'))).status).toBe(404)
  })
})

describe('admin and settings routes', () => {
  it('admin routes are 404 for builders and viewers', async () => {
    const users = await import('@/app/api/portal/o/[orgSlug]/admin/users/route')
    const accounts = await import('@/app/api/portal/o/[orgSlug]/admin/accounts/route')
    const orgs = await import('@/app/api/portal/o/[orgSlug]/admin/organisations/route')
    for (const p of ['builder', 'viewer']) {
      preview = p
      expect((await users.GET(new NextRequest('http://localhost/x'), P('worldrisk'))).status, p).toBe(404)
      expect((await accounts.GET(new NextRequest('http://localhost/x'), P('worldrisk'))).status, p).toBe(404)
      expect((await orgs.POST(post({ op: 'create', name: 'Nope' }), P('worldrisk'))).status, p).toBe(404)
    }
  })
  it('an org admin cannot create organisations (403) and the director can', async () => {
    const orgs = await import('@/app/api/portal/o/[orgSlug]/admin/organisations/route')
    preview = 'admin'
    expect((await orgs.POST(post({ op: 'create', name: 'Third Org' }), P('worldrisk'))).status).toBe(403)
    preview = undefined
    expect((await orgs.POST(post({ op: 'create', name: 'Third Org' }), P('worldrisk'))).status).toBe(200)
  })
  it('everyone may read settings and set their own; only the right roles set org and system', async () => {
    const { GET, PUT } = await import('@/app/api/portal/o/[orgSlug]/settings/route')
    const put = (scope: string) => PUT(new NextRequest('http://localhost/x', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope, set: { timeFormat: '12' } }) }), P('worldrisk'))
    preview = 'viewer'
    expect((await GET(new NextRequest('http://localhost/x'), P('worldrisk'))).status).toBe(200)
    expect((await put('user')).status).toBe(200)
    expect((await put('org')).status).toBe(403)
    expect((await put('system')).status).toBe(403)
    preview = 'admin'
    expect((await put('org')).status).toBe(200)
    expect((await put('system')).status).toBe(403)
    preview = undefined
    expect((await put('system')).status).toBe(200)
  })
})
