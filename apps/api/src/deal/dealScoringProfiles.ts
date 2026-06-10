import type { DealScoringPreferences } from "@re-sourcing/contracts";

export type DealScoringProfileKey = "legacy_v3" | "value_add_furnished_monthly_rental";

export interface MinScoreBand {
  min: number;
  score: number;
}

export interface MaxScoreBand {
  max: number;
  score: number;
}

export interface DealScoringProfile {
  key: DealScoringProfileKey;
  label: string;
  scoreVersion: string;
  maxCompositeScore: number;
  returnScores: {
    irrPct: MinScoreBand[];
    cocPct: MinScoreBand[];
    askCapRatePct: MinScoreBand[];
    adjustedCapRatePct: MinScoreBand[];
    requiredDiscountPct: MaxScoreBand[];
    stabilizedSpreadBps: MinScoreBand[];
  };
  meaningfulPriceCut: {
    latestDecreaseMinPct: number;
    daysSinceDecreaseMax: number;
    currentDiscountFromOriginalAskMinPct: number;
  };
  marketLiquidity: {
    baseScore: number;
    maxScore: number;
    largeAssetMinUnits: number;
    largeAssetBonus: number;
    midsizeAssetMinUnits: number;
    midsizeAssetBonus: number;
    smallAssetBelowUnits: number;
    smallAssetPenalty: number;
    priceCutBonus: number;
  };
  smallResidentialOpportunity: {
    maxUnits: number;
    maxCommercialRevenueSharePct: number;
    maxRentStabilizedRevenueSharePct: number;
    minAdjustedCapRatePct: number;
    minIrrPct: number;
    baseScore: number;
    askCapRateBonusMinPct: number;
    askCapRateBonus: number;
    discountBonusMaxPct: number;
    discountBonus: number;
    rentUpliftBonusMaxPct: number;
    rentUpliftBonus: number;
    maxScore: number;
  };
  valueAddMultifamilyOpportunity: {
    enabled: boolean;
    minUnits: number;
    maxUnits: number;
    maxCommercialRevenueSharePct: number;
    maxRentStabilizedRevenueSharePct: number;
    minAdjustedCapRatePct: number;
    minIrrPct: number;
    minBlendedRentUpliftPct: number;
    maxUnsupportedRentGrowthPct: number;
    baseScore: number;
    meaningfulFurnishingCostBonusThreshold: number;
    furnishingCostBonus: number;
    maxScore: number;
  };
  assumptionPenalties: {
    blendedRentUpliftPct: {
      veryHigh: { above: number; penalty: number; label: string };
      aggressive: { above: number; penalty: number; label: string };
      elevated: { above: number; penalty: number; label: string };
      meaningful: { above: number; penalty: number; label: string };
    };
    rentRollCoverage: { below: number; penalty: number; label: string };
    vacancyPct: {
      veryLow: { below: number; penalty: number; label: string };
      low: { below: number; penalty: number; label: string };
    };
    exitCapSpread: {
      adjustedCapSevereBps: number;
      adjustedCapAnyBps: number;
      assetCapBps: number;
      penalty: number;
    };
    minimumAnnualExpenseGrowthPctWithoutRows: number;
    lowExpenseGrowthPenalty: number;
    lowExpenseGrowthLabel: string;
    stabilizedNoiRatioAbove: number;
    stabilizedNoiRatioPenalty: number;
    maxPenalty: number;
  };
  structuralPenalties: {
    rentStabilizedRevenueSharePct: {
      severeAbove: number;
      severePenalty: number;
      elevatedAbove: number;
      elevatedPenalty: number;
      anyAbove: number;
      anyPenalty: number;
    };
    commercialRevenueSharePct: {
      severeAbove: number;
      severePenalty: number;
      elevatedAtLeast: number;
      elevatedPenalty: number;
      moderateAtLeast: number;
      moderatePenalty: number;
    };
    largestUnitRevenueSharePct: {
      appliesWhenTotalUnitsAtLeast: number;
      severeAbove: number;
      severePenalty: number;
      elevatedAbove: number;
      elevatedPenalty: number;
      moderateAtLeast: number;
      moderatePenalty: number;
    };
    rollover12moRevenueSharePct: {
      severeAbove: number;
      severePenalty: number;
      elevatedAtLeast: number;
      elevatedPenalty: number;
    };
    rentRollCoveragePct: {
      severeBelow: number;
      severePenalty: number;
      elevatedBelow: number;
      elevatedPenalty: number;
    };
    missingLeaseDataMajorityPenalty: number;
    smallAssetUnder5AppliesWhenUnitsAtLeast: number;
    smallAssetPenalty: number;
    maxPenalty: number;
  };
  regulatoryPenalties: {
    hpdRentImpairingOpenPenalty: number;
    hpdOpenSevereAtLeast: number;
    hpdOpenSeverePenalty: number;
    hpdOpenAnyPenalty: number;
    dobRecentOrOpenSevereAtLeast: number;
    dobRecentOrOpenSeverePenalty: number;
    dobHistoryPenalty: number;
    litigationMaterialPenaltyThreshold: number;
    litigationMaterialPenalty: number;
    litigationHistoryPenalty: number;
    taxBurdenAbovePct: number;
    taxBurdenPenalty: number;
    explicitMismatchMinDiscrepancies: number;
    explicitMismatchPenalty: number;
    maxPenalty: number;
  };
  confidence: {
    startingScore: number;
    missingFinancialsDeduction: number;
    missingDetailedExpenseRowsDeduction: number;
    rentRollCoverageSevereBelow: number;
    rentRollCoverageSevereDeduction: number;
    rentRollCoverageElevatedBelow: number;
    rentRollCoverageElevatedDeduction: number;
    rapidOmMismatchDeduction: number;
    omDiscrepancyCountAtLeast: number;
    omDiscrepancyDeduction: number;
    missingLeaseDataMajorityDeduction: number;
    missingOccupancyDataMajorityDeduction: number;
    packageOmDeduction: number;
    missingEnrichmentDeduction: number;
    minScore: number;
  };
  caps: {
    financialViability: {
      maxScore: number;
      reason: string;
      irrBelowPct: number;
      equityMultipleBelow: number;
      requiredDiscountAbovePct: number;
    };
    weakReturnOrDiscount: {
      maxScore: number;
      reason: string;
      irrBelowPct: number;
      requiredDiscountAbovePct: number;
    };
    structuralConcentration: {
      maxScore: number;
      reason: string;
      commercialAndLargestUnitCommercialShareAbovePct: number;
      commercialAndLargestUnitLargestShareAbovePct: number;
      commercialShareAbovePct: number;
      rentStabilizedShareAbovePct: number;
      largestUnitAppliesWhenUnitsAtLeast: number;
      largestUnitShareAbovePct: number;
    };
    dataOrRegulatory: {
      maxScore: number;
      reason: string;
      confidenceBelow: number;
      rapidMismatchDiscrepancyCountAtLeast: number;
    };
    veryLowConfidence: {
      maxScore: number;
      reason: string;
      confidenceBelow: number;
    };
    unsupportedUpside: {
      maxScore: number;
      reason: string;
      blendedRentUpliftAbovePct: number;
      rentRollCoverageBelow: number;
    };
    rentStabilizationDoNotBuy?: {
      maxScore: number;
      reason: string;
    };
  };
  positiveSignals: {
    irrStrongMinPct: number;
    irrGoodMinPct: number;
    cocMinPct: number;
    askCapMinPct: number;
    adjustedCapMinPct: number;
    requiredDiscountMaxPct: number;
  };
}

