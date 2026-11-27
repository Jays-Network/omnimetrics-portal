# Progress and handoff

Read this first after `/clear`. Update it at the end of every phase.

## Done (Phase 1 / 1.1)
- Monorepo scaffold (Turborepo + pnpm), `apps/web` Next.js 15, `packages/types`, `packages/tsconfig`.
- App tables migration, `portal_app` least-privilege role, password hash script.
- Branded login page, login/logout/me API routes, route-guard middleware, minimal dashboard placeholder.
- Login rate limiting (`lib/rate-limit.ts`) and audit log (`app_audit_log`).
- Phase 1.1: portal moved to port 3002, `start` bound to 127.0.0.1, `requireAuth` reads permissions from the DB.

## Key decisions
- **Port 3002.** Port 3001 is OmniOrchestrator and stays separate; never touch it.
- **Bind address.** `dev` binds 0.0.0.0 (LAN testing). `start` binds 127.0.0.1; Nginx fronts it. Nginx must overwrite
  `X-Forwarded-For` and `X-Real-IP` (see the Nginx section of the architecture brief), because `lib/rate-limit.ts` trusts them.
  Behind Cloudflare or a tunnel use `CF-Connecting-IP`.
- **JWT is identity only** (`sub`, `iat`, `exp`). `requireAuth()` / `getCurrentUser()` load role, is_active and
  allowed_projects from the database on every call, cached per user id for 60s in memory. `allowed_projects` is `null`
  only for admin; builder/viewer get `app_user_projects` rows, or `[]`. Missing or inactive user = unauthenticated.
- **Cache staleness.** A role, project or is_active change can take up to 60s to apply (per process). `invalidateUserCache(userId)`
  is exported from `lib/auth.ts` and is called on login and logout. The Phase 4 admin UI must call it on role/project/is_active changes.
- **Security boundary.** Every protected page and API route must call `requireAuth()` (or `getCurrentUser()` in server
  components). `middleware.ts` is only a redirect convenience: it is edge-only, verifies the JWT signature and expiry, and
  cannot query the DB. Never rely on it for authorization.
- **portal_app least privilege.** `DATABASE_URL` (`getDb()`) is the `portal_app` role, app_* tables only.
  `DATABASE_URL_READONLY` (`getReadonlyDb()`) is `portal_reader` (migration 004, applied by Jay; until then the URL may still point at `grafana_reader`) with a 10s statement_timeout for tracking reads.
- **Manual DB steps already completed:** app tables created, `portal_app` role created and granted, first admin user created.

## How to run
```bash
pnpm install
pnpm --filter web dev          # http://<host>:3002, bound to 0.0.0.0
pnpm --filter web typecheck
pnpm --filter web build && pnpm --filter web start   # 127.0.0.1:3002, Secure cookie (needs HTTPS/Nginx)
```
Env vars live in `apps/web/.env.local` (see `.env.local.example`); never commit it.

## Phase 2 (in progress): WorldRisk Tracking Sheets, admin-only
Plan and Jay's answers: `docs/PLAN_PHASE2.md` (approved 2026-11-20). Domain rulings: `docs/CONTEXT.md`.
- Step 2 DONE: `apps/web/lib/queries/filters.ts` (`FiltersSchema`, `resolveFilters`, `FilterError`, `filtersFromSearchParams`),
  `packages/types/worldrisk.ts`, `apps/web/tests/filters.test.ts` (typecheck + 31 tests green).
- Decisions to carry: scope on raw `folder_name`; `test sheets` stripped for every role; "All" = explicit folder list, never no-filter;
  non-admin grants are not narrowed by the dropdown universe, only by R1; default range now-6h, picker in Africa/Johannesburg.

## Design passes (done)
- Design pass 1 (v1): brand tokens, logo, favicon, login page (commit 4390ef5).
- Design pass 2 (v2): Holographic HUD direction (`docs/design/DIRECTION.md`), `data-fx` effects levels (full|reduced|off), app shell (commit 2a544e7).
- `apps/web/components/fx/` primitives: fx-core, fx-tokens, use-fx, fx-toggle, glass-panel, glow-input, gradient-text, holo-background, holo-canvas, motion-root, neon-button, page-transition, skeleton, stat-card.
- `/dev/ui` (`apps/web/app/dev/ui`): primitives showcase page.
- Topbar fix in `apps/web/components/shell/app-shell.tsx`.
- `docs/DECISIONS.md`: R6 decisions log (D1 onward); all entries open until Jay rules.

