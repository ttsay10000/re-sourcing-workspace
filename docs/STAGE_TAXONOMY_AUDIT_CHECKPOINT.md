# Stage Taxonomy Audit Checkpoint

Status: implemented in this pass.

Decision captured: use the Deal Progress stages as the single visible app-wide deal taxonomy. Legacy status routes remain as compatibility adapters while new stage-first surfaces use `DealFlowStageId`.

## Current Taxonomies Found

| Taxonomy | Where it lives | Current purpose | Issue |
| --- | --- | --- | --- |
| Deal Progress display stages | `packages/contracts/src/dealFlow.ts` (`DEAL_FLOW_STAGES`) and `apps/web/src/app/progress/page.tsx` | Board columns and stage move labels | Desired visible taxonomy, but not the persisted app-wide source of truth yet. |
| Coarse persisted deal stage | `properties.deal_stage`, `packages/db/src/repos/StageTransitionRepo.ts` | Stage history and aging | Uses `inbox/screening/pursuing/outreach/om_review/underwriting/tour/offer_loi/contract_dd/closed`, which is not the Deal Progress taxonomy. |
| Lifecycle state | `properties.deal_state` | Active/dead/closed state | Good conceptually; should remain lifecycle-only. |
| Pipeline UI status | `details.pipeline.uiV2Status`, `UiV2PipelineStatus` | Pipeline chips, filters, selectors, Deal Progress derivation | Overlaps heavily with Deal Progress stage IDs and includes terminal/rejection values. |
| Legacy pipeline status | `details.pipeline.status` | Older pipeline compatibility and imports | Still read/written in several adapters. |
| Saved deal status | `saved_deals.deal_status` | Saved-list/profile status | Small taxonomy (`new/interesting/saved/dossier_generated/rejected`) overlaps with stage. |
| Deal path status | `details.pipeline.dealPath.status` | Tour/LOI subworkflow | Some values auto-write Pipeline UI status. Should become activity/substate, not top-level stage. |

## Proposed Canonical Stage IDs

Use these Deal Progress stage IDs everywhere visible and in new stage APIs:

- `sourced`
- `om_requested`
- `underwriting_awaiting_review`
- `underwriting_review_completed`
- `tour_requested`
- `tour_scheduled`
- `tour_completed_awaiting_inputs`
- `drafting_loi`
- `loi_sent_awaiting_response`
- `negotiation`
- `contract_signed_diligence`
- `deal_closed`

Lifecycle state remains separate:

- `active`
- `dead`
- `closed`

## Proposed Backfill Rules

| Current signal | Proposed Deal Progress stage | Proposed lifecycle state | Notes |
| --- | --- | --- | --- |
| `uiV2Status = new/screening/interesting` | `sourced` | `active` | Early sourced deal. |
| `uiV2Status = saved` with no OM/underwriting evidence | `sourced` | `active` | Saved should be a marker, not automatically underwriting. |
| `uiV2Status = outreach/awaiting_broker`, legacy `om_requested`, or OM request event | `om_requested` | `active` | Broker outreach/OM requested. |
| Has OM evidence but no completed underwriting review | `underwriting_awaiting_review` | `active` | OM uploaded/promoted, dossier generated, or manual underwriting source exists. |
| User marks underwriting reviewed/completed | `underwriting_review_completed` | `active` | Needs explicit review action. |
| Tour requested but not scheduled | `tour_requested` | `active` | May need a new explicit signal if not present today. |
| Deal-path tour date set | `tour_scheduled` | `active` | Deal path remains substate/details. |
| Deal-path tour completed and inputs pending | `tour_completed_awaiting_inputs` | `active` | Same visible stage name already exists. |
| LOI drafting/offered candidate | `drafting_loi` | `active` | Current `offer_candidate` and legacy `offer_review` map here. |
| LOI sent and awaiting response | `loi_sent_awaiting_response` | `active` | Legacy `loi_sent` maps here. |
| Negotiation in progress | `negotiation` | `active` | No change conceptually. |
| Contract signed/diligence | `contract_signed_diligence` | `active` | Requires signed contract upload plus escrow timing in Deal Progress. |
| Closed deal | `deal_closed` | `closed` | Stage and state both update. |
| Rejected/pass/archive-as-dead | `sourced` fallback with disposition metadata | `dead` | Rejection/archive becomes lifecycle/disposition metadata, not a stage. |

## Current Action Audit

