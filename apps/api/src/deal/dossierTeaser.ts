import type { DealRiskProfile, ListingRow, PropertyDetails } from "@re-sourcing/contracts";
import { resolvePreferredOmPropertyInfo } from "../om/authoritativeOm.js";
import type { DealScoringResult } from "./dealScoringEngine.js";
import type { UnderwritingContext } from "./underwritingContext.js";

export interface DossierTeaserKpi {
  label: string;
  value: string;
  sublabel?: string | null;
}

export interface DossierTeaserHighlight {
  title: string;
  body: string;
}

export interface DossierTeaserRow {
  label: string;
  value: string;
  sublabel?: string | null;
}

export interface DossierTeaserScenario {
  label: string;
  irr: string;
  cashOnCash: string;
  note: string;
}

export interface DossierTeaserData {
  address: string;
  generatedAt: string;
  heroImageUrl: string | null;
  strategyLabel: string;
  assetSummary: string;
  neighborhoodLabel: string | null;
  score: {
    value: number | null;
    confidenceLabel: string | null;
    profileLabel: string;
    profileKey: string;
  };
  kpis: DossierTeaserKpi[];
  investmentHighlights: DossierTeaserHighlight[];
  returnScenarios: DossierTeaserScenario[];
  projectedReturns: DossierTeaserRow[];
  capitalStack: DossierTeaserRow[];
  operatingSnapshot: DossierTeaserRow[];
  risks: string[];
  provenance: string[];
  sponsor: {
    name: string | null;
    email: string | null;
    organization: string | null;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const resolved = toFiniteNumber(value);
    if (resolved != null) return resolved;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value != null);
}

function numberLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return Math.round(value).toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

function moneyLabel(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `$${numberLabel(value)}` : "N/A";
}

function pctLabel(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(digits)}%`;
}

function decimalPctLabel(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(digits)}%`;
}

function multipleLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(2)}x`;
}

function confidenceLabel(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= 0.85) return "High";
  if (value >= 0.65) return "Moderate";
  return "Low";
}

function shareLabel(value: number | null, total: number | null): string | null {
  if (value == null || total == null || total <= 0) return null;
  return `${((value / total) * 100).toFixed(0)}% of total capitalization`;
}

function resolveBuildingSqft(
  details: PropertyDetails | null,
  listing: Pick<ListingRow, "sqft" | "extra"> | null | undefined
): number | null {
  const propertyInfo = resolvePreferredOmPropertyInfo(details);
  const extra = asRecord(listing?.extra);
  return firstNumber(
    propertyInfo?.buildingSqft,
    propertyInfo?.buildingSquareFeet,
    propertyInfo?.grossSqft,
    propertyInfo?.grossSquareFeet,
    propertyInfo?.squareFeet,
    details?.assessedGrossSqft,
    listing?.sqft,
    extra?.grossSqft,
    extra?.squareFeet
  );
}

function resolveTotalUnits(details: PropertyDetails | null, ctx: UnderwritingContext): number | null {
  const propertyInfo = resolvePreferredOmPropertyInfo(details);
  return firstNumber(
    propertyInfo?.totalUnits,
    propertyInfo?.unitsTotal,
    ctx.propertyMix?.totalUnits,
    ctx.unitCount
  );
}

function resolveCommercialUnits(details: PropertyDetails | null, ctx: UnderwritingContext): number | null {
  const propertyInfo = resolvePreferredOmPropertyInfo(details);
  return firstNumber(propertyInfo?.unitsCommercial, ctx.propertyMix?.commercialUnits);
}

function resolveAssetSummary(
  details: PropertyDetails | null,
  ctx: UnderwritingContext,
  listing: Pick<ListingRow, "title" | "sqft" | "extra"> | null | undefined
): string {
  const propertyInfo = resolvePreferredOmPropertyInfo(details);
  const totalUnits = resolveTotalUnits(details, ctx);
  const commercialUnits = resolveCommercialUnits(details, ctx) ?? 0;
  const buildingSqft = resolveBuildingSqft(details, listing);
  const rawType = firstString(
    propertyInfo?.assetClass,
    propertyInfo?.propertyType,
    propertyInfo?.buildingType,
    asRecord(listing?.extra)?.propertyType,
    listing?.title
  );
  const typeLabel = rawType
    ? rawType.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim()
    : commercialUnits > 0
      ? "Mixed-use"
      : "Multifamily";
  const parts = compact([
    totalUnits != null ? `${numberLabel(totalUnits)} units` : null,
    commercialUnits > 0 ? `${numberLabel(commercialUnits)} commercial` : null,
    buildingSqft != null ? `${numberLabel(buildingSqft)} SF` : null,
  ]);
  return parts.length > 0 ? `${typeLabel} | ${parts.join(" | ")}` : typeLabel;
}

function resolveStrategyLabel(ctx: UnderwritingContext): string {
  const explicit = ctx.assumptions.acquisition.investmentProfile?.trim();
  if (explicit) return explicit;
  if ((ctx.assumptions.acquisition.furnishingSetupCosts ?? 0) > 0) {
    return "Furnished monthly-rental value-add";
  }
  if ((ctx.assumptions.operating.blendedRentUpliftPct ?? ctx.assumptions.operating.rentUpliftPct ?? 0) >= 10) {
    return "Value-add multifamily";
  }
  return "Yield / steady-state";
}

function resolveNeighborhoodLabel(details: PropertyDetails | null): string | null {
  const neighborhood = details?.neighborhood;
  const primary = neighborhood?.primary;
  const market = asRecord(neighborhood?.market);
  return firstString(primary?.name, primary?.normalizedName, market?.rollingSalesNeighborhood);
}

function resolvePricePsf(ctx: UnderwritingContext, details: PropertyDetails | null, listing: Pick<ListingRow, "sqft" | "extra"> | null | undefined): number | null {
  const price = ctx.assumptions.acquisition.purchasePrice ?? ctx.purchasePrice;
  const sqft = resolveBuildingSqft(details, listing);
  return price != null && sqft != null && sqft > 0 ? price / sqft : null;
}

function noiGrowthPct(ctx: UnderwritingContext): number | null {
  const currentNoi = ctx.currentStateNoi ?? ctx.currentNoi;
  if (currentNoi == null || currentNoi === 0) return null;
  return ((ctx.operating.stabilizedNoi - currentNoi) / Math.abs(currentNoi)) * 100;
}

function riskProfileLine(profile: DealRiskProfile | null | undefined): string | null {
  if (!profile) return null;
  const parts = compact([
    profile.rentRollCoveragePct != null
      ? `${(profile.rentRollCoveragePct * 100).toFixed(0)}% rent-roll coverage`
      : null,
    profile.commercialRevenueSharePct != null && profile.commercialRevenueSharePct > 0
      ? `${(profile.commercialRevenueSharePct * 100).toFixed(0)}% commercial rent share`
      : null,
    profile.rentStabilizedRevenueSharePct != null && profile.rentStabilizedRevenueSharePct > 0
      ? `${(profile.rentStabilizedRevenueSharePct * 100).toFixed(0)}% rent-stabilized rent share`
      : null,
  ]);
  return parts.length > 0 ? parts.join("; ") : null;
}

function uniqueLimited(values: Array<string | null | undefined>, limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
}

function buildHighlights(ctx: UnderwritingContext, details: PropertyDetails | null): DossierTeaserHighlight[] {
  const offer = ctx.recommendedOffer;
  const neighborhoodMetrics = details?.neighborhood?.metrics;
  const sourceAsOf = firstString(neighborhoodMetrics?.sourceAsOf);
  const pricePsfMedian = toFiniteNumber(neighborhoodMetrics?.medianPricePsf);
  const rentUplift = ctx.assumptions.operating.blendedRentUpliftPct ?? ctx.assumptions.operating.rentUpliftPct;
  const highlights = compact<DossierTeaserHighlight>([
    {
      title: "NOI Repositioning",
      body:
        noiGrowthPct(ctx) != null
          ? `Stabilized NOI is underwritten at ${moneyLabel(ctx.operating.stabilizedNoi)}, ${pctLabel(noiGrowthPct(ctx))} above the current NOI basis.`
          : `Stabilized NOI is underwritten at ${moneyLabel(ctx.operating.stabilizedNoi)}.`
    },
    rentUplift != null
      ? {
          title: "Rent Strategy",
          body: `The base case carries ${pctLabel(rentUplift)} blended rent uplift with ${pctLabel(ctx.assumptions.operating.vacancyPct)} vacancy and ${pctLabel(ctx.assumptions.operating.annualExpenseGrowthPct)} annual expense growth.`
        }
      : null,
    offer?.recommendedOfferHigh != null
      ? {
          title: "Offer Discipline",
          body:
            offer.discountToAskingPct != null && offer.discountToAskingPct > 0
              ? `${moneyLabel(offer.recommendedOfferHigh)} is the high end of the target-IRR offer range, ${pctLabel(offer.discountToAskingPct)} below ask.`
              : `The asking price clears the ${pctLabel(offer.targetIrrPct, 0)} target IRR in the current model.`
        }
      : null,
    pricePsfMedian != null
      ? {
          title: "Neighborhood Marker",
          body: `Neighborhood median sale pricing is ${moneyLabel(pricePsfMedian)} PSF${sourceAsOf ? ` as of ${sourceAsOf}` : ""}; use this as a comp anchor for pricing review.`
        }
      : null,
  ]);
  return highlights.slice(0, 4);
}

function buildRisks(ctx: UnderwritingContext, scoringResult: DealScoringResult | null | undefined): string[] {
  return uniqueLimited(
    [
      ...(scoringResult?.capReasons ?? []),
      ...(scoringResult?.negativeSignals ?? []),
      ...(ctx.financialFlags ?? []).filter((flag) => /missing|verify|risk|incomplete|mismatch|stabilized|commercial|rent-stabilized/i.test(flag)),
      ctx.conditionReview?.renovationScope ? `Condition scope: ${ctx.conditionReview.renovationScope}` : null,
      ctx.conditionReview?.coverageMissing?.length
        ? `Photos do not cover: ${ctx.conditionReview.coverageMissing.join(", ")}`
        : null,
    ],
    6
  );
}

function findScenario(
  ctx: UnderwritingContext,
  sensitivityKey: "rental_uplift" | "exit_cap_rate",
  pick: "minIrr" | "maxIrr"
): { irrPct: number | null; cashOnCashPct: number | null; note: string } | null {
  const sensitivity = ctx.sensitivities?.find((item) => item.key === sensitivityKey);
  if (!sensitivity || sensitivity.scenarios.length === 0) return null;
  const sorted = [...sensitivity.scenarios].sort((left, right) => {
    const leftIrr = left.irrPct ?? (pick === "minIrr" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    const rightIrr = right.irrPct ?? (pick === "minIrr" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    return pick === "minIrr" ? leftIrr - rightIrr : rightIrr - leftIrr;
  });
  const scenario = sorted[0];
  if (!scenario) return null;
  return {
    irrPct: scenario.irrPct,
    cashOnCashPct: scenario.year1CashOnCashReturn,
    note: `${sensitivity.inputLabel}: ${pctLabel(scenario.valuePct)}`,
  };
}

function buildReturnScenarios(ctx: UnderwritingContext): DossierTeaserScenario[] {
  const downside =
    findScenario(ctx, "rental_uplift", "minIrr") ??
    findScenario(ctx, "exit_cap_rate", "minIrr");
  const upside =
    findScenario(ctx, "rental_uplift", "maxIrr") ??
    findScenario(ctx, "exit_cap_rate", "maxIrr");
  return [
    {
      label: "Downside",
      irr: decimalPctLabel(downside?.irrPct ?? null),
      cashOnCash: decimalPctLabel(downside?.cashOnCashPct ?? null),
      note: downside?.note ?? "Sensitivity not available",
    },
    {
      label: "Base",
      irr: decimalPctLabel(ctx.returns.irrPct),
      cashOnCash: decimalPctLabel(ctx.returns.year1CashOnCashReturn ?? ctx.returns.averageCashOnCashReturn),
      note: `${numberLabel(ctx.assumptions.holdPeriodYears)}-year hold`,
    },
    {
      label: "Upside",
      irr: decimalPctLabel(upside?.irrPct ?? null),
      cashOnCash: decimalPctLabel(upside?.cashOnCashPct ?? null),
      note: upside?.note ?? "Sensitivity not available",
    },
  ];
}

function buildProvenance(
  ctx: UnderwritingContext,
  details: PropertyDetails | null,
  listing: Pick<ListingRow, "imageUrls"> | null | undefined,
  scoringResult: DealScoringResult | null | undefined
): string[] {
  const neighborhood = details?.neighborhood;
  return uniqueLimited(
    [
      ctx.currentGrossRent != null || ctx.currentNoi != null
        ? "Current rent, expenses, and NOI are assembled from the authoritative OM snapshot or saved broker notes."
        : "Current financials are incomplete; teaser metrics reflect the available underwriting model only.",
      Array.isArray(listing?.imageUrls) && listing.imageUrls.length > 0
        ? "Hero image uses the primary listing photo URL."
        : "No listing photo was available; the teaser renders with a neutral title panel.",
      ctx.yearlyCashFlow ? "Projected returns and capital stack are sourced from the detailed underwriting model." : null,
      neighborhood?.metrics
        ? `Neighborhood metrics read from property details${firstString(neighborhood.metrics.sourceAsOf) ? `, source as of ${firstString(neighborhood.metrics.sourceAsOf)}` : ""}.`
        : null,
      scoringResult ? `Deal score uses ${scoringResult.scoringProfileLabel} (${scoringResult.scoreVersion}).` : null,
      riskProfileLine(scoringResult?.riskProfile),
    ],
    6
  );
}

export function buildDossierTeaserData(params: {
  ctx: UnderwritingContext;
  details: PropertyDetails | null;
  listing: Pick<ListingRow, "title" | "price" | "sqft" | "imageUrls" | "extra"> | null;
  scoringResult?: DealScoringResult | null;
  generatedAt?: string | null;
  sponsor?: {
    name?: string | null;
    email?: string | null;
    organization?: string | null;
  } | null;
}): DossierTeaserData {
  const { ctx, details, listing, scoringResult } = params;
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const totalCapitalization = ctx.acquisition.totalProjectCost;
  const equity = ctx.acquisition.initialEquityInvested;
  const debt = ctx.financing.loanAmount;
  const renovationCosts = Math.max(0, ctx.assumptions.acquisition.renovationCosts ?? 0);
  const furnishingCosts = Math.max(0, ctx.assumptions.acquisition.furnishingSetupCosts ?? 0);
  const onboardingCosts = Math.max(0, ctx.assumptions.acquisition.onboardingCosts ?? 0);
  const upfrontCapex = renovationCosts + furnishingCosts + onboardingCosts;
  const price = ctx.assumptions.acquisition.purchasePrice ?? ctx.purchasePrice;
  const pricePsf = resolvePricePsf(ctx, details, listing);
  const neighborhoodMetrics = details?.neighborhood?.metrics;

  return {
    address: ctx.canonicalAddress,
    generatedAt,
    heroImageUrl: Array.isArray(listing?.imageUrls) ? listing.imageUrls[0] ?? null : null,
    strategyLabel: resolveStrategyLabel(ctx),
    assetSummary: resolveAssetSummary(details, ctx, listing),
    neighborhoodLabel: resolveNeighborhoodLabel(details),
    score: {
      value: scoringResult?.isScoreable === false ? null : ctx.dealScore,
      confidenceLabel: confidenceLabel(scoringResult?.confidenceScore),
      profileLabel: scoringResult?.scoringProfileLabel ?? "Legacy deterministic v3",
      profileKey: scoringResult?.scoringProfileKey ?? "legacy_v3",
    },
    kpis: [
      { label: "Deal Score", value: ctx.dealScore != null ? numberLabel(ctx.dealScore) : "N/A", sublabel: scoringResult?.capReasons[0] ?? scoringResult?.positiveSignals[0] ?? null },
      { label: "Purchase Price", value: moneyLabel(price), sublabel: pricePsf != null ? `${moneyLabel(pricePsf)} PSF` : null },
      { label: "Projected IRR", value: decimalPctLabel(ctx.returns.irrPct), sublabel: `${numberLabel(ctx.assumptions.holdPeriodYears)}-year hold` },
      { label: "Equity Multiple", value: multipleLabel(ctx.returns.equityMultiple), sublabel: decimalPctLabel(ctx.returns.averageCashOnCashReturn) + " avg CoC" },
      { label: "Current Cap", value: pctLabel(ctx.assetCapRate), sublabel: moneyLabel(ctx.currentStateNoi ?? ctx.currentNoi) + " NOI basis" },
      { label: "Stabilized Cap", value: pctLabel(ctx.adjustedCapRate), sublabel: moneyLabel(ctx.operating.stabilizedNoi) + " NOI" },
    ],
    investmentHighlights: buildHighlights(ctx, details),
    returnScenarios: buildReturnScenarios(ctx),
    projectedReturns: [
      { label: "Initial equity", value: moneyLabel(equity), sublabel: shareLabel(equity, totalCapitalization) },
      { label: "Annual debt service", value: moneyLabel(ctx.financing.annualDebtService), sublabel: `${pctLabel(ctx.assumptions.financing.interestRatePct)} rate / ${pctLabel(ctx.assumptions.financing.ltvPct, 0)} LTV` },
      { label: "Year 1 equity yield", value: decimalPctLabel(ctx.returns.year1EquityYield ?? ctx.returns.year1CashOnCashReturn), sublabel: moneyLabel(ctx.cashFlows.annualEquityGain ?? ctx.cashFlows.annualOperatingCashFlow) },
      { label: "Average cash-on-cash", value: decimalPctLabel(ctx.returns.averageCashOnCashReturn), sublabel: moneyLabel(ctx.cashFlows.annualOperatingCashFlow) + " base operating CF" },
      { label: "Exit value", value: moneyLabel(ctx.exit.exitPropertyValue), sublabel: `${pctLabel(ctx.assumptions.exit.exitCapPct)} exit cap` },
      { label: "Net proceeds to equity", value: moneyLabel(ctx.exit.netProceedsToEquity), sublabel: multipleLabel(ctx.returns.equityMultiple) },
    ],
    capitalStack: [
      { label: "Senior debt", value: moneyLabel(debt), sublabel: shareLabel(debt, totalCapitalization) },
      { label: "Equity", value: moneyLabel(equity), sublabel: shareLabel(equity, totalCapitalization) },
      { label: "Upfront CapEx", value: moneyLabel(upfrontCapex), sublabel: compact([
        renovationCosts > 0 ? `${moneyLabel(renovationCosts)} renovation` : null,
        furnishingCosts > 0 ? `${moneyLabel(furnishingCosts)} furnishing` : null,
        onboardingCosts > 0 ? `${moneyLabel(onboardingCosts)} onboarding` : null,
      ]).join(" / ") || null },
      { label: "Total capitalization", value: moneyLabel(totalCapitalization), sublabel: `Closing costs ${moneyLabel(ctx.acquisition.purchaseClosingCosts)}` },
    ],
    operatingSnapshot: [
      { label: "Current gross rent", value: moneyLabel(ctx.currentGrossRent), sublabel: ctx.currentOtherIncome ? `${moneyLabel(ctx.currentOtherIncome)} other income` : null },
      { label: "Current expenses", value: moneyLabel(ctx.currentExpensesTotal ?? ctx.operating.currentExpenses), sublabel: ctx.expenseRows?.length ? `${ctx.expenseRows.length} expense rows` : null },
      { label: "Stabilized gross rent", value: moneyLabel(ctx.operating.adjustedGrossRent), sublabel: ctx.rentBreakdown?.freeMarketResidentialLift != null ? `${moneyLabel(ctx.rentBreakdown.freeMarketResidentialLift)} free-market lift` : null },
      { label: "Neighborhood median PSF", value: moneyLabel(toFiniteNumber(neighborhoodMetrics?.medianPricePsf)), sublabel: firstString(neighborhoodMetrics?.sourceAsOf) },
    ],
    risks: buildRisks(ctx, scoringResult),
    provenance: buildProvenance(ctx, details, listing, scoringResult),
    sponsor: {
      name: params.sponsor?.name?.trim() || null,
      email: params.sponsor?.email?.trim() || null,
      organization: params.sponsor?.organization?.trim() || null,
    },
  };
}
