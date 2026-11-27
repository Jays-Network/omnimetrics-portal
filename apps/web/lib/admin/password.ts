import { randomBytes } from 'node:crypto'

// SERVER ONLY. Shared by the mock and pg so both apply the same password rules.

export const BCRYPT_COST = 12
export const MIN_PASSWORD_CHARS = 12
/** bcrypt ignores everything after 72 bytes; a longer password would be silently truncated. */
export const MAX_PASSWORD_BYTES = 72

/** One-time password: 18 random bytes, 24 URL-safe characters. Returned once, never stored or logged in clear. */
export const newOneTimePassword = (): string => randomBytes(18).toString('base64url')

/** Why a new password is refused, or null. */
export function passwordProblem(current: string, next: string): string | null {
  if (!current) return 'Enter your current password.'
  if (next.length < MIN_PASSWORD_CHARS) return `Use at least ${MIN_PASSWORD_CHARS} characters.`
  if (Buffer.byteLength(next, 'utf8') > MAX_PASSWORD_BYTES) return `Use at most ${MAX_PASSWORD_BYTES} bytes (about ${MAX_PASSWORD_BYTES} characters).`
  if (next === current) return 'The new password must differ from the current one.'
  return null
}

export const WRONG_CURRENT = 'Your current password is not correct.'
export const NAME_UNAVAILABLE = 'That username or email is not available.'
export const LAST_ADMIN = 'An organisation must keep at least one active admin.'
export const OWN_MEMBERSHIP = 'You cannot change your own role or deactivate yourself.'
export const OWN_RESET = 'Change your own password under My account.'
export const SHARED_LOGIN = 'This login is used by more than one organisation. Ask the director to reset it.'
