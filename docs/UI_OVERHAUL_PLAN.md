# UI Overhaul Plan — Clean, Minimal, Modern Across Every Page

**Date:** 2026-06-09 · **Audited at:** commit `b7e3575` · **Status:** GO received 2026-06-10 — execution in progress on this branch.

> **Reconciliation with main @ `6bb66b2` (`UI_OVERHAUL_EXECUTION.md`):** shipped items there are not redone here (stage/geo migration 056, yield signals + MTR callouts, LOI flow, motion polish, progress-card readability pass, Yield Map). This plan's Phase A absorbs the WS6 foundation overlap: shared `apiFetch` (`apps/web/src/lib/api.ts`), orphan-route deletion (`/dedupe`, `/rental-analysis`, `/manual-entry`, `/agent-test`), "Gmail Pull" → "Find OMs in Email", and the ConfirmDialog/StageChip/KpiBox-equivalent primitives (named `ConfirmDialog`/`StageChip`/`StatCard`). Stage unification (B1) uses a shared *display* constant over saved-deal statuses (`packages/contracts/src/dealFlow.ts`, ids = deal-progress section ids); the migration-056 canonical pipeline stages remain WS7's concern. Per the brief, the Deal Progress columns are the canonical flow and the home funnel adopts them. WS7 board/tear-sheet, WS8 CRM v2, and WS9 map remain out of scope here.

**Brief (from product owner):** Homepage is the aesthetic anchor — readable, clean, mostly there. Deal Progress should adopt the same interface language (and the same stage columns the home funnel uses). Pipeline metrics are right but need data-sanity highlighting (e.g., LTR yield ≥ MTR yield in yellow), missing-broker-email and deal-stage visibility for fast scanning. The property workspace ("wizard") presents enrichment data in a jarringly different way than the top of the page, and no-OM states are a wall of ugly dashes. Deal Progress needs the most work: property photos, cleaner titles/centering/fonts, resized columns, popup/prompt-driven actions for high-velocity triage, and an LLM-generated "what to do next" box at the top. Profile needs visual/font cleanup. Then a final consistency pass across everything — clean, minimal, modern with cool highlights, in the spirit of the homepage and cap-rate-chronicle (modern grotesque type, data-forward cards, KPI highlight boxes) with Squarespace-like smoothness.

---

## Part 1 — Current-State Audit (verified, with citations)

### 1.1 The design system exists but is unevenly adopted

- `globals.css:1-103` defines a solid token set: Geist type scale (`--text-2xs`…`--text-4xl`), zinc neutrals, dark sidebar, teal accent `#0f766e` used sparingly, semantic green/amber/red/blue/purple, spacing + radius scale, light shadows. This *is* the homepage look the owner likes.
- Shared primitives exist (`components/ui/`: Button, Badge, Panel, ScoreGauge, ProgressStepper, EmptyState, IconButton) but adoption is low-to-moderate. Profile uses none of them; om-review and parts of the property workspace hand-roll everything.
- Magic font sizes everywhere: Profile alone uses 0.68 / 0.72 / 0.74 / 0.78 / 0.88 / 0.94 / 0.98 / 1.05 / 1.45rem (`profile/page.tsx:1536-2101`); progress cards use 0.68–0.75rem with weights 560–850 (`progress.module.css:467-1066`). The same visual role (section heading) renders at 3+ different sizes across pages.
- **Profile is a 2,188-line monolith with ~670 lines of `<style jsx global>` CSS** (`profile/page.tsx:1517-2180`) — the single worst consistency offender.
- Missing primitives that every page reinvents: page header (eyebrow/title/subtitle/actions), metric/stat tile (home, saved, profile, add-property each hand-roll one), filter bar, data table, key-value list, modal/popover.

### 1.2 Empty-value rendering is inconsistent and ugly

- Three competing formatters: home returns `"-"` (`page.tsx:128-138`), pipeline returns `"-"` (`PipelineClient.tsx` formatters), property workspace returns `"—"` em-dash (`CanonicalPropertyDetail.tsx:299`). No-OM properties show grids riddled with dashes (Deal Snapshot, Screening Highlights — `MARKET CAP —`, `MTR SPREAD —`) instead of one honest "no OM yet" state.

### 1.3 Pipeline (good bones, needs scan-ability)

