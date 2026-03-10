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
  - **Automatically** when you **re-run enrichment** (`POST /api/properties/run-enrichment`) – after the 7 modules and OM refresh, rental flow runs for each property.
- **On-demand:** The "Re-run rental flow" button (or `POST /api/properties/run-rental-flow`) re-runs only the rental flow for selected or all properties, without re-running full enrichment.

So the rental-flow LLM runs for **every property** as part of add-to-canonical and re-run-enrichment; no separate button is required for the initial run.

---

## 2. OM / senior-analyst LLM (when OM is available and uploaded)

- **What it does:** When the user **uploads** an OM or Brochure document, we extract text and run the **senior-analyst** LLM (`extractRentalFinancialsFromText` with `forceOmStyle: true`). The analyst reads the OM (and optional enrichment context) and populates:
  - `rentalFinancials.omAnalysis` – full structured output: `uiFinancialSummary`, rent roll, expenses, investment takeaways, etc.
  - `rentalFinancials.fromLlm` – derived top-line financials used elsewhere (dossier, deal signals).
- **When it runs:**
  - **On upload:** `POST /api/properties/:id/documents/upload` with category `OM` or `Brochure` → extract text → senior-analyst LLM → merge into `property.details.rentalFinancials`.
  - **After run-enrichment:** For each property, `refreshOmFinancialsForProperty` runs: it finds uploaded OM/Brochure docs whose file exists on disk, extracts text, and runs the same senior-analyst LLM, then merges into the property. So if an OM is uploaded, the **full analyst LLM** is what populates the property card financial section (top-line financials, rent roll, expenses, takeaways).

So: **if the OM is available and uploaded, the full analyst LLM reads it and populates the property card under the financial section.** No separate “run OM analysis” button is required; it runs on upload and again when you re-run enrichment (for docs that exist on disk).

---

## Summary

| Source              | Trigger                          | What runs                         | Where it shows up                          |
|---------------------|----------------------------------|-----------------------------------|--------------------------------------------|
| Rental flow         | Add to canonical, Re-run enrich | RapidAPI + LLM on listing text    | `rentalFinancials.fromLlm`, rental units   |
| OM / senior-analyst | OM/Brochure upload, Re-run enrich| Senior-analyst LLM on OM text     | `rentalFinancials.omAnalysis`, financials  |

The UI (`CanonicalPropertyDetail`) shows **OM analyst** output first when present (`omAnalysis.uiFinancialSummary`, rent roll, expenses, takeaways), then falls back to **rental-flow** `fromLlm` when there is no OM analysis.
