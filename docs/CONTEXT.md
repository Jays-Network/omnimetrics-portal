# OmniMetrics: Domain and Decision Context

File: `docs/CONTEXT.md`. Compiled 2026-11-20 (updated with Jay's answers to Q1 and Q8) from project memory, the project docs, past project chats (Mar to Nov 2026) and the 8 Grafana dashboard JSONs in `grafana-export/`.

Read this before writing any SQL, project scoping or dashboard code. Source tags used below:
- **[Jay]** stated by Jay in the 2026-11-20 session. Authoritative.
- **[Chat Mon YYYY]** taken from a past chat (index in section 10).
- **[JSON]** observed in a Grafana dashboard export.
- **[Proposed]** a suggestion that Jay has not confirmed. Do not treat as a rule.

## 0. Precedence

1. Jay's rulings (section 1).
2. The conventions in this file (sections 2 to 4).
3. `docs/OmniMetrics_Portal_Architecture.md` (the older brief; parts are stale, for example Tremor and the FastAPI mentions).
4. The Grafana JSON in `grafana-export/`: the source for SQL logic, but with known inconsistencies (section 6).

If two sources disagree, stop and list it as an open question. Do not pick silently. Do not infer business meaning from a SQL `CASE` alone.

## 1. Jay's rulings

**R1. `test sheets` is ignored everywhere.** [Jay]
Exclude the folder `test sheets` from every query, filter list, count and chart, in every dashboard, for every role including admin. Some Grafana dashboards do not exclude it (the Tracking Sheets and Devices project lists). That is a Grafana omission, not a rule.

**R2. Steinweg Bridge is a client in general, but in the FQM and Glencore folders it is a transporter.** [Jay]
Rows in `FQM Tracking Sheets` and `Glencore` that mention Bridge must be calculated as a transporter, never as the client "Steinweg Bridge". Grafana's mapped-label `CASE` (`folder_name ILIKE '%Bridge%' OR sheet_name ILIKE '%Bridge%'` gives `'Steinweg Bridge'`) mislabels them, so do not port that `CASE` as-is. Observed rows: `FQM Tracking Sheets` 7,260 and `Glencore` 53 (section 5). The FQM dashboard already normalises transporters, with BRIDGE SHIPPING as one of them [Chat Apr 2026, JSON].
**The transporter is always the `transporter` column.** [Jay, 2026-11-20] Never derive a transporter from `folder_name`, `sheet_name` or `client_name`. Steinweg Bridge uses subcontractors, so Bridge rows can be ambiguous. Jay will sort this out in the final data-comparison phase. Until then, default = Grafana's definition, listed in docs/DECISIONS.md; do not guess.

**R4. Grand Total (Tracking Sheets) uses the 60-day window as coded.** [Jay] The code is newer than its comment, so the code wins. The "90 days" comment is wrong.

**R5. Grafana is a reference, not a target.** [Jay] We reuse Grafana SQL where it is good and change anything that is better. The side-by-side check against Grafana at :3000 exists to explain every difference, not to force equality.

**R6. Change rule.** Presentation, layout, interactions and query performance may be improved freely. Any change that alters a number a client or Jay would see (metric definition, time window, best_date, exclusions, scoping, what 'All' means) must be recorded in docs/DECISIONS.md with: Grafana behaviour, proposed portal behaviour, effect on counts, and wait for Jay's ruling. Until ruled, the default is Grafana's definition.

**R7. The SQL terminal is director-only.** [Jay, 2026-11-20, RULED]
The portal may accept raw SQL from the browser only through the SQL terminal, and only for the director (platform admin), not org admins, in v1. Widening it needs a new ruling. It runs one parser-verified SELECT in a read-only, always-rolled-back transaction with timeout, row cap and a relation allowlist, against the active organisation's integration only, and every run (also rejected ones) is audit-logged. Terminal SQL is never saved into a panel and results are unfiltered by R1. Details: docs/PLAN_BUILDER.md section 6. Related decisions (same date): tracking reads use one DB role per organisation (`portal_reader_wr`, `portal_reader_adars`); TOTP for platform admins is required before any client login.

**R3. Misalignment costs hours.** [Jay]
Context first, then SQL. Confirm each stage before moving on.

Other standing statements by Jay in past chats:
- Duplicate entries are grouped by the fixed invoicing period that opens on the 25th and closes on the 24th of the next month. Not date-exact, not rolling. [Chat Jul 2026]
- Glencore / `Moxico Mine- Zambia` is excluded from duplicate counting. [Chat Jul 2026]
- The `$country` variable was removed from the Audit dashboard on purpose, so the gauge and the table cannot diverge. [Chat Jul 2026]
- On the Audit dashboard, gauge totals and table rows must always match. [Chat Jul 2026]
- The FQM folder name is exactly `FQM Tracking Sheets`. [Chat Apr 2026]
- ADARS: every panel uses the date picker; audit panels read only `sheet_name = 'Control Tracking Sheet'`. [Chat Apr 2026]
- Finance: paid requests move from the 5 live sheets into the archive sheets. A row exists in one place at a time. New archive sheets must be discovered automatically (no hardcoded IDs). [Chat Aug 2026]
- Jay wants a Scratch-style visual block builder for panels so staff and clients can build their own without SQL (portal Phase 4b). [memory]

## 2. Business and data model

**Clients:** Reload, Alistair Logistics, Rangel, Steinweg Bridge, GSM, Glencore / Moxico Mine, FQM. **Countries:** Zimbabwe, Botswana, DRC, Zambia, South Africa, Tanzania, Namibia, Mozambique.

**Tables:** `worldrisk_tracking` (about 150,981 rows) and `adars_tracking` (about 86,530 rows), as at Apr 2026. Both are fed by Smartsheet sync scripts in `/opt/jaysnet/`. The portal never writes to them. Finance tables: `finance_expenses`, `finance_payment_requests`, `finance_payment_request_items`.

**Hierarchy:** Smartsheet workspace, then folder (`folder_name`), then sheet (`sheet_name`). `folder_name` is the per-client filter and must be the first predicate in every base CTE (performance and the T4 silent-dropout warning). Workspace `WorldRisk Contractors` and folders matching `%ZZZ Archive%` are excluded in the audit and tracking panels.

**Columns seen in the SQL:** `reg_number`, `booking_date`, `status`, `current_location`, `loading_location`, `offloading_location`, `offloading_lat/lon`, `device_number`, `row_modified_at`, `raw_data` (jsonb), the date columns `intransit_began_date`, `drc_/zam_/nam_/tan_/zim_/bots_/moz_/sa_dispatch_date`, `dispatch_date`, `intransit_date`, and the escort columns (`escort_name`, `escort_drc`, `escort_zam`, `escort_tan`, `escort_zim`, `escort_moz`, `escort_nam`, `escort_mal`, `escort_bots`).

**Client name:** `client_name` comes from `raw_data` keys `Client`, `CLIENT` or `client` (first non-empty), via a `LATERAL` subquery. `adars_tracking` has `client_name` and `client_group` as columns.

**Project labels in Grafana ("mapped_project_name"):** computed per row, not per folder: `Moxico Mine- Zambia` when folder matches Glencore and sheet matches Moxico; else client_name matched against Reload, Alistair, Rangel, Bridge/Steinweg, GSM; else folder-based fallback. The label is display and grouping only. It is not a security boundary (see section 7).

**Registration:** normalised as `UPPER(REPLACE(reg_number,' ',''))`. `TBA%` and `TBC%` are excluded from duplicate logic.

**Devices:** `device_number` must match `^[0-9]+$` and not equal `'0'`.

### worldrisk_tracking schema (supplied by Jay, 2026-11-20)

- Keys and text: `id` uuid (PK); `row_id`, `sheet_id`, `sheet_name`, `workspace_name`, `folder_name`, `transporter`, `reg_number`, `device_number`, `internal_ref`, `loading_location`, `offloading_location`, `current_location`, `status`, `escort_name` are text.
- Escorts (text): `escort_drc`, `escort_mal`, `escort_moz`, `escort_nam`, `escort_tan`, `escort_zam`, `escort_zim`, `escort_bots`.
- Coordinates (double precision): `loading_lat`, `loading_lon`, `offloading_lat`, `offloading_lon`.
- Dates (type `date`): `booking_date`, `dispatch_date`, `intransit_date`, `intransit_began_date`, `drc_dispatch_date`, `zam_dispatch_date`, `nam_dispatch_date`, `tan_dispatch_date`, `zim_dispatch_date`, `bots_dispatch_date`, `moz_dispatch_date`, `sa_dispatch_date`. Because every one is `date`, both `best_date` forms compile; port the `NULLIF(TRIM(x::text),'')` casts as coded.
- Timestamps: `system_created_at` and `row_modified_at` are `timestamp WITHOUT time zone`. The stored zone is not yet confirmed.
- `raw_data` jsonb.
- **No `client_name` and no country column.** Both are derived at query time (client from `raw_data` keys `Client`/`CLIENT`/`client`; country from location keyword lists).
- Indexes: only `worldrisk_tracking_pkey (id)` and `worldrisk_tracking_row_sheet_unique UNIQUE (row_id, sheet_id)`. Nothing on `folder_name` or any date, so "folder_name first" is a logical discipline, not an index guarantee; expect sequential scans and keep the 10s statement timeout in mind.

## 3. SQL conventions that recur

1. `folder_name` first, before any `CASE` or `LATERAL`.
2. Exclusive bucketing: a truck appears in exactly one time band, using upper-bound ceilings. No update tiers: 2hr / 6hr / 12hr / 24hr. Forecast tiers: 1 day through 7+ days, plus a "Forecast Below 1 Day" bucket on ADARS. Forecast is split out of the "no update" tiers. Exact boundaries: read them from the Audit JSON, they are not restated here. [Chat Apr 2026]
3. Master Alerts triggers (WorldRisk Audit): T1 no update, T2 border check failed/overdue (from JSON in `raw_data`), T3 overdue forecast, T4 multi-trip/duplicate. `NULL::integer` padding keeps UNION ALL columns aligned. [architecture brief]
4. Border check failed: logic lives in the Audit JSON. Copy it from there, do not rewrite it from memory.
5. A dispatch is `COUNT(DISTINCT UPPER(REPLACE(reg_number,' ','')) || best_date)`.
6. `best_date` differs by dashboard and, on Tracking Sheets, by panel (section 6, item 5). Default = Grafana's definition per panel, listed in docs/DECISIONS.md (D1). Do not unify without a ruling.
7. Duplicate entry: keep the latest row per (clean_reg, best_date) by `row_modified_at`, then group by invoicing period `(date_trunc('month', best_date - interval '24 days') + interval '24 days')::date`; a duplicate is a group with more than one row. The table returns every occurrence.
8. Duplicate exclusions seen in chats (sheet_name): Invoice/invoicing, GDG, Trafalgar, Suleman Roadway Logistics, SRL Tracking Sheet, Bridge Cross Border invoicing Sheet, JHB Local, DBN Local, DBN-PE; client_name: Reload Aquarius Shipping, RELOAD ZLT; and the `Moxico Mine- Zambia` label. Other exclusions may exist in the Audit JSON; copy from there.
9. Tracking Sheets billing month runs from the last Friday to the last Thursday of the month (custom `CASE` on `best_date`).
10. Country is inferred from keyword lists on `loading_location` / `offloading_location` / `current_location` (for example Lubumbashi, Kolwezi, Kasumbalesa give DRC). Keep these lists in one shared constant.
11. Grafana macros (`$__timeFilter`, `$__timeGroup`, `$__interval`) must be translated into explicit parameters. Variable `'All'` is a sentinel in several queries (`'All' IN ($projects)`).
12. Active-truck status exclusions seen in chats (Delivered, Offloaded, Complete, Cancel, Archive, Arrived, Invoiced, OFFLOADING, FORECAST, Moved, Stack, Rail, RECEIVED) and location exclusions (Delivered%, Arrived%, Invoiced%, Complete%) repeat across panels and differ slightly between them. Copy per panel from the JSON; do not merge into one list without checking.
13. Parity lesson (ADARS): Grand Total must use the same window and the same normalised status in its DISTINCT key as Active Tracks, or the totals drift. [Chat Apr 2026]

## 4. Dashboards (8 exported files)

| Dashboard | Grafana ID | Tables | Notes |
|---|---|---|---|
| Worldrisk Tracking Sheets | 1 | worldrisk_tracking | Phase 2 target. Panels: Monthly, Daily, Weekly Total Trucks (bar), Number of Escorts (bar), Destination Heatmap (map), Active Tracks (bar gauge), Grand Total (stat, 60-day window), Grand Total of Dispatched (stat). Variables: projects, year, country. Refresh 1m. |
| Worldrisk Tracking Audit | 4 | worldrisk_tracking | Alerts Table (UNION ALL of triggers), Alerts Gauge, Missed Update, Forecast Tracker, Project Dispatch Activity. Variables: projects, year. Default range 30d, refresh 1m. |
| Worldrisk Devices | 3 | worldrisk_tracking | Device rotation and usage panels (total devices used, average rotation days, one-hit wonders). Read the JSON for panel list and status thresholds. |
| First Quantum Metrics | 1 (label) | worldrisk_tracking | Locked to `folder_name = 'FQM Tracking Sheets'`; variable: year only. Transporter normalisation: INARA, BRIDGE SHIPPING, AFRICLAN, BHL LOGISTICS, NYATI, CML, RELOAD; `08/0` excluded. |
| ADARS Tracking Sheets / Audit / Devices | n/a | adars_tracking | Use `client_group` (78 canonical groups, ZLT dual-membership for Bridge/ZLT names) and `client_name`; no `worldrisk_tracking` workspace exclusions; `best_date` simplified to `booking_date`; audit panels read `sheet_name = 'Control Tracking Sheet'`; the BBR Forecasts sheet is excluded from four panels. |
| Finance, Spend Overview | n/a | finance_* | Expense ledger currencies are mixed (BWP/USD/ZAR). Payment requests carry Total in ZAR / USD. Multi-value variables use `= ANY(string_to_array('${var:csv}', ','))`. Check the JSON before summing across currencies. |

Not among the exported files: the old "Tracking Table" dashboard imported in Apr 2026. Q5.

## 5. Verified dataset facts (query run by Jay, 2026-11-20)

Rows where the Grafana dropdown label differs from the raw `folder_name`:

| folder_name | Grafana label | Rows | Correct reading |
|---|---|---|---|
| FQM Tracking Sheets | Steinweg Bridge | 7,260 | FQM client rows; Bridge is the transporter (R2) |
| Glencore | Steinweg Bridge | 53 | Glencore client rows; Bridge is the transporter (R2) |
| Glencore | Moxico Mine- Zambia | 819 | Rows from the Moxico sheet inside the Glencore folder (Q3) |
| test sheets | Reload | 1,140 | Ignore (R1) |

So these rows are not mis-bucketed by folder: the folder is right and Grafana's label is wrong for them.

## 6. Known inconsistencies in the Grafana exports

Default = Grafana's definition until Jay rules (R6). Each is an open entry in docs/DECISIONS.md; record it in a `// DEVIATION:` or quirk-flag comment in code.

1. The Tracking Sheets `projects` dropdown shows mapped labels, but its panels filter `folder_name IN ($projects)` on the raw column. Selecting a label with no matching folder name (for example Moxico Mine- Zambia) returns nothing. "All" probably expands to the label list (the variable has `includeAll` and no `allValue`, so the `'All' IN ($projects)` bypass in some panels likely never fires). To be confirmed side by side at :3000. Note that not every panel filters on the raw column: Daily and Weekly filter on a client-derived `mapped_project_name`, Monthly and Dispatched on a Moxico CASE plus a "Cross border Archives" client branch.
2. `test sheets` is excluded in the Audit project list but not in the Tracking Sheets or Devices lists. R1 supersedes.
3. Audit Alerts Table: the `active_trucks` CTE lacks the `workspace_name != 'WorldRisk Contractors'` and `folder_name NOT ILIKE '%ZZZ Archive%'` filters that the gauges have, so table and gauge counts can differ.
4. Grand Total (Tracking Sheets) comments say "Last 90 Days" but the code uses `CURRENT_DATE - INTERVAL '60 day'`. Resolved by Jay: the code wins (R4).
5. `best_date` is not one rule, even inside Tracking Sheets (checked per panel in the JSON):
   - **Monthly (panel 1) and Grand Total of Dispatched (panel 9):** first non-null `COALESCE(intransit_began_date, drc_dispatch_date, zam_dispatch_date, nam_dispatch_date, tan_dispatch_date, zim_dispatch_date, bots_dispatch_date, moz_dispatch_date, sa_dispatch_date, dispatch_date, intransit_date, booking_date)`.
   - **Daily (panel 11) and Weekly (panel 12):** earliest-date two-tier: `COALESCE((SELECT min(d::date) FROM (VALUES (NULLIF(TRIM(col::text),'')), ...) AS dates(d) WHERE d IS NOT NULL AND d::text != '' AND d::date > '2010-01-01'), NULLIF(TRIM(booking_date::text),'')::date)` over the same 11 columns (no `booking_date` in the list; it is the fallback).
   - **Escorts, Active Tracks, Grand Total, Heatmap:** plain `booking_date`, no `best_date`.
   - Audit and Project Dispatch use `COALESCE(LEAST(NULLIF(TRIM(x::text),'')::date ...), booking_date)`, the earliest date.
   Consequence: Monthly, Weekly and Daily totals need not reconcile. Check every panel before assuming which one applies.
6. Devices: the gauge override names (for example "Active Devices (This Month)") do not match the query column names.
7. Date casts use `NULLIF(TRIM(x::text),'')::date`, which can throw on bad data. Keep the cast-safe form.
8. The Grafana datasource UID changed from `P2B13F441ACD56E0F` (old) to `bfilk2co86gaoc` (current).
9. The brief says "5 dashboards". There are 8 exported files (plus the old Tracking Table).

## 7. Portal state and decisions (this build)

- Stack: Turborepo + pnpm, Next.js 15, React 19, TypeScript, Tailwind v4, `postgres` client with raw SQL, `jose` JWT, `bcryptjs`. Charts: shadcn charts (Recharts); Tremor is dropped (`@tremor/react` 3.18.7 supports React 18 / Tailwind 3 only). Nivo and the map library come later for the heatmap.
- Repo: `/opt/omnimetrics-portal`, GitHub `Jays-Network/omnimetrics-portal` (private). Portal on port 3002; `start` binds 127.0.0.1; port 3001 is OmniOrchestrator and stays separate.
- DB roles: `jaysnet_admin` (owner, migrations only), `portal_app` (app tables only), `grafana_reader` (Grafana only; do not reuse), `portal_reader` (planned, read-only on tracking tables, migration 004 by hand).
- Auth: JWT carries identity only; role, `is_active` and `allowed_projects` are loaded from the DB (60s cache) on every protected call. `allowed_projects` is null only for admin.
- Scoping: [Proposed] apply `allowed_projects` to the raw `folder_name` as the first predicate, with the mapped label as display only. Not yet confirmed by Jay; depends on Q1 to Q3. Do not create client logins on FQM, Glencore, Bridge or Reload data until settled.
- Claude Code: reads of `.env*` are denied by its settings. UI UX Pro Max (`.claude/skills/ui-ux-pro-max`) is advisory only; Impeccable is not installed on the server (it downloads a native binary at runtime).
- First admin `Jay` exists in `app_users`. Phase 1 and 1.1 done and pushed; Phase 2 Steps 0 and 1 (docs, Vitest) done.

## 8. Working agreement with Jay

- Inspect real data before building. Jay has corrected this several times (Finance, Apr/Aug 2026, and again on 2026-11-20).
- Stepwise confirmation at each stage. Complete files, not diffs.
- Exact error diagnosis from the real output. Jay writes in a short, abbreviated style; read intent, don't ask for clarification on clear requests.
- Never print or paste secrets (JWT secrets, passwords, hashes, tokens). Redact output first.
- Reusable handover documents are valued; update `docs/PROGRESS.md` at the end of each phase.

## 9. Open questions (answer before SQL work resumes)

Resolved:
- **Q1.** Transporter is always the `transporter` column (R2). Bridge subcontractor ambiguity is deferred to the final data phase.
- **Q8.** Grand Total uses 60 days (R4).

Deferred by Jay to the final data-comparison phase. Working defaults until then, which are not rulings (changes go through R6 / docs/DECISIONS.md):
- **Q2.** Besides `FQM Tracking Sheets` and `Glencore`, is Bridge a transporter in any other folder? Default: no extra handling.
- **Q3.** Inside the Glencore folder, is `Moxico Mine- Zambia` a separate client with its own users? Default: scope by `folder_name` only and create no client logins yet.
- **Q4.** Phase 2 is the Tracking Sheets dashboard only.
- **Q5.** The old "Tracking Table" dashboard is not ported for now.
- **Q6/Q7.** Which dashboards clients get, and Finance admin-only. Default: every dashboard is admin-only until Jay decides.

## 10. Source index

Past chats in this project (claude.ai):
- Starting evidence work, 2026-05-13: portal decision and architecture brief. `/chat/b50344ab-851d-4600-bd2e-0ab5c18924bf`
- Preparation planning, 2026-05-25: ClickUp phases. `/chat/9cc7f59f-e376-43bc-9366-5176eb722a47`
- Exclude Glencore from duplicate entries, 2026-07-24: invoicing period, Glencore rule, gauge/table parity. `/chat/143d901d-eb0e-4ac1-ae6a-c690b70493ba`
- New database table and Grafana dashboard for financial data, 2026-08-26: finance pipeline. `/chat/461824b8-e768-4cb9-a7ca-ed04d61a73d8`
- ADARS dashboards Grafana integration, 2026-04-30: ADARS conversion. `/chat/9abf7546-953b-4b87-b2ab-562a3071b89f`
- SQL truck category exclusivity, 2026-04-23: exclusive bucketing, project trend. `/chat/be769110-d4bc-4fb6-baa2-d19fac7328c5`
- SQL query modifications for monitoring intervals, 2026-04-14. `/chat/3999d1ee-0e5b-41a1-b35f-23977ef6d73f`
- Optimizing Worldrisk boards, 2026-04-14. `/chat/eca610d9-41dd-4dbf-903b-6c1d9f740aeb`
- Dashboard filtering for FQM data only, 2026-04-09: FQM and transporters. `/chat/0b5db164-3910-460c-bb2a-eb320d4d55e4`
- PostgreSQL and Superset migration setup, 2026-04-09: LXC, imports. `/chat/9c5aa8bd-b033-49a7-b39e-2f7e74070a60`
- Migrating infrastructure to Linux and Proxmox, 2026-04-08. `/chat/9e75f83a-094d-44fc-ad93-102ffb17e4c1`
- Scripts and database information breakdown, 2026-07-28: script handover. `/chat/10adea3b-28ef-47d8-a28d-a1dd25fac7de`
- Script review and reactivation, 2026-04-20: Border Bot. `/chat/6e10ed77-859e-443f-a273-3003fec142fd`

Coverage note: compiled from chat summaries and search excerpts, not full transcripts. Not yet read: the ClickUp phase tasks (folder `901211364960`), which hold detailed per-phase rules; the Smartsheet-side column mappings in the sync scripts; and the Google doc "ADARS/WorldRisk Project Handover Breakdown", which describes the old Supabase-era setup and is stale.