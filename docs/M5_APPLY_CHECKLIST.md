# M5 Apply Checklist (migrations 003b and 004 to 012)

**Where things run (ruling 2026-11-27):** the portal's tables live in `omnimetrics_portal` (owner `portal_owner`); `jaysnet_data` is an external source and receives only 004. **Follow section 0A**; sections 1 to 4 are the reference for each file. Earlier versions of this checklist, which applied everything to `jaysnet_data` as `jaysnet_admin`, are superseded.

## Cut-over order (do not reorder)

The same order as section 0A (step numbers in brackets).

1. **Fresh vzdump** (pre-flight 1), portal stopped (0A steps 1, 2).
2. **Database** `omnimetrics_portal` and `portal_owner`, **001**, copy of the legacy tables (0A steps 3 to 5).
3. **003**, **003b** (0A steps 6, 7).
4. **005, 006, 007, 008**, then **009, ONCE**, before any login is created by the portal; then set the director (0A step 8).
5. **010** (with the M5 app release, section 3), then **011**, then **012** (0A step 9).
6. **004**, in the external database `jaysnet_data` (0A step 10). It is independent of every other file; it is placed here so there is one order to follow.
7. App env, restart the portal, sign in (0A step 11).
8. Only then set **`SESSION_VERSION=1`** (section 9) and restart the portal.

**Never re-run 009 after the portal has created logins.** Its backfill gives every `app_users` row a WorldRisk membership, including people who were added to another organisation only.

Applied BY JAY, by hand. Claude writes the SQL and never runs it against `jaysnet_data` or `omnimetrics_portal`.
Files live in `db/migrations/` as `NNN_name.sql.example` with a matching `NNN_name.down.sql.example`.
Each is one transaction. Run with `-v ON_ERROR_STOP=1` (do NOT use `-1`; the files carry their own BEGIN/COMMIT), so a failure stops and rolls back that file.

| File | Run as | Purpose |
|---|---|---|
| 003b `portal_platform_role` | `postgres` | `portal_platform` (LOGIN, no password in the file, no table grants yet) |
| 004 `portal_reader_roles` | `postgres`, **in `jaysnet_data`** | `portal_reader_wr`, `portal_reader_adars` (SELECT on one tracking table each; LOGIN, no password in the file) |
| 005 `orgs_memberships` | `portal_owner` | `app_orgs`, `app_memberships`, `is_platform_admin`, `org_id` on `app_user_projects` |
| 006 `content` | `portal_owner` | content tree, versions, grants |
| 007 `integrations_datasets` | `portal_owner` | allowed hosts, integrations, datasets, fields |
| 008 `settings` | `portal_owner` | `app_settings` |
| 009 `audit_backfill` | `portal_owner` | audit columns, WorldRisk backfill |
| 010 `rls_grants` | `portal_owner` | RLS + grants to `portal_app` and `portal_platform`, credential function (apply WITH the M5 app release) |
| 011 `seed_managed_sources` | `postgres` (bypasses RLS; the file refuses anyone else) | global host `localhost:5432` + one managed `env:` integration per org (no credential) |
| 012 `session_version` | `portal_owner` | `app_users.token_version` + column UPDATE grant for `portal_app` (ending sessions; used only with `SESSION_VERSION=1`) |