export const LEGACY_V3_DEAL_SCORING_PROFILE: DealScoringProfile = {
  key: "legacy_v3",
  label: "Legacy deterministic v3",
  scoreVersion: "v3",
  maxCompositeScore: 80,
  returnScores: {
    irrPct: [
      { min: 25, score: 20 },
      { min: 20, score: 17 },
      { min: 15, score: 15 },
      { min: 12, score: 11 },
      { min: 8, score: 6 },
      { min: 0, score: 2 },
    ],
    cocPct: [
      { min: 10, score: 10 },
      { min: 8, score: 8 },
      { min: 6, score: 6 },
      { min: 4, score: 4 },
      { min: 2, score: 2 },
      { min: 0, score: 1 },
    ],
    askCapRatePct: [
      { min: 7, score: 15 },
      { min: 6.5, score: 13 },
      { min: 6, score: 11 },
      { min: 5.5, score: 9 },
      { min: 5, score: 6 },
      { min: 4.75, score: 4 },
      { min: 4.5, score: 3 },
      { min: 4, score: 1 },
    ],
    adjustedCapRatePct: [
      { min: 7.5, score: 18 },
      { min: 7, score: 18 },
      { min: 6.75, score: 17 },
      { min: 6.5, score: 16 },
      { min: 6.25, score: 14 },
      { min: 6, score: 12 },
      { min: 5.5, score: 8 },
      { min: 5, score: 5 },
      { min: 4.5, score: 2 },
    ],
    requiredDiscountPct: [
      { max: 0, score: 8 },
      { max: 5, score: 8 },
      { max: 10, score: 7 },
      { max: 20, score: 6 },
      { max: 30, score: 5 },
      { max: 40, score: 2 },
    ],
    stabilizedSpreadBps: [
      { min: 150, score: 4 },
      { min: 100, score: 3 },
      { min: 50, score: 2 },
      { min: 25, score: 1 },
    ],
  },
  meaningfulPriceCut: {
    latestDecreaseMinPct: 3,
    daysSinceDecreaseMax: 90,
    currentDiscountFromOriginalAskMinPct: 10,
  },
  marketLiquidity: {
    baseScore: 4,
    maxScore: 10,
    largeAssetMinUnits: 20,
    largeAssetBonus: 2,
    midsizeAssetMinUnits: 10,
    midsizeAssetBonus: 1,
    smallAssetBelowUnits: 3,
    smallAssetPenalty: 1,
    priceCutBonus: 1,
  },
  smallResidentialOpportunity: {
    maxUnits: 4,
    maxCommercialRevenueSharePct: 0.05,
    maxRentStabilizedRevenueSharePct: 0,
    minAdjustedCapRatePct: 6.5,
    minIrrPct: 15,
    baseScore: 10,
    askCapRateBonusMinPct: 4.75,
    askCapRateBonus: 2,
    discountBonusMaxPct: 15,
    discountBonus: 2,
    rentUpliftBonusMaxPct: 75,
    rentUpliftBonus: 2,
    maxScore: 16,
  },
  valueAddMultifamilyOpportunity: {
    enabled: false,
    minUnits: 5,
    maxUnits: 30,
    maxCommercialRevenueSharePct: 0.2,
    maxRentStabilizedRevenueSharePct: 0.2,
    minAdjustedCapRatePct: 6,
    minIrrPct: 14,
    minBlendedRentUpliftPct: 8,
    maxUnsupportedRentGrowthPct: 25,
    baseScore: 0,
    meaningfulFurnishingCostBonusThreshold: 25_000,
    furnishingCostBonus: 0,
    maxScore: 0,
  },
  assumptionPenalties: {
    blendedRentUpliftPct: {
      veryHigh: { above: 80, penalty: 3, label: "Very high blended rent uplift underwritten" },
      aggressive: { above: 60, penalty: 2, label: "Aggressive blended rent uplift underwritten" },
      elevated: { above: 45, penalty: 1, label: "Elevated blended rent uplift underwritten" },
      meaningful: { above: 30, penalty: 1, label: "Meaningful blended rent uplift underwritten" },
    },
    rentRollCoverage: { below: 0.75, penalty: 2, label: "Rent-roll coverage only" },
    vacancyPct: {
      veryLow: { below: 3, penalty: 2, label: "Vacancy assumption below 3%" },
      low: { below: 5, penalty: 1, label: "Vacancy assumption below 5%" },
    },
    exitCapSpread: {
      adjustedCapSevereBps: 150,
      adjustedCapAnyBps: 25,
      assetCapBps: 75,
      penalty: 1,
    },
    minimumAnnualExpenseGrowthPctWithoutRows: 2,
    lowExpenseGrowthPenalty: 2,
    lowExpenseGrowthLabel: "Expense growth under 2% without detailed expense rows",
    stabilizedNoiRatioAbove: 1.5,
    stabilizedNoiRatioPenalty: 1,
    maxPenalty: 6,
  },
  structuralPenalties: {
    rentStabilizedRevenueSharePct: {
      severeAbove: 0.5,
      severePenalty: 4,
      elevatedAbove: 0.25,
      elevatedPenalty: 2,
      anyAbove: 0,
      anyPenalty: 1,
    },
    commercialRevenueSharePct: {
      severeAbove: 0.5,
      severePenalty: 4,
      elevatedAtLeast: 0.3,
      elevatedPenalty: 2,
      moderateAtLeast: 0.15,
      moderatePenalty: 1,
    },
    largestUnitRevenueSharePct: {
      appliesWhenTotalUnitsAtLeast: 4,
      severeAbove: 0.45,
      severePenalty: 3,
      elevatedAbove: 0.35,
      elevatedPenalty: 2,
      moderateAtLeast: 0.25,
      moderatePenalty: 1,
    },
    rollover12moRevenueSharePct: {
      severeAbove: 0.4,
      severePenalty: 2,
      elevatedAtLeast: 0.25,
      elevatedPenalty: 1,
    },
    rentRollCoveragePct: {
      severeBelow: 0.5,
      severePenalty: 2,
      elevatedBelow: 0.75,
      elevatedPenalty: 1,
    },
    missingLeaseDataMajorityPenalty: 1,
    smallAssetUnder5AppliesWhenUnitsAtLeast: 3,
    smallAssetPenalty: 1,
    maxPenalty: 8,
  },
  regulatoryPenalties: {
    hpdRentImpairingOpenPenalty: 5,
    hpdOpenSevereAtLeast: 5,
    hpdOpenSeverePenalty: 3,
    hpdOpenAnyPenalty: 1,
    dobRecentOrOpenSevereAtLeast: 3,
    dobRecentOrOpenSeverePenalty: 3,
    dobHistoryPenalty: 1,
    litigationMaterialPenaltyThreshold: 5_000,
    litigationMaterialPenalty: 3,
    litigationHistoryPenalty: 1,
    taxBurdenAbovePct: 25,
    taxBurdenPenalty: 1,
    explicitMismatchMinDiscrepancies: 2,
    explicitMismatchPenalty: 1,
    maxPenalty: 8,
  },
  confidence: {
    startingScore: 1,
    missingFinancialsDeduction: 0.2,
    missingDetailedExpenseRowsDeduction: 0.1,
    rentRollCoverageSevereBelow: 0.5,
    rentRollCoverageSevereDeduction: 0.2,
    rentRollCoverageElevatedBelow: 0.75,
    rentRollCoverageElevatedDeduction: 0.1,
    rapidOmMismatchDeduction: 0.15,
    omDiscrepancyCountAtLeast: 2,
    omDiscrepancyDeduction: 0.1,
    missingLeaseDataMajorityDeduction: 0.1,
    missingOccupancyDataMajorityDeduction: 0.05,
    packageOmDeduction: 0.1,
    missingEnrichmentDeduction: 0.1,
    minScore: 0.1,
  },
  caps: {
    financialViability: {
      maxScore: 35,
      reason: "Financial viability cap",
      irrBelowPct: 0,
      equityMultipleBelow: 1,
      requiredDiscountAbovePct: 50,
    },
    weakReturnOrDiscount: {
      maxScore: 50,
      reason: "Weak return / discount cap",
      irrBelowPct: 8,
      requiredDiscountAbovePct: 40,
    },
    structuralConcentration: {
      maxScore: 68,
      reason: "Structural concentration cap",
      commercialAndLargestUnitCommercialShareAbovePct: 0.5,
      commercialAndLargestUnitLargestShareAbovePct: 0.35,
      commercialShareAbovePct: 0.6,
      rentStabilizedShareAbovePct: 0.5,
      largestUnitAppliesWhenUnitsAtLeast: 4,
      largestUnitShareAbovePct: 0.6,
    },
    dataOrRegulatory: {
      maxScore: 60,
      reason: "Data / regulatory cap",
      confidenceBelow: 0.4,
      rapidMismatchDiscrepancyCountAtLeast: 2,
    },
    veryLowConfidence: {
      maxScore: 50,
      reason: "Very low confidence cap",
      confidenceBelow: 0.25,
    },
    unsupportedUpside: {
      maxScore: 65,
      reason: "Unsupported upside cap",
      blendedRentUpliftAbovePct: 65,
      rentRollCoverageBelow: 0.6,
    },
  },
  positiveSignals: {
    irrStrongMinPct: 20,
    irrGoodMinPct: 15,
    cocMinPct: 8,
    askCapMinPct: 5.5,
    adjustedCapMinPct: 6.5,
    requiredDiscountMaxPct: 20,
  },
};

