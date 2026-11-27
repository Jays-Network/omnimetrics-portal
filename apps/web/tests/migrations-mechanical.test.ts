// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The checker that proved the re-pointing of the migrations mechanical, run on a throwaway git repository.

const SCRIPT = 'db/test/check_migrations_mechanical.sh.example'
const FILE = 'db/migrations/900_demo.sql.example'
const OLD = `-- RUN AS: old_owner
BEGIN;
GRANT CONNECT ON DATABASE jaysnet_data TO portal_app;
INSERT INTO t (d) VALUES ('jaysnet_data');
CREATE POLICY p ON t USING (org_id = app_current_org());
COMMIT;
`
const NEW = `-- RUN AS: portal_owner
\\if :{?portal_db}
\\else
    \\set portal_db omnimetrics_portal
\\endif
BEGIN;
SELECT set_config('app.migr_source_db', :'source_db', true);
GRANT CONNECT ON DATABASE :"portal_db" TO portal_app;
INSERT INTO t (d) VALUES (current_setting('app.migr_source_db'));
CREATE POLICY p ON t USING (org_id = app_current_org());
COMMIT;
`

describe('migration mechanical check', () => {
  let dir: string
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args])
  const check = (text: string) => {
    writeFileSync(path.join(dir, FILE), text)
    return spawnSync('bash', [path.join(dir, SCRIPT)], { encoding: 'utf8' })
  }
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mech-'))
    mkdirSync(path.join(dir, 'db/test'), { recursive: true })
    mkdirSync(path.join(dir, 'db/migrations'), { recursive: true })
    copyFileSync(path.resolve(__dirname, '../../..', SCRIPT), path.join(dir, SCRIPT))
    writeFileSync(path.join(dir, FILE), OLD)
    git('init', '-q')
    git('add', '.')
    git('commit', '-qm', 'base')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('comments, variable defaults and the database name pass', () => {
    const result = check(NEW)
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain('mechanical')
    expect(readFileSync(path.join(dir, FILE), 'utf8')).toBe(NEW)
  })

  it.each([
    ['a grant to another role', NEW.replace('TO portal_app;', 'TO portal_app, public;')],
    ['a changed policy', NEW.replace('org_id = app_current_org()', 'true')],
    ['an added statement', NEW.replace('COMMIT;', 'GRANT SELECT ON t TO public;\nCOMMIT;')],
    ['a removed statement', NEW.replace('CREATE POLICY p ON t USING (org_id = app_current_org());\n', '')],
    ['another default', NEW.replace('portal_db omnimetrics_portal', 'portal_db elsewhere')],
    ['a skipped block', NEW.replace('BEGIN;\n', 'BEGIN;\n\\if false\n')],
    ['a variable outside CONNECT', NEW.replace('CREATE POLICY p ON t', 'CREATE POLICY p ON :"portal_db"')],
  ])('%s fails', (_name, text) => {
    expect(check(text).status).toBe(1)
  })

  it('a new migration file fails', () => {
    writeFileSync(path.join(dir, 'db/migrations/901_new.sql.example'), 'SELECT 1;\n')
    expect(check(NEW).status).toBe(1)
    rmSync(path.join(dir, 'db/migrations/901_new.sql.example'))
  })
})
