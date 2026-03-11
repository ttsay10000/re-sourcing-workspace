/**
 * Deal scoring engine (deterministic fallback): pricing quality at ask, discount needed to clear
 * target IRR, return profile, and risk deductions.
 */

export interface DealScoringInputs {
  /** Purchase price (listing price). */
  purchasePrice: number | null;
  /** Current NOI for asset cap rate. */
  noi: number | null;
  /** Hold-period IRR as decimal (e.g. 0.22 = 22%). */
  irrPct?: number | null;
  /** Year 1 cash-on-cash as decimal (e.g. 0.08 = 8%). */
  cocPct?: number | null;
  /** Stabilized cap rate at the current ask. */
  adjustedCapRatePct?: number | null;
  /** Maximum price that still clears the target IRR. */
  recommendedOfferHigh?: number | null;
  /** Effective blended rent uplift after excluding protected units. */
  blendedRentUpliftPct?: number | null;
  /** Number of rent-stabilized units; each deducts from score. */
  rentStabilizedUnitCount?: number;
  /** Number of commercial units in the asset. */
  commercialUnitCount?: number;
  /** HPD violations: open and rent-impairing drive severity deduction. */
  hpdOpenCount?: number;
  hpdRentImpairingOpen?: number;
  hpdTotal?: number;
  /** DOB complaints: open and recent (30/365 day) drive severity deduction. */
  dobOpenCount?: number;
  dobCount30?: number;
  dobCount365?: number;
  /** Housing litigations: open and total penalty drive severity deduction. */
  litigationOpenCount?: number;
  litigationTotal?: number;
  litigationTotalPenalty?: number;
  /** Most recent price cut magnitude as a positive percent (e.g. 5.2). */
  latestPriceDecreasePct?: number | null;
  /** Days since the latest price cut. */
  daysSinceLatestPriceDecrease?: number | null;
  /** Current ask discount versus the original list price. */
  currentDiscountFromOriginalAskPct?: number | null;
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
}

export interface FinalDealScoreInputs {
  llmScore?: number | null;
  deterministicScore?: number | null;
  irrPct?: number | null;
  equityMultiple?: number | null;
  requiredDiscountPct?: number | null;
}

