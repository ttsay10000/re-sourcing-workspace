# API & Data Flow Reference

This document lists all APIs in use (internal and external), endpoints, datasets, and at which step in the flow each is used.

---

## 1. Internal API (Express)

Base URL: `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`). All routes are prefixed with `/api`.

### 1.1 Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Liveness check. Returns `{ ok, version, env }`. No DB required. |

---

### 1.2 Test Agent (Runs flow)

Two-step NYC Real Estate flow: start a run → backend runs Step 1 (Active Sales) then Step 2 (Sale details per URL). Data is stored in memory until the user sends it to Property Data.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/test-agent/run` | Start a new run. Body: `areas`, `minPrice`, `maxPrice`, `minBeds`, `maxBeds`, `minBaths`, `maxHoa`, `maxTax`, `amenities`, `types`, `limit`, `offset`. Returns `{ runId, startedAt }` (202). Two-step flow runs in background. |
| GET | `/api/test-agent/runs` | List all runs (newest first) with step progress and counts. |
| GET | `/api/test-agent/runs/:id` | Get one run with full `properties` (raw data lake). |
| POST | `/api/test-agent/runs/:id/send-to-property-data` | Send this run’s properties to Property Data: normalize → LLM enrichment (broker, price history) → upsert listings + snapshots → recompute duplicate scores. Requires DB. |
| GET | `/api/test-agent/property-data/runs` | List property-data run log (all “Send to property data” runs) for integrity comparison. |
| DELETE | `/api/test-agent/property-data` | Delete all raw listings (and snapshots via CASCADE). Requires `?confirm=1` or body `{ confirm: true }`. |

---

### 1.3 Listings

Raw listings for Property Data page and listing cards.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/listings` | List active listings (lifecycle_state = active, limit 500). |
| GET | `/api/listings/:id` | Get one listing by ID. |
| GET | `/api/listings/duplicate-candidates?threshold=80` | Listings with `duplicate_score >= threshold` (default 80). |
| DELETE | `/api/listings/:id` | Delete one listing (and snapshots via CASCADE). |

---

### 1.4 Properties (canonical)

Canonical properties and enrichment data.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/properties` | List canonical properties (limit 500). |
| POST | `/api/properties/from-listings` | Create canonical properties from all active raw listings; link via matches; optionally run permit + 7 enrichment modules. Use `?skipPermitEnrichment=1` to skip enrichment. |
| GET | `/api/properties/:id/enrichment/state` | Last run and outcome per enrichment module (`permits`, `zoning_ztl`, `certificate_of_occupancy`, `hpd_registration`, `hpd_violations`, `dob_complaints`, `housing_litigations`, `affordable_housing`). |
| GET | `/api/properties/:id/enrichment/violations` | HPD violations rows for property. |
| GET | `/api/properties/:id/enrichment/complaints` | DOB complaints rows for property. |
| GET | `/api/properties/:id/enrichment/litigations` | Housing litigations rows for property. |
| GET | `/api/properties/:id/enrichment/affordable-housing` | Affordable housing rows for property. |

---

## 2. External APIs

### 2.1 NYC Real Estate API (RapidAPI)

- **Provider:** RapidAPI — [NYC Real Estate API](https://rapidapi.com/realestator/api/nyc-real-estate-api)
- **Auth:** `RAPIDAPI_KEY` (required for Runs)
- **Host:** `nyc-real-estate-api.p.rapidapi.com`

| Step | Method | URL | Query / body | Data pulled | When used |
|------|--------|-----|--------------|-------------|-----------|
| **Step 1** | GET | `https://nyc-real-estate-api.p.rapidapi.com/sales/search` | `areas` (required), `minPrice`, `maxPrice`, `minBeds`, `maxBeds`, `minBaths`, `maxHoa`, `maxTax`, `amenities`, `types`, `limit`, `offset` | Array of active sale listings (id, address, price, beds, baths, sqft, url, etc.). URLs are used in Step 2. | Test Agent run start (background Step 1). |
| **Step 2** | GET | `https://nyc-real-estate-api.p.rapidapi.com/sales/url` | `url` = StreetEasy listing URL from Step 1 | Full sale details per listing (address, borough, zip, price, bedrooms, bathrooms, sqft, agents, images, description, BBL/BIN when available, etc.). | Test Agent run (background Step 2), one request per listing URL. |

**Flow:** User starts run → API calls Step 1 → API calls Step 2 for each URL (with small delay). Results stored in run’s `properties` (in memory). User can then “Send to property data” to persist and enrich.

---

### 2.2 NYC Open Data (Socrata)

- **Base:** `https://data.cityofnewyork.us`
- **Auth:** Optional `SOCRATA_APP_TOKEN` (improves rate limits)
- **Usage:** Permits use resource URL `.../resource/{id}.json`; other enrichment modules use shared Socrata client (resource or v3 view query).

