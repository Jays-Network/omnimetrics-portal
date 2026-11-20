# Plan: Dashboard Builder, portal structure and multi-tenancy

Status: APPROVED with amendments (Jay, 2026-11-20). **M1 to M4 are UI on mock data only: no real table, migration, RLS, org enforcement, isolation test or stored credential before M5.** R7 is RULED (section 6).
Inputs read: CLAUDE.md, docs/CONTEXT.md (R1-R6), docs/PROGRESS.md, docs/design/DIRECTION.md, lib/auth.ts, lib/audit.ts, shell/nav.ts, db/migrations/001-003.
Principle: UI first on mock data, behind one typed interface, then real data. Every screen uses `components/fx` primitives, tokens only, data on `data` glass, and reads `data-fx` (no per-level `if`).

## 0. Naming (the R2 lesson: two kinds of "folder")

| Concept | Meaning | Code name | DB | UI label |
|---|---|---|---|---|
| Tracking folder | `folder_name` in worldrisk_tracking (Smartsheet) | `trackingFolder` | `app_user_projects.folder_name` (kept) | "Tracking scope" |
| Content folder | portal-owned tree node holding dashboards | `ContentNode` kind `folder` | `app_content_nodes` | "Folder" |
| Organisation | a tenant (company) | `org`, `orgId` | `app_orgs` | "Organisation" |
Rules: never `folder` alone in code; never `client` or `project` for an org; `allowed_projects` stays only inside existing `filters.ts`/`User` and is fed from `ctx.trackingFolders` (same semantics, now per org).

## 1. Shell, navigation, tabs

Top tabs (replace `NAV_ITEMS`; Overview/Alerts placeholders dropped, Q9): **Dashboards** | **Integrations** | **Admin** | **Settings**. Org switcher left of the tabs (platform users and multi-org users only).
- Dashboards: left file tree (org > folder > sub-folder > dashboard), right viewer. Tree is keyboard navigable (ARIA tree).
- Integrations: list + add/edit drawer, "Test connection", write-only credential field (M4).
- Admin (sub-tabs): Organisations (platform admin: all orgs; org admin: own org profile), Users (members, roles, grants, tracking scope), Accounts (Q4).
- Settings: system settings (section E).
Routes (all under the existing `/dashboard` so middleware stays as is): `/dashboard/o/[orgSlug]/dashboards`, `.../d/[nodeId]`, `.../d/[nodeId]/edit`, `.../integrations`, `.../admin/users`, `.../admin/accounts`, `.../settings`; platform-only `/dashboard/platform/organisations`. The `[orgSlug]` segment is a HINT, verified server-side on every request (section 3). Nodes are addressed by id, so renames never break links.

## 2. Content tree (portal-owned, separate from tracking)

`Organisation > Folder > Sub-folder (nestable) > Dashboard`. One table `app_content_nodes` (kind `folder|dashboard`), `parent_id` self-reference, max depth 8 (trigger), siblings unique by name, soft delete (`deleted_at`) for undo. Dashboards store their spec in `app_dashboard_versions` (append-only; "current" pointer; gives history and rollback for free).
Access: baseline by membership role, widened or narrowed by grants (section 3). No grant = invisible (default deny). Moving a node across orgs is impossible by construction (composite FK, below).

## 3. Multi-tenancy model

### 3.1 Concepts and mapping to existing roles
- **Platform admin** (the director): `app_users.is_platform_admin boolean`, set only by a manual SQL/script, never by the UI or API (no self-escalation). Sees all orgs, can switch, implicit org-admin in each. Every action still carries an `org_id` in the audit log.
- **Membership** `(org, user, role)` with role in `admin|builder|viewer` (the EXISTING roles, now per org). A user can be admin in ADARS and viewer in WorldRisk.
- **Grants** at org, folder or dashboard level: `access` in `view|edit|manage`. Folder grants inherit downward; the nearest explicit grant wins; deny is not modelled (keep it simple).
- Capabilities: admin = everything in the org (users, integrations, all content), but NOT the SQL terminal (director only, R7). builder = view/edit/create under granted folders, no integrations/users/terminal. viewer = view granted content only.
- **Tracking scope** (`app_user_projects`) gains `org_id`; unique `(org_id,user_id,folder_name)`; backfilled to the WorldRisk org so current behaviour is unchanged. `allowed_projects` is null only for org admin and platform admin; builders and viewers get their rows or `[]`. R1 (`test sheets` stripped for all roles) is untouched.
- `app_users.role` becomes legacy: backfilled into memberships, read by nothing after M5, dropped in a later migration.

