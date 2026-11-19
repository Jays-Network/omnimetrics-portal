# OmniMetrics Portal

White-label, read-only visualization layer for Jay's Network fleet tracking. Turborepo + pnpm monorepo:
`apps/web` (Next.js 15, port 3002), `packages/types`, `packages/tsconfig`, `apps/mobile` (placeholder).

Port 3001 is OmniOrchestrator and stays separate; the portal uses 3002.

See `CLAUDE.md` and `docs/OmniMetrics_Portal_Architecture.md`.

## Phase 1: setup by hand

Run from the repo root as user `omni` (Node 22, pnpm 12).

1. **Create the app tables** (as `jaysnet_admin`):
   ```bash
   psql -U jaysnet_admin -d jaysnet_data -h localhost -f db/migrations/001_app_tables.sql
   ```
2. **Create the `portal_app` role** (needs a role that can create roles, e.g. `postgres`):
   ```bash
   cp db/migrations/003_portal_app_role.sql.example db/migrations/003_portal_app_role.sql
   # edit the password, then:
   sudo -u postgres psql -d jaysnet_data -f db/migrations/003_portal_app_role.sql
   ```
3. **Create `apps/web/.env.local`** from the example and fill in real values:
   ```bash
   cp apps/web/.env.local.example apps/web/.env.local
   openssl rand -hex 32        # use as JWT_SECRET
   ```
4. **Create the first admin** (password is typed at a hidden prompt, never on the command line):
   ```bash
   node scripts/hash-password.mjs
   cp db/migrations/002_seed_admin.sql.example db/migrations/002_seed_admin.sql
   # paste the hash, set username/email, then:
   psql -U jaysnet_admin -d jaysnet_data -h localhost -f db/migrations/002_seed_admin.sql
   ```

## Run

```bash
pnpm install
pnpm --filter web dev        # http://<host>:3002 , bound to 0.0.0.0
```

`pnpm --filter web build && pnpm --filter web start` serves on 3002 too, bound to 127.0.0.1 (Nginx fronts it), but in production mode the auth cookie is
`Secure`, so browsers will not keep it over plain `http://`. Use `dev` for LAN testing; production runs behind
Nginx with TLS.

## Phase 1 verify checklist

1. No cookie: `curl -si http://localhost:3002/dashboard | head -3` returns `307` with `location: /login?next=%2Fdashboard`.
2. Open `http://<host>:3002/login`, sign in as the admin; the browser lands on `/dashboard` showing your username and role.
3. DevTools, Application, Cookies: `omnimetrics_token` is `HttpOnly`, `SameSite=Strict`, with a 24h expiry.
4. `http://<host>:3002/api/auth/me` returns your user JSON.
5. Click **Sign out**; you are sent to `/login`. Visiting `/dashboard` again redirects to `/login`.
6. Wrong password 5 times for the same user and IP returns `429`. Check `SELECT action, detail FROM app_audit_log ORDER BY id DESC LIMIT 10;`.

## Reverse proxy note

`start` binds 127.0.0.1 only. Nginx must overwrite `X-Forwarded-For` and `X-Real-IP` (not append), because
`lib/rate-limit.ts` trusts them. Behind Cloudflare or a tunnel, `$remote_addr` is Cloudflare's address, so set both
headers from `CF-Connecting-IP` instead. See the Nginx section of `docs/OmniMetrics_Portal_Architecture.md`.