function assetCapScore(assetCapRate: number | null): number {
  if (assetCapRate == null || Number.isNaN(assetCapRate)) return 0;
  const pct = assetCapRate;
  if (pct >= 6) return 45;
  if (pct >= 5) return 35 + (pct - 5) * 10;
  if (pct >= 4) return 20 + (pct - 4) * 15;
  if (pct >= 3) return 8 + (pct - 3) * 12;
  return Math.max(0, pct * 2.5);
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

function pricingGapScore(discountPct: number | null): number {
  if (discountPct == null || Number.isNaN(discountPct)) return 0;
  if (discountPct <= 0) return 25;
  if (discountPct <= 5) return 20;
  if (discountPct <= 10) return 12;
  if (discountPct <= 15) return 6;
  if (discountPct <= 20) return 2;
  return 0;
}

function marketActivityScore(inputs: DealScoringInputs): number {
  const cutPct = inputs.latestPriceDecreasePct;
  const daysSinceCut = inputs.daysSinceLatestPriceDecrease;
  if (cutPct == null || daysSinceCut == null || Number.isNaN(cutPct) || Number.isNaN(daysSinceCut)) return 0;
  if (daysSinceCut <= 30 && cutPct >= 5) return 8;
  if (daysSinceCut <= 45 && cutPct >= 3) return 6;
  if (daysSinceCut <= 90 && cutPct >= 1.5) return 4;
  if (
    daysSinceCut <= 120 &&
    (inputs.currentDiscountFromOriginalAskPct ?? 0) >= 10 &&
    cutPct >= 1
  ) {
    return 2;
  }
  return 0;
}

function executionScore(inputs: DealScoringInputs): number {
  let score = 0;

  const irrPct = inputs.irrPct != null && Number.isFinite(inputs.irrPct) ? inputs.irrPct * 100 : null;
  if (irrPct != null) {
    if (irrPct >= 25) score += 10;
    else if (irrPct >= 20) score += 7;
    else if (irrPct >= 15) score += 4;
  }

  const cocPct = inputs.cocPct != null && Number.isFinite(inputs.cocPct) ? inputs.cocPct * 100 : null;
  if (cocPct != null) {
    if (cocPct >= 8) score += 5;
    else if (cocPct >= 5) score += 3;
    else if (cocPct >= 2) score += 1;
  }

  const adjustedCap = inputs.adjustedCapRatePct;
  if (adjustedCap != null && Number.isFinite(adjustedCap)) {
    if (adjustedCap >= 6) score += 5;
    else if (adjustedCap >= 5) score += 3;
    else if (adjustedCap >= 4) score += 1;
  }

  return score;
}

function riskDeduction(inputs: DealScoringInputs): number {
  let deduct = 0;
  const rentStab = inputs.rentStabilizedUnitCount ?? 0;
  deduct += rentStab * 4;

  const hpdOpen = inputs.hpdOpenCount ?? 0;
  const hpdRentImp = inputs.hpdRentImpairingOpen ?? 0;
  if (hpdRentImp > 0) deduct += 15 + Math.min(15, hpdRentImp * 2);
  else if (hpdOpen > 0) deduct += 5 + Math.min(10, hpdOpen);

  const dobOpen = inputs.dobOpenCount ?? 0;
  const dob30 = inputs.dobCount30 ?? 0;
  const dob365 = inputs.dobCount365 ?? 0;
  if (dobOpen > 0 || dob30 > 0) deduct += 8 + Math.min(7, dob30 + dobOpen);
  else if (dob365 > 0) deduct += Math.min(5, dob365);

  const litOpen = inputs.litigationOpenCount ?? 0;
  const litTotal = inputs.litigationTotal ?? 0;
  const litPenalty = inputs.litigationTotalPenalty ?? 0;
  if (litOpen > 0 || litTotal > 0) deduct += 10 + Math.min(10, litOpen + Math.min(5, litTotal));
  if (litPenalty > 0) deduct += Math.min(5, Math.floor(litPenalty / 1000));

  return deduct;
}

export function computeDealScore(inputs: DealScoringInputs): DealScoringResult {
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];

  const purchasePrice = inputs.purchasePrice && inputs.purchasePrice > 0 ? inputs.purchasePrice : null;
  const noi = inputs.noi;
  const assetCapRate =
    purchasePrice != null && noi != null && noi >= 0 ? (noi / purchasePrice) * 100 : null;
  const discountPct = requiredDiscountPct(inputs);
  const activityScore = marketActivityScore(inputs);

  const capScore = assetCapScore(assetCapRate);
  const negotiationScore = pricingGapScore(discountPct) + activityScore;
  const returnsScore = executionScore(inputs);
  const deduct = riskDeduction(inputs);
  const isScoreable =
    assetCapRate != null ||
    (inputs.adjustedCapRatePct != null && Number.isFinite(inputs.adjustedCapRatePct)) ||
    (inputs.irrPct != null && Number.isFinite(inputs.irrPct)) ||
    discountPct != null;

  if (assetCapRate != null && assetCapRate >= 5) positiveSignals.push("Ask cap rate at or above 5%");
  if (discountPct != null && discountPct <= 0) positiveSignals.push("Asking price already clears target IRR");
  else if (discountPct != null && discountPct <= 5) {
    positiveSignals.push(`Needs no more than ${discountPct.toFixed(1)}% discount to hit target IRR`);
  }
  if (inputs.adjustedCapRatePct != null && inputs.adjustedCapRatePct >= 6) {
    positiveSignals.push("Stabilized cap rate at or above 6%");
  }
  if (
    inputs.latestPriceDecreasePct != null &&
    inputs.daysSinceLatestPriceDecrease != null &&
    activityScore > 0
  ) {
    positiveSignals.push(
      `Recent ${inputs.latestPriceDecreasePct.toFixed(1)}% price cut ${Math.round(inputs.daysSinceLatestPriceDecrease)} day(s) ago`
    );
  }

  const rentStab = inputs.rentStabilizedUnitCount ?? 0;
  if (rentStab > 0) negativeSignals.push(`${rentStab} rent-stabilized unit(s)`);
  if ((inputs.commercialUnitCount ?? 0) > 0) {
    negativeSignals.push(`${inputs.commercialUnitCount} commercial unit(s) not eligible for residential uplift`);
  }
  if (discountPct != null && discountPct > 5) {
    negativeSignals.push(`Needs ${discountPct.toFixed(1)}% discount to hit target IRR`);
  }
  if ((inputs.blendedRentUpliftPct ?? 0) > 0 && rentStab + (inputs.commercialUnitCount ?? 0) > 0) {
    negativeSignals.push(
      `Protected units cut blended rent uplift to ${(inputs.blendedRentUpliftPct ?? 0).toFixed(1)}%`
    );
  }
  if ((inputs.hpdOpenCount ?? 0) > 0 || (inputs.hpdRentImpairingOpen ?? 0) > 0) {
    negativeSignals.push("HPD violations");
  }
  if ((inputs.dobOpenCount ?? 0) > 0 || (inputs.dobCount30 ?? 0) > 0) {
    negativeSignals.push("DOB complaints");
  }
  if ((inputs.litigationOpenCount ?? 0) > 0 || (inputs.litigationTotal ?? 0) > 0) {
    negativeSignals.push("Housing litigations");
  }
  if (inputs.irrPct != null && inputs.irrPct < 0.2) negativeSignals.push("IRR below 20%");
  if (!isScoreable) {
    negativeSignals.push("Current NOI or underwritten returns missing; pricing cannot be scored reliably yet");
  }

  const total = Math.max(0, capScore + negotiationScore + returnsScore - deduct);
  const dealScore = Math.max(0, Math.min(100, Math.round(total)));

  return {
    dealScore,
    isScoreable,
    assetYieldScore: capScore + negotiationScore,
    adjustedYieldScore: returnsScore,
    rentUpsideScore: inputs.blendedRentUpliftPct ?? 0,
    locationScore: 0,
    riskScore: Math.max(0, 100 - deduct),
    liquidityScore: 0,
    positiveSignals,
    negativeSignals,
    assetCapRate,
    adjustedCapRate: inputs.adjustedCapRatePct ?? null,
  };
}

