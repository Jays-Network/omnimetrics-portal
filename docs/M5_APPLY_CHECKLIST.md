# M5 Apply Checklist (migrations 003b and 004 to 010)

Applied BY JAY, by hand. Claude writes the SQL and never runs it against `jaysnet_data`.
Files live in `db/migrations/` as `NNN_name.sql.example` with a matching `NNN_name.down.sql.example`.
Each is one transaction. Run with `-v ON_ERROR_STOP=1` (do NOT use `-1`; the files carry their own BEGIN/COMMIT), so a failure stops and rolls back that file.

| File | Run as | Purpose |
|---|---|---|
| 003b `portal_platform_role` | `postgres` | `portal_platform` (LOGIN, no password in the file, no table grants yet) |
| 004 `portal_reader_roles` | `postgres` | `portal_reader_wr`, `portal_reader_adars` (SELECT on one tracking table each; LOGIN, no password in the file) |
| 005 `orgs_memberships` | `jaysnet_admin` | `app_orgs`, `app_memberships`, `is_platform_admin`, `org_id` on `app_user_projects` |
| 006 `content` | `jaysnet_admin` | content tree, versions, grants |
| 007 `integrations_datasets` | `jaysnet_admin` | allowed hosts, integrations, datasets, fields |
| 008 `settings` | `jaysnet_admin` | `app_settings` |
| 009 `audit_backfill` | `jaysnet_admin` | audit columns, WorldRisk backfill |
| 010 `rls_grants` | `jaysnet_admin` | RLS + grants to `portal_app` and `portal_platform`, credential function (apply WITH the M5 app release) |
| 011 `seed_managed_sources` | `postgres` (bypasses RLS; the file refuses anyone else) | global host `localhost:5432` + one managed `env:` integration per org (no credential) |

Order: 003b and 004 can go any time after the pre-flight (003b BEFORE 010). 005 → 006 → 007 → 008 → 009 → 010 → 011. Rollback is the exact reverse: 011 → 010 → 009 → 008 → 007 → 006 → 005 → 004 → 003b.
**Passwords are never in a file.** 003b and 004 create the roles with LOGIN and no password; Jay sets each one by hand with `\password` (section 1). A role without a password cannot log in (scram/md5).
005 to 009 are safe for the CURRENT app (additive; legacy `app_users.role` and the old reads still work). 010 changes behaviour for it (see "010 cut-over").

## 0. Pre-flight

1. **Fresh vzdump** of the LXC, taken now, verified restorable (or at least listed in the backup storage). Note the vmid/timestamp: ______
2. **Stop point**: no one else is logged in; Grafana (:3000) and the sync scripts in `/opt/jaysnet` untouched. The portal on :3002 may stay up for 004 to 009; stop it for 010 until the M5 release is deployed.
3. **Who runs what**: `sudo -u postgres psql` works; `psql -U jaysnet_admin -d jaysnet_data -h localhost` works.
4. **Confirm roles and owners** (as postgres):
   ```sql
   SELECT rolname, rolsuper, rolcreaterole, rolbypassrls, rolcanlogin FROM pg_roles
     WHERE rolname IN ('jaysnet_admin','portal_app','portal_platform','grafana_reader','portal_reader','portal_reader_wr','portal_reader_adars');
   -- expect: portal_app NOT super/bypassrls; portal_platform and portal_reader_* absent; jaysnet_admin NOT superuser (it may be; note it)
   SELECT tablename, tableowner FROM pg_tables WHERE tablename LIKE 'app\_%' ESCAPE '\';
   -- expect: app_users, app_user_projects, app_audit_log all owned by jaysnet_admin
   SELECT has_table_privilege('portal_app','worldrisk_tracking','SELECT'), has_table_privilege('portal_app','adars_tracking','SELECT'); -- f, f
   ```
