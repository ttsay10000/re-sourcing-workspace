# UI Overhaul — Phase 2 Execution Plan (Recommendations)

**Date:** 2026-06-10 · **Baseline:** main @ `32147ed` (overhaul phases A–D merged; `npm run check` 244/244 green) · **Status:** ARMED — prepared for execution on Tyler's GO.

Scope: the six recommendations delivered after the Phase A–D review. CRM v2 (WS8) remains explicitly out of scope and keeps its own phase.

---

## R1 — Finish the stage-model migration (aging, durable columns, funnel stats)

**Goal:** the board stops deriving position from saved-deal statuses at read time; stage position is stored, transitions are recorded, and "time in stage" is visible everywhere.

**What exists already (do not rebuild):**
- `properties.deal_state / deal_stage / stage_order / stage_entered_at` + `stage_transitions` table (`packages/db/migrations/056_deal_stage_and_geo.sql`).
- `StageTransitionRepo.recordTransition` with canonical `DEAL_STAGES` (10 coarse stages: inbox…closed) and guards `isDealStage/isDealState` (`packages/db/src/repos/StageTransitionRepo.ts`).
- `POST /api/ui-v2/properties/:id/stage` endpoint validating state/stage (`pipelineV2.ts:3357`).

**Design decision (the one piece of real thinking):** two granularities exist — the display flow (11 stages in `@re-sourcing/contracts` `DEAL_FLOW_STAGES`, what the board/home show) and the canonical persistence stages (10 coarse, migration 056). Mapping: display → canonical is many-to-one (`underwriting_awaiting_review`+`underwriting_review_completed` → `underwriting`; `tour_requested`+`tour_scheduled`+`tour_completed_awaiting_inputs` → `tour`; `offer_review`+`negotiation` → `offer_loi`; `contract_signed` → `contract_dd`; `om_requested` → `outreach`; `sourced` → `screening`; `deal_closed` → closed state). Record transitions at canonical granularity with `metadata.displaySection` carrying the fine-grained section id, so canonical analytics stay clean and display-level aging is still reconstructable.

