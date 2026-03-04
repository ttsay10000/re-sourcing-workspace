# RapidAPI NYC Real Estate – GET Endpoints & Past Rental Data

## GET endpoints we use (one property = one sale listing)

| Function | RapidAPI path | Purpose |
|----------|----------------|---------|
| **Step 1** | `GET .../sales/search` | Get active sale listings (areas, price, beds, etc.). Returns list of listing URLs. |
| **Step 2** | `GET .../sales/url?url=<StreetEasy sale URL>` | Get full sale details for **one** property (address, BBL/BIN, agents, price, etc.). |

There are **no rental-specific GET endpoints** in our client (e.g. no `rentals/search` or `rentals/url`). All data is from the **sales** API.

---

## Where we look for past rental data

### 1. Inside the **sales/url** response (RapidAPI JSON)

When we call `GET .../sales/url` for a sale listing, we already look for **rental price history** in the response under these keys (see `parsePriceHistoriesFromRaw` in `apps/api/src/routes/testAgent.ts` and `testSaleDetails.ts`):

- `rentalPriceHistory`
- `rental_price_history`
- `rentHistory`
- `rental_history`

If the API returns any of these (at top level or under `listing` / `data`), we parse them into `rentalPriceHistory` and store them on the listing. So **if** the RapidAPI sale-details response includes past rental data (e.g. by unit or in general), we will use it.

**To confirm what the API actually returns:** run the test script for one property and inspect the output:

```bash
# From repo root (ensure RAPIDAPI_KEY is in apps/api/.env or env)
RAPIDAPI_KEY=your_key npx tsx apps/api/src/scripts/testSaleDetails.ts "https://streeteasy.com/sale/<id>"
```

Check:

- **"Price history"** – does it show `rentalPriceHistory`, `rental_price_history`, `rentHistory`, or `rental_history`?
- **"All top-level keys in response"** – do you see any rental-related keys?
- **"Full response"** – scan for arrays of rental events (date, price, event).

If none of those keys appear, the **sales/url** endpoint does not expose past rental data in JSON.

### 2. From the listing page HTML (OpenAI extraction)

When you "Send to property data", we also try to fetch the **listing page HTML** and use OpenAI to extract "Property history" and **"Rental price history"** from the page text. That can provide past rental data even when the RapidAPI JSON does not. StreetEasy often blocks server-side fetches (403/captcha), so this path is unreliable.

---

## Summary

- **RapidAPI GETs we use:** `sales/search` and `sales/url` only. No dedicated rental GETs.
- **Past rental in API:** Only if **sales/url** includes it under one of the rental history keys above. Run `testSaleDetails.ts` for one property to see the real response.
- **By unit vs in general:** Our parser does not distinguish by unit; it stores whatever array the API (or HTML extraction) returns as `rentalPriceHistory`. If the API returns per-unit rental history, we could extend the schema to capture that.
- **Alternative:** For dedicated rental history (e.g. 3+ years), you’d need a different data source (e.g. Reasier, Apify NYC Real Estate Data API, or another provider that exposes rental endpoints).
