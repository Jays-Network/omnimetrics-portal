// @vitest-environment node
import { createServer, type Socket } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { portalDbHosts, reservedHost, resolveTarget, type GuardDeps } from '@/lib/integrations/target-guard'
import { connectPostgres, connectionOptions, probe, type Target } from '@/lib/integrations/test-connection'
import { MAX_ORG_TESTS_PER_MINUTE, MAX_TESTS_PER_MINUTE, integrationTestKey, orgTestLimit, withRateLimit } from '@/lib/rate-limit'

// Where a stored integration may point, with an injected resolver; and that the driver really connects to the
// checked address while still naming the configured host in TLS (loopback only, no network).

const answers = (map: Record<string, string[]>): GuardDeps['resolve'] => async (host) => {
  const found = map[host]
  if (!found) throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' })
  return found
}
const deps = (map: Record<string, string[]> = {}, env: Record<string, string> = {}): GuardDeps => ({ resolve: answers(map), env, localAddresses: () => ['192.168.15.32', 'fd12::5'] })

describe('reserved hosts (the configured text)', () => {
  it('loopback, unspecified, link-local, metadata and this machine in any spelling', () => {
    for (const host of ['localhost', 'LocalHost', 'localhost.', 'db.localhost', '127.0.0.1', '127.200.0.9', '127.1', '2130706433', '0x7f000001', '::1', '[::1]', '0:0:0:0:0:0:0:1', '0.0.0.0', '::', '::ffff:127.0.0.1', '169.254.0.1', '169.254.169.254', 'fe80::abcd', 'FE80::1%eth0', 'fd00:ec2::254', '192.168.15.32', 'fd12::5', '']) {
      expect(reservedHost(host, deps()), host).toBe(true)
    }
    for (const host of ['db.example.test', '203.0.113.7', '192.168.15.33', '10.0.0.5', '2001:db8::1', 'localhost.evil.test']) expect(reservedHost(host, deps()), host).toBe(false)
  })

  it("the portal database's host, whatever the port or database; unreadable settings refuse everything", () => {
    const env = { DATABASE_URL: 'postgresql://portal_app:p%40ss@DB.Internal.example:5433/omnimetrics_portal', DATABASE_URL_PLATFORM: 'postgresql://portal_platform:x@10.1.2.3/omnimetrics_portal' }
    expect(portalDbHosts(env)).toEqual(['db.internal.example', '10.1.2.3'])
    for (const host of ['db.internal.example', 'DB.INTERNAL.EXAMPLE.', '10.1.2.3']) expect(reservedHost(host, deps({}, env)), host).toBe(true)
    expect(reservedHost('other.internal.example', deps({}, env))).toBe(false)
    for (const url of ['postgresql://u:p@127.0.0.1/d', 'postgresql://u:p@[::1]:5432/d', 'postgresql:///d', 'postgresql://u:p@/d?host=/var/run/postgresql']) {
      expect(reservedHost('localhost', deps({}, { DATABASE_URL: url })), url).toBe(true)
    }
    expect(portalDbHosts({ DATABASE_URL: 'postgresql:///d' })).toEqual(['localhost'])
    expect(portalDbHosts({})).toEqual([])
  })
})

describe('resolved addresses', () => {
  it.each([
    ['localhost', {}],
    ['sneaky.example.test', { 'sneaky.example.test': ['127.0.0.1'] }],
    ['meta.example.test', { 'meta.example.test': ['169.254.169.254'] }],
    ['six.example.test', { 'six.example.test': ['::1'] }],
    ['mapped.example.test', { 'mapped.example.test': ['::ffff:127.0.0.1'] }],
    ['mine.example.test', { 'mine.example.test': ['192.168.15.32'] }],
    ['mixed.example.test', { 'mixed.example.test': ['203.0.113.7', '127.0.0.1'] }],
  ])('%s is refused', async (host, map) => {
    expect(await resolveTarget(host, deps(map as Record<string, string[]>))).toEqual({ ok: false })
  })

  it('a normal address is allowed and returned (IPv4 first), resolved exactly once', async () => {
    const resolve = vi.fn(async () => ['2001:db8::1', '203.0.113.7'])
    expect(await resolveTarget('db.example.test', { ...deps(), resolve })).toEqual({ ok: true, address: '203.0.113.7' })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(await resolveTarget('203.0.113.9', { ...deps(), resolve })).toEqual({ ok: true, address: '203.0.113.9' })
    expect(resolve).toHaveBeenCalledTimes(1) // an address needs no lookup
  })

  it("another name for the portal database's server is refused; if that server cannot be resolved, everything is", async () => {
    const env = { DATABASE_URL: 'postgresql://a:b@pg.internal.example/omnimetrics_portal' }
    const map = { 'pg.internal.example': ['10.9.9.9'], 'alias.example.test': ['10.9.9.9'], 'db.example.test': ['203.0.113.7'] }
    expect(await resolveTarget('alias.example.test', deps(map, env))).toEqual({ ok: false })
    expect(await resolveTarget('10.9.9.9', deps(map, env))).toEqual({ ok: false })
    expect(await resolveTarget('db.example.test', deps(map, env))).toEqual({ ok: true, address: '203.0.113.7' })
    expect(await resolveTarget('db.example.test', deps({ 'db.example.test': ['203.0.113.7'] }, env))).toEqual({ ok: false })
  })

  it('a name that does not resolve is an error with the resolver code', async () => {
    await expect(resolveTarget('gone.example.test', deps())).rejects.toMatchObject({ code: 'ENOTFOUND' })
    await expect(resolveTarget('empty.example.test', deps({ 'empty.example.test': [] }))).rejects.toMatchObject({ code: 'ENOTFOUND' })
  })
})

