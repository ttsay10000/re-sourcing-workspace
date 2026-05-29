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

export interface DossierTeaserPhoto {
  url: string;
  label: string;
}

export interface DossierTeaserRentRow {
  unitLabel: string;
  unitDetail: string;
  currentRent: string;
  uplift: string;
  finalRent: string;
  unitExpenses: string;
  notes?: string | null;
}

export interface DossierTeaserRentSummary {
  subtitle: string;
  rows: DossierTeaserRentRow[];
  totals: DossierTeaserRentRow;
  expenseSubtitle: string;
  expenseRows: DossierTeaserRow[];
}

export interface DossierTeaserCashFlowCell {
  value: string;
  percentLabel?: string | null;
}

export interface DossierTeaserCashFlowRow {
  label: string;
  category: "revenue" | "expense" | "noi" | "capital" | "debt" | "return" | "metric";
  values: DossierTeaserCashFlowCell[];
  emphasis?: "subtotal" | "total" | "metric" | null;
  indentLevel?: number | null;
}

export interface DossierTeaserCashFlowSummary {
  subtitle: string;
  columns: string[];
  rows: DossierTeaserCashFlowRow[];
}

export interface DossierTeaserData {
  address: string;
  generatedAt: string;
  heroImageUrl: string | null;
  propertyPhotos: DossierTeaserPhoto[];
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
  mitigants: string[];
  rentSummary: DossierTeaserRentSummary;
  cashFlowSummary: DossierTeaserCashFlowSummary;
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

function accountingMoneyLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  if (Math.abs(value) < 0.5) return "-";
  const absolute = numberLabel(Math.abs(value));
  return value < 0 ? `($${absolute})` : `$${absolute}`;
}

