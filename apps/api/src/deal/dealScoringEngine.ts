import type { DealRiskProfile, DealScoreBreakdown } from "@re-sourcing/contracts";
import {
  resolveDealScoringProfile,
  type DealScoringProfile,
  type DealScoringProfileKey,
  type MaxScoreBand,
  type MinScoreBand,
} from "./dealScoringProfiles.js";

export const DEAL_SCORE_VERSION = "v3";

/**
 * Deterministic deal scoring engine:
 * finance-led return score, moderate market/liquidity, structural/regulatory penalties, confidence, and hard caps.
 */

export interface DealScoringInputs {
  purchasePrice: number | null;
  noi: number | null;
  grossRentalIncome?: number | null;
  irrPct?: number | null;
  cocPct?: number | null;
  equityMultiple?: number | null;
  adjustedCapRatePct?: number | null;
  adjustedNoi?: number | null;
  recommendedOfferHigh?: number | null;
  blendedRentUpliftPct?: number | null;
  annualExpenseGrowthPct?: number | null;
  vacancyPct?: number | null;
  exitCapRatePct?: number | null;
  hasDetailedExpenseRows?: boolean;
  totalUnits?: number | null;
  rentStabilizedUnitCount?: number;
  commercialUnitCount?: number;
  hpdOpenCount?: number;
  hpdRentImpairingOpen?: number;
  hpdTotal?: number;
  dobOpenCount?: number;
  dobCount30?: number;
  dobCount365?: number;
  litigationOpenCount?: number;
  litigationTotal?: number;
  litigationTotalPenalty?: number;
  latestPriceDecreasePct?: number | null;
  daysSinceLatestPriceDecrease?: number | null;
  currentDiscountFromOriginalAskPct?: number | null;
  riskProfile?: DealRiskProfile | null;
  scoringProfile?: DealScoringProfileKey | DealScoringProfile | null;
  furnishingSetupCosts?: number | null;
}

export interface DealScoringResult {
  dealScore: number;
  isScoreable: boolean;
  assetYieldScore: number;
  adjustedYieldScore: number;
  rentUpsideScore: number;
  locationScore: number;
  riskScore: number;
  liquidityScore: number;
  positiveSignals: string[];
  negativeSignals: string[];
  assetCapRate: number | null;
  adjustedCapRate: number | null;
  requiredDiscountPct: number | null;
  confidenceScore: number;
  scoreBreakdown: DealScoreBreakdown;
  riskProfile: DealRiskProfile;
  riskFlags: string[];
  capReasons: string[];
  scoreVersion: string;
  scoringProfileKey: DealScoringProfileKey;
  scoringProfileLabel: string;
}

export interface FinalDealScoreInputs {
  llmScore?: number | null;
  deterministicScore?: number | null;
  irrPct?: number | null;
  equityMultiple?: number | null;
  requiredDiscountPct?: number | null;
}

