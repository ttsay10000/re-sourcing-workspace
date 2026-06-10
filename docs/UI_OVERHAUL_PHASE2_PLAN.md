# UI Overhaul — Phase 2 Execution Plan (Consolidated)

**Date:** 2026-06-10 (v2, consolidated with live-app feedback) · **Baseline:** main @ `32147ed` · **Status:** GO received — executed on `claude/blissful-newton-r2dbxs`.

**Execution status:** R0 ✅ (card overlap fix, schema guard + migration hints, derived-yield comps population) · R7 ✅ (reject⇒unsave + restore symmetry, /saved card grid with financials band + include-rejected toggle, profile slimmed, AppShell cleanup) · R8 ✅ (FileDropzone everywhere, OM intake restyled) · R6 ✅ (real freshness timestamp, digest-preview strip, dead CSS pruned, rule-based tag; hidden-route decisions still await Tyler) · R2 ✅ (broker-email/OM-request/follow-up steppers, board + pipeline keyboard triage with ? overlay) · R1 ✅ (canonical stage recording wired into all status writes, migration 057 backfill, guarded stageEnteredAt, AgingChip + column ask totals) · R2-staleness ✅ (stale OM requests 10d+, stuck underwriting 14d+, tested) · R3 ✅ (MapLibre map, yield/stage pin coloring, popups, auto-fit) · R4 ✅ (IRR null reasons, NOI-override banner, cap-basis labels verified) · **R5 ◻ remaining** — promote/reject run endpoints exist (`properties.ts:2908`) but have no UI surface; the tear-sheet (edit-before-promote dialog, per-field confidence chips, retry) is a fresh surface and needs its own session as sized.

**Ops still required:** run `npm run db:migrate` against the deployed DATABASE_URL (056 + 057). The boot schema guard and comps error hints will call this out loudly until done.

v2 consolidates the post-overhaul recommendations (R1–R6) with Tyler's screenshot review of the deployed app: Yield Map load failure + population question, progress-card layout overlap, reject-should-unsave, saved-deals consolidation (profile grid → Saved tab with prominent financials), button-spacing tidy-up, and a real drag-and-drop multi-file upload. CRM v2 (WS8) stays out of scope.

---

## R0 — P0 fixes (first commits on GO)

| # | Fix | Root cause (verified) | Where |
|---|---|---|---|
| R0.1 | Progress-board card header overlap: photo renders under/over the address text | `.miniRowMain` declares `grid-template-columns: auto minmax(0,1fr) auto` (3 tracks) but the card now has 4 children (checkbox, thumb, title, meta) | `progress.module.css:416-421` — add a track (`auto auto minmax(0,1fr) auto`); also align the meta stack (score pill + "No broker email" chip) into one tidy right column so the floating "—" pill sits with the chip |
| R0.2 | Yield Map: "Failed to load operating comps." | `/api/comps/operating` selects `p.deal_state/deal_stage/lat/lng` (migration **056**) — deployed DB hasn't run it, so the query 500s | Ops: run `npm run db:migrate` on the deployed env (see `RENDER_AND_ENV_CHECKLIST.md`). Code hardening: surface the server `details` in the page error, and add a startup/migration assertion so a missing migration fails loudly at boot, not per-request |
| R0.3 | Yield Map population — "shouldn't this show any property with an LTR yield?" | Query filters `WHERE ds.asset_cap_rate IS NOT NULL` from `deal_signals` only; properties whose LTR the pipeline derives live (NOI ÷ ask from details/listing) have no signals row and are invisible | Broaden the query with a fallback LTR computed in SQL from `details` (same paths `getSavedCurrentNoi`/`getSavedAskingPrice` use) when no signal exists, OR (simpler, preferred) ensure signal generation runs for every yield-bearing property as part of the existing refresh actions — decide at implementation after counting how many rows the fallback would add |

## R1 — Stage-model migration (aging, durable columns, funnel stats)

Unchanged from v1 — the structural unlock.

