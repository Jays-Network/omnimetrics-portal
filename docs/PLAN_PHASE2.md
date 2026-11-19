# Phase 2 plan: WorldRisk Tracking Sheets (Steps 2 to 4)

Status: DRAFT, plan only. Nothing is built. Waiting for Jay to reply "approved".
Sources read: `docs/CONTEXT.md` (R1 to R5), `CLAUDE.md`, `docs/PROGRESS.md`, and `grafana-export/Worldrisk Tracking Sheets-1795125057812.json` (Grafana v2 schema; panel SQL is at `spec.elements["panel-N"].spec.data.spec.queries[0].spec.query.spec.rawSql`).
Scope: this dashboard only, admin-only, no client logins. Refresh 1m. Grafana default time range `now-6h`.

## 0. Variable and macro mapping (applies to every panel)

| Grafana | Definition in JSON | Portal parameter |
|---|---|---|
| `$projects` | multi, includeAll, no `allValue`, query = mapped-label CASE over `folder_name`, excluding `%Old%`, `%Archive%`, GDG, Suleman Roadway Logistics, Trafalgar, Workspace Root, WorldRisk Contractors | `folders: string[]` of raw `folder_name`, always passed as `folder_name = ANY($n)`. "All" = the resolved allowlist (see Q5), never "no filter". `test sheets` removed (R1). |
| `$year` | multi, includeAll, `to_char(booking_date,'YYYY')`. **Used only by the Heatmap.** | `years: string[]`, heatmap only (deferred). |
| `$country` | custom, multi, default DRC, list `All,DRC,Zambia,Tanzania,Namibia,Zimbabwe,Botswana,Mozambique,South Africa`. `'All' IN ($country)` is a sentinel. | `countries: string[] \| null` (null = All). Matched against the country CASE as `= ANY($n)`. |
| `$__timeFilter(col)` | dashboard range | `from`, `to` (ISO) as `col BETWEEN $from AND $to`. Used by Monthly, Weekly, Daily, Dispatched (on `best_date`) and Escorts (on `booking_date`). |
| `${projects:singlequote}`, `${country:singlequote}` | Escorts only | Same parameters as above. |

Cross-panel facts the SQL shows (all verified in the JSON, not from memory):

- **Three date regimes, not one.** Type A = first non-null `COALESCE` in priority order (Monthly P1, Dispatched P9). Type B = "two-tier": the earliest valid date of the 11 date columns (cast-safe, `> '2010-01-01'`), falling back to `booking_date` (Weekly P12, Daily P11). Type C = plain `booking_date`, no `best_date` (Grand Total P8, Active Tracks P4, Escorts P2, Heatmap P3).
- **Two country semantics.** Route-based `origin_country OR dest_country` (P1, P9, P11, P12, P2) vs `current_location` with a shorter keyword list (P8, P4). Both are fed by the one `$country`.
- **Three project-scoping styles.** Raw `folder_name IN` (P8, P4, P2, P3). Moxico CASE + "Cross border Archives" client branch (P1, P9). `mapped_project_name` derived from the `raw_data` client (P11, P12).
- **DISTINCT keys differ.** P8/P4/P3: `concat(reg_number, booking_date)` (no normalisation). P1/P9/P11/P12: `concat(UPPER(REPLACE(reg_number,' ','')), best_date)`. P2: `concat(reg_number,'-',region,'-',escort_name_value)`.
- Exclusion matrix (sheet_name `NOT ILIKE`, unless noted):

| | Invoice | invoicing | GDG | Trafalgar | Suleman | Reload inv. 18/01/26 prior | exact `Reload invoicing Sheet` | SRL Tracking Sheet | Bridge Cross Border inv. | Convoy breaks | ZZZ Archive (folder) | client Aquarius / RELOAD ZLT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P8 Grand Total | x | | x | x | x | x | | x | x | | x | |
| P9 Dispatched | x | | x | x | x | x | x | x | | | | |
| P4 Active Tracks | x | | x | x | x | x | | | x | x | x | |
| P1 Monthly | x | | x | x | x | x | x | x | | | | |
| P12 Weekly | x | x | x | x | x | x | x | x | x | | | x |
| P11 Daily | x | x | x | x | x | x | x | x | x | | | x |
| P2 Escorts | x | | x | x | x | x | | | | | | |
| P3 Heatmap | x | | | | | | | | | | | |

