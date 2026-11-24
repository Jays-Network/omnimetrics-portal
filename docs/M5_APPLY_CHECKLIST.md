# M5 Apply Checklist (migrations 004 to 010)

Applied BY JAY, by hand. Claude writes the SQL and never runs it against `jaysnet_data`.
Files live in `db/migrations/` as `NNN_name.sql.example` with a matching `NNN_name.down.sql.example`.
Each is one transaction. Run with `-v ON_ERROR_STOP=1` (do NOT use `-1`; the files carry their own BEGIN/COMMIT), so a failure stops and rolls back that file.

| File | Run as | Purpose |
|---|---|---|
| 004 `portal_reader_roles` | `postgres` | `portal_reader_wr`, `portal_reader_adars` (SELECT on one tracking table each) |
| 005 `orgs_memberships` | `jaysnet_admin` | `app_orgs`, `app_memberships`, `is_platform_admin`, `org_id` on `app_user_projects` |
| 006 `content` | `jaysnet_admin` | content tree, versions, grants |
| 007 `integrations_datasets` | `jaysnet_admin` | allowed hosts, integrations, datasets, fields |
| 008 `settings` | `jaysnet_admin` | `app_settings` |
| 009 `audit_backfill` | `jaysnet_admin` | audit columns, WorldRisk backfill |
| 010 `rls_grants` | `jaysnet_admin` | RLS + grants to `portal_app` (apply WITH the M5 app release) |

Order: 004 can go any time after the pre-flight. 005 → 006 → 007 → 008 → 009 → 010. Rollback is the exact reverse: 010 → 009 → 008 → 007 → 006 → 005 → 004.
005 to 009 are safe for the CURRENT app (additive; legacy `app_users.role` and the old reads still work). 010 changes behaviour for it (see "010 cut-over").

## 0. Pre-flight

1. **Fresh vzdump** of the LXC, taken now, verified restorable (or at least listed in the backup storage). Note the vmid/timestamp: ______
2. **Stop point**: no one else is logged in; Grafana (:3000) and the sync scripts in `/opt/jaysnet` untouched. The portal on :3002 may stay up for 004 to 009; stop it for 010 until the M5 release is deployed.
3. **Who runs what**: `sudo -u postgres psql` works; `psql -U jaysnet_admin -d jaysnet_data -h localhost` works.
4. **Confirm roles and owners** (as postgres):
   ```sql
   SELECT rolname, rolsuper, rolcreaterole, rolbypassrls, rolcanlogin FROM pg_roles
     WHERE rolname IN ('jaysnet_admin','portal_app','grafana_reader','portal_reader','portal_reader_wr','portal_reader_adars');
   -- expect: portal_app NOT super/bypassrls; portal_reader_* absent; jaysnet_admin NOT superuser (it may be; note it)
   SELECT tablename, tableowner FROM pg_tables WHERE tablename LIKE 'app\_%' ESCAPE '\';
   -- expect: app_users, app_user_projects, app_audit_log all owned by jaysnet_admin
   SELECT has_table_privilege('portal_app','worldrisk_tracking','SELECT'), has_table_privilege('portal_app','adars_tracking','SELECT'); -- f, f
   ```
