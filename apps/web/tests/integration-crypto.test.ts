// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialError, decrypt, encrypt, parseKeyRing } from '@/lib/integrations/crypto'

const K1 = randomBytes(32).toString('base64')
const K2 = randomBytes(32).toString('base64')
const SENTINEL = 'sentinel-PASSWORD-9c1e77aa'
const credential = { username: 'reader', password: SENTINEL }
const bind = { orgId: 'org-a', integrationId: 'int-1' }
const ring = (value: string) => vi.stubEnv('INTEGRATION_KEYS', value)
const flip = (b: Buffer, at: number) => {
  const out = Buffer.from(b)
  out[at] = out[at]! ^ 1
  return out
}

beforeEach(() => ring(`k1:${K1}`))
afterEach(() => vi.unstubAllEnvs())

describe('credential encryption', () => {
  it('round trip; a 12-byte nonce; the tag is appended; the key id is the first entry', () => {
    const sealed = encrypt(credential, bind)
    expect(sealed.keyId).toBe('k1')
    expect(sealed.nonce).toHaveLength(12)
    expect(sealed.ciphertext).toHaveLength(JSON.stringify(credential).length + 16)
    expect(sealed.ciphertext.toString('utf8')).not.toContain(SENTINEL)
    expect(decrypt(sealed, bind)).toEqual(credential)
  })

  it.each([
    ['tampered ciphertext', (s: ReturnType<typeof encrypt>) => ({ ...s, ciphertext: flip(s.ciphertext, 0) }), bind],
    ['tampered tag', (s: ReturnType<typeof encrypt>) => ({ ...s, ciphertext: flip(s.ciphertext, s.ciphertext.length - 1) }), bind],
    ['tampered nonce', (s: ReturnType<typeof encrypt>) => ({ ...s, nonce: flip(s.nonce, 0) }), bind],
    ['short nonce', (s: ReturnType<typeof encrypt>) => ({ ...s, nonce: s.nonce.subarray(1) }), bind],
    ['truncated ciphertext', (s: ReturnType<typeof encrypt>) => ({ ...s, ciphertext: s.ciphertext.subarray(0, 16) }), bind],
    ['unknown key id', (s: ReturnType<typeof encrypt>) => ({ ...s, keyId: 'k9' }), bind],
    ['wrong organisation', (s: ReturnType<typeof encrypt>) => s, { ...bind, orgId: 'org-b' }],
    ['wrong integration', (s: ReturnType<typeof encrypt>) => s, { ...bind, integrationId: 'int-2' }],
  ])('%s fails with the one generic error', (_label, change, binding) => {
    const sealed = encrypt(credential, bind)
    expect(() => decrypt(change(sealed), binding)).toThrow(new CredentialError())
  })

  it('rotation: the old key still decrypts, new writes use the first entry', () => {
    const old = encrypt(credential, bind)
    ring(`k2:${K2},k1:${K1}`)
    expect(decrypt(old, bind)).toEqual(credential)
    const fresh = encrypt(credential, bind)
    expect(fresh.keyId).toBe('k2')
    ring(`k2:${K2}`)
    expect(decrypt(fresh, bind)).toEqual(credential)
    expect(() => decrypt(old, bind)).toThrow(CredentialError)
  })

  it('validates the plaintext on the way in and on the way out', () => {
    for (const bad of [{ username: '', password: 'x' }, { username: 'u' }, { ...credential, extra: 1 }]) {
      expect(() => encrypt(bad as never, bind)).toThrow(CredentialError)
    }
  })

  it.each([
    '', ' ', 'k1', `:${K1}`, 'k1:', `K1:${K1}`, `k 1:${K1}`, `${'a'.repeat(33)}:${K1}`, `k1:${K1}:extra`, `k1:${K1},`, `k1:${K1},k1:${K2}`,
    `k1:${randomBytes(31).toString('base64')}`, `k1:${randomBytes(33).toString('base64')}`, `k1:${K1.slice(0, -1)}`, `k1:!${K1.slice(1)}`,
  ])('refuses the ring %#', (raw) => {
    expect(() => parseKeyRing(raw)).toThrow(new CredentialError())
  })

  it('accepts several entries with spaces around them', () => {
    expect([...parseKeyRing(` k_1:${K1} , k-2:${K2} `).keys.keys()]).toEqual(['k_1', 'k-2'])
  })

  it('never repeats a nonce', () => {
    const nonces = new Set(Array.from({ length: 5_000 }, () => encrypt(credential, bind).nonce.toString('hex')))
    expect(nonces.size).toBe(5_000)
  })

  it('no error carries the secret, the key, the ciphertext or the nonce', () => {
    const sealed = encrypt(credential, bind)
    const secrets = [SENTINEL, Buffer.from(SENTINEL).toString('base64'), K1, sealed.ciphertext.toString('base64'), sealed.ciphertext.toString('hex'), sealed.nonce.toString('hex'), sealed.nonce.toString('base64')]
    const attempts: (() => unknown)[] = [
      () => parseKeyRing(`k1:${K1}:${SENTINEL}`),
      () => parseKeyRing(`${SENTINEL}:${K1}`),
      () => encrypt({ username: 'u', password: SENTINEL, extra: SENTINEL } as never, bind),
      () => decrypt({ ...sealed, keyId: SENTINEL }, bind),
      () => decrypt(sealed, { orgId: SENTINEL, integrationId: 'x' }),
      () => decrypt({ ...sealed, ciphertext: flip(sealed.ciphertext, 0) }, bind),
    ]
    for (const attempt of attempts) {
      let thrown: unknown
      try { attempt() } catch (e) { thrown = e }
      expect(thrown).toBeInstanceOf(CredentialError)
      const e = thrown as Error
      const text = [e.message, e.stack, String(e), JSON.stringify(e, Object.getOwnPropertyNames(e))].join('\n')
      for (const secret of secrets) expect(text).not.toContain(secret)
      expect((e as { cause?: unknown }).cause).toBeUndefined()
    }
  })

  it("no 'use client' module imports the server-only integration code", () => {
    const root = path.resolve(__dirname, '..')
    const files = ['app', 'components', 'lib'].flatMap((dir) =>
      readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(root, dir, f)),
    )
    const client = files.filter((f) => /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')))
    expect(client.length).toBeGreaterThan(5)
    for (const f of client) expect(readFileSync(f, 'utf8'), f).not.toMatch(/lib\/integrations|portal\/pg/)
  })
})
