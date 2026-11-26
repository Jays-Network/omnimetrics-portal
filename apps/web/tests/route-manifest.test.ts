// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Static check on the source text: every org-scoped handler and page passes the organisation guard
// before it touches data. A new file under these folders is picked up automatically.

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const find = (dir: string, names: string[]) =>
  (readdirSync(path.join(root, dir), { recursive: true }) as string[])
    .filter((f) => names.includes(path.basename(f)))
    .map((f) => path.join(dir, f))
    .sort()

const routes = find('app/api/portal/o/[orgSlug]', ['route.ts', 'route.tsx'])
const pages = find('app/dashboard/o/[orgSlug]', ['page.tsx', 'layout.tsx'])

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** The body of the function whose declaration starts at `from` (first brace after the parameter list). */
function bodyAt(source: string, from: number): string {
  let i = source.indexOf('(', from)
  for (let depth = 0; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')' && --depth === 0) break
  }
  const open = source.indexOf('{', i)
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}' && --depth === 0) return source.slice(open, j + 1)
  }
  throw new Error('unbalanced braces')
}
const bodyOf = (source: string, name: string) => {
  const at = source.search(new RegExp(`function ${name}\\b`))
  expect(at, `function ${name}`).toBeGreaterThanOrEqual(0)
  return bodyAt(source, at)
}

/** Anything that reads or writes portal data. */
const DATA = /\bportal!?\.(?!mode)|getPortal\(/
const METHODS = 'GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS'
const FORBIDDEN_IMPORTS = /from\s+'(postgres|@\/lib\/db|[^']*\/portal\/pg(\/[^']*)?)'|getAppDb|getPlatformDb|getDb\b|getReadonlyDb/

describe('route manifest', () => {
  it('finds the org routes and pages', () => {
    expect(routes.length).toBeGreaterThanOrEqual(7)
    expect(pages.length).toBeGreaterThanOrEqual(10)
  })

  it('the shared guards really reach requireOrg', () => {
    const org = strip(read('lib/portal/org.ts'))
    expect(bodyOf(org, 'resolveOrg')).toMatch(/\brequireOrg\(/)
    expect(bodyOf(org, 'requireOrgPage')).toMatch(/\bresolveOrg\(/)
    expect(bodyOf(strip(read('lib/portal/route.ts')), 'guardOrg')).toMatch(/\bresolveOrg\(/)
  })

  it.each(routes)('%s guards every handler before touching data', (file) => {
    const source = strip(read(file))
    expect(source).not.toMatch(FORBIDDEN_IMPORTS)
    expect(source).toMatch(/import \{[^}]*\bguardOrg\b[^}]*\} from '@\/lib\/portal\/route'|\brequireOrg(Page)?\b/)
    expect(source, 'no local guard may shadow the shared one').not.toMatch(/function (guardOrg|requireOrg|requireOrgPage)\b/)

    const handlers = [...source.matchAll(new RegExp(`export async function (${METHODS})\\b`, 'g'))]
    // Handlers must be plain exported async functions, or this check could not see them.
    expect(source.match(new RegExp(`export\\b[^\\n]*\\b(${METHODS})\\b`, 'g'))?.length).toBe(handlers.length)
    expect(handlers.length).toBeGreaterThan(0)
    for (const h of handlers) {
      const body = bodyAt(source, h.index)
      const guard = body.search(/\b(guardOrg|requireOrg|requireOrgPage)\(/)
      expect(guard, `${file} ${h[1]} calls the guard`).toBeGreaterThanOrEqual(0)
      const data = body.search(DATA)
      if (data >= 0) expect(guard, `${file} ${h[1]} guards first`).toBeLessThan(data)
    }
  })

  it.each(pages)('%s calls requireOrgPage before touching data', (file) => {
    const source = strip(read(file))
    expect(source).not.toMatch(FORBIDDEN_IMPORTS)
    const at = source.search(/export default (async )?function/)
    expect(at).toBeGreaterThanOrEqual(0)
    const body = bodyAt(source, at)
    const guard = body.search(/\brequireOrg(Page)?\(/)
    expect(guard, `${file} calls requireOrgPage`).toBeGreaterThanOrEqual(0)
    const data = body.search(DATA)
    if (data >= 0) expect(guard).toBeLessThan(data)
  })
})
