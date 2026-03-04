# Enrichment test scripts – no interference with actual system

## Isolation from real data

- **DB-backed test scripts** (`testEnrichmentForBBL.ts`, `testEnrichment18Christopher.ts`, `testEnrichmentBBL1013820133.ts`) create or reuse a **single property** identified by a **test-only canonical address** that always starts with `[TEST] `. Real properties created from listings (e.g. "428 West 19th Street, Manhattan, NY") never use that prefix, so `byCanonicalAddress` will never return a real property for these scripts. **These tests do not touch or overwrite real property data.**

- **No-DB scripts** (`fetchEnrichmentResultsPlain.ts`, `runEnrichmentLocal.ts`) call NYC Open Data (Socrata) only and print results. They do not read or write the database. **They cannot affect the actual system.**

- **Production CLIs** (`enrichAll.ts`, `enrichPermits.ts`) operate on real property IDs (or batch from the DB). They are intended for real runs; run them only when you mean to update real data.

## Same process as production

The **actual enrichment** used by the app is:

1. **Trigger:** e.g. "Add to canonical properties" → `POST /api/properties/from-listings` → `runEnrichmentForProperty(propertyId)` for each created property.
2. **Pipeline:** BBL resolution → Phase 1 (PLUTO owner + valuations tax code + cb2010) → permits (with cascade owner) → 7 modules (zoning, CO, HPD reg, HPD violations, DOB complaints, litigations, affordable housing) with shared `resolvedContext`.
3. **Data sources:** Same NYC Open Data datasets as in `fetchEnrichmentResultsPlain.ts` (PLUTO 64uk-42ks, valuations 8y4t-faws, zoning fdkv-4t4z, CO pkdm-hqz6, HPD reg tesw-yqqr, permits rbx6-tga4, violations wvxf-dwi5, complaints eabe-havv, etc.).
4. **Writes:** Results are written to `property.details` (and related tables like `property_permits`, `property_enrichment_state`, etc.); the app and API read from there.

So the **same process** (datasets, query logic, order) is used in production; the only difference is that production **persists** to the database and the **app displays** from that stored data. The plain fetch script mirrors the same API calls for quick local checks without the DB.

## Script summary

| Script | Uses DB? | Touches real data? |
|--------|----------|--------------------|
| `fetchEnrichmentResultsPlain.ts` | No | No – API only, stdout |
| `runEnrichmentLocal.ts` | No | No – API only, stdout |
| `testEnrichmentForBBL.ts` | Yes | No – uses `[TEST]` canonical address only |
| `testEnrichment18Christopher.ts` | Yes | No – uses `[TEST]` canonical address only |
| `testEnrichmentBBL1013820133.ts` | Yes | No – uses `[TEST]` canonical address only |
| `enrichAll.ts` / `enrichPermits.ts` | Yes | Yes – operate on real properties by design |
