# OmniMetrics Portal — Full Architecture & Project Brief
> Handover document for new chat session. Contains all context, decisions, and structure needed to begin implementation.

---

## 1. Project Overview

**What we are building:** A custom white-labelled client portal to replace Grafana OSS as the
visualization layer for the OmniMetrics logistics/fleet tracking platform operated by Jay's Network.

**Why custom-built (not a pre-built BI tool):**
- Grafana white-labelling requires unreliable bundle patching — known to break login on upgrades
- Apache Superset's 3-step workflow (virtual dataset → chart → dashboard) is too rigid and dashboard
  layout control is too limited
- Metabase white-label requires $500+/month paid tier
- All pre-built tools hit either a paywall or a customization ceiling for this use case
- The SQL is already written. The hard part is done. A custom portal wraps it cleanly.

**Clients served:** Reload, Alistair Logistics, Rangel, Steinweg Bridge, GSM, Glencore/Moxico Mine, FQM.

**Countries tracked:** Zimbabwe, Botswana, DRC, Zambia, South Africa, Tanzania, Namibia, Mozambique.

**Platform strategy:**
- **Phase 1-5 (current):** Web application — full feature parity with Grafana dashboards
- **Phase 6+ (future):** Android & iOS via Expo React Native — same API, shared types, no rewrite

---

## 2. Production Environment

| Item | Detail |
|---|---|
| Host | OmniMetrics LXC — Ubuntu 24.04, 5 cores, 10GB RAM, 200GB disk, 8GB swap |
| Proxmox node | Cisco M5 ("WR") |
| LXC IP | `192.168.15.32` |
| DDNS | `omnimetrics.dns.jays-network.com` |
| Remote access | Twingate |
| PostgreSQL | Port 5432, DB: `jaysnet_data`, users: `jaysnet_admin`, `grafana_reader` (Grafana only), `portal_reader` (portal dashboards, new) |
| Grafana (existing) | Port 3000 — stays running during transition, decommission in Phase 5 |
| Portal (new) | Port 3002 — Next.js serves both frontend AND API routes. Port 3001 is OmniOrchestrator and stays separate |

---

## 3. Full Tech Stack

### Single-Service Architecture
Everything runs inside one Next.js process. No separate backend service.

```
[Browser]
    │
[Nginx :443]  ← SSL termination
    │
[Next.js :3002]  ← App Router pages + /api/* route handlers
    │
[PostgreSQL :5432 — jaysnet_data]
    ├── jaysnet_admin   → app_users writes + dashboard reads
    └── portal_reader   → dashboard reads (read-only, dedicated role; grafana_reader stays for Grafana)
```

### Package Selections

#### Framework & Runtime
| Package | Version | Purpose |
|---|---|---|
| `next` | 15.x | App Router, SSR, API routes, middleware |
| `react` / `react-dom` | 19.x | UI rendering |
| `typescript` | 5.x | Type safety throughout |
| `node` | 22 LTS | Runtime on LXC |

#### Database
| Package | Purpose |
|---|---|
| `postgres` (npm) | PostgreSQL client — modern, lightweight, fully typed, async |
| Raw SQL strings | All existing Grafana queries port verbatim — no ORM needed |

#### Authentication
| Package | Purpose |
|---|---|
| `jose` | JWT sign + verify (Web Crypto API, edge-compatible) |
| `bcryptjs` | Password hashing |
| HTTP-only cookie | Token storage — never localStorage, never JS-accessible |

#### UI Component System
| Package | Purpose |
|---|---|
| `shadcn/ui` | Core component library — copy-paste Radix UI + Tailwind. Full code ownership, no version lock-in. |
| `@radix-ui/*` | Accessible headless primitives (dialog, dropdown, tooltip) — shadcn dependency |
| `tailwindcss` v4 | Utility CSS — design token system, white-label theming via CSS variables |
| `lucide-react` | Icon set — native to shadcn ecosystem |
| `class-variance-authority` | Component variant management |
| `clsx` + `tailwind-merge` | Conditional class merging |

#### Charts & Data Visualization
| Package | Purpose |
|---|---|
| `recharts` via shadcn `chart` component | **Primary dashboard charts** — AreaChart, BarChart, PieChart (donut), sparklines. Themed through the brand `--chart-1..n` CSS variables. StatCard is a shadcn Card. |
| `@nivo/bar`, `@nivo/heatmap`, `@nivo/geo` | **Complex visualizations** (Phase 3) — FQM destination heatmap and any gaps. Canvas rendering handles large row counts without SVG degradation. |

