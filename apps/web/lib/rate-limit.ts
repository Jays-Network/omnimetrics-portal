/**
 * In-memory rate limiter for login and password operations: max 5 failed attempts
 * per 15 minutes per key (login: IP + username; passwords: user id + IP). Per-process state (resets on restart) which is acceptable
 * for a single-process deployment.
 */

export const MAX_FAILED_ATTEMPTS = 5
export const WINDOW_MS = 15 * 60 * 1000
const MAX_TRACKED_KEYS = 10_000

const globalForLimiter = globalThis as unknown as {
  __omniLoginFailures?: Map<string, number[]>
}
const failures: Map<string, number[]> = (globalForLimiter.__omniLoginFailures ??= new Map())

export function rateLimitKey(ip: string, username: string): string {
  return `${ip}|${username.toLowerCase()}`
}

function recentFailures(key: string, now: number): number[] {
  const recent = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (recent.length > 0) failures.set(key, recent)
  else failures.delete(key)
  return recent
}

/** Returns seconds until another attempt is allowed, or 0 if not limited. */
export function retryAfterSeconds(key: string, now = Date.now()): number {
  const recent = recentFailures(key, now)
  if (recent.length < MAX_FAILED_ATTEMPTS) return 0
  const oldest = recent[0] ?? now
  return Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000))
}

/** Records a failed attempt; returns the number of failures now in the window. */
export function recordFailure(key: string, now = Date.now()): number {
  if (failures.size >= MAX_TRACKED_KEYS) {
    for (const k of failures.keys()) recentFailures(k, now)
    if (failures.size >= MAX_TRACKED_KEYS) failures.clear()
  }
  const recent = recentFailures(key, now)
  recent.push(now)
  failures.set(key, recent)
  return recent.length
}

export function clearFailures(key: string): void {
  failures.delete(key)
}

export const TOO_MANY_ATTEMPTS = 'Too many failed attempts. Try again later.'

/** The newline cannot arrive in a header, so these keys never collide with a login key. */
export function attemptKey(kind: 'password.change' | 'password.reset', userId: string, ip: string): string {
  return `${kind}\n${userId}\n${ip}`
}

/**
 * Runs `attempt` unless the key is locked out. 'failure' counts, 'success' clears, 'neutral' (e.g. a new
 * password that is too short) does neither. A thrown error counts nothing.
 */
export async function withAttemptLimit<T>(
  key: string,
  attempt: () => Promise<T>,
  judge: (result: T) => 'success' | 'failure' | 'neutral',
  now: () => number = Date.now,
): Promise<{ limited: true; retryAfter: number } | { limited: false; result: T }> {
  const retryAfter = retryAfterSeconds(key, now())
  if (retryAfter > 0) return { limited: true, retryAfter }
  const result = await attempt()
  const verdict = judge(result)
  if (verdict === 'failure') recordFailure(key, now())
  else if (verdict === 'success') clearFailures(key)
  return { limited: false, result }
}

export const MAX_TESTS_PER_MINUTE = 10
export const MAX_ORG_TESTS_PER_MINUTE = 20
const TEST_WINDOW_MS = 60_000

const globalForTests = globalThis as unknown as { __omniIntegrationTests?: Map<string, number[]> }
const tests: Map<string, number[]> = (globalForTests.__omniIntegrationTests ??= new Map())

export function integrationTestKey(orgId: string, integrationId: string): string {
  return `integration.test\n${orgId}\n${integrationId}`
}

/** One organisation across all its integrations, so adding integrations does not add tests. */
export function orgTestLimit(orgId: string): { key: string; max: number } {
  return { key: `integration.test.org\n${orgId}`, max: MAX_ORG_TESTS_PER_MINUTE }
}

/**
 * Same shape as withAttemptLimit, but EVERY run counts (successful ones too): at most 10 in any minute per key,
 * and at most `shared.max` per minute for the shared key. A refused call takes no slot in either. The slots are
 * taken before `run`, so parallel calls cannot exceed a limit. `shared: true` in a refusal: the shared one is full.
 */
export async function withRateLimit<T>(
  key: string,
  run: () => Promise<T>,
  now: () => number = Date.now,
  shared?: { key: string; max: number },
): Promise<{ limited: true; retryAfter: number; shared?: true } | { limited: false; result: T }> {
  const t = now()
  const limits = [{ key, max: MAX_TESTS_PER_MINUTE }, ...(shared ? [shared] : [])].map((l) => {
    const recent = (tests.get(l.key) ?? []).filter((x) => t - x < TEST_WINDOW_MS)
    const wait = recent.length >= l.max ? Math.max(1, Math.ceil((recent[0]! + TEST_WINDOW_MS - t) / 1000)) : 0
    return { ...l, recent, wait }
  })
  const retryAfter = Math.max(...limits.map((l) => l.wait))
  if (retryAfter > 0) {
    for (const l of limits) tests.set(l.key, l.recent)
    return { limited: true, retryAfter, ...(limits[1]?.wait ? { shared: true as const } : {}) }
  }
  if (tests.size >= MAX_TRACKED_KEYS) tests.clear()
  for (const l of limits) tests.set(l.key, [...l.recent, t])
  return { limited: false, result: await run() }
}

/**
 * Client IP as set by the reverse proxy (nginx sets X-Real-IP). Without a
 * trusted proxy in front these headers are client-controlled.
 */
export function getClientIp(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim()
  if (real) return real
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || 'unknown'
}
