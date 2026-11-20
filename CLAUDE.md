# OmniMetrics Portal
Custom white-label replacement for Grafana OSS. Read-only visualization layer for Jay's Network fleet tracking.

## Stack
Turborepo monorepo (pnpm). apps/web = Next.js 15 App Router + API routes (single process, port 3002). apps/mobile = future Expo placeholder.
React 19, TypeScript, `postgres` client with raw SQL (no ORM), jose JWT + bcryptjs, HTTP-only cookie `omnimetrics_token`, shadcn/ui + Tailwind v4, shadcn charts (Recharts; Tremor dropped: React 18/Tailwind 3 only), Nivo (Phase 3 heatmap), TanStack Table/Query, Zustand, react-map-gl + MapLibre, Zod.

## Environment
Portal port is 3002. Port 3001 belongs to OmniOrchestrator and stays separate; never touch it.
Ubuntu 24.04 LXC, PostgreSQL 18 on localhost:5432, DB `jaysnet_data`. Dashboards read via `portal_reader` (Grafana keeps `grafana_reader`); only app_* tables write via `jaysnet_admin`. Grafana stays on :3000 until parity. Node 22 + pnpm via fnm for user `omni`.

## Hard rules
- NEVER write to worldrisk_tracking or adars_tracking. Portal is read-only on tracking data.
- NEVER touch /opt/jaysnet, /etc/cron.d, or any .env outside this repo.
- Every tracking query: folder_name/client_group filter first in the base CTE; parameterized SQL only; projects validated against JWT allowed_projects.
- Master Alerts T4 (dupe_base_data) must keep its project pre-filter.
- FQM queries hardcode folder_name = 'FQM Tracking Sheets'.
- ADARS uses adars_tracking with client_group CASE + client_name (not folder_name).
- Work in phases; confirm each phase with Jay before starting the next. Deliver complete files, not diffs.

## Reference
Full brief: docs/OmniMetrics_Portal_Architecture.md. Grafana dashboard JSONs in ./grafana-export/.

## Roadmap decisions (panel builder)
- Panels are defined as typed JSON specs (dataset, filters, groupBy, measure, chart type) in packages/types and rendered generically. A visual block builder (Blockly) will later produce these specs. Never accept raw SQL from the browser.
- Roles are admin | builder | viewer. Builders and viewers only ever see data for their own allowed_projects, enforced server-side on every query.
- Datasets expose plain-language field labels and an allowlist of columns; sensitive fields can be hidden per role.
- Dashboard queries run as portal_reader with a statement_timeout and row limit.

## Design rules
- Any design skill must respect the brand CSS variables, the shadcn/ui + shadcn charts (Recharts) component stack, and the white-label theming in the brief.
- The visual direction is Holographic HUD (docs/design/DIRECTION.md), driven by the `data-fx` effects level (`full|reduced|off`). Data legibility beats decoration; charts and tables sit on `data-glass` surfaces.
- UI UX Pro Max (`.claude/skills/ui-ux-pro-max`) is advisory only; the brand variables and white-label theming win. Ignore its landing-page patterns (this is a logged-in operations dashboard; use the Data-Dense Dashboard style). Run it only via `python3 .claude/skills/ui-ux-pro-max/scripts/search.py`. Install no other skills or plugins without asking.

## Token hygiene
- Read docs/OmniMetrics_Portal_Architecture.md by section (grep headings, then read the relevant range), never whole.
- Keep command output quiet (`-q`, `--silent`, redirect or `| tail`); only surface failures.
- Don't echo back files you write; state the path and a one-line summary.
- `/clear` between phases; docs/PROGRESS.md is the handoff (update it at the end of each phase, read it at the start of the next).
- Keep plugins to a minimum.

## Domain context (binding)
Read docs/CONTEXT.md before writing any SQL, project scoping or dashboard code. Its rulings (R1 to R6) are binding; docs/DECISIONS.md logs every change that alters a number (R6). If anything conflicts with it, stop and ask; do not choose silently.
