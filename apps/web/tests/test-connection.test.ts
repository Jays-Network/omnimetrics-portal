// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { categorise, connectionOptions, envCredential, probe, type Target } from '@/lib/integrations/test-connection'
import { MAX_TESTS_PER_MINUTE, integrationTestKey, withRateLimit } from '@/lib/rate-limit'
import { safeDetail } from '@/lib/audit'

// The connector without a network: options, error categories, the injected driver and the limit.

const target: Target = { host: 'db.example.test', port: 5432, database: 'd', username: 'reader', password: 'pw-sentinel', sslMode: 'verify-full' }
const code = (c: string, message = 'driver says: host db.example.test user reader') => Object.assign(new Error(message), { code: c })
afterEach(() => vi.restoreAllMocks())

describe('connection options', () => {
  it('TLS is exactly what ssl_mode says', () => {
    const ssl = (sslMode: string, host = target.host) => connectionOptions({ ...target, sslMode, host }).ssl
    expect(ssl('disable')).toBe(false)
    expect(ssl('require')).toBe('require')
    expect(ssl('verify-full')).toEqual({ rejectUnauthorized: true, host: target.host })
    expect(ssl('verify-full', '203.0.113.7')).toEqual({ rejectUnauthorized: true, host: '203.0.113.7' })
    const ca = ssl('verify-ca') as { rejectUnauthorized: boolean; checkServerIdentity: () => unknown }
    expect(ca.rejectUnauthorized).toBe(true)
    expect(ca.checkServerIdentity()).toBeUndefined()
    for (const unknown of ['prefer', 'allow', '', 'VERIFY-FULL']) expect(() => ssl(unknown), unknown).toThrow()
  })

  it('one connection, 5 s connect and statement timeouts', () => {
    expect(connectionOptions(target)).toMatchObject({ max: 1, connect_timeout: 5, connection: { statement_timeout: 5000 } })
  })

  it('refuses hosts the driver would read as something else, and never lets the driver fill in a password', () => {
    for (const host of ['a:6000', 'a,b', '/var/run/postgresql', 'a b', '']) expect(() => connectionOptions({ ...target, host }), host).toThrow()
    expect(() => connectionOptions({ ...target, password: '' })).toThrow()
    expect(() => connectionOptions({ ...target, username: '' })).toThrow()
  })
})

describe('probe with an injected connector', () => {
  it('success: latency and a version number only', async () => {
    const connect = vi.fn(async () => ({ serverVersion: '18.1 (Ubuntu) host=secret' }))
    expect(await probe(target, connect)).toEqual({ ok: true, latencyMs: expect.any(Number), serverVersion: '18.1' })
    expect(connect).toHaveBeenCalledWith(target)
    expect(await probe(target, async () => ({ serverVersion: 'evil text' }))).toEqual({ ok: true, latencyMs: expect.any(Number) })
  })

  it.each([
    ['ENOTFOUND', 'dns'], ['EAI_AGAIN', 'dns'], ['ECONNREFUSED', 'refused'], ['CONNECT_TIMEOUT', 'timeout'], ['57014', 'timeout'],
    ['28P01', 'auth'], ['28000', 'auth'], ['SASL_SIGNATURE_MISMATCH', 'auth'], ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'], ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls'], ['ECONNRESET', 'tls'], ['3D000', 'other'],
  ])('%s -> %s, and nothing of the driver message', async (driverCode, category) => {
    const log = vi.spyOn(console, 'error')
    const warn = vi.spyOn(console, 'log')
    const outcome = await probe(target, async () => { throw code(driverCode) })
    expect(outcome).toEqual({ ok: false, category })
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('a dropped connection without TLS is not called a TLS failure; a thrown non-error is other', () => {
    expect(categorise(code('ECONNRESET'), 'disable')).toBe('other')
    expect(categorise(null, 'disable')).toBe('other')
  })
})

describe('managed sources', () => {
  const env = { DATABASE_URL_READONLY_WR: 'postgresql://reader:p%40ss@elsewhere.example:6000/x', JWT_SECRET: 'postgresql://a:b@h/d', DATABASE_URL_READONLY_BAD: 'not a url' }
  it('reads only a variable matching the CHECK pattern, and takes user and password from it', () => {
    expect(envCredential('env:DATABASE_URL_READONLY_WR', env)).toEqual({ username: 'reader', password: 'p@ss' })
    for (const source of ['env:JWT_SECRET', 'env:INTEGRATION_KEYS', 'env:DATABASE_URL_READONLY_WR ', 'DATABASE_URL_READONLY_WR', 'env:DATABASE_URL_READONLY_BAD', 'env:DATABASE_URL_READONLY_MISSING', 'stored']) {
      expect(envCredential(source, env), source).toBeNull()
    }
  })
})

describe('test rate limit', () => {
  it('10 per minute per organisation and integration, every run counted, parallel runs included', async () => {
    let t = 1_000_000
    const run = vi.fn(async () => 'done')
    const go = (key: string) => withRateLimit(key, run, () => t)
    const key = integrationTestKey('org-1', 'int-1')
    const all = await Promise.all(Array.from({ length: MAX_TESTS_PER_MINUTE + 3 }, () => go(key)))
    expect(all.filter((r) => r.limited)).toHaveLength(3)
    expect(run).toHaveBeenCalledTimes(MAX_TESTS_PER_MINUTE)
    expect(await go(key)).toEqual({ limited: true, retryAfter: 60 })
    expect((await go(integrationTestKey('org-2', 'int-1'))).limited).toBe(false)
    expect((await go(integrationTestKey('org-1', 'int-2'))).limited).toBe(false)
    t += 60_000
    expect((await go(key)).limited).toBe(false)
  })
})

describe('audit detail', () => {
  it('keeps the yes/no flag and still removes secret strings under secret-looking names', () => {
    expect(safeDetail({ credentialReplaced: true, credential: 'abc', password: 'x', fields: ['host'] })).toMatchObject({ credentialReplaced: true, password: '[redacted]', fields: ['host'] })
    expect(JSON.stringify(safeDetail({ credential: 'abc' }))).not.toContain('abc')
  })
})
