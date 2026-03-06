/**
 * Deal scoring engine: component scores (asset yield, adjusted yield, rent upside, location, risk, liquidity)
 * summed and clamped 0–100. Weights: Adjusted 30, Asset 20, Rent upside 20, Location 15, Risk 10, Liquidity 5.
 */

export interface DealScoringInputs {
  /** Purchase price (listing price). */
  purchasePrice: number | null;
  /** Current NOI for asset cap rate. */
  noi: number | null;
  /** Adjusted NOI (e.g. from furnished rental estimator) for adjusted cap rate. */
  adjustedNoi: number | null;
  /** Rent upside as decimal (e.g. 0.15 = 15%). Not computed yet; use 0 until furnished rental module. */
  rentUpsidePct: number | null;
  /** Borough/area for location score: Manhattan, Brooklyn, Queens, Bronx, Staten Island, Other. */
  area: string | null;
  /** Unit count for liquidity score. */
  unitCount: number | null;
  /** Risk deductions: HPD violations present. */
  hasHpdViolations?: boolean;
  /** Risk deductions: DOB violations/complaints present. */
  hasDobViolations?: boolean;
  /** Risk deductions: tax irregularities. */
  taxIrregularities?: boolean;
  /** Risk deductions: incomplete rent roll (e.g. comparison disabled). */
  incompleteRentRoll?: boolean;
}

export interface DealScoringResult {
  dealScore: number;
  assetYieldScore: number;
  adjustedYieldScore: number;
  rentUpsideScore: number;
  locationScore: number;
  riskScore: number;
  liquidityScore: number;
  positiveSignals: string[];
  negativeSignals: string[];
  /** Asset cap rate used (NOI / purchase price). */
  assetCapRate: number | null;
  /** Adjusted cap rate used (adjusted NOI / purchase price). */
  adjustedCapRate: number | null;
}

const LOCATION_SCORES: Record<string, number> = {
  Manhattan: 15,
  Brooklyn: 13,
  Queens: 11,
  Bronx: 8,
  "Staten Island": 6,
  Other: 5,
};

function assetYieldScore(assetCapRate: number | null): number {
  if (assetCapRate == null || Number.isNaN(assetCapRate)) return 0;
  const pct = assetCapRate;
  if (pct < 3) return 5;
  if (pct < 4) return 10;
  if (pct < 5) return 15;
  if (pct < 6) return 18;
  return 20;
}

function adjustedYieldScore(adjustedCapRate: number | null): number {
  if (adjustedCapRate == null || Number.isNaN(adjustedCapRate)) return 0;
  const pct = adjustedCapRate;
  if (pct < 4) return 10;
  if (pct < 5) return 18;
  if (pct < 6) return 25;
  return 30;
}

function rentUpsideScore(pct: number | null): number {
  if (pct == null || Number.isNaN(pct) || pct < 0) return 0;
  const x = pct * 100;
  if (x < 1) return 0;
  if (x < 5) return 5;
  if (x < 10) return 10;
  if (x < 20) return 15;
  return 20;
}

function locationScore(area: string | null): number {
  if (!area || typeof area !== "string") return LOCATION_SCORES.Other ?? 5;
  const key = area.trim();
  return LOCATION_SCORES[key] ?? LOCATION_SCORES.Other ?? 5;
}

function liquidityScore(unitCount: number | null): number {
  if (unitCount == null || unitCount < 0) return 2;
  if (unitCount <= 10) return 5;
  if (unitCount <= 50) return 4;
  if (unitCount <= 100) return 3;
  return 2;
}

/**
 * Compute deal score and component scores from inputs.
 * Risk starts at 10; subtract for HPD (-3), DOB (-2), tax (-2), incomplete rent roll (-3).
 */
export function computeDealScore(inputs: DealScoringInputs): DealScoringResult {
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];

  const purchasePrice = inputs.purchasePrice && inputs.purchasePrice > 0 ? inputs.purchasePrice : null;
  const noi = inputs.noi;
  const adjustedNoi = inputs.adjustedNoi ?? noi;

  const assetCapRate =
    purchasePrice != null && noi != null && noi >= 0 ? (noi / purchasePrice) * 100 : null;
  const adjustedCapRate =
    purchasePrice != null && adjustedNoi != null && adjustedNoi >= 0
      ? (adjustedNoi / purchasePrice) * 100
      : null;

  const ays = assetYieldScore(assetCapRate);
  const adys = adjustedYieldScore(adjustedCapRate);
  const rus = rentUpsideScore(inputs.rentUpsidePct);
  const loc = locationScore(inputs.area);
  let risk = 10;
  if (inputs.hasHpdViolations) {
    risk -= 3;
    negativeSignals.push("HPD violations");
  }
  if (inputs.hasDobViolations) {
    risk -= 2;
    negativeSignals.push("DOB violations");
  }
  if (inputs.taxIrregularities) {
    risk -= 2;
    negativeSignals.push("Tax irregularities");
  }
  if (inputs.incompleteRentRoll) {
    risk -= 3;
    negativeSignals.push("Incomplete rent roll");
  }
  risk = Math.max(0, risk);
  const liq = liquidityScore(inputs.unitCount);

  if (assetCapRate != null && assetCapRate >= 5) positiveSignals.push("Strong asset yield");
  if (adjustedCapRate != null && adjustedCapRate >= 5) positiveSignals.push("Strong adjusted yield");
  if (inputs.area === "Manhattan") positiveSignals.push("Manhattan location");
  if (inputs.unitCount != null && inputs.unitCount >= 4 && inputs.unitCount <= 50)
    positiveSignals.push("Mid-size liquidity");

  const total =
    ays + adys + rus + loc + risk + liq;
  const dealScore = Math.max(0, Math.min(100, Math.round(total)));

  return {
    dealScore,
    assetYieldScore: ays,
    adjustedYieldScore: adys,
    rentUpsideScore: rus,
    locationScore: loc,
    riskScore: risk,
    liquidityScore: liq,
    positiveSignals,
    negativeSignals,
    assetCapRate,
    adjustedCapRate,
  };
}
