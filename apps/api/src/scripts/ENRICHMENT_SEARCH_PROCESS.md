# Enrichment search process: per-database walkthrough

Each enrichment module hits one NYC Open Data (Socrata) dataset. Below: **what we filter by**, **batch size**, **how many API calls**, and **typical row counts** for a single property (BBL/BIN).

---

## 1. Permits (DOB NOW Build – Approved Permits)

- **Dataset:** `rbx6-tga4` — [DOB NOW Build Approved Permits](https://data.cityofnewyork.us/resource/rbx6-tga4.json)
- **Filter:** `bbl = '<BBL>'` and `(issued_date >= '<cutoff>' OR approved_date >= '<cutoff>')` (10-year cutoff).
- **Batch size:** 1,000 rows per request.
- **Process:** Paginate with `$limit=1000`, `$offset=0,1000,2000,...` until a page returns fewer than 1,000 rows.
- **API calls:** 1 if 0 rows; ceil(total_rows / 1000) otherwise.
- **Example (Linea BBL 1007167507):** 0 rows → **1 request**, 1 batch.

---

## 2. Zoning (Zoning Tax Lot – ZTL)

- **Dataset:** `fdkv-4t4z` — [NYC Zoning Tax Lot Database](https://data.cityofnewyork.us/resource/fdkv-4t4z.json)
- **Filter:** `bbl = '<BBL>'` (dataset has `bbl`; one tax lot per BBL typically).
- **Batch size:** 1,000 rows per request.
- **Process:** Paginate with `$limit=1000`, `$offset=0,1000,...` until a page returns &lt; 1,000 rows (no batch limit).
- **API calls:** ceil(matching_rows / 1000); usually 1 when 0 or 1 row matches.
- **Example (Linea):** 0 rows → **1 request**, 1 batch.

---

## 3. Certificate of occupancy

- **Dataset:** `pkdm-hqz6` — [DOB NOW Certificate of Occupancy](https://data.cityofnewyork.us/resource/pkdm-hqz6.json)
- **Filter:** **BBL only.** `bbl = '<BBL>'` (dataset has `bbl` column); ordered by `c_of_o_issuance_date DESC`.
- **Batch size:** 1,000 rows per request.
- **Process:** Paginate with `$limit=1000`, `$offset=0,1000,...` until a page returns &lt; 1,000 rows (no batch limit). Use first row as latest.
- **API calls:** ceil(matching_rows / 1000); usually 1 when 0 or 1 row matches.
- **Example (Linea):** 0 rows → **1 request**, 1 batch.

---

## 4. HPD registration (Multiple Dwelling Registrations)

- **Dataset:** `tesw-yqqr` — [HPD Multiple Dwelling Registrations](https://data.cityofnewyork.us/resource/tesw-yqqr.json)
- **BBL column:** Dataset has **no `bbl` column**; only `boroid`, `boro`, `block`, `lot`. We query by `boro = '<borough>' AND block = '<block>' AND lot = '<lot>'` from `bblToBoroughBlockLot(bbl)`, then filter results with `rowToBblFromBoroughBlockLot(row) === bbl` so only rows whose constructed BBL matches Geoclient BBL are kept.
- **Filter:** **BBL only** (no BIN).
- **Batch size:** 1,000 rows per request.
- **Process:** Paginate with `$limit=1000`, `$offset=0,1000,...` until exhausted; filter each page by constructed BBL.
- **API calls:** ceil(total_rows / 1000).

---

## 5. HPD violations (Housing Maintenance Code Violations)

- **Dataset:** `wvxf-dwi5` — [HPD Violations](https://data.cityofnewyork.us/resource/wvxf-dwi5.json)
- **BBL column:** Dataset has **no `bbl` column**; only `boroid`, `boro`, `block`, `lot`. We query by `boro = '<borough>' AND block = '<block>' AND lot = '<lot>'` from `bblToBoroughBlockLot(bbl)`, then filter results with `rowToBblFromBoroughBlockLot(row) === bbl`.
- **Filter:** **BBL only** (no BIN).
- **Batch size:** 1,000 rows per request (`fetchAllPages`).
- **Process:** Paginate until exhausted; filter each page by constructed BBL.
- **API calls:** ceil(total_rows / 1000).

---

## 6. DOB complaints

- **Dataset:** `eabe-havv` — [DOB Complaints Received](https://data.cityofnewyork.us/resource/eabe-havv.json)
- **BBL column:** Dataset has **no BBL column**; only `bin` is available for filtering.
- **Filter:** `bin = '<BIN>'` only (BIN-only; skip when Geoclient does not return a valid BIN).
- **Batch size:** 1,000 rows per request (`fetchAllPages`).
- **Process:** Paginate with `$limit=1000`, `$offset=0,1000,...` until a page returns &lt; 1,000 rows.
- **API calls:** 1 if 0 rows; otherwise ceil(total_rows / 1000).
- **Example (Linea BIN 1000000):** 0 rows → **1 request**, 1 batch.

---

## 7. Housing litigations

- **Dataset:** `59kj-x8nc` — [Housing Litigations](https://data.cityofnewyork.us/resource/59kj-x8nc.json)
- **Filter:** **BBL only.** `bbl = '<BBL>'` (dataset has `bbl` column).
- **Batch size:** 1,000 rows per request (`fetchAllPages`).
- **Process:** Same pagination as above.
- **API calls:** ceil(total_rows / 1000).
- **Example (Linea):** 206 rows → **1 request**, 1 batch (206 &lt; 1000).

---

## 8. Affordable housing (Production by Building)

- **Dataset:** `hg8x-zxpr` — [Affordable Housing Production by Building](https://data.cityofnewyork.us/resource/hg8x-zxpr.json)
- **Filter:** **BBL only.** `bbl = '<BBL>'` (dataset has `bbl` column).
- **Batch size:** 1,000 rows per request (`fetchAllPages`).
- **Process:** Same pagination.
- **API calls:** ceil(total_rows / 1000).
- **Example (Linea):** 49 rows → **1 request**, 1 batch.

---

## Summary table (Linea BBL 1007167507, BIN 1000000)

| Module                  | Dataset    | Filter / BBL column | Rows per batch | Batches (API calls) | Total rows |
|-------------------------|------------|---------------------|----------------|---------------------|------------|
| Permits                 | rbx6-tga4  | BBL (has `bbl`)     | 1,000          | 1                   | 0          |
| Zoning ZTL              | fdkv-4t4z  | BBL (has `bbl`)     | 1,000          | 1                   | 0          |
| Certificate of occup.   | pkdm-hqz6  | BBL only (has `bbl`)| 1,000          | 1                   | 0          |
| HPD registration       | tesw-yqqr  | BBL only; no `bbl` → boro+block+lot, then filter by constructed BBL | 1,000 | 1+ | 0–1 |
| HPD violations          | wvxf-dwi5  | BBL only; no `bbl` → boro+block+lot, filter by constructed BBL | 1,000 | 1+ | per BBL |
| DOB complaints          | eabe-havv  | BIN only (no BBL)   | 1,000          | 1                   | 0          |
| Housing litigations     | 59kj-x8nc  | BBL only (has `bbl`)| 1,000          | 1                   | per BBL   |
| Affordable housing      | hg8x-zxpr  | BBL only (has `bbl`)| 1,000          | 1                   | per BBL   |

**Total API calls for this one property (BBL only for HPD):** Permits 1 + Zoning 1 + CO 1 + HPD reg 1 + HPD violations 1 + DOB 1 + Litigations 1 + Affordable 1 = **8 requests** (with 400 ms delay between modules in the local script).

---

## Batch size constants (in code)

- **Permits:** `DEFAULT_LIMIT = 1000` in `apps/api/src/enrichment/permits/socrataClient.ts`; paginate until exhausted (no batch cap).
- **Zoning, certificate of occupancy, HPD registration:** `fetchAllPages` with `limit = 1000` in `apps/api/src/enrichment/socrata/client.ts`; paginate until exhausted (no batch cap).
- **HPD violations, DOB complaints, housing litigations, affordable housing:** Same `fetchAllPages` (limit 1000, no batch cap).
- **All modules except DOB complaints:** BBL only; Geoclient BIN is unreliable. Datasets that have no `bbl` column (HPD registration) query by boro+block+lot and filter results by constructed BBL (`rowToBblFromBoroughBlockLot`). **DOB complaints:** dataset has no BBL column, so BIN only.
