# Decisions log (R6)

Grafana is a reference, not a target (R5). Any change that alters a number a client or Jay would see must be listed here and ruled by Jay (R6). Until ruled, the default is Grafana's definition. Nothing below is ruled.

Entry format: Grafana behaviour, proposed portal behaviour, effect on counts, status. "Effect on counts" is "not measured" until the side-by-side check at :3000 fills it in. Sources: `docs/PLAN_PHASE2.md` (section refs and open questions Q1 to Q9), `docs/CONTEXT.md`.

Panels: P1 Monthly, P2 Escorts, P3 Heatmap, P4 Active Tracks, P8 Grand Total, P9 Dispatched, P11 Daily, P12 Weekly.

---

## D1. Three different `best_date` rules
- **Status:** open (plan Q1)
- **Grafana behaviour:** Type A (first non-null `COALESCE(intransit_began_date, drc_dispatch_date, ..., sa_dispatch_date, dispatch_date, intransit_date, booking_date)`) in P1 and P9. Type B (earliest valid date of the 11 columns, cast-safe, `> '2010-01-01'`, falling back to `booking_date`) in P11 and P12. Type C (plain `booking_date`) in P8, P4, P2, P3.
- **Proposed portal behaviour:** none yet. Candidate: one shared `best_date` for all trip-count panels so the totals reconcile. Which rule is not proposed here.
- **Effect on counts:** Monthly, Weekly and Daily totals do not reconcile in Grafana today. Size of the gap not measured.
- **Default until ruled:** Grafana's definition per panel.

## D2. Daily and Weekly scope by `mapped_project_name`
- **Status:** open (plan Q2)
- **Grafana behaviour:** P11 and P12 filter on a mapped label (client from `raw_data`; Bridge gives "Steinweg Bridge"), not on raw `folder_name`. This is the CASE that R2 says is wrong for FQM and Glencore.
- **Proposed portal behaviour:** scope by raw `folder_name` (CLAUDE.md hard rule: folder first), keep their client exclusions.
- **Effect on counts:** differs wherever the client differs from the folder. Includes the FQM (7,260) and Glencore (53) Bridge-labelled rows. Not measured per panel.
- **Default until ruled:** Grafana's definition. Note this conflicts with the "folder_name first" hard rule and R2, so building it needs Jay's call before Step 3 code for P11/P12.

## D3. Moxico branch in Monthly and Dispatched
- **Status:** open (plan Q3, CONTEXT Q3)
- **Grafana behaviour:** P1 and P9 map the Glencore sheet "Moxico Mine- Zambia" to its own label, so it can be selected separately from Glencore.
- **Proposed portal behaviour:** scope by raw `folder_name` only. Selecting `Glencore` includes the Moxico rows, with no separate Moxico option.
- **Effect on counts:** Moxico rows 819. Glencore totals include them under the portal rule. A Moxico selection returns them in Grafana and nothing in the portal.
- **Default until ruled:** Grafana's definition.

## D4. Cross border Archives branch in Monthly and Dispatched
- **Status:** open (plan Q4)
- **Grafana behaviour:** P1 and P9 also include rows from `%Cross border Archives%` folders or sheets, matched by client-derived label.
- **Proposed portal behaviour:** drop the branch. Raw-folder scoping cannot express it and "folder_name first" would exclude those rows anyway.
- **Effect on counts:** rows in Cross border Archives folders disappear from P1 and P9 when a project is selected. Not measured.
- **Default until ruled:** Grafana's definition (keep the branch).

## D5. What "All" means
- **Status:** open (plan Q5, CONTEXT 6.1)
- **Grafana behaviour:** `$projects` has `includeAll` and no `allValue`, so `'All' IN ($projects)` is probably never true. "All" expands to the dropdown labels, which exclude `%Old%`, `%Archive%`, GDG, Suleman Roadway Logistics, Trafalgar, Workspace Root and WorldRisk Contractors. In panels that filter on raw `folder_name`, folders whose label differs are also dropped. To be confirmed at :3000.
- **Proposed portal behaviour:** "All" = the user's whole allowed set of raw folders, minus the dropdown exclusions and `test sheets` (R1). Never "no filter".
- **Effect on counts:** differs wherever a raw folder is hidden by a label mapping. Not measured.
- **Default until ruled:** Grafana's behaviour as confirmed at :3000.

## D6. Active Tracks 30 days vs Grand Total 60 days
- **Status:** open (plan Q9; R4 settles the Grand Total window only)
- **Grafana behaviour:** P8 uses `booking_date >= CURRENT_DATE - INTERVAL '60 day'` (R4). P4 uses 30 days. Both comments say 90.
- **Proposed portal behaviour:** none yet. Candidate: one window for both, so the Active Tracks bars add up to Grand Total (CONTEXT 3.13 parity lesson).
- **Effect on counts:** the sum of the Active Tracks bars is lower than Grand Total today. Size not measured.
- **Default until ruled:** Grafana's definition (60 days for P8, 30 days for P4).

