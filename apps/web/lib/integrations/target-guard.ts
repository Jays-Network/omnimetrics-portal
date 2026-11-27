import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { networkInterfaces } from 'node:os'

/**
 * SERVER ONLY. Where a STORED integration may never point: this machine (loopback and its own addresses),
 * link-local and metadata addresses, and the host of the portal's own database, on any port or database.
 * Only managed rows (credential_source env:..., made by 011) may use them, and callers exempt those.
 *
 * Two layers: reservedHost() on the configured text (save and test, no network), and resolveTarget() at test
 * time, which resolves once, checks EVERY address and returns the one to connect to (no second lookup).
 */

export type Resolve = (host: string) => Promise<string[]>
type Env = Record<string, string | undefined>
export interface GuardDeps { resolve?: Resolve; env?: Env; localAddresses?: () => string[] }
export type Resolution = { ok: true; address: string } | { ok: false }

const RESOLVE_MS = 5_000

const never = new BlockList()
never.addSubnet('127.0.0.0', 8, 'ipv4')
never.addAddress('0.0.0.0', 'ipv4')
never.addSubnet('169.254.0.0', 16, 'ipv4')
never.addAddress('::1', 'ipv6')
never.addAddress('::', 'ipv6')
never.addSubnet('fe80::', 10, 'ipv6')
never.addAddress('fd00:ec2::254', 'ipv6') // cloud metadata over IPv6

/** One spelling per host: lower case, no brackets, zone or trailing dot; numeric forms (127.1, 0x7f000001) canonical. */
export function normaliseHost(host: string): string {
  const bare = host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '').replace(/\.+$/, '')
  if (!bare) return ''
  try {
    return new URL(`http://${bare.includes(':') ? `[${bare}]` : bare}`).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return bare
  }
}

/** True for an IP address in the fixed list (IPv4-mapped IPv6 is judged as its IPv4 address). */
function blocked(address: string): boolean {
  const kind = isIP(address)
  return kind !== 0 && never.check(address, kind === 6 ? 'ipv6' : 'ipv4')
}

const interfaceAddresses = () => Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((i) => i.address))
const own = (deps: GuardDeps) => new Set((deps.localAddresses ?? interfaceAddresses)().map(normaliseHost))
const isLocalName = (h: string) => h === 'localhost' || h.endsWith('.localhost') || h === 'localhost.localdomain' || h === 'ip6-localhost' || h === 'ip6-loopback'

/**
 * The hosts of the portal's own database, normalised. No host in the URL means the local server (as postgres.js
 * reads it). Null when a URL is set but cannot be read: then nothing can be ruled out and callers refuse.
 * Nothing of the URL itself leaves this function.
 */
export function portalDbHosts(env: Env = process.env): string[] | null {
  const hosts: string[] = []
  for (const value of [env.DATABASE_URL, env.DATABASE_URL_PLATFORM]) {
    if (!value) continue
    try {
      const rest = value.slice(value.indexOf('://') + 3).split(/[?/#]/)[0]!
      const authority = rest.slice(rest.lastIndexOf('@') + 1)
      const query = new URLSearchParams(value.split('?')[1] ?? '').get('host')
      for (const part of (query || authority || 'localhost').split(',')) {
        const host = part.startsWith('[') ? part.slice(1, part.indexOf(']')) : part.split(':')[0]!
        hosts.push(host && !host.includes('%2f') && !host.includes('%2F') && !host.startsWith('/') ? normaliseHost(host) : 'localhost')
      }
    } catch {
      return null
    }
  }
  return hosts
}

/** The configured text alone: is this a host only a managed source may use? */
export function reservedHost(host: string, deps: GuardDeps = {}): boolean {
  const h = normaliseHost(host)
  const portal = portalDbHosts(deps.env)
  // localhost, 127.0.0.1 and ::1 are one host: any local spelling of the portal's database is already local.
  return !h || !portal || isLocalName(h) || blocked(h) || own(deps).has(h) || portal.includes(h)
}

const failed = (code: string) => Object.assign(new Error(code), { code })

export const systemResolve: Resolve = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address)

async function addressesOf(host: string, resolve: Resolve): Promise<string[]> {
  if (isIP(host)) return [host]
  let timer: NodeJS.Timeout | undefined
  try {
    const found = await Promise.race([resolve(host), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(failed('CONNECT_TIMEOUT')), RESOLVE_MS)))])
    if (!found.length) throw failed('ENOTFOUND')
    return found.map(normaliseHost)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolves the host once. Refused if ANY address is reserved; otherwise the address to connect to (IPv4 first).
 * Throws the resolver's error (ENOTFOUND, EAI_AGAIN, CONNECT_TIMEOUT) when the host itself cannot be resolved.
 */
export async function resolveTarget(host: string, deps: GuardDeps = {}): Promise<Resolution> {
  if (reservedHost(host, deps)) return { ok: false }
  const resolve = deps.resolve ?? systemResolve
  const addresses = await addressesOf(normaliseHost(host), resolve)
  const forbidden = own(deps)
  for (const portalHost of portalDbHosts(deps.env) ?? []) {
    if (isLocalName(portalHost)) continue // loopback and own addresses are refused already
    try {
      for (const a of await addressesOf(portalHost, resolve)) forbidden.add(a)
    } catch {
      return { ok: false } // cannot tell where the portal's database is: refuse
    }
  }
  if (addresses.some((a) => !isIP(a) || blocked(a) || forbidden.has(a))) return { ok: false }
  return { ok: true, address: addresses.find((a) => isIP(a) === 4) ?? addresses[0]! }
}