## Phase 4/5 list
- Security headers: CSP, X-Frame-Options (and related) on the web app / Nginx.

## Builder track (docs/PLAN_BUILDER.md, approved 2026-11-20)
Rule: M1 to M4 are UI on mock data only; every real table, migration, RLS, org enforcement and isolation test is M5, and no real integration credential is entered before the isolation matrix is green.
Rulings recorded: R7 (SQL terminal is director-only; CLAUDE.md hard rule updated), one DB role per org (`portal_reader_wr`, `portal_reader_adars`; the 004 example must be reworked, NOT written yet), TOTP for platform admins before any client login, Accounts = login security + My account.
- **M1 DONE (shell, nav, tabs on mock data), awaiting Jay's review.** Top tabs Dashboards | Integrations | Admin | Settings (hidden by capability), org switcher, MOCK badge, Admin sub-tabs (Organisations/Organisation, Users, Accounts), My account (`/dashboard/account`, via the name top right), director-only `/dashboard/platform/organisations` (mock table). Section pages are "Planned: Mx" placeholders.
  - Files: `packages/types/portal.ts` (Org, Capability, `capabilitiesFor`, OrgAccess); `apps/web/lib/portal/` (`types.ts` Portal interface, `index.ts` `getPortal()` mock only in development, `mock/index.ts`, `org.ts` guards `requirePortalUser`, `requireOrgPage`, `requirePlatformPage`); `components/shell/` (`app-shell.tsx` rewritten as header tabs, `nav.ts`, `org-switcher.tsx`, `sub-tabs.tsx`, `page-intro.tsx`); routes under `app/dashboard/o/[orgSlug]/...`, `platform/`, `account/`, `not-found.tsx`; `tests/portal.test.ts`.
  - Guards: every page calls its own guard; the `[orgSlug]` segment is a hint matched against accessible orgs (404 otherwise, existence not confirmed). Mock memberships follow the REAL session role (admin = director in both orgs; others get WorldRisk with their role). Auth is never bypassed. In production `getPortal()` throws until the pg implementation (M5); do not run production builds yet.
  - Not in M1: dev-only "preview as role" (reduce-only, planned for M2); `.fx-nav-indicator` CSS in globals.css is now unused (left alone); last-used organisation is not remembered (first org is the default).
  - Checks: typecheck and 54 tests green. `pnpm build` not run (Jay's dev server is up). Not clicked through in a browser by me.

- **M2 IN PROGRESS (mock), blocked on dependency approval.** Done: tree rules (`lib/portal/tree.ts`: create/rename/move/delete/restore, depth 8, unique sibling names, admin-only top level), `Portal.content` + `Portal.dashboards` (mock store per org on globalThis, different WorldRisk/ADARS seeds), route handler `/api/portal/o/[orgSlug]/content`, routes `(workspace)/dashboards` and `(workspace)/d/[nodeId]`, ARIA tree with keyboard (arrows, F2, M move picker, Delete, Alt+Up/Down, Ctrl+Z undo), viewer with breadcrumbs, stat cards and read-only Access panel, dev-only preview-as-role (cookie `omni_preview_role`, reduce-only, `/api/portal/preview`), last-org cookie `omni_last_org` (UI hint only), `.fx-nav-indicator` CSS removed, `tests/content-tree.test.ts`.
  - Pending approval: `recharts` (chart panels; `components/dashboards/panel-chart.tsx` is a placeholder) and `@dnd-kit/core` + `@dnd-kit/utilities` (pointer drag-and-drop in `content-tree.tsx`; keyboard move already works via the M picker).

- **M3 IN PROGRESS (mock): asset catalogue.** `apps/web/lib/panels/registry.tsx` is the single source (48 types, 8 categories, none "soon"): add a type = one `def()` entry + renderer in `components/panels/`. Spec schema `PanelSpecSchema` (`chart` = registry id, per-type options and allowed blocks enforced, no SQL field). Builder shell at `/dashboard/o/[org]/d/[nodeId]/edit` (asset bar with search, favourites, drag or Enter to add; canvas flow layout; spec preview; controls publish filters). Tests: `panel-registry`, `asset-bar`. **Rest of M3 DONE (mock), awaiting Jay's review:** `lib/builder/{model,fields,terminal}.ts` (pure: grid rules, blocks<->spec, undo history, append-only versions, mock SQL checks), `components/builder/{canvas,blocks-panel,sql-terminal,builder,builder-loader}.tsx`, versions API `app/api/portal/o/[orgSlug]/dashboards/[nodeId]/versions` (edit capability checked server side), `Portal.dashboards.versions/saveVersion`, `tests/builder.test.tsx`. Panel options (unit, colour) added to every registry entry. Deps added: `@dnd-kit/sortable`, `react-grid-layout` (v2). Not clicked through in a browser. Not done: real tile maps (needs react-map-gl + maplibre-gl, not installed), TanStack Table (own sortable/paged table used instead).

- **M3.1 polish DONE (layout only), awaiting Jay's review.** Fixed-viewport editor (AppShell goes `h-dvh` on `/d/<id>/edit`; grid of toolbar / 3 columns / docked terminal row, each column scrolls itself), accordion asset bar (Favourites + Recent, remembered open category), Back button + Esc + unsaved-changes dialog + beforeunload, `<1024px` "Widen the window" message, panels measure their own box (`use-size.ts`, `PanelProps.width/height`, charts without ResponsiveContainer, SVG viewBox renderers, cqmin text), registry `min` per type (RGL minW/minH, also keyboard resize), column guides and visible drop placeholder. Cause of the blank Bar panel: `.fx-content` is a plain block so `h-full` collapsed to 0; fixed with `.fx-fill` in globals.css plus measured sizes. Tests: 104 green (fit test mounts all 48 types at default and minimum size).

- **M3.2 DONE: free-form canvas replaces react-grid-layout.** Spec is now `v:2` (layout `{x,y,w,h,z,locked?}` in artboard units, 1920 wide, height auto + 200; registry cell sizes convert at 160 x 100 units). Pure math in `lib/builder/model.ts` (clamp, 8-handle resize, snap + guides, grid snap, z-order, tidy, key commands); `components/panels/artboard.tsx` (shared by editor and viewer: scale-to-fit, `PanelCell`, `StaticBoard`); `components/builder/canvas.tsx` (pointer events + capture, rAF-throttled live rect, handle/toolbar overlay); `layout-panel.tsx`. Viewer now renders the latest saved spec (old `PanelPreview` renderers removed). Panels measure `clientWidth/Height` (unscaled). Jay to run `pnpm remove react-grid-layout`. Tests: 142 green.

- **M3.3 DONE (mock).** A) Scrolling root cause: the editor's inner columns grid had an implicit `auto` row, so the columns grew to their content and never scrolled; it is now `grid-rows-[minmax(0,1fr)]` with `.scroll-token` (thin token scrollbar, `overscroll-behavior: contain`) on the asset, config and canvas scrollers; chain asserted in `tests/editor-layout.test.tsx` (manual zoom checklist in its header). B) Dashboard Settings (gear in the editor toolbar, full-width tabbed view `components/builder/settings-view.tsx`): `settings` object in the dashboard spec (`lib/builder/settings.ts`, `settings.v:1`, undoable, versioned); General, Time options, Panel options, Variables, Links, Versions, Permissions (mock grants API), JSON Model (validated apply), Annotations (Planned). Read-only dashboards hide Edit from builders (page, versions API and portal all refuse; admins keep access). New capability `dashboards.delete` (builders and admins; the content route enforces it for `delete`). Viewer shows variables, links, refresh and time display via `board-bar.tsx`. Tests: 171 green.
- **M4 DONE (mock), awaiting Jay's review.** Integrations (list, add/edit drawer, write-only credentials, test connection with 5/min limit and audit, managed Local database row, director-only Allowed hosts), Admin (Organisations, Users with tracking-scope picker and director cross-org memberships, Accounts with sessions, My account with TOTP "Planned"), Settings (user > org > system > default, "Effective for you", one memoised Intl formatter in `lib/settings/format.ts`, provided by `app/dashboard/o/[orgSlug]/layout.tsx`; display only, R6). Mock service `lib/portal/mock/admin.ts` + store `admin-store.ts`; routes under `app/api/portal/o/[orgSlug]/{integrations,admin/*,settings}` and `app/api/portal/account`; redaction `lib/admin/redact.ts`. New capabilities `hosts.manage`, `settings.system` (director only). Fixed-viewport rule extended to these pages (`isFixedPath`). Dev layout fixture `/dev/pages/<integrations|users|accounts|orgs|account|settings>`. Tests: `admin`, `admin-routes`, `admin-ui` (230 unit tests); `pnpm test:layout` now runs `e2e/editor-layout` + `e2e/pages-layout` (16 green). No real tables, migrations or credentials (M5).