### 3.2 The check every route and query must pass (fail closed)
1. `requireAuth()` -> identity (JWT `sub` only) and `is_active` from DB. JWT never carries org or role.
2. `requireOrg(user, orgSlug)` -> one indexed query on `app_orgs` + `app_memberships` (active membership, active org), or `is_platform_admin`. No membership = 404 (not 403: do not confirm the org exists). Returns `OrgCtx { orgId, role, trackingFolders, userId, isPlatform }`. The only way to build an `OrgCtx` is this function (branded type). Not cached for writes, SQL terminal or integrations; reads may use the existing 60s cache with `invalidateUserCache` on membership/role/grant change.
3. `ctx.can(action, resource)` -> capability from role + grants, deny by default.
4. Data layer: every repository function takes `OrgCtx` as its first parameter, never a raw org id string; every statement has `org_id = ${ctx.orgId}`; inserts set `org_id` from ctx; any `:id` from the URL is looked up WITH `org_id` (no IDOR: an id from another org simply returns 0 rows -> 404).
5. Integrity in the DB: tenant tables use composite keys `(org_id,id)` and composite FKs (`(org_id,parent_id) -> (org_id,id)`), so a row can never reference another org's row.
6. **Defence in depth (RLS):** tenant tables get Row-Level Security with policy `org_id = current_setting('app.org_id', true)::uuid`. `withOrg(ctx, fn)` runs `BEGIN; SELECT set_config('app.org_id', $1, true)`. `portal_app` is not the table owner and has no BYPASSRLS, so a forgotten `WHERE` or an unset setting returns zero rows. (The platform-level queries use a separate `withPlatform()` path that only platform admins can reach.)

### 3.3 Tests that prove isolation (Vitest + a real throwaway schema, M5)
Fixture: org A and org B, users `a_admin`, `a_viewer`, `b_admin`, a platform admin, a member of both, a deactivated member; nodes, versions, integrations, datasets, settings, audit rows in both.
- **Route manifest test:** every file under `app/api` and every protected page must be registered with a guard type (`public|auth|org|platform`); CI fails on an unregistered route (forces step 2 to exist everywhere).
- **Matrix test:** for every org route x resource type (dashboards, nodes, versions, integrations, datasets, users, memberships, grants, settings, audit rows, SQL terminal runs), an A user using B's ids on A's path, B's path, or no org gets 404/403 and zero B bytes; list endpoints return only A rows; counts match.
- Crafted JWT with extra org/role claims, spoofed org cookie/header/query: ignored.
- Deactivated membership or org: 404 immediately (no stale cache on writes).
- Shared user: A admin sees the shared user only with the A role and A grants, never the B role or B tracking scope; cannot edit or deactivate a platform admin.
- RLS tests: with wrong or unset `app.org_id`, `SELECT` on every tenant table returns 0 rows and `INSERT` of a foreign `org_id` fails. A schema test asserts every `app_*` tenant table has `org_id NOT NULL` + RLS enabled.
- Audit: A admin reads only A rows; `org_id IS NULL` (platform events) only for platform admin.
- Static guard test: a query file touching a tenant table without `org_id` fails lint (grep-level, advisory).

## 4. Builder UI (M3)

Layout (HUD, GlassPanel chrome, `data` tone behind charts): LEFT asset list (tabs: Data sources > datasets > fields with plain-language labels; Panel types; Saved panels). CENTRE canvas (grid, drag/resize, select, keyboard move/resize, snap, preview toggle). RIGHT config panel of blocks (section 4.1). BOTTOM collapsible SQL terminal (director / platform admin only, R7; hidden, not disabled, for everyone else; M3 UI is a shell over canned mock output).
### 4.1 Blocks produce a typed spec (no SQL from the browser)
`packages/types/panel-spec.ts` (Zod, versioned `v:1`): `{ dataset, filters[{field,op,value}], groupBy[{field,grain?}], measure{fn,field?}, chart, sort, limit }`; dashboard spec = `{ v, panels[{id,title,spec,layout{x,y,w,h}}], variables }`. Blocks map 1:1: **Filter** (stackable), **Group by** (max 2), **Measure** (count, count distinct, sum, avg, min, max), **Chart type** (bar, line, area, stat, table, pie, gauge; map later). Blocks snap into typed slots in a vertical stack (Scratch look: colour per block kind, notches, nesting depth 2 for AND/OR later). Field, op and function lists come from the dataset allowlist per role; invalid combos are un-droppable.
Server side `compilePanel(ctx, spec)`: re-validates the spec with Zod, checks every field/op/fn against the catalog and role, emits parameterized SQL, runs as `portal_reader`/org role with `statement_timeout` and row limit. Dataset **base filters are server-owned and injected first, not editable by a spec**: `folder_name` scope from `ctx.trackingFolders`, R1, workspace/ZZZ exclusions, FQM hardcode, ADARS `client_group` rules. Hand-tuned Grafana-parity logic (per-panel `best_date`, R6, D1 in DECISIONS.md) is NOT generic: it ships as **named datasets** (fixed server SQL, typed params). The generic compiler comes after parity.

