# Financial data flows (rental + OM analyst)

## Two sources of financials on the property card

1. **Rental flow** – listing/rental data + LLM extraction  
2. **OM / senior-analyst** – uploaded OM or Brochure + full analyst LLM  

Both write into `property.details.rentalFinancials` (and the UI shows them in the Financial section of the property card).

---

## 1. Rental flow (automatic per property)

- **What it does:** For each canonical property, fetches rental data by address (RapidAPI) and runs an LLM on the **linked listing** description to extract financials (NOI, cap rate, rent roll, etc.). Results are stored in `rentalFinancials.fromLlm` and `rentalFinancials.rentalUnits`.
- **When it runs:**
  - **Automatically** when you **add listings to canonical** (`POST /api/properties/from-listings`) – after enrichment, rental flow runs for each created property.
- **On-demand:** The "Re-run rental flow" button (or `POST /api/properties/run-rental-flow`) re-runs only the rental flow for selected or all properties.

Re-run enrichment (`POST /api/properties/run-enrichment`) does **not** run rental flow; it only runs NYC Open Data modules and OM/Brochure LLM refresh. Use the separate "Re-run rental flow" button for RapidAPI + listing LLM.

---

## 2. OM / senior-analyst LLM (when OM is available and uploaded or from broker email)

- **What it does:** When an OM or Brochure is available (uploaded by the user or scraped from a broker email), we extract text and run the **senior-analyst** LLM (`extractRentalFinancialsFromText` with `forceOmStyle: true` and enrichment context). The analyst reads the OM and populates:
  - `rentalFinancials.omAnalysis` – full structured output: `uiFinancialSummary`, rent roll, expenses, investment takeaways, etc.
  - `rentalFinancials.fromLlm` – derived top-line financials used elsewhere (dossier, deal signals).
- **When it runs:**
  - **On manual upload:** `POST /api/properties/:id/documents/upload` with category `OM` or `Brochure` → extract text → senior-analyst LLM → merge into `property.details.rentalFinancials`.
  - **From broker email:** Process-inbox (cron or `POST /cron/process-inbox`) matches replies by subject, broker-from, or thread; saves email and PDF attachments as inquiry docs; if combined (body + attachments) text is readable (≥50 chars), runs the **same** senior-analyst LLM with enrichment context and merges into the property. If nothing can be read from the OM, OM-style extraction is skipped.
  - **After run-enrichment:** For each property, `refreshOmFinancialsForProperty` runs: it finds **uploaded** OM/Brochure docs (from disk or DB), extracts text, and runs the same senior-analyst LLM, then merges into the property. Run-enrichment does not run rental flow (RapidAPI + listing LLM); use "Re-run rental flow" for that.

**Persistence:** OM-style financials (from manual upload or broker-email) are saved to `property.details.rentalFinancials` so the user can recall them on each property and re-run enrichment if there are any issues.

---

## Summary

| Source              | Trigger                                    | What runs                         | Where it shows up                          |
|---------------------|--------------------------------------------|-----------------------------------|--------------------------------------------|
| Rental flow         | Add to canonical, Re-run rental flow       | RapidAPI + LLM on listing text    | `rentalFinancials.fromLlm`, rental units   |
| OM / senior-analyst | OM/Brochure upload, broker-email (process-inbox), Re-run enrich | Senior-analyst LLM on OM text     | `rentalFinancials.omAnalysis`, financials  |

The UI (`CanonicalPropertyDetail`) shows **OM analyst** output first when present (`omAnalysis.uiFinancialSummary`, rent roll, expenses, takeaways), then falls back to **rental-flow** `fromLlm` when there is no OM analysis.
