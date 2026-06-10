# UI Overhaul — Execution Setup

**Status: ARMED — do not execute until Tyler gives an explicit GO.**
**Prepared:** 2026-06-10 · **Baseline:** consolidated main (all session branches merged, `npm run check` 238/238 green, web build green).

This doc stages the UI overhaul defined in `SOURCING_OS_UPGRADE_PLAN.md` Part 2 §D–G (workstreams **WS6 · WS7 · WS8**, plus the WS9 map view where it touches the board). It records what already shipped so execution starts from reality, not from the June 9 audit snapshot.

---

## 1. Already shipped since the audit (do NOT redo)

| Plan item | Status | Where |
|---|---|---|
| Canonical stage model (§C / WS1) — `deal_state`/`deal_stage`/`stage_order`/`stage_entered_at` + `stage_transitions` + lat/lng columns | ✅ Shipped | `packages/db/migrations/056_deal_stage_and_geo.sql`, `StageTransitionRepo.ts`, stage API in `pipelineV2.ts` |
| LTR/MTR yield signals + pipeline spread/callouts + `minLtrYoc` filter | ✅ Shipped | `apps/api/src/deal/yieldSignals.ts`, pipeline API/table |
| Deal score flags ("Why this score") in pipeline detail | ✅ Shipped | `pipelineV2.ts`, `PipelineClient.tsx` |
| LOI generation (endpoint + PDF builder + progress-board wiring) | ✅ Shipped | `savedProgressV2.ts`, progress board |
| CRM quick wins C5 (email-wipe on save) + C9 (reject reason) | ✅ Shipped | commit `74e8ebf` |
| `npm run check` build-order fix | ✅ Shipped | root `package.json` |
| Pipeline empty state | ✅ Shipped | `PipelineClient.tsx` |
| Motion polish (smooth scroll, entrance fades, micro-transitions) | ✅ Shipped | `globals.css` + pages |
| Yield Map (living comps DB view) + OM workspace link | ✅ Shipped | `apps/web/src/app/yield-map/page.tsx`, `apps/api/src/routes/comps.ts` |
| Batch separate-properties OM analysis with per-file review | ✅ Shipped | `deal-analysis` page + API |
| Inbox-wide Gmail pull with lookback window | ✅ Shipped | `brokerOm.ts`, `broker-om/email-search` |
| Pipeline full-refresh buttons (yields/OM/dossier/listing flags) | ✅ Shipped | `pipelineV2.ts`, `properties.ts`, `PipelineClient.tsx` |
| Progress-board card readability pass | ✅ Shipped | `progress.module.css` |

## 2. Confirmed still outstanding (the overhaul itself)

- **Design system (§G / WS6):** token/type swap in `globals.css` (grotesque type, `tabular-nums` metrics), shared **KpiBox / PropertyCard / StageChip / AgingChip / ConfirmDialog** components, real sort arrows, proper close buttons.
- **Shell sweep (§G / WS6):** delete orphan routes `/dedupe`, `/rental-analysis`, `/manual-entry`, `/agent-test`; nav restructure; single `apiFetch` util — `API_BASE` is still hand-rolled in 10+ files (`AppShell.tsx`, `crm/page.tsx`, `PipelineClient.tsx`, `progress/page.tsx`, `deal-analysis/page.tsx`, `profile/page.tsx`, `dossier-*`, `HealthBlock.tsx`, `page.tsx`); "Gmail Pull" → "Find OMs in Email" rename.
- **Board/Tear sheet/Detail (§B §D §E / WS7):** Table/Board/Map toggle over one result set; kanban by `deal_stage` (stage API already live — board consumes it); tear-sheet screen replacing om-review; property detail tabs (Overview · Financials · Documents · Brokers · Activity); aging chips from `stage_transitions`; M6 cap-rate basis labels; M8 "NOI override active" banner.
- **CRM v2 (§F / WS8):** read-first rows, "Needs attention" queue lens, server-side pagination + summary stats + dup suggestions (kills C2/C3/C8), no resort-on-save (C4), one composer with property chooser (C6/C7).
- **Map view (WS9, board slice):** lat/lng backfill + Geoclient geocode worker, MapLibre pins colored by stage, table fallback. Columns already exist in 056.

## 3. Execution order (when GO is given)

Each phase lands as its own PR-sized unit; `npm run check` + web build must be green before merge; main stays releasable between phases.

1. **Phase A — WS6 foundations** (no behavior change): tokens/type in `globals.css`; shared components (`KpiBox`, `PropertyCard`, `StageChip`, `AgingChip`, `ConfirmDialog`, sort-arrow); `apiFetch` util + adopt everywhere; orphan-route deletion; Gmail Pull rename.
2. **Phase B — WS7 board & detail**: pipeline Table/Board toggle (board = kanban over stage API, new card anatomy, aging chips, column count/$ /median-YoC headers); property detail tabs; tear sheet on extraction runs (om-review upgrade: edit-before-promote, field confidence, Retry); M6/M8 surface fixes.
3. **Phase C — WS8 CRM v2**: server endpoints first (summary stats, paginated list w/ embedded labels, server dup suggestions), then read-first rows + queue lens + stable saves + unified composer.
4. **Phase D — WS9 map slice**: geocode worker + backfill, Map toggle with MapLibre (no key needed), stage-colored pins, fallback list.
5. **Phase E — sweep & regression**: empty states everywhere, dialog/confirm consistency, monolith decomposition opportunistically as each surface is touched; full `npm run check` + manual E2E (upload → tear sheet → pursue → board drag → CRM outreach).

Dependencies honored: A unblocks B/C (shared components); C's API work can start parallel to B; D needs nothing from B/C beyond the toggle shell.

## 4. Pre-flight checklist (verified at setup)

- [x] All parallel-session branches merged into main; no unmerged work left on remote.
- [x] `npm run check` — 50 files / 238 tests passing; contracts, db, api compile.
- [x] `apps/web` production build green.
- [x] Stage API + `stage_transitions` live (board/aging have a backend to consume).
- [x] No `codex/*` branches remain (audit's coordination risk is gone).
- [ ] **GO from Tyler** — execution starts only on explicit instruction.

## 5. Notes for the executing session

- cap-rate-chronicle visual specs are directional until screenshots are shared — ask for them at GO time if pixel-fidelity matters.
- `PipelineClient.tsx` (~5.4k lines), `crm/page.tsx` (~3.3k after consolidation), `OmCalculationPanel.tsx` (~3.2k): decompose only the parts each phase touches; no big-bang rewrites.
- Migration numbering: next free slot is `057`.