- Display→canonical stage mapping added to `DEAL_FLOW_STAGES` (11 display stages → migration-056's 10 canonical stages; transitions recorded at canonical granularity with `metadata.displaySection`).
- One shared `recordDealStageChange` helper called from the three mutation paths (`status`, `deal-path`, `markOmRequestedFromOutreach`); fire-and-forget so status writes never block.
- Backfill (`057`): `deal_stage`/`stage_entered_at` from current derived sections.
- UI: `AgingChip` ("9d in stage"; amber ≥7d pre-tour, red ≥14d) on board cards + pipeline Stage column; per-column count + ask-total in board headers.
- Existing infra reused: `StageTransitionRepo.recordTransition`, `POST /ui-v2/properties/:id/stage` (`pipelineV2.ts:3357`).

## R2 — Recommendations finish the job (steppers, staleness, keyboard)

Unchanged from v1.

- **Stepper dialog** for `missing_broker_email` / `request_oms` chips: walk the affected properties one-by-one (BrokerContactDialog / composer form inside), Skip / Save & next, "3 of 7" progress, single board refresh + `loadRecommendations(true)` at the end.
- **Staleness rules** (needs R1): `om_request_stale` (no broker reply N days after request — uses `latestOutreachAt` + stage age) and `underwriting_stale`; both stepper-capable (follow-up composer template).
- **Keyboard triage**: board `j/k/h/l` card focus, `enter` inputs, `e` email, `m` move; pipeline `j/k` + `enter`/`e`; `?` overlay; suppressed while dialogs/inputs focused.

## R3 — Yield Map becomes a real map of New York

Merges v1's R3 with Tyler's "how would we build a site map of those around New York?"

1. R0.2/R0.3 land first (data loads, population complete).
2. `maplibre-gl` + light OSM style matching the zinc palette; Map/Table toggle (Map default when `summary.withCoordinates` is meaningful — 056 already backfilled lat/lng from listings, so coverage should be high; verify the ratio and only then consider a Geoclient geocode worker for the remainder).
3. Pins colored by yield band (existing `YIELD_BANDS`) with a color-by toggle to deal stage (StageChip tones); click → popover (address, units, LTR/MTR, $/unit) + "Open in pipeline".
4. Tie-in: "Confirm tours" recommendation deep-links to the map filtered to those properties (tour routing).

## R4 — Numbers trust fixes (M5/M6/M8)

Unchanged from v1: cap-rate basis labels everywhere a cap rate renders (basis exposed in payloads), amber "NOI override active" banner in `OmCalculationPanel`, IRR null reason in the tooltip.

## R5 — OM review tear-sheet upgrade

Unchanged from v1: edit-before-promote (field overrides recorded as corrections, optional note), render the stored-but-hidden validation/confidence flags per field, Retry on failed runs. The intake dropzone from R8 is reused here for re-upload flows.

## R6 — Quick wins + spacing sweep

| # | Item |
|---|---|
| 1 | Home "Last refresh" uses real payload `updatedAt`, not `new Date()` (`page.tsx:371`) |
| 2 | Hidden-route decisions (`/listings`, `/runs`, `/sales-metrics`, `/property-data`, `/profiles`) — needs Tyler's keep/kill call per route; default leave |
| 3 | Prune dead CSS left by the restyles (old `.metric`/`.kicker`/`.title` rules; unused profile globals rule) |
| 4 | Daily digest strip on home via read-only `GET /api/notifications/digest-preview` reusing `sendDailyDigest`'s gather step |
| 5 | Recommendation panel surfaces `source: "rules"` subtly so a missing LLM key is diagnosable |
| 6 | **Button spacing tidy-up (Tyler):** one action-row standard — 0.5rem gap, equal button heights (`Button size="sm"`), no mixed pill/rect in one row — swept across saved-deal cards (View property / View docs / Unsave), progress cards (CTA + ⋯), property-sheet action bar, om-review actions, profile rows |

## R7 — Saved Deals consolidation (new, from Tyler's review)

**Goal:** one saved-deals surface; rejecting a deal takes it out of the saved workflow.

1. **Reject ⇒ unsave.** Verified today: `POST /ui-v2/properties/:id/reject` (`pipelineV2.ts:3777`) never touches `saved_deals`. Change: inside the reject handler, when a `saved_deals` row exists for the user, set `deal_status = "rejected"` via `SavedDealsRepo.updateStatus` (record-preserving — not a hard delete, so Restore can put it back to `saved`; the restore handler gets the symmetric update). Saved-deals list and profile/home consumers exclude `rejected` by default behind an "Include rejected" toggle (same convention as Pipeline).
2. **Move the card grid to the Saved tab.** The profile "Saved deals" card grid (the format Tyler likes) becomes the default view of `/saved`: photo card grid with a **prominent financials row — Cap rate, Upside, IRR (+ CoC where present) as the bold middle band of the card** (fields already returned by `/api/ui-v2/saved-deals`: `capRate`, `rentUpside`, `irrPct`, `cocPct`), price/units/$SF/score as the secondary line, View property / View docs / Unsave as the action row (R6.6 spacing). Keep the existing dense table as a Grid/Table toggle. Remove the saved-deals section (and its `section=saved-deals` nav special-casing) from Profile; profile keeps account/automation/assumptions/searches only.
3. AppShell: drop the `section === "saved-deals"` matcher logic that routed Profile's saved section under the Saved Deals nav item.

## R8 — FileDropzone primitive + intake restyle (new, from Tyler's review)

**Goal:** real drag-and-drop multi-file upload everywhere; the OM workspace intake looks like the rest of the app.

1. **`components/ui/FileDropzone.tsx`:** drop area (drag-over highlight, click to browse, `multiple`), **accumulates across selections** instead of replacing — verified bug: `deal-analysis/page.tsx:1851` `setPendingFiles(selectedFiles)` overwrites the previous selection — dedupes by name+size, per-file rows with size + remove ✕, max-files / max-bytes props with inline validation, disabled state while uploading. Keyboard/AT: the browse control stays a real `<input type="file">`.
2. **Adopt at every upload site:** deal-analysis intake (10-file OM package), property-sheet OM/Docs upload, Gmail-pull manual upload, LOI upload on the progress board, om-review re-uploads (R5).
3. **Deal-analysis intake restyle (Tyler's screenshot):** the "1. Add OM / financial files or link" section moves onto tokens — Panel cards, PageHeader-consistent section headings, the numbered-step kickers as `.text-eyebrow`, dropzone replacing the native input band, OM-link and broker-notes blocks as equal-rhythm cards. Behavior (analyze endpoints, separate-properties toggle, link import) unchanged.

---

## Sequencing (revised)

1. **R0** P0 fixes (board card layout, yield-map migration/ops + hardening + population).
2. **R7 + R8** — the direct UX asks (reject⇒unsave, saved consolidation, dropzone + intake restyle) and **R6** quick wins/spacing.
3. **R2** stepper + keyboard (no R1 dependency for these parts).
4. **R1** stage migration → then R2 staleness rules + R3 map.
5. **R4** trust labels → **R5** tear sheet.

Each phase lands as its own commit set; `npm run check` + web build green before each push; main stays releasable between phases.

## Open questions (none block R0–R8 starts)

- R6#2 hidden-route keep/kill calls.
- R3 map style preference (default: light OSM raster).
- R5 corrections: optional note (default) or required?
- R7: confirm "unsave on reject" should also apply to bulk rejects from the pipeline table (assumed yes).