## D7. Sheet exclusion lists differ between panels
- **Status:** open (plan Q9, CONTEXT 3.12)
- **Grafana behaviour:** each panel has its own list (matrix in PLAN_PHASE2 section 0). P4 adds `Convoy breaks` and lacks `SRL Tracking Sheet` compared with P8. P9 and P1 exclude exact `Reload invoicing Sheet`. P11 and P12 add `invoicing` and the client exclusions Aquarius / RELOAD ZLT. P3 excludes only `Invoice`. P2 has a shorter list.
- **Proposed portal behaviour:** none yet. Candidate: one shared list with per-panel additions only where justified.
- **Effect on counts:** P8 and P4 differ by the `Convoy breaks` and `SRL Tracking Sheet` rows. Not measured.
- **Default until ruled:** Grafana's definition, one named constant per panel.

## D8. `loading_location` used in the destination country block
- **Status:** open (plan Q8)
- **Grafana behaviour:** copy-paste slips in the destination country CASE. `%Mikas%` (DRC) and `%Palapye%` (Botswana) test `loading_location` instead of `offloading_location` in P1, P9, P11, P12 (P2 is correct). `%Weinert%` (South Africa) does the same in P11 and P12.
- **Proposed portal behaviour:** test `offloading_location` for all three keywords.
- **Effect on counts:** trips to Mikas, Palapye and Weinert are assigned to the wrong destination country, so country-filtered counts change. Not measured.
- **Default until ruled:** Grafana's definition via per-panel quirk flags.

## D9. Two country semantics
- **Status:** open (plan Q7)
- **Grafana behaviour:** P8 and P4 filter country on the `current_location` CASE. The other panels filter on `origin_country` / `dest_country` (route). The value `Other` appears in the CASE but cannot be selected in the dropdown.
- **Proposed portal behaviour:** none yet. Candidate: label the two meanings plainly in the UI, and make `Other` selectable.
- **Effect on counts:** the same country selection means "trucks now in X" in one panel and "trips to or from X" in another. Not measured.
- **Default until ruled:** Grafana's definition.

## D10. Default time range and timezone
- **Status:** open (plan Q6)
- **Grafana behaviour:** default range `now-6h` applied to a date column (`best_date` or `booking_date`), in browser time. P8, P4 and P3 ignore the range.
- **Proposed portal behaviour:** none yet. A 6-hour range on a date column is not meaningful, so a day-based default is likely, but the range and timezone are Jay's call.
- **Effect on counts:** every range-driven panel (P1, P2, P9, P11, P12) at first load.
- **Default until ruled:** Grafana's definition (`now-6h`, browser time), unless Jay names a range before Step 4.

## M5 access rules (stage 2a, 2026-11-26; portal content only, no tracking number changes)
Made while building the pg layer; Jay to confirm or overrule before the cut-over.
- Builders and viewers are **default deny** (PLAN_BUILDER 3.1): they see only what a grant covers, plus the folder names leading to it. The mock showed them everything, so after the cut-over they see nothing until grants exist.
- The **nearest** grant wins (node, folders upwards, organisation-wide), so a grant can narrow. A viewer never exceeds view. `manage` gives a builder nothing beyond `edit`: only org admins and the director change grants.
- Deleting a folder needs edit access on everything live inside it, so a narrowed item cannot be deleted through its parent.
- A suspended or archived organisation is closed to everyone, the director included (the mock still lets the director in).

## M5 stage 2b decisions (2026-11-26; accounts and portal content only, no tracking number changes)
Made while building; Jay to confirm or overrule before the cut-over.
- **S1.** A login created from the portal gets legacy `app_users.role = 'viewer'`, whatever its organisation role. The legacy column still means "global admin, unfiltered" to `loadUser` (and director to the mock); the organisation role lives only in the membership.
- **S2.** An org admin cannot reset the password of a login that also has a membership (active or not) in another organisation: they could sign in as it and enter that organisation. The director can. Answering this needs one yes/no read over the platform role.
- **S3.** Nobody resets their own password through the admin screen (it would skip the current-password check).
- **S4.** New passwords: 12 characters minimum as before, and at most 72 bytes (bcrypt ignores the rest; the login form also stops at 128 characters).
- **S5.** Username and email conflicts are checked case-insensitively, with one message for all cases, "already a member" included.
- **S6.** An organisation admin still sees their OWN organisation's profile (read over the tenant path); listing all, creating and updating are director only.
- **S7.** Platform actions on one organisation (create, update, link) are audited with that organisation's `org_id`, so its admins can see them; system settings and password changes have `org_id` NULL. User-scope settings are not audited.
- **S8.** Platform admins' memberships cannot be changed or reset through the portal by anyone.
- **S9.** `loadUser` no longer reads `app_user_projects`: non-admins get `allowed_projects = []`, the legacy admin keeps `null`. Nothing renders tracking data from it yet.
- **S10.** Until 009 is applied, login events are still written in the 001 shape (address inside `detail`), so no audit is lost.
- **S11.** The audit address comes from `X-Real-IP` only. The login rate limiter is unchanged (it still falls back to `X-Forwarded-For`).
