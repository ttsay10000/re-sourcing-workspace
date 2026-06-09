import { describe, expect, it } from "vitest";
import {
  getPropertyDossierAssumptions,
  getRawPropertyDossierAssumptions,
  getPropertyDossierSummary,
  hasManualDossierAssumptionField,
  hasCompletedDealDossier,
  mergeDossierAssumptionOverrides,
  propertyAssumptionsToOverrides,
} from "./propertyDossierState.js";

describe("propertyDossierState", () => {
  it("extracts persisted property-level renovation and furnishing assumptions", () => {
    const assumptions = getPropertyDossierAssumptions({
      dealDossier: {
        assumptions: {
          buildingSqft: 7_800,
          purchasePrice: 4_250_000,
          purchaseClosingCostPct: 2.5,
          renovationCosts: 15_000,
          furnishingSetupCosts: 27_500,
          investmentProfile: "Value-add",
          targetAcquisitionDate: "2026-05-15",
          ltvPct: 68,
          interestRatePct: 6.25,
          amortizationYears: 30,
          loanFeePct: 1,
          rentUpliftPct: 18,
          expenseIncreasePct: 6,
          managementFeePct: 5,
          occupancyTaxPct: 6,
          vacancyPct: 3,
          leadTimeMonths: 4,
          annualRentGrowthPct: 3,
          annualOtherIncomeGrowthPct: 2,
          annualExpenseGrowthPct: 2.5,
          annualPropertyTaxGrowthPct: 4,
          recurringCapexAnnual: 18_000,
          currentNoi: 118_000,
          holdPeriodYears: 5,
          exitCapPct: 5.25,
          exitClosingCostPct: 2,
          targetIrrPct: 22,
          unitModelRows: [
            {
              rowId: "retail-1",
              unitLabel: "Retail",
              currentAnnualRent: 120_000,
              underwrittenAnnualRent: 120_000,
              isProtected: true,
              isCommercial: true,
            },
            {
              rowId: "rs-2",
              unitLabel: "Unit 2",
              currentAnnualRent: 24_000,
              underwrittenAnnualRent: 24_000,
              isProtected: true,
              isRentStabilized: true,
            },
          ],
          brokerEmailNotes: "  Broker shared current gross rent of $180,000 and expenses of $62,000.  ",
          updatedAt: "2026-03-11T00:00:00.000Z",
        },
      },
    });

    expect(assumptions).toEqual({
      buildingSqft: 7_800,
      purchasePrice: 4_250_000,
      purchaseClosingCostPct: 2.5,
      renovationCosts: 15_000,
      furnishingSetupCosts: 27_500,
      investmentProfile: "Value-add",
      targetAcquisitionDate: "2026-05-15",
      ltvPct: 68,
      interestRatePct: 6.25,
      amortizationYears: 30,
      loanFeePct: 1,
      rentUpliftPct: 18,
      expenseIncreasePct: 6,
      managementFeePct: 5,
      occupancyTaxPct: 6,
      vacancyPct: 3,
      leadTimeMonths: 4,
      annualRentGrowthPct: 3,
      annualOtherIncomeGrowthPct: 2,
      annualExpenseGrowthPct: 2.5,
      annualPropertyTaxGrowthPct: 4,
      recurringCapexAnnual: 18_000,
      currentNoi: 118_000,
      holdPeriodYears: 5,
      exitCapPct: 5.25,
      exitClosingCostPct: 2,
      targetIrrPct: 22,
      unitModelRows: [
        {
          rowId: "retail-1",
          unitLabel: "Retail",
          building: null,
          unitCategory: null,
          tenantName: null,
          currentAnnualRent: 120_000,
          underwrittenAnnualRent: 120_000,
          rentUpliftPct: null,
          occupancyPct: null,
          furnishingCost: null,
          onboardingLaborFee: null,
          onboardingOtherCosts: null,
          onboardingFee: null,
          monthlyRecurringOpex: null,
          monthlyHospitalityExpense: null,
          includeInUnderwriting: null,
          isProtected: true,
          isCommercial: true,
          isRentStabilized: null,
          beds: null,
          baths: null,
          sqft: null,
          tenantStatus: null,
          notes: null,
        },
        {
          rowId: "rs-2",
          unitLabel: "Unit 2",
          building: null,
          unitCategory: null,
          tenantName: null,
          currentAnnualRent: 24_000,
          underwrittenAnnualRent: 24_000,
          rentUpliftPct: null,
          occupancyPct: null,
          furnishingCost: null,
          onboardingLaborFee: null,
          onboardingOtherCosts: null,
          onboardingFee: null,
          monthlyRecurringOpex: null,
          monthlyHospitalityExpense: null,
          includeInUnderwriting: null,
          isProtected: true,
          isCommercial: null,
          isRentStabilized: true,
          beds: null,
          baths: null,
          sqft: null,
          tenantStatus: null,
          notes: null,
        },
      ],
      expenseModelRows: null,
      brokerEmailNotes: "Broker shared current gross rent of $180,000 and expenses of $62,000.",
      updatedAt: "2026-03-11T00:00:00.000Z",
    });
    expect(propertyAssumptionsToOverrides(assumptions)).toEqual({
      buildingSqft: 7_800,
      purchasePrice: 4_250_000,
      purchaseClosingCostPct: 2.5,
      renovationCosts: 15_000,
      furnishingSetupCosts: 27_500,
      investmentProfile: "Value-add",
      targetAcquisitionDate: "2026-05-15",
      ltvPct: 68,
      interestRatePct: 6.25,
      amortizationYears: 30,
      loanFeePct: 1,
      rentUpliftPct: 18,
      expenseIncreasePct: 6,
      managementFeePct: 5,
      occupancyTaxPct: 6,
      vacancyPct: 3,
      leadTimeMonths: 4,
      annualRentGrowthPct: 3,
      annualOtherIncomeGrowthPct: 2,
      annualExpenseGrowthPct: 2.5,
      annualPropertyTaxGrowthPct: 4,
      recurringCapexAnnual: 18_000,
      currentNoi: 118_000,
      holdPeriodYears: 5,
      exitCapPct: 5.25,
      exitClosingCostPct: 2,
      targetIrrPct: 22,
    });
  });

  it("merges request overrides over property-level defaults without letting null erase them", () => {
    const merged = mergeDossierAssumptionOverrides(
      {
        renovationCosts: 10_000,
        furnishingSetupCosts: 24_000,
        investmentProfile: "Core-plus",
      },
      {
        renovationCosts: null,
        furnishingSetupCosts: 30_000,
        investmentProfile: null,
        targetAcquisitionDate: "2026-06-01",
        targetIrrPct: 22,
      }
    );

    expect(merged).toEqual({
      renovationCosts: 10_000,
      furnishingSetupCosts: 30_000,
      investmentProfile: "Core-plus",
      targetAcquisitionDate: "2026-06-01",
      targetIrrPct: 22,
    });
  });

  it("exposes raw assumptions so custom underwriting fields can survive persistence merges", () => {
    const details = {
      dealDossier: {
        assumptions: {
          purchasePrice: 1_250_000,
          customDebtNote: "Seller financing possible",
          customRevenueCases: [{ label: "Upside", amount: 42_000 }],
        },
      },
    };

    expect(getPropertyDossierAssumptions(details)?.purchasePrice).toBe(1_250_000);
    expect(getRawPropertyDossierAssumptions(details)).toEqual({
      purchasePrice: 1_250_000,
      customDebtNote: "Seller financing possible",
      customRevenueCases: [{ label: "Upside", amount: 42_000 }],
    });
  });

  it("can exclude unmarked saved purchase price from dossier overrides", () => {
    const assumptions = getPropertyDossierAssumptions({
      dealDossier: {
        assumptions: {
          purchasePrice: 1_250_000,
          renovationCosts: 25_000,
        },
      },
    });

    expect(propertyAssumptionsToOverrides(assumptions, { includePurchasePrice: false })).toEqual({
      renovationCosts: 25_000,
    });
  });

  it("detects manual purchase price metadata from assumptions", () => {
    expect(
      hasManualDossierAssumptionField(
        {
          dealDossier: {
            assumptions: {
              purchasePrice: 1_250_000,
              manualFields: ["purchasePrice"],
            },
          },
        },
        "purchasePrice"
      )
    ).toBe(true);
    expect(
      hasManualDossierAssumptionField(
        {
          dealDossier: {
            assumptions: {
              purchasePrice: 1_250_000,
              fieldSources: { purchasePrice: "manual_override" },
            },
          },
        },
        "purchasePrice"
      )
    ).toBe(true);
    expect(
      hasManualDossierAssumptionField(
        {
          dealDossier: {
            assumptions: {
              purchasePrice: 1_250_000,
            },
          },
        },
        "purchasePrice"
      )
    ).toBe(false);
  });

  it("keeps manual unit row edits even when the edited row has no rent amount", () => {
    const assumptions = getPropertyDossierAssumptions({
      dealDossier: {
        assumptions: {
          unitModelRows: [
            {
              rowId: "manual-vacant-owner-unit",
              unitLabel: "Owner unit",
              includeInUnderwriting: false,
              isProtected: false,
              isCommercial: false,
              isRentStabilized: false,
              beds: 2,
              baths: 1,
              sqft: 850,
              tenantStatus: "Vacant",
              notes: "Hold out of underwriting while reviewing use.",
            },
          ],
          expenseModelRows: [
            {
              rowId: "expense-insurance",
              lineItem: "Insurance",
              amount: 0,
              annualGrowthPct: 4,
              treatment: "operating",
            },
          ],
          updatedAt: "2026-05-27T00:00:00.000Z",
        },
      },
    });

    expect(assumptions?.unitModelRows).toEqual([
      {
        rowId: "manual-vacant-owner-unit",
        unitLabel: "Owner unit",
        building: null,
        unitCategory: null,
        tenantName: null,
        currentAnnualRent: null,
        underwrittenAnnualRent: null,
        rentUpliftPct: null,
        occupancyPct: null,
        furnishingCost: null,
        onboardingLaborFee: null,
        onboardingOtherCosts: null,
        onboardingFee: null,
        monthlyRecurringOpex: null,
        monthlyHospitalityExpense: null,
        includeInUnderwriting: false,
        isProtected: false,
        isCommercial: false,
        isRentStabilized: false,
        beds: 2,
        baths: 1,
        sqft: 850,
        tenantStatus: "Vacant",
        notes: "Hold out of underwriting while reviewing use.",
      },
    ]);
    expect(assumptions?.expenseModelRows?.[0]?.amount).toBe(0);
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
