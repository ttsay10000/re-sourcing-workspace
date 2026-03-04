# Enrichment modules: DB write → API response → UI

Verification that each module writes to the DB and the UI reads the same paths.

## Data flow

1. **Backend** runs enrichment and calls `propertyRepo.updateDetails(propertyId, "enrichment.<key>", summary)` or `mergeDetails(propertyId, { ... })`.
2. **DB** stores this in `properties.details` (JSONB).
3. **API** returns `property.details` in `GET /api/properties` (list) and `GET /api/properties/:id` (single; detail view refetches this for fresh data).
4. **UI** (`CanonicalPropertyDetail`) uses `d = property.details` and `enrichment = d?.enrichment`, then reads the same keys.

---

## Module → DB path → UI source

| Module | Writes to (DB) | UI reads from |
|--------|-----------------|---------------|
| **Phase 1 (owner)** | `mergeDetails`: `ownerInfo`, `ownerModuleName`, `ownerModuleBusiness`, `taxCode`, `censusBlock2010` | `d.taxCode`, `d.censusBlock2010`, `d.ownerModuleName`, `d.ownerModuleBusiness` |
| **Permits** | `updateDetails("enrichment.permits_summary", …)`; `mergeDetails`: `bin` | `enrichment.permits_summary` (owner_name, owner_business_name); permit rows from `GET /api/properties/:id/enrichment/permits` |
| **Zoning (zoning_ztl)** | `updateDetails("enrichment.zoning", summary)` | `enrichment.zoning` (zoningDistrict1, zoning_district_1, zoningMapNumber, etc.) |
| **Certificate of occupancy** | `updateDetails("enrichment.certificateOfOccupancy", summary)` | `enrichment.certificateOfOccupancy` (status, issuanceDate, jobType) |
| **HPD Registration** | `updateDetails("enrichment.hpdRegistration", summary)` | `enrichment.hpdRegistration` (registrationId, lastRegistrationDate) |
| **HPD Violations** | `updateDetails("enrichment.hpd_violations_summary", summary)`; rows in `property_hpd_violations` | Summary in `enrichment.hpd_violations_summary`; rows from `GET .../enrichment/violations` |
| **DOB Complaints** | `updateDetails("enrichment.dob_complaints_summary", summary)`; rows in `property_dob_complaints` | Summary in `enrichment.dob_complaints_summary`; rows from `GET .../enrichment/complaints` |
| **Housing litigations** | `updateDetails("enrichment.housing_litigations_summary", summary)`; rows in DB | Summary in `enrichment.housing_litigations_summary`; rows from `GET .../enrichment/litigations` |
| **Affordable housing** | `updateDetails("enrichment.affordable_housing_summary", summary)`; rows in DB | Summary in `enrichment.affordable_housing_summary`; rows from `GET .../enrichment/affordable-housing` |

---

## UI sections

- **Enriched data (inline):** Tax code, Census block, CO, Zoning, HPD Registration — all from `property.details` (refetched via `GET /api/properties/:id` when the detail is expanded).
- **Owner information:** “Owner module: name, business” from `d.ownerModuleName`, `d.ownerModuleBusiness`; “Permit module: name, business” from `enrichment.permits_summary.owner_name`, `owner_business_name`.
- **Violations, complaints, permits table:** Rows from `GET .../enrichment/permits`, `.../violations`, `.../complaints`, `.../litigations` (normalized tables).

If a module runs and the NYC API returns rows, the backend writes to `details.enrichment.<key>` (and optionally normalized tables); the same property refetch returns updated `details`; the UI reads those keys. Empty or “—” in the UI means either the module did not run, the API returned no rows, or the property detail response was stale (the detail view refetches by id to avoid that).
