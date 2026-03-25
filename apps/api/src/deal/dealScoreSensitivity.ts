import type { DealScoreSensitivity, DealScoreSensitivityScenario, PropertyDetails } from "@re-sourcing/contracts";
import { computeDealSignals, type PropertyListingInput } from "./computeDealSignals.js";
import {
  computeBlendedRentUpliftPct,
  computeRecommendedOffer,
  computeUnderwritingProjection,
  resolveAssetCapRateNoiBasis,
  type ProjectedExpenseInputRow,
  type ProjectedUnitInputRow,
  type ResolvedDossierAssumptions,
} from "./underwritingModel.js";

interface BuildDealScoreSensitivityInput {
  propertyId: string;
  canonicalAddress: string | null;
  details: PropertyDetails | null;
  primaryListing: PropertyListingInput;
  assumptions: ResolvedDossierAssumptions;
  currentGrossRent: number | null;
  currentNoi: number | null;
  currentOtherIncome?: number | null;
  currentExpensesTotal?: number | null;
  expenseRows?: ProjectedExpenseInputRow[] | null;
  unitRows?: ProjectedUnitInputRow[] | null;
  conservativeProjectedLeaseUpRent?: number | null;
  protectedProjectedLeaseUpRent?: number | null;
  baseCalculatedScore: number | null;
}

function scenarioResult(
  key: DealScoreSensitivityScenario["key"],
  label: string,
  adjustedValue: number | null,
  score: number | null,
  baseScore: number | null
): DealScoreSensitivityScenario {
  return {
    key,
    label,
    adjustedValue,
    score,
    delta:
      score != null && baseScore != null && Number.isFinite(score) && Number.isFinite(baseScore)
        ? score - baseScore
        : null,
  };
}

function scoreForScenario(
  input: Omit<BuildDealScoreSensitivityInput, "baseCalculatedScore">,
  assumptions: ResolvedDossierAssumptions
): number | null {
  const projection = computeUnderwritingProjection({
    assumptions,
    currentGrossRent: input.currentGrossRent,
    currentNoi: input.currentNoi,
    currentOtherIncome: input.currentOtherIncome,
    currentExpensesTotal: input.currentExpensesTotal,
    expenseRows: input.expenseRows,
    unitRows: input.unitRows,
    conservativeProjectedLeaseUpRent: input.conservativeProjectedLeaseUpRent,
    protectedProjectedLeaseUpRent: input.protectedProjectedLeaseUpRent,
  });
  const recommendedOffer = computeRecommendedOffer({
    assumptions,
    currentGrossRent: input.currentGrossRent,
    currentNoi: input.currentNoi,
    currentOtherIncome: input.currentOtherIncome,
    currentExpensesTotal: input.currentExpensesTotal,
    expenseRows: input.expenseRows,
    unitRows: input.unitRows,
    conservativeProjectedLeaseUpRent: input.conservativeProjectedLeaseUpRent,
    protectedProjectedLeaseUpRent: input.protectedProjectedLeaseUpRent,
  });
  const adjustedCapRatePct =
    assumptions.acquisition.purchasePrice != null && assumptions.acquisition.purchasePrice > 0
      ? (projection.operating.stabilizedNoi / assumptions.acquisition.purchasePrice) * 100
      : null;
  const { scoringResult } = computeDealSignals({
    propertyId: input.propertyId,
    canonicalAddress: input.canonicalAddress,
    details: input.details,
    primaryListing: input.primaryListing,
    assetCapRateNoi: resolveAssetCapRateNoiBasis({
      currentNoi: input.currentNoi,
      currentGrossRent: input.currentGrossRent,
      currentOtherIncome: input.currentOtherIncome,
      currentExpensesTotal: input.currentExpensesTotal,
      conservativeProjectedLeaseUpRent: input.conservativeProjectedLeaseUpRent,
    }),
    irrPct: projection.returns.irr ?? null,
    cocPct: projection.returns.averageCashOnCashReturn ?? null,
    equityMultiple: projection.returns.equityMultiple ?? null,
    adjustedCapRatePct,
    adjustedNoi: projection.operating.stabilizedNoi ?? null,
    recommendedOfferHigh: recommendedOffer.recommendedOfferHigh,
    blendedRentUpliftPct: projection.assumptions.operating.blendedRentUpliftPct,
    annualExpenseGrowthPct: assumptions.operating.annualExpenseGrowthPct,
    vacancyPct: assumptions.operating.vacancyPct,
    exitCapRatePct: assumptions.exit.exitCapPct,
    rentStabilizedUnitCount: assumptions.propertyMix.rentStabilizedUnits,
    commercialUnitCount: assumptions.propertyMix.commercialUnits,
  });
  return scoringResult.isScoreable ? scoringResult.dealScore : null;
}

