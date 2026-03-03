# Enrichment write audit – logic flow and clashes

Trace of all writes to `properties.details` from run phase through canonical enrichment. Used to verify no path is written by multiple steps in a conflicting way.

---

## 1. Execution order (full run, no `moduleName`)

```
getBBLForProperty(propertyId)
  → may mergeDetails: bbl, bin, bblBase, lat, lon (top-level only)

runOwnerAndTaxCodeStep(propertyId, bbl, bblForQueries)
  → PLUTO (owner), valuations 8y4t-faws (tax code), HPD skip
  → mergeDetails: taxCode (top-level only)
  → does NOT write enrichment.*

enrichPropertyWithPermits(propertyId, { cascadeOwner })
  → may mergeDetails: bbl, bin, lat, lon (when resolving from listing)
  → may mergeDetails: bbl, bin (when resolving from permit address)
  → mergeDetails: bblBase (when has BBL)
  → updateDetails("enrichment.permits_summary", mergedSummary)  // only writer of this path

for each of ENRICHMENT_MODULES:
  zoning_ztl         → updateDetails("enrichment.zoning", summary)
  certificate_of_occupancy → updateDetails("enrichment.certificateOfOccupancy", summary)
  hpd_registration   → updateDetails("enrichment.hpdRegistration", summary)
  hpd_violations     → updateDetails("enrichment.hpd_violations_summary", summary)
  dob_complaints     → updateDetails("enrichment.dob_complaints_summary", summary)
  housing_litigations → updateDetails("enrichment.housing_litigations_summary", summary)
  affordable_housing → updateDetails("enrichment.affordable_housing_summary", summary)
```

---

## 2. Write semantics

- **mergeDetails(merge)**  
  `details = details || merge` (JSONB concatenation). Only **top-level** keys in `merge` are set; each key in `merge` overwrites that key in `details`. So `mergeDetails(id, { taxCode: "1" })` only sets `details.taxCode` and leaves `details.enrichment`, `details.bbl`, etc. unchanged.  
  **Never** pass `{ enrichment: { ... } }` – that would replace the entire `enrichment` object and wipe other modules’ data.

- **updateDetails(path, value)**  
  `jsonb_set(details, path, value, true)`. Only the **leaf** at `path` is set; siblings are preserved. E.g. `updateDetails(id, "enrichment.zoning", summary)` sets `details.enrichment.zoning` and leaves `details.enrichment.permits_summary`, etc. unchanged.

---

## 3. Who writes what (no clashes)

| Path / top-level key | Writer(s) | Clash? |
|----------------------|-----------|--------|
| bbl, bin, lat, lon   | getBBLForProperty (when from listing/Geoclient), enrichPermits (when from listing/address), from-listings route | No – same values; merge overwrites with same. |
| bblBase              | getBBLForProperty (when condo resolved), enrichPermits (when has BBL) | No – same value. |
| taxCode              | runOwnerAndTaxCodeStep only | No. |
| enrichment.permits_summary | enrichPropertyWithPermits only | No. |
| enrichment.zoning   | zoningZtlModule only | No. |
| enrichment.certificateOfOccupancy | certificateOfOccupancyModule only | No. |
| enrichment.hpdRegistration | hpdRegistrationModule only | No. |
| enrichment.hpd_violations_summary | hpdViolationsModule only | No. |
| enrichment.dob_complaints_summary | dobComplaintsModule only | No. |
| enrichment.housing_litigations_summary | housingLitigationsModule only | No. |
| enrichment.affordable_housing_summary | affordableHousingModule only | No. |

---

## 4. Owner merge (no overwrite)

- Phase 1 returns `owner` from PLUTO (or valuations/HPD if columns exist); does **not** write to `enrichment.permits_summary`.
- Permits is the **only** writer of `enrichment.permits_summary`. It builds:
  - `owner_name` / `owner_business_name`: **existing** (already in details) **>** `cascadeOwner` (Phase 1) **>** DOB from permit rows.
- So once an owner is stored, a later run never overwrites it.

---

## 5. Single-module run (`moduleName` set)

- When `runEnrichmentForProperty(propertyId, moduleName)` is called with a specific module name:
  - getBBLForProperty is **not** called.
  - Phase 1 and permits are **not** run.
  - Only that one module runs; it uses existing details (BBL, bblBase, etc.) from prior full runs.

---

## 6. Triggers

- **POST /api/properties/from-listings**  
  Creates properties, mergeDetails from listing (bbl, bin, lat, lon, monthlyHoa, monthlyTax), then for each property calls `runEnrichmentForProperty(id, undefined)` → full flow above.
- **CLI enrichAll**  
  Calls `runEnrichmentForProperty` or `runEnrichmentBatch`.
- **Test/agent**  
  Can create property and call `runEnrichmentForProperty(id, undefined)`.

No trigger passes `{ enrichment: { ... } }` to mergeDetails.