| Current action/trigger | Current source taxonomy | Current read/write | Proposed target Deal Progress stage/state | Auto-move or log only? | Review decision |
| --- | --- | --- | --- | --- | --- |
| Pipeline status selector | `uiV2Status` and legacy `pipeline.status` | `apps/web/src/app/pipeline/PipelineClient.tsx` calls `/api/ui-v2/properties/:id/status`; `apps/api/src/routes/pipelineV2.ts` writes `details.pipeline.uiV2Status`, legacy status, saved-deal status in some cases, rejection rows, and `recordDealStageChange` | Replace visible selector with Stage selector backed by Deal Progress IDs; adapter maps old statuses temporarily | Auto-move stage when user selects stage | Implemented or adapter retained |
| Pipeline reject action | `uiV2Status = rejected`, legacy `rejected_removed`, `property_rejections` | `/status` and `/reject` write rejection metadata, previous status, saved-deal rejection | Keep current stage, set `deal_state = dead`, add rejection disposition metadata | Auto-change lifecycle state only; log rejection | Implemented or adapter retained |
| Pipeline restore action | previous `uiV2Status`/legacy status | `/restore` restores previous UI status and calls `recordDealStageChange` | Restore `deal_state = active`; stage should return to previous active Deal Progress stage or `sourced` fallback | Auto-change lifecycle state and restore stage | Implemented or adapter retained |
| Pipeline save/watchlist action | saved-deal status and `uiV2Status = saved` | `/save` writes `saved_deals.deal_status = saved`, pipeline saved tag/status, and records canonical stage `pursuing` | Keep saved as marker; proposed stage `sourced` unless OM/underwriting evidence exists | Log saved; do not auto-move beyond `sourced` | Implemented or adapter retained |
| Pipeline bulk reject | `uiV2Status = rejected` | Pipeline client loops/bulk calls status/reject behavior | Same as reject action | Auto-change lifecycle state only; log each rejection | Implemented or adapter retained |
| Pipeline deal-path form save | deal-path status plus derived `uiV2Status` | `/deal-path` derives `tour_scheduled`, `tour_completed_awaiting_inputs`, `offer_review`, or rejection | Deal path remains details; stage changes only when status implies `tour_scheduled`, `tour_completed_awaiting_inputs`, `offer_review`, or dead rejection | Auto-move for concrete tour/offer milestones; log other edits | Implemented or adapter retained |
| Deal Progress card "move to stage" | `DEAL_FLOW_STAGES.targetStatus` -> `uiV2Status` | `apps/web/src/app/progress/page.tsx` calls `/status` with target status | Call `/stage` with Deal Progress stage ID after API is updated | Auto-move stage | Implemented or adapter retained |
| Deal Progress tour scheduled action | deal-path status and `uiV2Status = tour_scheduled` | Progress page patches deal-path then status | `tour_scheduled` | Auto-move stage after date is set | Implemented or adapter retained |
| Deal Progress complete tour action | deal-path status and stage route | Progress page patches deal-path then `/stage` | `tour_completed_awaiting_inputs` unless post-tour decision advances to `drafting_loi` or `dead` | Auto-move based on selected decision | Implemented |
| Deal Progress LOI draft action | Deal Progress stage | Progress page deal-path prompt and `/stage` | `drafting_loi` | Auto-move when draft details are saved | Implemented |
| Deal Progress LOI sent action | Deal Progress stage | Progress page deal-path prompt/upload and `/stage` | `loi_sent_awaiting_response` | Auto-move when sent context/upload is saved | Implemented |
| Deal Progress contract action | Deal Progress stage | Progress page requires contract upload and escrow timing, then `/stage` | `contract_signed_diligence` | Auto-move after gate is satisfied | Implemented |
| Deal Progress reject modal | `uiV2Status = rejected` | Progress page calls status/reject behavior | Keep last active stage, set `deal_state = dead` | Auto-change lifecycle state only; log rejection | Implemented or adapter retained |
| Deal Progress grouping | Derived from `uiV2Status`, saved-deal status, deal-path, OM facts | `apps/api/src/routes/savedProgressV2.ts` maps rows into sections | Read persisted Deal Progress stage first; use facts only for backfill/repair recommendations | Read-only grouping after migration | Implemented or adapter retained |
| Deal Progress recommendations | Deal Progress section IDs | `apps/api/src/deal/progressRecommendations.ts` consumes section IDs from current grouping | Continue using Deal Progress stage IDs | Log/recommend only; no auto-move | Implemented or adapter retained |
| Existing `/api/ui-v2/properties/:id/stage` route | Coarse `properties.deal_stage` | `pipelineV2.ts` accepts `StageTransitionRepo.DEAL_STAGES`, not Deal Progress stage IDs | Replace/promote to Deal Progress stage API, or add new route that accepts `DealFlowStageId` | Auto-move when explicitly called | Implemented or adapter retained |
| Existing `/stage-history` route | Coarse `stage_transitions` | Reads current transition table | Keep route but transition rows should record Deal Progress stage IDs after migration | Read-only | Implemented or adapter retained |
| `recordDealStageChange` helper | Status-to-coarse-stage map | Many callers pass status strings; helper writes coarse `properties.deal_stage` | Replace with `recordDealFlowStageChange` accepting Deal Progress stage ID and lifecycle state | Auto when caller passed an explicit stage; adapter for old statuses | Implemented or adapter retained |
| CRM "mark OM requested" | legacy/status helper | `apps/api/src/routes/crmV2.ts` writes OM-requested/outreach-style state | `om_requested` | Auto-move when OM request is sent/queued | Implemented or adapter retained |
| Generated email copy requesting OM/market comps | Not a status, but related event | CRM/properties routes create copy and outreach events | Usually `om_requested` only when sent/queued, not draft creation | Log only until sent/queued | Implemented or adapter retained |
| Import from saved searches/listings | legacy `pipeline.status = new_sourced`, `uiV2Status = new` | `apps/api/src/importV2/importJobs.ts` and import/sourcing routes initialize pipeline state | `sourced` | Auto-set initial stage | Implemented or adapter retained |
| Dedupe merge/archive duplicate | `uiV2Status = archived` and legacy status | Pipeline merge archives duplicate/source row | If archival means duplicate/non-active, set `deal_state = dead` with duplicate disposition; do not use `deal_closed` | Auto lifecycle/disposition only | Implemented or adapter retained |
| Generated dossier completed | `uiV2Status = dossier_generated`, saved-deal status sometimes `dossier_generated` | Dossier/workbook routes and generated document flows record docs/events | Proposed `underwriting_awaiting_review` if no explicit review completed; `underwriting_review_completed` only on user review action | Auto-move to awaiting review; log generation | Implemented or adapter retained |
| OM upload/extraction promoted | OM ingestion status (`needs_review/promoted`) plus document categories | OM routes/promoted snapshots feed progress grouping | `underwriting_awaiting_review` when authoritative OM becomes available | Auto-move if deal is active and not beyond underwriting | Implemented or adapter retained |
| Broker comp package approved/promoted | package status/review status | Broker comp routes store packages/items | Usually log only; should not move stage unless it creates first underwriting evidence and user wants it | Log only by default | Implemented or adapter retained |
| Saved profile deal status update | `saved_deals.deal_status` | `apps/api/src/routes/profile.ts` and saved-deal APIs update saved list status | Keep as saved-list metadata; do not drive visible stage except legacy adapter/backfill | Log only | Implemented or adapter retained |
| Home/dashboard funnel counts | Currently mixed saved/status/stage derivations | Dashboard likely reads pipeline/progress counts | Read Deal Progress stage and lifecycle state | Read-only | Implemented or adapter retained |
| Yield Map stage/source labels | `deal_stage`, `deal_state`, status chip/source values | `apps/api/src/routes/comps.ts` returns stage/state; Yield Map displays stage/source | Return Deal Progress stage label/chip; exclude `dead` unless restore surface | Read-only | Implemented or adapter retained |
| Activity timeline stage events | coarse stage transition events and pipeline status events | `PropertyPipelineEventRepo` entries include status/stage_changed metadata | Events should name Deal Progress stage transitions and lifecycle dispositions separately | Log only, except paired with explicit stage action | Implemented or adapter retained |