interface PenaltyResult {
  value: number;
  flags: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asPct(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value * 100 : null;
}

function round2(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function normalizeCompositeScore(rawCompositeScore: number, profile: DealScoringProfile): number {
  if (!Number.isFinite(rawCompositeScore)) return 0;
  return clamp(Math.round((rawCompositeScore / profile.maxCompositeScore) * 100), 0, 100);
}

function assetCapRateAtAsk(inputs: DealScoringInputs): number | null {
  return inputs.purchasePrice != null && inputs.purchasePrice > 0 && inputs.noi != null && inputs.noi >= 0
    ? (inputs.noi / inputs.purchasePrice) * 100
    : null;
}

function requiredDiscountPct(inputs: DealScoringInputs): number | null {
  const ask = inputs.purchasePrice;
  const recommendedOfferHigh = inputs.recommendedOfferHigh;
  if (
    ask == null ||
    !Number.isFinite(ask) ||
    ask <= 0 ||
    recommendedOfferHigh == null ||
    !Number.isFinite(recommendedOfferHigh)
  ) {
    return null;
  }
  return Math.max(0, ((ask - recommendedOfferHigh) / ask) * 100);
}

function scoreAtLeast(value: number | null, bands: MinScoreBand[]): number {
  if (value == null) return 0;
  for (const band of bands) {
    if (value >= band.min) return band.score;
  }
  return 0;
}

function scoreAtMost(value: number | null, bands: MaxScoreBand[]): number {
  if (value == null) return 0;
  for (const band of bands) {
    if (value <= band.max) return band.score;
  }
  return 0;
}

function scoreIrr(irrPctDecimal: number | null | undefined, profile: DealScoringProfile): number {
  const irrPct = asPct(irrPctDecimal);
  return scoreAtLeast(irrPct, profile.returnScores.irrPct);
}

function scoreCoc(cocPctDecimal: number | null | undefined, profile: DealScoringProfile): number {
  const cocPct = asPct(cocPctDecimal);
  return scoreAtLeast(cocPct, profile.returnScores.cocPct);
}

function scoreAskCap(assetCapRate: number | null, profile: DealScoringProfile): number {
  return scoreAtLeast(assetCapRate, profile.returnScores.askCapRatePct);
}

function scoreAdjustedCap(adjustedCapRate: number | null, profile: DealScoringProfile): number {
  return scoreAtLeast(adjustedCapRate, profile.returnScores.adjustedCapRatePct);
}

function scoreRequiredDiscount(discountPct: number | null, profile: DealScoringProfile): number {
  return scoreAtMost(discountPct, profile.returnScores.requiredDiscountPct);
}

function scoreStabilizedSpread(
  assetCapRate: number | null,
  adjustedCapRate: number | null,
  profile: DealScoringProfile
): number {
  if (assetCapRate == null || adjustedCapRate == null) return 0;
  const spreadBps = (adjustedCapRate - assetCapRate) * 100;
  return scoreAtLeast(spreadBps, profile.returnScores.stabilizedSpreadBps);
}

function scoreSmallResidentialOpportunity(
  inputs: DealScoringInputs,
  assetCapRate: number | null,
  adjustedCapRate: number | null,
  discountPct: number | null,
  riskProfile: DealRiskProfile,
  profile: DealScoringProfile
): number {
  const config = profile.smallResidentialOpportunity;
  const totalUnits = inputs.totalUnits ?? riskProfile.totalUnits ?? null;
  const irrPct = asPct(inputs.irrPct);
  if (totalUnits == null || totalUnits > config.maxUnits) return 0;
  if ((riskProfile.commercialRevenueSharePct ?? 0) > config.maxCommercialRevenueSharePct) return 0;
  if ((riskProfile.rentStabilizedRevenueSharePct ?? 0) > config.maxRentStabilizedRevenueSharePct) return 0;
  if (adjustedCapRate == null || adjustedCapRate < config.minAdjustedCapRatePct) return 0;
  if (irrPct == null || irrPct < config.minIrrPct) return 0;

  let score = config.baseScore;
  if (assetCapRate != null && assetCapRate >= config.askCapRateBonusMinPct) {
    score += config.askCapRateBonus;
  }
  if (discountPct != null && discountPct <= config.discountBonusMaxPct) {
    score += config.discountBonus;
  }
  if ((inputs.blendedRentUpliftPct ?? 0) <= config.rentUpliftBonusMaxPct) {
    score += config.rentUpliftBonus;
  }
  return Math.min(config.maxScore, score);
}

function scoreValueAddMultifamilyOpportunity(
  inputs: DealScoringInputs,
  adjustedCapRate: number | null,
  riskProfile: DealRiskProfile,
  profile: DealScoringProfile
): number {
  const config = profile.valueAddMultifamilyOpportunity;
  if (!config.enabled) return 0;
  const totalUnits = inputs.totalUnits ?? riskProfile.totalUnits ?? null;
  const irrPct = asPct(inputs.irrPct);
  if (totalUnits == null || totalUnits < config.minUnits || totalUnits > config.maxUnits) return 0;
  if ((riskProfile.commercialRevenueSharePct ?? 0) > config.maxCommercialRevenueSharePct) return 0;
  if ((riskProfile.rentStabilizedRevenueSharePct ?? 0) > config.maxRentStabilizedRevenueSharePct) return 0;
  if (adjustedCapRate == null || adjustedCapRate < config.minAdjustedCapRatePct) return 0;
  if (irrPct == null || irrPct < config.minIrrPct) return 0;
  if ((inputs.blendedRentUpliftPct ?? 0) < config.minBlendedRentUpliftPct) return 0;
  if ((riskProfile.unsupportedRentGrowthPct ?? 0) > config.maxUnsupportedRentGrowthPct) return 0;

  let score = config.baseScore;
  if ((inputs.furnishingSetupCosts ?? 0) >= config.meaningfulFurnishingCostBonusThreshold) {
    score += config.furnishingCostBonus;
  }
  return Math.min(config.maxScore, score);
}

function hasMeaningfulPriceCut(inputs: DealScoringInputs, profile: DealScoringProfile): boolean {
  const config = profile.meaningfulPriceCut;
  return (
    (inputs.latestPriceDecreasePct ?? 0) >= config.latestDecreaseMinPct &&
    (inputs.daysSinceLatestPriceDecrease ?? Number.POSITIVE_INFINITY) <= config.daysSinceDecreaseMax &&
    (inputs.currentDiscountFromOriginalAskPct ?? 0) >= config.currentDiscountFromOriginalAskMinPct
  );
}

function marketLiquidityScore(
  inputs: DealScoringInputs,
  riskProfile: DealRiskProfile,
  profile: DealScoringProfile
): number {
  const config = profile.marketLiquidity;
  let score = config.baseScore;
  const totalUnits = inputs.totalUnits ?? riskProfile.totalUnits ?? null;
  if (totalUnits != null) {
    if (totalUnits >= config.largeAssetMinUnits) score += config.largeAssetBonus;
    else if (totalUnits >= config.midsizeAssetMinUnits) score += config.midsizeAssetBonus;
    else if (totalUnits < config.smallAssetBelowUnits) score -= config.smallAssetPenalty;
  }
  if (hasMeaningfulPriceCut(inputs, profile)) score += config.priceCutBonus;
  return clamp(score, 0, config.maxScore);
}

function assumptionPenalty(
  inputs: DealScoringInputs,
  riskProfile: DealRiskProfile,
  assetCapRate: number | null,
  profile: DealScoringProfile
): PenaltyResult {
  let value = 0;
  const flags: string[] = [];
  const config = profile.assumptionPenalties;
  const blendedRentUpliftPct = inputs.blendedRentUpliftPct ?? 0;
  const rentRollCoveragePct = riskProfile.rentRollCoveragePct ?? null;
  const vacancyPct = inputs.vacancyPct ?? null;
  const adjustedCapRatePct = inputs.adjustedCapRatePct ?? null;
  const exitCapRatePct = inputs.exitCapRatePct ?? null;
  const annualExpenseGrowthPct = inputs.annualExpenseGrowthPct ?? null;
  const stabilizedToCurrentNoiRatio =
    inputs.adjustedNoi != null && inputs.noi != null && inputs.noi > 0
      ? inputs.adjustedNoi / inputs.noi
      : null;

  if (blendedRentUpliftPct > config.blendedRentUpliftPct.veryHigh.above) {
    value += config.blendedRentUpliftPct.veryHigh.penalty;
    flags.push(`${config.blendedRentUpliftPct.veryHigh.label} (${blendedRentUpliftPct.toFixed(1)}%)`);
  } else if (blendedRentUpliftPct > config.blendedRentUpliftPct.aggressive.above) {
    value += config.blendedRentUpliftPct.aggressive.penalty;
    flags.push(`${config.blendedRentUpliftPct.aggressive.label} (${blendedRentUpliftPct.toFixed(1)}%)`);
  } else if (blendedRentUpliftPct > config.blendedRentUpliftPct.elevated.above) {
    value += config.blendedRentUpliftPct.elevated.penalty;
    flags.push(`${config.blendedRentUpliftPct.elevated.label} (${blendedRentUpliftPct.toFixed(1)}%)`);
  } else if (blendedRentUpliftPct > config.blendedRentUpliftPct.meaningful.above) {
    value += config.blendedRentUpliftPct.meaningful.penalty;
    flags.push(`${config.blendedRentUpliftPct.meaningful.label} (${blendedRentUpliftPct.toFixed(1)}%)`);
  }

  if (rentRollCoveragePct != null && rentRollCoveragePct < config.rentRollCoverage.below) {
    value += config.rentRollCoverage.penalty;
    flags.push(`${config.rentRollCoverage.label} ${(rentRollCoveragePct * 100).toFixed(0)}%`);
  }

  if (vacancyPct != null) {
    if (vacancyPct < config.vacancyPct.veryLow.below) {
      value += config.vacancyPct.veryLow.penalty;
      flags.push(`${config.vacancyPct.veryLow.label} (${vacancyPct.toFixed(1)}%)`);
    } else if (vacancyPct < config.vacancyPct.low.below) {
      value += config.vacancyPct.low.penalty;
      flags.push(`${config.vacancyPct.low.label} (${vacancyPct.toFixed(1)}%)`);
    }
  }

  if (adjustedCapRatePct != null && exitCapRatePct != null) {
    const diffBps = (adjustedCapRatePct - exitCapRatePct) * 100;
    if (diffBps > config.exitCapSpread.adjustedCapSevereBps) {
      value += config.exitCapSpread.penalty;
      flags.push(
        `Exit cap ${exitCapRatePct.toFixed(2)}% is over 25 bps below stabilized entry cap ${adjustedCapRatePct.toFixed(2)}%`
      );
    } else if (diffBps > config.exitCapSpread.adjustedCapAnyBps) {
      value += config.exitCapSpread.penalty;
      flags.push(
        `Exit cap ${exitCapRatePct.toFixed(2)}% is at/below stabilized entry cap ${adjustedCapRatePct.toFixed(2)}%`
      );
    }
  } else if (assetCapRate != null && exitCapRatePct != null) {
    const diffBps = (assetCapRate - exitCapRatePct) * 100;
    if (diffBps > config.exitCapSpread.assetCapBps) {
      value += config.exitCapSpread.penalty;
      flags.push(`Exit cap ${exitCapRatePct.toFixed(2)}% is tighter than current cap ${assetCapRate.toFixed(2)}%`);
    }
  }

  if (
    (annualExpenseGrowthPct ?? 100) < config.minimumAnnualExpenseGrowthPctWithoutRows &&
    !inputs.hasDetailedExpenseRows
  ) {
    value += config.lowExpenseGrowthPenalty;
    flags.push(config.lowExpenseGrowthLabel);
  }

  if (stabilizedToCurrentNoiRatio != null) {
    if (stabilizedToCurrentNoiRatio > config.stabilizedNoiRatioAbove) {
      value += config.stabilizedNoiRatioPenalty;
      flags.push(`Stabilized NOI is ${(stabilizedToCurrentNoiRatio * 100).toFixed(0)}% of current NOI`);
    }
  }

  return { value: Math.min(config.maxPenalty, value), flags };
}

function structuralPenalty(riskProfile: DealRiskProfile, profile: DealScoringProfile): PenaltyResult {
  let value = 0;
  const flags: string[] = [];
  const config = profile.structuralPenalties;
  const totalUnits = riskProfile.totalUnits ?? null;

  const rsShare = riskProfile.rentStabilizedRevenueSharePct ?? null;
  if (rsShare != null) {
    const rsPct = rsShare * 100;
    if (rsShare > config.rentStabilizedRevenueSharePct.severeAbove) {
      value += config.rentStabilizedRevenueSharePct.severePenalty;
      flags.push(`Rent-stabilized revenue share ${rsPct.toFixed(1)}%`);
    } else if (rsShare > config.rentStabilizedRevenueSharePct.elevatedAbove) {
      value += config.rentStabilizedRevenueSharePct.elevatedPenalty;
      flags.push(`Rent-stabilized revenue share ${rsPct.toFixed(1)}%`);
    } else if (rsShare > config.rentStabilizedRevenueSharePct.anyAbove) {
      value += config.rentStabilizedRevenueSharePct.anyPenalty;
      flags.push(`Any rent-stabilized revenue exposure (${rsPct.toFixed(1)}%)`);
    }
  }

  const commercialShare = riskProfile.commercialRevenueSharePct ?? null;
  if (commercialShare != null) {
    const commercialPct = commercialShare * 100;
    if (commercialShare > config.commercialRevenueSharePct.severeAbove) {
      value += config.commercialRevenueSharePct.severePenalty;
      flags.push(`Commercial revenue share ${commercialPct.toFixed(1)}%`);
    } else if (commercialShare >= config.commercialRevenueSharePct.elevatedAtLeast) {
      value += config.commercialRevenueSharePct.elevatedPenalty;
      flags.push(`Commercial revenue share ${commercialPct.toFixed(1)}%`);
    } else if (commercialShare >= config.commercialRevenueSharePct.moderateAtLeast) {
      value += config.commercialRevenueSharePct.moderatePenalty;
      flags.push(`Commercial revenue share ${commercialPct.toFixed(1)}%`);
    }
  }

  const largestUnitShare = riskProfile.largestUnitRevenueSharePct ?? null;
  if (
    largestUnitShare != null &&
    (totalUnits ?? Number.POSITIVE_INFINITY) >= config.largestUnitRevenueSharePct.appliesWhenTotalUnitsAtLeast
  ) {
    const largestPct = largestUnitShare * 100;
    if (largestUnitShare > config.largestUnitRevenueSharePct.severeAbove) {
      value += config.largestUnitRevenueSharePct.severePenalty;
      flags.push(`Largest unit contributes ${largestPct.toFixed(1)}% of rent`);
    } else if (largestUnitShare > config.largestUnitRevenueSharePct.elevatedAbove) {
      value += config.largestUnitRevenueSharePct.elevatedPenalty;
      flags.push(`Largest unit contributes ${largestPct.toFixed(1)}% of rent`);
    } else if (largestUnitShare >= config.largestUnitRevenueSharePct.moderateAtLeast) {
      value += config.largestUnitRevenueSharePct.moderatePenalty;
      flags.push(`Largest unit contributes ${largestPct.toFixed(1)}% of rent`);
    }
  }

  const rolloverShare = riskProfile.rollover12moRevenueSharePct ?? null;
  if (rolloverShare != null) {
    const rolloverPct = rolloverShare * 100;
    if (rolloverShare > config.rollover12moRevenueSharePct.severeAbove) {
      value += config.rollover12moRevenueSharePct.severePenalty;
      flags.push(`Lease rollover within 12 months is ${rolloverPct.toFixed(1)}% of rent`);
    } else if (rolloverShare >= config.rollover12moRevenueSharePct.elevatedAtLeast) {
      value += config.rollover12moRevenueSharePct.elevatedPenalty;
      flags.push(`Lease rollover within 12 months is ${rolloverPct.toFixed(1)}% of rent`);
    }
  }

  const coverage = riskProfile.rentRollCoveragePct ?? null;
  if (coverage != null) {
    const coveragePct = coverage * 100;
    if (coverage < config.rentRollCoveragePct.severeBelow) {
      value += config.rentRollCoveragePct.severePenalty;
      flags.push(`Rent-roll coverage only ${coveragePct.toFixed(0)}%`);
    } else if (coverage < config.rentRollCoveragePct.elevatedBelow) {
      value += config.rentRollCoveragePct.elevatedPenalty;
      flags.push(`Rent-roll coverage only ${coveragePct.toFixed(0)}%`);
    }
  }

  if (
    riskProfile.missingLeaseDataMajority &&
    (totalUnits ?? Number.POSITIVE_INFINITY) >= config.largestUnitRevenueSharePct.appliesWhenTotalUnitsAtLeast
  ) {
    value += config.missingLeaseDataMajorityPenalty;
    flags.push("Lease dates missing on more than half of rent-roll rows");
  }

  if (riskProfile.smallAssetRiskLevel === "under_5") {
    if ((totalUnits ?? Number.POSITIVE_INFINITY) >= config.smallAssetUnder5AppliesWhenUnitsAtLeast) {
      value += config.smallAssetPenalty;
      flags.push("Small asset liquidity risk (<5 units)");
    }
  } else if (riskProfile.smallAssetRiskLevel === "5_to_9") {
    value += config.smallAssetPenalty;
    flags.push("Small asset liquidity risk (5-9 units)");
  }

  return { value: Math.min(config.maxPenalty, value), flags };
}

function regulatoryPenalty(
  inputs: DealScoringInputs,
  riskProfile: DealRiskProfile,
  profile: DealScoringProfile
): PenaltyResult {
  let value = 0;
  const flags: string[] = [];
  const config = profile.regulatoryPenalties;

  if ((inputs.hpdRentImpairingOpen ?? 0) > 0) {
    value += config.hpdRentImpairingOpenPenalty;
    flags.push("Open rent-impairing HPD violations");
  } else {
    const hpdOpen = inputs.hpdOpenCount ?? 0;
    if (hpdOpen >= config.hpdOpenSevereAtLeast) {
      value += config.hpdOpenSeverePenalty;
      flags.push(`${hpdOpen} open HPD violations`);
    } else if (hpdOpen > 0) {
      value += config.hpdOpenAnyPenalty;
      flags.push(`${hpdOpen} open HPD violations`);
    }
  }

  const dobRecentOrOpen = Math.max(inputs.dobOpenCount ?? 0, inputs.dobCount30 ?? 0);
  if (dobRecentOrOpen >= config.dobRecentOrOpenSevereAtLeast) {
    value += config.dobRecentOrOpenSeverePenalty;
    flags.push("Open or very recent DOB complaints");
  } else if (dobRecentOrOpen > 0 || (inputs.dobCount365 ?? 0) > 0) {
    value += config.dobHistoryPenalty;
    flags.push("DOB complaint history");
  }

  const litigationPenaltyDriver = Math.max(inputs.litigationOpenCount ?? 0, inputs.litigationTotal ?? 0);
  if (
    (inputs.litigationOpenCount ?? 0) > 0 ||
    (inputs.litigationTotalPenalty ?? 0) >= config.litigationMaterialPenaltyThreshold
  ) {
    value += config.litigationMaterialPenalty;
    flags.push("Open housing litigation / penalty exposure");
  } else if (litigationPenaltyDriver > 0 || (inputs.litigationTotalPenalty ?? 0) > 0) {
    value += config.litigationHistoryPenalty;
    flags.push("Housing litigation history");
  }

  const taxBurdenPct = riskProfile.taxBurdenPct != null ? riskProfile.taxBurdenPct * 100 : null;
  if (taxBurdenPct != null) {
    if (taxBurdenPct > config.taxBurdenAbovePct) {
      value += config.taxBurdenPenalty;
      flags.push(`Tax burden ${taxBurdenPct.toFixed(1)}% of EGI`);
    }
  }

  if (
    riskProfile.explicitRecordMismatch &&
    riskProfile.omDiscrepancyCount >= config.explicitMismatchMinDiscrepancies
  ) {
    value += config.explicitMismatchPenalty;
    flags.push("Package OM or explicit record mismatch needs verification");
  }

  return { value: Math.min(config.maxPenalty, value), flags };
}

function confidenceScore(
  inputs: DealScoringInputs,
  riskProfile: DealRiskProfile,
  profile: DealScoringProfile
): number {
  const config = profile.confidence;
  let value = config.startingScore;

  if (inputs.noi == null || inputs.grossRentalIncome == null) value -= config.missingFinancialsDeduction;
  if (!inputs.hasDetailedExpenseRows) value -= config.missingDetailedExpenseRowsDeduction;

  const coverage = riskProfile.rentRollCoveragePct ?? null;
  if (coverage != null) {
    if (coverage < config.rentRollCoverageSevereBelow) {
      value -= config.rentRollCoverageSevereDeduction;
    } else if (coverage < config.rentRollCoverageElevatedBelow) {
      value -= config.rentRollCoverageElevatedDeduction;
    }
  }

  if (riskProfile.rapidOmMismatch) value -= config.rapidOmMismatchDeduction;
  if (riskProfile.omDiscrepancyCount >= config.omDiscrepancyCountAtLeast) {
    value -= config.omDiscrepancyDeduction;
  }
  if (riskProfile.missingLeaseDataMajority) value -= config.missingLeaseDataMajorityDeduction;
  if (riskProfile.missingOccupancyDataMajority) value -= config.missingOccupancyDataMajorityDeduction;
  if (riskProfile.isPackageOm) value -= config.packageOmDeduction;
  if (riskProfile.missingEnrichmentGroup) value -= config.missingEnrichmentDeduction;

  return clamp(Math.round(value * 100) / 100, config.minScore, 1);
}

function capScore(
  inputs: DealScoringInputs,
  riskProfile: DealRiskProfile,
  confidence: number,
  rawScore: number,
  profile: DealScoringProfile
): {
  score: number;
  reasons: string[];
} {
  let score = rawScore;
  const reasons: string[] = [];
  const config = profile.caps;
  const irrPct = asPct(inputs.irrPct);
  const requiredDiscount = requiredDiscountPct(inputs);

  if (
    (irrPct != null && irrPct < config.financialViability.irrBelowPct) ||
    ((inputs.equityMultiple ?? Number.POSITIVE_INFINITY) < config.financialViability.equityMultipleBelow) ||
    ((requiredDiscount ?? 0) > config.financialViability.requiredDiscountAbovePct)
  ) {
    score = Math.min(score, config.financialViability.maxScore);
    reasons.push(config.financialViability.reason);
  } else if (
    (irrPct != null && irrPct < config.weakReturnOrDiscount.irrBelowPct) ||
    (requiredDiscount ?? 0) > config.weakReturnOrDiscount.requiredDiscountAbovePct
  ) {
    score = Math.min(score, config.weakReturnOrDiscount.maxScore);
    reasons.push(config.weakReturnOrDiscount.reason);
  }

  if (
    (((riskProfile.commercialRevenueSharePct ?? 0) >
      config.structuralConcentration.commercialAndLargestUnitCommercialShareAbovePct) &&
      ((riskProfile.largestUnitRevenueSharePct ?? 0) >
        config.structuralConcentration.commercialAndLargestUnitLargestShareAbovePct)) ||
    ((riskProfile.commercialRevenueSharePct ?? 0) > config.structuralConcentration.commercialShareAbovePct) ||
    ((riskProfile.rentStabilizedRevenueSharePct ?? 0) >
      config.structuralConcentration.rentStabilizedShareAbovePct) ||
    (((riskProfile.totalUnits ?? Number.POSITIVE_INFINITY) >=
      config.structuralConcentration.largestUnitAppliesWhenUnitsAtLeast) &&
      ((riskProfile.largestUnitRevenueSharePct ?? 0) >
        config.structuralConcentration.largestUnitShareAbovePct))
  ) {
    score = Math.min(score, config.structuralConcentration.maxScore);
    reasons.push(config.structuralConcentration.reason);
  }

  if (
    (inputs.hpdRentImpairingOpen ?? 0) > 0 ||
    confidence < config.dataOrRegulatory.confidenceBelow ||
    (riskProfile.rapidOmMismatch &&
      riskProfile.omDiscrepancyCount >= config.dataOrRegulatory.rapidMismatchDiscrepancyCountAtLeast)
  ) {
    score = Math.min(score, config.dataOrRegulatory.maxScore);
    reasons.push(config.dataOrRegulatory.reason);
  }
  if (confidence < config.veryLowConfidence.confidenceBelow) {
    score = Math.min(score, config.veryLowConfidence.maxScore);
    reasons.push(config.veryLowConfidence.reason);
  }

  if (
    (inputs.blendedRentUpliftPct ?? 0) > config.unsupportedUpside.blendedRentUpliftAbovePct &&
    (riskProfile.rentRollCoveragePct ?? 1) < config.unsupportedUpside.rentRollCoverageBelow
  ) {
    score = Math.min(score, config.unsupportedUpside.maxScore);
    reasons.push(config.unsupportedUpside.reason);
  }

  if (
    config.rentStabilizationDoNotBuy &&
    (riskProfile.rentStabilizedRevenueSharePct ?? 0) > 0
  ) {
    score = Math.min(score, config.rentStabilizationDoNotBuy.maxScore);
    reasons.push(config.rentStabilizationDoNotBuy.reason);
  }

  return { score, reasons };
}

function buildPositiveSignals(
  inputs: DealScoringInputs,
  assetCapRate: number | null,
  adjustedCapRate: number | null,
  discountPct: number | null,
  profile: DealScoringProfile
): string[] {
  const signals: string[] = [];
  const config = profile.positiveSignals;
  const irrPct = asPct(inputs.irrPct);
  const cocPct = asPct(inputs.cocPct);
  if (irrPct != null && irrPct >= config.irrStrongMinPct) signals.push(`IRR ${irrPct.toFixed(1)}%`);
  else if (irrPct != null && irrPct >= config.irrGoodMinPct) signals.push(`IRR ${irrPct.toFixed(1)}%`);
  if (cocPct != null && cocPct >= config.cocMinPct) signals.push(`Average CoC ${cocPct.toFixed(1)}%`);
  if (assetCapRate != null && assetCapRate >= config.askCapMinPct) signals.push(`Ask cap ${assetCapRate.toFixed(2)}%`);
  if (adjustedCapRate != null && adjustedCapRate >= config.adjustedCapMinPct) {
    signals.push(`Adjusted cap ${adjustedCapRate.toFixed(2)}%`);
  }
  if (discountPct != null && discountPct <= config.requiredDiscountMaxPct) {
    signals.push(
      discountPct <= 0
        ? "Asking price clears target IRR"
        : `${discountPct.toFixed(1)}% discount clears target IRR`
    );
  }
  if (hasMeaningfulPriceCut(inputs, profile)) {
    signals.push(
      `Recent ${Number(inputs.latestPriceDecreasePct ?? 0).toFixed(1)}% price cut with 10%+ discount from original ask`
    );
  }
  return signals;
}

export function computeDealScore(inputs: DealScoringInputs): DealScoringResult {
  const profile = resolveDealScoringProfile(inputs.scoringProfile);
  const assetCapRate = assetCapRateAtAsk(inputs);
  const adjustedCapRate = inputs.adjustedCapRatePct ?? null;
  const discountPct = requiredDiscountPct(inputs);
  const riskProfile: DealRiskProfile = {
    omDiscrepancyCount: inputs.riskProfile?.omDiscrepancyCount ?? 0,
    rapidOmMismatch: inputs.riskProfile?.rapidOmMismatch ?? false,
    missingLeaseDataMajority: inputs.riskProfile?.missingLeaseDataMajority ?? false,
    missingOccupancyDataMajority: inputs.riskProfile?.missingOccupancyDataMajority ?? false,
    isPackageOm: inputs.riskProfile?.isPackageOm ?? false,
    missingEnrichmentGroup: inputs.riskProfile?.missingEnrichmentGroup ?? false,
    explicitRecordMismatch: inputs.riskProfile?.explicitRecordMismatch ?? false,
    ...inputs.riskProfile,
  };
  const isScoreable =
    assetCapRate != null ||
    (adjustedCapRate != null && Number.isFinite(adjustedCapRate)) ||
    (inputs.irrPct != null && Number.isFinite(inputs.irrPct)) ||
    discountPct != null;

  const returnScore =
    scoreIrr(inputs.irrPct ?? null, profile) +
    scoreCoc(inputs.cocPct ?? null, profile) +
    scoreAskCap(assetCapRate, profile) +
    scoreAdjustedCap(adjustedCapRate, profile) +
    scoreRequiredDiscount(discountPct, profile) +
    scoreStabilizedSpread(assetCapRate, adjustedCapRate, profile);
  const smallResidentialOpportunityScore = scoreSmallResidentialOpportunity(
    inputs,
    assetCapRate,
    adjustedCapRate,
    discountPct,
    riskProfile,
    profile
  );
  const valueAddMultifamilyOpportunityScore = scoreValueAddMultifamilyOpportunity(
    inputs,
    adjustedCapRate,
    riskProfile,
    profile
  );
  const marketScore = marketLiquidityScore(inputs, riskProfile, profile);
  const assumption = assumptionPenalty(inputs, riskProfile, assetCapRate, profile);
  const structural = structuralPenalty(riskProfile, profile);
  const regulatory = regulatoryPenalty(inputs, riskProfile, profile);
  const confidence = confidenceScore(inputs, riskProfile, profile);
  const totalPenalty = assumption.value + structural.value + regulatory.value;
  const rawCompositeScore = clamp(
    Math.round(
      returnScore +
        smallResidentialOpportunityScore +
        valueAddMultifamilyOpportunityScore +
        marketScore -
        totalPenalty
    ),
    0,
    profile.maxCompositeScore
  );
  const preCapScore = normalizeCompositeScore(rawCompositeScore, profile);
  const cap = capScore(inputs, riskProfile, confidence, preCapScore, profile);
  const dealScore = isScoreable ? clamp(Math.round(cap.score), 0, 100) : 0;

  const riskFlags = [...assumption.flags, ...structural.flags, ...regulatory.flags];
  const negativeSignals = [...riskFlags];
  if (!isScoreable) {
    negativeSignals.push("Current NOI or underwritten returns missing; pricing cannot be scored reliably yet");
  }

  const scoreBreakdown: DealScoreBreakdown = {
    returnScore,
    marketLiquidityScore: marketScore,
    assumptionPenalty: assumption.value,
    structuralPenalty: structural.value,
    regulatoryPenalty: regulatory.value,
    preCapScore,
    cappedScore: dealScore,
  };

  return {
    dealScore,
    isScoreable,
    assetYieldScore: returnScore,
    adjustedYieldScore: marketScore,
    rentUpsideScore: inputs.blendedRentUpliftPct ?? 0,
    locationScore: 0,
    riskScore: clamp(Math.round(100 - (totalPenalty / 35) * 100), 0, 100),
    liquidityScore: marketScore * 10,
    positiveSignals: buildPositiveSignals(inputs, assetCapRate, adjustedCapRate, discountPct, profile),
    negativeSignals,
    assetCapRate: round2(assetCapRate),
    adjustedCapRate: round2(adjustedCapRate),
    requiredDiscountPct: round2(discountPct),
    confidenceScore: confidence,
    scoreBreakdown,
    riskProfile: {
      ...riskProfile,
      commercialRevenueSharePct: round2(riskProfile.commercialRevenueSharePct),
      rentStabilizedRevenueSharePct: round2(riskProfile.rentStabilizedRevenueSharePct),
      largestUnitRevenueSharePct: round2(riskProfile.largestUnitRevenueSharePct),
      rollover12moRevenueSharePct: round2(riskProfile.rollover12moRevenueSharePct),
      rentRollCoveragePct: round2(riskProfile.rentRollCoveragePct),
      taxBurdenPct: round2(riskProfile.taxBurdenPct),
      unsupportedRentGrowthPct: round2(riskProfile.unsupportedRentGrowthPct),
      missingLeaseDataPct: round2(riskProfile.missingLeaseDataPct),
      missingOccupancyDataPct: round2(riskProfile.missingOccupancyDataPct),
    },
    riskFlags,
    capReasons: cap.reasons,
    scoreVersion: profile.scoreVersion,
    scoringProfileKey: profile.key,
    scoringProfileLabel: profile.label,
  };
}

export function resolveFinalDealScore(inputs: FinalDealScoreInputs): number | null {
  if (inputs.deterministicScore == null || !Number.isFinite(inputs.deterministicScore)) return null;
  return clamp(Math.round(inputs.deterministicScore), 0, 100);
}
