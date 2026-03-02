# Enrichment pipeline audit – query construction, columns, state vs event

This document validates each dataset against the ingestion troubleshooting framework: endpoints, columns, identifier formatting, state vs event, “latest” definition, pagination, and count validation.

---

## Endpoint standard

- **Canonical endpoint:** All datasets use the **Socrata resource URL** for programmatic querying:  
  `https://data.cityofnewyork.us/resource/{dataset_id}.json`  
  (built via `resourceUrl(datasetId)` in `socrata/client.ts`).
- **Permits** use the same pattern in `permits/socrataClient.ts` with `BASE_URL = "https://data.cityofnewyork.us/resource/rbx6-tga4.json"`.
- **Query features:** SoQL supports `$select`, `$where`, `$order`, `$limit`, `$offset`. Pagination is explicit (limit 1000, continue until `page.length < limit`). Count preflight is available via `$select=count(*)` and `fetchSocrataCount()`.

---

## Per-dataset audit

### 1. Permits (DOB NOW Build – Approved Permits)

| Item | Value |
|------|--------|
| **Dataset ID** | rbx6-tga4 |
| **Endpoint** | `https://data.cityofnewyork.us/resource/rbx6-tga4.json` |
| **Type** | Event (multiple records per property over time) |
| **Primary key / filter** | BBL (+ 10-year date window). Fallback: address (borough, house_no, street_name). |
| **Identifier formatting** | BBL: 10-digit string; normalize with `normalizeBblForQuery()` before query. |
| **“Latest” / ordering** | `$order: "issued_date DESC"` – all matching rows retrieved; no single-row collapse. |
| **Columns requested** | bbl, block, lot, bin, borough, house_no, street_name, owner_business_name, owner_name, permit_status, work_permit, job_filing_number, work_on_floor, work_type, applicant_*, approved_date, issued_date, expired_date, job_description, estimated_job_costs, tracking_number |
| **Pagination** | 1000 per page; `fetchAllPermits()` loops until `page.length < limit`. No batch cap. |
| **Count validation** | Optional: use `fetchSocrataCount(baseUrl, where)` with same `$where` before fetch; compare to `rows.length` after. |
| **Rate limiting** | Retries with backoff on 429/5xx in `fetchPermitsPage`. |

---

### 2. Zoning (Zoning Tax Lot – ZTL)

| Item | Value |
|------|--------|
| **Dataset ID** | fdkv-4t4z |
| **Endpoint** | `resourceUrl("fdkv-4t4z")` |
| **Type** | State (one record per tax lot; BBL → one row) |
| **Primary key / filter** | BBL only. Use normalized 10-digit BBL. |
| **Identifier formatting** | BBL: use `normalizeBblForQuery(bbl)`; dataset column is `bbl`. |
| **“Latest”** | N/A (state). We take `rows[0]` after fetch; dataset has at most one row per BBL. |
| **Columns requested** | bbl, borough_code, tax_block, tax_lot, zoning_district_1, zoning_district_2, special_district_1, zoning_map_number, zoning_map_code |
| **Pagination** | `fetchAllPages` limit 1000 until exhausted. |
| **Count validation** | Optional count preflight; expect 0 or 1. |

---

### 3. Certificate of occupancy

| Item | Value |
|------|--------|
| **Dataset ID** | pkdm-hqz6 |
| **Endpoint** | `resourceUrl("pkdm-hqz6")` |
| **Type** | State / event (can have multiple COs; we use “latest” by issuance date) |
| **Primary key / filter** | BBL or BIN. Normalize BBL with `normalizeBblForQuery()`. |
| **Identifier formatting** | BBL 10-digit; BIN as string (no padding assumed). |
| **“Latest”** | `$order: "c_of_o_issuance_date DESC"`; application uses `rows[0]` as latest. |
| **Columns requested** | bbl, bin, job_type, c_of_o_status, c_of_o_filing_type, c_of_o_issuance_date, number_of_dwelling_units |
| **Pagination** | `fetchAllPages` limit 1000. |
| **Count validation** | Optional; expect 0 or 1 for “current” CO usage. |

---

### 4. HPD registration

| Item | Value |
|------|--------|
| **Dataset ID** | tesw-yqqr |
| **Endpoint** | `resourceUrl("tesw-yqqr")` |
| **Type** | State (current registration per building; we take latest by date) |
| **Primary key / filter** | BBL only → boro + block + lot (dataset uses `boro`, not `borough`). |
| **Identifier formatting** | BBL normalized via `normalizeBblForQuery()` then `bblToBoroughBlockLot()` for boro/block/lot. |
| **“Latest”** | `$order: "lastregistrationdate DESC"`; we use `rows[0]`. |
| **Columns requested** | registrationid, lastregistrationdate, bin, boro, block, lot |
| **Pagination** | `fetchAllPages` limit 1000. |
| **Count validation** | Optional; typically 0 or 1 per BBL. |

---

### 5. HPD violations

