# Sourcing OS Upgrade Plan — Ingest Fast, Screen Fast, See Where Every Deal Lives

**Date:** 2026-06-09 · **Audited at:** commit `fdf0c72` · **Status:** plan approved-pending-launch; no feature code written yet.

This plan upgrades the earlier 11-agent "Rent & Expense Comping" launch plan. The original plan was comps-warehouse-first; this version reorders it **sourcing-first** — multi-OM ingestion, instant tear-sheet screening, and a canonical deal-flow board come first, because that is the daily bottleneck. The comping module stays, repositioned as Phase 2 and fed automatically by the ingestion warehouse Phase 1 builds. Design direction follows Dealpath / Yardi Acquisition Manager / Altrio Origin patterns plus the cap-rate-chronicle visual language (modern grotesque type, data-forward cards, KPI highlight boxes, drag-between-stages).

---

## Part 1 — Current-State Audit (what we verified, with citations)

Four deep audits were run at `fdf0c72`: ingestion/OM pipeline, data model & deal stages, financial math, and web UI/UX, plus a dedicated Broker CRM review and a baseline build/test pass.

### 1.1 Ingestion & OM pipeline — strong core, fragile edges

What works today:
- Multi-file OM upload exists and creates/matches property records: `POST /api/deal-analysis/analyze-upload` accepts up to 10 files (PDF/XLSX/CSV/TXT, 10 MB each), runs Gemini (`gemini-3-flash-preview`) over PDFs via the Files API, resolves the address (`resolveOmPropertyAddress.ts` — recently much improved: ordinals, directionals, suffixes, borough detection), then matches exact → first-line → **creates a new property** (`dealAnalysisOmImport.ts:284-312`).
- Immutable extraction runs + review + promotion (OM Ingestion V2 core) are live: `om_ingestion_runs` → `om_extracted_snapshots` → manual promote → `om_authoritative_snapshots (is_active)` (`ingestAuthoritativeOm.ts:869-1217`).
- **New in `fdf0c72`:** the Broker OM Gmail feature (`brokerOm.ts`, 744 lines + `/broker-om/email-search` page) — search Gmail for OM-like attachments per property or globally, preview, import to a property, and even **create a new property from an email PDF** (`brokerOm.ts:663-742`). This is the Altrio "email-in" pattern, already shipped.

Verified gaps (the hardening backlog):
| # | Finding | Where | Severity |
|---|---|---|---|
| I1 | Extraction queue is **in-memory**; server restart loses queued jobs (Render restarts regularly) | `asyncTaskQueue.ts:18-56` | Critical |
| I2 | File bytes not guaranteed persisted to Postgres (`file_content` optional) — ephemeral disk can orphan documents | `PropertyUploadedDocumentRepo.ts:51-94` | Critical |
| I3 | Dedupe on OM ingest is exact-normalized-string only, `LIMIT 1`, no scoring or review — same building can become two properties | `dealAnalysisOmImport.ts:146-178` | Critical |
| I4 | No retry/backoff on Gemini failures; failed runs stay `failed` forever; concurrency capped at 1 | `extractOmAnalysisFromGeminiPdfOnly.ts`, `asyncTaskQueue.ts:12` | High |
| I5 | **Excel rent rolls / T-12s are only flattened to text context** for Gemini — never structurally parsed into unit rows or line items | `dealAnalysisOmImport.ts:113-144`, `extractTextFromUploadedFile.ts:23-37` | High |
| I6 | Two competing document-category taxonomies (`attachmentClassification.ts` snake_case vs `PropertyDocumentCategory` display strings) bridged by ad-hoc mapping | both files | Medium |
| I7 | Dead path: `/api/ui-v2/import/om-upload` returns `status:"legacy_endpoint"` | `importV2.ts:76-82,165-168` | Low |
| I8 | Promotion race: no deactivate-before-insert on `is_active`; property create + doc persist not in one transaction | `OmAuthoritativeSnapshotRepo.ts`, `dealAnalysisOmImport.ts:284-442` | Medium |
| I9 | Review UX: no field-level confidence, validation flags stored but not rendered on `/om-review`, no edit-before-promote, no retry button | `om-review/page.tsx`, `ingestAuthoritativeOm.ts:286-329` | High |
| I10 | Gemini usage metadata captured but never logged; API key validated at call time not startup; `SYSTEM_START_AT` hardcoded `2026-03-01` | `extractOmAnalysisFromGeminiPdfOnly.ts:27-53,86-92`, `brokerOm.ts:29` | Low |

