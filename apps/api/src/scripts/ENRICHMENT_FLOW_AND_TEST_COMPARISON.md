# Enrichment flow vs test script (BBL 1013820133)

## 1. Enrichment flow (same code path for API and test script)

Both the **API** (POST from-listings, POST run-enrichment) and the **test script** call `runEnrichmentForProperty(propertyId, undefined, options)`. Execution order:

| Step | What runs | Writes to |
|------|-----------|------------|
| 0 | Test script only: `mergeDetails({ bbl, bblBase, lat, lon })` | `details.bbl`, `details.bblBase`, `details.lat`, `details.lon` |
| 1 | `getBBLForProperty(propertyId)` | May mergeDetails: bbl, bin, bblBase, lat, lon (if from listing/Geoclient) |
| 2 | `runOwnerAndTaxCodeStep(propertyId, bbl, bblForQueries)` | `details.taxCode`, `details.censusBlock2010` (PLUTO/valuations) |
| 3 | `enrichPropertyWithPermits(propertyId, { cascadeOwner })` | `details.bin` (from permit rows if missing), `details.bblBase`, `details.enrichment.permits_summary` |
| 4 | Build `resolvedContext` from property (after permits) | In-memory only: bbl, bblForQueries, bin |
| 5 | **zoning_ztl** | `details.enrichment.zoning` |
| 6 | **certificate_of_occupancy** | `details.enrichment.certificateOfOccupancy` |
| 7 | **hpd_registration** | `details.enrichment.hpdRegistration` |
| 8 | **hpd_violations** | `details.enrichment.hpd_violations_summary` |
| 9 | **dob_complaints** | `details.enrichment.dob_complaints_summary` (needs BIN) |
| 10 | **housing_litigations** | `details.enrichment.housing_litigations_summary` |
| 11 | **affordable_housing** | `details.enrichment.affordable_housing_summary` |

Normalized rows (for UI tables) are written to DB tables: `property_permits`, `property_zoning_ztl`, `property_certificate_of_occupancy`, `property_hpd_registration`, `property_hpd_violations`, `property_dob_complaints`, etc.

---

## 2. Test script: what it reads vs where flow writes

| Test script output | Source | Written by |
|--------------------|--------|------------|
| BBL (tax) | `details.bbl` | Test pre-set or getBBLForProperty / permits |
| BBL (base) | `details.bblBase` | Test pre-set or getBBLForProperty / permits |
| Location | `details.lat`, `details.lon` | Test pre-set or getBBLForProperty / permits |
| Tax code | `details.taxCode` | runOwnerAndTaxCodeStep (Phase 1) |
| 2010 Census Block | `details.censusBlock2010` | runOwnerAndTaxCodeStep (Phase 1) |
| Owner (name/business) | `details.enrichment.permits_summary` | enrichPropertyWithPermits |
| CO status / date / job type | `details.enrichment.certificateOfOccupancy` | certificate_of_occupancy module |
| Zoning district 1/2, map number/code | `details.enrichment.zoning` | zoning_ztl module |
| HPD Registration ID / date | `details.enrichment.hpdRegistration` | hpd_registration module |
| Permits # | `PermitRepo.listByPropertyId(property.id)` | enrichPropertyWithPermits (property_permits table) |
| HPD violations # | `HpdViolationsRepo.listByPropertyId(property.id)` | hpd_violations module |
| DOB complaints # | `DobComplaintsRepo.listByPropertyId(property.id)` | dob_complaints module |

The test script re-fetches the property after enrichment (`propertyRepo.byId`), then reads `property.details` and the three repos. So it is reading exactly what the flow wrote.

---

## 3. Comparison checklist

- **Same entry point**: Test and API both use `runEnrichmentForProperty(propertyId, undefined, …)`.
- **Same BBL source**: Test pre-sets `bbl` and `bblBase`; flow does not overwrite them (merge with same values). So BBL 1013820133 is used consistently.
- **resolvedContext**: Built from `propertyAfterPermits` (property re-fetched after permits). So any `details.bin` set by permits is included for DOB complaints.
- **Gaps**: None. The test script reads every `details` and enrichment summary path that the flow writes for this BBL. It does not print every enrichment summary (e.g. dob_complaints_summary, housing_litigations_summary) but it does print the main ones (CO, zoning, HPD reg) and record counts for permits, violations, complaints.

---

## 4. How to run and compare

**Test script (single property, BBL 1013820133):**

```bash
DATABASE_URL='postgresql://...?sslmode=require' SOCRATA_APP_TOKEN='...' \
  npx tsx apps/api/src/scripts/testEnrichmentBBL1013820133.ts
```

**API (same flow, for any property):**

- From UI: “Re-run enrichment” → POST `/api/properties/run-enrichment` with body `{ propertyIds: [id] }`.
- Each property gets the same sequence: getBBLForProperty → Phase 1 → permits → 7 modules.

For the **same BBL** (1013820133), the only difference is how the property is created and whether BBL is pre-set:

- **Test**: Creates/uses property with canonical address `[TEST] BBL 1013820133, Manhattan, NY` and pre-sets `bbl`, `bblBase`, `lat`, `lon`. No listing.
- **API (from-listings)**: Property is created from a listing; BBL may come from listing extra or from Geoclient/permit resolution.

So for a property that already has `details.bbl = "1013820133"` (and optionally `bblBase`, `bin`), re-run enrichment uses the same flow as the test and should produce the same enrichment data for that BBL. Comparing results means: run the test script, note the printed “Data points” and “Record counts”; then in the UI, open a canonical property with the same BBL after re-run enrichment and confirm the same CO, zoning, HPD reg, and (if BIN is set) DOB complaints.
