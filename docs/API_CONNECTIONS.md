# API Connections and Usage

This document lists all external APIs the project connects to and which scripts/routes use them.

---

## 1. **RapidAPI – NYC Real Estate API** (Sales & Rentals)

- **Base:** `https://nyc-real-estate-api.p.rapidapi.com`
- **Auth:** `RAPIDAPI_KEY` (env)
- **Endpoints used:**
  - `GET /sales/search` – search sales
  - `GET /sales/url` – sale details by StreetEasy URL
  - `GET /rentals/search` – search rentals
  - `GET /rentals/url` – rental listing by URL

**Used by:**

| Script / Route / Module | Purpose |
|-------------------------|--------|
| `apps/api/src/nycRealEstateApi.ts` | Client: sales search + sale details by URL |
| `apps/api/src/rental/rentalApiClient.ts` | Client: rentals search + rental by URL |
| `apps/api/src/routes/testAgent.ts` | Property-data agent: fetch sale/listing, BBL, send to property-data |
| `apps/api/src/routes/properties.ts` | `POST /properties/run-rental-flow` – rental flow (runRentalApiStep) |
| `apps/api/src/scripts/testSaleDetails.ts` | Test sale details by StreetEasy sale URL |
| `apps/api/src/scripts/testFullFlowWithLogging.ts` | Test full flow (rental URL + runRentalApiStep) |
| `apps/api/src/scripts/testRentalFlow416.ts` | Test rental API step |
| `apps/api/src/scripts/debugRentalApiResponse.ts` | Debug NYC Real Estate + StreetEasy RapidAPI responses |

---

## 2. **RapidAPI – StreetEasy API** (optional / debug)

- **Base:** `https://streeteasy-api.p.rapidapi.com`
- **Auth:** Same `RAPIDAPI_KEY`
- **Usage:** Referenced in `debugRentalApiResponse.ts` for debugging; primary listing/sale data comes from NYC Real Estate API above.

**Used by:**

| Script | Purpose |
|--------|--------|
| `apps/api/src/scripts/debugRentalApiResponse.ts` | Debug responses from both NYC Real Estate and StreetEasy RapidAPI hosts |

---

## 3. **NYC Geoclient API** (Geocoding / BBL resolution)

- **v1 (reverse geocode):** `https://api.cityofnewyork.us/geoclient/v1/address.json`  
  **Auth:** `GEOCLIENT_APP_ID` + `GEOCLIENT_APP_KEY` (deprecated)
- **v2 (address → BBL/BIN):** `https://api.nyc.gov/geoclient/v2` (or `GEOCLIENT_BASE_URL`)  
  **Auth:** `GEOCLIENT_SUBSCRIPTION_KEY` (NYC API Portal: api-portal.nyc.gov, geoclient-current-v2)

**Used by:**

| Script / Module | Purpose |
|-----------------|--------|
| `apps/api/src/enrichment/geoclient.ts` | Client: resolveBBLFromLatLon, resolveBBLFromAddress |
| `apps/api/src/enrichment/resolvePropertyBBL.ts` | Resolve BBL for properties (listing → lat/lon or address → Geoclient) |
| `apps/api/src/enrichment/permits/enrichPermits.ts` | Resolve BBL from listing or permit address (via resolvePropertyBBL) |
| `apps/api/src/scripts/testGeoclientAddress.ts` | Test address → BBL via v2 |

All enrichment that needs BBL (run-enrichment, from-listings, test-agent send-to-property-data) uses Geoclient indirectly via `resolvePropertyBBL` / `getBBLForProperty`.

---

## 4. **NYC Open Data (Socrata) – data.cityofnewyork.us**

- **Base:** `https://data.cityofnewyork.us` (resource: `/resource/{id}.json`, views: `/api/views/{id}/query.json`)
- **Auth:** Optional `SOCRATA_APP_TOKEN` or `NY_OPEN_DATA_APP_TOKEN` (reduces rate limits)

**Datasets used:**