Apply order: the "Cut-over order" above. Rollback: 012 → 011 → 010 → 009 → 008 → 007 → 006 → 005 → 003b (004's rollback is independent too).
**Passwords are never in a file.** 003b and 004 create the roles with LOGIN and no password; Jay sets each one by hand with `\password` (section 1). A role without a password cannot log in (scram/md5).
005 to 009 are safe for the CURRENT app (additive; legacy `app_users.role` and the old reads still work). 010 changes behaviour for it (see "010 cut-over").

## 0. Pre-flight

1. **Fresh vzdump** of the LXC, taken now, verified restorable (or at least listed in the backup storage). Note the vmid/timestamp: ______
2. **Stop point**: no one else is logged in; Grafana (:3000) and the sync scripts in `/opt/jaysnet` untouched. The portal on :3002 may stay up for 004 to 009; stop it for 010 until the M5 release is deployed.
3. **Who runs what**: `sudo -u postgres psql` works; after 0A step 3, `psql -U portal_owner -d omnimetrics_portal -h localhost` works.
4. **Confirm roles** (as postgres, in `jaysnet_data`):
   ```sql
   SELECT rolname, rolsuper, rolcreaterole, rolbypassrls, rolcanlogin FROM pg_roles
     WHERE rolname IN ('jaysnet_admin','portal_app','portal_platform','grafana_reader','portal_reader','portal_reader_wr','portal_reader_adars');
   -- expect: portal_app NOT super/bypassrls; note which portal_platform / portal_reader_* exist (0A steps 6, 7, 10)
   SELECT tablename, tableowner FROM pg_tables WHERE tablename LIKE 'app\_%' ESCAPE '\';
   -- expect: app_users, app_user_projects, app_audit_log (the legacy copies that 0A reads)
   SELECT has_table_privilege('portal_app','worldrisk_tracking','SELECT'), has_table_privilege('portal_app','adars_tracking','SELECT'); -- f, f
   ```
5. **Backups that dump databases**: see the end of section 0A. Look (read-only; do not edit /etc/cron.d from here): `crontab -l`, `sudo crontab -l`, `ls /etc/cron.d`.
6. **pg_hba.conf** (as postgres; the new roles have NO password until you set one, so a `trust` line would let them in without one):
   ```sql
   SELECT line_number, type, database, user_name, address, auth_method FROM pg_hba_file_rules ORDER BY line_number;
   -- expect: no 'trust' (and no 'peer'/'ident' that maps to these roles) matching portal_app, portal_platform, portal_reader_wr, portal_reader_adars;
   -- host lines for them use scram-sha-256. Fix pg_hba.conf (outside this repo) BEFORE creating the roles.
   ```
7. **Time-zone decision for 004** (R6 relevant): run the two queries in the 004 header (Grafana's effective timezone; stored zone of `row_modified_at`). Edit the two `ALTER ROLE ... SET timezone` lines if the answer is not `Africa/Johannesburg`. Record the outcome in `docs/DECISIONS.md` if any number can change.
8. **Passwords** for the three new roles (`portal_reader_wr`, `portal_reader_adars`, `portal_platform`) generated with `openssl rand -base64 32` and kept in your password manager. They go only into `\password` (section 1) and then into `.env` (`DATABASE_URL_READONLY_WR`, `DATABASE_URL_READONLY_ADARS`, `DATABASE_URL_PLATFORM`). Nothing is typed into a file or onto a command line. The real `003_*.sql` / `004_*.sql` copies stay git-ignored (`.gitignore` lines kept).
9. **Env list for the M5 release** (`.env`, outside git): `DATABASE_URL` (portal_app, `omnimetrics_portal`), `DATABASE_URL_PLATFORM` (portal_platform, `omnimetrics_portal`; used ONLY by `withPlatform()`, never given to any other code path), `DATABASE_URL_READONLY_WR`, `DATABASE_URL_READONLY_ADARS` (`jaysnet_data`), `INTEGRATION_KEYS`. The only `env:` credential sources the schema accepts are `env:DATABASE_URL_READONLY_<NAME>`.
10. **Test database green first**: `db/test/setup_test_db.sql.example` applied, 001 and 005 to 012 applied there (`sudo bash db/test/rebuild_portal_test.sh.example` does all of it, section 8), and `db/test/smoke_m5.sql.example` run once as `portal_test_app` and once as `portal_test_platform` with `0 FAILED, 0 skipped` (section 6). Do not start section 1 before this.
11. **Row snapshot**: 0A step 5 compares the portal rows. The users/projects counts there are the expected membership and project-row counts after 009: ______ / ______.
12. **Note `INTEGRATION_KEYS`** is NOT needed for these files (no credential is stored). It is needed when the app is released with `PORTAL_DATA=pg`: generate and back it up first (section 10).

## 0A. Move the portal's own tables out of jaysnet_data

Ruling (2026-11-27, DECISIONS "Portal database"): `jaysnet_data` is an EXTERNAL data source, like any client's database. The portal's `app_*` tables live in their own database, `omnimetrics_portal`, owned by `portal_owner`. All by Jay, by hand, in this order. `jaysnet_admin` owns nothing in the new database (the untouched legacy copies in `jaysnet_data` stay its until they are dropped).

Run from `/opt/omnimetrics-portal`. Stop at the first error.

**1. Fresh vzdump** of the LXC (on the Proxmox host). Note vmid/timestamp: ______

**2. Stop the portal** on :3002 (no new logins or audit rows during the copy), then look:
```bash
# the legacy tables must still have the 001 shape: 3 tables, no org_id / is_platform_admin / token_version
sudo -u postgres psql -d jaysnet_data -c "SELECT table_name, column_name FROM information_schema.columns WHERE table_name LIKE 'app\_%' ORDER BY 1, ordinal_position"
# which roles already exist (they are cluster-wide, not per database)
sudo -u postgres psql -tAc "SELECT rolname FROM pg_roles WHERE rolname IN ('portal_owner','portal_app','portal_platform','portal_reader_wr','portal_reader_adars') ORDER BY 1"
```
If there are more `app_*` tables or columns than 001 makes, STOP: some M5 file was applied to `jaysnet_data` and this procedure does not cover that.

**3. Role and database** (`sudo -u postgres psql`):
```sql
CREATE ROLE portal_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
\password portal_owner
CREATE DATABASE omnimetrics_portal OWNER portal_owner;
REVOKE ALL ON DATABASE omnimetrics_portal FROM PUBLIC;   -- or every login on the cluster (Grafana's too) may connect
```
Check `pg_hba.conf` lets `portal_owner`, `portal_app` and `portal_platform` reach `omnimetrics_portal` with a password (no `trust`).

**4. 001** in the new database:
```bash
psql -v ON_ERROR_STOP=1 -U portal_owner -d omnimetrics_portal -h localhost -f db/migrations/001_app_tables.sql
```

**5. Copy the three legacy tables** (as postgres; `jaysnet_data` is only read):
```bash
set -o pipefail
sudo -u postgres pg_dump --data-only -t app_users -t app_user_projects -t app_audit_log jaysnet_data \
  | sudo -u postgres psql -X -v ON_ERROR_STOP=1 --single-transaction -d omnimetrics_portal
sudo -u postgres psql -v ON_ERROR_STOP=1 -d omnimetrics_portal -c "SELECT setval('app_audit_log_id_seq', COALESCE((SELECT max(id) FROM app_audit_log), 1), (SELECT count(*) > 0 FROM app_audit_log))"
# row counts: the two outputs must be identical
for db in jaysnet_data omnimetrics_portal; do
  echo "== $db"; sudo -u postgres psql -tA -d "$db" -c "SELECT (SELECT count(*) FROM app_users) users, (SELECT count(*) FROM app_user_projects) projects, (SELECT count(*) FROM app_audit_log) audits"
done
```

**6. 003.** If `portal_app` did NOT exist in step 2, copy, set the password and run the file as its header says. It normally exists (the portal already uses it), and then `CREATE ROLE` would fail, so run only its other statements:
```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 -d omnimetrics_portal <<'SQL'
BEGIN;
ALTER ROLE portal_app SET statement_timeout = '10s';
GRANT CONNECT ON DATABASE omnimetrics_portal TO portal_app;
GRANT USAGE ON SCHEMA public TO portal_app;
GRANT SELECT, INSERT, UPDATE ON app_users TO portal_app;
GRANT SELECT, INSERT, DELETE ON app_user_projects TO portal_app;
GRANT SELECT, INSERT ON app_audit_log TO portal_app;
GRANT USAGE, SELECT ON SEQUENCE app_audit_log_id_seq TO portal_app;
COMMIT;
SQL
```

**7. 003b.** If `portal_platform` did not exist:
```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 -d omnimetrics_portal -f db/migrations/003b_portal_platform_role.sql.example
sudo -u postgres psql -d omnimetrics_portal     # then: \password portal_platform
```
If it already existed:
```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 -d omnimetrics_portal <<'SQL'
BEGIN;
ALTER ROLE portal_platform SET statement_timeout = '10s';
GRANT CONNECT ON DATABASE omnimetrics_portal TO portal_platform;
GRANT USAGE ON SCHEMA public TO portal_platform;
COMMIT;
SQL
```

**8. 005 to 009, then the director.** 009 ONCE, before the portal creates any login:
```bash
for f in 005_orgs_memberships 006_content 007_integrations_datasets 008_settings 009_audit_backfill; do
  psql -v ON_ERROR_STOP=1 -U portal_owner -d omnimetrics_portal -h localhost -f db/migrations/$f.sql.example || break
done
psql -v ON_ERROR_STOP=1 -U portal_owner -d omnimetrics_portal -h localhost -c "UPDATE app_users SET is_platform_admin = true WHERE username = 'Jay'"
```

**9. 010, 011, 012:**
```bash
psql -v ON_ERROR_STOP=1 -U portal_owner -d omnimetrics_portal -h localhost -f db/migrations/010_rls_grants.sql.example
sudo -u postgres psql -v ON_ERROR_STOP=1 -d omnimetrics_portal -f db/migrations/011_seed_managed_sources.sql.example
psql -v ON_ERROR_STOP=1 -U portal_owner -d omnimetrics_portal -h localhost -f db/migrations/012_session_version.sql.example
```
Then the checks of section 2 against `omnimetrics_portal`.

**10. 004, if the reader roles did not exist: the ONLY change to the external database.** It runs in `jaysnet_data` (section 1, with its timezone decision and `\password`).

**11. App env** (outside git), then restart the portal:
- `DATABASE_URL` -> `portal_app` on `omnimetrics_portal`
- `DATABASE_URL_PLATFORM` -> `portal_platform` on `omnimetrics_portal`
- `DATABASE_URL_READONLY_WR`, `DATABASE_URL_READONLY_ADARS` -> **unchanged target: `jaysnet_data`** (reader roles of 004)

Sign in as before (same logins, same passwords). `SESSION_VERSION=1` only after this (section 9).

**Rollback:** point `DATABASE_URL` back at `jaysnet_data` and restart. The old tables there are NOT touched or dropped by any step above. Anything written to `omnimetrics_portal` since the switch (new logins, password changes, audit rows) is not in them. Dropping the old tables in `jaysnet_data` is a separate, later, explicit step; nothing here does it.

**Backups:** a `pg_dump` of the portal database must run as `postgres` (FORCE row-level security makes it fail as `portal_owner`):
```bash
sudo -u postgres pg_dump -Fc -d omnimetrics_portal -f <backup path>
```
Add the new database to whatever backs up PostgreSQL today; a dump of `jaysnet_data` no longer includes the portal's tables. vzdump covers both.

## 1. Apply

```bash
cd /opt/omnimetrics-portal
# 003b (postgres). No edit needed (no password in the file). If the role exists already: 0A step 7.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d omnimetrics_portal -f db/migrations/003b_portal_platform_role.sql.example
# 005 - 009 (portal_owner; the .example files hold no secrets and may be run directly)
for f in 005_orgs_memberships 006_content 007_integrations_datasets 008_settings 009_audit_backfill; do
  psql -v ON_ERROR_STOP=1 -U portal_owner -d omnimetrics_portal -h localhost -f db/migrations/$f.sql.example || break
done
# 010 only together with the M5 app release (see section 3)
psql -v ON_ERROR_STOP=1 -v app_role=portal_app -v platform_role=portal_platform -U portal_owner -d omnimetrics_portal -h localhost -f db/migrations/010_rls_grants.sql.example
# 011 (postgres, bypasses RLS; no secret in the file). After 010, once the M5 release is deployed or just before it:
sudo -u postgres psql -v ON_ERROR_STOP=1 -d omnimetrics_portal -f db/migrations/011_seed_managed_sources.sql.example
# 012 (portal_owner), after 010. Then the checks in section 2, and only then SESSION_VERSION=1 (section 9):
psql -v ON_ERROR_STOP=1 -v app_role=portal_app -v platform_role=portal_platform -U portal_owner -d omnimetrics_portal -h localhost -f db/migrations/012_session_version.sql.example
# 004 (postgres, in the EXTERNAL database: the only change to it). Copy, edit the timezone lines only if pre-flight 7 says so, then:
sudo -u postgres psql -v ON_ERROR_STOP=1 -d jaysnet_data -f db/migrations/004_portal_reader_roles.sql
```
**Set the three passwords by hand, right after 003b and 004** (as postgres, interactive; the password is not echoed, not logged, not in shell history):
```bash
sudo -u postgres psql
#   \password portal_platform
#   \password portal_reader_wr
#   \password portal_reader_adars
```
(`portal_app` already has its password from 003.) Until a password is set the role cannot log in; set them before the connection tests below.
Run the files one at a time and do the verification below after EACH; stop at the first red result and roll back that file (its own transaction already did, if it failed).

Set the director (manual, once, after 005; as `portal_owner` or `postgres`; replace the username if it differs):
```sql
UPDATE app_users SET is_platform_admin = true WHERE username = 'Jay';
```
After 010 `portal_app` cannot write that column, so this is the only way.

## 2. Verification after each file (psql as portal_owner in omnimetrics_portal unless noted)

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
Run 009 **once**. Do not re-run it as a check, and never after the portal has created logins (see "Cut-over order").

**After 010.** (The checks that name `worldrisk_tracking` or `adars_tracking` error here: those tables are not in this database, which is the point.)
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
SELECT proname, prosecdef, pg_get_userbyid(proowner) AS owner, proconfig FROM pg_proc WHERE proname='app_integration_credentials';  -- t, portal_owner, {search_path=pg_catalog, public}
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

**After 012.** Run the checks in its header (column `integer, NO, 0`; no row with a version other than 0; `portal_app` may UPDATE `token_version` but not INSERT it, has no table-wide UPDATE and cannot write `is_platform_admin`; `portal_platform` has nothing on `app_users`). The header's line "NO APP CODE USES IT YET" predates stage 2c: the app uses the column when `SESSION_VERSION=1`.

## 3. 010 cut-over (do not skip)

- Deploy the M5 app release (`PORTAL_DATA=pg`, `withOrg`/`withUser`/`withPlatform`, `requireOrg`, per-org loadUser) in the same window as 010. Between 010 and that release the old app sees no project rows for builders/viewers and no audit rows (fails closed).
- The release must set per transaction: `app.org_id` (withOrg) and `app.user_id` (org switcher, requireOrg, user settings). There is NO `app.is_platform` setting any more: `withPlatform()` must open its connection with `DATABASE_URL_PLATFORM` (login role `portal_platform`) and nothing else may use that URL. Audit inserts must not use `RETURNING` (non-platform callers cannot see org-less rows).
- Integration credentials: the connector reads them only via `SELECT * FROM app_integration_credentials($1)` inside `withOrg`; list queries select named columns (never `SELECT *` on `app_integrations`; it fails for `portal_app` by design) and use `has_credentials`. `env:` integrations are created only by 011 (as `postgres`); `portal_app` can list them but UPDATE and DELETE touch 0 rows, and the app must show them read-only (see "Open points").
- The host allowlist is read-only for `portal_app`; adding a host is a platform-path (`portal_platform`) action.
- Existing sessions: roles come from memberships after the cut-over; check that no user gained access (compare the pre-010 `allowed_projects` per user with the new one).
- Do not enter any real integration credential until the isolation matrix is green; do not create client logins before TOTP (R7 hardening).

- **Never re-run 009 after the portal has created logins:** its backfill gives every `app_users` row a WorldRisk membership, including people added to another organisation only.
- The one-time password (add user, reset) is shown once in a panel on the Users and Accounts screens (stage 2c).
- Pg functions in this release (stage 2b): `organisations.list/create/update`; `users.list/add/link/update`; `account.changePassword/resetPassword`; `settings.get/set`; `writeAudit`. Stage 2c adds `account.revokeSessions` (needs `SESSION_VERSION=1`); stage 3 adds `integrations.*` and the allowed hosts (needs `INTEGRATION_KEYS`, section 10). Still fail closed: `users.memberships`, `accounts.sessions/revoke`, `account.sessions/revoke` (the session list and revoking one session have no schema), tracking-scope editing.
- Until 012 is applied AND `SESSION_VERSION=1`, a password change or reset does NOT end existing sessions (a token stays valid until it expires). 012: run as `portal_owner`, after 010; roll back before 010.

## 4. Roll back (reverse order, each as its listed role; copy each `.down.sql.example` and run)

This undoes single migrations inside `omnimetrics_portal`. To go back to the old database altogether, use the rollback in section 0A.

**012 first, and only after `SESSION_VERSION` is unset and the portal restarted** (with the flag on and no column, every signed-in request answers 503):
```bash
psql -v ON_ERROR_STOP=1 -U portal_owner -d omnimetrics_portal -h localhost -f db/migrations/012_session_version.down.sql.example
sudo -u postgres psql -v ON_ERROR_STOP=1 -d omnimetrics_portal -f db/migrations/011_seed_managed_sources.down.sql.example   # next; deletes the 2 managed integrations (+ datasets on them) and the global localhost host
psql -v ON_ERROR_STOP=1 -v app_role=portal_app -v platform_role=portal_platform -U portal_owner -d omnimetrics_portal -h localhost -f db/migrations/010_rls_grants.down.sql.example
for f in 009_audit_backfill 008_settings 007_integrations_datasets 006_content 005_orgs_memberships; do
  psql -v ON_ERROR_STOP=1 -U portal_owner -d omnimetrics_portal -h localhost -f db/migrations/$f.down.sql.example || break
done
sudo -u postgres psql -v ON_ERROR_STOP=1 -d jaysnet_data -f db/migrations/004_portal_reader_roles.down.sql.example   # stop anything using the reader roles first
sudo -u postgres psql -v ON_ERROR_STOP=1 -d omnimetrics_portal -f db/migrations/003b_portal_platform_role.down.sql.example  # after 010's rollback
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

## 6. Smoke test in the throwaway database (BEFORE section 1, and again after any edit to 006/007/010/012)

`portal_test` only; never `jaysnet_data`. The file refuses to run elsewhere, runs inside one transaction and always ends with `ROLLBACK`.
```bash
# first: sudo bash db/test/rebuild_portal_test.sh.example   (001, 005-012, fresh passwords). Then, from the repository root:
for who in APP PLATFORM; do
  psql -q -v ON_ERROR_STOP=1 "$(grep "^TEST_DATABASE_URL_$who=" apps/web/.env.test | cut -d= -f2-)" -f db/test/smoke_m5.sql.example 2>&1 | grep -E 'FAIL|SKIP|passed'
done
```
011 (applied by the rebuild script) is the only way to create an `env:` row, and tests 535 to 538 (UPDATE and DELETE of an env: row touch 0 rows; other org cannot touch it) use it. Without it they print `SKIP`.
New in this version, all as `portal_test_app`: 250 to 252 (INSERT, UPDATE, DELETE on `app_allowed_hosts` refused by privilege), 535 to 538 (env: row), 131 (no org-owned host rows without context; the global `localhost` row is readable by design); 412 now uses `RETURNING id` (a constant RETURNING does not trigger the SELECT policy).
Tests 540 to 547 and 771 are the 012 checks (column, default, grants, a bump). Expected: one line each, `smoke_m5 (portal_test_app): N passed, 0 FAILED, 0 skipped` and `smoke_m5 (portal_test_platform): N passed, 0 FAILED, 0 skipped`; no line starting `FAIL` or `SKIP`. Any FAIL line names the test number, what was expected and what happened: stop, do not apply to the real databases, send the output back.

## 7. Open points (decide before the M5 release)

- The Organisations screen shows 0 integrations in pg: counting them needs a grant decision (DECISIONS P8).
- A stored integration cannot point at this server or the portal database's server (DECISIONS P3). Only the app enforces it.

- `env:` integrations are created only by 011 (as `postgres`). `portal_platform` has no grant on `app_integrations` and the owner is not the platform role, so the app can neither create nor change them; adding a third managed source later means another seed file as `postgres` (or a deliberate platform grant). The app must render managed rows read-only.
- `portal_app` is now `SELECT` only on `app_allowed_hosts`; adding a host needs the platform path (`portal_platform`, which keeps full DML there).

## 8. Application tests against the throwaway database (`pnpm test:db`, stage 2a)

`portal_test` only. The harness refuses to run unless `current_database()` is `portal_test` and the users are `portal_test_app` / `portal_test_platform`.
Needs `apps/web/.env.test` (git-ignored) with `TEST_DATABASE_URL_APP` and `TEST_DATABASE_URL_PLATFORM`; the rebuild script writes both.

```bash
cd /opt/omnimetrics-portal
sudo bash db/test/rebuild_portal_test.sh.example   # drops and recreates portal_test (001, 005-012), new passwords into .env.test
                                                   # must end with "ready for pnpm test:db"
pnpm test:db                                       # pg repositories: contract, isolation matrix, grants, context, session version
pnpm test                                          # unit tests (no database)
```
Every rebuild sets new random passwords for `portal_test_app` and `portal_test_platform` (nothing to type). `portal_test_owner` gets none.

The tests need two committed fixtures, both created by the rebuild script: the platform administrator `itest_director` (only postgres can set the flag) and, since stage 2b, `itest_linkable`, a login with no membership. To add the second to an existing `portal_test` without rebuilding (no password reset needed):
```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 -d portal_test -c "INSERT INTO app_users (username,email,hashed_password,role) VALUES ('itest_linkable','itest_linkable@example.test','!','viewer') ON CONFLICT (username) DO UPDATE SET is_active=true, is_platform_admin=false"
```
And the first:
```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 -d portal_test -c "INSERT INTO app_users (username,email,hashed_password,role,is_platform_admin) VALUES ('itest_director','itest_director@example.test','!','viewer',true) ON CONFLICT (username) DO UPDATE SET is_platform_admin=true, is_active=true"
```
Test data is rolled back (neither test role could delete it). The one committed write is the suspended/archived test, which changes the `adars` status and restores it; after an interrupted run, rebuild. The smoke test (section 6) still works afterwards.

## 9. Session version (`SESSION_VERSION`)

- Default **off**. Only the exact value `1` turns it on (`true` does not). It goes in the portal's env file outside git; restart the portal afterwards.
- Set it **only after 012** is applied. With it on and no column, every signed-in request answers 503 and login fails.
- Turning it on signs nobody out: tokens without `tv` count as version 0, which is every login's version after 012.
- On: a password change, reset or "sign out everywhere" (`POST /api/portal/account` `{"op":"revoke_all"}`) ends that person's other sessions. Change and revoke keep the current session (same expiry).
- It takes effect through the pg data layer (`PORTAL_DATA=pg`). With the mock portal nothing bumps the version.
- Turning it off again makes ended tokens valid until they expire. To end every session then, change `JWT_SECRET`.

## 10. Integration credential keys (`INTEGRATION_KEYS`)

Stored integration credentials are encrypted with AES-256-GCM. The key is NOT in the database.

**LOSS OF THE KEY MEANS STORED CREDENTIALS CANNOT BE RECOVERED.** Every stored integration would have to be entered again.

1. Generate: `openssl rand -base64 32`
2. Put it in the portal's env file outside git: `INTEGRATION_KEYS=k1:<base64>`. The id (`k1`) is 1 to 32 characters of `a-z 0-9 _ -`; the key is exactly the 44-character output above.
3. **Keep a copy in the password manager** before entering any credential. A vzdump holds the env file next to the encrypted rows: protect backups accordingly.
4. Restart the portal. A missing or malformed value disables every integration function and logs one line naming `INTEGRATION_KEYS` (never the value).

**Rotation** (the first entry encrypts, every entry decrypts):
1. Generate a new key and add it **FIRST**: `INTEGRATION_KEYS=k2:<new>,k1:<old>`. Keep both in the password manager. Restart.
2. Re-enter each stored credential on the Integrations screen (Edit, Replace credentials, database user and password). There is no re-encryption script yet.
3. See what still uses the old key (as `postgres`):
   `SELECT o.slug, i.name, i.cred_key_id FROM app_integrations i JOIN app_orgs o ON o.id = i.org_id WHERE i.cred_key_id IS NOT NULL ORDER BY 3, 1, 2;`
4. Only when no row shows `k1`, remove the old key **last**: `INTEGRATION_KEYS=k2:<new>`. Restart.

**Managed rows** (011) store nothing: testing one reads `DATABASE_URL_READONLY_WR` / `_ADARS` (user and password only; host, port, database and TLS come from the row).

**What the database does not enforce:** nothing in 007 or 010 ties `app_integrations.host` to `app_allowed_hosts`. Only the app checks it, on every save and again on every test.

Verification certificates come from Node's root store. For `verify-ca` / `verify-full` against a private CA, set `NODE_EXTRA_CA_CERTS`.
