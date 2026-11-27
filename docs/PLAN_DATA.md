# Plan: real data through datasets, the query compiler and the SQL terminal (M5 stage 4)

Status: DRAFT for Jay, 2026-11-27. Design only. Nothing here is built.
Sources: CLAUDE.md, `docs/CONTEXT.md` (R1 to R7), `docs/DECISIONS.md`, `docs/PLAN_BUILDER.md`, `docs/PLAN_PHASE2.md`, migrations 004, 007, 010, 011, and the current code.
Grafana SQL: there is none under `docs/`. The eight dashboard exports are in `grafana-export/`; `docs/PLAN_PHASE2.md` describes the Tracking Sheets panels; the architecture brief section 9 maps SQL to API routes.

Words used here: **director** = platform admin. **Admin** = organisation admin. **Source** = the external database behind an integration. **Executor** = the one server module that runs data queries.

## 0. Things that are true today and shape this plan

| Fact | Consequence |
|---|---|
| `app_datasets.named_query` holds a KEY of a query in code. 007 says no SQL is stored anywhere, and its CHECK would refuse SQL text. | Named query text lives in the repository (section 3, Q1). |
| `app_datasets.key` allows no dot; the registry uses `worldrisk.monthly_total_trucks`. | That string is the `named_query` id. The dataset `key` is a separate value such as `wr_monthly_total_trucks`. |
| The builder field list is a mock (`lib/builder/fields.ts`), and `VariableSchema` checks against it. | Replaced by the server catalogue in 4b. A dropdown variable also needs to name its dataset. |
| Several ready-made panels have a different shape from Grafana (section 6.3). | Fixed in 4e. |
| `loadUser` gives non-admins `allowed_projects = []` (S9), and editing tracking scope is not built in pg. | Real data is admin and director only until 4f. |
| `PORTAL_DATA` is `mock` and production refuses `pg`. | Stage 4 is reviewed in development until the cut-over. |
| `getReadonlyDb()` / `DATABASE_URL_READONLY` is one fixed connection to one source. | Removed in 4d: data is read only through integrations. |
| The tracking tables have no index on `folder_name` or any date, and the portal may not add one. | Full scans against a 10 s timeout. Measure early (4d). |
| No column list for `adars_tracking` has been supplied. | No ADARS dataset is designed in detail (Q4). |

## 1. The dataset model

A **dataset** is: one integration + EITHER an allowlisted relation (table or view) OR a named query + a field list + a base filter reference.

| Part | Stored in | Meaning |
|---|---|---|
| `key`, `label` | `app_datasets` | Stable id used by panel specs; plain-language name. |
| `integration_id` | `app_datasets` | Which connection. Composite FK keeps it inside the organisation. |
| `relation` | `app_datasets` | `name` or `schema.name` (bare name = `public`). Must appear exactly in the integration's `relation_allowlist`, checked on save AND on every run. A schema name alone in the allowlist allows nothing in v1. |
| `named_query` | `app_datasets` | Id of a query in code. Exactly one of this and `relation` (007 CHECK). |
| `base_filter_ref` | `app_datasets` | Id of a base filter in code (section 4). Required: a dataset without a known one does not run. |
| `hidden_roles` | `app_datasets` | Roles that cannot see the dataset at all. |
| Fields | `app_dataset_fields` | `column_name`, `label`, `type` (text, number, boolean, date, timestamp, json), `aggregatable`, `position`, `hidden_roles`. A column not listed cannot be used. |

Rules for fields:
- A relation dataset's fields are columns of the relation. A named dataset's fields are the output columns of the query.
- `json` fields are never selectable, filterable or groupable by a user.
- Only `number` fields take sum and avg, and only when `aggregatable` is true.
- **Hidden means gone**: not in the catalogue sent to that role, and refused in every position (select, filter, group, measure, sort, variable options). The director is never hidden from.
- "Sync fields" reads `information_schema.columns` for the relation and proposes rows. New columns arrive NOT listed. A listed column that disappears or changes type makes the dataset report "the source has changed" instead of running.

Who may create or change datasets and fields in v1: **director only** (new capability `datasets.manage`). The relation and base filter together decide what a user can see, so this is a security setting. The database does not enforce it (010 grants `portal_app` full DML), so the app does, and a test covers every route.

