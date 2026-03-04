# Enrichment write audit – logic flow and clashes

Trace of all writes to `properties.details` from run phase through canonical enrichment. Used to verify no path is written by multiple steps in a conflicting way.

---

## 1. Execution order (full run, no `moduleName`)

```
getBBLForProperty(propertyId)
  → may mergeDetails: bbl, bin, bblBase, lat, lon (top-level only)

runOwnerAndTaxCodeStep(propertyId, bbl, bblForQueries)
  → PLUTO (owner), valuations 8y4t-faws (tax code), HPD skip
  → mergeDetails: taxCode, censusBlock2010, ownerInfo (when Phase 1 has owner; so we don't rely on permits to persist it)
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
  For two-level paths (e.g. `enrichment.zoning`), the implementation **merges** the new key into the parent: `enrichment = (details.enrichment || {}) || { zoning: summary }`. So each module writes only its own key under `enrichment`; **siblings are never overwritten**. The app flow is one clean path: Phase 1 → permits → 7 modules, each writing to its own `enrichment.<key>`.

---

## 3. Who writes what (no clashes)

| Path / top-level key | Writer(s) | Clash? |
|----------------------|-----------|--------|
| bbl, bin, lat, lon   | getBBLForProperty (when from listing/Geoclient), enrichPermits (when from listing/address), from-listings route | No – same values; merge overwrites with same. |
| bblBase              | getBBLForProperty (when condo resolved), enrichPermits (when has BBL) | No – same value. |
| taxCode              | runOwnerAndTaxCodeStep only | No. |
| ownerInfo            | runOwnerAndTaxCodeStep (when PLUTO/valuations return owner) | No. |
| enrichment.permits_summary | enrichPropertyWithPermits only | No. |
| enrichment.zoning   | zoningZtlModule only | No. |
| enrichment.certificateOfOccupancy | certificateOfOccupancyModule only | No. |
| enrichment.hpdRegistration | hpdRegistrationModule only | No. |
| enrichment.hpd_violations_summary | hpdViolationsModule only | No. |
| enrichment.dob_complaints_summary | dobComplaintsModule only | No. |
| enrichment.housing_litigations_summary | housingLitigationsModule only | No. |
| enrichment.affordable_housing_summary | affordableHousingModule only | No. |

---

## 4. Owner flow (no overwrite)

- Phase 1 gets owner from PLUTO (or valuations/HPD if columns exist) and **writes it to `details.ownerInfo`** when present, so owner is persisted even when permits returns no rows.
- Phase 1 also returns `owner` as `cascadeOwner` for the permits step.
- Permits is the **only** writer of `enrichment.permits_summary`. It builds:
  - `owner_name` / `owner_business_name`: **existing** (already in permits_summary) **>** `cascadeOwner` (Phase 1) **>** DOB from permit rows.
- UI prefers `details.ownerInfo` then falls back to `enrichment.permits_summary`. So Phase 1 owner is shown from ownerInfo; permit-derived owner from permits_summary.
- Once an owner is stored in either place, a later run never overwrites it with empty.

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