### 1.2 Deal flow state — six overlapping answers to "where does this deal live"

- The same property's position is encoded in **six places**: UI-v2 status (17 values, derived at read time, `pipelineV2.ts:797-816`), sourcing `workflow_state` (10 values), `disposition` (6 values), per-user `saved_deals.deal_status`, the `property_rejections` table, and legacy `details.pipeline.status`. No canonical column; no enforced transitions (any state → any state).
- **No stage history or aging** — `property_pipeline_events` exists but `event_type` is free text with no structured old→new; you cannot ask "how long in screening" or see funnel conversion.
- No kanban ordering, no owner/assignee, no per-stage dollar totals.
- `fdf0c72` added drag-and-drop + bulk stage moves to the saved-deals progress board (`progress/page.tsx:784-979`) — the right interaction, currently limited to the saved-deals subset rather than the whole pipeline.
- **lat/lng exists only on `listings` (005), never on canonical properties; zero map/geo libraries anywhere.**

### 1.3 Financial math — fundamentally sound; a short fix list

The audit traced every formula site. The good news: **all deal math is server-side** (the 3,214-line `OmCalculationPanel` renders API results; it does not recompute NOI/cap rates/cash flows), the MTR vacancy fix (`43e8e3b`) is correctly and consistently applied (commercial + protected units excluded from vacancy-eligible income, `underwritingModel.ts:1032-1050`), management fee and occupancy tax are applied on the same post-vacancy/lead-time base in both API and Excel, and mortgage/IRR/DSCR math checks out.

Verified issues (the math-fix register):
| # | Finding | Where | Severity |
|---|---|---|---|
| M1 | **Excel CoC ≠ app CoC**: workbook CoC = `(NOI + debtService)/equity` (sign is correct — debt service is stored negative at `excelProForma.ts:513`) but it **omits recurring capex**, while the app's CoC uses operating cash flow (NOI − capex) − debt service (`irrCalculation.ts`, `dossierGenerator.ts:359`). Exported Excel reads higher than the app whenever capex > 0. *(Note: an earlier automated finding called this a sign error; that was re-verified and is false — the discrepancy is the capex term only.)* | `excelProForma.ts:549` | High |
| M2 | Occupancy tax grows with **rent** growth, not expense growth — plausible (it scales with revenue) but undocumented; confirm intent and write it into FINANCIAL_FLOWS.md | `underwritingModel.ts:1231` | Medium |
| M3 | 1-year hold + lead time: "stabilized" metrics silently use the lease-up year | `underwritingModel.ts:1399-1401` | Medium |
| M4 | `expenseIncreasePct` is **ignored when a detailed expense table exists** — by design, but invisible; users think the step-up applies | `underwritingModel.ts:604-623` | Medium |
| M5 | IRR solver failure returns `null` silently — UI shows "—" with no reason | `irrCalculation.ts:64-65` | Low |
| M6 | Three cap-rate definitions (asset NOI-basis, year-1 on purchase, stabilized/exit) displayed without basis labels | `underwritingModel.ts:271-304,1279-1282,1314-1317` | Medium |
| M7 | `OmCalculationPanel` null-propagates `underwrittenAnnualRent` without surfacing a calc error to the user | `OmCalculationPanel.tsx:702-707` | Medium |
| M8 | NOI-override + edited expense rows can silently disagree (override wins, expenses become decorative) — needs a visible "override active" state | `buildOmCalculation.ts:418-435` | Medium |

### 1.4 Web UI/UX

- **Dead/orphan routes:** `/dedupe` (1-line stub), `/rental-analysis` ("Coming later"), `/manual-entry` and `/agent-test` (redirect shells); `/sales-metrics`, `/listings`, `/property-data` not in nav.
- **Monoliths:** `PipelineClient.tsx` 5,340 lines, `OmCalculationPanel.tsx` 3,214, `property-data/page.tsx` 2,928, `crm/page.tsx` 2,552 — slow to change, impossible to test.
- Silent error swallowing (`property-data/page.tsx:577-603`), missing pipeline empty state, `API_BASE` trailing-slash handling inconsistent across 6+ pages, `window.confirm` for destructive actions, sort indicators rendering the literal words "asc"/"desc" (`crm/page.tsx:756`), close buttons as a bare "x".
- **No drag-drop file upload anywhere; no charting library; no map.** Number formatting is guarded (no NaN/divide-by-zero found in pipeline display paths).