## Proposed API Migration

| Interface | Proposed behavior |
| --- | --- |
| `GET /api/ui-v2/deal-progress` | Return rows grouped by persisted Deal Progress `stage`, with backfill hints only for records missing stage. |
| `POST/PATCH /api/ui-v2/properties/:id/stage` | Accept `stage: DealFlowStageId`, optional `state: active/dead/closed`, `reason`, `source`, `actorName`; update stage and lifecycle state. |
| `GET /api/ui-v2/properties/:id/stage-history` | Return Deal Progress stage transitions after migration; include legacy coarse history as compatibility metadata if needed. |
| Old `/status` routes | Keep temporarily as compatibility adapters. Map old status strings to Deal Progress stage/state, write stage event, and return deprecation metadata. |
| Query params | Add `stage`, `stageIn`, `stageNotIn`, and `includeDead/includeClosed`; deprecate UI-facing `status`. |

## Approval Decisions Applied

1. `saved` stays in `sourced` unless OM/underwriting evidence or explicit user stage movement says otherwise.
2. Generated dossier completion auto-moves active deals into underwriting awaiting review.
3. Broker comp approval does not move stage; it enriches comps and market analysis.
4. Archive is `deal_state = dead` with archived/rejected disposition metadata and remains recallable from Pipeline.
5. `tour_requested` is a first-class manual Deal Progress stage.