All panels also have `workspace_name != 'WorldRisk Contractors'` (note: this drops rows where `workspace_name` is NULL).
Each panel keeps its own list as a named constant. They are not merged (CONTEXT 3.12).

Known copy-paste slips inside the country CASE (shared across panels, port faithfully and flag, R5):
- Destination block uses `loading_location` instead of `offloading_location` for `%Mikas%` (DRC) and `%Palapye%` (Botswana) in P1, P9, P11, P12. P2 has them right.
- Destination block, South Africa: `%Weinert%` uses `loading_location` in P11 and P12 only.
- Port design: the keyword lists live once in `countries.ts` and are bound as `ILIKE ANY($n::text[])` (equivalent to the OR chain). The slips are per-panel "quirk" flags, on by default to match Grafana, listed in the deviation log, to be fixed only on Jay's ruling.

## 1. Panels, in order

### 1.1 Grand Total (panel-8, stat, description "Of Active Trucks")
1. **What it counts:** distinct (reg_number, booking_date) of currently active trucks.
2. **Date:** no `best_date`. Window `booking_date >= CURRENT_DATE - INTERVAL '60 day'` (R4; the "90 days" comment is wrong). Exclusions: workspace, `folder_name NOT ILIKE '%ZZZ Archive%'`, `current_location` NOT ILIKE `Delivered%`/`Arrived%`/`Invoiced%`/`Complete%` and not null/empty, `status` NOT ILIKE the 16 patterns (Delivered, Offloaded, Complete, Cancel, Archive, Arrived, Invoiced, OFFLOADING, jimmy, FORECAST, Moved, Stack, Rail, sps, TRAF, RECEIVED) and not null/empty, sheet list per matrix.
3. **Variables:** `folders` (raw `folder_name = ANY`), `countries` against the **current_location** CASE (Zimbabwe, Botswana, DRC, Zambia, South Africa, Tanzania, Namibia, Mozambique, else `Other`). The time range is not used.
4. **Output:** one row, column `Total Active Trucks`. Component: `StatCard`.
5. **Flags:** Q1 (not `best_date`), Q9 (window and sheet list differ from Active Tracks), Q5.

### 1.2 Grand Total of Dispatched (panel-9, stat)
1. **What it counts:** distinct (normalised reg, best_date) for trips in the time range, filtered by route country. Column is named `Total Complete`.
2. **Date:** Type A, quoted: `COALESCE(intransit_began_date, drc_dispatch_date, zam_dispatch_date, nam_dispatch_date, tan_dispatch_date, zim_dispatch_date, bots_dispatch_date, moz_dispatch_date, sa_dispatch_date, dispatch_date, intransit_date, booking_date)`. Window `$__timeFilter(best_date)`. No status or location filter, no ZZZ filter. Sheet list per matrix.
3. **Variables:** `from`/`to`; project match = `'All' IN ($projects) OR CASE(Glencore+Moxico sheet -> 'Moxico Mine- Zambia', else folder_name) IN ($projects) OR (folder/sheet ILIKE '%Cross border Archives%' AND client-derived label IN ($projects))`; `countries` against `origin_country`/`dest_country`.
4. **Output:** one row, `Total Complete`. Component: `StatCard`.
5. **Flags:** Q2, Q3, Q4, Q5, Q6, Q8. The base CTE has no `folder_name` predicate in Grafana.