- **M4.1 DONE (mock): Integrations is a card catalogue** (`components/admin/integrations-view.tsx`, registry `lib/admin/connectors.ts`: 11 connectors, only PostgreSQL functional, every other entry has a reason). **Root cause of the intermittent dev 500 found:** Playwright wrote screenshots/test-results inside `apps/web`, the Next dev watcher recompiled mid-test and answered 500 ("Unexpected end of JSON input" reading a manifest being rewritten). Output now goes outside the project (`LAYOUT_OUT` or the OS temp dir); a full run shows 0 recompiles and 0 errors.


- **M5 stage 2a (2026-11-26): pg data layer for organisations, content, dashboards, versions, grants. NOT committed; database tests NOT yet run** (`password authentication failed for user "portal_test_app"`). `PORTAL_DATA` stays `mock`; `pg` works outside production only, and org pages fail in pg mode because settings are not implemented yet (fail closed).
  - Code: `lib/portal/pg/{tx,context,org,access,errors,orgs,content,dashboards,index}.ts`, `getAppDb`/`getPlatformDb`, `resolveOrg` in `lib/portal/org.ts` (all org routes now use `guardOrg`). Shared tree rules (`applyOp`) drive both implementations; mock fix: a move counts soft-deleted descendants against the depth limit.
  - Tests: unit 273 green (contract suite on the mock, route manifest, error mapping). `pnpm test:db` (contract on pg, isolation matrix, grants, context) per M5_APPLY_CHECKLIST section 8.
  - Open: `listAll` returns 0 for integration and dashboard counts (`portal_platform` has no grant); no UI or API sets folder or organisation-wide grants; access rules in DECISIONS.md await Jay.

