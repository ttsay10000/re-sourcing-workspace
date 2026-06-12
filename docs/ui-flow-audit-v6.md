# UI Flow + Presentation Audit — v6 final workstream

Scope: pages not covered by the v6 conversion commits (`crm`, `saved`, `om-review`, `add-property`, `profile`, `pipeline` shell, `broker-om/email-search`, `dossier-assumptions`, `dossier-success`, home quick check). Audited against Checklist A (flow: result visibility, stay-on-page + artifact links, destructive confirms, stale views) and Checklist B (presentation: bounded lists, numeric alignment/em-dash, contrast/borders, token conformance, type-scale snapping ≤1px only). All paths below are relative to `apps/web/src/app/`.

Conventions applied everywhere:
- Font sizes were snapped to `--text-*` tokens **only** when the delta was ≤1px; 0.82/0.84/0.85/0.86rem and the display sizes (1.35/1.45/1.65rem) sit >1px from any token and were left as-is (deliberate micro-hierarchy; a scale decision for the design-system owner, not this pass).
- Dark semantic text shades (`#15803d`, `#14532d`, `#166534`, `#92400e`, `#991b1b`) recur across pages for AA contrast on `--app-*-soft` backgrounds. globals.css has no dark-text tokens, so these are commented exceptions where touched, not replaced. **Suggested follow-up:** add `--app-green-text` / `--app-amber-text` / `--app-red-text` tokens and sweep (29 files).
- Brand-alpha accents (`rgba(15,118,110,X)`) were converted to `color-mix(in srgb, var(--brand) X%, transparent)` (identical output, token-derived).

---

## om-review

**Findings:** Solid baseline (dialog confirms, notices, reloads). Gaps: promoted runs vanish from the needs-review list with no path to the promoted tear sheet (A2); creating a review run from a broker attachment refreshed the queue but left the runs section stale (A4); promote/reject/retry act from mid-page cards while the notice renders at the top (A1); run list + attachment queue unbounded (B1); one ≤1px off-scale font.

**Fixed:**
- `om-review/page.tsx:125-129,318` — notice scrolls into view when set (covers all four actions).
- `om-review/page.tsx:196-206` — promote notice now carries an "Open property" link to `/pipeline?propertyId=…` (notice state widened to `ReactNode`; no handler changes).
- `om-review/page.tsx:281` — `createReviewRun` also refreshes the extraction-runs section (`await loadRuns()`); notice copy now says where the run appears.
- `om-review/omReview.module.css:78,210` — `.groupList`/`.runList` bounded at `60vh` + `overflow-y:auto`.
- `omReview.module.css` — `.itemSummary` 0.88rem → `var(--text-sm)`; `#15803d` notice text commented as exception; `.noticeLink` style added.

**Deferred:** none.

## saved

**Findings:** "Unsave" was destructive with no confirm, no success feedback, and swallowed errors (`catch {}` — a failed DELETE still removed the row) (A1/A3). Table view unbounded with non-sticky header (B1); `.numericCell` had tabular-nums but no right alignment (B2); ~15 ≤1px off-scale font sizes; grid-card nav buttons use `window.location.href` (full reloads).

**Fixed:**
- `saved/page.tsx:286-304` — unsave now confirms (`window.confirm`, names the address, notes the property stays in the pipeline), checks `response.ok`, sets a success notice or a visible error instead of silently swallowing. Call site passes the address (`page.tsx:545`).
- `saved/page.tsx:318-328,565-569` — opportunistic `useTableSort` + `SortableTh` on the table view (Property/Status/Score/Economics→price/Activity→updated); `filteredRows` was already memoized; ~25 lines.
- `saved/saved.module.css:322-324,331-335` — `.tableWrap` `max-height:70vh` + `overflow-y:auto`; `.table th` sticky with surface background.
- `saved.module.css:146-149,480` — `.numericCell` right-aligned; `.factLine` right-justified to match.
- `saved.module.css` — `.notice` (green) class added; 14 distinct ≤1px font values snapped to tokens (incl. exact matches 1.25rem→`--text-xl`); score-pill dark hexes commented.

**Deferred:**
- Grid-card "View property"/"View docs" buttons navigate via `window.location.href` (full page reload) while the table view uses `<Link>`. Converting Button+onClick to Link-wrapped buttons is a markup restructure of the card action row — left for a component pass.

## crm