**Steps:**
1. `packages/contracts/src/dealFlow.ts`: add `canonicalStage` to each `DealFlowStage` entry (typed to the db `DealStage` union literal values, no import cycle — duplicate the string union in contracts and add a unit test asserting it matches `DEAL_STAGES` from `@re-sourcing/db`).
2. API write path: in the three mutation sites that move deals (`savedProgressV2` PATCH `/properties/:id/status`, PATCH `/deal-path`, and `crmV2`'s `markOmRequestedFromOutreach`), after the status write, compute the new display section → canonical stage and call `StageTransitionRepo.recordTransition` + update `properties.deal_stage/stage_entered_at` when the canonical stage changed. One shared helper `apps/api/src/deal/recordDealStageChange.ts`.
3. Backfill script (`tools/` or migration `057`): set `deal_stage`/`stage_entered_at` for existing saved deals from their current derived section (entered_at = best available timestamp: latest matching `property_pipeline_events` row, else `updated_at`).
4. Read path: `mapProgressRow` adds `stageEnteredAt` (from `properties.stage_entered_at`); progress board cards and pipeline Stage column render an `AgingChip` ("9d in stage"; amber ≥ 7d in pre-tour stages, red ≥ 14d — thresholds in the contracts constant so the recommendation engine reuses them).
5. Column headers gain per-stage totals: count (exists) + sum of ask (`price`) formatted compact.
6. Recommendations engine (R2 below) consumes `stageEnteredAt` for staleness rules.

**Verification:** unit tests for the display→canonical mapping and the stage-change helper (no transition recorded when stage unchanged); manual: move a deal across columns, confirm `stage_transitions` rows and aging chip reset.
**Size:** ~1 session. **Risk:** write-path regressions — keep recordDealStageChange fire-and-forget (log, never block the status write).

## R2 — Recommendation chips finish the job (steppers + staleness rules + keyboard)

**Goal:** acting on a recommendation is one flow, not N card visits.

1. **Stepper dialog** (`apps/web/src/app/progress/RecommendationStepper.tsx`): for `missing_broker_email` and `request_oms`, the chip opens a Dialog that walks the property list one at a time — reusing `BrokerContactDialog` internals for emails and the composer form for OM requests — with Skip / Save & next, progress "3 of 7", and a summary line at the end. Board refresh once at completion (not per item); `loadRecommendations(true)` at the end.
2. **Staleness rules** (needs R1's `stageEnteredAt`): add `om_request_stale` ("5 OM requests with no reply in 10+ days — send follow-ups", uses `latestOutreachAt` already on saved rows + stage age) and `underwriting_stale` to `progressRecommendations.ts`; both get stepper support (follow-up = composer prefilled with a follow-up template).
3. **Keyboard triage:** board: `j/k` move card focus within a column, `h/l` across columns, `enter` opens Update inputs, `e` email broker, `m` move-stage dialog; pipeline table: `j/k` row focus, `enter` opens sheet, `e` email. Implement as a small `useKeyboardNav` hook; ignore keystrokes when a dialog/input has focus; document keys in a `?` overlay.

**Size:** ~1 session. **Dependencies:** R1 for staleness rules only — stepper + keyboard can ship first.

## R3 — Map view on Yield Map (MapLibre)

**Goal:** pins on a real map, colored by yield band (existing `YIELD_BANDS`) or stage, with the table as fallback.

1. Add `maplibre-gl` to `apps/web` (no API key; use OSM raster tiles or a free style JSON; pin attribution).
2. `yield-map/page.tsx`: add a Map/Table toggle (default Map when ≥1 row has coordinates — `summary.withCoordinates` already in the API response). Pins from `comps[].lat/lng`; color via `yieldColor()`; click → popover card (address, units, LTR/MTR, $/unit) with "Open in pipeline" link (`/pipeline?propertyId=`).
3. Color-by toggle: yield band ↔ deal stage (stage colors from `StageChip` tone map; needs `dealStage` already in `CompRow` — it is).
4. Geocode worker (only if coverage is poor): migration 056 backfilled lat/lng from listings; check `withCoordinates/count` first — if >80%, skip the Geoclient worker this phase and note the gap.
5. Optional tie-in: "Confirm tours" recommendation links to the map filtered to those property ids (tour-routing use case).

**Size:** ~1 session. **Risk:** none to existing surfaces — page-local.

## R4 — Numbers trust fixes (M5/M6/M8 from the math register)

1. **M6 cap-rate basis labels:** everywhere a cap rate renders (sheet screening bar "Market cap", OmCalculationPanel, dossier views), suffix the basis: "asset NOI", "year-1 on purchase", "stabilized/exit". Source of truth: a `CAP_RATE_BASIS_LABELS` map in contracts; the API already computes the three variants in `underwritingModel.ts:271-304, 1279-1282, 1314-1317` — expose `basis` alongside each value in the payloads that carry them.
2. **M8 NOI-override banner:** `OmCalculationPanel.tsx` — when `buildOmCalculation` resolves an active NOI override (`buildOmCalculation.ts:418-435`), surface `noiOverrideActive: true` in the calc payload and render an amber banner "NOI override active — expense rows below are informational" with a jump-link to clear it.
3. **M5 IRR null reason:** `irrCalculation.ts:64-65` returns null silently; return `{ value: null, reason: "no_sign_change" | "did_not_converge" }` and show the reason in the tooltip instead of a bare em dash.

**Size:** ~0.5–1 session. Server payload changes are additive.

## R5 — OM review queue workflow upgrade (tear sheet, audit I9)

1. **Edit-before-promote:** on `/om-review`, promote opens a Dialog with the extracted snapshot's key fields (price, units, NOI, rents) editable; PATCH corrections into the snapshot before `promote` (API: extend the promote endpoint in `ingestAuthoritativeOm.ts` to accept field overrides recorded as `corrections` metadata).
2. **Field confidence:** extraction already stores validation flags that aren't rendered (`ingestAuthoritativeOm.ts:286-329`); render per-field confidence/validation chips in the review card (low-confidence = amber outline on the input).
3. **Retry:** failed runs get a Retry button → re-enqueue the extraction (new endpoint `POST /api/om-ingestion/runs/:id/retry`), with the I4 caveat (in-memory queue) noted — retry is still worth shipping before the queue hardening.

**Size:** ~1–1.5 sessions (the API promote-with-corrections is the meat).

## R6 — Quick wins batch

| # | Item | Where |
|---|---|---|
| 1 | Home "Last refresh" shows real data freshness (`summary.updatedAt` from deal-progress / pipeline payloads) instead of `new Date()` | `page.tsx:371` |
| 2 | Hidden routes decision: `/listings`, `/runs`, `/sales-metrics`, `/property-data`, `/profiles` — propose: keep `/runs` (linked from add-property activity), fold `/sales-metrics` + `/listings` into Yield Map/Pipeline or delete, delete `/profiles` (superseded by `/profile`), keep `/property-data` until WS7 replaces it. Needs Tyler's call per route — list compiled, one-line each | route dirs |
| 3 | Prune dead CSS left by the restyles (old `.metric`, `.kicker`, `.title` rules in saved/add-property/email-search modules; globals `.profile-page-title` margin rule) | module css files |
| 4 | Daily digest strip on home ("Since yesterday: 4 new matches · 2 price cuts · 1 broker reply") — read path only: expose `GET /api/notifications/digest-preview` reusing `sendDailyDigest`'s gather step (`dailyDigest.ts:519`) without sending | home + api |
| 5 | Recommendation panel: surface `source: "rules"` subtly ("rule-based" tooltip) so a missing OPENAI key is diagnosable from the UI | progress page |

**Size:** ~0.5 session total (item 2 awaits per-route answers; default to "leave" where unanswered).

---

## Sequencing

1. **R6** quick wins + **R2** stepper/keyboard (no dependencies) — immediate value.
2. **R1** stage migration (unlocks aging + staleness).
3. **R2** staleness rules (after R1) + **R3** map.
4. **R4** trust labels, then **R5** tear sheet.

Each lands as its own PR-sized commit set; `npm run check` + web build green before each push; main stays releasable between items.

## Open questions for Tyler (none block R1–R3)

- R6#2: keep/kill decisions per hidden route.
- R3: any preference for map style (default: light OSM raster matching the zinc palette)?
- R5: is edit-before-promote allowed to overwrite extracted numbers silently, or should corrections require a note? (default: optional note field, stored in metadata.)