> **Why not Tremor:** `@tremor/react` 3.18.7 supports only React 18 / Tailwind 3; this stack is React 19 / Tailwind v4.
> shadcn charts (Recharts) match the existing shadcn theming and brand variables with no version conflict.

#### Tables
| Package | Purpose |
|---|---|
| `@tanstack/react-table` v8 | Headless table — sorting, filtering, pagination, virtual scroll. Styled with Tailwind. Replaces all Grafana table panels. |

#### Data Fetching & State
| Package | Purpose |
|---|---|
| `@tanstack/react-query` v5 | Server state management — caching, background refetch, loading/error states for all `/api/*` calls |
| `zustand` | Client state — filter bar selections (projects/year/country), sidebar open state, user preferences |

#### Maps
| Package | Purpose |
|---|---|
| `react-map-gl` v8 | React wrapper for MapLibre GL |
| `maplibre-gl` | Open-source vector tile maps — Mapbox-compatible API, zero API key cost |

#### Animation
| Package | Purpose |
|---|---|
| `motion` (Framer Motion v12) | Page transitions, staggered panel reveals on dashboard load, stat card micro-interactions |

#### Utilities
| Package | Purpose |
|---|---|
| `date-fns` | Date formatting, manipulation |
| `zod` | Schema validation for all API route inputs |
| `next-themes` | Dark/light mode (system default + toggle) |

---

## 4. Monorepo Structure (Turborepo)

Set up as a monorepo from day one. Only `apps/web` is active now.
`apps/mobile` is a placeholder — mobile pivot requires zero restructuring.

```
omnimetrics-portal/                   ← git root
├── apps/
│   ├── web/                          ← Next.js 15 (CURRENT FOCUS)
│   └── mobile/                       ← Expo React Native (FUTURE — placeholder only)
├── packages/
│   ├── types/                        ← Shared TypeScript interfaces
│   │   ├── api.ts                    ← API request/response shapes
│   │   ├── dashboard.ts              ← TruckStatus, AlertRow, SummaryStats, etc.
│   │   └── auth.ts                   ← User, JWTPayload, Role
│   └── tsconfig/                     ← Shared TS base configs
├── turbo.json
├── package.json                      ← Workspace root
└── pnpm-workspace.yaml
```

**Why monorepo now:** When the Expo app is built, it imports from `@omnimetrics/types` directly.
The API contract is the single source of truth for both platforms from day one.

---

## 5. Web App Directory Structure (`apps/web/`)