describe('connecting to the checked address', () => {
  const target: Target = { host: 'db.example.test', address: '203.0.113.7', port: 5432, database: 'd', username: 'u', password: 'p', sslMode: 'verify-full' }

  it('the driver gets the address; TLS gets the configured name', () => {
    expect(connectionOptions(target)).toMatchObject({ host: ['203.0.113.7'], port: [5432], ssl: { rejectUnauthorized: true, host: 'db.example.test', servername: 'db.example.test' } })
    expect(connectionOptions({ ...target, sslMode: 'verify-ca' }).ssl).toMatchObject({ rejectUnauthorized: true, servername: 'db.example.test' })
    expect(connectionOptions({ ...target, sslMode: 'require' }).ssl).toEqual({ rejectUnauthorized: false, servername: 'db.example.test' })
    expect(connectionOptions({ ...target, sslMode: 'disable' }).ssl).toBe(false)
    // an IP address is never sent as a server name
    expect(connectionOptions({ ...target, host: '203.0.113.7' }).ssl).toEqual({ rejectUnauthorized: true, host: '203.0.113.7' })
    expect(connectionOptions({ ...target, host: '203.0.113.7', sslMode: 'require' }).ssl).toBe('require')
  })

  it.each(['verify-full', 'require'])('%s: the real driver dials the address without looking the name up, and the handshake names the host', async (sslMode) => {
    let hello = Buffer.alloc(0)
    const sockets: Socket[] = []
    const server = createServer((socket) => {
      sockets.push(socket)
      socket.once('data', () => {
        socket.write('S') // "TLS is fine": the next bytes are the ClientHello, whose server name is readable
        socket.once('data', (data) => ((hello = data), socket.destroy()))
      })
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as { port: number }
    // .invalid never resolves: reaching the server at all proves no second lookup happened.
    const outcome = await probe({ ...target, host: 'pinned.example.invalid', address: '127.0.0.1', port, sslMode }, connectPostgres)
    sockets.forEach((s) => s.destroy())
    server.close()
    expect(outcome.ok).toBe(false)
    expect(hello.includes('pinned.example.invalid')).toBe(true)
  })
})

describe('organisation test limit', () => {
  it('20 per minute across all its integrations, and 10 per integration; refusals take no slot', async () => {
    let t = 5_000_000
    const run = vi.fn(async () => 'done')
    const go = (org: string, id: string) => withRateLimit(integrationTestKey(org, id), run, () => t, orgTestLimit(org))
    for (let i = 0; i < MAX_TESTS_PER_MINUTE + 5; i++) await go('lim-a', 'one') // the 5 refused ones cost nothing
    expect(run).toHaveBeenCalledTimes(MAX_TESTS_PER_MINUTE)
    expect(await go('lim-a', 'one')).toEqual({ limited: true, retryAfter: 60 })
    for (let i = 0; i < MAX_ORG_TESTS_PER_MINUTE - MAX_TESTS_PER_MINUTE; i++) expect((await go('lim-a', 'two')).limited).toBe(false)
    expect(await go('lim-a', 'three')).toEqual({ limited: true, retryAfter: 60, shared: true })
    expect((await go('lim-b', 'three')).limited).toBe(false)
    t += 60_000
    expect((await go('lim-a', 'three')).limited).toBe(false)
  })
})
