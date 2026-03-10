# Deal dossier & scoring – push verification

## What IS in the last push (commits 3da862e + 48fbd54)

### Adjusted cap rate
- **runGenerateDossier**: `adjustedCapRateForCtx` computed (adjustedNoi / purchasePrice × 100), passed into `ctx.adjustedCapRate` and `ctx.furnishedRental.adjustedCapRatePct`. ✅
- **furnishedRentalEstimator**: `adjustedNoi`, `adjustedCapRatePct` (adjustedNoi / purchasePrice × 100). ✅
- **dossierGenerator** (48fbd54): Key Metrics and Furnished Rental sections show "Adjusted cap rate" and "Adjusted cap: X%". ✅
- **underwritingContext** (48fbd54): `adjustedCapRate`, `furnishedRental.adjustedCapRatePct`. ✅
- **excelProForma**: Adjusted NOI and Adjusted cap rate (%) rows. ✅

### Deal scoring (3da862e)
- **dealScoringLlm.ts**: New file, LLM 0–100 score + rationale. ✅
- **dealScoringEngine.ts**: Asset cap 50 pts, IRR tiers, risk deductions, no adjusted yield/location/liquidity. ✅
- **computeDealSignals.ts**: New inputs (irr5yrPct, rentStabilizedUnitCount, HPD/DOB/litigation). ✅
- **runGenerateDossier**: Calls scoreDealWithLlm, finalScore, ctx.dealScore, insertParams.dealScore; replace "Deal score: —" with score. ✅
- **openaiModels.ts**: getDealScoringModel(). ✅
- **routes/properties.ts**: compute-score uses new inputs, dealScore: null for standalone. ✅

### Misc (48fbd54)
- dossierGenerator, dossierToPdf, mortgageAmortization, underwritingContext, rental, inquiry, web property-data, docs, contracts, runOmLlmOnPdf.mjs. ✅

---

## What was NOT in the last push (uncommitted)

1. **runGenerateDossier**: Return type and return value include `dealScore`; robust replace `/^Deal score: .*$/im` so any "Deal score: ..." line gets the final score in the PDF.
2. **routes/dossier.ts**: Response includes `dealScore`.
3. **dossier-assumptions/page.tsx**: Redirect to success page includes `deal_score` query param.
4. **dossier-success/page.tsx**: Displays "Deal score: X/100 (included in dossier PDF)."

These are committed and pushed in the follow-up commit so the full flow is on origin.