#### Permits (DOB NOW Build – Approved Permits)

| Dataset | Resource | Data pulled | When used |
|---------|----------|-------------|-----------|
| **rbx6-tga4** | `https://data.cityofnewyork.us/resource/rbx6-tga4.json` | BBL, block, lot, BIN, borough, house_no, street_name, owner/applicant names and business, permit_status, work_permit, job_filing_number, work_on_floor, work_type, approved_date, issued_date, expired_date, job_description, estimated_job_costs, tracking_number. Queried by BBL (primary) or borough+house_no+street_name; 10-year date filter. | Permit enrichment: when creating properties from listings (`POST /api/properties/from-listings`) or running permit enrichment for a property. |

#### Enrichment modules (7 modules, after permits)

| Module | Dataset ID | Resource URL | Key by | Data pulled | When used |
|--------|------------|--------------|--------|-------------|-----------|
| **Zoning ZTL** | fdkv-4t4z | `.../resource/fdkv-4t4z.json` | BBL (borough+block+lot) | zoning_district_1/2, special_district_1, zoning_map_number, zoning_map_code. Single row per property. | Property enrichment (after permits). |
| **Certificate of Occupancy** | pkdm-hqz6 | `.../resource/pkdm-hqz6.json` | BBL or BIN | job_type, co_status, co_filing_type, co_issuance_date, number_of_dwelling_units. Single row. | Property enrichment. |
| **HPD Registration** | tesw-yqqr | `.../resource/tesw-yqqr.json` | BBL (borough+block+lot) or BIN | registrationid, lastregistrationdate. Single row. | Property enrichment. |
| **HPD Violations** | wvxf-dwi5 | `.../resource/wvxf-dwi5.json` | BBL or BIN | violationid, bbl, bin, story, class, approveddate, novdescription, currentstatus, violationstatus, rentimpairing. Multi-row. | Property enrichment. |
| **DOB Complaints** | eabe-havv | `.../resource/eabe-havv.json` | BIN only | bin, dateentered, status, unit, dispositiondate, complaintcategory. Multi-row. | Property enrichment. |
| **Housing Litigations** | 59kj-x8nc | `.../resource/59kj-x8nc.json` | BBL or BIN | bbl, bin, casetype, casestatus, openjudgement, findingdate, penalty, respondent. Multi-row. | Property enrichment. |
| **Affordable Housing** | hg8x-zxpr | `.../resource/hg8x-zxpr.json` | BBL or BIN | bbl, bin, projectname, projectstartdate, projectcompletiondate, reportingconstructiontype, income/unit counts (extremelylow, verylow, low, moderate, middle, other, studio–6br+), countedrental/countedhomeownership, totalunits. Multi-row. | Property enrichment. |

**When Socrata is used:**  
- **Permits:** During `POST /api/properties/from-listings` (unless `?skipPermitEnrichment=1`) and permit-only batch jobs.  
- **All 7 modules:** Same “from-listings” run (per property, in order), or when running enrichment for a single property (e.g. scripts).  
BBL/BIN come from property details (often from NYC Real Estate API sale details when present).

---

### 2.3 OpenAI API

- **Auth:** `OPENAI_API_KEY`
- **Models:** Default `gpt-5.2`; overrides: `OPENAI_MODEL`, `OPENAI_PRICE_HISTORY_MODEL` (e.g. `gpt-5-mini`)

| Use | Endpoint | Data in | Data out | When used |
|-----|----------|---------|----------|-----------|
| **Broker/agent enrichment** | Chat completions (JSON mode) | Broker/agent names (+ optional property context) | Firm, email, phone per name | When user clicks “Send to property data”: for each **new** listing we call this; existing listings keep stored enrichment. |
| **Price history extraction** | Chat completions | HTML of listing page (we fetch the URL server-side, then send content to the model) | Bulleted list of “Date, Price, Event” for sale/list and rental price history | Same “Send to property data” flow, for new listings with a valid URL. StreetEasy often blocks server-side fetches (403/captcha); then price history is unavailable. |

**Flow:** “Send to property data” → for each run property we normalize to `ListingNormalized` → if listing is new we call broker enrichment and (if URL present) fetch page HTML and call price-history extraction → upsert listing and snapshot (including LLM outputs).

---

### 2.4 Other: Listing page HTML (for price history)

- **What:** HTTP GET to the listing URL (e.g. StreetEasy) to fetch HTML.
- **Who:** API server in `priceHistoryEnrichment`.
- **Data:** Full HTML of the listing page (truncated to 120k chars), then sent to OpenAI to extract price history. Many listing sites (e.g. StreetEasy) block or captcha server-side requests, so this often fails.

