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
- Next: Step 3 (shared base query, summary route, `004_portal_reader_role.sql.example`). Wait for Jay's "approved".
