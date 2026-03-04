# Enrichment data → UI flow

How data from the enrichment modules reaches the Property Data UI and which container expects what.

---

## 1. Data sources

- **Property details** (including enrichment summaries) come from `GET /api/properties`: each property has `id`, `canonicalAddress`, `details`, `createdAt`, `updatedAt`. The `details` object is merged over time by `propertyRepo.mergeDetails()` and `propertyRepo.updateDetails(propertyId, "enrichment.xxx", summary)`.
- **Unified table** (permits, violations, complaints, litigations) is loaded when the user opens the “Violations, complaints, permits” section via `GET /api/properties/:id/enrichment/permits`, `.../violations`, `.../complaints`, `.../litigations`. The UI builds one combined table from these four arrays.

---

## 2. “Enriched data” section (Initial property info)

All of this comes from **property.details** (and thus from the enrichment summaries stored there). The UI reads:

| UI label / container        | Source in `details`                    | Keys used | Written by module |
|----------------------------|----------------------------------------|-----------|--------------------|
| BBL                        | `details.bbl` (or `details.BBL`)       | —         | Listing/merge or permit enrichment |
| BIN                        | `details.bin` (or `details.BIN`)       | —         | Listing/merge or permit enrichment |
| Lat / Lon                  | `details.lat`, `details.lon`            | —         | Listing/merge |
| Certificate of occupancy   | `details.enrichment.certificateOfOccupancy` | `issuanceDate`, `status`, `jobType` | certificateOfOccupancy module → `updateDetails(..., "enrichment.certificateOfOccupancy", summary)` |
| HPD registration            | `details.enrichment.hpdRegistration`   | `registrationId`, `lastRegistrationDate` | hpdRegistration module → `updateDetails(..., "enrichment.hpdRegistration", summary)` |
| Tax code                   | `details.taxCode`                      | —         | Other/listing |
| Zoning                     | `details.enrichment.zoning`            | `zoningDistrict1`, `zoningDistrict2`, `zoningMapNumber`, `zoningMapCode` | zoningZtl module → `updateDetails(..., "enrichment.zoning", summary)` |
| HOA / Tax (monthly)        | `details.monthlyHoa`, `details.monthlyTax` | —      | Listing/merge |

**Match:** Certificate of Occupancy summary has `jobType`, `status`, `issuanceDate`. HPD Registration summary has `registrationId`, `lastRegistrationDate`. Zoning summary has `zoningDistrict1`, `zoningDistrict2`, `zoningMapNumber`, `zoningMapCode`. So the “Enriched data” containers will fill correctly when those modules have run and written their summaries.

---

## 3. Owner information section

Owner has two sources; both are persisted so we don't rely only on permits.

- **Phase 1 (owner module):** PLUTO (64uk-42ks) and optionally valuations/HPD. When Phase 1 gets an owner, it **writes `details.ownerInfo`** so owner is stored even when permits returns no rows.
- **Permits:** DOB NOW Build (rbx6-tga4) has `owner_business_name`, `owner_name`. Permits step merges existing **>** Phase 1 cascade **>** DOB from permit rows into `enrichment.permits_summary`.

UI order: **Primary** `details.ownerInfo` (Phase 1 or listing) **→** **Fallback** `details.enrichment.permits_summary` (owner_name, owner_business_name).

---

## 4. Unified table: “Violations, complaints, permits”

The UI fetches four lists and maps each item to `{ date, category, info }` using both top-level fields and `normalizedJson` (with camelCase and snake_case fallbacks).

### Permits (`/enrichment/permits`)

- **API:** `PermitRepo.listByPropertyId()` → rows with `approvedDate`, `issuedDate`, `workPermit`, `status`, `normalizedJson`.
- **UI:**  
  - Date: `p.approvedDate ?? p.issuedDate ?? n?.approvedDate ?? n?.issuedDate`  
  - Info: `[n?.workType ?? n?.work_type ?? p.workPermit, n?.status ?? p.status].join(" · ")`
- **Module:** Permit rows store `normalizedJson` via `rowToNormalized()` with `work_type`, `status`, `approved_date`, `issued_date` (snake_case). Top-level `approvedDate`/`issuedDate` come from the repo mapping.
- **Match:** UI has fallbacks for both camelCase and snake_case and for top-level `workPermit`/`status`, so the table fills correctly.

### HPD Violations (`/enrichment/violations`)

- **API:** `HpdViolationsRepo.listByPropertyId()` → rows with `normalizedJson` only (no date at top level).
- **UI:** Date from `n?.approvedDate`, info from `n?.class`, `n?.currentStatus`/`n?.current_status`, `n?.novDescription`/`n?.nov_description`.
- **Module:** `hpdViolations` writes `normalizedJson` with `approvedDate`, `class`, `currentStatus`, `novDescription` (camelCase).
- **Match:** Keys align; UI also supports snake_case. Containers will fill.

### DOB Complaints (`/enrichment/complaints`)

- **API:** `DobComplaintsRepo.listByPropertyId()` → rows with `normalizedJson`.
- **UI:** Date from `n?.dateEntered`/`n?.date_entered`, info from `n?.complaintCategory`/`n?.complaint_category`, `n?.status`.
- **Module:** `dobComplaints` writes `dateEntered`, `complaintCategory`, `status` in `normalizedJson`.
- **Match:** Keys align; UI has snake_case fallbacks. Containers will fill.

### Housing Litigations (`/enrichment/litigations`)

- **API:** `HousingLitigationsRepo.listByPropertyId()` → rows with `normalizedJson`.
- **UI:** Date from `n?.findingDate`/`n?.finding_date`, info from `n?.caseType`/`n?.case_type`, `n?.caseStatus`/`n?.case_status`.
- **Module:** `housingLitigations` writes `findingDate`, `caseType`, `caseStatus` in `normalizedJson`.
- **Match:** Keys align; UI has snake_case fallbacks. Containers will fill.

---

## 5. Summary

- **Enriched data panel:** Fills from `details.enrichment.zoning`, `details.enrichment.certificateOfOccupancy`, `details.enrichment.hpdRegistration` and from `details.bbl`/`bin`/lat/lon when those are set (e.g. by listing merge or permit enrichment). Key names and update paths match.
- **Owner section:** Fills from `details.enrichment.permits_summary.owner_name` / `owner_business_name` when present.
- **Unified violations/complaints/permits table:** Fills from the four enrichment APIs; the UI uses both top-level and `normalizedJson` and supports camelCase and snake_case. Module outputs match these expectations.

No changes are required for the current enrichment payloads for these containers to fill correctly. If a module has not run or returned no data, the corresponding UI block will show “—” or “Not available” as designed.