export function buildDealScoreSensitivity(input: BuildDealScoreSensitivityInput): DealScoreSensitivity {
  const { assumptions, baseCalculatedScore } = input;
  const scenarioBaseInput = {
    propertyId: input.propertyId,
    canonicalAddress: input.canonicalAddress,
    details: input.details,
    primaryListing: input.primaryListing,
    assumptions,
    currentGrossRent: input.currentGrossRent,
    currentNoi: input.currentNoi,
    currentOtherIncome: input.currentOtherIncome,
    currentExpensesTotal: input.currentExpensesTotal,
    expenseRows: input.expenseRows,
    unitRows: input.unitRows,
    conservativeProjectedLeaseUpRent: input.conservativeProjectedLeaseUpRent,
    protectedProjectedLeaseUpRent: input.protectedProjectedLeaseUpRent,
  };

  const rentUpliftPct = Math.max(0, assumptions.operating.rentUpliftPct - 20);
  const rentScenarioAssumptions: ResolvedDossierAssumptions = {
    ...assumptions,
    operating: {
      ...assumptions.operating,
      rentUpliftPct,
      blendedRentUpliftPct: computeBlendedRentUpliftPct(rentUpliftPct, assumptions.propertyMix),
    },
  };

  const exitCapPct = assumptions.exit.exitCapPct + 0.5;
  const exitScenarioAssumptions: ResolvedDossierAssumptions = {
    ...assumptions,
    exit: {
      ...assumptions.exit,
      exitCapPct,
    },
  };

  const annualExpenseGrowthPct = assumptions.operating.annualExpenseGrowthPct + 2;
  const expenseScenarioAssumptions: ResolvedDossierAssumptions = {
    ...assumptions,
    operating: {
      ...assumptions.operating,
      annualExpenseGrowthPct,
    },
  };

  const rentScenarioScore = scoreForScenario(
    {
      ...scenarioBaseInput,
      unitRows:
        input.unitRows?.map((row) =>
          row.includeInUnderwriting === false || row.isProtected === true
            ? row
            : { ...row, rentUpliftPct }
        ) ?? null,
    },
    rentScenarioAssumptions
  );
  const exitScenarioScore = scoreForScenario(scenarioBaseInput, exitScenarioAssumptions);
  const expenseScenarioScore = scoreForScenario(scenarioBaseInput, expenseScenarioAssumptions);

  return {
    rentUpliftDown20Pts: scenarioResult(
      "rentUpliftDown20Pts",
      "Rent uplift down 20 pts",
      rentUpliftPct,
      rentScenarioScore,
      baseCalculatedScore
    ),
    exitCapUp50Bps: scenarioResult(
      "exitCapUp50Bps",
      "Exit cap up 50 bps",
      exitCapPct,
      exitScenarioScore,
      baseCalculatedScore
    ),
    expenseGrowthUp200Bps: scenarioResult(
      "expenseGrowthUp200Bps",
      "Annual expense growth up 200 bps",
      annualExpenseGrowthPct,
      expenseScenarioScore,
      baseCalculatedScore
    ),
  };
}
