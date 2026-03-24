import type { ListingRow, PropertyDetails } from "@re-sourcing/contracts";
import { resolvePreferredOmPropertyInfo } from "../om/authoritativeOm.js";
import type { DossierPdfCoverData, DossierPdfCoverField } from "./dossierToPdf.js";
import type { UnderwritingContext } from "./underwritingContext.js";

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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const resolved = stringValue(value);
    if (resolved) return resolved;
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

function numberLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

function moneyLabel(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `$${numberLabel(value)}` : "—";
}

function integerPctLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? "" : ""}${rounded}%`;
}

function pctLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

function sqftLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${numberLabel(value)} SQFT`;
}

function formatBaths(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded.toFixed(0)) : String(rounded);
}

function headlineCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "mf") return "MF";
      if (lower === "nyc") return "NYC";
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
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
    propertyInfo?.residentialSqft,
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

function resolveResidentialUnits(details: PropertyDetails | null, ctx: UnderwritingContext): number | null {
  const propertyInfo = resolvePreferredOmPropertyInfo(details);
  return firstNumber(propertyInfo?.unitsResidential, ctx.propertyMix?.residentialUnits);
}

function resolveCommercialUnits(details: PropertyDetails | null, ctx: UnderwritingContext): number | null {
  const propertyInfo = resolvePreferredOmPropertyInfo(details);
  return firstNumber(propertyInfo?.unitsCommercial, ctx.propertyMix?.commercialUnits);
}

function resolveAssetClass(
  details: PropertyDetails | null,
  ctx: UnderwritingContext,
  listing: Pick<ListingRow, "title" | "extra"> | null | undefined
): string {
  const propertyInfo = resolvePreferredOmPropertyInfo(details);
  const extra = asRecord(listing?.extra);
  const totalUnits = resolveTotalUnits(details, ctx);
  const commercialUnits = resolveCommercialUnits(details, ctx) ?? 0;
  const raw = firstString(
    propertyInfo?.assetClass,
    propertyInfo?.propertyType,
    propertyInfo?.buildingType,
    extra?.propertyType,
    extra?.buildingType,
    listing?.title
  );
  const normalized = raw?.toLowerCase() ?? "";
  if (normalized.includes("townhouse") || normalized.includes("brownstone")) {
    return commercialUnits > 0 ? "Mixed-use townhouse" : "MF townhouse";
  }
  if (normalized.includes("mixed")) return "Mixed-use";
  if (normalized.includes("commercial") && commercialUnits > 0) return "Mixed-use";
  if (normalized.includes("multi")) {
    return totalUnits != null && totalUnits <= 4 ? "MF townhouse" : "Multifamily";
  }
  if (commercialUnits > 0) return "Mixed-use";
  if (totalUnits != null && totalUnits <= 4) return "MF townhouse";
  if (totalUnits != null && totalUnits > 4) return "Multifamily";
  return raw ? headlineCase(raw) : "Investment property";
}

function resolveExistingUnits(
  details: PropertyDetails | null,
  ctx: UnderwritingContext,
  listing: Pick<ListingRow, "beds" | "baths"> | null | undefined
): string {
  const totalUnits = resolveTotalUnits(details, ctx);
  const residentialUnits = resolveResidentialUnits(details, ctx);
  const commercialUnits = resolveCommercialUnits(details, ctx);
  if (residentialUnits != null && commercialUnits != null && commercialUnits > 0) {
    return `${numberLabel(residentialUnits)} res / ${numberLabel(commercialUnits)} commercial`;
  }
  if (totalUnits != null) {
    const unitLabel = `${numberLabel(totalUnits)} unit${Math.round(totalUnits) === 1 ? "" : "s"}`;
    if (listing?.beds != null && listing?.baths != null && totalUnits === 1) {
      return `${unitLabel} (${numberLabel(listing.beds)}B/${formatBaths(listing.baths)}Ba)`;
    }
    return unitLabel;
  }
  if (listing?.beds != null && listing?.baths != null) {
    return `${numberLabel(listing.beds)}B/${formatBaths(listing.baths)}Ba`;
  }
  return "—";
}

function resolveYearBuilt(
  details: PropertyDetails | null,
  listing: Pick<ListingRow, "extra"> | null | undefined
): string {
  const propertyInfo = resolvePreferredOmPropertyInfo(details);
  const extra = asRecord(listing?.extra);
  const value = firstNumber(
    propertyInfo?.yearBuilt,
    propertyInfo?.built,
    propertyInfo?.constructionYear,
    extra?.yearBuilt,
    extra?.built
  );
  return value != null ? numberLabel(value) : "—";
}