## Next
- Jay reviews M1, then "approved" for M2 (org switcher refinements, content tree, dashboards list/viewer on mock data).
- Step 3 stays parked until M5 (needs the per-org reader roles first).


- **M5 stage 2b (2026-11-26): pg organisations, users/memberships, settings, password change/reset, org-aware audit, new `loadUser`. Not committed.** `PORTAL_DATA` stays `mock`; production still refuses mock and pg.
  - Code: `lib/portal/pg/{organisations,users,account,settings}.ts`, `lib/audit.ts` (`writeAudit`), `lib/admin/password.ts`, `loadUser` reads `app_users` only, routes now `await` and pass `X-Real-IP`, new `op: "link"` (director) on the users route. Mock follows the same rules. `012_session_version` written, NOT applied, no app code.
  - Tests: typecheck clean, `pnpm test` 305 green. `pnpm test:db` 63 of 66 green; the 3 linking tests wait for a rebuild (`itest_linkable`, M5_APPLY_CHECKLIST section 8). `pnpm build` not run (dev server).
  - Open before cut-over: the Users/Accounts screens do not yet SHOW the one-time password (and still say "mock"); no sessions list/revoke (012); director's cross-organisation memberships view and tracking-scope editing not built in pg; DECISIONS S1 to S11 await Jay.


- **M5 stage 2c (2026-11-27): stage 2b gaps closed. Not committed.** `PORTAL_DATA` stays `mock`; production still refuses mock and pg.
  - One-time password panel (`components/admin/one-time-password.tsx`) after add user and reset password.
  - Attempt limits on password change and reset (`withAttemptLimit` in `lib/rate-limit.ts`).
  - Session version behind `SESSION_VERSION` (default off; `lib/session-version.ts`, jwt, auth, login, `pg/account.ts` incl. `revokeSessions`). 012 is NOT applied to `jaysnet_data`.
  - `db/test/rebuild_portal_test.sh.example` now applies 012, sets passwords, writes `.env.test`, verifies logins. 012 checks added to the smoke test. **Neither was run by Claude.**
  - Tests: typecheck clean, `pnpm test` 331 green (was 305). `pnpm test:db` needs the rebuild first (012). `pnpm build` not run.
  - Open: Jay runs the rebuild, `pnpm test:db` and the smoke test; DECISIONS C1 to C9; no "sign out everywhere" button; the account, Users and Accounts screens still say "mock".