In terms of datasets:
- **Panel** = chart type + one dataset key + the blocks (filters, group by, measure, sort, limit). Content and control panels have no dataset.
- **Dashboard variable** = a named value. A dropdown variable reads the distinct values of one field of one dataset, with the base filter applied. A panel uses it as `$name` in a filter value.
- **Filter** = (field of the panel's dataset, operator, value). It can only narrow what the base filter already allows. A control panel (folder, country, dates) is a filter the viewer sets at run time.

Existing saved specs that use mock field names will fail with "unknown field". They are mock content; no migration of them.

## 2. The compiler

`compile(catalogueEntry, spec, runtimeValues, scope) -> { text, values, shape }`. Pure function: no database, no environment. One `SELECT` per call.

### 2.1 What can come from where

| Part of the statement | Source |
|---|---|
| Filter values, `in` lists, range ends, row limit | **User, as parameters only** (`$n`) |
| Scope folder list | Server (user's allowed set), as a parameter |
| Column identifiers | The dataset's field list. The request only SELECTS one by exact match; the text written into SQL is the catalogue's copy. |
| Relation | The dataset row, re-checked against the integration allowlist |
| Operators, functions, grains, sort direction | Fixed tables in code; the request picks a key |
| Output names | Generated by the compiler (`g0`, `g1`, `v`, `c0`...). Labels never enter SQL. |

Nothing else of the request reaches the text. Chart options and titles are not passed to the compiler.

### 2.2 Validation and quoting
1. Zod re-validates the spec (`PanelSpecSchema`), strict.
2. Each field reference is looked up with a `Map` (never a plain object, so `__proto__` and `constructor` are just unknown). Not found, or hidden for the role: the same error.
3. Each catalogue identifier is checked again at compile time against `^[A-Za-z_][A-Za-z0-9_]{0,62}$` (schema and relation too), then written as `"name"` with `"` doubled. The catalogue is data, so it is not trusted on its own.
4. The finished text is checked in tests: one statement, every `$n` has a value, no value string appears in the text.

### 2.3 What exists

| Kind | Allowed |
|---|---|
| Aggregations | `count` (rows), `count_distinct`, `sum`, `avg`, `min`, `max`, with the type rules of `FN_FIELD` |
| Group by | at most 2 |
| Time buckets | `day`, `week` (ISO, Monday), `month` (calendar) on `date` fields; `hour` on `timestamp` fields only, and not enabled until the stored time zone is confirmed (Q6) |
| Filter operators | `eq`, `neq`, `in`, `between`, `contains`, per `OPS_FOR` |
| Sort | by a group field or by the measure (`value`), `asc` or `desc`, nulls last |
| Row mode (no measure, tables) | the visible fields in `position` order |

Definitions (these decide counts, so tests pin them):
- Conditions are joined with AND. The base filter comes first and cannot be reached by a filter.
- `contains` is a case-insensitive match; `%`, `_` and `\` in the value are escaped.
- `neq` keeps empty (NULL) rows (`IS DISTINCT FROM`). `eq` and `in` never match them.
- `between` includes both ends.
- Billing month, invoicing period, `best_date`, normalised registration and country are NOT generic. They exist only inside named queries. So a generic "count" is a row count, not a dispatch count, and the UI labels it "Rows".

### 2.4 Limits

| Limit | Value |
|---|---|
| Rows returned | spec `limit`, at most 1,000 (the query asks for one more, to detect truncation) |
| Groups | at most 1,000 result rows; at most 20 series from a second group by |
| Filters / `in` values | 20 / 50 (as the spec schema) |
| Dropdown variable options | 500 |
| Date range | at most 3,660 days (`MAX_RANGE_DAYS`) |
| `statement_timeout` / `lock_timeout` | 10 s / 2 s, set inside the transaction |
| Result size | 2 MB; text cells in row mode cut to 500 characters |

Truncation is always shown to the user. It is never silent, and no automatic "Other" bucket is invented.

### 2.5 The compiler refuses
- no scope (empty folder list, unknown base filter), or a dataset with no base filter;
- unknown or hidden field, wrong operator or function for the type, a second measure, more than two groups;
- a blocks request on a named dataset (named datasets accept only their declared parameters and filters);
- a time bucket on a non-time field, `hour` on a `date`;
- a `$variable` that does not exist or has no value where one is required;
- `json` fields anywhere; any join, expression, subquery or raw SQL (there is no way to express them).

A refusal is a typed error. It never falls back to a wider query.

### 2.6 What the browser may ask for
- **Viewers** do not send a spec. They send dashboard id, version, panel id, variable and control values; the server loads the saved spec after the grant check.
- **Builders and admins** in the editor may send a spec (needs `dashboards.edit`). It is compiled under their own scope and hidden fields.
- A saved panel runs under the VIEWER's scope and role, never the author's.

## 3. Named queries

For anything the compiler cannot express, including every Grafana-parity number.

**Where.** One file per query in `apps/web/lib/datasets/named/`, registered by id. `app_datasets.named_query` holds the id. An id with no file does not run.

**Who writes them.** Only the director, which in v1 means: a change in the repository that Jay reviews and approves. There is no screen that accepts SQL for a named query. (Storing director-typed SQL in the database would need a new migration and a new ruling, since R7 covers only the terminal: Q1.)

**Declaration.** Each file declares:
- `id` and `version`;
- the one source relation and the base filter it needs;
- parameters: name, type (`date`, `text`, `text[]`, `integer`), required, default, allowed values;
- output columns (these become the dataset's fields) and the result kind it feeds;
- the SQL text with named placeholders (`:from`, `:countries`). A binder turns them into `$n`. An undeclared or unused parameter is an error.

**How scoping and the relation allowlist apply.** The executor, not the query, writes the first CTE:

```sql
WITH base AS NOT MATERIALIZED (
  SELECT <listed columns> FROM "public"."worldrisk_tracking"
   WHERE folder_name = ANY($1) AND lower(btrim(folder_name)) <> 'test sheets'
), ... the named query's own CTEs, reading from base ...
```

The named SQL may read only `base` and its own CTEs. It cannot name a table, and it cannot define another CTE called `base`. The one real relation is therefore the executor's, taken from the dataset row and checked against the allowlist. `raw_data` may be a listed column that the query reads internally while no role may select it.

**A named query may NOT:**
- contain more than one statement, or anything but `SELECT` / `WITH ... SELECT`;
- use DDL, data change (also inside a CTE), `SELECT INTO`, `FOR UPDATE`/`FOR SHARE`, `SET`, `COPY`, `EXPLAIN`;
- name a physical relation or a system catalogue;
- call a function outside the allowlist. Starting list (from what the Grafana SQL uses): `coalesce nullif trim btrim upper lower replace concat concat_ws count sum avg min max round least greatest date_trunc to_char extract lag row_number string_to_array`. Adding one is part of review.
- build SQL from values (no string building; placeholders only).

It always runs in a read-only transaction that is rolled back.

**Review and test before one goes live:**
1. Verifier test: a real PostgreSQL parser checks the rules above for every registered query (new dependency, Q8). Without the parser, a human checklist does this and the terminal is not built.
2. Binding test: injection strings stay in `values`.
3. Scope test: the base CTE is first; `test sheets` fixture rows never appear.
4. Golden test on synthetic rows (section 9).
5. Side-by-side with Grafana by Jay; every difference explained; number changes entered in DECISIONS.md.
6. Jay approves; only then is the dataset row created. Any later change to the SQL bumps `version` and repeats 1 to 5.

## 4. Scoping and business rules, in one place

The executor applies the base filter. Panels, specs, variables and named SQL cannot add, remove or replace it. Base filters live in `lib/datasets/base-filters.ts`, one per `base_filter_ref`.

| `base_filter_ref` | Scope column | Fixed conditions | Status |
|---|---|---|---|
| `worldrisk.v1` | `folder_name` | R1 | 4d |
| `worldrisk.fqm.v1` | `folder_name` | R1, `folder_name = 'FQM Tracking Sheets'` AND within the user's set | later |
| `adars.v1` | `client_group` (to confirm) | unknown | blocked (Q4) |
| `admin_only.v1` | none | none | for non-tracking relations: admins and director only |

### 4.1 Scope on raw `folder_name`
- Admin and director: the explicit list of folders found in that source, minus R1. Others: their `app_user_projects` rows for THIS organisation, minus R1.
- `resolveFilters` (already built and tested) does the resolution. The executor builds its input from `OrgCtx`, not from the legacy `app_users.role`.
- A requested folder outside the set fails the whole request. An empty set is an error. There is never a query without the folder predicate, admins included.
- The folder list is cached for at most 60 s per integration.
- **What "All" means is not decided here** (D5 is open). Named Tracking Sheets datasets follow D5's default; generic datasets use the whole allowed set minus R1, entered as D11 for ruling.
- **No such column:** the dataset must use `admin_only.v1`. A tracking base filter on a relation without `folder_name` refuses to run.
- Tests: SQL text starts with the predicate; viewer with folder A gets no B rows; foreign folder is refused without echoing it; empty grant gives no query at all (the fake driver records zero calls).

### 4.2 R1, test sheets
- Applied twice: removed from the folder list (`resolveFilters`), and as a SQL condition in the base filter (trimmed, case-insensitive).
- Also applies to variable option lists and the folder dropdown.
- **No `folder_name` column:** a tracking dataset does not run. Whether `adars_tracking` needs an R1 equivalent is unknown (Q4).
- Tests: fixture folders `test sheets`, `Test Sheets ` and `TEST SHEETS` are absent from every dataset, option list and count, for admin and director too.
- The SQL terminal is the ruled exception (R7): unfiltered and labelled so.

### 4.3 R2, transporter
- The only field that may be called transporter is the `transporter` column. Nothing derives it from `folder_name`, `sheet_name` or `client_name`.
- A named query may normalise the VALUES of that column (the FQM list in Grafana does).
- Generic datasets expose no client field: `worldrisk_tracking` has no client column. A derived client belongs to a named query, and in `FQM Tracking Sheets` and `Glencore` it must never yield "Steinweg Bridge". The Grafana `CASE` is not ported. Where a Grafana panel scopes by that CASE (D2), the panel waits for Jay (Q5).
- **No `transporter` column:** the dataset has no transporter field. No substitute.
- Tests: catalogue check (a field labelled transporter must map to `transporter`); fixture rows with "Bridge" in folder and sheet names but another transporter are counted under that transporter; no client output equals "Steinweg Bridge" for the two folders.
- CONTEXT R2 says the working default for Bridge subcontractors is "listed in docs/DECISIONS.md". It is not listed there today. Only D2 touches it.

### 4.4 R4, 60 days
- R4 belongs to ONE number: Grand Total on Tracking Sheets. It is written inside that named query (`booking_date >= CURRENT_DATE - INTERVAL '60 day'`).
- It is NOT a base filter. Other panels keep their own windows (Active Tracks is 30 days, D6).
- The dashboard time picker does not change it.
- **No `booking_date`:** the query cannot be registered against that relation.
- Test: fixture rows dated today minus 60 and minus 61 days; the first counts, the second does not, with the session zone set to Africa/Johannesburg.

### 4.5 Hidden fields (`hidden_roles`)
- Applied when the catalogue is built for a request, so the compiler never sees a hidden field.
- Named dataset: if any output column is hidden for the role, the dataset is refused for that role. No partial results in v1.
- Tests: for each position (select, filter, group, measure, sort, variable) a hidden field and a non-existent field give the identical error.

### 4.6 Exclusions that are not rules
`workspace_name <> 'WorldRisk Contractors'`, `%ZZZ Archive%`, sheet and status lists differ between Grafana panels (D7, PLAN_PHASE2 section 0). Named queries copy each panel's own list. PLAN_BUILDER 4.1 puts the workspace and archive exclusions in the base filter; for generic datasets that changes counts, so it is D11, not decided (Q2).

## 5. The executor

`runDataset(ctx, request)` in `lib/datasets/executor.ts`, server only. The only code that opens a connection for dataset data.

**Order of work:** check `OrgCtx` and grant -> load dataset, fields, integration through `withOrg` (RLS) -> resolve scope -> compile -> cache lookup -> get pool -> run -> shape the result. The app-database transaction is closed before the source is contacted.

Builders and viewers get `not_found` from the integration repository (I9). The executor reads the integration row itself, returns none of it, and only after the dataset check has passed.

**Using an integration** (same code as the connection test, shared, not copied):
- row must be `active`, kind postgres, and its host and port still on the allowlist;
- stored rows: `decrypt` with the organisation and row binding, `resolveTarget`, connect to the checked address;
- managed rows (`env:`): `envCredential`; host, port, database and TLS from the row (I6);
- TLS exactly as `ssl_mode` (`tlsFor`); no fallback to plaintext.

**Pools.** One small pool per integration, keyed by integration id + `updated_at` + `rotated_at`, so an edit or rotation makes a new pool and closes the old one. Maximum 3 connections, idle close 30 s, maximum lifetime 10 min (which also re-checks the address). At most 20 pools; least recently used is closed.

**Concurrency.** 3 running per integration, 6 per user, 8 per organisation. A short queue (20) with a 5 s wait; then "busy". A dashboard loads its panels through the same queue.

**Every run:**
```
BEGIN READ ONLY
SET LOCAL statement_timeout = '10s'; lock_timeout = '2s'; idle_in_transaction_session_timeout = '15s'
the one compiled statement, read in batches while counting bytes
ROLLBACK
```
Plus an overall 15 s deadline for a server that stops answering. For stored integrations the portal does not control the role, so on first connect it refuses a superuser.

**Cancellation.** If the request is aborted or the deadline passes, the query is cancelled and the connection returned. `statement_timeout` is the backstop.

**Caching.** In memory, per process.

| | |
|---|---|
| Cached | Shaped results of dataset queries; folder lists; variable options |
| Never cached | Errors, SQL terminal results, credentials in readable form outside the pool |
| Lifetime | results 30 s (the minimum refresh), folder and option lists 60 s |
| Key | organisation id, role, platform flag, resolved folder set (sorted), hidden-field set, dataset id + `updated_at`, named query version, integration id + `updated_at`, compiled text, values |
| Never shared | across organisations or roles. Two users share an entry only if every key part is equal. |
| Size | 200 entries or 50 MB, oldest first |

Access and scope are checked BEFORE the cache lookup. Every result shows "as of" time.

**Errors shown to users.** Only these. Driver text is never shown or logged; the log gets the code, dataset id and a reference number that the user also sees.

| Code | Message |
|---|---|
| `not_found` | Not found. (no access, other organisation, unknown id) |
| `invalid_query` | This panel's settings are not valid for its data. |
| `source_changed` | The data source has changed. Ask an administrator. |
| `not_configured` | This data source is not set up. |
| `unavailable` | The data source cannot be reached. |
| `timeout` | The query took too long. Narrow the filters or the date range. |
| `too_large` | The result is too large. Narrow the filters. |
| `busy` | Too many queries at once. Try again in a moment. |
| `failed` | The query failed. Reference: N. |

A bad date in the source (CONTEXT 6.7) shows as `failed`; named queries keep the cast-safe form.

## 6. Mapping results to PanelData

### 6.1 Generic datasets

| `PanelData` kind | Needs | Panel types |
|---|---|---|
| `value` | measure, no group | stat, gauge, progress ring |
| `value` with `spark` | measure + one time group | stat with sparkline (headline = a separate ungrouped query, because distinct counts do not add up) |
| `named` | measure + one group | pie, donut, bar gauge, top N, treemap, funnel |
| `series` | measure + one group, optional second group as series | bar (3 forms), line, area (2), radar, combo, histogram (needs a number bucket: not in v1) |
| `table` | row mode, or groups + measure | table |
| `matrix` | measure + two groups | heatmap (hour by day needs a timestamp: blocked by Q6) |
| `calendar` | measure + one `day` group | calendar heatmap |
| `flow` | measure + two groups | sankey |
| `control` | distinct values of one field | dropdown controls and variables |

Named datasets only (the blocks cannot express them): `xy` (two measures), `list`, `timeline`, `statusHistory`, `map`.
No dataset at all: `text`, `links`, `image`, `divider`.

### 6.2 How the registry declares needs
Add to `PanelType` one field, for example `accepts: { kind: 'series', groups: [1, 2], measure: 'required', timeGroup: 'optional' }`. The builder uses it to grey out invalid combinations; the compiler enforces the same object. `mock` stays for preview of unconnected panels.

Rules for shaping:
- Series keys and row keys are generated (`s0`, `s1`). Values from the data are only ever labels. A value called `__proto__` or `x` cannot collide.
- Numbers: counts arrive as text from the driver; convert, and refuse to round silently above the safe integer limit.
- Empty values show as "(empty)". Dates are plain `YYYY-MM-DD`, not converted between time zones.
- `PanelData` has no place for "truncated" or "as of". The response is `{ data, meta: { truncated, asOf, reference } }`.

### 6.3 Ready-made panels that do not match Grafana

| Registry entry | Shape today | Grafana (PLAN_PHASE2) |
|---|---|---|
| Heatmap | hour-by-day matrix | map of destinations (deferred) |
| Active Tracks | one stat | bar per status |
| Dispatched | stacked bar | one stat |
| Escorts | stat with sparkline | monthly bar |
| Weekly | area | bar |
| Daily | line | bar |

4e gives each panel it builds Grafana's shape. Changing a chart type is presentation (R6 allows it); changing what is counted is not. Heatmap stays mock and is labelled so.

## 7. The SQL terminal (R7, director only)

**What it can run:** exactly what R7 says. One parser-verified `SELECT` / `WITH ... SELECT` / `VALUES`, read-only, always rolled back, against ONE integration of the ACTIVE organisation, reading only relations on that integration's **relation allowlist**. Not the whole database. Widening that needs a new ruling.

| Limit | Value |
|---|---|
| Statement length | 4,096 bytes, so the audit holds the whole statement |
| Rows / result size | 1,000 / 2 MB, text cells cut |
| `statement_timeout` / `lock_timeout` | 10 s / 2 s |
| Concurrency | 1 per user; 10 runs per minute |

**How it differs from the compiler:**

| | Compiler | Terminal |
|---|---|---|
| Who | any role, own scope | director only |
| Text from the browser | none | the statement |
| Folder scope, R1, hidden fields | always | **none** (labelled "unfiltered, includes test sheets") |
| Cache | yes | no |
| Saved into a panel | yes (as a spec) | never |

**Checks before running:** parser verdict (as PLAN_BUILDER section 6: one `SelectStmt`, no `INTO`, no locking, no data-changing CTE, function allowlist, every relation qualified and allowlisted, empty `search_path`); director with TOTP enabled; integration active and allowed; role not superuser. The mock's string checks (`terminal.ts`) are NOT reused as security.

**Audit.** Written BEFORE execution; if the audit write fails, nothing runs. A second row records the outcome.
- YES: user, organisation, integration, full statement text, its SHA-256, verdict and reason, row count, duration.
- NO: result values, column values, driver messages.
- The text must be stored unaltered, so the redaction helper must not rewrite it. Statement text can contain client values typed by the director, and 010 lets that organisation's admins read its audit rows (Q9).

**Errors:** the director sees the parser's reason and, for database errors, the PostgreSQL message and position for their own statement. This is the one exception to the vocabulary in section 5, and the message is not stored.

**Abuse cases:** second statement after `;` or hidden in a comment; `pg_sleep`, `generate_series` explosions, cross joins; `pg_read_file`, `dblink`, `lo_*`, `set_config`, `pg_terminate_backend`; `SET ROLE` / `BEGIN READ WRITE`; reading `pg_catalog`, `information_schema` or a non-allowlisted table through a view or subquery; a stolen director session (TOTP); pointing at another organisation's integration id. A view on the allowlist can expose whatever the view reads: allowlisting a view means trusting it.

## 8. Security review

| # | Attack | Control | Test that closes it |
|---|---|---|---|
| A1 | Identifier injection: field `a"; DROP`, `__proto__`, relation with quotes | lookup by exact match, regex, quoting | fuzz every identifier position; compiler refuses; text never contains the input |
| A2 | Value injection | parameters only | injection strings appear only in `values`; run them against `portal_test` and the table is unchanged |
| A3 | Second-order: hostile dataset label, field label, `column_name` or relation already in the catalogue | labels never in SQL; identifiers re-validated at compile; relation re-checked | insert hostile rows directly into `portal_test`; run; refused, and labels render as text |
| A4 | Hostile data values (series names, markdown, `__proto__`) | generated keys; React escaping | shaping test with hostile fixture values |
| A5 | Resource exhaustion: huge range, many groups, many panels, giant cells | limits, queue, timeouts, byte count | each limit has a test that hits it; a slow query is cancelled and the connection reused |
| A6 | Cross-organisation: another org's dataset, integration, dashboard id | `OrgCtx`, RLS, composite FKs | extend the isolation matrix to every new route: 404 and zero bytes |
| A7 | Cross-organisation or cross-role cache leak | key in section 5 | two orgs, two roles, two folder sets, same spec: no hit; membership or scope change takes effect at once |
| A8 | Reading a hidden field by filter, sort, group, `min`/`max`, `count_distinct`, variable options or error difference | field removed before compiling | section 4.5 tests for every position |
| A9 | Widening scope: folder in a filter, `neq` trick, variable "All" | base filter ANDed first; filters only narrow | `folder_name neq X` and "All" never return rows outside the set |
| A10 | Viewer sends a hand-made spec or another dashboard's panel | viewers send ids only; grant check | route tests |
| A11 | R2 confusion: a transporter counted as a client | section 4.3 | catalogue and fixture tests |
| A12 | Integration repointed (allowlist or host edited) to read something else | allowlist and relation checked per run; pool keyed on `updated_at`; target guard | edit then run: refused or new pool |
| A13 | Credential or host leaked through errors or logs | error vocabulary; codes only | force driver errors and scan responses and logs |
| A14 | Admin creates a dataset with a weaker base filter | director only; `admin_only.v1` refused for others | route and role tests |
| A15 | Terminal escape (section 7 list) | parser, read-only role, rollback | a rejection table with one row per case, plus a run proving writes fail even if the parser is bypassed |

Not covered, and said plainly: the app is the only layer between organisation members and folders. The database role per organisation separates WorldRisk from ADARS, not one folder from another.

## 9. Verification against Grafana (R5, R6)

**Side by side (real data, run by Jay).**
1. For each panel, fix the inputs: folders, country, from/to, and the Grafana browser time zone.
2. Jay reads the Grafana numbers at :3000 and runs a portal script (`scripts/parity`, calls the executor, prints aggregates only) within the same sync window. `CURRENT_DATE` panels are compared on the same day.
3. Results go into `docs/PARITY_PHASE2.md`: panel, inputs, Grafana, portal, difference, explanation. Counts only; no row-level client data in the repository.
4. Every difference is explained. An unexplained one blocks the panel.
5. A difference that comes from a portal choice goes into DECISIONS.md with Grafana behaviour, proposed behaviour, effect on counts, and **waits for Jay**. Until ruled, the code does what Grafana does, except where R1 or R2 already rules. Where Grafana's way cannot be built inside folder scoping (D2, D3, D4), the panel is not built until Jay rules (Q5).
6. Compare more than totals: per month, per folder and per status, so two errors cannot cancel out.

**Golden tests (no client data).**
- A synthetic `worldrisk_tracking` table in `portal_test`, built from the columns in CONTEXT section 2, with made-up folders, registrations and places that exercise each edge: R1 spellings, Bridge in names, 60 and 61 days, month-end Thursday and Friday, year rollover, blank and `TBA` registrations, empty date columns, each excluded sheet name, the D8 keywords.
- Expected numbers are written by hand with a one-line reason each.
- Second check: run the SQL from `grafana-export/` (macros replaced by test values) and the portal query on the same synthetic rows. Differences must match exactly the list in DECISIONS.md; anything else fails the test.
- The keyword, sheet and status lists are compared with the JSON exports (PLAN_PHASE2 Step 3).

## 10. Stages

Each stage stops for Jay's "approved". Real data sits behind a new setting `PORTAL_QUERIES` (default off): off means panels show mock data, which is the common rollback.

| Stage | Scope | Tests | Jay sees | NOT included | Rollback |
|---|---|---|---|---|---|
| **4b** Datasets and catalogue | datasets repository (mock and pg), `datasets.manage`, field sync, catalogue per role replaces mock fields, variable names its dataset | contract mock/pg, isolation matrix, hidden fields in catalogue | director screen listing datasets and fields; builder shows real field labels | any query of source data except column names | revert; delete dataset rows |
| **4c** Compiler | `compile()`, base filters, panel `accepts`, shaping | A1 to A4, A8, A9, R1, scope; all pure | test output and a "show SQL" line for the director in development (text and parameter count, no run) | connections, UI data | revert; nothing runs it |
| **4d** Executor, first dataset | pools, limits, cache, errors; one generic WorldRisk dataset; admin and director only; `getReadonlyDb` removed | synthetic table in `portal_test`; A5 to A7, A10, A12, A13 | a table and a stat of real rows; timings for the 10 s limit | named queries, Grafana parity, ADARS, builders and viewers | `PORTAL_QUERIES` off |
| **4e** Tracking Sheets | named query mechanism; Grand Total, then Active Tracks, then Escorts, one at a time; Monthly, Dispatched, Daily, Weekly only after Q5 | section 3 steps, golden tests, parity table | the built panels on real data (the rest stay mock), with the parity table | Heatmap map, Audit, Devices, FQM, ADARS; Monthly, Dispatched, Daily, Weekly until Q5 is answered | disable one dataset, or flag off |
| **4f** Non-admin scope | tracking-scope editing in pg, builders and viewers get data | scope and cache tests with real memberships | a test viewer sees only their folders | client logins (needs TOTP, CONTEXT Q3/Q6/Q7) | restrict executor to admins again |
| **4g** SQL terminal | parser, run, audit | section 7 abuse table, A15 | director runs a statement | saving results, other roles | remove `terminal.run` at the route |

Order notes: 4d needs the cut-over (or at least `portal_test` plus a development `omnimetrics_portal`), 004 applied, reader passwords, and the two `DATABASE_URL_READONLY_*` values set by Jay. 4g also needs the TOTP stage, which is not part of this plan. Claude cannot read `.env*` and cannot log in to Grafana, so Jay runs every check against real data.

## 11. Open questions for Jay

Anything that would change a number is only proposed here and in DECISIONS.md (D11, D12). Nothing is decided.

| # | Question | My default | If you answer differently | Blocks |
|---|---|---|---|---|
| Q1 | Should named queries be files in the repository that you approve, with only you able to create datasets? | Yes, both. | Typing SQL into a screen needs a new migration, a new R7-style ruling and much more security work. Letting org admins create datasets needs rules for which base filters they may pick. | 4b |
| Q2 | Should a plain (generic) WorldRisk dataset also leave out the `WorldRisk Contractors` workspace and `ZZZ Archive` folders, and what should "All" include there? (D11) | Leave out only `test sheets`; "All" is every allowed folder. | Excluding them makes generic counts lower and closer to most Grafana panels. | 4d |
| Q3 | Which columns should viewers and builders not see? | `raw_data` selectable by nobody; escort names, device numbers and coordinates hidden from viewers; internal ids hidden from viewers and builders. | The field list changes; no code change. | 4b |
| Q4 | For ADARS: can you give the `adars_tracking` column list, say whether `client_group` is a stored column or worked out from `client_name`, whether users are limited by client group, and whether anything there is like `test sheets`? | No ADARS datasets until answered. (CONTEXT says it is a column; the Grafana SQL works groups out with a CASE.) | Defines the ADARS base filter. | ADARS only |
| Q5 | Monthly, Dispatched, Daily and Weekly in Grafana choose projects by worked-out labels (Moxico, Cross border Archives, a client name that calls FQM and Glencore Bridge rows "Steinweg Bridge"). Choosing by folder only is required by "folder first" and R2 but changes their counts. May the portal choose these four by folder? (D2, D3, D4) | I build none of the four until you rule. Grand Total, Active Tracks and Escorts follow Grafana as D1 and D5 to D10 say, including the `now-6h` default range for Escorts (D10). | If yes, build them by folder and record each count difference. If you want the labels kept, the scoping rule needs your exception first. | 4e (those four panels) |
| Q6 | In which time zone do the sync scripts write `row_modified_at`, and when a time range is applied to a date-only column, should it count whole days? (D12) | Zone unconfirmed, so no hour buckets and no hours-since-update numbers; ranges on date columns behave as Grafana does. | Enables hour charts and Audit datasets; whole-day ranges change counts. | Audit datasets; can wait |
| Q7 | Is it right that only organisation admins and you see real data until stage 4f, with no client logins before two-factor sign-in? | Yes. | Earlier access for others moves 4f before 4e. | Can wait |
| Q8 | May I add a PostgreSQL parser library (libpg-query or pgsql-parser, WASM)? | Yes, when 4e starts. | Without it, named queries are checked by eye only and the terminal is not built. | 4g (and the automatic check in 4e) |
| Q9 | The audit will hold the full text of your terminal statements, and that organisation's admins can read its audit. Is that all right? | Yes. | Hiding it needs a policy change in a new migration. | 4g |
| Q10 | If a panel cannot finish in 10 seconds on the real tables, may the limit be raised for that one dataset, or will you add indexes on the source yourself? | Keep 10 s, rely on the 30 s cache, show "took too long", and report the timings from 4d to you. The portal creates nothing in the source. | A higher limit is a setting per dataset; indexes are your change to `jaysnet_data`. | Can wait until 4d timings |

### Unconfirmed, not asked above
- The reader roles' time zone set by 004 (Africa/Johannesburg) is an assumption its own header asks Jay to confirm.
- `status`, `workspace_name` and date column behaviour on real data (bad values, NULLs) is unmeasured.
- Whether a result cache of 30 s is acceptable freshness for an operations screen refreshing every 60 s: assumed yes.
- All limits in sections 2, 5 and 7 that are not already in code or rulings are proposals to be tuned from 4d timings.