| Dataset ID   | Description |
|-------------|-------------|
| `636b-3b5g` | ACRIS Real Property Parties |
| `bnx9-e6tj` | ACRIS Real Property Master |
| `8h5j-fqxa` | ACRIS Real Property Legals |
| `64uk-42ks` | PLUTO (owner info) |
| `8y4t-faws` | DCAS Valuations (owner/tax) |
| `p8u6-a6it` | Condo BBL mapping |
| `rbx6-tga4` | DOB NOW Build – Approved Permits |
| `pkdm-hqz6` | DOB NOW Certificate of Occupancy (current) |
| `bs8b-p36w` | Historical Certificate of Occupancy |
| `fdkv-4t4z` | Zoning Tax Lot (ZTL) |
| `eabe-havv` | DOB Complaints |
| `tesw-yqqr` | HPD Registration |
| `wvxf-dwi5` | HPD Violations |
| `59kj-x8nc` | Housing Litigations |
| `hg8x-zxpr` | Affordable Housing |

**Used by:**

| Script / Module | Datasets / Purpose |
|-----------------|--------------------|
| `apps/api/src/enrichment/socrata/client.ts` | Generic Socrata client (resource + v3 view query) |
| `apps/api/src/enrichment/permits/socrataClient.ts` | DOB permits `rbx6-tga4` only |
| `apps/api/src/enrichment/acrisDocuments.ts` | ACRIS Parties, Master, Legals |
| `apps/api/src/enrichment/plutoOwner.ts` | PLUTO `64uk-42ks` |
| `apps/api/src/enrichment/ownerAndTaxCode.ts` | Valuations `8y4t-faws` |
| `apps/api/src/enrichment/resolveCondoBbl.ts` | Condo `p8u6-a6it` |
| `apps/api/src/enrichment/modules/zoningZtl.ts` | ZTL `fdkv-4t4z` |
| `apps/api/src/enrichment/modules/dobComplaints.ts` | DOB Complaints `eabe-havv` |
| `apps/api/src/enrichment/modules/hpdRegistration.ts` | HPD Registration `tesw-yqqr` |
| `apps/api/src/enrichment/modules/hpdViolations.ts` | HPD Violations `wvxf-dwi5` |
| `apps/api/src/enrichment/modules/housingLitigations.ts` | Housing Litigations `59kj-x8nc` |
| `apps/api/src/enrichment/modules/affordableHousing.ts` | Affordable Housing `hg8x-zxpr` |
| `apps/api/src/enrichment/modules/certificateOfOccupancy.ts` | DOB CO `pkdm-hqz6`, historical `bs8b-p36w` |
| `apps/api/src/enrichment/nyDosEntity.ts` | Not NYC; see NY Open Data below |
| `apps/api/src/routes/properties.ts` | Run enrichment (all Socrata-based enrichment) |
| `apps/api/src/routes/testAgent.ts` | Send-to-property-data enrichment (Socrata + Geoclient) |
| `apps/api/src/scripts/runEnrichmentLocal.ts` | Local enrichment run (ZTL, permits, CO, complaints, HPD reg, violations, litigations, affordable) |
| `apps/api/src/scripts/enrichPermits.ts` | Permits only `rbx6-tga4` |
| `apps/api/src/scripts/enrichAll.ts` | Batch enrichment (uses runEnrichment) |
| `apps/api/src/scripts/fetchEnrichmentResultsPlain.ts` | Ad-hoc SoQL (ZTL, permits) |
| `apps/api/src/scripts/testEnrichment18Christopher.ts` | Test enrichment (Socrata + Geoclient) |
| `apps/api/src/scripts/testEnrichmentForBBL.ts` | Test enrichment for BBL |
| `apps/api/src/scripts/testEnrichmentBBL1013820133.ts` | Test enrichment for specific BBL |
| `apps/api/src/scripts/testAcris18Christopher.ts` | Test ACRIS flow |
| `apps/api/src/scripts/runOwnerExample.ts` | Owner example (permits rbx6-tga4) |

---

## 5. **NY Open Data (Socrata) – data.ny.gov**

- **Base:** `https://data.ny.gov/resource/{id}.json`
- **Dataset:** `n9v6-gdp6` – Active Corporations Beginning 1800 (NY DOS entity lookup)
- **Auth:** Same app token as NYC optional; not required.

**Used by:**