export const VALUE_ADD_FURNISHED_MONTHLY_RENTAL_SCORING_PROFILE: DealScoringProfile = {
  ...LEGACY_V3_DEAL_SCORING_PROFILE,
  key: "value_add_furnished_monthly_rental",
  label: "Value-add multifamily / furnished monthly rental",
  scoreVersion: "v3:value-add-furnished-monthly-rental",
  maxCompositeScore: 84,
  returnScores: {
    ...LEGACY_V3_DEAL_SCORING_PROFILE.returnScores,
    irrPct: [
      { min: 25, score: 20 },
      { min: 20, score: 18 },
      { min: 15, score: 15 },
      { min: 12, score: 10 },
      { min: 8, score: 5 },
      { min: 0, score: 1 },
    ],
    adjustedCapRatePct: [
      { min: 7.5, score: 18 },
      { min: 7, score: 17 },
      { min: 6.75, score: 16 },
      { min: 6.5, score: 15 },
      { min: 6.25, score: 13 },
      { min: 6, score: 11 },
      { min: 5.5, score: 8 },
      { min: 5, score: 5 },
      { min: 4.5, score: 2 },
    ],
  },
  valueAddMultifamilyOpportunity: {
    enabled: true,
    minUnits: 5,
    maxUnits: 30,
    maxCommercialRevenueSharePct: 0.2,
    maxRentStabilizedRevenueSharePct: 0.2,
    minAdjustedCapRatePct: 5.75,
    minIrrPct: 14,
    minBlendedRentUpliftPct: 10,
    maxUnsupportedRentGrowthPct: 25,
    baseScore: 4,
    meaningfulFurnishingCostBonusThreshold: 25_000,
    furnishingCostBonus: 2,
    maxScore: 6,
  },
  assumptionPenalties: {
    ...LEGACY_V3_DEAL_SCORING_PROFILE.assumptionPenalties,
    blendedRentUpliftPct: {
      veryHigh: { above: 100, penalty: 3, label: "Very high furnished-rent uplift underwritten" },
      aggressive: { above: 80, penalty: 2, label: "Aggressive furnished-rent uplift underwritten" },
      elevated: { above: 60, penalty: 1, label: "Elevated furnished-rent uplift underwritten" },
      meaningful: { above: 40, penalty: 1, label: "Meaningful furnished-rent uplift underwritten" },
    },
    vacancyPct: {
      veryLow: { below: 5, penalty: 2, label: "Furnished-rental vacancy assumption below 5%" },
      low: { below: 7, penalty: 1, label: "Furnished-rental vacancy assumption below 7%" },
    },
    minimumAnnualExpenseGrowthPctWithoutRows: 3,
    lowExpenseGrowthPenalty: 3,
    lowExpenseGrowthLabel:
      "Expense growth under 3% without detailed monthly-rental operating rows",
    maxPenalty: 7,
  },
  caps: {
    ...LEGACY_V3_DEAL_SCORING_PROFILE.caps,
    unsupportedUpside: {
      maxScore: 62,
      reason: "Unsupported furnished-rent upside cap",
      blendedRentUpliftAbovePct: 80,
      rentRollCoverageBelow: 0.7,
    },
  },
};