```
apps/web/
├── app/
│   ├── layout.tsx                    ← Root: ThemeProvider, QueryClientProvider, fonts
│   ├── globals.css                   ← CSS variables, brand tokens, Tailwind base
│   ├── page.tsx                      ← Redirects → /login or /dashboard
│   │
│   ├── login/page.tsx                ← Full-screen branded login
│   │
│   ├── dashboard/
│   │   ├── layout.tsx                ← Shell: Sidebar + Topbar + FilterBar
│   │   ├── page.tsx                  ← Redirects → /dashboard/worldrisk
│   │   ├── worldrisk/page.tsx        ← Dashboard ID:1
│   │   ├── adars/page.tsx            ← Dashboard ID:2
│   │   ├── devices/page.tsx          ← Dashboard ID:3
│   │   ├── audit/page.tsx            ← Dashboard ID:4 — Alerts Gauge + Master Alerts Table
│   │   ├── tracking-table/page.tsx   ← Dashboard ID:5
│   │   └── fqm/page.tsx              ← FQM locked dashboard
│   │
│   ├── admin/
│   │   ├── layout.tsx                ← Admin role guard
│   │   ├── page.tsx
│   │   └── users/page.tsx            ← User management CRUD
│   │
│   └── api/                          ← Next.js API route handlers (the entire backend)
│       ├── auth/
│       │   ├── login/route.ts        ← POST: verify creds → set JWT cookie
│       │   ├── logout/route.ts       ← POST: clear cookie
│       │   └── me/route.ts           ← GET: current user + allowed_projects
│       ├── users/
│       │   ├── route.ts              ← GET list, POST create
│       │   └── [id]/
│       │       ├── route.ts          ← PATCH update, DELETE deactivate
│       │       └── projects/
│       │           ├── route.ts      ← GET list, POST assign
│       │           └── [folder]/route.ts  ← DELETE remove
│       ├── dashboard/
│       │   ├── worldrisk/
│       │   │   ├── summary/route.ts
│       │   │   ├── status-breakdown/route.ts
│       │   │   ├── trend/route.ts
│       │   │   └── table/route.ts
│       │   ├── adars/
│       │   │   ├── summary/route.ts
│       │   │   ├── status-breakdown/route.ts
│       │   │   └── table/route.ts
│       │   ├── audit/
│       │   │   ├── alerts/route.ts   ← 4-trigger UNION ALL
│       │   │   └── gauge/route.ts    ← T1/T2/T3/T4 counts
│       │   └── fqm/
│       │       ├── transporter-trend/route.ts
│       │       └── heatmap/route.ts
│       └── filters/
│           ├── projects/route.ts
│           └── countries/route.ts
│
├── components/
│   ├── charts/
│   │   ├── StatusDonut.tsx           ← shadcn chart (Recharts PieChart)
│   │   ├── TrendArea.tsx             ← shadcn chart (Recharts AreaChart)
│   │   ├── StatCard.tsx              ← shadcn Card KPI tile
│   │   ├── AlertsTable.tsx           ← TanStack Table (Master Alerts ID:4)
│   │   ├── TrackingTable.tsx         ← TanStack Table (full tracking + pagination)
│   │   ├── TransporterBar.tsx        ← shadcn chart (Recharts BarChart, FQM)
│   │   ├── DestinationHeatmap.tsx    ← Nivo HeatMap (FQM)
│   │   └── GeoMap.tsx                ← react-map-gl + MapLibre
│   │
│   ├── layout/
│   │   ├── Sidebar.tsx               ← Nav, logo slot, collapsible
│   │   ├── Topbar.tsx                ← User info, theme toggle, logout
│   │   ├── FilterBar.tsx             ← Project multi-select, year, country
│   │   ├── KioskShell.tsx            ← Full-screen wrapper (replaces standard shell in kiosk mode)
│   │   ├── RefreshIndicator.tsx      ← Top-of-screen progress bar + per-panel stale state
│   │   └── CarouselController.tsx    ← Dashboard rotation manager with Motion transitions
│   │
│   └── ui/                           ← shadcn/ui components (copy-pasted, owned)
│       ├── button.tsx
│       ├── card.tsx
│       ├── badge.tsx                 ← ARRIVED / IN TRANSIT / OVERDUE status chips
│       ├── dialog.tsx
│       ├── dropdown-menu.tsx
│       ├── input.tsx
│       ├── select.tsx
│       ├── table.tsx
│       ├── tabs.tsx
│       ├── toast.tsx
│       └── tooltip.tsx
│
├── lib/
│   ├── db.ts                         ← postgres client singleton
│   ├── auth.ts                       ← requireAuth(), signToken(), JWT helpers
│   ├── queries/
│   │   ├── worldrisk.ts              ← All worldrisk_tracking SQL functions
│   │   ├── adars.ts                  ← All adars_tracking SQL functions
│   │   ├── fqm.ts                    ← FQM-locked queries (folder_name hardcoded)
│   │   ├── audit.ts                  ← Master Alerts 4-trigger UNION ALL
│   │   └── filters.ts                ← Project list, country list
│   ├── api-client.ts                 ← Typed fetch wrapper (browser → /api/*)
│   └── utils.ts                      ← cn(), formatDate(), STATUS_COLOURS map
│
├── hooks/
│   ├── useAuth.ts                    ← Current user from /api/auth/me
│   ├── useFilters.ts                 ← Zustand: projects/year/country + kiosk/carousel state
│   ├── useDashboard.ts               ← TanStack Query hooks per endpoint (refetchInterval built in)
│   └── useKiosk.ts                   ← URL param parsing, carousel timer, localStorage persistence
│
├── middleware.ts                     ← Unauthenticated → /login
├── next.config.ts                    ← output: 'standalone' for production build
├── tailwind.config.ts                ← Brand tokens + shadcn theme merge
├── tsconfig.json
└── .env.local
```

---

## 6. White-Label Theming System

Rebranding for any client = changing 8 CSS variables and swapping a logo file.