| Item | Value |
|------|--------|
| **Dataset ID** | wvxf-dwi5 |
| **Endpoint** | `resourceUrl("wvxf-dwi5")` |
| **Type** | Event (multiple violations per property over time) |
| **Primary key / filter** | BBL only. Normalize with `normalizeBblForQuery()`. |
| **Identifier formatting** | BBL 10-digit. Do not use BIN (unreliable from Geoclient). |
| **“Latest”** | All rows kept; ordered by `approveddate DESC` for recency. |
| **Columns requested** | violationid, bbl, bin, story, class, approveddate, novdescription, currentstatus, violationstatus, rentimpairing |
| **Pagination** | `fetchAllPages` limit 1000 until exhausted. Never collapse to one row. |
| **Count validation** | Run count preflight; flag if `rowsDownloaded !== expectedCount`. |

---

### 6. DOB complaints

| Item | Value |
|------|--------|
| **Dataset ID** | eabe-havv |
| **Endpoint** | `resourceUrl("eabe-havv")` |
| **Type** | Event (multiple complaints per BIN) |
| **Primary key / filter** | BIN only (dataset is BIN-keyed). |
| **Identifier formatting** | BIN as string; no BBL. |
| **“Latest”** | All rows; `$order: "date_entered DESC"`. Dataset columns: **date_entered**, disposition_date, complaint_category (snake_case). |
| **Columns requested** | bin, date_entered, status, unit, disposition_date, complaint_category |
| **Pagination** | `fetchAllPages` limit 1000. |
| **Count validation** | Optional count preflight. |

---

### 7. Housing litigations

| Item | Value |
|------|--------|
| **Dataset ID** | 59kj-x8nc |
| **Endpoint** | `resourceUrl("59kj-x8nc")` |
| **Type** | Event (multiple cases per property) |
| **Primary key / filter** | BBL or BIN. Normalize BBL with `normalizeBblForQuery()`. |
| **Identifier formatting** | BBL 10-digit; BIN string. |
| **“Latest”** | All rows; order by case open date. Dataset uses **caseopendate**, **casejudgement** (not findingdate/openjudgement). |
| **Columns requested** | bbl, bin, casetype, casestatus, casejudgement, caseopendate, respondent |
| **Pagination** | `fetchAllPages` limit 1000. |
| **Count validation** | Optional. |

---

### 8. Affordable housing

| Item | Value |
|------|--------|
| **Dataset ID** | hg8x-zxpr |
| **Endpoint** | `resourceUrl("hg8x-zxpr")` |
| **Type** | Event (multiple projects per BBL/BIN over time) |
| **Primary key / filter** | BBL or BIN. Normalize BBL. |
| **Identifier formatting** | BBL 10-digit; BIN string. |
| **“Latest”** | All rows; `$order: "project_completion_date DESC"`. Dataset uses **snake_case** column names. |
| **Columns requested** | bbl, bin, project_name, project_start_date, project_completion_date, reporting_construction_type, extremely_low_income_units, very_low_income_units, low_income_units, moderate_income_units, middle_income_units, other_income_units, studio_units, total_units (and optional bedroom columns if present) |
| **Pagination** | `fetchAllPages` limit 1000. |
| **Count validation** | Optional. |

---

## Identifier formatting (shared)

- **BBL:** Always normalize with `normalizeBblForQuery(bbl)` before building `$where`. Produces 10-digit string; handles unpadded or string/numeric input; returns null if invalid.
- **BIN:** Use as string; do not pad. Geoclient BIN is often unreliable (e.g. placeholder 1000000); HPD modules use BBL only.
- **Zero results:** If a query returns 0 rows, consider retrying with alternate formatting only where documented (e.g. BBL padding). Do not silently assume “no data” without checking identifier format.

---

## Pagination and completeness

- Every query uses **explicit** `$limit` (1000) and `$offset`; no single-request assumption.
- Loop until `page.length < limit` (or use `fetchAllPages` / `fetchAllPagesWithDiagnostics`).
- **Count preflight:** Use `fetchSocrataCount(baseUrl, where)` with the same `$where`; after download, flag when `rowsDownloaded !== expectedCount` (see `SocrataIngestionDiagnostics.countMismatch`).
- **Diagnostics:** `fetchAllPagesWithDiagnostics()` returns `{ rows, diagnostics }` with datasetId, where, expectedCount, rowsDownloaded, pagesRequested, countMismatch, durationMs. Use for logging and alerting.

---

## State vs event summary

| Dataset | Type | Single row per entity? | Order / “latest” |
|---------|------|------------------------|------------------|
| Permits | Event | No | issued_date DESC; keep all. |
| Zoning ZTL | State | Yes (per BBL) | N/A; take first. |
| Certificate of occupancy | State/event | Can be multiple | c_of_o_issuance_date DESC; app uses first. |
| HPD registration | State | One current per BBL | lastregistrationdate DESC; use first. |
| HPD violations | Event | No | approveddate DESC; keep all. |
| DOB complaints | Event | No | date_entered DESC; keep all. |
| Housing litigations | Event | No | caseopendate DESC; keep all. |
| Affordable housing | Event | No | project_completion_date DESC; keep all. |

---

## Structured logging (recommended)

For each ingestion run, log (e.g. to state or a diagnostics store):

- dataset name / datasetId  
- filter conditions (where)  
- expected record count (from count preflight if run)  
- rows downloaded  
- number of pages requested  
- count mismatch (yes/no)  
- date range of returned data (if applicable)  
- execution duration  
- retry attempts (already tracked in fetch layer)

Flag: count mismatches, zero-result queries, and incomplete pagination (e.g. stopped with full page but expected more).