## 5. Integrations (M4 = UI on mock only; real tables and credentials in M5)

Kinds: Postgres first; MySQL later (same `Connector` interface, read-only session); SQLite deferred (below). Per org, org-admin only. **No real credential is entered or stored until the M5 isolation test matrix is green.** Fields: name, host (picked from the allowlist, never free text), port, database, schema/relation allowlist, SSL mode, credentials.
- **Encryption:** AES-256-GCM, random 12-byte nonce per write, key from `INTEGRATION_KEYS` in `.env` (separate from `JWT_SECRET`, never derived from it), ciphertext stores `key_id`; AAD = `org_id|integration_id|key_id` so a ciphertext cannot be moved to another row or org. Rotation: add key k2, set active, a script re-encrypts rows (old key stays until none reference it). Plaintext exists only inside `lib/integrations/secrets.ts` on the server; a test fails if any `'use client'` module can import it.
- **Write-only:** API returns `{ hasCredentials, keyId, rotatedAt }`, never the secret, never in errors, logs or audit detail (redaction helper). Edit form shows "Replace credentials"; empty = keep.
- **SSRF:** `app_allowed_hosts` (platform-admin managed; optional per-org scope; host + port range). Connector resolves DNS itself, rejects loopback/link-local/private/metadata ranges unless that exact entry is allowlisted, connects to the pinned IP (no rebinding), verified TLS for non-local hosts, 5s connect timeout, generic error text, test-connection rate-limited and audited. Org admins cannot add hosts.
- **Local source:** the portal's own `jaysnet_data` appears as a managed integration (`credential_source = env:DATABASE_URL_READONLY`, no stored secret), allowlisted for WorldRisk and ADARS orgs only, each with its OWN env URL and DB role (`DATABASE_URL_READONLY_WR` -> `portal_reader_wr`, `DATABASE_URL_READONLY_ADARS` -> `portal_reader_adars`).
- **SQLite: defer past M5.** It is filesystem access (path traversal, `ATTACH`, `load_extension`, reading any file the process can read, writing a DB file). If ever built: uploaded files only, into a portal-owned directory, opened read-only in a worker, extensions off, `ATTACH` blocked, size cap. No user-typed paths, ever.

## 6. SQL terminal: R7 (RULED by Jay, 2026-11-20)

**R7: the SQL terminal is for the director (platform admin) ONLY in v1, not org admins. Widening it needs a new ruling.** Hard-rule wording now in CLAUDE.md: "Never accept raw SQL from the browser, except through the director-only SQL terminal (R7)." No other route, panel, spec or role may accept SQL text.
Scope of R7: one statement that a PostgreSQL parser confirms is a plain `SELECT`/`WITH ... SELECT`/`VALUES`, inside a `READ ONLY` transaction that is always rolled back, with `statement_timeout`, `lock_timeout`, a 1,000-row cap, a result-size cap and a parser-checked relation allowlist, against integrations of the ACTIVE organisation only. Every execution, including rejected ones, is audit-logged. Terminal SQL is never saved into a panel spec (decision 5) and never run on behalf of another user. Results are unfiltered by R1 and are labelled as such. Mock only in M3; real in M5, and only after TOTP (below) is in place for the director.
Enforcement design:
- **Parser, not strings:** real Postgres grammar (libpg-query/pgsql-parser, WASM; a new dependency, ask first). One statement only; reject everything but `SelectStmt`; no `INTO`, `FOR UPDATE/SHARE`, no data-modifying CTEs, no `EXPLAIN ANALYZE`; function-call allowlist (reject `pg_read_file`, `pg_sleep`, `dblink`, `lo_*`, `set_config`, `nextval`, advisory locks, `pg_terminate_backend` etc.); extract every relation from the parse tree and require it in the integration's relation allowlist; qualified names only (`search_path` set empty).
- **Run:** `BEGIN READ ONLY; SET LOCAL statement_timeout, lock_timeout, idle_in_transaction_session_timeout; ... SELECT * FROM (<stmt>) t LIMIT 1001; ROLLBACK`. The DB role is itself read-only (`portal_reader`), so the parser is not the only layer. One concurrent run per user, rate-limited via the existing limiter.
- **Audit row:** user, org, integration, SHA-256 + first 4 KB of text, verdict (ok / rejected + reason), rows, ms.
- **Cross-org inside one database (decided, Q6):** one DB role per org: `portal_reader_wr` (SELECT on `worldrisk_tracking` only) and `portal_reader_adars` (SELECT on `adars_tracking` only). The terminal connects with the role of the org it is run against, so the DB, not only the parser, enforces separation. The existing `db/migrations/004_portal_reader_role.sql.example` (single `portal_reader`) MUST be reworked for two roles, with a matching `getReadonlyDb(org)` and per-org env URLs. Not written yet; Step 3 waits for it.