function resolveZoning(details: PropertyDetails | null): string {
  const propertyInfo = resolvePreferredOmPropertyInfo(details);
  const enrichmentZoning = details?.enrichment?.zoning;
  return firstString(
    propertyInfo?.zoning,
    propertyInfo?.zoningDistrict,
    propertyInfo?.zoningDistrict1,
    enrichmentZoning?.zoningDistrict1,
    enrichmentZoning?.zoningDistrict2
  ) ?? "—";
}

function resolveInvestmentProfile(ctx: UnderwritingContext): string {
  const upfrontCapex =
    Math.max(0, ctx.assumptions.acquisition.renovationCosts ?? 0) +
    Math.max(0, ctx.assumptions.acquisition.furnishingSetupCosts ?? 0);
  const upliftPct =
    ctx.assumptions.operating.blendedRentUpliftPct ??
    ctx.assumptions.operating.rentUpliftPct ??
    0;
  const commercialUnits = ctx.propertyMix?.commercialUnits ?? 0;
  if (commercialUnits > 0 && (upfrontCapex >= 25_000 || upliftPct >= 8)) return "Value-add mixed-use";
  if (upfrontCapex >= 50_000 || upliftPct >= 12) return "Value-add";
  if (upfrontCapex >= 10_000 || upliftPct >= 5) return "Light value-add";
  return "Yield / steady-state";
}

function currentExpensesTotal(ctx: UnderwritingContext): number | null {
  if (ctx.currentExpensesTotal != null && Number.isFinite(ctx.currentExpensesTotal)) {
    return ctx.currentExpensesTotal;
  }
  if (ctx.currentGrossRent != null && ctx.currentNoi != null) {
    return ctx.currentGrossRent + (ctx.currentOtherIncome ?? 0) - ctx.currentNoi;
  }
  return null;
}

function currentNoiBasis(ctx: UnderwritingContext): number | null {
  if (ctx.currentStateNoi != null && Number.isFinite(ctx.currentStateNoi)) return ctx.currentStateNoi;
  if (ctx.currentNoi != null && Number.isFinite(ctx.currentNoi)) return ctx.currentNoi;
  const expenses = currentExpensesTotal(ctx);
  if (ctx.currentGrossRent != null && expenses != null) {
    return ctx.currentGrossRent + (ctx.currentOtherIncome ?? 0) - expenses;
  }
  return null;
}

function displayedCurrentRent(ctx: UnderwritingContext): number | null {
  if (ctx.currentGrossRent == null || !Number.isFinite(ctx.currentGrossRent)) return null;
  const projectedLeaseUp =
    ctx.conservativeProjectedLeaseUpRent != null && ctx.conservativeProjectedLeaseUpRent > 0
      ? ctx.conservativeProjectedLeaseUpRent
      : 0;
  return ctx.currentGrossRent + (ctx.currentOtherIncome ?? 0) + projectedLeaseUp;
}

function resolveYearValue(values: number[] | null | undefined, year: number): number | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const direct = values[year];
  if (direct != null && Number.isFinite(direct)) return direct;
  const fallback = values[values.length - 1];
  return fallback != null && Number.isFinite(fallback) ? fallback : null;
}

function financingTermsLabel(ctx: UnderwritingContext): string {
  const terms: string[] = [];
  if (ctx.assumptions.financing.ltvPct != null) {
    terms.push(`${ctx.assumptions.financing.ltvPct.toFixed(0)}% LTV`);
  }
  if (ctx.assumptions.financing.interestRatePct != null) {
    terms.push(`${ctx.assumptions.financing.interestRatePct.toFixed(2)}% rate`);
  }
  if (ctx.assumptions.financing.amortizationYears != null) {
    terms.push(`${ctx.assumptions.financing.amortizationYears.toFixed(0)}-yr amort.`);
  }
  return terms.length > 0 ? terms.join(", ") : "—";
}

function negotiatedPriceLabel(
  offer: number | null | undefined,
  buildingSqft: number | null
): string {
  if (offer == null || !Number.isFinite(offer)) return "—";
  const pricePsf =
    buildingSqft != null && buildingSqft > 0
      ? Math.round(offer / buildingSqft)
      : null;
  return pricePsf != null ? `${moneyLabel(offer)} / $${numberLabel(pricePsf)} PSF` : moneyLabel(offer);
}

function coverField(
  label: string,
  value: string,
  options?: { emphasis?: boolean }
): DossierPdfCoverField {
  return { label, value, emphasis: options?.emphasis === true };
}