### 1.5 Broker CRM (reviewed at the new `fdf0c72` version, per request)

The CRM has the right primitives — dual Properties/Contacts lenses, flags-first triage sort, inline response capture, outreach composer + templates + follow-ups, contact merge — but the presentation fights the operator:

| # | Finding | Where |
|---|---|---|
| C1 | **Every row is a form**: each property row renders 5 text inputs + select + 3-4 buttons (~600+ controls at 100 rows). Placeholder text competes with real data; the table can't be scanned | `crm/page.tsx:1720-1820` |
| C2 | **No pagination**: `CRM_LIMIT=100`, offset locked to 0 — contacts beyond 100 unreachable; KPI tiles compute from the loaded page only, so "Need email: 12" can be wrong | `crm/page.tsx:25,813,894-900` |
| C3 | **N+1 fetch storm**: up to 200 individual `GET /api/ui-v2/properties/:id` calls just to label property chips | `crm/page.tsx:864-892` |
| C4 | **Row teleport after save**: default sort = flags rank; fixing an email changes the rank and the row jumps after the full-table reload | `crm/page.tsx:775,935-946,1220` |
| C5 | **Inconsistent clear-on-save**: inline save falls back to existing values for name/firm/phone/notes but sends `null` for an emptied email — accidental Save wipes a stored email | `crm/page.tsx:1206-1210` |
| C6 | "Email" on a contact silently composes against the **first** related property — no chooser when a broker has many | `crm/page.tsx:1545-1561` |
| C7 | Two composer surfaces exist (CRM drawer vs property-data inquiry flow) with different behavior | `crm/page.tsx` + `property-data/*` |
| C8 | Duplicate detection and merge candidates are computed **client-side over the loaded page only** | `crm/page.tsx:344-361` |
| C9 | Reject from CRM hardcodes `reasonCode: "broker_unresponsive"` regardless of selected response status | `crm/page.tsx:1279` |
| C10 | "Gmail Pull" nav label is jargon; the feature (find OMs in email) is buried as a third-level child | `AppShell.tsx:83-84` |

### 1.6 Build & test baseline

- 182/182 unit tests pass. 11 test *files* fail to load only because `npm run check` runs vitest **before** building `@re-sourcing/db` (`package.json` script order) — infra, not product. Fix: build `contracts`+`db` before `test`, or point vitest aliases at `src`.
- Two parallel `codex/*` branches exist (`codex/deal-analysis-noi-hold-period`, `codex/ui-v2-overhaul`) — coordinate before large refactors of `dealAnalysisWorkbook.ts` or UI-v2 routes to avoid collision.

---

## Part 2 — What We're Building (benchmark-informed target design)

Benchmarks studied: **Dealpath** (Deals Dashboard command center; group-by state/type/location; AI Extract: OM/T-12/rent roll → ~90-field tear sheet in <1 min; map pins; stage workflows with audit-trailed approvals; dead deals become comps), **Yardi Acquisition Manager / Deal Manager** (pipeline fused with market data + underwriting models; approvals tied to deal metrics; Voyager rent-roll/T-12 chart-of-accounts schemas), **Altrio Origin** (email-in OM ingestion; active/closed/past/lost tracking by status/sector/geo; maps + comp searches over your own deal history), and the **cap-rate-chronicle** Lovable app for visual language (couldn't be fetched from this sandbox — network allowlist — so its direction comes from your description + the standard shadcn/Lovable system it's built on; screenshots welcome to tighten specs).