**Findings:** Inline row actions — broker save, response record, reject — gave no success confirmation anywhere (button flips "Saving"→"Save", table silently reloads) (A1/A3-result). Reject has a proper `ConfirmDialog`; merge/send/template-delete have confirms and panel notices. Empty dates rendered "-" (hyphen) not "—" (B2). `tableScroll` had sticky `th` but no max-height, so the sticky header never engaged (B1). "Open" count column left-aligned (B2). Two brand-alpha literals; ~13 ≤1px off-scale font values.

**Fixed:**
- `crm/page.tsx:742,1623` — page-level success notice state + render (reuses `.notice`/`.notice_success`).
- `crm/page.tsx` (`handleSaveInlineBroker`, `handleSaveBrokerResponse`, `handleRejectPropertyFromCrm`) — each now sets a named confirmation ("Broker saved for 12 W 34th St.", "Responded response recorded for …", "Rejected … — the row stays visible with a Rejected flag.") before the existing `loadCrm()` refresh.
- `crm/page.tsx:198-216` — `formatDate`/`formatDateTime` empty value "-" → "—".
- `crm/page.tsx` — "Open" `th`/`td` in both tables get `styles.numericCell`.
- `crm/CrmPage.module.css:192-203` — `.tableScroll` `max-height:70vh` (sticky header now engages); new `.numericCell` (right-align + tabular-nums).
- `CrmPage.module.css:75,261` — `rgba(15,118,110,.13/.24)` → `color-mix(… var(--brand) …)`; 13 ≤1px font values snapped (incl. exact 1rem→`--text-md`, 1.55rem→`--text-2xl` at -0.8px).