export function resolveFinalDealScore(inputs: FinalDealScoreInputs): number | null {
  const llmScore =
    inputs.llmScore != null && Number.isFinite(inputs.llmScore) ? Math.round(inputs.llmScore) : null;
  const deterministicScore =
    inputs.deterministicScore != null && Number.isFinite(inputs.deterministicScore)
      ? Math.round(inputs.deterministicScore)
      : null;
  let score = deterministicScore ?? llmScore;
  if (score == null && llmScore != null) score = llmScore;
  if (score == null) return null;

  if (llmScore != null && deterministicScore != null) {
    // Keep the LLM as a qualitative overlay, but never let it overstate the hard numbers.
    score = Math.min(llmScore, deterministicScore);
  }

  const caps: number[] = [];
  if (inputs.requiredDiscountPct != null && Number.isFinite(inputs.requiredDiscountPct)) {
    if (inputs.requiredDiscountPct > 25) caps.push(40);
    else if (inputs.requiredDiscountPct > 15) caps.push(55);
  }
  if (inputs.equityMultiple != null && Number.isFinite(inputs.equityMultiple) && inputs.equityMultiple < 1) {
    caps.push(40);
  }
  if (inputs.irrPct != null && Number.isFinite(inputs.irrPct)) {
    if (inputs.irrPct < 0) caps.push(35);
    else if (inputs.irrPct < 0.1) caps.push(45);
    else if (inputs.irrPct < 0.15) caps.push(55);
  }

  if (caps.length > 0) score = Math.min(score, ...caps);
  return Math.max(0, Math.min(100, Math.round(score)));
}