### A. Ingestion Hub (upgrade `/add-property` into the single front door)
1. **Multi-OM drop zone**: drag-drop N PDFs/XLSX (raise multer cap from 10), one queued `om_ingestion_run` per file, live per-file status rows (queued → extracting → tear sheet ready / needs review / failed+Retry) driven by the new DB-backed queue. Property records auto-created/matched per file exactly as `analyze-upload` does today.
2. **Email-in, surfaced**: promote the new Gmail feature out of "Gmail Pull" — rename **"Find OMs in Email"**, give it a tile on the Hub ("New OMs found in your inbox: 4 → review"), keep per-property pull on the property page.
3. **Structured Excel ingestion** (the "quick analysis from agent Excels" ask): deterministic `xlsx` parser maps Yardi/RealPage-style exports into `rent_roll_units` and `financial_line_items` (T-12 chart of accounts: GPR → loss-to-lease/vacancy/concessions/bad debt → +other income → EGI → controllable/non-controllable expenses → NOI), with an LLM assist only for header mapping. Excel stops being "context text" and becomes first-class data with per-cell provenance.
4. **Dedupe-on-ingest**: reuse the listing dedupe scorer for OM imports (pg_trgm similarity on canonical address + unit count + zip); score < threshold ⇒ auto-match, ambiguous ⇒ "possible duplicate" card in the review queue with merge / keep-separate, replacing today's `LIMIT 1` silent pick.
5. **Hardening**: queue state lives in `om_ingestion_runs` (survives restart, workers re-poll), retry with backoff, concurrency 3, file bytes **always** written to `file_content`, single document-category enum, promotion made transactional (deactivate-then-insert), Gemini usage logged per run.