## A. Data model (migration outline; ALL of this is built and applied in M5 only, by Jay as `jaysnet_admin`, not by me)

`org_id UUID NOT NULL` + RLS on every tenant table (T). Files: 005 orgs/memberships, 006 content, 007 integrations/datasets, 008 settings, 009 audit + backfill, 010 RLS + grants to `portal_app`.
| Table | Key columns | Notes |
|---|---|---|
| `app_orgs` | id, slug UNIQUE, name, status, created_at | seed WorldRisk, ADARS |
| `app_users` (alter) | + `is_platform_admin` default false | manual set only |
| `app_memberships` T | id, org_id, user_id, role CHECK admin\|builder\|viewer, is_active, UNIQUE(org_id,user_id) | replaces `app_users.role` |
| `app_user_projects` (alter) T | + org_id; UNIQUE(org_id,user_id,folder_name); FK (org_id,user_id) -> memberships | tracking scope |
| `app_content_nodes` T | id, org_id, parent_id, kind, name, position, depth, deleted_at, created_by; UNIQUE(org_id,id); FK(org_id,parent_id) | tree |
| `app_dashboard_versions` T | id, org_id, node_id, version, spec jsonb, created_by, created_at; UNIQUE(node_id,version) | + `current_version` on node |
| `app_grants` T | id, org_id, user_id, node_id NULL (null = whole org), access view\|edit\|manage; UNIQUE(org_id,user_id,node_id) | FK (org_id,node_id) |
| `app_allowed_hosts` | id, org_id NULL, host, port_min, port_max, added_by | platform admin only |
| `app_integrations` T | id, org_id, kind, name, host, port, database, ssl_mode, relation_allowlist text[], cred_ciphertext bytea, cred_nonce bytea, cred_key_id, credential_source, status, rotated_at | secrets never selected by list queries |
| `app_datasets` T | id, org_id, integration_id, key, label, relation or named_query, base_filter_ref, hidden_roles text[] | catalog |
| `app_dataset_fields` T | dataset_id, org_id, column, label, type, aggregatable, hidden_roles text[] | allowlist |
| `app_settings` | scope system\|org\|user, org_id NULL, user_id NULL, key, value jsonb; CHECKs per scope; UNIQUE per scope+key | section E |
| `app_totp_secrets` | user_id PK, secret ciphertext + nonce + key_id (same AES-GCM scheme), recovery codes (hashed), enabled_at | platform admins; see Hardening |
| `app_audit_log` (alter) | + org_id NULL (null = platform event), target_type, target_id, ip | index (org_id, created_at) |
Tracking tables are untouched. No migration writes to worldrisk_tracking or adars_tracking.

## C. One data-access interface (mock and real swap with no UI change)

`packages/types/portal.ts` holds the types and Zod schemas; `apps/web/lib/portal/` holds `interface Portal { orgs; content; dashboards; integrations; datasets; settings; admin; audit; query: { runPanel(ctx,spec); runTerminal(ctx,integrationId,sql) } }`. Every method takes `OrgCtx` first and returns plain typed DTOs (no secrets, no `org_id` leakage beyond need). Implementations `lib/portal/mock/` and `lib/portal/pg/`; `getPortal()` picks by `PORTAL_DATA=mock|pg`. Server components and route handlers call only `getPortal()`; client components get data via the same route handlers (TanStack Query), so M5 changes zero UI files.
Mock safety: `PORTAL_DATA=mock` is refused at startup when `NODE_ENV=production`; the mock module is loaded by dynamic import only in development (a test asserts it is absent from the production build); mock never opens a DB connection (terminal returns canned rows) and never touches auth: the real login and `requireAuth` stay on. Mock orgs/memberships are keyed to the real logged-in user (existing admin = platform admin in mock); a dev-only "preview as role" can only REDUCE capability. Shell shows a persistent MOCK badge. Mock numbers are seeded and obviously fake.