5. **Backups that dump the database**: if any cron or script runs `pg_dump` on `jaysnet_data` as `jaysnet_admin`, it will FAIL on the tenant tables after 010 (row_security is off during pg_dump and the owner is forced). Look (read-only; do not edit /etc/cron.d from here): `crontab -l`, `sudo crontab -l`, `ls /etc/cron.d`. Switch such a job to `postgres` before 010. vzdump is unaffected.
6. **Time-zone decision for 004** (R6 relevant): run the two queries in the 004 header (Grafana's effective timezone; stored zone of `row_modified_at`). Edit the two `ALTER ROLE ... SET timezone` lines if the answer is not `Africa/Johannesburg`. Record the outcome in `docs/DECISIONS.md` if any number can change.
7. **Passwords** for the two reader roles generated (`openssl rand -base64 32`), kept out of the repo; the real `004_*.sql` copy is git-ignored (add it to `.gitignore` first).
8. **Row snapshot** (baseline for later comparison):
   ```sql
   SELECT (SELECT count(*) FROM app_users) users, (SELECT count(*) FROM app_user_projects) projects, (SELECT count(*) FROM app_audit_log) audits,
          (SELECT count(*) FROM worldrisk_tracking) wr_rows, (SELECT count(*) FROM adars_tracking) adars_rows;
   ```
   Users/projects: ______ / ______ (these are the expected membership and project-row counts after 009).
9. **Note `INTEGRATION_KEYS`** is NOT needed for these files (no credential is stored). It is needed only when the app is released.

## 1. Apply

```bash
cd /opt/omnimetrics-portal
# 004 (postgres). Copy, edit passwords + timezone, then:
sudo -u postgres psql -v ON_ERROR_STOP=1 -d jaysnet_data -f db/migrations/004_portal_reader_roles.sql
# 005 - 009 (jaysnet_admin; the .example files hold no secrets and may be run directly)
for f in 005_orgs_memberships 006_content 007_integrations_datasets 008_settings 009_audit_backfill; do
  psql -v ON_ERROR_STOP=1 -U jaysnet_admin -d jaysnet_data -h localhost -f db/migrations/$f.sql.example || break
done
# 010 only together with the M5 app release (see section 3)
psql -v ON_ERROR_STOP=1 -v app_role=portal_app -U jaysnet_admin -d jaysnet_data -h localhost -f db/migrations/010_rls_grants.sql.example
```
Run the files one at a time and do the verification below after EACH; stop at the first red result and roll back that file (its own transaction already did, if it failed).

Set the director (manual, once, after 005; as `jaysnet_admin` or `postgres`; replace the username if it differs):
```sql
UPDATE app_users SET is_platform_admin = true WHERE username = 'Jay';
```
After 010 `portal_app` cannot write that column, so this is the only way.

## 2. Verification after each file (psql as jaysnet_admin unless noted)

**After 004 (as postgres).** Run checks 1 to 5 in the file header. Expected: both roles `login t, super f, bypassrls f, inherit f`; settings `statement_timeout=10s, default_transaction_read_only=on, timezone=Africa/Johannesburg`; privilege matrix `t f t f`; exactly two rows in the "every readable table" query (each role / its own table / SELECT); `app_users` not readable. Then, from the app host with the real password:
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
SELECT count(*) FROM information_schema.columns WHERE table_name='app_integrations_public' AND column_name LIKE 'cred\_%' ESCAPE '\';  -- 0
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
-- 3. policies
SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public' ORDER BY 1,2;
-- 4. privileges of portal_app (must be false)
SELECT has_table_privilege('portal_app','worldrisk_tracking','SELECT') AS wr,
       has_table_privilege('portal_app','adars_tracking','SELECT')     AS adars,
       has_table_privilege('portal_app','app_audit_log','UPDATE')      AS audit_upd,
       has_table_privilege('portal_app','app_audit_log','DELETE')      AS audit_del,
       has_table_privilege('portal_app','app_dashboard_versions','UPDATE') AS ver_upd,
       has_table_privilege('portal_app','app_dashboard_versions','DELETE') AS ver_del,
       has_table_privilege('portal_app','app_content_nodes','DELETE')  AS node_del,
       has_column_privilege('portal_app','app_users','is_platform_admin','UPDATE') AS plat_upd,
       has_column_privilege('portal_app','app_users','is_platform_admin','INSERT') AS plat_ins;   -- all false
-- 5. privileges it must have (all true)
SELECT has_table_privilege('portal_app','app_users','SELECT'), has_table_privilege('portal_app','app_audit_log','INSERT'),
       has_table_privilege('portal_app','app_dashboard_versions','INSERT'), has_table_privilege('portal_app','app_content_nodes','UPDATE'),
       has_column_privilege('portal_app','app_users','hashed_password','UPDATE');
-- 6. the readers cannot read app tables, and portal_app cannot bypass RLS
SELECT has_table_privilege('portal_reader_wr','app_users','SELECT') OR has_table_privilege('portal_reader_adars','app_content_nodes','SELECT');  -- false
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='portal_app';   -- f, f
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='portal_app'); -- 0
-- 7. RLS behaves (as portal_app, psql -U portal_app -h localhost):  expect 0 rows without context, rows with it
SELECT count(*) FROM app_memberships;                         -- 0
BEGIN; SELECT set_config('app.org_id', (SELECT id::text FROM app_orgs WHERE slug='worldrisk'), true); SELECT count(*) FROM app_memberships; ROLLBACK;  -- = worldrisk members
BEGIN; SELECT set_config('app.org_id', (SELECT id::text FROM app_orgs WHERE slug='adars'), true);      SELECT count(*) FROM app_memberships; ROLLBACK;  -- 0
INSERT INTO app_audit_log (action) VALUES ('m5-010-check');   -- allowed (org_id NULL); it can then not be updated or deleted
UPDATE app_audit_log SET action='x' WHERE action='m5-010-check';   -- ERROR permission denied
```

## 3. 010 cut-over (do not skip)

- Deploy the M5 app release (`PORTAL_DATA=pg`, `withOrg`/`withUser`/`withPlatform`, `requireOrg`, per-org loadUser) in the same window as 010. Between 010 and that release the old app sees no project rows for builders/viewers and no audit rows (fails closed).
- The release must set per transaction: `app.org_id` (withOrg), `app.user_id` (org switcher, requireOrg, user settings) and `app.is_platform` = `on` (withPlatform only).
- Existing sessions: roles come from memberships after the cut-over; check that no user gained access (compare the pre-010 `allowed_projects` per user with the new one).
- Do not enter any real integration credential until the isolation matrix is green; do not create client logins before TOTP (R7 hardening).

## 4. Roll back (reverse order, each as its listed role; copy each `.down.sql.example` and run)

```bash
psql -v ON_ERROR_STOP=1 -v app_role=portal_app -U jaysnet_admin -d jaysnet_data -h localhost -f db/migrations/010_rls_grants.down.sql.example
for f in 009_audit_backfill 008_settings 007_integrations_datasets 006_content 005_orgs_memberships; do
  psql -v ON_ERROR_STOP=1 -U jaysnet_admin -d jaysnet_data -h localhost -f db/migrations/$f.down.sql.example || break
done
sudo -u postgres psql -v ON_ERROR_STOP=1 -d jaysnet_data -f db/migrations/004_portal_reader_roles.down.sql.example   # stop anything using the reader roles first
```
Verify: `\dt app_*` lists only `app_users`, `app_user_projects`, `app_audit_log`; `SELECT count(*) FROM pg_policies WHERE schemaname='public'` is 0; row counts equal the baseline; `portal_app` privileges equal the 003 set. Down files DROP data created after go-live (content, versions, integrations, settings, memberships): after real use the safe rollback is restoring the vzdump.

## 5. After applying

- Update `docs/PROGRESS.md` (applied files, date, vzdump id, the timezone decision).
- Test database: `db/test/setup_test_db.sql.example` (instructions in its header); the tests never use `jaysnet_data`.
- Not in 005 to 010 (separate later files): `app_totp_secrets`, dropping legacy `app_users.role`, and the first two named datasets.