```css
/* apps/web/app/globals.css */
:root {
  --brand-primary:    #0f172a;   /* Main background / nav */
  --brand-accent:     #3b82f6;   /* CTAs, active states, chart highlights */
  --brand-accent-fg:  #ffffff;   /* Text on accent colour */
  --brand-surface:    #1e293b;   /* Card / panel background */
  --brand-border:     #334155;   /* Borders and dividers */
  --brand-text:       #f1f5f9;   /* Primary text */
  --brand-text-muted: #94a3b8;   /* Secondary / label text */
  --brand-danger:     #ef4444;   /* Alert / overdue indicators */
}
```

**Per-client deployment:** `NEXT_PUBLIC_BRAND_*` env vars at build time.
One codebase, multiple branded builds served via Nginx subdomains.

**Default font pairing:** `Syne` (display — sharp, technical authority) + `DM Sans` (body — clean,
readable at small sizes). Both loaded via `next/font/google`. Override per client via
`NEXT_PUBLIC_BRAND_FONT_DISPLAY` + `NEXT_PUBLIC_BRAND_FONT_BODY`.

---

## 7. Auth Flow

```
1.  User visits /dashboard/* or /admin/*
2.  middleware.ts checks for omnimetrics_token cookie
3.  No cookie / expired → redirect /login
4.  POST /api/auth/login:
      → Zod validates body
      → Query app_users WHERE username = $1
      → bcryptjs.compare(password, hashed_password)
      → jose.SignJWT({ sub, username, role, allowed_projects, exp: 24h })
      → Set-Cookie: omnimetrics_token; HttpOnly; Secure; SameSite=Strict
5.  Browser sends cookie on every subsequent request automatically
6.  API routes call requireAuth(request) → jose.jwtVerify() → user object
7.  All query functions receive user.allowed_projects as SQL parameter
8.  Admin role → allowed_projects = null → no folder_name filter applied
```

**JWT payload:**
```json
{
  "sub": "user-uuid",
  "username": "jays_admin",
  "role": "admin",
  "allowed_projects": ["FQM Tracking Sheets", "Reload Tracking Sheets"],
  "exp": 1234567890
}
```

**Standard API route pattern:**
```typescript
// app/api/dashboard/worldrisk/summary/route.ts
export async function GET(request: NextRequest) {
  const user = await requireAuth(request)          // → 401 if no valid cookie
  const filters = parseAndValidateFilters(request, user)  // validates projects against user.allowed_projects
  const data = await getWorldriskSummary(filters)
  return Response.json(data)
}
```

---

## 8. Database Schema Additions

Run against `jaysnet_data`. **Do not touch existing tables.**

```sql
CREATE TABLE app_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(100) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'viewer',  -- 'admin' | 'viewer'
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Admin users with no rows here see ALL projects
CREATE TABLE app_user_projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    folder_name TEXT NOT NULL,
    UNIQUE(user_id, folder_name)
);

CREATE TABLE app_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID REFERENCES app_users(id),
    action      TEXT,
    detail      JSONB,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_app_user_projects_user_id ON app_user_projects(user_id);
```

---

## 9. SQL → API Mapping

All 5 Grafana dashboards port directly. SQL is unchanged.

| Grafana | API route | SQL |
|---|---|---|
| `$projects` | `?projects=FQM+Tracking,Reload` | `folder_name = ANY(${projects})` |
| `$year` | `?year=2026` | `EXTRACT(YEAR FROM best_date) = ${year}` |
| `$country` | `?country=ZA,ZW` | `country = ANY(${countries})` |
| `$__timeFilter` | `?from=2026-01-01&to=2026-12-31` | `best_date BETWEEN ${from} AND ${to}` |
| Datasource UID | Removed | Direct postgres client connection |

**Security:** `?projects` values are validated against JWT `allowed_projects` before SQL execution.

**Master Alerts Table (ID:4):** 4-trigger UNION ALL ports verbatim into `lib/queries/audit.ts`.
`NULL::integer` padding and `client_name` LATERAL subquery preserved exactly.

**FQM:** `folder_name` hardcoded to `'FQM Tracking Sheets'` in `lib/queries/fqm.ts`. No project/
country params. Transporter CASE normalization preserved verbatim.

---

## 10. Deployment