---

## 3. Flow summary: where each API is used

| Step in system | Internal API | External API | Data pulled |
|----------------|--------------|--------------|-------------|
| **1. User starts a Run** | `POST /api/test-agent/run` | NYC Real Estate: GET `/sales/search` | Active sale listings + URLs |
| **2. Run background Step 2** | (same run) | NYC Real Estate: GET `/sales/url` per URL | Full sale details per listing (incl. BBL/BIN when available) |
| **3. User opens Run detail** | `GET /api/test-agent/runs/:id` | — | Stored run + properties (in memory) |
| **4. User clicks “Send to property data”** | `POST /api/test-agent/runs/:id/send-to-property-data` | OpenAI (broker enrichment + price history from HTML), and HTTP GET to listing URL for HTML | Broker firm/email/phone; price history from listing page |
| **5. Property Data page load** | `GET /api/listings`, `GET /api/properties`, `GET /api/test-agent/property-data/runs` | — | Active listings, canonical properties, run log |
| **6. Property Data: duplicate review** | `GET /api/listings/duplicate-candidates`, `DELETE /api/listings/:id` | — | Duplicate candidates; delete listing |
| **7. Property Data: “Add to canonical properties”** | `POST /api/properties/from-listings` | Socrata: Permits (rbx6-tga4) + 7 enrichment datasets (fdkv-4t4z, pkdm-hqz6, tesw-yqqr, wvxf-dwi5, eabe-havv, 59kj-x8nc, hg8x-zxpr) | Canonical properties + matches; permits and all enrichment rows per property |
| **8. Property Data: view enrichment** | `GET /api/properties/:id/enrichment/state`, `.../violations`, `.../complaints`, `.../litigations`, `.../affordable-housing` | — | Enrichment state and stored Socrata-sourced rows |
| **9. Listings page** | `GET /api/test-agent/runs`, `GET /api/test-agent/runs/:id` | — | Runs and run detail |
| **10. Health check** | `GET /api/health` | — | Version, env |

---

## 4. Environment variables (API keys / config)

| Variable | Required | Purpose |
|----------|----------|---------|
| `RAPIDAPI_KEY` | Yes (for Runs) | NYC Real Estate API (RapidAPI) |
| `OPENAI_API_KEY` | Yes (for broker + price history enrichment) | OpenAI chat completions |
| `DATABASE_URL` | No for health; Yes for listings/properties/send-to-property-data | Postgres connection |
| `SOCRATA_APP_TOKEN` | No | NYC Open Data; improves rate limits |
| `NEXT_PUBLIC_API_URL` | No (default localhost:4000) | Web app → API base URL |
| `CORS_ORIGIN` | For deployed web | Allowed origin(s) for API |
| `ENRICHMENT_RATE_LIMIT_DELAY_MS` / `PERMITS_RATE_LIMIT_DELAY_MS` | No | Delay between Socrata/enrichment requests |
| `OPENAI_MODEL` / `OPENAI_PRICE_HISTORY_MODEL` | No | Override default GPT model(s) |

---

## 5. Data sets summary

| Source | Dataset / endpoint | Stored in DB / app | Step in flow |
|-------|--------------------|--------------------|--------------|
| NYC Real Estate – search | Active sales list + URLs | In-memory run `properties` (then listings + snapshots after “Send to property data”) | Run Step 1 |
| NYC Real Estate – url | Sale details (incl. BBL/BIN when present) | Same | Run Step 2 |
| OpenAI | Broker firm/email/phone | `listings.agent_enrichment`, snapshot metadata | Send to property data (new listings) |
| OpenAI | Price history (parsed from HTML) | `listings.price_history`, `listings.rental_price_history`, snapshot metadata | Send to property data (new listings, if URL fetch succeeds) |
| Socrata rbx6-tga4 | DOB permits | `property_permits`; summary in `properties.details` | Properties from listings + permit enrichment |
| Socrata fdkv-4t4z | Zoning ZTL | `zoning_ztl` | Property enrichment |
| Socrata pkdm-hqz6 | Certificate of occupancy | `certificate_of_occupancy` | Property enrichment |
| Socrata tesw-yqqr | HPD registration | `hpd_registration` | Property enrichment |
| Socrata wvxf-dwi5 | HPD violations | `hpd_violations` | Property enrichment |
| Socrata eabe-havv | DOB complaints | `dob_complaints` | Property enrichment |
| Socrata 59kj-x8nc | Housing litigations | `housing_litigations` | Property enrichment |
| Socrata hg8x-zxpr | Affordable housing | `affordable_housing` | Property enrichment |

All Socrata-backed enrichment also updates `property_enrichment_state` per property per module (last run time, success/error, optional stats).