- 21 columns, `min-width: 2240px`, 0.78rem font (`PipelinePage.module.css:374-380`). Sticky last column; NEW badge; price-cut/raise rendering already exist.
- **Yield sanity flag already half-built:** `row.underwriting.mtrCalloutCode` renders "Below LTR" (danger) / "Weak bump" (warn) chips (`PipelineClient.tsx:3448-3458`). It's a tiny text chip — not a cell highlight you can catch while scrolling.
- Broker email exists in row data (`row.broker.email`) and a "Has/Needs broker email" filter exists (`PipelineClient.tsx:3003-3010`), but **there is no visual missing-email indicator in the row** — you only find out when the Email button errors (`:2401-2406`).
- Deal-progress stage is in the row data (`row.dealPath.status`) but **not shown in any column**; the closest proxy is the "Flow" open-action count (`:631-635`).

### 1.4 Property workspace ("wizard") — two visual languages in one drawer

- Overview uses the `PropertyDetailWorkspace` tab + right status-rail layout with fact grids; the Enrichment tab abandons it for full-width vertical `V3ReportPanel` report sections **styled with inline `style={{…}}` objects** (`CanonicalPropertyDetail.tsx:3844-3918`). Switching tabs visibly changes the page's whole hierarchy — this is the "really weird way" the owner flagged.
- Deal Snapshot and Screening Highlights duplicate the same numbers (YOC MTR/LTR, ask) twice on one screen.
- Listing photos exist (`imageUrls` on the primary listing, `PropertyDetailCollapsible.tsx:92`) but the workspace header shows no photo, no hero.

### 1.5 Deal Progress — furthest from the target aesthetic