### systemd service
```ini
[Unit]
Description=OmniMetrics Portal
After=network.target postgresql.service

[Service]
User=www-data
WorkingDirectory=/opt/omnimetrics-portal/apps/web
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=always
Environment=PORT=3002
Environment=NODE_ENV=production
EnvironmentFile=/opt/omnimetrics-portal/apps/web/.env.local

[Install]
WantedBy=multi-user.target
```

### Nginx
```nginx
server {
    listen 443 ssl;
    server_name omnimetrics.dns.jays-network.com;
    ssl_certificate     /etc/ssl/omnimetrics/cert.pem;
    ssl_certificate_key /etc/ssl/omnimetrics/key.pem;
    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Host $host;
        # OVERWRITE (never append to) the client-IP headers: lib/rate-limit.ts trusts them.
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
server {
    listen 80;
    server_name omnimetrics.dns.jays-network.com;
    return 301 https://$host$request_uri;
}
```

**Client-IP headers.** `next start` binds 127.0.0.1, so only Nginx can reach it. Nginx must overwrite
`X-Forwarded-For` and `X-Real-IP` with values it determined itself (never `$proxy_add_x_forwarded_for`), because
`lib/rate-limit.ts` trusts them; a client-supplied value would let an attacker dodge the login rate limit. When traffic
arrives via Cloudflare or a tunnel, `$remote_addr` is Cloudflare's address, so set both headers from
`CF-Connecting-IP` instead (`proxy_set_header X-Forwarded-For $http_cf_connecting_ip;`), and only accept that header
from Cloudflare's IP ranges.

### `.env.local`
```env
DATABASE_URL=postgresql://jaysnet_admin:PASSWORD@localhost:5432/jaysnet_data
DATABASE_URL_READONLY=postgresql://portal_reader:PASSWORD@localhost:5432/jaysnet_data
JWT_SECRET=<openssl rand -hex 32>
JWT_EXPIRE_HOURS=24
NEXT_PUBLIC_BRAND_NAME=OmniMetrics
NEXT_PUBLIC_BRAND_COLOR=#3b82f6
NEXT_PUBLIC_BRAND_FONT_DISPLAY=Syne
NEXT_PUBLIC_BRAND_FONT_BODY=DM+Sans
```

---

## 11. Mobile Provisions (Future — Expo React Native)

No mobile code is written now. The following is provisioned today so the pivot is clean.

**Already done for mobile:**
1. `packages/types/` — Expo app imports identical TypeScript interfaces. Zero API contract duplication.
2. API-first — every data source is a `/api/*` route. Expo calls the same endpoints with JWT stored
   in `expo-secure-store` instead of an HTTP-only cookie.
3. Monorepo — `apps/mobile/` placeholder. `pnpm turbo run dev` starts both apps when ready.

**Mobile auth change needed:** HTTP-only cookies don't work in React Native. When building mobile,
add detection in `/api/auth/login`: if `X-Client: mobile` header is present, return JWT in response
body instead of cookie. Native client stores in `expo-secure-store` and sends as
`Authorization: Bearer <token>` header.

**Recommended mobile stack (when starting):**
- Expo SDK 53+ with `expo-router` (mirrors Next.js App Router file structure)
- NativeWind v4 (Tailwind class names in React Native)
- Victory Native XL (best React Native charting library)
- `react-native-maps` for maps
- `expo-secure-store` for JWT

---

## 12. Auto-Refresh System

A first-class feature matching Grafana's refresh interval control — the dashboard polls PostgreSQL
at a user-selected interval and silently updates all panels. No page reload, no user interaction
required. Designed for both analyst workstations and TV/wall-display deployments.

---

### Refresh Interval Selector (UI Control)

Lives in the **Topbar** — always visible regardless of which dashboard is active.
Matches the Grafana UX exactly: a dropdown the user sets once and the dashboard handles the rest.

```
Topbar layout:
[ Logo ]  [ Dashboard Title ]  ──────────────  [ 🔄 Refresh: 30s ▾ ]  [ User ▾ ]
```

**Available intervals (matches Grafana defaults):**

| Option | Value |
|---|---|
| Off | Disabled — manual only |
| 5s | 5 000 ms |
| 10s | 10 000 ms |
| 30s | 30 000 ms — **default** |
| 1m | 60 000 ms |
| 5m | 300 000 ms |
| 15m | 900 000 ms |

Default on load: **30 seconds**. User selection persists in `localStorage` so it survives page
reloads and tab restores.

