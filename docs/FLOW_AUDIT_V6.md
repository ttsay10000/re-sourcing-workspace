# Enrichment / Rental Flow Audit (v6)

Answering the v6 product note: *"let's do an audit of what happens when
enrichment flow, rental flow runs and whether they are necessary from here."*

## When each flow runs

| Trigger | Enrichment | Rental flow | OM analysis | Dossier |
|---|---|---|---|---|
| `POST /api/properties/from-listings` (promote raw listings) | auto | auto | — | — |
| Pipeline "Refresh listings" composite | yes | yes | rows with OMs | yes (signals refresh) |
| `POST /api/properties/run-enrichment` (manual) | yes | — | — | — |
| `POST /api/properties/run-rental-flow` (manual) | — | yes | — | — |
| OM upload (workspace / property card / Gmail pull) | — | — | auto | auto-promote + signals |
| Render cron `process-inbox` | — | — | when replies carry OMs | — |

The "+ listing pull" toggle on the pipeline refresh gates the RapidAPI
StreetEasy re-pull (`refreshStreetEasy: false` skips it); the workflow step
records "Skipped (listing pull off)".

## What each flow actually does

**Enrichment** (`enrichment/runEnrichment.ts`): NYC Open Data (permits,
zoning, CofO, HPD registration/violations, DOB complaints, litigations,
affordable housing), Geoclient BBL/BIN resolution, neighborhood resolution
through the alias map, and — since the v6 geocode stage — syncing resolved
coordinates onto `properties.lat/lng` (the yield map and rental-analysis
matching depend on those).

**Rental flow** (`rental/`): RapidAPI rental endpoints probe StreetEasy
building/unit URLs for in-place rents, then the LLM extracts rental
financials; feeds LTR/MTR rent assumptions and `deal_signals` recompute.

## Are they still necessary?

- **Enrichment: yes, keep auto-on.** Geocodes, BBL, neighborhood, and
  compliance signals feed the yield map polygons, pipeline highlights,
  market-comp neighborhood resolution, and now rental-analysis target
  matching. Re-running is cheap (Socrata is free-tier; Geoclient is keyed)
  and idempotent.
- **Rental flow: keep, but it is the most expensive step** (RapidAPI per-call
  pricing + LLM extraction) and its marginal value is dropping as OM
  ingestion improves: when an analyzed OM with a rent roll exists, OM rents
  are authoritative and the StreetEasy probe mostly confirms them.
  Recommendation: keep auto-run on `from-listings` (no OM exists yet at that
  point — it is the only rent signal), but in the composite refresh skip the
  rental flow for properties whose authoritative OM already has a rent roll,
  the same way OM analysis only runs for rows with OMs.
- **The new Rental Analysis module does not replace the rental flow.** The
  rental flow estimates *the subject's own in-place/LTR rents*; rental
  analysis samples *competitor furnished (MTR) pricing* for rent
  assumptions. They meet in underwriting: LTR basis from rental flow / OM,
  MTR assumption sanity-checked against the competitor comp set.

## Cost / blast-radius notes

- Composite refresh on N rows: N × (Socrata batch + optional RapidAPI listing
  pull + rental probes) — the rental probes dominate cost. The per-OM
  Gemini/OpenAI extraction only re-runs when an OM exists.
- Both flows write `workflow_runs` + process banners, so every run is
  attributable in Activity Log; nothing runs silently.