function monthlyMoneyLabel(annualValue: number | null | undefined): string {
  return annualValue != null && Number.isFinite(annualValue) ? moneyLabel(annualValue / 12) : "N/A";
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

function resolveManualBuildingSqft(details: PropertyDetails | null): number | null {
  const sqft = toFiniteNumber(details?.dealDossier?.assumptions?.buildingSqft);
  return sqft != null && sqft > 0 ? sqft : null;
}

function resolveBuildingSqft(
  details: PropertyDetails | null,
  listing: Pick<ListingRow, "sqft" | "extra"> | null | undefined
): number | null {
  const propertyInfo = resolvePreferredOmPropertyInfo(details);
  const extra = asRecord(listing?.extra);
  return firstNumber(
    resolveManualBuildingSqft(details),
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
  listing: Pick<ListingRow, "title" | "price" | "sqft" | "extra"> | null | undefined
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
    listing?.price != null ? `Ask ${moneyLabel(listing.price)}` : null,
    listing?.price != null && buildingSqft != null && buildingSqft > 0
      ? `${moneyLabel(listing.price / buildingSqft)} PSF`
      : null,
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

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function collectImageUrls(value: unknown, result: string[] = []): string[] {
  if (result.length >= 8 || value == null) return result;
  const url = normalizeUrl(value);
  if (url) {
    result.push(url);
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageUrls(item, result);
      if (result.length >= 8) break;
    }
    return result;
  }
  const record = asRecord(value);
  if (!record) return result;
  for (const key of ["imageUrls", "images", "photos", "floorPlans", "floorplans", "media"]) {
    collectImageUrls(record[key], result);
    if (result.length >= 8) break;
  }
  return result;
}

function buildPropertyPhotos(
  listing: Pick<ListingRow, "imageUrls" | "extra"> | null | undefined
): DossierTeaserPhoto[] {
  const seen = new Set<string>();
  const urls = [
    ...(Array.isArray(listing?.imageUrls) ? listing.imageUrls : []),
    ...collectImageUrls(listing?.extra),
  ];
  const photos: DossierTeaserPhoto[] = [];
  for (const rawUrl of urls) {
    const url = normalizeUrl(rawUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const label = /floor.?plan|plan/i.test(url) ? `Floor plan ${photos.length + 1}` : `Property photo ${photos.length + 1}`;
    photos.push({ url, label });
    if (photos.length >= 6) break;
  }
  return photos;
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

function enrichmentSummary(
  details: PropertyDetails | null,
  snakeKey: string,
  camelKey: string
): Record<string, unknown> | null {
  const enrichment = asRecord(details?.enrichment);
  return asRecord(enrichment?.[snakeKey]) ?? asRecord(enrichment?.[camelKey]);
}

function detailSearchText(details: PropertyDetails | null): string {
  try {
    return JSON.stringify(
      {
        propertyOverview: details?.propertyOverview,
        enrichment: details?.enrichment,
        omData: details?.omData,
        rentalFinancials: details?.rentalFinancials,
        dealDossier: details?.dealDossier,
      },
      null,
      0
    ).slice(0, 80_000);
  } catch {
    return "";
  }
}

function findByKeyPattern(value: unknown, pattern: RegExp, depth = 0): unknown {
  if (depth > 5 || value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findByKeyPattern(item, pattern, depth + 1);
      if (result != null) return result;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const [key, child] of Object.entries(record)) {
    if (pattern.test(key)) return child;
    const result = findByKeyPattern(child, pattern, depth + 1);
    if (result != null) return result;
  }
  return null;
}

function findDetailString(details: PropertyDetails | null, pattern: RegExp): string | null {
  const value = findByKeyPattern(details, pattern);
  return firstString(value);
}

function unitDetailLabel(row: NonNullable<UnderwritingContext["unitModelRows"]>[number]): string {
  const parts = compact([
    row.beds != null ? `${numberLabel(row.beds)} bd` : null,
    row.baths != null ? `${numberLabel(row.baths)} ba` : null,
    row.sqft != null ? `${numberLabel(row.sqft)} SF` : null,
  ]);
  const rawQualifiers = compact([
    row.unitCategory && !/^residential$/i.test(row.unitCategory) ? row.unitCategory : null,
    row.isRentStabilized ? "rent-stabilized" : null,
    row.isCommercial ? "commercial" : null,
    row.isVacantLike ? "vacant" : null,
    row.tenantStatus,
  ]);
  const seen = new Set<string>();
  const qualifiers = rawQualifiers.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return compact([parts.join(" / ") || null, qualifiers.join(" · ") || null]).join(" | ") || "Details TBD";
}

function annualUnitExpenses(row: NonNullable<UnderwritingContext["unitModelRows"]>[number]): number | null {
  const components = [
    row.furnishingCost,
    row.onboardingLaborFee,
    row.onboardingOtherCosts,
    row.monthlyRecurringOpex != null ? row.monthlyRecurringOpex * 12 : null,
  ].filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  return components.length > 0 ? components.reduce((sum, value) => sum + value, 0) : null;
}

function finalAnnualRentBeforeOccupancy(row: NonNullable<UnderwritingContext["unitModelRows"]>[number]): number | null {
  const base = row.underwrittenAnnualRent ?? row.currentAnnualRent ?? null;
  if (base != null && Number.isFinite(base)) {
    return base * (1 + Math.max(0, row.rentUpliftPct ?? 0) / 100);
  }
  return row.modeledAnnualRent ?? null;
}

function unitUpliftLabel(
  row: NonNullable<UnderwritingContext["unitModelRows"]>[number],
  finalAnnualRent: number | null
): string {
  const currentAnnualRent = row.currentAnnualRent;
  if (currentAnnualRent != null && currentAnnualRent > 0 && finalAnnualRent != null) {
    return pctLabel(((finalAnnualRent - currentAnnualRent) / currentAnnualRent) * 100);
  }
  return pctLabel(row.rentUpliftPct);
}

function buildRentSummary(ctx: UnderwritingContext): DossierTeaserRentSummary {
  const unitRows = (ctx.unitModelRows ?? []).filter((row) => row.includeInUnderwriting !== false);
  const rows = unitRows.map((row) => {
    const finalAnnualRent = finalAnnualRentBeforeOccupancy(row);
    const unitExpenses = annualUnitExpenses(row);
    const notes = compact([
      row.isProtected ? "Protected from standard uplift" : null,
      row.notes,
    ]).join("; ");
    return {
      unitLabel: row.unitLabel,
      unitDetail: unitDetailLabel(row),
      currentRent: monthlyMoneyLabel(row.currentAnnualRent),
      uplift: unitUpliftLabel(row, finalAnnualRent),
      finalRent: monthlyMoneyLabel(finalAnnualRent),
      unitExpenses: unitExpenses != null ? `${moneyLabel(unitExpenses)} setup + ops` : "N/A",
      notes: notes || null,
    };
  });
  const currentAnnualTotal = unitRows.reduce((sum, row) => sum + Math.max(0, row.currentAnnualRent ?? 0), 0);
  const finalAnnualTotal = unitRows.reduce((sum, row) => sum + Math.max(0, finalAnnualRentBeforeOccupancy(row) ?? 0), 0);
  const unitExpenseTotal = unitRows.reduce((sum, row) => sum + Math.max(0, annualUnitExpenses(row) ?? 0), 0);
  const upliftPct =
    currentAnnualTotal > 0 ? ((finalAnnualTotal - currentAnnualTotal) / currentAnnualTotal) * 100 : null;
  const expenseRows = (ctx.expenseRows ?? [])
    .filter((row) => row.amount != null && Number.isFinite(row.amount))
    .map((row) => ({
      label: row.lineItem,
      value: moneyLabel(row.amount),
      sublabel: row.annualGrowthPct != null ? `${pctLabel(row.annualGrowthPct)} annual growth` : row.treatment ?? null,
    }));
  const expenseTotal = (ctx.expenseRows ?? []).reduce((sum, row) => sum + Math.max(0, row.amount ?? 0), 0);
  return {
    subtitle:
      "Per-floor/unit rents use saved OM workspace overrides first; unit expenses combine FF&E, onboarding labor/other, and recurring monthly operating items where available.",
    rows,
    totals: {
      unitLabel: "Total / average",
      unitDetail: `${numberLabel(unitRows.length)} modeled rows`,
      currentRent: monthlyMoneyLabel(currentAnnualTotal),
      uplift: pctLabel(upliftPct),
      finalRent: monthlyMoneyLabel(finalAnnualTotal),
      unitExpenses: unitExpenseTotal > 0 ? moneyLabel(unitExpenseTotal) : "N/A",
      notes: null,
    },
    expenseSubtitle:
      expenseTotal > 0
        ? `Operating expenses total ${moneyLabel(expenseTotal)} before management replacements/exclusions.`
        : "No separate operating expense rows were available in the OM workspace.",
    expenseRows,
  };
}

function valueAt(series: Array<number | null> | undefined, index: number): number | null {
  const value = series?.[index];
  return value != null && Number.isFinite(value) ? value : null;
}

function cashFlowPercentLabel(
  value: number | null,
  denominator: number | null,
  suffix: string
): string | null {
  if (value == null || denominator == null || denominator <= 0) return null;
  return `${((value / denominator) * 100).toFixed(0)}% ${suffix}`;
}

function metricPctCell(value: number | null | undefined, digits = 1): DossierTeaserCashFlowCell {
  return { value: value != null && Number.isFinite(value) ? decimalPctLabel(value, digits) : "-" };
}

function buildCashFlowSummary(ctx: UnderwritingContext): DossierTeaserCashFlowSummary {
  const yearly = ctx.yearlyCashFlow;
  if (!yearly) {
    return {
      subtitle: "Full annual cash-flow projection was not available for this run.",
      columns: [],
      rows: [],
    };
  }
  const columns = (yearly.endingLabels.length > 0 ? yearly.endingLabels : yearly.years.map((year) => `Y${year}`)).slice(0, 6);
  const initialEquity = Math.abs(ctx.acquisition.initialEquityInvested || 0) || null;
  const makeCells = (
    values: Array<number | null> | undefined,
    category: DossierTeaserCashFlowRow["category"],
    percentSuffix = "rev"
  ): DossierTeaserCashFlowCell[] =>
    columns.map((_, index) => {
      const amount = valueAt(values, index);
      const grossRent = valueAt(yearly.grossRentalIncome, index);
      const denominator =
        category === "return" ? initialEquity : category === "capital" ? Math.abs(valueAt(yearly.totalInvestmentCost, 0) ?? 0) : grossRent;
      return {
        value: accountingMoneyLabel(amount),
        percentLabel:
          amount != null
            ? cashFlowPercentLabel(Math.abs(amount), denominator && denominator > 0 ? denominator : null, percentSuffix)
            : null,
      };
    });
  const row = (
    label: string,
    category: DossierTeaserCashFlowRow["category"],
    values: Array<number | null> | undefined,
    percentSuffix?: string,
    options?: { emphasis?: DossierTeaserCashFlowRow["emphasis"]; indentLevel?: number | null }
  ): DossierTeaserCashFlowRow => ({
    label,
    category,
    values: makeCells(values, category, percentSuffix),
    emphasis: options?.emphasis ?? null,
    indentLevel: options?.indentLevel ?? null,
  });
  const metricRow = (
    label: string,
    values: DossierTeaserCashFlowCell[]
  ): DossierTeaserCashFlowRow => ({
    label,
    category: "metric",
    values,
    emphasis: "metric",
  });
  const expenseRows = (yearly.expenseLineItems ?? []).map((expense) =>
    row(expense.lineItem, "expense", expense.yearlyAmounts, "rev", { indentLevel: 1 })
  );
  const cashOnCashCells = columns.map((_, index) => {
    const cashFlow = valueAt(yearly.cashFlowAfterFinancing, index);
    return metricPctCell(cashFlow != null && initialEquity ? cashFlow / initialEquity : null);
  });
  const capRateOnPurchaseCells = columns.map((_, index) => metricPctCell(valueAt(yearly.capRateOnPurchase, index)));
  const exitCapCells = columns.map((_, index) =>
    index === columns.length - 1 ? { value: pctLabel(ctx.assumptions.exit.exitCapPct) } : { value: "-" }
  );
  const irrCells = columns.map((_, index) =>
    index === columns.length - 1 ? metricPctCell(ctx.returns.irrPct) : { value: "-" }
  );
  const equityMultipleCells = columns.map((_, index) =>
    index === columns.length - 1 ? { value: multipleLabel(ctx.returns.equityMultiple) } : { value: "-" }
  );
  return {
    subtitle:
      "Values are annual projections from the same underwriting model used for the Excel workbook; accounting totals are underlined and percentages are shown against gross rental revenue unless noted.",
    columns,
    rows: [
      row("Total investment cost", "capital", yearly.totalInvestmentCost, "cost"),
      row("Financing funding", "capital", yearly.financingFunding, "cost"),
      row("Gross rental income", "revenue", yearly.grossRentalIncome, "rev"),
      row("Other income", "revenue", yearly.otherIncome, "rev"),
      row("Vacancy loss", "expense", yearly.vacancyLoss, "rev", { indentLevel: 1 }),
      row("Lead-time loss", "expense", yearly.leadTimeLoss, "rev", { indentLevel: 1 }),
      row("Net rental income", "revenue", yearly.netRentalIncome, "rev", { emphasis: "subtotal" }),
      ...expenseRows,
      row("Management fee", "expense", yearly.managementFee, "rev", { indentLevel: 1 }),
      row("Total operating expenses", "expense", yearly.totalOperatingExpenses, "rev", { emphasis: "subtotal" }),
      row("NOI", "noi", yearly.noi, "rev", { emphasis: "subtotal" }),
      row("Recurring capex", "expense", yearly.recurringCapex, "rev", { indentLevel: 1 }),
      row("Cash flow from operations", "noi", yearly.cashFlowFromOperations, "rev", { emphasis: "subtotal" }),
      row("Debt service", "debt", yearly.debtService, "rev", { emphasis: "subtotal" }),
      row("Interest paid", "debt", yearly.interestPaid, "rev", { indentLevel: 1 }),
      row("Principal paid", "debt", yearly.principalPaid, "rev", { indentLevel: 1 }),
      row("Sale value", "capital", yearly.saleValue, "cost"),
      row("Sale closing costs", "capital", yearly.saleClosingCosts, "cost", { indentLevel: 1 }),
      row("Net sale proceeds to equity", "return", yearly.netSaleProceedsToEquity, "eq", { emphasis: "subtotal" }),
      row("Levered cash flow", "return", yearly.leveredCashFlow, "eq", { emphasis: "total" }),
      metricRow("Cap rate on purchase", capRateOnPurchaseCells),
      metricRow("Exit cap rate", exitCapCells),
      metricRow("Cash-on-cash return", cashOnCashCells),
      metricRow("5-year IRR", irrCells),
      metricRow("Equity multiple", equityMultipleCells),
    ],
  };
}

function buildRisks(
  ctx: UnderwritingContext,
  scoringResult: DealScoringResult | null | undefined,
  details: PropertyDetails | null,
  listing: Pick<ListingRow, "price" | "sqft" | "extra"> | null | undefined
): string[] {
  const dob = enrichmentSummary(details, "dob_complaints_summary", "dobComplaintsSummary");
  const hpd = enrichmentSummary(details, "hpd_violations_summary", "hpdViolationsSummary");
  const litigation = enrichmentSummary(details, "housing_litigations_summary", "housingLitigationsSummary");
  const rentUplift = ctx.assumptions.operating.blendedRentUpliftPct ?? ctx.assumptions.operating.rentUpliftPct;
  const vacancy = ctx.assumptions.operating.vacancyPct;
  const rentStabilizedUnits = ctx.propertyMix?.rentStabilizedUnits ?? null;
  const detailText = detailSearchText(details);
  const zoningLabel = firstString(
    findDetailString(details, /zoning|zoningDistrict|zone/i),
    detailText.match(/\b[CRMO]\d(?:-\d)?[A-Z]?\b/i)?.[0]
  );
  const useLabel = findDetailString(details, /(?:^|_|-)use(?:$|_|-)|buildingUse|occupancy/i);
  const taxClassLabel = firstString(
    findDetailString(details, /taxClass|tax_code|taxCode|propertyClass|buildingClass/i),
    ctx.propertyOverview?.taxCode
  );
  const hasO5Use = /\bO5\b/i.test([zoningLabel, useLabel, taxClassLabel, detailText].filter(Boolean).join(" "));
  const hasO2RSignal = /\bO2R\b|office\s+to\s+residential/i.test(detailText);
  const vacantUnitCount =
    ctx.unitModelRows?.filter(
      (row) =>
        row.isVacantLike ||
        /vacant|delivered vacant|available|owner/i.test([row.tenantStatus, row.notes].filter(Boolean).join(" ")) ||
        row.currentAnnualRent == null ||
        row.currentAnnualRent <= 0
    ).length ?? 0;
  const missingUnitSqftCount = ctx.unitModelRows?.filter((row) => row.sqft == null || row.sqft <= 0).length ?? 0;
  const thirdFloorRows =
    ctx.unitModelRows?.filter((row) => /\b(?:floor\s*)?3\b|3rd|third/i.test(row.unitLabel)) ?? [];
  const purchasePsf = resolvePricePsf(ctx, details, listing);
  const listedPsf =
    listing?.price != null
      ? (() => {
          const sqft = resolveBuildingSqft(details, listing);
          return sqft != null && sqft > 0 ? listing.price / sqft : null;
        })()
      : null;
  const neighborhoodMedianPsf = toFiniteNumber(details?.neighborhood?.metrics?.medianPricePsf);
  const pricePsfPremiumPct =
    purchasePsf != null && neighborhoodMedianPsf != null && neighborhoodMedianPsf > 0
      ? ((purchasePsf - neighborhoodMedianPsf) / neighborhoodMedianPsf) * 100
      : null;
  const listedPsfPremiumPct =
    listedPsf != null && neighborhoodMedianPsf != null && neighborhoodMedianPsf > 0
      ? ((listedPsf - neighborhoodMedianPsf) / neighborhoodMedianPsf) * 100
      : null;
  const negotiatedDiscountPct =
    listing?.price != null &&
    ctx.assumptions.acquisition.purchasePrice != null &&
    listing.price > 0 &&
    Math.abs(listing.price - ctx.assumptions.acquisition.purchasePrice) > 1
      ? ((listing.price - ctx.assumptions.acquisition.purchasePrice) / listing.price) * 100
      : null;
  return uniqueLimited(
    [
      rentUplift != null && rentUplift >= 50
        ? `High blended rent uplift (${pctLabel(rentUplift)}) needs rent-comp and vacancy diligence before relying on the upside case.`
        : null,
      vacancy != null && vacancy >= 10
        ? `Vacancy / lease-up cushion is material at ${pctLabel(vacancy)}; verify achievable gross rents and downtime.`
        : null,
      rentStabilizedUnits != null && rentStabilizedUnits > 0
        ? `${numberLabel(rentStabilizedUnits)} rent-stabilized / controlled unit(s) may limit rent uplift.`
        : null,
      hasO5Use
        ? "O5 / office-use signal: verify legal residential vs commercial use, certificate of occupancy, and whether any O2R filing is needed or already cleared."
        : null,
      hasO2RSignal
        ? "O2R / office-to-residential signal appears in source data; confirm filing status, approvals, and legal unit count."
        : null,
      taxClassLabel && /2B/i.test(taxClassLabel)
        ? `Tax class ${taxClassLabel} should be reconciled with the reported use/unit count and underwritten taxes.`
        : null,
      taxClassLabel && /class\s*4|tax\s*4|\b4\b/i.test(taxClassLabel) && ctx.propertyMix?.residentialUnits
        ? `Tax classification reads ${taxClassLabel}; verify taxes are not being modeled like a different class than the residential use.`
        : null,
      vacantUnitCount > 0
        ? `${numberLabel(vacantUnitCount)} unit/floor row(s) appear vacant or missing current rent; confirm downtime and improvement path.`
        : null,
      missingUnitSqftCount > 0
        ? `${numberLabel(missingUnitSqftCount)} unit/floor row(s) are missing SF; request floorplans/SF before relying on rent PSF or setup costs.`
        : null,
      thirdFloorRows.some((row) => row.currentAnnualRent == null || row.currentAnnualRent <= 0)
        ? "Floor 3 current rent is missing; request past rents as a benchmark even if pandemic-era or depressed."
        : null,
      toFiniteNumber(dob?.openCount) != null && (toFiniteNumber(dob?.openCount) ?? 0) > 0
        ? `${numberLabel(toFiniteNumber(dob?.openCount))} open DOB complaint(s) require diligence.`
        : null,
      toFiniteNumber(hpd?.openCount) != null && (toFiniteNumber(hpd?.openCount) ?? 0) > 0
        ? `${numberLabel(toFiniteNumber(hpd?.openCount))} open HPD violation(s) require diligence.`
        : null,
      toFiniteNumber(hpd?.rentImpairingOpen) != null && (toFiniteNumber(hpd?.rentImpairingOpen) ?? 0) > 0
        ? `${numberLabel(toFiniteNumber(hpd?.rentImpairingOpen))} rent-impairing HPD violation(s) are open.`
        : null,
      toFiniteNumber(litigation?.openCount) != null && (toFiniteNumber(litigation?.openCount) ?? 0) > 0
        ? `${numberLabel(toFiniteNumber(litigation?.openCount))} open housing litigation case(s) require diligence.`
        : null,
      pricePsfPremiumPct != null && pricePsfPremiumPct >= 20
        ? `Modeled purchase PSF is ${pctLabel(pricePsfPremiumPct)} above neighborhood median; verify building SF and comp set.`
        : null,
      listedPsfPremiumPct != null && listedPsfPremiumPct >= 20
        ? `Listed PSF is ${pctLabel(listedPsfPremiumPct)} above neighborhood median; negotiate against verified gross SF.`
        : null,
      negotiatedDiscountPct != null && negotiatedDiscountPct < 5
        ? `Modeled purchase price is only ${pctLabel(Math.max(0, negotiatedDiscountPct))} below list; price discipline is thin.`
        : null,
      ...(ctx.financialFlags ?? []).filter((flag) => /missing|verify|risk|incomplete|mismatch|stabilized|commercial|rent-stabilized/i.test(flag)),
      ...(scoringResult?.capReasons ?? []),
      ...(scoringResult?.negativeSignals ?? []),
      ctx.conditionReview?.renovationScope ? `Condition scope: ${ctx.conditionReview.renovationScope}` : null,
      ctx.conditionReview?.coverageMissing?.length
        ? `Photos do not cover: ${ctx.conditionReview.coverageMissing.join(", ")}`
        : null,
    ],
    14
  );
}

function buildMitigants(
  ctx: UnderwritingContext,
  details: PropertyDetails | null,
  listing: Pick<ListingRow, "price" | "sqft" | "extra"> | null | undefined
): string[] {
  const detailText = detailSearchText(details);
  const rentUplift = ctx.assumptions.operating.blendedRentUpliftPct ?? ctx.assumptions.operating.rentUpliftPct;
  const rentStabilizedUnits = ctx.propertyMix?.rentStabilizedUnits ?? null;
  const purchasePsf = resolvePricePsf(ctx, details, listing);
  const medianPsf = toFiniteNumber(details?.neighborhood?.metrics?.medianPricePsf);
  const hasO5Use = /\bO5\b/i.test(detailText);
  const hasO2RSignal = /\bO2R\b|office\s+to\s+residential/i.test(detailText);
  const vacantRows =
    ctx.unitModelRows?.filter(
      (row) =>
        row.isVacantLike ||
        /vacant|delivered vacant|available|owner/i.test([row.tenantStatus, row.notes].filter(Boolean).join(" ")) ||
        row.currentAnnualRent == null ||
        row.currentAnnualRent <= 0
    ) ?? [];
  const missingSqftRows = ctx.unitModelRows?.filter((row) => row.sqft == null || row.sqft <= 0) ?? [];
  return uniqueLimited(
    [
      rentUplift != null && rentUplift >= 25
        ? "Anchor the rent uplift to a per-floor comp grid and rerun downside sensitivity with lower gross rent and longer vacancy."
        : null,
      vacantRows.length > 0
        ? "Request floor-by-floor vacancy status, prior rent history, and a staged lease-up budget before treating vacant floors as upside."
        : null,
      rentStabilizedUnits != null && rentStabilizedUnits > 0
        ? "Run DHCR/rent-reg due diligence and keep protected units outside standard furnished-rental uplift until confirmed."
        : null,
      hasO5Use || hasO2RSignal
        ? "Confirm zoning/use with C/O, DOB BIS/NOW filings, and any O2R conversion materials before relying on residential repositioning."
        : null,
      missingSqftRows.length > 0
        ? "Use broker floorplans/SF as saved underwriting overrides so PSF, setup costs, and rent-per-SF metrics refresh in the next dossier."
        : null,
      purchasePsf != null && medianPsf != null && medianPsf > 0 && purchasePsf > medianPsf * 1.2
        ? "Reconcile negotiated price PSF against verified gross SF and recent comp sales before IC circulation."
        : null,
      ctx.conditionReview?.coverageMissing?.length
        ? `Add missing inspection/photo coverage for ${ctx.conditionReview.coverageMissing.join(", ")}.`
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
  listing: Pick<ListingRow, "imageUrls" | "sqft" | "extra"> | null | undefined,
  scoringResult: DealScoringResult | null | undefined
): string[] {
  const neighborhood = details?.neighborhood;
  const manualBuildingSqft = resolveManualBuildingSqft(details);
  const buildingSqft = resolveBuildingSqft(details, listing);
  const sqftSource =
    manualBuildingSqft != null
      ? `Building SF uses the saved manual underwriting override (${numberLabel(manualBuildingSqft)} SF).`
      : buildingSqft != null
        ? "Building SF uses OM/enrichment/listing fallback data; verify if PSF drives the decision."
        : "Building SF was unavailable, so PSF metrics are omitted until a manual override or source value is added.";
  return uniqueLimited(
    [
      ctx.currentGrossRent != null || ctx.currentNoi != null
        ? "Current rent, expenses, and NOI are assembled from the authoritative OM snapshot or saved broker notes."
        : "Current financials are incomplete; teaser metrics reflect the available underwriting model only.",
      sqftSource,
      Array.isArray(listing?.imageUrls) && listing.imageUrls.length > 0
        ? "Hero image uses the primary listing photo URL."
        : "No listing photo was available; the teaser renders with a neutral title panel.",
      ctx.yearlyCashFlow ? "Projected returns and capital stack are sourced from the detailed underwriting model." : null,
      ctx.unitModelRows?.length
        ? "Rent plan table reads saved OM workspace unit overrides before falling back to extracted OM rows."
        : null,
      "Risks read DOB complaints, HPD violations, housing litigation, rent-roll protection flags, and saved underwriting inputs when present.",
      neighborhood?.metrics
        ? `Neighborhood metrics read from property details${firstString(neighborhood.metrics.sourceAsOf) ? `, source as of ${firstString(neighborhood.metrics.sourceAsOf)}` : ""}.`
        : null,
      scoringResult ? `Deal score uses ${scoringResult.scoringProfileLabel} (${scoringResult.scoreVersion}).` : null,
      riskProfileLine(scoringResult?.riskProfile),
    ],
    8
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
    propertyPhotos: buildPropertyPhotos(listing),
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
    risks: buildRisks(ctx, scoringResult, details, listing),
    mitigants: buildMitigants(ctx, details, listing),
    rentSummary: buildRentSummary(ctx),
    cashFlowSummary: buildCashFlowSummary(ctx),
    provenance: buildProvenance(ctx, details, listing, scoringResult),
    sponsor: {
      name: params.sponsor?.name?.trim() || null,
      email: params.sponsor?.email?.trim() || null,
      organization: params.sponsor?.organization?.trim() || null,
    },
  };
}