**`components/layout/RefreshIntervalSelector.tsx`:**
```typescript
const INTERVALS = [
  { label: 'Off',  value: 0 },
  { label: '5s',   value: 5_000 },
  { label: '10s',  value: 10_000 },
  { label: '30s',  value: 30_000 },   // default
  { label: '1m',   value: 60_000 },
  { label: '5m',   value: 300_000 },
  { label: '15m',  value: 900_000 },
]
// Renders as a shadcn Select — compact, fits in Topbar
// Reads/writes to Zustand refreshInterval + syncs to localStorage
```

---

### How It Wires to Data

The selected interval flows from Zustand into every TanStack Query hook automatically.
Individual panels do not manage their own timers — there is one global interval for the whole
dashboard, just like Grafana.

**Zustand store (`hooks/useFilters.ts`) addition:**
```typescript
refreshInterval: number          // ms — 0 = off
setRefreshInterval: (ms: number) => void
```

**Every dashboard query hook reads from the store:**
```typescript
// hooks/useDashboard.ts
export function useWorldriskSummary(filters: Filters) {
  const { refreshInterval } = useFiltersStore()

  return useQuery({
    queryKey: ['worldrisk', 'summary', filters],
    queryFn:  () => api.get('/dashboard/worldrisk/summary', filters),
    refetchInterval:             refreshInterval || false,  // false = disabled
    refetchIntervalInBackground: false,  // pauses when browser tab is hidden
  })
}
```

`refetchIntervalInBackground: false` is intentional — when the tab is hidden (e.g. analyst switches
windows) polling pauses, saving unnecessary DB load. When the tab comes back into focus TanStack
Query immediately refetches, so the data is always fresh when someone looks at it.

---

### Refresh State Indicators

Each panel shows its refresh state passively — never intrusive, always informative.

| State | Visual |
|---|---|
| **Live / fresh** | No indicator |
| **Fetching** | Subtle spinner (12px) in top-right corner of panel, muted colour |
| **Stale / error** | Amber dot + `Last updated HH:MM` timestamp in panel footer |

Built into the base `StatCard`, `StatusDonut`, `TrendArea`, `AlertsTable`, and `TrackingTable`
components. Every panel gets this automatically — no per-panel wiring needed.

A thin 1px progress bar under the Topbar fills across the current interval duration, giving a clear
visual signal of when the next refresh will fire. Resets and restarts on each successful fetch.

---

### Kiosk / TV Display Mode (Bonus Feature)

For clients displaying on a wall-mounted screen with no keyboard. Activated via URL param:
`/dashboard/worldrisk?kiosk=true`

- Hides Sidebar, Topbar, FilterBar — full-screen panels only
- Refresh interval locked to 30s (ignores localStorage)
- Optional carousel: `?kiosk=true&rotate=300` rotates dashboards every 300 seconds
- `?kiosk=true&dashboards=worldrisk,audit,fqm` controls which dashboards rotate

**New files (kiosk is a Phase 5 addition, not Phase 1):**
```
hooks/useKiosk.ts                  ← URL param reading, carousel timer, localStorage
components/layout/KioskShell.tsx   ← Full-screen wrapper, no chrome
components/layout/CarouselController.tsx  ← Dashboard rotation with Motion transitions
```

---

## 13. Build Phases

### Phase 1 — Foundation
- [ ] Install Node.js 22 LTS + pnpm on LXC
- [ ] Scaffold Turborepo with `apps/web` + `packages/types`
- [ ] Init Next.js 15, install full package set
- [ ] `lib/db.ts` postgres client + test connection to `jaysnet_data`
- [ ] Auth routes (login/logout/me) + `requireAuth()` helper
- [ ] `app_users` + `app_user_projects` tables created
- [ ] Login page (full-screen, branded with CSS variables)
- [ ] `middleware.ts` route guard
- [ ] **Verify:** login → cookie set → `/dashboard` loads → `/login` without cookie redirects

### Phase 2 — First Dashboard (Worldrisk Tracking)
- [ ] Port Worldrisk SQL into `lib/queries/worldrisk.ts`
- [ ] `/api/dashboard/worldrisk/*` routes wired
- [ ] `StatCard`, `StatusDonut`, `TrendArea` components (shadcn charts / Recharts) — with built-in stale/refresh state
- [ ] `Sidebar`, `Topbar`, `FilterBar` layout components
- [ ] `RefreshIntervalSelector` in Topbar — Off / 5s / 10s / 30s / 1m / 5m / 15m
- [ ] TanStack Query hooks reading `refreshInterval` from Zustand store
- [ ] FilterBar wired to Zustand + query invalidation
- [ ] Full worldrisk dashboard rendering live data with auto-refresh working

