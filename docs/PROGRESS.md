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

## Next
- Jay reviews M1, then "approved" for M2 (org switcher refinements, content tree, dashboards list/viewer on mock data).
- Step 3 stays parked until M5 (needs the per-org reader roles first).
