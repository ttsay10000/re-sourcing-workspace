/**
 * Deal scoring engine (deterministic fallback): asset cap 50 pts, IRR tiers, risk deductions.
 * Primary deal score is produced by the LLM (dealScoringLlm) using the same rubric plus qualitative judgment.
 * This engine: asset cap 5%+ = 50 pts, 4–5% = 30–50, under 4% = low; IRR 25%+ = top tier; risk = deduct
 * per rent-stabilized unit and for complaints/violations/litigation by severity.
 */

export interface DealScoringInputs {
  /** Purchase price (listing price). */
  purchasePrice: number | null;
  /** Current NOI for asset cap rate. */
  noi: number | null;
  /** 5-year IRR as decimal (e.g. 0.22 = 22%). Target 25%+ = top deal. */
  irr5yrPct?: number | null;
  /** Number of rent-stabilized units; each deducts from score. */
  rentStabilizedUnitCount?: number;
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
  assetCapRate: number | null;
  adjustedCapRate: number | null;
}

/** Asset cap rate: 50 points max. 5%+ = 50, 4–5% = 30–50, under 4% = low (0–30). */
function assetCapScore(assetCapRate: number | null): number {
  if (assetCapRate == null || Number.isNaN(assetCapRate)) return 0;
  const pct = assetCapRate;
  if (pct >= 5) return 50;
  if (pct >= 4) return 30 + (pct - 4) * 20;
  if (pct >= 3) return 15 + (pct - 3) * 15;
  return Math.max(0, pct * 5);
}

/** IRR 5-year: 25%+ = top (30 pts), 20–25% = 20, 15–20% = 10, below 15% = 0. */
function irrScore(irr5yrPct: number | null | undefined): number {
  if (irr5yrPct == null || Number.isNaN(irr5yrPct)) return 0;
  const pct = irr5yrPct * 100;
  if (pct >= 25) return 30;
  if (pct >= 20) return 20;
  if (pct >= 15) return 10;
  return 0;
}

/** Risk deduction: rent-stabilized units (e.g. 6 pts per unit), then violations/complaints/litigation by severity. */
function riskDeduction(inputs: DealScoringInputs): number {
  let deduct = 0;
  const rentStab = inputs.rentStabilizedUnitCount ?? 0;
  deduct += rentStab * 6;

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

/**
 * Compute deal score (fallback when LLM scoring is unavailable).
 * Score = asset cap (50 max) + IRR (30 max) − risk deductions, clamped 0–100.
 */
export function computeDealScore(inputs: DealScoringInputs): DealScoringResult {
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];

  const purchasePrice = inputs.purchasePrice && inputs.purchasePrice > 0 ? inputs.purchasePrice : null;
  const noi = inputs.noi;
  const assetCapRate =
    purchasePrice != null && noi != null && noi >= 0 ? (noi / purchasePrice) * 100 : null;

  const capSc = assetCapScore(assetCapRate);
  const irrSc = irrScore(inputs.irr5yrPct);
  const deduct = riskDeduction(inputs);

  if (assetCapRate != null && assetCapRate >= 5) positiveSignals.push("Asset cap ≥5%");
  if (inputs.irr5yrPct != null && inputs.irr5yrPct >= 0.25) positiveSignals.push("IRR ≥25% (5yr)");
  else if (inputs.irr5yrPct != null && inputs.irr5yrPct >= 0.2) positiveSignals.push("IRR ≥20% (5yr)");

  const rentStab = inputs.rentStabilizedUnitCount ?? 0;
  if (rentStab > 0) negativeSignals.push(`${rentStab} rent-stabilized unit(s)`);
  if ((inputs.hpdOpenCount ?? 0) > 0 || (inputs.hpdRentImpairingOpen ?? 0) > 0)
    negativeSignals.push("HPD violations");
  if ((inputs.dobOpenCount ?? 0) > 0 || (inputs.dobCount30 ?? 0) > 0)
    negativeSignals.push("DOB complaints");
  if ((inputs.litigationOpenCount ?? 0) > 0 || (inputs.litigationTotal ?? 0) > 0)
    negativeSignals.push("Housing litigations");
  if (inputs.irr5yrPct != null && inputs.irr5yrPct < 0.2) negativeSignals.push("IRR below 20% (5yr)");

  const total = Math.max(0, capSc + irrSc - deduct);
  const dealScore = Math.max(0, Math.min(100, Math.round(total)));

  return {
    dealScore,
    assetYieldScore: capSc,
    adjustedYieldScore: 0,
    rentUpsideScore: 0,
    locationScore: 0,
    riskScore: Math.max(0, 80 - deduct),
    liquidityScore: 0,
    positiveSignals,
    negativeSignals,
    assetCapRate,
    adjustedCapRate: null,
  };
}