### Phase 3 — Remaining Dashboards
- [ ] ADARS (ID:2), Devices (ID:3), Tracking Table (ID:5)
- [ ] Audit/Alerts (ID:4) — Master Alerts UNION ALL + `AlertsTable`
- [ ] FQM — `TransporterBar` (shadcn charts) + `DestinationHeatmap` (Nivo)

### Phase 4 — Admin & User Management
- [ ] User list, create, edit, deactivate
- [ ] Assign / remove projects per user
- [ ] Self-service password change
- [ ] Audit log viewer

### Phase 5 — Polish, Deploy & Handover
- [ ] Motion animations — staggered panel reveals, stat card counters
- [ ] Progress bar refresh indicator under Topbar
- [ ] Kiosk mode (`?kiosk=true`) + carousel rotation (`?rotate=300`)
- [ ] Dark/light mode toggle (`next-themes`)
- [ ] Nginx + SSL certbot
- [ ] systemd enabled + tested
- [ ] `output: 'standalone'` build (smaller production footprint)
- [ ] Decommission Grafana port 3000

### Phase 6+ — Mobile (separate project brief)
- [ ] Scaffold `apps/mobile` Expo
- [ ] Mobile auth (JWT in body → secure store)
- [ ] Port dashboards to Victory Native charts

---

## 13. Existing Infrastructure — Unchanged Throughout

| Component | Location | Status |
|---|---|---|
| `Sync_WorldRisk.py` | `/opt/jaysnet/` | Unchanged |
| `Sync_ADARS.py` | `/opt/jaysnet/` | Unchanged |
| `check_border_overdue.py` | `/opt/jaysnet/` | Unchanged |
| `Global_Scanner.py` | `/opt/jaysnet/` | Unchanged |
| All cron jobs | `/etc/cron.d/` | Unchanged |
| PostgreSQL 18 | `localhost:5432` | Unchanged |
| Grafana OSS | Port 3000 | Decommission Phase 5 |

Portal is a **read-only visualization layer**. No writes to `worldrisk_tracking` or `adars_tracking`.

---

## 14. Critical Data Context

**Tables:** `worldrisk_tracking` (~150,981 rows), `adars_tracking` (~86,530 rows)

**`folder_name`** is the per-client filter — must appear in every dashboard query.

**Exclusive bucketing:** Trucks in exactly one time bucket. Upper-bound ceiling on each tier.
No Update: `<2hr`, `2–6hr`, `6–12hr`, `12–24hr`. Forecast: `1–7d`, `7+d`.

**Master Alerts (ID:4) — UNION ALL triggers:**
- T1: >1hr no update (`active_trucks` CTE, last 60 days)
- T2: border check failed/overdue JSON
- T3: overdue forecast >2 days
- T4: multi-trip trucks (`dupe_base_data` CTE — **must include `folder_name IN ($projects)`
  pre-filter** — omitting causes silent truck dropout)
- `NULL::integer` padding required for column alignment
- `client_name` via LATERAL subquery on `raw_data` JSON keys: `Client`, `CLIENT`, `client`
- `row_modified_at` used for trigger timing logic

**FQM:** `folder_name = 'FQM Tracking Sheets'` hardcoded. No `$country`/`$projects` params.
Transporter CASE: INARA, BRIDGE SHIPPING, AFRICLAN, BHL LOGISTICS, NYATI, CML, RELOAD variants.
`08/0` excluded.

**Performance:** Place `folder_name =` filter at top of every `base_data` CTE before CASE blocks.

---

## 15. First Commands for New Chat

Run on OmniMetrics LXC, paste output, then say: **"Start Phase 1 — Foundation."**

```bash
node --version 2>/dev/null || echo "node not installed"
pnpm --version 2>/dev/null || echo "pnpm not installed"
psql -U jaysnet_admin -d jaysnet_data -h localhost -c "\dt app_*" 2>/dev/null || echo "app_ tables not yet created"
free -h && nproc
cat /etc/os-release | grep PRETTY_NAME
```

---

*End of architecture document. Paste this entire file into a new chat to begin Phase 1 implementation.*