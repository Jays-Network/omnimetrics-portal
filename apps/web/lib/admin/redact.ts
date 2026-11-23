/**
 * Redaction for anything that is returned, logged or audited. The credentials field is write-only: it may enter
 * a request body, but it must never appear in a response, an error, a log line or an audit detail.
 */
const SECRET_KEYS = /^(credentials?|password|passwd|secret|token|api_?key|private_?key)$/i

export function redact<T>(value: T, secrets: readonly string[] = []): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return secrets.reduce((s, x) => (x ? s.split(x).join('[redacted]') : s), v)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : walk(x)]))
    return v
  }
  return walk(value) as T
}
