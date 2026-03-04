# Certificate of Occupancy (CO) flow

## Where CO appears

- **API / DB:** `property.details.enrichment.certificateOfOccupancy`
- **UI:** Property Data → Canonical property → "Enriched data" → "Certificate of occupancy", "CO issuance date", "CO job type"

## End-to-end flow

1. **Trigger**  
   Full enrichment (e.g. "Add to canonical properties" or run all modules). CO runs as one of the 7 modules after Phase 1 and permits.

2. **Module**  
   `certificateOfOccupancy.ts` (dataset **pkdm-hqz6**):
   - Resolves BBL (from `resolvedContext` in full run, or `getBBLForProperty` + `bblForQueries` when running alone).
   - SoQL: `bbl = '${bblForQueries}'` (dataset **BBL column is text**; string query is correct).
   - Select: `bbl, bin, job_type, c_of_o_status, c_of_o_filing_type, c_of_o_issuance_date, number_of_dwelling_units`.
   - Takes the first row (ordered by `c_of_o_issuance_date DESC`).

3. **Write**  
   - If there is a row: upserts into `certificate_of_occupancy` table.
   - **Always** calls `propertyRepo.updateDetails(propertyId, "enrichment.certificateOfOccupancy", summary)`:
     - `summary = { jobType, status, filingType, issuanceDate, dwellingUnits, lastRefreshedAt }`.
     - When the API returns **0 rows**, `summary` has `jobType: null`, `status: null`, `issuanceDate: null`, etc., and `lastRefreshedAt: now`.
   - Updates `property_enrichment_state` for `certificate_of_occupancy` (`lastSuccessAt`, `statsJson.rows_fetched`).

4. **UI read**  
   `CanonicalPropertyDetail.tsx` reads `enrichment?.certificateOfOccupancy` and:
   - `coStatus` = `co?.status ?? co?.c_of_o_status`
   - `coDate` = `co?.issuanceDate ?? co?.issuance_date ?? co?.c_of_o_issuance_date`
   - `coJobType` = `co?.jobType ?? co?.job_type`  
   So the Enriched data section always shows the three CO lines; values are "—" when those fields are null, and the hint "From certificate_of_occupancy enrichment (BBL). Run enrichment to populate." when there is no data.

## When CO shows "—"

- **0 rows from API** for that BBL. Dataset pkdm-hqz6 only has COs issued since July 2012; not every BBL has a row.
- **Example:** BBL 1013820133 was checked via the resource API; the CO dataset returned 0 rows, so for that property the section appears but status/date/job type show "—".

## Checklist if CO never shows data

1. Confirm BBL is set and correct for the property (`details.bbl`, and for condos `details.bblBase` / `bblForQueries`).
2. Call `GET /api/properties/:id/enrichment/state` and check `certificate_of_occupancy`: `lastError` (if any), `lastSuccessAt`, `statsJson.rows_fetched`.
3. If `lastSuccessAt` is set and `rows_fetched === 0`, the dataset has no CO for that BBL; the flow is working, data is missing in the source.
4. If you have a BBL that you know has a CO in DOB, run enrichment for that property and confirm the three CO fields populate.