export const DEAL_SCORING_PROFILES: Record<DealScoringProfileKey, DealScoringProfile> = {
  legacy_v3: LEGACY_V3_DEAL_SCORING_PROFILE,
  value_add_furnished_monthly_rental: VALUE_ADD_FURNISHED_MONTHLY_RENTAL_SCORING_PROFILE,
};

function numericPreference(value: number | null | undefined, fallback: number, min: number, max: number): number {
  return value != null && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function dedupeMinBands(bands: MinScoreBand[]): MinScoreBand[] {
  const seen = new Set<number>();
  return bands
    .sort((left, right) => right.min - left.min)
    .filter((band) => {
      if (seen.has(band.min)) return false;
      seen.add(band.min);
      return true;
    });
}

export function buildDealScoringProfileFromPreferences(
  profile: DealScoringProfileKey | DealScoringProfile | null | undefined,
  preferences: DealScoringPreferences | null | undefined
): DealScoringProfile {
  const base = resolveDealScoringProfile(
    profile ??
      (typeof preferences?.scoringProfileKey === "string"
        ? (preferences.scoringProfileKey as DealScoringProfileKey)
        : null)
  );
  const targetIrrPct = numericPreference(preferences?.targetIrrPct, 25, 0, 100);
  const goodCashOnCashPct = numericPreference(preferences?.goodCashOnCashPct, 2, 0, 100);
  const cashOnCashGoodScore = Math.max(
    ...base.returnScores.cocPct.map((band) => band.score),
    10
  );
  const cocBands =
    goodCashOnCashPct > 0
      ? dedupeMinBands([
          { min: goodCashOnCashPct, score: cashOnCashGoodScore },
          { min: goodCashOnCashPct * 0.75, score: Math.max(1, Math.round(cashOnCashGoodScore * 0.8)) },
          { min: goodCashOnCashPct * 0.5, score: Math.max(1, Math.round(cashOnCashGoodScore * 0.6)) },
          { min: goodCashOnCashPct * 0.25, score: Math.max(1, Math.round(cashOnCashGoodScore * 0.4)) },
          { min: 0, score: 1 },
        ])
      : base.returnScores.cocPct;
  return {
    ...base,
    label: `${base.label} + profile preferences`,
    scoreVersion: `${base.scoreVersion}:prefs-irr${targetIrrPct}-coc${goodCashOnCashPct}${
      preferences?.rentStabilizationDoNotBuy ? "-rs-dnb" : ""
    }`,
    returnScores: {
      ...base.returnScores,
      irrPct: dedupeMinBands([
        { min: targetIrrPct, score: 20 },
        { min: Math.max(0, targetIrrPct - 5), score: 17 },
        { min: Math.max(0, targetIrrPct - 10), score: 15 },
        { min: Math.max(0, targetIrrPct - 13), score: 11 },
        { min: Math.max(0, targetIrrPct - 17), score: 6 },
        { min: 0, score: 2 },
      ]),
      cocPct: cocBands,
    },
    caps: {
      ...base.caps,
      rentStabilizationDoNotBuy: preferences?.rentStabilizationDoNotBuy
        ? {
            maxScore: 35,
            reason: "Rent stabilization/control do-not-buy cap",
          }
        : undefined,
    },
  };
}

export function resolveDealScoringProfile(
  profile: DealScoringProfileKey | DealScoringProfile | null | undefined
): DealScoringProfile {
  if (!profile) return LEGACY_V3_DEAL_SCORING_PROFILE;
  if (typeof profile === "string") return DEAL_SCORING_PROFILES[profile] ?? LEGACY_V3_DEAL_SCORING_PROFILE;
  return profile;
}