### B. Screening Tear Sheet (Dealpath AI-Extract pattern)
One screen per completed extraction run: address + photo strip; six KPI highlight boxes (Ask, $/Unit, $/SF, Current NOI, Cap Rate, YoC LTR/MTR); unit-mix table; T-12 summary with **our-math-vs-broker-math deltas** flagged (uses existing `approxEqual` NOI validation); missing-data checklist (from `coverage`); per-field source/page provenance; and three actions — **Pursue** (stage → Pursuing), **Pass** (state → Dead, retained as comp), **Needs Review** (today's review flow, upgraded with edit-before-promote and field-level confidence). The tear sheet *is* the om-review replacement, not a second page.

### C. Canonical Deal Stage Model (the "where does each property live" fix)
- New columns on `properties`: `deal_state` (`active | dead | closed`) + `deal_stage` (`inbox → screening → pursuing → outreach → om_review → underwriting → tour → offer_loi → contract_dd → closed`), plus `stage_order` (board position) and `stage_entered_at`.
- New `stage_transitions` table: `property_id, from_state/stage, to_state/stage, actor, reason, metadata, occurred_at` — powers aging chips, funnel/conversion reporting, and the audit trail Dealpath memorializes.
- One migration backfills from the six legacy dimensions (priority: active rejection → saved_deals → uiV2 derived → workflow_state) and `pipelineV2`/`savedProgressV2`/CRM all read/write the canonical field; sourcing `workflow_state` remains the automation sub-state under `outreach`. Legacy fields stay populated during transition (additive, reversible).
- **Metric-gated moves** (lightweight Yardi approval pattern): advancing past Screening with YoC below profile target requires a reason note → recorded on the transition.

### D. Deal Flow Board (one pipeline, three views)
Shared filter/search header + **Table / Board / Map** toggle over the same result set (Dealpath's one-list-many-views philosophy):
- **Table** = today's pipeline (kept; gets empty state + canonical stage column).
- **Board** = kanban by `deal_stage`; extends the drag-drop just shipped on the progress board to the whole pipeline; cards use the new property-card anatomy; column headers show count + total ask $ + median YoC; drops fire the same transition API; stage-aging chips ("12d in Screening", amber >14d, red >30d).
- **Map** = pins colored by stage, clustered for Manhattan/Brooklyn density; pin click opens the property card popover; graceful table fallback when no geo data/key.

### E. Property detail restructure
Tabs replace the collapsible stack: **Overview (tear sheet) · Financials (rent roll + T-12 + underwriting panel) · Documents · Brokers · Activity (stage timeline from `stage_transitions` + pipeline events)**. The underwriting panel keeps its server-driven math but adopts KPI-box components, explicit save/recalc state, a visible "NOI override active — expense table not driving NOI" banner (M8), and cap-rate basis labels (M6).

### F. Broker CRM v2 (redesign, keeping the primitives)
1. **Read-first rows**: text + status chips, not always-on inputs. Click a cell or row → focused popover/drawer edit. One visual row height; scannable.
2. **Queue lens default**: "Needs attention" view (needs email → choose primary → no response in N days → follow-ups due), each item with its one action — turning the flags ranking into an explicit work queue instead of a sort order.
3. **Server-side completeness**: real pagination (or virtualized full fetch), KPI tiles from a summary endpoint, duplicate suggestions computed server-side across all contacts, related-property labels embedded in the list payload (kills the 200-call N+1).
4. **Stable interactions**: optimistic row update without resort-on-save (re-sort only on explicit refresh/sort); fix the email-clearing fallback (C5); reject reason follows the selected response status (C9); design-system confirm dialogs.
5. **One composer**: CRM drawer composer becomes *the* composer, mounted from both CRM and property page; composing from a multi-property contact asks which property.
6. **Naming**: "Gmail Pull" → "Find OMs in Email", surfaced on Hub + CRM.

### G. Design system refresh (cap-rate-chronicle direction)
- **Type**: modern grotesque (Inter/Geist class) for UI + display; `font-variant-numeric: tabular-nums` on all metrics; 13-14px body at 1.5 line-height; tightened display tracking; muted-slate secondary text. Token swap in `globals.css` — the v5 token system already exists.
- **KPI highlight box** component: 1px border + 4px left accent bar (green = beats target / amber = marginal / red = below), large numerals, 11px uppercase tracked label. Used identically on tear sheet, cards, detail header, board columns.
- **Property card anatomy**: photo/borough placeholder → address title → one muted meta line (neighborhood · units · SF · vintage) → 3-metric KPI strip → soft-tinted stage chip + aging chip → hover quick-actions. Kills the boxes-in-boxes nesting.
- **Density rule**: chips for status, plain text for facts, boxes only for the 3-6 deciding numbers; everything else one click deeper. Monoliths get decomposed into components as each surface is touched (board cards, KPI boxes, drawer, composer become shared components).
- Sweep: empty states everywhere, single `apiFetch` util (fixes API_BASE drift), real sort arrows, proper dialogs, delete orphan routes (`/dedupe`, `/rental-analysis`, `/manual-entry`, `/agent-test`).

### H. Phase 2 — Comp Warehouse & Benchmarking (the original plan, repositioned)
Everything ingested in Phase 1 (including **passed/dead deals — never deleted, always comp-searchable**, the Dealpath/Altrio flywheel) feeds:
- Comp set CRUD + saved filters (market/borough/vintage/units/confidence/doc type) and per-property inclusion toggles (revenue/expense/vacancy/trade-out/NOI) — original Agents 1/5/8.
- Benchmark dashboards: NOI margin, revenue & expense per-unit/PSF percentiles, vacancy, subject-vs-comp-set spreads, with drill-to-source-document — original Agent 7. Add a small chart lib (recharts) at this phase only.
- LTR/MTR yield-spread analytics on top of the now-trustworthy shared calc layer.

---

## Part 3 — Schema & API Changes

**New migrations (056+, all additive):**
1. `properties`: `deal_state`, `deal_stage`, `stage_order`, `stage_entered_at`, `lat`, `lng`, `geocode_source`, `geocoded_at` + indexes; backfill lat/lng from matched listings.
2. `stage_transitions` table (+ backfill event from legacy status resolution).
3. `rent_roll_units` table (unit, type, beds/baths, SF, market rent, actual rent, lease start/end, occupied, source_document_id, provenance).
4. `financial_line_items` table (period, category enum per T-12 chart of accounts, amount, as_reported_label, source_document_id).
5. Extraction-queue fields on `om_ingestion_runs` (`attempt_count`, `next_retry_at`, `locked_at/by`, `usage_metadata`); single `document_category` enum; `pg_trgm` extension + trigram index on `canonical_address`.
6. Phase 2: `comp_sets`, `comp_set_members`, per-property comp inclusion toggles.

**API (new/changed):**
- `POST /api/properties/:id/stage` (+ bulk) — canonical transition w/ reason; `GET /api/pipeline/board` (grouped+ordered) and `GET /api/pipeline/map` (geo payload).
- `GET /api/om-runs/:id/tear-sheet`; `POST .../promote|reject|retry` (retry is new); edit-before-promote payload.
- `POST /api/intake/uploads` (batch, returns run ids) + `GET /api/intake/queue` (live statuses).
- Excel structured-parse endpoint feeding `rent_roll_units`/`financial_line_items`.
- CRM: summary-stats endpoint, paginated list with embedded labels, server-side duplicate suggestions.
- Geocode worker endpoint/cron (Geoclient first — already integrated for BBL — provider TBD only if Geoclient coverage disappoints; skip when lat/lng present).
- Retire `/api/ui-v2/import/om-upload` placeholder.

**Env additions:** `BROKER_OM_SYSTEM_START_AT` (replace hardcode), `GEMINI_OM_MAX_CONCURRENCY=3` default, optional `NEXT_PUBLIC_MAP_PROVIDER` + key (MapLibre/OSM default = no key needed; Google optional).

---

## Part 4 — Workstreams (upgraded from the original Agent 0-10 plan)

| WS | Replaces | Scope | Depends on |
|---|---|---|---|
| **WS0 Audit** | Agent 0 | ✅ Done — Part 1 of this document | — |
| **WS1 Schema & Stage Model** | Agent 1 | Migrations 1-5 above; repos; backfill scripts; transition validation | WS0 |
| **WS2 Ingestion Hardening & Hub APIs** | Agent 2 | DB-backed queue + retry, bytes-in-DB, category enum unification, batch upload API, structured Excel parser, transactional promote, usage logging | WS1 |
| **WS3 Dedupe & Data Quality** | Agent 3 | pg_trgm scoring on OM ingest, duplicate review queue + merge/keep-separate, field-level confidence storage | WS1 |
| **WS4 Financial Consistency** | Agent 4 | Fix register M1-M8 (M1 first: align Excel CoC with app definition); cap-rate labeling; FINANCIAL_FLOWS.md update; golden tests | WS0 |
| **WS5 APIs & Aggregation** | Agent 5 | Stage/board/map/tear-sheet/CRM endpoints; server aggregation | WS1-3 |
| **WS6 Shell & Design Refresh** | Agent 6 | Tokens, type, KPI/card/chip/dialog components, nav restructure, orphan-route cleanup, apiFetch util | WS0 (parallel) |
| **WS7 Board, Tear Sheet & Property Detail UI** | Agent 7 (reoriented) | Table/Board/Map pipeline, tear sheet screen, property tabs, aging chips | WS5, WS6 |
| **WS8 Broker CRM v2** | *new (user request)* | Redesign per §F; fixes C1-C10 | WS5, WS6 |
| **WS9 Map & Geocoding** | Agent 9 | lat/lng backfill + Geoclient geocode-once worker, MapLibre map view, fallback | WS1, WS5 |
| **WS10 QA & Regression** | Agent 10 | Fix `npm run check` ordering; E2E: batch upload → tear sheet → pursue → board drag → CRM outreach; math goldens (app vs Excel parity); dossier regression | continuous |
| **WS11 Comp Warehouse & Benchmarks** | Agents 1/5/7/8 (comp parts) | Phase 2 per §H | Phase 1 done |

**Execution order:** WS1 → (WS2 ∥ WS3 ∥ WS4 ∥ WS6) → WS5 → (WS7 ∥ WS8 ∥ WS9) → WS10 gates release → WS11.
**Quick wins shippable immediately, independent of the rest:** M1 Excel CoC alignment, `npm run check` ordering, orphan-route deletion, CRM C5 email-clear fix, C9 reject-reason fix, pipeline empty state, API_BASE unification, "Gmail Pull" rename.

## Part 5 — Acceptance Criteria (Phase 1)

1. Drop 5 OM PDFs → 5 property records with tear sheets, no manual steps, queue survives a server restart, failures show Retry.
2. A broker's T-12/rent-roll Excel lands as structured line items and unit rows with provenance — visible in Financials tab within a minute of upload.
3. Same-building OM re-upload is flagged as a duplicate with a merge path; passed deals remain searchable as comps.
4. Every property shows exactly one stage + state; board drag, table edit, and CRM reject all write the same `stage_transitions` row; aging visible on every card.
5. Map shows the active pipeline with stage-colored pins; properties without coordinates listed in fallback.
6. App CoC, dossier CoC, and Excel CoC agree to the dollar on the same inputs; all 182+ tests green via `npm run check` with no build-order failures.
7. CRM: 100% of contacts reachable (pagination), zero N+1 label fetches, rows don't move on save, emptying an email field never silently wipes it.

**Risks / notes:** coordinate with the open `codex/*` branches before touching `dealAnalysisWorkbook.ts` or UI-v2 routes; stage backfill is the only migration with judgment in it — ship behind a dry-run report first; cap-rate-chronicle visual specs are directional until screenshots are shared.
