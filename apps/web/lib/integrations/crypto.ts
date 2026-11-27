import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { StoredCredentialSchema, type StoredCredential } from '@/lib/admin/connectors'

/**
 * SERVER ONLY. AES-256-GCM for stored integration credentials.
 *
 * INTEGRATION_KEYS = comma-separated "id:base64" entries, each key 32 bytes, id [a-z0-9_-]{1,32}.
 * The FIRST entry encrypts; every entry decrypts (rotation). Parsed lazily and cached.
 *
 * Every failure is the same CredentialError with the same text and no cause: no key, plaintext,
 * ciphertext or nonce can reach a message or a log through this module.
 */

export class CredentialError extends Error {
  constructor() {
    super('Credential unavailable')
    this.name = 'CredentialError'
  }
}

export interface Sealed { ciphertext: Buffer; nonce: Buffer; keyId: string }
/** What a ciphertext belongs to. Another organisation or another row cannot decrypt it. */
export interface Binding { orgId: string; integrationId: string }

interface KeyRing { primary: string; keys: Map<string, Buffer> }

const NONCE_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

export function parseKeyRing(raw: string | undefined): KeyRing {
  const keys = new Map<string, Buffer>()
  for (const entry of (raw ?? '').split(',')) {
    const [id, encoded, ...rest] = entry.trim().split(':')
    if (!id || !encoded || rest.length || !/^[a-z0-9_-]{1,32}$/.test(id) || keys.has(id)) throw new CredentialError()
    const key = Buffer.from(encoded, 'base64')
    // Buffer.from skips what it does not understand, so the text must be the canonical encoding.
    if (key.length !== KEY_BYTES || key.toString('base64') !== encoded) throw new CredentialError()
    keys.set(id, key)
  }
  return { primary: keys.keys().next().value!, keys }
}

let cached: { raw: string; ring: KeyRing } | undefined

export function keyRing(): KeyRing {
  const raw = process.env.INTEGRATION_KEYS ?? ''
  if (cached?.raw !== raw) cached = { raw, ring: parseKeyRing(raw) }
  return cached.ring
}

const aad = ({ orgId, integrationId }: Binding) => Buffer.from(`omni:integration:v1:${orgId}:${integrationId}`, 'utf8')

export function encrypt(plaintext: StoredCredential, binding: Binding): Sealed {
  const parsed = StoredCredentialSchema.safeParse(plaintext)
  if (!parsed.success) throw new CredentialError()
  const ring = keyRing()
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', ring.keys.get(ring.primary)!, nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(aad(binding))
  const body = Buffer.concat([cipher.update(JSON.stringify(parsed.data), 'utf8'), cipher.final()])
  return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]), nonce, keyId: ring.primary }
}

export function decrypt(sealed: Sealed, binding: Binding): StoredCredential {
  try {
    const key = keyRing().keys.get(sealed.keyId)
    if (!key || sealed.nonce.length !== NONCE_BYTES || sealed.ciphertext.length <= TAG_BYTES) throw new CredentialError()
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.nonce, { authTagLength: TAG_BYTES })
    decipher.setAAD(aad(binding))
    decipher.setAuthTag(sealed.ciphertext.subarray(-TAG_BYTES))
    const text = Buffer.concat([decipher.update(sealed.ciphertext.subarray(0, -TAG_BYTES)), decipher.final()]).toString('utf8')
    return StoredCredentialSchema.parse(JSON.parse(text))
  } catch {
    // Node, JSON and Zod errors can quote their input: none of them leaves this function.
    throw new CredentialError()
  }
}
