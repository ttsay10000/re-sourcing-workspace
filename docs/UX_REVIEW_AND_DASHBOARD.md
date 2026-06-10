# UX Review: Sourcing OS — page-by-page walkthrough, dashboard proposal, comps plan

*Reviewed 2026-06-10. Method: full code walkthrough of every page (`apps/web/src/app/*`), the API surface behind each button, and two structured audits of the five largest pages. Framed around how a real-estate sourcing analyst actually works the tool day to day.*

---

## 1. How an analyst uses this app (the lens for everything below)

A sourcing analyst's day has four repeating motions:

1. **Triage** — "what came in overnight?" (saved-search runs, broker replies, OMs in email). Needs: newest-first, one glance per item, fast accept/reject.
2. **Work the queue** — move deals through stages, request OMs, chase brokers. Needs: persistent filters ("my underwriting queue"), bulk actions with trustworthy feedback, aging visibility.
3. **Underwrite & compare** — read an OM tear sheet, sanity-check yield against the market, pull comps side-by-side with the subject. Needs: numbers aligned and scannable, subject-vs-comps in one view, cap rate *and* $/PSF everywhere.
4. **Report up** — "what did we source this week, what converted, where are we strong?" Needs: a metrics dashboard (today this lives in nobody's head — see §4).

The app is already strong on data plumbing (enrichment, OM extraction, dossiers). The friction is almost all in **scanning speed, feedback during long operations, and cross-page consistency**.

---

## 2. Page-by-page review

### 2.1 Home (`/`)
**What works:** The funnel stage strip, attention groups (missing enrichment, needs OM…), and saved-deal flow are the right idea — it's a work-queue, and the badges (Comps/OM/UW) per row are genuinely useful.

**Friction & recommendations:**
- The page answers "what needs my touch?" but not "how are we doing?". Numbers shown are *counts right now*; there is no trend, conversion, or velocity anywhere in the app. → Add the **Metrics dashboard** (§4) as a sibling view, keep Home as the action queue.
- Attention groups collapse to labels + counts; the analyst still has to click into each. Show the top 2–3 rows inline per group (address + the one number that matters) so the first action is one click, not two.
- The terminal counter (Closed/Rejected segmented toggle) is bottom-weighted; move win/loss summary into the dashboard where it can carry trend context.

### 2.2 Pipeline (`/pipeline`) — the main workspace
**What works:** Spreadsheet-like table with 18+ sortable columns, row → side detail sheet with 6 tabs, bulk actions, and (hidden) j/k keyboard nav. This is the right backbone.

**Friction & recommendations (top items from the audit):**
- **No saved views / URL-persisted filters** (`PipelineClient.tsx:1317-1323`). The analyst rebuilds "status=saved + hasOM + LTR>5%" every morning. → Persist filters to the URL, then add 3–4 named presets ("Morning triage", "Underwriting queue", "Awaiting broker").
- **Feedback is a transient inline notice** (`setNotice`, ~40 call sites). Bulk OM refresh over 10 properties runs minutes; the only signal is a text line that vanishes on navigation, and selections clear after the action so you can't verify what happened. → Fixed by the new **global process banner** (§5): persistent across navigation, shows progress, dismissible.
- **Six lazy-loaded detail tabs make the financial story slow to reach.** Yield, OM status, comps, and dossier live on three different tabs. → Promote a one-line "deal strip" to the sheet header: price · units · $/PSF · LTR/MTR · score · stage — always visible regardless of tab.
- **Row "More" menu renders at cursor position and can clip off-screen** (`:2268`). Clamp to viewport.
- Make the keyboard shortcuts discoverable (a small `?` legend chip in the table header). They exist and are good; nobody knows.
- Sort dropdown has 16 options; analysts use ~4. Put Score / Updated / Price / LTR as one-click chips, keep the rest in the dropdown.

### 2.3 Yield Map → now `Pipeline ▸ Yield Map` (implemented in this change)
**What worked already:** MapLibre canvas, yield-band coloring, stage coloring, borough summary, full deal table. A second agent has been extending this page in parallel (neighborhood delineations, area medians, cap-rate trends) — the changes below were built on top of that work.

**Changes implemented now (your requests):**
- **Yield Map is a subpage of Pipeline** in the nav (`Pipeline ▸ Pipeline / Yield Map / Comp Analysis`), with `/yield-map` redirecting to `/pipeline/yield-map`.
- **Metric toggle: Cap rate % ↔ $/PSF.** Pins recolor by the chosen metric with a $/PSF band legend, and the borough summary table recomputes (median + range of $/PSF). The "All yield-bearing deals" table is unchanged apart from highlighting the active metric column — it already showed both.
- **"Show comps" checkbox** (both metric modes): plots promoted/accepted broker-package comps as **diamond pins** so they're distinguishable at a glance, and **interleaves comps into the deal table sorted by the active metric**, with a violet left-border + "Comp" chip + violet address text — side-by-side but unmistakable.
- **Hover linking:** hovering a row (deal or comp) enlarges + ring-highlights its map pin; hovering any pin shows a tooltip with **both cap rate and $/PSF** (plus NOI/units/stage for deals, source package for comps).
- Comps are geocoded via NYC Geoclient with a persistent cache (`comp_address_geocodes`), backfilling lazily on each load; comps that can't geocode still appear in the table.

**Still recommended (not built):** marker clustering once pin count passes ~150; a drawn-radius filter ("comps within 0.5 mi of subject"); quartile-based PSF bands once enough data accumulates (bands are fixed thresholds today).

### 2.4 Comp Analysis (`/pipeline/comp-analysis`) — new page (implemented)
The aggregation layer comps never had: every extracted/promoted comp across all packages in one filterable table — address, type, **cap rate**, **$/PSF**, price, $/unit, units, NOI, year, subject property, source package and date. KPI strip: comp count, median cap rate, median $/PSF, **% with cap rate**. Comps that are **$/PSF-only are flagged** with an amber "no cap rate" chip, and the page calls out how many comps lack cap rates so you know to push brokers for investment-sale comps. Each row links back to its subject property's Market/Comps tab and into the yield map.

### 2.5 Import (`/add-property`)
**What works:** Mode cards grouped into Quick capture / Document intake / Market sourcing; capability health row; per-import activity rail on the right.

**Friction & recommendations:**
- **Comp packages had no intake path here** — they could only be uploaded from deep inside a property's detail sheet (Pipeline → row → Market/Comps tab), which nobody finds. → **Implemented: a "Comp package upload" card** under Document intake, mirroring the OM upload pattern: drop the PDF, the comp reader extracts comps + financials, the subject address auto-matches to a canonical property ("link to canonical records when matched"); if no confident match you pick from candidates inline. The result panel shows what was extracted (and flags PSF-only packages) with links to review.
- The OM upload card is a hand-off to `/deal-analysis` rather than an inline flow — inconsistent with the other cards; consider inlining a dropzone the same way the comp card now does.
- StreetEasy multi-URL import runs serially with one notice per URL; the activity rail is good, but it's page-local — wired into the global banner now so navigation doesn't orphan it.

### 2.6 Progress board (`/progress`)
- 11 fixed columns vs ~5 visible on a laptop; no sticky context or scroll affordance (`progress/page.tsx:249`). → Collapse terminal columns by default, add column pinning, or a "focused" mode showing ±1 stage around the busiest column.
- No aging signal on cards even though `stageEnteredAt` exists. → Add the existing `AgingChip` to cards >14 days in stage; this is the single highest-leverage board improvement.
- Drag-drop failure is silent (validation modal abandons the move with no undo cue). → Snap-back animation + toast via the new banner system.
- Bulk feedback was a transient notice — now covered by the global banner.

### 2.7 Broker CRM (`/crm`), OM review queue (`/om-review`), Find OMs in Email (`/broker-om/email-search`)
- **Email pull hang fixed at the source** (§5): the search made up to 50 serial Gmail calls with no timeouts — one stuck socket froze the page forever. Now every Gmail call has a 30s timeout, the scan has a run budget and returns partial results with a "truncated" note, and the global banner shows progress and can be dismissed.
- CRM: outreach needs a missing-email broker fixed via a different panel (3 context switches, `crm/page.tsx:949-1103`) → allow inline email capture in the composer. Response statuses are six text-only values → add color dots so the list scans.
- OM review queue: solid promote/reject gate. Add "approve all clean runs" for batches where validation flags are empty.

### 2.8 Saved deals (`/saved`), Deal analysis (`/deal-analysis`), Runs (`/runs`), Property data (`/property-data`), Profile
- Deal analysis: recalculation does not auto-save the workspace (`deal-analysis/page.tsx:1163-1225`) — easy to lose edits on tab close; save-on-recalc or a dirty-state guard is the fix. Deal score should surface before dossier generation, not after.
- Runs: the saved-search builder works but a "test run" preview before saving would prevent 0-result searches; the LoopNet bookmarklet block needs a copy button.
- Property data overlaps Pipeline significantly; recommend folding what's unique (workflow board, raw-listing link-up) into Pipeline over time and retiring the page (it already redirects there from the nav grouping).
- Profile assumptions: good; consider surfacing "these defaults seeded N dossiers this month" so people trust editing them.

### 2.9 Cross-cutting (the big five)
1. **Transient, page-local feedback** for anything long-running → fixed by the global process banner (§5).
2. **No filter persistence anywhere** → URL-state first, presets second (Pipeline, CRM, Saved).
3. **Terminology drift** — "stage" vs "status" vs "deal state", "LTR yield" vs "cap rate" vs "YoC" between pages → pick one vocabulary (suggest: *stage* for kanban position, *cap rate* for the metric; "LTR/MTR YoC" only inside underwriting).
4. **Numbers not consistently right-aligned/tabular** outside Pipeline and Yield Map → apply `font-variant-numeric: tabular-nums` + right alignment to every metric column (Progress cards, CRM table, Saved grid).
5. **Detail-sheet depth** — the financial story is 2–3 clicks deep everywhere → header "deal strips" (one line of always-visible numbers) on the pipeline sheet, progress cards, and deal-analysis.

---

## 3. Design references used

- **Dealpath deals dashboard** — pipeline volume/value by stage with conversion between stages and time-to-close as first-class KPIs; dashboards rebuilt around load speed and per-team configurability. ([dealpath.com/blog/deals-dashboard-for-pipeline-tracking](https://www.dealpath.com/blog/deals-dashboard-for-pipeline-tracking/), [dealpath.com/blog/real-estate-dashboards](https://www.dealpath.com/blog/real-estate-dashboards/))
- **Crexi Intelligence / CoStar** — comp analysis as map + table twins: verified sale comps with cap rate & $/PSF, interactive map filtering, hover-linked markers. The yield-map comps overlay follows this pattern. ([crexi.com/intelligence](https://www.crexi.com/intelligence))
- **Map-list linking** (Zillow/Airbnb pattern, used by CoStar too): hovering a list row highlights the map marker and vice versa — implemented exactly this way on the yield map.
- **Funnel/KPI structure for acquisition teams** — deals sourced → reviewed → LOI → closed with explicit conversion percentages and per-source quality; tracking the denominator is the whole game. ([plecto.com real-estate dashboards](https://www.plecto.com/dashboard-examples/industry/real-estate-dashboards/), [affinity.co deal velocity](https://www.affinity.co/blog/data-analytics-deal-timelines-competition))

---

## 4. Proposed: "Metrics" dashboard (design spec — not yet built)

A new top-level page (suggest `Home ▸ Metrics` tab or `/metrics`) that answers "how is sourcing performing?" in one screen. Everything below is computable from existing tables (`properties`, `deal_signals`, `listings`, `workflow_runs`, `inquiry_emails`, `broker_comp_*`, saved-search runs).

**Layout (top to bottom):**

1. **KPI strip (StatCards, 6):** Deals sourced (7d / 30d with Δ vs prior period) · Active pipeline count & total ask value · OMs received (30d) · Median LTR cap rate (window) · Median $/PSF (window) · Win/loss (closed vs rejected, 90d).
2. **Funnel bar** — `sourced → outreach → OM received → underwriting → tour → offer → contract → closed`, each stage showing count **and conversion % from the previous stage** (the number nobody can compute today). Click-through to the pipeline pre-filtered to that stage.
3. **Velocity row (2 charts):**
   - *Time-in-stage* box plot or median bars per stage (from `stage_entered_at` history) — exposes where deals stall (e.g., "OM requested → received: median 9 days").
   - *Weekly sourcing volume* — stacked bars by source (StreetEasy / saved search / manual / email) over 12 weeks; overlay line = % that survived screening, which scores source quality, not just quantity.
4. **Market layer row (2 panels):**
   - *Cap-rate & $/PSF trend* — monthly median from `deal_signals` + comps, split deals vs comps; this is the "living database" earning its keep.
   - *Coverage heat*: borough/neighborhood table — deals, comps count, median cap rate, median $/PSF; flags neighborhoods where you have deals but no comps (comp-request hit list).
5. **Operations row:** broker response rate (replies / outreach sent, 30d) · email-pull and saved-search run health from `workflow_runs` (last run, failure streaks) · OM extraction queue depth (needs_review count, median age).

**Interaction rules:** one global time-range selector (7/30/90/365d); every number clicks through to the corresponding filtered list; tiles are `StatCard`/`Panel` primitives so it ships with the existing design system; sparklines over chart libraries where possible (inline SVG, no new heavy deps).

**Build estimate:** one summary endpoint (`GET /api/metrics/overview?windowDays=`) doing grouped SQL, one page of cards/CSS — the funnel and weekly bars are plain flex/SVG, no charting dependency needed for v1.

---

## 5. Process feedback & the email-pull hang (implemented)

**Root cause of the hang:** `gmailClient.ts` issued googleapis calls with no timeout; the global email search (`POST /api/broker-om/email-search`) listed up to 50 messages then fetched each **serially**, so one stuck socket hung the request — and the page — indefinitely. The inbox cron (`processInbox`) had the same exposure plus unbounded per-broker and per-thread loops and an unguarded LLM call.

**Fixes:**
- 30s timeout on every Gmail API call (client-level, env-overridable via `GMAIL_API_TIMEOUT_MS`).
- Run budgets: the email search stops gracefully at its time budget and returns partial results flagged `truncated`; `processInbox` checks a deadline between messages/phases and reports what it completed; the LLM email-summary call is raced against a timeout.
- `GET /api/workflow/runs?ids=` exposes the existing run tracking for polling.
- **Global process banner** (`ProcessBanner` + provider in the app shell): any long-running action — StreetEasy import, email pull, enrichment/OM refresh — registers a labeled entry; a slim colored bar appears across the top of every page with a spinner, live progress text, and an ✕ to dismiss (the work continues server-side). Success/failure states show briefly and clear themselves. Wired into: add-property imports, the email-search pull, and pipeline bulk refresh/OM/dossier actions.

---

## 6. Comps: data model upgrades (implemented)

- **Extraction now targets investment-sale financials**, not just condo sellout pricing: per comparable — sale price, sale date, **cap rate**, NOI, $/PSF, $/unit, units, building SF, property type. Items with sale metrics are typed `sale_comp`.
- **PSF-only flagging:** items with $/PSF but no cap rate carry `metricFlags.psfOnly`; packages summarize `compsWithCapRate` / `psfOnlyComps`, surfaced in the comp-analysis page and the import result panel.
- **Geocode cache** (`comp_address_geocodes` migration) so comps can be mapped; populated lazily via Geoclient on yield-map loads, with failures cached and retried weekly.
- **Import-level comp intake** (`POST /api/import/comp-package`): upload without picking a property; subject-address matching links the package to a canonical record, or returns candidates for manual pick.

## 7. Prioritized backlog (recommended next, in order)

1. Metrics dashboard (§4) — the reporting layer is the biggest remaining gap.
2. Pipeline saved views + URL-persisted filters.
3. Aging chips on progress board cards + column pinning.
4. Deal-strip header on pipeline detail sheet (one-line financial summary).
5. Auto-save (or dirty-guard) the deal-analysis workspace on recalculation.
6. Marker clustering + radius filter on the yield map.
7. Terminology pass (stage/status/cap-rate naming) + tabular-nums everywhere.
8. Inline broker-email capture in the CRM composer.