| Script / Module | Purpose |
|-----------------|--------|
| `apps/api/src/enrichment/nyDosEntity.ts` | Fetch NY DOS business entity by name (LLC, corp, etc.) |
| `apps/api/src/routes/properties.ts` | Property detail: NY DOS entity lookup for owner business name |

---

## 6. **OpenAI API**

- **Base:** OpenAI API (official SDK)
- **Auth:** `OPENAI_API_KEY`
- **Models:** `OPENAI_MODEL`, `OPENAI_PRICE_HISTORY_MODEL` (see `apps/api/src/enrichment/openaiModels.ts`)

**Used by:**

| Script / Module | Purpose |
|-----------------|--------|
| `apps/api/src/enrichment/brokerEnrichment.ts` | Broker/listing enrichment (LLM) |
| `apps/api/src/enrichment/priceHistoryEnrichment.ts` | Price history narrative (LLM) |
| `apps/api/src/rental/extractRentalFinancialsFromListing.ts` | Extract financials from rental listing (LLM) |
| `apps/api/src/rental/suggestRentalDataGaps.ts` | Suggest rental data gaps (LLM) |
| `apps/api/src/routes/testAgent.ts` | Broker LLM when sending run to property-data |

---

## 7. **Gmail API** (Google)

- **Base:** Google APIs via `googleapis` (Gmail v1)
- **Auth:** OAuth2 – `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`; optional `GMAIL_REDIRECT_URI`
- **Scopes:** `gmail.readonly`, `gmail.send`

**Used by:**

| Script / Module | Purpose |
|-----------------|--------|
| `apps/api/src/inquiry/gmailClient.ts` | List messages, get message/attachments, send message |
| `apps/api/src/inquiry/processInbox.ts` | Process inbox (match replies, save emails/attachments) |
| `apps/api/src/routes/properties.ts` | `POST /properties/:id/send-inquiry-email` (send via Gmail) |
| `apps/api/src/routes/cron.ts` | `POST /cron/process-inbox` (trigger processInbox) |
| `apps/api/src/scripts/triggerProcessInbox.ts` | Manually trigger process-inbox (needs Gmail env vars) |

---

## 8. **Postgres (Database)**

- **Connection:** `DATABASE_URL`
- **Used by:** All routes and scripts that persist or read data (listings, properties, runs, inquiry emails, etc.). Key entry: `packages/db` (config, pool, repos), `apps/api` routes and scripts that call `getPool()` or repos.

---

## 9. **Internal / App APIs**

The **web app** talks to the **Express API** via `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`). No separate external API list; the Express server exposes REST endpoints that in turn use the external APIs above.

---

## Summary Table

| API | Env / Auth | Scripts Using It | Routes/Modules Using It |
|-----|------------|------------------|--------------------------|
| RapidAPI (NYC Real Estate + StreetEasy) | `RAPIDAPI_KEY` | testSaleDetails, testFullFlowWithLogging, testRentalFlow416, debugRentalApiResponse | testAgent, properties (run-rental-flow), nycRealEstateApi, rentalApiClient |
| NYC Geoclient | `GEOCLIENT_SUBSCRIPTION_KEY` (v2), or app id/key (v1) | testGeoclientAddress | geoclient, resolvePropertyBBL, enrichPermits, runEnrichment (indirect) |
| NYC Open Data (Socrata) | Optional `SOCRATA_APP_TOKEN` | runEnrichmentLocal, enrichPermits, enrichAll, fetchEnrichmentResultsPlain, testEnrichment*, testAcris18Christopher, runOwnerExample | properties (run-enrichment, from-listings), testAgent (send-to-property-data), all enrichment modules + permits/socrataClient |
| NY Open Data (data.ny.gov) | Optional app token | — | nyDosEntity, properties (property detail) |
| OpenAI | `OPENAI_API_KEY` | — | brokerEnrichment, priceHistoryEnrichment, rental (extract + suggest), testAgent |
| Gmail | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | triggerProcessInbox | gmailClient, processInbox, properties (send-inquiry-email), cron (process-inbox) |
| Postgres | `DATABASE_URL` | All scripts that need DB | All routes and services that persist/read data |
