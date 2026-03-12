import { describe, expect, it } from "vitest";
import {
  getPropertyDossierAssumptions,
  getPropertyDossierSummary,
  hasCompletedDealDossier,
  mergeDossierAssumptionOverrides,
  propertyAssumptionsToOverrides,
} from "./propertyDossierState.js";

describe("propertyDossierState", () => {
  it("extracts persisted property-level renovation and furnishing assumptions", () => {
    const assumptions = getPropertyDossierAssumptions({
      dealDossier: {
        assumptions: {
          renovationCosts: 15_000,
          furnishingSetupCosts: 27_500,
          updatedAt: "2026-03-11T00:00:00.000Z",
        },
      },
    });

    expect(assumptions).toEqual({
      renovationCosts: 15_000,
      furnishingSetupCosts: 27_500,
      updatedAt: "2026-03-11T00:00:00.000Z",
    });
    expect(propertyAssumptionsToOverrides(assumptions)).toEqual({
      renovationCosts: 15_000,
      furnishingSetupCosts: 27_500,
    });
  });

  it("merges request overrides over property-level defaults without letting null erase them", () => {
    const merged = mergeDossierAssumptionOverrides(
      {
        renovationCosts: 10_000,
        furnishingSetupCosts: 24_000,
      },
      {
        renovationCosts: null,
        furnishingSetupCosts: 30_000,
        targetIrrPct: 22,
      }
    );

    expect(merged).toEqual({
      renovationCosts: 10_000,
      furnishingSetupCosts: 30_000,
      targetIrrPct: 22,
    });
  });

  it("extracts persisted dossier summary and completion state", () => {
    const details = {
      dealDossier: {
        generation: {
          status: "completed",
          dossierDocumentId: "dossier-1",
        },
        summary: {
          generatedAt: "2026-03-12T00:00:00.000Z",
          askingPrice: 4_500_000,
          recommendedOfferHigh: 4_050_000,
          targetMetAtAsking: false,
          annualDebtService: 180_000,
          irrPct: 0.1875,
          dealScore: 79,
        },
      },
    };

    expect(hasCompletedDealDossier(details)).toBe(true);
    expect(getPropertyDossierSummary(details)).toEqual({
      generatedAt: "2026-03-12T00:00:00.000Z",
      askingPrice: 4_500_000,
      purchasePrice: null,
      recommendedOfferLow: null,
      recommendedOfferHigh: 4_050_000,
      targetIrrPct: null,
      discountToAskingPct: null,
      irrAtAskingPct: null,
      targetMetAtAsking: false,
      currentNoi: null,
      adjustedNoi: null,
      stabilizedNoi: null,
      annualDebtService: 180_000,
      year1EquityYield: null,
      irrPct: 0.1875,
      equityMultiple: null,
      cocPct: null,
      holdYears: null,
      dealScore: 79,
      calculatedDealScore: null,
      dealSignalsId: null,
      dealSignalsGeneratedAt: null,
      dossierDocumentId: null,
      excelDocumentId: null,
    });
  });
});
