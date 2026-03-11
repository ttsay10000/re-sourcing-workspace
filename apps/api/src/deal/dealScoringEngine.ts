import type { DealRiskProfile, DealScoreBreakdown } from "@re-sourcing/contracts";

export const DEAL_SCORE_VERSION = "v2";

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

const MAX_COMPOSITE_SCORE = 75;

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

function normalizeCompositeScore(rawCompositeScore: number): number {
  if (!Number.isFinite(rawCompositeScore)) return 0;
  return clamp(Math.round((rawCompositeScore / MAX_COMPOSITE_SCORE) * 100), 0, 100);
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

function scoreIrr(irrPctDecimal: number | null | undefined): number {
  const irrPct = asPct(irrPctDecimal);
  if (irrPct == null) return 0;
  if (irrPct >= 25) return 20;
  if (irrPct >= 20) return 17;
  if (irrPct >= 15) return 13;
  if (irrPct >= 12) return 9;
  if (irrPct >= 8) return 5;
  if (irrPct >= 0) return 2;
  return 0;
}

function scoreCoc(cocPctDecimal: number | null | undefined): number {
  const cocPct = asPct(cocPctDecimal);
  if (cocPct == null) return 0;
  if (cocPct >= 10) return 17;
  if (cocPct >= 8) return 14;
  if (cocPct >= 6) return 10;
  if (cocPct >= 4) return 6;
  if (cocPct >= 2) return 3;
  if (cocPct >= 0) return 1;
  return 0;
}

function scoreAskCap(assetCapRate: number | null): number {
  if (assetCapRate == null) return 0;
  if (assetCapRate >= 6.5) return 15;
  if (assetCapRate >= 6.0) return 13;
  if (assetCapRate >= 5.5) return 10;
  if (assetCapRate >= 5.0) return 7;
  if (assetCapRate >= 4.5) return 4;
  if (assetCapRate >= 4.0) return 2;
  return 0;
}

function scoreRequiredDiscount(discountPct: number | null): number {
  if (discountPct == null) return 0;
  if (discountPct <= 0) return 8;
  if (discountPct <= 5) return 7;
  if (discountPct <= 10) return 5;
  if (discountPct <= 15) return 3;
  if (discountPct <= 20) return 1;
  return 0;
}

function scoreStabilizedSpread(assetCapRate: number | null, adjustedCapRate: number | null): number {
  if (assetCapRate == null || adjustedCapRate == null) return 0;
  const spreadBps = (adjustedCapRate - assetCapRate) * 100;
  if (spreadBps >= 150) return 5;
  if (spreadBps >= 100) return 4;
  if (spreadBps >= 50) return 3;
  if (spreadBps >= 25) return 2;
  if (spreadBps >= 0) return 1;
  return 0;
}

function hasMeaningfulPriceCut(inputs: DealScoringInputs): boolean {
  return (
    (inputs.latestPriceDecreasePct ?? 0) >= 3 &&
    (inputs.daysSinceLatestPriceDecrease ?? Number.POSITIVE_INFINITY) <= 90 &&
    (inputs.currentDiscountFromOriginalAskPct ?? 0) >= 10
  );
}

function marketLiquidityScore(inputs: DealScoringInputs, riskProfile: DealRiskProfile): number {
  let score = 3;
  const totalUnits = inputs.totalUnits ?? riskProfile.totalUnits ?? null;
  if (totalUnits != null) {
    if (totalUnits >= 20) score += 2;
    else if (totalUnits >= 10) score += 1;
    else if (totalUnits < 5) score -= 2;
  }
  if (hasMeaningfulPriceCut(inputs)) score += 1;
  return clamp(score, 0, 10);
}

function assumptionPenalty(
  inputs: DealScoringInputs,
  riskProfile: DealRiskProfile,
  assetCapRate: number | null
): PenaltyResult {
  let value = 0;
  const flags: string[] = [];
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

  if (blendedRentUpliftPct > 60) {
    value += 6;
    flags.push(`Aggressive blended rent uplift (${blendedRentUpliftPct.toFixed(1)}%)`);
  } else if (blendedRentUpliftPct > 45) {
    value += 4;
    flags.push(`Elevated blended rent uplift (${blendedRentUpliftPct.toFixed(1)}%)`);
  } else if (blendedRentUpliftPct > 30) {
    value += 2;
    flags.push(`Meaningful blended rent uplift (${blendedRentUpliftPct.toFixed(1)}%)`);
  }

  if (rentRollCoveragePct != null && rentRollCoveragePct < 0.75) {
    value += 2;
    flags.push(`Rent-roll coverage only ${(rentRollCoveragePct * 100).toFixed(0)}%`);
  }

  if (vacancyPct != null) {
    if (vacancyPct < 3) {
      value += 3;
      flags.push(`Vacancy assumption below 3% (${vacancyPct.toFixed(1)}%)`);
    } else if (vacancyPct < 5) {
      value += 1;
      flags.push(`Vacancy assumption below 5% (${vacancyPct.toFixed(1)}%)`);
    }
  }

  if (adjustedCapRatePct != null && exitCapRatePct != null) {
    const diffBps = (adjustedCapRatePct - exitCapRatePct) * 100;
    if (diffBps > 25) {
      value += 4;
      flags.push(
        `Exit cap ${exitCapRatePct.toFixed(2)}% is over 25 bps below stabilized entry cap ${adjustedCapRatePct.toFixed(2)}%`
      );
    } else if (diffBps >= 0) {
      value += 2;
      flags.push(
        `Exit cap ${exitCapRatePct.toFixed(2)}% is at/below stabilized entry cap ${adjustedCapRatePct.toFixed(2)}%`
      );
    }
  } else if (assetCapRate != null && exitCapRatePct != null) {
    const diffBps = (assetCapRate - exitCapRatePct) * 100;
    if (diffBps > 25) {
      value += 2;
      flags.push(`Exit cap ${exitCapRatePct.toFixed(2)}% is tighter than current cap ${assetCapRate.toFixed(2)}%`);
    }
  }

  if ((annualExpenseGrowthPct ?? 100) < 2 && !inputs.hasDetailedExpenseRows) {
    value += 3;
    flags.push("Expense growth under 2% without detailed expense rows");
  }

  if (stabilizedToCurrentNoiRatio != null) {
    if (stabilizedToCurrentNoiRatio > 1.35) {
      value += 3;
      flags.push(`Stabilized NOI is ${(stabilizedToCurrentNoiRatio * 100).toFixed(0)}% of current NOI`);
    } else if (stabilizedToCurrentNoiRatio > 1.2) {
      value += 1;
      flags.push(`Stabilized NOI is ${(stabilizedToCurrentNoiRatio * 100).toFixed(0)}% of current NOI`);
    }
  }

  return { value: Math.min(12, value), flags };
}

function structuralPenalty(riskProfile: DealRiskProfile): PenaltyResult {
  let value = 0;
  const flags: string[] = [];

  const rsShare = riskProfile.rentStabilizedRevenueSharePct ?? null;
  if (rsShare != null) {
    const rsPct = rsShare * 100;
    if (rsPct > 50) {
      value += 8;
      flags.push(`Rent-stabilized revenue share ${rsPct.toFixed(1)}%`);
    } else if (rsPct > 25) {
      value += 5;
      flags.push(`Rent-stabilized revenue share ${rsPct.toFixed(1)}%`);
    } else if (rsPct > 0) {
      value += 3;
      flags.push(`Any rent-stabilized revenue exposure (${rsPct.toFixed(1)}%)`);
    }
  }

  const commercialShare = riskProfile.commercialRevenueSharePct ?? null;
  if (commercialShare != null) {
    const commercialPct = commercialShare * 100;
    if (commercialPct > 50) {
      value += 6;
      flags.push(`Commercial revenue share ${commercialPct.toFixed(1)}%`);
    } else if (commercialPct >= 30) {
      value += 4;
      flags.push(`Commercial revenue share ${commercialPct.toFixed(1)}%`);
    } else if (commercialPct >= 15) {
      value += 2;
      flags.push(`Commercial revenue share ${commercialPct.toFixed(1)}%`);
    }
  }

  const largestUnitShare = riskProfile.largestUnitRevenueSharePct ?? null;
  if (largestUnitShare != null) {
    const largestPct = largestUnitShare * 100;
    if (largestPct > 35) {
      value += 5;
      flags.push(`Largest unit contributes ${largestPct.toFixed(1)}% of rent`);
    } else if (largestPct >= 25) {
      value += 3;
      flags.push(`Largest unit contributes ${largestPct.toFixed(1)}% of rent`);
    }
  }

  const rolloverShare = riskProfile.rollover12moRevenueSharePct ?? null;
  if (rolloverShare != null) {
    const rolloverPct = rolloverShare * 100;
    if (rolloverPct > 40) {
      value += 4;
      flags.push(`Lease rollover within 12 months is ${rolloverPct.toFixed(1)}% of rent`);
    } else if (rolloverPct >= 25) {
      value += 2;
      flags.push(`Lease rollover within 12 months is ${rolloverPct.toFixed(1)}% of rent`);
    }
  }

  const coverage = riskProfile.rentRollCoveragePct ?? null;
  if (coverage != null) {
    const coveragePct = coverage * 100;
    if (coveragePct < 50) {
      value += 3;
      flags.push(`Rent-roll coverage only ${coveragePct.toFixed(0)}%`);
    } else if (coveragePct < 75) {
      value += 2;
      flags.push(`Rent-roll coverage only ${coveragePct.toFixed(0)}%`);
    }
  }

  if (riskProfile.missingLeaseDataMajority) {
    value += 2;
    flags.push("Lease dates missing on more than half of rent-roll rows");
  }

  if (riskProfile.smallAssetRiskLevel === "under_5") {
    value += 4;
    flags.push("Small asset liquidity risk (<5 units)");
  } else if (riskProfile.smallAssetRiskLevel === "5_to_9") {
    value += 2;
    flags.push("Small asset liquidity risk (5-9 units)");
  }

  return { value: Math.min(13, value), flags };
}

function regulatoryPenalty(inputs: DealScoringInputs, riskProfile: DealRiskProfile): PenaltyResult {
  let value = 0;
  const flags: string[] = [];

  if ((inputs.hpdRentImpairingOpen ?? 0) > 0) {
    value += 6;
    flags.push("Open rent-impairing HPD violations");
  } else {
    const hpdOpen = inputs.hpdOpenCount ?? 0;
    if (hpdOpen >= 5) {
      value += 4;
      flags.push(`${hpdOpen} open HPD violations`);
    } else if (hpdOpen > 0) {
      value += 2;
      flags.push(`${hpdOpen} open HPD violations`);
    }
  }

  const dobRecentOrOpen = Math.max(inputs.dobOpenCount ?? 0, inputs.dobCount30 ?? 0);
  if (dobRecentOrOpen >= 3) {
    value += 4;
    flags.push("Open or very recent DOB complaints");
  } else if (dobRecentOrOpen > 0 || (inputs.dobCount365 ?? 0) > 0) {
    value += 2;
    flags.push("DOB complaint history");
  }

  const litigationPenaltyDriver = Math.max(inputs.litigationOpenCount ?? 0, inputs.litigationTotal ?? 0);
  if ((inputs.litigationOpenCount ?? 0) > 0 || (inputs.litigationTotalPenalty ?? 0) >= 5_000) {
    value += 4;
    flags.push("Open housing litigation / penalty exposure");
  } else if (litigationPenaltyDriver > 0 || (inputs.litigationTotalPenalty ?? 0) > 0) {
    value += 2;
    flags.push("Housing litigation history");
  }

  const taxBurdenPct = riskProfile.taxBurdenPct != null ? riskProfile.taxBurdenPct * 100 : null;
  if (taxBurdenPct != null) {
    if (taxBurdenPct > 20) {
      value += 3;
      flags.push(`Tax burden ${taxBurdenPct.toFixed(1)}% of EGI`);
    } else if (taxBurdenPct >= 12) {
      value += 1;
      flags.push(`Tax burden ${taxBurdenPct.toFixed(1)}% of EGI`);
    }
  }

  if (riskProfile.isPackageOm || (riskProfile.explicitRecordMismatch && riskProfile.omDiscrepancyCount >= 2)) {
    value += 2;
    flags.push("Package OM or explicit record mismatch needs verification");
  }

  return { value: Math.min(10, value), flags };
}

function confidenceScore(inputs: DealScoringInputs, riskProfile: DealRiskProfile): number {
  let value = 1;

  if (inputs.noi == null || inputs.grossRentalIncome == null) value -= 0.2;
  if (!inputs.hasDetailedExpenseRows) value -= 0.1;

  const coverage = riskProfile.rentRollCoveragePct ?? null;
  if (coverage != null) {
    if (coverage < 0.5) value -= 0.2;
    else if (coverage < 0.75) value -= 0.1;
  }

  if (riskProfile.rapidOmMismatch) value -= 0.15;
  if (riskProfile.omDiscrepancyCount >= 2) value -= 0.1;
  if (riskProfile.missingLeaseDataMajority) value -= 0.1;
  if (riskProfile.missingOccupancyDataMajority) value -= 0.05;
  if (riskProfile.isPackageOm) value -= 0.1;
  if (riskProfile.missingEnrichmentGroup) value -= 0.1;

  return clamp(Math.round(value * 100) / 100, 0.1, 1);
}

function capScore(inputs: DealScoringInputs, riskProfile: DealRiskProfile, confidence: number, rawScore: number): {
  score: number;
  reasons: string[];
} {
  let score = rawScore;
  const reasons: string[] = [];
  const irrPct = asPct(inputs.irrPct);
  const requiredDiscount = requiredDiscountPct(inputs);

  if (
    (irrPct != null && irrPct < 0) ||
    ((inputs.equityMultiple ?? Number.POSITIVE_INFINITY) < 1) ||
    ((requiredDiscount ?? 0) > 25)
  ) {
    score = Math.min(score, 40);
    reasons.push("Financial viability cap");
  } else if ((irrPct != null && irrPct < 10) || ((requiredDiscount ?? 0) >= 15 && (requiredDiscount ?? 0) <= 25)) {
    score = Math.min(score, 55);
    reasons.push("Weak return / discount cap");
  }

  if (
    ((riskProfile.commercialRevenueSharePct ?? 0) > 0.5) ||
    ((riskProfile.rentStabilizedRevenueSharePct ?? 0) > 0.25) ||
    ((riskProfile.largestUnitRevenueSharePct ?? 0) > 0.35)
  ) {
    score = Math.min(score, 68);
    reasons.push("Structural concentration cap");
  }

  if (
    (inputs.hpdRentImpairingOpen ?? 0) > 0 ||
    confidence < 0.45 ||
    (riskProfile.rapidOmMismatch && riskProfile.omDiscrepancyCount >= 2)
  ) {
    score = Math.min(score, 60);
    reasons.push("Data / regulatory cap");
  }
  if (confidence < 0.3) {
    score = Math.min(score, 50);
    reasons.push("Very low confidence cap");
  }

  if ((inputs.blendedRentUpliftPct ?? 0) > 50 && (riskProfile.rentRollCoveragePct ?? 1) < 0.75) {
    score = Math.min(score, 65);
    reasons.push("Unsupported upside cap");
  }

  return { score, reasons };
}

function buildPositiveSignals(inputs: DealScoringInputs, assetCapRate: number | null, discountPct: number | null): string[] {
  const signals: string[] = [];
  const irrPct = asPct(inputs.irrPct);
  const cocPct = asPct(inputs.cocPct);
  if (irrPct != null && irrPct >= 20) signals.push(`IRR ${irrPct.toFixed(1)}%`);
  if (cocPct != null && cocPct >= 8) signals.push(`Average CoC ${cocPct.toFixed(1)}%`);
  if (assetCapRate != null && assetCapRate >= 5.5) signals.push(`Ask cap ${assetCapRate.toFixed(2)}%`);
  if (discountPct != null && discountPct <= 5) {
    signals.push(
      discountPct <= 0
        ? "Asking price clears target IRR"
        : `Only ${discountPct.toFixed(1)}% discount needed to clear target IRR`
    );
  }
  if (hasMeaningfulPriceCut(inputs)) {
    signals.push(
      `Recent ${Number(inputs.latestPriceDecreasePct ?? 0).toFixed(1)}% price cut with 10%+ discount from original ask`
    );
  }
  return signals;
}

export function computeDealScore(inputs: DealScoringInputs): DealScoringResult {
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
    scoreIrr(inputs.irrPct ?? null) +
    scoreCoc(inputs.cocPct ?? null) +
    scoreAskCap(assetCapRate) +
    scoreRequiredDiscount(discountPct) +
    scoreStabilizedSpread(assetCapRate, adjustedCapRate);
  const marketScore = marketLiquidityScore(inputs, riskProfile);
  const assumption = assumptionPenalty(inputs, riskProfile, assetCapRate);
  const structural = structuralPenalty(riskProfile);
  const regulatory = regulatoryPenalty(inputs, riskProfile);
  const confidence = confidenceScore(inputs, riskProfile);
  const totalPenalty = assumption.value + structural.value + regulatory.value;
  const rawCompositeScore = clamp(Math.round(returnScore + marketScore - totalPenalty), 0, MAX_COMPOSITE_SCORE);
  const preCapScore = normalizeCompositeScore(rawCompositeScore);
  const cap = capScore(inputs, riskProfile, confidence, preCapScore);
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
    positiveSignals: buildPositiveSignals(inputs, assetCapRate, discountPct),
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
    scoreVersion: DEAL_SCORE_VERSION,
  };
}

export function resolveFinalDealScore(inputs: FinalDealScoreInputs): number | null {
  if (inputs.deterministicScore == null || !Number.isFinite(inputs.deterministicScore)) return null;
  return clamp(Math.round(inputs.deterministicScore), 0, 100);
}