**Deferred:**
- "Save draft for review" says the draft went to "the review-required queue", but **no page in the app lists outreach drafts** (`/api/ui-v2/outreach-drafts` is write-only from the UI; checked crm, pipeline, progress, activity, home). A link can't fix a surface that doesn't exist — needs a drafts queue view (or a section on Activity). Same gap affects pipeline's composer.
- Contact/merge panels keep showing the pre-mutation `contactPayload` after `loadCrm()` (panel snapshot isn't re-derived from fresh contacts). Re-keying the panel to live data is a state restructure.
- Property-label prefetch fires one `GET /properties/:id` per visible row (up to 200) for labels — an API/efficiency item, out of scope here.

## add-property

**Findings:** Strongest flow page in scope: per-import activity cards in the right rail already update live and link "Open property"/"Open analysis" per item; comp upload renders result links; notices carry artifact links when a single job is involved. Gap: multi-URL StreetEasy notices summarized counts with no pointer to the per-listing links sitting in the rail (A1/A2 discoverability, not a true dead end). Presentation: brand-alpha focus/outline literals, raw whites, off-token segmented-control track, ~11 ≤1px font values.

**Fixed:**
- `add-property/page.tsx` (`handleStreetEasySubmit`) — both multi-URL outcome notices now point at the Import activity panel ("Per-listing status and property links are in the Import activity panel." / "…open each one from the Import activity panel."). Copy-only.
- `add-property/page.module.css` — `rgba(15,118,110,.12/.4)` → `color-mix` brand accents; `rgba(82,82,91,.04)` → `color-mix(… var(--app-ink-secondary) 4%…)`; raw `#ffffff` (input gradient + 2 backgrounds) → `var(--app-surface)`; `#f1f5f7` segmented track commented as deliberate off-token cool gray; semantic pill hexes commented; 11 ≤1px font values snapped.

**Deferred:**
- Comp-upload "no match" path still requires manually re-picking a property and resubmitting the same file; an inline picker bound to the failed upload is a flow restructure.
- Canonical-property list for comp upload is fetched once per session and can go stale if properties are created elsewhere mid-session (refresh exists for saved searches but not for this list).
- Toggle focus outline at 40% brand alpha is marginal contrast — kept (now token-derived); bumping it is a globals-level focus-style decision.

## profile

**Findings:** All three top save actions (account, automation, assumptions) and "Generate standard leverage" succeeded silently — `setProfile(data)` with no confirmation (A1). "Delete" on saved searches had **no confirm** (A3). "Run now" notice said "Open Pipeline" with no link (A2). "Edit" populates a form that sits above the list, off-screen when clicking Edit on a lower card. CSS: white literal in input gradient, brand-alpha focus ring, `#fff` on brand hover, ≤1px font drift.

**Fixed:**
- `profile/page.tsx:462,510-514,557,600` — success notices for account / automation (notes when automation is paused) / assumptions / standard leverage; rendered via existing `.successBanner` next to the error banner (`page.tsx:919`).
- `profile/page.tsx:687,719` — delete now confirms with the search name and the consequence; success notice names what was deleted.
- `profile/page.tsx:663-676` — run-now notices link "Open Pipeline" → `/pipeline` and "run history" → `/runs` (state widened to `ReactNode`).
- `profile/page.tsx:614,1037` — Edit scrolls the populated form (`#saved-search-form`) into view.
- `profile/profile.module.css` — `.noticeLink` added; `#fff`→`var(--brand-on)`; gradient `#ffffff`→`var(--app-surface)`; focus ring rgba→`color-mix`; 0.88/0.68/0.8rem snapped to tokens.

**Deferred:** none.

## pipeline (PipelineClient.tsx + page.tsx + PipelinePage.module.css)

**Findings (flow — all restructure-level, documented only):**
- Outreach composer "queue" has no UI surface (same as CRM above) — `PipelineClient.tsx:~3360`.
- Merge property confirms via `window.confirm` but offers no pre-merge summary (docs/tags/OM state that will move) and no post-merge diff — `~2898-2938`.
- Bulk reject reports a count, not which properties; with rejected rows filtered out they vanish instantly — `~2940-2999`.
- Broker prompt save / deal-path save update the row + selected property but don't refetch dependent sheets — acceptable local-state model, flagged for the sheet-refresh pass — `~2648`, `~3090`.
- Existing affordances are good: global `.notice`/`.error` banners (`~3996-3997`) + ProcessBanner for async ops.

**Fixed (presentation only, zero logic):**
- `PipelinePage.module.css:769` — `rgba(15,118,110,0.42)` was an exact `--app-focus` match → `var(--app-focus)`.
- `PipelinePage.module.css:1730-1735` — `.highlightSection` declared `border-top` then overrode it with the `border` shorthand; redundant line removed (no visual change), wash color commented.
- 18 distinct ≤1px font values snapped to tokens file-wide (0.63–0.98rem family; 0.54/0.56/0.6/0.62/0.82/0.84/0.85/0.86/1.35/1.45rem left — all >1px off scale).

**Deferred (presentation):**
- `.tableShell` (`:362`) is unbounded vertically (`min-height:23rem`, `overflow-x:auto`). Bounding it would let the header stick, but the row-action menus and keyboard `scrollIntoView` logic (`PipelineClient.tsx:4175`) render inside the shell — adding a vertical scroll container risks clipping menus and breaking keyboard scrolling. Needs an interactive test, not a drop-in.
- `.enrichmentKeyRows` (`~2163`) unbounded inside the sheet — low priority, sheet itself scrolls.

## broker-om/email-search

**Findings:** Search/import/create all confirm and notice properly (import even confirms with a per-file category summary). Gaps: import success was a dead end — counts only, no path to the documents or to the extraction runs it queues (`runOmReview:true`) (A2); "Created/Matched property" notice had no link to the property (A2); after import the result rows still look importable (stale flags, A4 — see deferred). Presentation: unbounded row/candidate lists; off-palette `#ecfdf5` active segment; six raw whites; pills without tabular-nums.

**Fixed:**
- `email-search/page.tsx:454-471` — import notice now links "View property documents" (`/property-data?expand=…`, when scoped to a property) and "Track extraction in the review queue" (`/om-review`, when anything imported). Notice state widened to `ReactNode`.
- `email-search/page.tsx:503-510` — create/match notice links "Open property card".
- `email-search/page.module.css:268-271,376-380` — `.rowList` (70vh) and `.candidateList` (60vh) bounded.
- `page.module.css` — `#ecfdf5` → `var(--brand-soft)` (was off-palette emerald-50; delta imperceptible); raw whites → `var(--app-surface)` / `var(--brand-on)`; `.noticeLink` added; pills get `tabular-nums`; 0.76/0.78rem → tokens; slate `mutedPill` + dark notice text commented as exceptions.

**Deferred:**
- Imported rows aren't marked in the result list after import (selection is cleared but a re-import attempt is only caught server-side as "skipped"). Marking rows needs an imported-state field threaded through `searchResult` — a state restructure. Workaround is honest: the skip count reports it.

## dossier-assumptions

**Findings:** "Save as profile defaults" and "Generate standard leverage" succeeded silently — only errors surfaced (A1). "Generate dossier" intentionally hands off to `/dossier-success` with ProcessBanner + staged progress — correct A2 flow. CSS module fully tokenized already.

**Fixed:**
- `dossier-assumptions/page.tsx:133-134,239,338,420-422` — notice state + green `.notice` render; save-defaults notice explains future dossiers start from these values; standard-leverage notice names the applied values and points at the inputs it changed.
- `dossierAssumptions.module.css:100-109` — `.notice` class (mirrors `.error`, commented dark-green exception).

**Deferred:**
- The form body is built from inline `style={{…}}` objects with raw `#666`/`0.875rem` (off-token, outside module CSS). Converting ~25 inline-styled labels/sections to module classes is a real refactor — the page predates the design system and should be ported wholesale like deal-analysis was.

## dossier-success

**Findings:** Clean. Stays on page, busy states on both downloads, errors surfaced inline, artifact links present ("View property & documents", "Back to deal analysis"), missing-ID fallback explains where else to download. CSS fully tokenized. **No changes.**

## home (page.tsx — reference check)

**Findings:** Read-only dashboard (fetch + disclosure toggles, no mutations) with error surfacing — no flow gaps. Two raw `#ffffff` literals were exact `--app-surface`/`--brand-on` matches → replaced (`home.module.css:76,475`). Its hand-tuned font sizes were left untouched — it is the reference page and the same >1px family the rest of the app keeps.

---

## Cross-cutting items for the next pass
1. **Outreach drafts have no UI surface** (CRM + Pipeline composers both write to a queue nothing reads). Highest-leverage flow fix in this area.
2. **Dark-text tokens** for soft semantic backgrounds (`--app-green-text` etc.) to retire the commented hex exceptions.
3. **Type scale**: decide whether 0.82–0.86rem deserves a token (used ~40×) or should compress to `--text-xs`/`--text-sm` (>1px shifts, needs design sign-off).
4. **Pipeline `.tableShell` bounding + sticky header** behind an interactive test of row menus/keyboard nav.

Build: `npm run build -w @re-sourcing/web` ✓ (all 21 routes compile).

---

## Follow-up pass (2026-06-12)

All four cross-cutting items above are resolved on this branch:

1. **Outreach drafts queue surfaced** as a third **Drafts tab on /crm** (chosen over a standalone page or pipeline filter). API: `GET /api/ui-v2/outreach-drafts` (filters `metadata->>'kind' = 'ui_v2_outreach_draft'` so automation review batches stay out), `POST :id/send` (same prior-outreach force guard as send-now; send-phase failures stay listed as retryable "Send failed" rows), `POST :id/dismiss` (terminal `skipped` + `review_reason='dismissed_by_user'`, no migration needed — the status column has no CHECK constraint). Send-now and the queue now share one send path (`apps/api/src/sourcing/outreachDraftQueue.ts`, unit-tested) that marks the batch sent before bookkeeping, mirroring the automation sender. UI: send/dismiss behind ConfirmDialogs, "Review in composer" prefills the saved draft via a `draftPrefill` panel option, sixth metric card shows the queue depth. Drafts saved from the Progress page land in the same queue.
2. **Dark-text tokens** added (`--app-green-text: #15803d`, `--app-amber-text: #92400e`, `--app-red-text: #991b1b`) and swept across every text `color:` use of the six dark hexes; the commented exceptions are gone. Non-text uses (backgrounds, borders, box-shadows, `accent-color`) intentionally stay literal. Consolidation note: former `#166534`/`#14532d` greens lighten to the 700 shade; `#b45309` ambers darken to the 800 shade.
3. **Type scale**: the 0.82–0.86rem cluster got a token — `--text-xs-plus: 0.84rem` — and all 94 `font-size` declarations in the family now use it (≤0.32px shifts, no design sign-off needed). Padding/margin uses of the same values were left alone.
4. **Pipeline `.tableShell`** bounded to `70vh` with `overflow-y: auto`, matching the CRM convention; the existing sticky header/columns engage. Row menus are `position: fixed` with a capture-phase scroll listener that closes them, so two-axis scrolling is safe.

Also landed from the per-page deferred lists: email-search rows show an **Imported** pill after import (matched through `imported[].sourceMetadata` gmail ids — the uploaded-document id differs from the candidate row id); saved grid-card View property/View docs are real `Link`s in the table view's `actionStack` styling; pipeline merge confirm moved off `window.confirm` onto ConfirmDialog; bulk-reject notices name the first three addresses.

Still deferred: dossier-assumptions wholesale port, CRM contact/merge panel staleness after merges, pipeline broker/deal-path sheet refresh, `.enrichmentKeyRows` consolidation, display-size literals (1.35/1.45/1.65rem), auto-dismissing a queue draft after re-saving it from the composer (re-save currently creates a new row).