5. **Backups that dump the database**: if any cron or script runs `pg_dump` on `jaysnet_data` as `jaysnet_admin`, it will FAIL on the tenant tables after 010 (row_security is off during pg_dump and the owner is forced). Look (read-only; do not edit /etc/cron.d from here): `crontab -l`, `sudo crontab -l`, `ls /etc/cron.d`. Switch such a job to `postgres` before 010. vzdump is unaffected.
6. **pg_hba.conf** (as postgres; the new roles have NO password until you set one, so a `trust` line would let them in without one):
   ```sql
   SELECT line_number, type, database, user_name, address, auth_method FROM pg_hba_file_rules ORDER BY line_number;
   -- expect: no 'trust' (and no 'peer'/'ident' that maps to these roles) matching portal_app, portal_platform, portal_reader_wr, portal_reader_adars;
   -- host lines for them use scram-sha-256. Fix pg_hba.conf (outside this repo) BEFORE creating the roles.
   ```
7. **Time-zone decision for 004** (R6 relevant): run the two queries in the 004 header (Grafana's effective timezone; stored zone of `row_modified_at`). Edit the two `ALTER ROLE ... SET timezone` lines if the answer is not `Africa/Johannesburg`. Record the outcome in `docs/DECISIONS.md` if any number can change.
8. **Passwords** for the three new roles (`portal_reader_wr`, `portal_reader_adars`, `portal_platform`) generated with `openssl rand -base64 32` and kept in your password manager. They go only into `\password` (section 1) and then into `.env` (`DATABASE_URL_READONLY_WR`, `DATABASE_URL_READONLY_ADARS`, `DATABASE_URL_PLATFORM`). Nothing is typed into a file or onto a command line. The real `003_*.sql` / `004_*.sql` copies stay git-ignored (`.gitignore` lines kept).
9. **Env list for the M5 release** (`.env`, outside git): `DATABASE_URL` (portal_app), `DATABASE_URL_PLATFORM` (portal_platform, used ONLY by `withPlatform()`; never given to any other code path), `DATABASE_URL_READONLY_WR`, `DATABASE_URL_READONLY_ADARS`, `INTEGRATION_KEYS`. The only `env:` credential sources the schema accepts are `env:DATABASE_URL_READONLY_<NAME>`.
10. **Test database green first**: `db/test/setup_test_db.sql.example` applied, 001 and 005 to 010 applied there, 011 applied there as `postgres` (so the env: row tests run), and `db/test/smoke_m5.sql.example` run once as `portal_test_app` and once as `portal_test_platform` with `0 FAILED, 0 skipped` (section 6). Do not start section 1 before this.
11. **Row snapshot** (baseline for later comparison):
   ```sql
   SELECT (SELECT count(*) FROM app_users) users, (SELECT count(*) FROM app_user_projects) projects, (SELECT count(*) FROM app_audit_log) audits,
          (SELECT count(*) FROM worldrisk_tracking) wr_rows, (SELECT count(*) FROM adars_tracking) adars_rows;
   ```
   Users/projects: ______ / ______ (these are the expected membership and project-row counts after 009).
12. **Note `INTEGRATION_KEYS`** is NOT needed for these files (no credential is stored). It is needed only when the app is released.

## 1. Apply

```bash
cd /opt/omnimetrics-portal
# 003b (postgres). No edit needed (no password in the file):
sudo -u postgres psql -v ON_ERROR_STOP=1 -d jaysnet_data -f db/migrations/003b_portal_platform_role.sql.example
# 004 (postgres). Copy, edit the timezone lines only if pre-flight 7 says so, then:
sudo -u postgres psql -v ON_ERROR_STOP=1 -d jaysnet_data -f db/migrations/004_portal_reader_roles.sql
# 005 - 009 (jaysnet_admin; the .example files hold no secrets and may be run directly)
for f in 005_orgs_memberships 006_content 007_integrations_datasets 008_settings 009_audit_backfill; do
  psql -v ON_ERROR_STOP=1 -U jaysnet_admin -d jaysnet_data -h localhost -f db/migrations/$f.sql.example || break
done
# 010 only together with the M5 app release (see section 3)
psql -v ON_ERROR_STOP=1 -v app_role=portal_app -v platform_role=portal_platform -U jaysnet_admin -d jaysnet_data -h localhost -f db/migrations/010_rls_grants.sql.example
# 011 (postgres, bypasses RLS; no secret in the file). After 010, once the M5 release is deployed or just before it:
sudo -u postgres psql -v ON_ERROR_STOP=1 -d jaysnet_data -f db/migrations/011_seed_managed_sources.sql.example
```
**Set the three passwords by hand, right after 003b and 004** (as postgres, interactive; the password is not echoed, not logged, not in shell history):
```bash
sudo -u postgres psql -d jaysnet_data
#   \password portal_platform
#   \password portal_reader_wr
#   \password portal_reader_adars
```
(`portal_app` already has its password from 003.) Until a password is set the role cannot log in; set them before the connection tests below.
Run the files one at a time and do the verification below after EACH; stop at the first red result and roll back that file (its own transaction already did, if it failed).

Set the director (manual, once, after 005; as `jaysnet_admin` or `postgres`; replace the username if it differs):
```sql
UPDATE app_users SET is_platform_admin = true WHERE username = 'Jay';
```
After 010 `portal_app` cannot write that column, so this is the only way.

## 2. Verification after each file (psql as jaysnet_admin unless noted)

**After 003b (as postgres).** Run the three checks in its header: attributes `t f f f f f f` (login yes; super, createdb, createrole, bypassrls, inherit, replication no); `statement_timeout=10s`; `has_table_privilege('portal_platform','app_users','SELECT')` false. Then `\password portal_platform`.

**After 004 (as postgres).** Run checks 1 to 5 in the file header. Expected: both roles `login t, super f, bypassrls f, inherit f`; settings `statement_timeout=10s, default_transaction_read_only=on, timezone=Africa/Johannesburg`; privilege matrix `t f t f`; exactly two rows in the "every readable table" query (each role / its own table / SELECT); `app_users` not readable. Then set both passwords (`\password portal_reader_wr`, `\password portal_reader_adars`) and, from the app host:
```bash
psql "postgresql://portal_reader_wr@localhost:5432/jaysnet_data" -c "SHOW timezone" -c "SELECT count(*) FROM worldrisk_tracking" -c "SELECT count(*) FROM adars_tracking"
# expect: Africa/Johannesburg, a count, then ERROR: permission denied for table adars_tracking   (mirror for _adars)
```

**After 005.**
```sql
\dt app_*                                                   -- + app_orgs, app_memberships
SELECT slug, name, status FROM app_orgs ORDER BY slug;      -- adars/ADARS/active, worldrisk/WorldRisk/active
SELECT column_default FROM information_schema.columns WHERE table_name='app_users' AND column_name='is_platform_admin'; -- false
SELECT count(*) FROM app_users WHERE is_platform_admin;     -- 0 (until the manual UPDATE)
SELECT conname FROM pg_constraint WHERE conrelid='app_user_projects'::regclass ORDER BY 1;  -- has ..._org_user_folder_key, no ..._user_id_folder_name_key
SELECT count(*) FROM app_user_projects WHERE org_id IS NOT NULL;  -- 0
```

**After 006.**
```sql
\dt app_*     -- + app_content_nodes, app_dashboard_versions, app_grants
SELECT conname FROM pg_constraint WHERE conname='app_dashboard_versions_spec_size';   -- 1 row (1 MiB cap)
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text LIKE 'app\_%' ESCAPE '\' ORDER BY 2,1;
  -- app_content_nodes_guard, app_content_nodes_after_move, app_dashboard_versions_no_update_delete, ..._no_truncate
-- Smoke test (rolls back). Expect the marked results:
BEGIN;
  INSERT INTO app_content_nodes (id, org_id, kind, name) SELECT '00000000-0000-0000-0000-0000000000a1', id, 'folder', 'smoke' FROM app_orgs WHERE slug='worldrisk';
  SELECT depth FROM app_content_nodes WHERE id='00000000-0000-0000-0000-0000000000a1';        -- 1
  SAVEPOINT s; INSERT INTO app_content_nodes (org_id, parent_id, kind, name) SELECT id, '00000000-0000-0000-0000-0000000000a1', 'folder', 'x' FROM app_orgs WHERE slug='adars';  -- ERROR (cross-org parent)
ROLLBACK;
```

**After 007.**
```sql
\dt app_*     -- + app_allowed_hosts, app_integrations, app_datasets, app_dataset_fields
SELECT count(*) FROM app_integrations;                                   -- 0 (nothing seeded)
SELECT column_name, is_generated FROM information_schema.columns WHERE table_name='app_integrations' AND column_name='has_credentials';  -- 1 row, ALWAYS
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='app_integrations_cred_source_check';  -- 'stored' OR ~ '^env:DATABASE_URL_READONLY_[A-Z0-9_]{1,32}$'
SELECT to_regclass('app_integrations_public');                           -- NULL (no such view any more)
BEGIN; INSERT INTO app_integrations (org_id,kind,name,host,port,database,credential_source)
  SELECT id,'postgres','x','h',1,'d','env:JWT_SECRET' FROM app_orgs LIMIT 1; ROLLBACK;   -- ERROR (check constraint)
```

**After 008.**
```sql
\d app_settings
BEGIN; INSERT INTO app_settings (scope, key, value) VALUES ('org','timeZone','"UTC"'); ROLLBACK;   -- ERROR (org scope needs org_id)
```

**After 009 (the backfill).**
```sql
SELECT o.slug, count(m.*) AS memberships FROM app_orgs o LEFT JOIN app_memberships m ON m.org_id=o.id GROUP BY 1 ORDER BY 1;
  -- worldrisk = users count from the baseline, adars = 0
SELECT count(*) FROM app_user_projects WHERE org_id IS NULL;                                -- 0
SELECT count(*) FROM app_user_projects WHERE org_id = (SELECT id FROM app_orgs WHERE slug='worldrisk');  -- = baseline projects
SELECT u.username, u.role, m.role, m.is_active FROM app_users u JOIN app_memberships m ON m.user_id=u.id ORDER BY 1;  -- roles equal
SELECT count(*) FROM app_audit_log WHERE org_id IS NOT NULL;                                -- 0 (historic rows stay platform-level)
```
Re-run 009: every NOTICE must read `inserted 0` / `moved to worldrisk: 0`; the counts above do not change.

**After 010.**
```sql
-- 1. table list and RLS: enabled + forced on all app_* except app_users, app_orgs
SELECT relname, relrowsecurity AS rls, relforcerowsecurity AS forced FROM pg_class
 WHERE relkind='r' AND relname LIKE 'app\_%' ESCAPE '\' ORDER BY 1;
-- 2. no tenant table with a nullable org_id (audit, settings, allowed_hosts are the documented exceptions)
SELECT table_name, is_nullable FROM information_schema.columns
 WHERE column_name='org_id' AND table_name LIKE 'app\_%' ESCAPE '\' ORDER BY 1;
-- 3. policies (app_integrations has tenant_isolation + three RESTRICTIVE: cred_source_insert, cred_source_update (USING + WITH CHECK), cred_source_delete (USING))
SELECT tablename, policyname, permissive, cmd FROM pg_policies WHERE schemaname='public' ORDER BY 1,2;
SELECT pg_get_functiondef('app_is_platform()'::regprocedure);   -- body: SELECT current_user = 'portal_platform'
SELECT count(*) FROM pg_proc WHERE proname='app_is_platform' AND prosrc ILIKE '%app.is_platform%';   -- 0 (no setting involved)
-- 4. privileges of portal_app (must be false)
SELECT has_table_privilege('portal_app','worldrisk_tracking','SELECT') AS wr,
       has_table_privilege('portal_app','adars_tracking','SELECT')     AS adars,
       has_table_privilege('portal_app','app_audit_log','UPDATE')      AS audit_upd,
       has_table_privilege('portal_app','app_audit_log','DELETE')      AS audit_del,
       has_table_privilege('portal_app','app_dashboard_versions','UPDATE') AS ver_upd,
       has_table_privilege('portal_app','app_dashboard_versions','DELETE') AS ver_del,
       has_table_privilege('portal_app','app_content_nodes','DELETE')  AS node_del,
       has_column_privilege('portal_app','app_users','is_platform_admin','UPDATE') AS plat_upd,
       has_column_privilege('portal_app','app_users','is_platform_admin','INSERT') AS plat_ins,
       has_table_privilege('portal_app','app_orgs','INSERT')           AS org_ins,
       has_table_privilege('portal_app','app_orgs','UPDATE')           AS org_upd,
       has_table_privilege('portal_app','app_allowed_hosts','INSERT')  AS host_ins,
       has_table_privilege('portal_app','app_allowed_hosts','UPDATE')  AS host_upd,
       has_table_privilege('portal_app','app_allowed_hosts','DELETE')  AS host_del,
       has_column_privilege('portal_app','app_integrations','cred_ciphertext','SELECT') AS cred_sel,
       has_column_privilege('portal_app','app_integrations','cred_nonce','SELECT')      AS nonce_sel;   -- all false
-- 5. privileges it must have (all true)
SELECT has_table_privilege('portal_app','app_users','SELECT'), has_table_privilege('portal_app','app_audit_log','INSERT'),
       has_table_privilege('portal_app','app_dashboard_versions','INSERT'), has_table_privilege('portal_app','app_content_nodes','UPDATE'),
       has_column_privilege('portal_app','app_users','hashed_password','UPDATE'),
       has_column_privilege('portal_app','app_integrations','cred_key_id','SELECT'),
       has_column_privilege('portal_app','app_integrations','cred_ciphertext','UPDATE'),   -- write-only
       has_function_privilege('portal_app','app_integration_credentials(uuid)','EXECUTE'),
       has_table_privilege('portal_app','app_allowed_hosts','SELECT');   -- true (SELECT only; writes are platform-only)
-- 5b. portal_platform: exactly its list, nothing else (expect the 6 rows below and no other row)
SELECT c.relname, string_agg(p.priv, ',' ORDER BY p.priv) AS privs
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(priv)
 WHERE n.nspname='public' AND c.relkind='r' AND has_table_privilege('portal_platform', c.oid, p.priv)
 GROUP BY 1 ORDER BY 1;
  -- app_allowed_hosts DELETE,INSERT,SELECT,UPDATE | app_audit_log INSERT,SELECT | app_memberships INSERT,SELECT,UPDATE
  -- app_orgs INSERT,SELECT,UPDATE | app_settings DELETE,INSERT,SELECT,UPDATE   (no app_users, no content/integration table)
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolinherit FROM pg_roles WHERE rolname='portal_platform';   -- f f f f
SELECT has_function_privilege('portal_platform','app_integration_credentials(uuid)','EXECUTE');   -- false
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='portal_platform'); -- 0
SELECT proname, prosecdef, pg_get_userbyid(proowner) AS owner, proconfig FROM pg_proc WHERE proname='app_integration_credentials';  -- t, jaysnet_admin, {search_path=pg_catalog, public}
-- 6. the readers cannot read app tables, and portal_app cannot bypass RLS
SELECT has_table_privilege('portal_reader_wr','app_users','SELECT') OR has_table_privilege('portal_reader_adars','app_content_nodes','SELECT');  -- false
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('portal_app','portal_platform');   -- f, f (twice)
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='portal_app'); -- 0
-- 7. RLS behaves (as portal_app, psql -U portal_app -h localhost):  expect 0 rows without context, rows with it
SELECT count(*) FROM app_memberships;                         -- 0
BEGIN; SELECT set_config('app.org_id', (SELECT id::text FROM app_orgs WHERE slug='worldrisk'), true); SELECT count(*) FROM app_memberships; ROLLBACK;  -- = worldrisk members
BEGIN; SELECT set_config('app.org_id', (SELECT id::text FROM app_orgs WHERE slug='adars'), true);      SELECT count(*) FROM app_memberships; ROLLBACK;  -- 0
INSERT INTO app_audit_log (action) VALUES ('m5-010-check');   -- allowed (org_id NULL); it can then not be updated or deleted
UPDATE app_audit_log SET action='x' WHERE action='m5-010-check';   -- ERROR permission denied
-- 8. portal_app cannot read the secret columns (psql -U portal_app): each ERROR permission denied
SELECT cred_ciphertext FROM app_integrations;
SELECT * FROM app_integrations;
-- 9. the platform path (psql -U portal_platform -h localhost): reads orgs, no context needed
SELECT slug FROM app_orgs ORDER BY 1;                         -- adars, worldrisk
SELECT count(*) FROM app_users;                               -- ERROR permission denied
```
Then run the behavioural smoke test again against the real roles' semantics in portal_test (section 6) if 010 or the policies were edited since it last passed.

## 3. 010 cut-over (do not skip)

- Deploy the M5 app release (`PORTAL_DATA=pg`, `withOrg`/`withUser`/`withPlatform`, `requireOrg`, per-org loadUser) in the same window as 010. Between 010 and that release the old app sees no project rows for builders/viewers and no audit rows (fails closed).
- The release must set per transaction: `app.org_id` (withOrg) and `app.user_id` (org switcher, requireOrg, user settings). There is NO `app.is_platform` setting any more: `withPlatform()` must open its connection with `DATABASE_URL_PLATFORM` (login role `portal_platform`) and nothing else may use that URL. Audit inserts must not use `RETURNING` (non-platform callers cannot see org-less rows).
- Integration credentials: the connector reads them only via `SELECT * FROM app_integration_credentials($1)` inside `withOrg`; list queries select named columns (never `SELECT *` on `app_integrations`; it fails for `portal_app` by design) and use `has_credentials`. `env:` integrations are created only by 011 (as `postgres`); `portal_app` can list them but UPDATE and DELETE touch 0 rows, and the app must show them read-only (see "Open points").
- The host allowlist is read-only for `portal_app`; adding a host is a platform-path (`portal_platform`) action.
- Existing sessions: roles come from memberships after the cut-over; check that no user gained access (compare the pre-010 `allowed_projects` per user with the new one).
- Do not enter any real integration credential until the isolation matrix is green; do not create client logins before TOTP (R7 hardening).

## 4. Roll back (reverse order, each as its listed role; copy each `.down.sql.example` and run)

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 -d jaysnet_data -f db/migrations/011_seed_managed_sources.down.sql.example   # first; deletes the 2 managed integrations (+ datasets on them) and the global localhost host
psql -v ON_ERROR_STOP=1 -v app_role=portal_app -v platform_role=portal_platform -U jaysnet_admin -d jaysnet_data -h localhost -f db/migrations/010_rls_grants.down.sql.example
for f in 009_audit_backfill 008_settings 007_integrations_datasets 006_content 005_orgs_memberships; do
  psql -v ON_ERROR_STOP=1 -U jaysnet_admin -d jaysnet_data -h localhost -f db/migrations/$f.down.sql.example || break
done
sudo -u postgres psql -v ON_ERROR_STOP=1 -d jaysnet_data -f db/migrations/004_portal_reader_roles.down.sql.example   # stop anything using the reader roles first
sudo -u postgres psql -v ON_ERROR_STOP=1 -d jaysnet_data -f db/migrations/003b_portal_platform_role.down.sql.example  # after 010's rollback
```
Verify: `\dt app_*` lists only `app_users`, `app_user_projects`, `app_audit_log`; `SELECT count(*) FROM pg_policies WHERE schemaname='public'` is 0; row counts equal the baseline; `portal_app` privileges equal the 003 set; `portal_platform` absent. Down files DROP data created after go-live (content, versions, integrations, settings, memberships): after real use the safe rollback is restoring the vzdump.

## 4b. After 011 (as postgres)

```sql
SELECT host, port_min, port_max, org_id FROM app_allowed_hosts;      -- localhost 5432 5432 NULL
SELECT o.slug, i.name, i.credential_source, i.relation_allowlist, i.host, i.port, i.database, i.ssl_mode, i.has_credentials, i.status
  FROM app_integrations i JOIN app_orgs o ON o.id=i.org_id ORDER BY 1;
  -- adars | ADARS tracking (managed) | env:DATABASE_URL_READONLY_ADARS | {adars_tracking} | localhost | 5432 | jaysnet_data | disable | f | active
  -- worldrisk | WorldRisk tracking (managed) | env:DATABASE_URL_READONLY_WR | {worldrisk_tracking} | (same) ... | f | active
SELECT count(*) FROM app_integrations WHERE cred_ciphertext IS NOT NULL OR cred_nonce IS NOT NULL;   -- 0
```
Re-run 011: both NOTICEs read `inserted 0`. As `portal_app` (psql, inside a transaction with `app.org_id` set to worldrisk): the env: row is listable; `UPDATE app_integrations SET name='x' WHERE credential_source LIKE 'env:%'` and the same `DELETE` report 0 rows. Do not rename the seeded integrations (a renamed row would be seeded again on a re-run).

## 5. After applying

- Update `docs/PROGRESS.md` (applied files, date, vzdump id, the timezone decision).
- Test database: `db/test/setup_test_db.sql.example` (instructions in its header); the tests never use `jaysnet_data`.
- Remove the throwaway pieces when done if wanted: `sudo -u postgres psql -d postgres -v teardown=1 -f db/test/setup_test_db.sql` (drops `portal_test` and the three test roles only).
- Not in 005 to 010 (separate later files): `app_totp_secrets`, dropping legacy `app_users.role`, and the first two named datasets.

## 6. Smoke test in the throwaway database (BEFORE section 1, and again after any edit to 006/007/010)

`portal_test` only; never `jaysnet_data`. The file refuses to run elsewhere, runs inside one transaction and always ends with `ROLLBACK`.
```bash
# one-time: setup_test_db.sql.example + 001, 005-009 + 010 with both -v roles (commands in the header of setup_test_db.sql.example)
psql -q -v ON_ERROR_STOP=1 -U portal_test_app      -h localhost -d portal_test -f db/test/smoke_m5.sql.example 2>&1 | grep -E 'FAIL|SKIP|passed'
psql -q -v ON_ERROR_STOP=1 -U portal_test_platform -h localhost -d portal_test -f db/test/smoke_m5.sql.example 2>&1 | grep -E 'FAIL|SKIP|passed'
```
Apply 011 to `portal_test` first (`sudo -u postgres psql -v ON_ERROR_STOP=1 -d portal_test -f db/migrations/011_seed_managed_sources.sql.example`): it is the only way to create an `env:` row, and tests 535 to 538 (UPDATE and DELETE of an env: row touch 0 rows; other org cannot touch it) use it. Without it they print `SKIP`.
New in this version, all as `portal_test_app`: 250 to 252 (INSERT, UPDATE, DELETE on `app_allowed_hosts` refused by privilege), 535 to 538 (env: row), 131 (no org-owned host rows without context; the global `localhost` row is readable by design); 412 now uses `RETURNING id` (a constant RETURNING does not trigger the SELECT policy).
Expected: one line each, `smoke_m5 (portal_test_app): N passed, 0 FAILED, 0 skipped` and `smoke_m5 (portal_test_platform): N passed, 0 FAILED, 0 skipped`; no line starting `FAIL` or `SKIP`. Any FAIL line names the test number, what was expected and what happened: stop, do not apply to `jaysnet_data`, send the output back.

## 7. Open points (decide before the M5 release)

- `env:` integrations are created only by 011 (as `postgres`). `portal_platform` has no grant on `app_integrations` and the owner is not the platform role, so the app can neither create nor change them; adding a third managed source later means another seed file as `postgres` (or a deliberate platform grant). The app must render managed rows read-only.
- `portal_app` is now `SELECT` only on `app_allowed_hosts`; adding a host needs the platform path (`portal_platform`, which keeps full DML there).