export function buildDossierPdfCoverData(params: {
  ctx: UnderwritingContext;
  details: PropertyDetails | null;
  listing: Pick<ListingRow, "title" | "price" | "beds" | "baths" | "sqft" | "imageUrls" | "extra"> | null;
}): DossierPdfCoverData {
  const { ctx, details, listing } = params;
  const buildingSqft = resolveBuildingSqft(details, listing);
  const currentRent = displayedCurrentRent(ctx);
  const projectedLeaseUpIncluded =
    ctx.conservativeProjectedLeaseUpRent != null && ctx.conservativeProjectedLeaseUpRent > 0;
  const currentExpenses = currentExpensesTotal(ctx);
  const currentNoi = currentNoiBasis(ctx);
  const yearTwoRent = resolveYearValue(ctx.yearlyCashFlow?.grossRentalIncome, 2);
  const yearTwoExpenses = resolveYearValue(ctx.yearlyCashFlow?.totalOperatingExpenses, 2);
  const yearTwoNoi = resolveYearValue(ctx.yearlyCashFlow?.noi, 2);
  const noiGrowthPct =
    currentNoi != null && currentNoi !== 0 && yearTwoNoi != null
      ? ((yearTwoNoi - currentNoi) / Math.abs(currentNoi)) * 100
      : null;
  const upfrontCapex =
    Math.max(0, ctx.assumptions.acquisition.renovationCosts ?? 0) +
    Math.max(0, ctx.assumptions.acquisition.furnishingSetupCosts ?? 0);

  return {
    address: ctx.canonicalAddress,
    backgroundImageUrl: Array.isArray(listing?.imageUrls) ? listing.imageUrls[0] ?? null : null,
    propertyInfo: {
      title: "PROPERTY INFO",
      rows: [
        coverField("Asset class", resolveAssetClass(details, ctx, listing)),
        coverField("Size", sqftLabel(buildingSqft)),
        coverField("Existing units", resolveExistingUnits(details, ctx, listing)),
        coverField("Year built", resolveYearBuilt(details, listing)),
        coverField("Tax code", ctx.propertyOverview?.taxCode?.trim() || "—"),
        coverField("Zoning district", resolveZoning(details)),
      ],
    },
    acquisitionInfo: {
      title: "ACQUISITION INFO",
      rows: [
        coverField("Investment profile", resolveInvestmentProfile(ctx)),
        coverField("Target acquisition date", ctx.purchasePrice != null ? "ASAP" : "—"),
        coverField("Listed price", moneyLabel(ctx.purchasePrice ?? listing?.price ?? null)),
        coverField(
          "Negotiated price",
          negotiatedPriceLabel(ctx.recommendedOffer?.recommendedOfferHigh, buildingSqft)
        ),
      ],
    },
    keyFinancials: {
      title: "KEY FINANCIALS",
      rows: [
        coverField(
          "Current rent",
          `${moneyLabel(currentRent)}${projectedLeaseUpIncluded ? " (projected)" : ""}`
        ),
        coverField("Expenses", moneyLabel(currentExpenses)),
        coverField("Current NOI", moneyLabel(currentNoi), { emphasis: true }),
        coverField("Current cap rate", pctLabel(ctx.assetCapRate), { emphasis: true }),
        coverField("Projected Y2 rent", moneyLabel(yearTwoRent)),
        coverField("Projected Y2 expenses", moneyLabel(yearTwoExpenses)),
        coverField("Projected Y2 NOI", moneyLabel(yearTwoNoi), { emphasis: true }),
        coverField("Increase in stabilized NOI", integerPctLabel(noiGrowthPct), { emphasis: true }),
      ],
    },
    expectedReturns: {
      title: "EXPECTED RETURNS",
      rows: [
        coverField("Upfront CapEx", moneyLabel(upfrontCapex)),
        coverField("Financing terms", financingTermsLabel(ctx)),
        coverField(
          "Target hold period",
          ctx.assumptions.holdPeriodYears != null
            ? `${ctx.assumptions.holdPeriodYears.toFixed(0)} year${ctx.assumptions.holdPeriodYears === 1 ? "" : "s"}`
            : "—"
        ),
        coverField(
          `Projected ${(ctx.assumptions.holdPeriodYears ?? 5).toFixed(0)}-year IRR`,
          pctLabel(
            ctx.returns.irrPct != null && Number.isFinite(ctx.returns.irrPct)
              ? ctx.returns.irrPct * 100
              : null
          ),
          { emphasis: true }
        ),
      ],
    },
  };
}