- 11 kanban columns (`SECTION_ORDER`, `progress/page.tsx:189-201`) vs. home's 8 funnel stages (`page.tsx:100-109`) — **two different stage taxonomies for the same funnel**; owner wants them unified (home's columns are the right ones).
- Cards are text-only mini-rows — **no photos** (the API's `ProgressRow` type at `progress/page.tsx:30-56` has no image field, though saved-deals payload already returns `firstImageUrl`).
- Actions are inline buttons ("Update inputs", "Reject") opening two big modals; broker email is parsed out of free-text `tourNotes` with a `Broker: {name}` regex (`:365-369`) — no first-class broker prompt, no email-broker or request-OM action on the card.
- Fixed `minmax(18.5rem, 21rem)` columns regardless of content (`progress.module.css:341-347`); 34rem max-height scroll wells; header is left-aligned with a wordy subtitle; `GenerateLoiButton` uses inline styles (`:2067-2099`).
- No task/recommendation surface — only an amber "tour completed" banner and an action-item count badge.

### 1.6 Home (anchor, light touch only)

- Already matches the target: tokenized type, stage strip, panel grid, soft hovers. Remaining nits: header meta alignment, stage-strip cells crowd at 8 columns on laptop widths, attention-group "Missing rental flow" count uses pipeline rows but lists progress rows (`page.tsx:386`), "Loading dashboard..." is a bare string instead of a skeleton, and nav has no grouping polish for sub-items.

### 1.7 Other pages

- Saved is clean module CSS; CRM is hybrid but mostly modular; add-property is decent; om-review uses inline `<style>` tags; Gmail Pull (broker-om/email-search) is plain but inoffensive. All need only the consistency pass (Phase D).

---

## Part 2 — Design Direction

**Anchor:** the existing homepage + token system. **Pull from:** cap-rate-chronicle (modern grotesque display type, data-forward KPI highlight boxes, generous whitespace, confident numerals) and Squarespace-style motion (smooth 150–200ms transitions, soft lifts, sections that breathe).

Principles, applied everywhere:

1. **One type scale, no magic numbers.** Every text node maps to a named role: `display` (page titles, `--text-3xl`/560), `section` (`--text-lg`/600), `eyebrow` (2xs/600/uppercase/tracked), `body` (sm), `metric` (display family, tabular numerals), `micro-label` (2xs muted uppercase). Enforced via shared classes, not per-page rem values.
2. **Numbers are the heroes.** KPI boxes use big tabular numerals on white cards with the colored top-border accent the home stat cards already use (`home.module.css:130-177`); labels are quiet uppercase micro-text.
3. **Teal is for interaction, semantic colors are for meaning.** Yellow/amber soft fills = data needs attention; red = broken/blocked; green = complete. Never decorative.
4. **Empty ≠ dash soup.** One empty-value system: muted styled `—` for genuinely-absent single values, "Add" affordances where the user can fix it inline, and a single friendly callout card when a whole section is empty for a known reason ("No OM yet — request it from the broker →").
5. **Photos make it real.** Property thumbnail (with letter-tile fallback, as home already does at `page.tsx:475`) on every card/row/drawer-header that represents a property.
6. **Act in place.** High-frequency actions are popovers/prompt dialogs anchored to where the user is — never a navigation away.
7. **Motion that earns its place.** Hover lift + border-tint (already on home stat cards), drawer slide, kanban drag ghosting, skeleton shimmer on load, sticky section headers. 150–200ms ease, respects `prefers-reduced-motion`.

---

## Part 3 — Workstreams

### Phase A — Foundation: tokens + primitives (everything else builds on this)

| # | Item | Detail | Files |
|---|---|---|---|
| A1 | Typography & spacing enforcement | Add role classes (`.text-display`, `.text-section`, `.text-eyebrow`, `.text-metric`, `.text-micro`) to `globals.css`; document the scale; add `--text-metric` sizes. No new fonts — Geist stays. | `globals.css` |
| A2 | `PageHeader` primitive | Eyebrow + title + subtitle + right-side meta/actions slot. Replaces hand-rolled headers on all 8 pages. | new `components/ui/PageHeader.tsx` |
| A3 | `StatCard` / `MetricTile` primitive | The home stat-card pattern (uppercase label, big numeral, accent top border, hover lift) extracted and reused (home strip, saved metrics, profile summary, progress summary). | new `components/ui/StatCard.tsx` |
| A4 | `KeyValueList` primitive | Label/value grid with built-in empty-value rendering (muted `—`, optional "Add" action, optional hide-when-empty). Kills the dash soup at the source. | new `components/ui/KeyValueList.tsx` |
| A5 | Central formatters | One `lib/format.ts` (currency, percent, number, date, em-dash empty) replacing the three competing copies (home `page.tsx:128`, PipelineClient, CanonicalPropertyDetail `:299`). | new `apps/web/src/lib/format.ts` |
| A6 | `Dialog` + `Popover` + `PromptMenu` primitives | Accessible (focus trap, esc, overlay), light-weight; `PromptMenu` = anchored quick-action list with optional inline input (used heavily by Deal Progress + Pipeline). | new `components/ui/Dialog.tsx`, `Popover.tsx` |
| A7 | `PropertyThumb` primitive | Image w/ letter-tile fallback + size variants; used by home rows, progress cards, pipeline rows, drawer hero. | new `components/ui/PropertyThumb.tsx` |
| A8 | `FlagChip` + cell-highlight tokens | Soft amber/red cell-fill classes + chip for data-sanity flags; one place defines what "suspicious data" looks like. | `globals.css` + `components/ui/Badge.tsx` |
| A9 | Skeleton loading + toast polish | Shared shimmer skeleton blocks; replace bare "Loading…" strings. | new `components/ui/Skeleton.tsx` |

### Phase B — Deal Progress overhaul (highest-impact page)

| # | Item | Detail | Files |
|---|---|---|---|
| B1 | **Unify stage taxonomy with home** | One shared `DEAL_STAGES` constant in `@re-sourcing/contracts` (home's 8 columns: Sourced → OM Requested → Underwriting → Tour Scheduled → Awaiting Inputs → LOI Sent → Negotiation → Contract Signed, + Closed/Rejected as terminal rails). Progress board renders these columns; the current 11 statuses map into them (e.g., both underwriting sub-states under "Underwriting" with a sub-badge). Home funnel + progress board + pipeline stage chip all read the same constant. | `packages/contracts`, `progress/page.tsx:189-292`, home `page.tsx:100-109` |
| B2 | **Card redesign with photo** | `PropertyThumb` + address + neighborhood line (home's `savedDealRow` anatomy), score pill, 3 key metrics max (Ask, YoC LTR/MTR), stage-specific status chip, workup badges. Same visual DNA as home's saved-deal rows. | `progress/page.tsx:1907-2006`, `progress.module.css` |
| B3 | **API: progress rows get photo + broker** | Extend `/api/ui-v2/deal-progress` rows with `firstImageUrl`, `neighborhood`, `borough`, `broker { name, email }` (all already available on the saved-deals/pipeline payloads server-side). Stop regex-parsing broker out of `tourNotes` (`:365-369`). | `apps/api/src/routes/savedProgressV2.ts` |
| B4 | **Actions become prompts/popovers** | Per-card `PromptMenu` (⌄ or right-click): Move to stage…, Email broker (opens composer; if email missing → inline add-email prompt that `PUT`s `/ui-v2/properties/:id/broker` — `pipelineV2.ts:1094`), Request OM, Confirm tour / add tour inputs, Generate LOI, Reject. Existing `DealPathModal`/`RejectDealModal` get restyled on the new `Dialog`. Built for "move a lot of properties fast": menu opens with single click, actions are one more click. | `progress/page.tsx:1532-1823` |
| B5 | **LLM "What to do next" box** | Clean card at top of the board: short prioritized list, e.g. "Confirm 2 tours (117 W 85th, 27 W 9th) · Email 5 brokers awaiting OM request · Add broker emails for 3 Chelsea listings · Review underwriting on 4 deals". Each item is a chip that filters the board / opens the bulk action. New endpoint `GET /api/ui-v2/deal-progress/recommendations`: builds a deterministic rule-based task list from board state (tours awaiting inputs, missing broker emails, OM-requestable, UW review pending), then has the existing OpenAI integration (same client as `dealScoringLlm.ts`) phrase + prioritize it; falls back to the rule-based list verbatim if the LLM call fails; cached ~10 min. | new `apps/api/src/deal/progressRecommendations.ts`, route in `savedProgressV2.ts`, UI card in `progress/page.tsx` |
| B6 | **Layout & typography cleanup** | `PageHeader` (same header anatomy as home), summary counts as `StatCard` strip, columns sized by content (`minmax(17rem, 1fr)` with collapsed empty stages rendered as slim rails), centered column titles with count pills, consistent 0.8rem card text, sticky board header. | `progress.module.css` |

### Phase C — Pipeline scan-ability + Property workspace cleanup

| # | Item | Detail | Files |
|---|---|---|---|
| C1 | Yield sanity highlighting | Promote `mtrCalloutCode` from a text chip to a **soft amber cell fill** on the YoC MTR cell (red-tinted for `mtr_below_ltr`), tooltip with the callout label; add client-side guards that flag LTR ≥ MTR, negative yields, and $/SF outliers (>3σ from visible rows) with the same `FlagChip` system. A small "data flags" filter joins the existing filter row. | `PipelineClient.tsx:3448-3458`, `PipelinePage.module.css` |
| C2 | Broker-email visibility | Amber `MailX` chip on rows where `!row.broker?.email`; clicking it opens the inline add-email prompt (same `PromptMenu` + `PUT /ui-v2/properties/:id/broker` as B4) instead of erroring on Email click. | `PipelineClient.tsx` |
| C3 | Stage column | New compact "Stage" chip column rendering the unified `DEAL_STAGES` stage from `row.dealPath.status` / `statusChip` so you can see deal-progress position while scrolling pipeline. | `PipelineClient.tsx` |
| C4 | Table scan polish | Slightly taller rows, sticky address column (left) alongside existing sticky actions (right), default-hidden long-tail columns behind the column picker, consistent right-aligned tabular numerals (exists — keep), unified empty `—`. | `PipelinePage.module.css` |
| C5 | Workspace hero header | One header above the tabs: `PropertyThumb` (first listing image), address + neighborhood chips, ScoreGauge, 4 KPI stat boxes (Ask, $/SF, YoC LTR, YoC MTR), action row (Edit data, Open OM Workspace, Email broker, Reject). Same component serves the pipeline drawer and `/property-data`. | `PropertyDetailWorkspace.tsx`, `CanonicalPropertyDetail.tsx` |
| C6 | Overview de-duplication + empty states | Merge Deal Snapshot + Screening Highlights into one KPI grid (each number appears once); description collapses behind "Read more"; when no OM: a single `EmptyState` callout ("No OM yet — Request from broker / Upload") replaces the dash-filled NOI/spread tiles; remaining absent values use `KeyValueList` muted treatment. | `CanonicalPropertyDetail.tsx` |
| C7 | Enrichment tab re-skin | Rebuild as a grid of module cards in the *same* visual language as Overview: card per module (Location, Tax, Owner, Zoning, …) with status pill, key fields via `KeyValueList`, "n fields · updated Jun 1" footer; summary strip (Complete · 10/10 modules) as a slim header band, not a giant panel; permits/violations/litigation stay one records table but inside a matching card. **All inline `style={{…}}` removed** (`CanonicalPropertyDetail.tsx:3844-3918`). | `CanonicalPropertyDetail.tsx` |

### Phase D — Profile + remaining pages + global consistency

| # | Item | Detail | Files |
|---|---|---|---|
| D1 | Profile restructure | Extract the 670-line `<style jsx global>` block to `profile.module.css`; rebuild with `PageHeader`, `StatCard` summary, `Panel` sections (Account, Email automation, Underwriting assumptions, Saved searches, Saved deals), shared `Button`/`Badge`; type roles from A1 — kills the 9-size font chaos. | `profile/page.tsx` |
| D2 | Home touch-ups | Nav: section label + active-state polish (already styled — verify sub-item rhythm), stage strip responsive wrap at <1280px, fix "Missing rental flow" count/rows mismatch (`page.tsx:386`), skeleton loading, align header meta baseline. | `page.tsx`, `home.module.css`, `globals.css` |
| D3 | CRM / OM Review / Gmail Pull / Saved / Add-property pass | Adopt `PageHeader` + primitives; om-review inline `<style>` → module css; Gmail Pull gets the standard header + panel rhythm; saved metrics → `StatCard`. No structural changes. | respective pages |
| D4 | Global sweep | Replace remaining hand-rolled buttons/badges/empty-states with primitives; one hover/transition standard; focus-visible audit; `prefers-reduced-motion`; kill dead font sizes; verify dark-sidebar contrast. | all |
| D5 | QA checklist | Per page: type roles only, no inline styles, no raw "-" placeholders, photos render w/ fallback, keyboard path through new prompts/dialogs, 1280/1440/1920 widths, loading + empty + error states. | — |

---

## Part 4 — Sequencing & sizing

1. **Phase A** (foundation) — ~1 session. Nothing user-visible breaks; primitives land unused then pages migrate.
2. **Phase B** (Deal Progress) — ~2 sessions incl. API additions + recommendations endpoint. Biggest visible win; exercises every new primitive.
3. **Phase C** (Pipeline + workspace) — ~2 sessions. C1–C4 are independent of C5–C7 and can ship separately.
4. **Phase D** (Profile + sweep) — ~1–2 sessions. D1 is mechanical but large; D4/D5 close it out.

Dependencies: B1 (shared stages) before B6/C3; A6 (Dialog/Popover) before B4/C2; A5/A4 before C6/C7/D1. Each phase is a separately shippable PR.

## Part 5 — Mapping back to the brief

| Owner note | Plan items |
|---|---|
| Home: mostly there; nav/font cleanup | A1, D2 |
| Deal Progress should match home's interface + columns | B1, B2, B6 |
| Pipeline: flag nonsense financials (LTR ≥ MTR in yellow), missing broker email, stage at-a-glance | C1, C2, C3 (+A8) |
| Wizard: enrichment presented weirdly vs top of page | C5, C7 |
| Wizard: no-OM dash soup | A4, A5, C6 |
| Progress: photos, cleaner titles/centering/fonts, resized columns | B2, B3, B6 |
| Progress: buttons → popups/prompts for high-velocity work (move deals, email brokers, add broker emails) | A6, B4 |
| Progress: LLM to-do/recommendation box at top | B5 |
| Profile visuals/fonts | D1 |
| Overall consistent, clean, minimal, modern w/ cool highlights (cap-rate-chronicle / Squarespace feel) | A1–A9, D4, D5 |

## Part 6 — Risks & non-goals

- **No framework changes:** stays Next.js + CSS modules + the existing token system; no Tailwind, no component library dependency, no font swap.
- **Density vs. prettiness:** pipeline stays dense (it's a scanning tool); highlights make it *faster* to scan, not airier. Progress cards get photos but stay compact (~88px).
- **LLM box degrades gracefully:** rule-based fallback means the panel always renders; LLM only improves phrasing/prioritization. Uses the API's existing OpenAI setup — no new keys.
- **Stage unification touches status mapping** (B1) — the one item that needs care: it's a *display* grouping change; underlying statuses don't migrate, so it's reversible.
- Reference site (cap-rate-chronicle.lovable.app) blocks automated fetching; direction above uses the characterization already in `docs/SOURCING_OS_UPGRADE_PLAN.md` ("modern grotesque type, data-forward cards, KPI highlight boxes") plus the owner's Squarespace cue. Screenshots of specific elements to emulate can be dropped into a follow-up if wanted.