## D. Libraries (nothing installed; sizes are rough gzip, to be measured in an M3 spike with the bundle analyser and React 19 peer check)

| Need | Candidate | Size | Accessibility | Effort | Verdict |
|---|---|---|---|---|---|
| Drag and drop | dnd-kit (core + sortable) | ~15-20 kB | Best of the set: keyboard sensor, announcements | Low | **Use** for asset-to-canvas and block reordering |
| Grid layout | react-grid-layout (+ react-resizable) | ~25-30 kB | Pointer only; add our own arrow-key move/resize on the selected panel | Low-medium | **Use** for the canvas; layout state is plain `{x,y,w,h}` so it is replaceable |
| Grid layout | custom CSS grid + dnd-kit | ~0 extra | Full control | High (collision, resize, responsive) | Fallback if RGL fails the React 19 check |
| Blocks | Blockly | ~200-250 kB gz core + blocks/msgs, imperative SVG | Limited; hard to theme to the HUD; inside our glass tokens it fights `data-fx` | Medium to integrate, high to restyle | **Do not use** for v1 |
| Blocks | Custom block UI on dnd-kit sortable | ~0 extra | Ours to make keyboard-first | Medium | **Recommend** |
Reason: our spec is a small typed tree (filter, group by, measure, chart), not a programming language; Blockly's free-form workspace and code generators are unused weight, load slowly on the tools we want light, and cannot honour `data-fx`. A custom stack-of-blocks gives the Scratch feel, typed slots and the HUD skin. Revisit Blockly only if Jay wants arbitrary nested logic. Lazy-load the builder route so viewers never download it.

## E. System settings

Keys: `dateFormat`, `timeFormat` (12/24), `timeZone` (display), `region` (number/currency format, week start), `language`, `numberFormat`. Resolution: **user > organisation > system > code constant**, one query merged into the request's user load, memoised per request, 60s cache with invalidation on write. `fx` level stays device-local (`omni-fx`), not a setting.
- **Time zone:** system default = `PORTAL_TIMEZONE` (`Africa/Johannesburg`, `packages/types/worldrisk.ts`). The user/org `timeZone` changes DISPLAY only (via `Intl`). Day/week/month bucketing, the 60-day window (R4), invoicing period (25th-24th), billing month and default picker range always use `PORTAL_TIMEZONE`, because changing them alters counts (R6). A separate org "business time zone" would be an R6 entry in DECISIONS.md and is out of scope. `system_created_at`/`row_modified_at` are `timestamp without time zone` with unconfirmed stored zone (CONTEXT section 2): display conversion of those stays off until Jay confirms (Q8).
- **i18n without a perf cost:** typed catalogs `messages/<lang>.ts`, one language loaded per request by dynamic import (no catalogs in the client bundle except the active one), `<html lang>` from the resolved setting, `t()` over typed keys; `Intl` formatters memoised per locale+options. Start with English only and a tiny in-house `t()`; adopt `next-intl` (ask first) only when a second language is confirmed. Dataset field labels and panel titles are tenant data, not catalog strings.

## B. Milestones (each reviewable in the browser; stop for Jay's "approved" between them)