### 1.3 Active Tracks (panel-4, bar gauge, vertical LCD, transformation `rowsToFields`)
1. **What it counts:** active trucks per renamed status. Status CASE: `%Truck Park%` -> TRUCK PARK; `%Transit%` or `%Yellow Flag%` -> IN TRANSIT; `%Border%` -> BORDER CROSSING; `%Staging%` or `%Yard%` -> STAGING; `%Vehicle Breakdown%` or `%Failure%` -> BREAKDOWN; else raw status.
2. **Date:** no `best_date`. Window `booking_date >= CURRENT_DATE - INTERVAL '30 day'` (the comment says 90). Exclusions as Grand Total, except the sheet list (matrix: adds `Convoy breaks`, lacks `SRL Tracking Sheet`).
3. **Variables:** `folders`, `countries` (current_location CASE). Time range not used.
4. **Output:** `Current Status`, `Active Trucks`, ordered by count desc, `LIMIT 5000`. Component: `StatusBars` (shadcn chart `BarChart`; the `rowsToFields` transform only pivots for Grafana's gauge).
5. **Flags:** Q9 (30 vs 60 days; sum of bars will not equal Grand Total), Q5.

### 1.4 Monthly Total Trucks (panel-1, bar chart)
1. **What it counts:** distinct (normalised reg, best_date) per custom billing month.
2. **Date:** Type A (same COALESCE as 1.2). Billing month: `best_date <= last Thursday of its month` -> that month, else next month. Last Thursday = `last_day - ((ISODOW(last_day)::int + 3) % 7)`; label `to_char(..., 'YYYY-MM')`. Window `$__timeFilter(best_date)`. Sheet list per matrix. No client exclusions.
3. **Variables:** `from`/`to`; project match as 1.2; `countries` route-based.
4. **Output:** `Year_Month`, `Total Trucks`, ordered ascending, `LIMIT 5000`. Component: `BarChartCard`.
5. **Flags:** Q1, Q2, Q3, Q4, Q5, Q6, Q8.

### 1.5 Weekly Total Trucks (panel-12, bar chart)
1. **What it counts:** distinct (normalised reg, best_date) per ISO week (`date_trunc('week', best_date::timestamp)`, Monday).
2. **Date:** Type B, quoted: `COALESCE((SELECT min(d::date) FROM (VALUES (NULLIF(TRIM(intransit_began_date::text),'')), ... dispatch_date, intransit_date) AS dates(d) WHERE d IS NOT NULL AND d::text != '' AND d::date > '2010-01-01'), NULLIF(TRIM(booking_date::text),'')::date)` over the 11 columns in this order: intransit_began_date, drc, zam, nam, tan, zim, bots, moz, sa, dispatch_date, intransit_date. Window `$__timeFilter(best_date)`. Sheet and client exclusions per matrix.
3. **Variables:** `from`/`to`; project match `'All' IN ($projects) OR mapped_project_name IN ($projects)`; `countries` route-based (country CASE is computed in the base layer for every row, before any filter).
4. **Output:** `time`, `Total Trucks`, ascending, `LIMIT 5000`. Component: `BarChartCard`.
5. **Flags:** Q1, Q2 (mapped label with the Bridge CASE R2 forbids), Q5, Q6, Q8.

### 1.6 Daily Total Trucks (panel-11, bar chart)
Same as 1.5 (Type B, same exclusions, same project matcher) except: `base_data` then `trip_details` CTEs; grouped by `best_date::timestamp`; output `time`, `Total Trucks`. Component: `BarChartCard`. Flags: as 1.5.

### 1.7 Number of Escorts (panel-2, bar chart)
1. **What it counts:** distinct (reg_number, region, escort name) per calendar month of `booking_date`. Rows are unpivoted with `CROSS JOIN LATERAL (VALUES ('General/RSA', escort_name), ('DRC', escort_drc), ('Zambia', escort_zam), ('Tanzania', escort_tan), ('Zimbabwe', escort_zim), ('Mozambique', escort_moz), ('Namibia', escort_nam), ('Malawi', escort_mal), ('Botswana', escort_bots))`. Kept only if the escort value is not null, not empty and not `'None'`.
2. **Date:** Type C. Window `$__timeFilter(booking_date)`. Month = `to_char(booking_date,'YYYY-MM')`, a calendar month, not the billing month. Sheet list per matrix. No ZZZ filter.
3. **Variables:** `from`/`to`; `folder_name = ANY`; `countries` route-based (origin or dest).
4. **Output:** `Year_Month`, `Total Escorted Trips`, ascending, `LIMIT 5000`. Component: `BarChartCard`.
5. **Flags:** Q5, Q6, Q8. In Grafana `$__timeFilter` precedes the `folder_name` predicate; the port puts `folder_name` first.

### 1.8 Destination Heatmap (panel-3, geomap) - DEFERRED
1. **What it counts:** distinct (reg_number, booking_date) per (`offloading_location`, `offloading_lat`, `offloading_lon`).
2. **Date:** Type C. Filter `to_char(booking_date,'YYYY') IN ($year)`, lat/lon not null, workspace, `sheet_name NOT ILIKE '%Invoice%'`. No ZZZ filter.
3. **Variables:** `years`, `folders`. No country, no time range.
4. **Output:** `Destination`, `latitude`, `longitude`, `Volume`, ordered by Volume desc, `LIMIT 5000`. Component: none in Phase 2 (map libs are out of scope). Needs `year` in `FiltersSchema`, so I will reserve the field without wiring it.
5. **Flags:** Q10.

## 2. Steps

### Step 2: filters and scoping
- **Create:** `apps/web/lib/queries/filters.ts` (`FiltersSchema` with Zod; `resolveFilters(user, input, universe)`; `FilterError` with 400/403); `packages/types/worldrisk.ts` (`Filters`, `ResolvedFilters`, `COUNTRIES`, `EXCLUDED_FOLDERS = ['test sheets']`); tests `apps/web/tests/filters.test.ts`.
- **Rules built in:** the schema accepts raw `folder_name` strings only, no labels. `test sheets` is stripped from requested folders, from `allowed_projects` and from the universe, for every role (R1). Admin: any folder in the universe. Builder/viewer: requested folders must be a subset of `allowed_projects`, otherwise 403 (not silently dropped). "All"/empty = the user's whole allowed set. An empty result is an error, never "no filter". Countries must be in the fixed list. `from`/`to` valid, `from <= to`, span capped.
- **Pure function:** the folder universe is injected, so Step 2 needs no DB and no portal_reader.
- **Tests:** `test sheets` removed from every path and role; admin All; viewer subset OK; viewer outside scope 403; empty allowed set -> error; schema rejections (bad country, bad date, huge array, label instead of folder); 'All' sentinel handling.
- **Stop:** `pnpm --filter web typecheck` and `test` green, update PROGRESS.md, wait for "approved".

### Step 3: shared base query, summary route, 004 migration
- **Create:** `db/migrations/004_portal_reader_role.sql.example`, in the style of 003: `portal_reader` LOGIN, `ALTER ROLE ... SET statement_timeout = '10s'` and `default_transaction_read_only = on`, `GRANT CONNECT`, `USAGE ON SCHEMA public`, `SELECT` on `worldrisk_tracking` and `adars_tracking` only, nothing else. I do not run it.
- **Create:** `apps/web/lib/queries/worldrisk/`: `constants.ts` (per-panel sheet, status and location exclusion lists), `countries.ts` (keyword arrays, quirk flags, CASE builders using `ILIKE ANY`), `dates.ts` (Type A, Type B, billing month fragments), `base.ts` (base CTE builders; `WHERE folder_name = ANY($n) AND folder_name <> 'test sheets'` is the first predicate, before any CASE), `summary.ts`.
- **Routes:** `app/api/dashboard/worldrisk/summary/route.ts` (calls `requireAuth()`, admin-only for now, `FiltersSchema` -> `resolveFilters` -> queries on `getReadonlyDb()`). Returns `grandTotal` (P8), `dispatched` (P9) and `activeTracks` (P4). Plus `app/api/dashboard/worldrisk/folders/route.ts` for the dropdown universe (raw `folder_name` values, with the dropdown's own exclusions and `test sheets` removed). Response types in `packages/types`.
- **Hard rules:** parameterised SQL only (`sql` fragments or `sql.unsafe(text, params)`, never interpolation); `LIMIT 5000` on multi-row queries; row cap and statement timeout from `getReadonlyDb()`; every deviation from the Grafana SQL recorded in a `// DEVIATION:` comment and in `docs/PARITY_PHASE2.md`.
- **Tests:** the builder returns `{text, params}`; injection strings appear only in `params`; `folder_name` is the first predicate in every base CTE; `test sheets` never reaches SQL; golden test that parses the Grafana JSON in `grafana-export/` and checks the keyword arrays and status/sheet lists match the source; route tests with a mocked DB (401, 403 viewer out of scope, 400 bad filters, admin OK).
- **Stop:** code and tests green. Jay applies 004 by hand and fills `DATABASE_URL_READONLY`. I do not read `.env*`, so Jay runs the check against the real DB. I then update PROGRESS.md and wait for "approved".

### Step 3b: design direction
- Run `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "operations dashboard fleet tracking data-dense" --design-system --persist -p "OmniMetrics" --output-dir docs/design`. The script writes `design-system/<slug>/MASTER.md`, not `DIRECTION.md`. I will condense it into `docs/design/DIRECTION.md` and remove the generated folder (Q11).
- Constraints enforced in the file: Data-Dense Dashboard style, brand CSS variables and white-label theming win, shadcn/ui + shadcn charts (Recharts), no landing-page patterns, motion deferred to Phase 5.
- **Files:** `docs/design/DIRECTION.md` only. **Stop** for review.

### Step 4: first end-to-end panels (Grand Total, then Monthly)
- **Create:** `lib/queries/worldrisk/monthly.ts`, `app/api/dashboard/worldrisk/monthly/route.ts`, Zustand filter store, TanStack Query hooks (refresh interval selector deferred), `components/dashboard/{StatCard,BarChartCard,FilterBar}.tsx`, shadcn `components/ui/chart.tsx`, `app/dashboard/worldrisk/page.tsx` (admin-only, reads `requireAuth()`), `docs/PARITY_PHASE2.md`.
- **New dependency (Q12):** `recharts` is not in `apps/web/package.json`. I need your OK before adding it.
- **Tests:** Vitest for the Monthly builder (billing-month fragment, Type A order, params, first predicate, `LIMIT`); a TS reference of the billing-month rule checked on edge dates (month ending Thursday, Friday, year rollover); component render tests for `StatCard` and `BarChartCard`.
- **Side-by-side with Grafana :3000:** same folder(s), same country, same range. Jay supplies the Grafana numbers (I cannot log in to Grafana), I supply the portal numbers. Results go into `docs/PARITY_PHASE2.md`, one row per panel and filter combination, with expected divergences from Q2 to Q4 pre-listed. Mismatches are logged, not fixed (R5).
- **Stop:** typecheck, tests and build green; Grand Total and Monthly rendering; parity table filled. Wait for Jay's review.

## 3. Open questions (answer before Step 2)

Conflicts with CONTEXT.md or the rules (I have not chosen):
1. CONTEXT 3.6 and 6.5 say Tracking Sheets uses the first-non-null `best_date`. In the JSON only Monthly (P1) and Dispatched (P9) do. Daily (P11) and Weekly (P12) use the earliest-date two-tier version, and the other panels use `booking_date`. Daily, Weekly and Monthly totals therefore will not reconcile. Port each as coded?
2. Daily and Weekly scope by `mapped_project_name` (client from `raw_data`, Bridge -> "Steinweg Bridge"), the CASE that R2 says not to port, and a mapped label cannot be the scoping key. My plan scopes them by raw `folder_name` and keeps their client exclusions. Counts will differ from Grafana where the client differs from the folder. Confirm?
3. Monthly and Dispatched map the Glencore "Moxico Mine- Zambia" sheet to its own label. With raw scoping, selecting `Glencore` includes the Moxico rows (819) and there is no separate Moxico option. CONTEXT Q3 defers this. OK to follow the default (raw `folder_name` only)?
4. Monthly and Dispatched also pull rows from `%Cross border Archives%` folders by client label. Raw-folder scoping cannot express that, and "folder_name first" would drop them. Drop the branch (recorded deviation) or keep it?
5. `$projects` has no `allValue`, so in Grafana `'All' IN ($projects)` is probably never true and "All" expands to the dropdown labels. So "All" excludes folders the dropdown filters out (`%Old%`, `%Archive%`, GDG, Suleman Roadway Logistics, Trafalgar, Workspace Root, WorldRisk Contractors) and, in the panels that filter on raw `folder_name`, any folder whose label differs. Should portal "All" = every raw folder except those exclusions and `test sheets`? I will verify the Grafana behaviour side by side.
6. Time range: Grafana defaults to `now-6h`, applied to a date column. What default range should the portal use, and in which timezone? (Grafana's is browser time.)

Needed to port faithfully:
7. Country filter has two semantics (current_location for Grand Total and Active Tracks, origin/destination for the rest), and `Other` cannot be selected. Keep both?
8. Port the `loading_location`-in-destination slips (Mikas, Palapye, and Weinert for Daily/Weekly) as-is with quirk flags, to fix only on your ruling?
9. R4 covers the Grand Total 60 days. Active Tracks is coded as 30 days (comment says 90) and has a different sheet exclusion list. Port it as coded?
10. Heatmap: skip entirely in Phase 2 (my assumption), or add a plain table of the top destinations?
11. `--persist` writes `design-system/omnimetrics/MASTER.md`. OK to condense it into `docs/design/DIRECTION.md` and delete the generated folder?
12. May I add `recharts` (needed for shadcn charts, the stack in CLAUDE.md) in Step 4?
13. I cannot read `.env*` or the DB yet. Please paste `\d worldrisk_tracking` (column types, especially the date columns and `workspace_name`/`status`). Type A and Type B only compile if the types line up.

Assumptions I will follow unless you say otherwise: the summary route returns P8, P9 and P4 together (only Grand Total is wired to the UI in Step 4); `test sheets` is matched exactly, with a case-insensitive SQL backstop; "Phase 2 admin-only" is enforced in the routes, not just the UI.