| M | Scope | Reviewable | What could break |
|---|---|---|---|
| **M1** Shell, nav, tabs (mock) | New tabs and route skeletons, org switcher (mock orgs), empty states, MOCK badge, `getPortal()` + mock impl skeleton, types package, a11y and `data-fx` pass at all 3 levels | Click through all tabs; switch orgs; fx toggle | `/dashboard` redirect and middleware matcher; replacing Overview/Alerts; active-nav indicator with nested routes |
| **M2** Org switcher, content tree, dashboards list/viewer (mock) | Tree CRUD (create, rename, move, nest, delete/undo), viewer rendering mock specs with Recharts on `data` glass, breadcrumbs, grants shown read-only | Build a folder tree, open a dashboard, change org and see a different tree | Tree a11y and drag-move; deep nesting performance; URL by id after move; two orgs' mock data bleeding (assert in mock too) |
| **M3** Builder (mock) | Asset list, grid canvas, block panel, spec JSON preview, SQL terminal UI (canned results, parser errors mocked) | Drag a field to the canvas, assemble blocks, see the chart and the JSON spec, save a version | Bundle size (lazy route), RGL on React 19, keyboard path, spec schema churn (version `v`), pointer vs touch |
| **M4** Integrations, Settings, Admin (UI on mock ONLY) | Integrations list/drawer with the write-only credential field and "Test connection" (mock, accepts nothing real), Settings screen (resolution order demo, English `t()`), Admin screens (Organisations, Users, Accounts + My account). All through `getPortal()` mock | Add a mock integration, see "credentials saved" with no value shown; change date format and see it apply in the UI | Mock credential field must never POST anywhere (assert in test); settings precedence logic; copy that implies real security |
| **M5** Everything real | Migrations 005-010 and backfill (WorldRisk, ADARS orgs; Jay as platform admin; `app_user_projects` -> WorldRisk); `app_settings`, `app_integrations` with encryption, host allowlist; `requireOrg`, `withOrg` + RLS; the full isolation test matrix; **only when it is green** may a real credential be entered. Then the reworked 004 (per-org roles), Step 3 (Tracking Sheets queries) as the first named dataset in the WorldRisk org on `portal_reader_wr`, real SQL terminal for the director | Same UI, real tree and data; isolation tests green; compare Tracking Sheets with Grafana :3000 (R5, R6) | Everything: `loadUser`'s "admin = null allowed_projects" must become per-org; existing sessions; seq scans vs 10s timeout (no indexes on `folder_name`); migration rollback plan; `INTEGRATION_KEYS` set by Jay in `.env` (Claude cannot read `.env*`); do NOT enable client logins (CONTEXT Q3, Q6/Q7) before TOTP |

## F. Decisions (Jay's answers, 2026-11-20; supersede the earlier open questions)

1. One director account (Jay). A second trusted platform admin only later, set by hand in SQL.
2. One login may hold a different role in each organisation (independent memberships).
3. A builder creates inside folders where they hold `edit`; only an admin creates top-level folders.
4. Accounts = login security (reset password, deactivate, sessions) plus a "My account" page. Not billing; Jay to say if meant otherwise.
5. The terminal cannot save results into a panel in v1.
6. One database role per organisation for tracking reads (`portal_reader_wr`, `portal_reader_adars`; replaces the single `portal_reader` for org-scoped use; needs a new hand-applied migration, to be added to the 004 plan).
7. The director alone manages `app_allowed_hosts`.
8. User time zone changes display only; counting stays on Africa/Johannesburg. Stored zone of `row_modified_at` to be confirmed in the data phase.
9. Overview and Alerts placeholders are dropped.
10. English only for now; the structure stays ready for more languages (in-house `t()`, no i18n library yet).

### Hardening (required before ANY client login)
- **TOTP two-factor for platform admins** (RFC 6238; secret encrypted with the integration key scheme, hashed recovery codes, lockout and audit on failure, enrolment forced at first login after M5). The director-only SQL terminal is disabled until the director has TOTP enabled. A TOTP library is a new dependency: ask first.
- Security headers (CSP, X-Frame-Options) per PROGRESS.md, Phase 4/5 list.

### Risk list
- Tenant leak by a forgotten `WHERE`: mitigated by `OrgCtx`, composite FKs, RLS, the route manifest test and the matrix test; a single missing guard is the highest risk of the project.
- `loadUser` currently gives role `admin` null `allowed_projects` globally; the M5 cut-over must not widen anyone. Keep legacy behaviour behind the backfill until tests pass.
- Mock-mode reaching production or masking an auth bug: startup refusal, build assertion, real auth always on.
- Generic compiler vs Grafana parity (R6): the compiler cannot reproduce per-panel `best_date` quirks; use named datasets first so numbers stay explainable.
- Credential key loss = all integrations unrecoverable: back up `INTEGRATION_KEYS` out of band; document rotation.
- Terminal abuse (resource exhaustion, parser gaps, function escape): parser + read-only role + timeout + row cap + audit; allowlist, not blocklist, for functions and relations.
- New dependencies (dnd-kit, react-grid-layout, a Postgres parser, maybe next-intl): each needs Jay's approval; none installed.
- Bundle and perf: builder route lazy-loaded; HUD effects stay off the canvas data areas (G1/G3).
- Migrations touch the shared `jaysnet_data`; only `app_*` objects, applied by Jay, with a rollback script per file.
