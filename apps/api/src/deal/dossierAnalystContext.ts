import type { ListingRow, PropertyDetails } from "@re-sourcing/contracts";
import {
  getAuthoritativeOmSnapshot,
  resolvePreferredOmPropertyInfo,
  resolvePreferredOmRentRoll,
  resolvePreferredOmRevenueComposition,
} from "../om/authoritativeOm.js";
import type { DossierAnalystContext, UnderwritingContext } from "./underwritingContext.js";

export type DossierAnalystListing = Pick<
  ListingRow,
  "title" | "description" | "extra" | "url" | "price" | "sqft" | "city" | "listedAt"
>;

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

function trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().replace(/\s+/g, " ")
    : null;
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value != null);
}

function uniqueLimited(values: Array<string | null | undefined>, limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = normalizeText(value);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

function moneyLabel(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function pctLabel(value: number | null | undefined, digits = 1): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return `${normalized.toFixed(digits)}%`;
}

function shorten(value: string, maxChars = 190): string {
  const clean = normalizeText(value);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 1).trim()}...`;
}

function sentenceMatches(text: string, patterns: RegExp[], limit: number): string[] {
  if (!text.trim()) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+|(?:\s[-•]\s)/g)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  return uniqueLimited(
    sentences
      .filter((sentence) => patterns.some((pattern) => pattern.test(sentence)))
      .map((sentence) => shorten(sentence)),
    limit
  );
}

function listingDescriptionFromExtra(extra: Record<string, unknown> | null): string | null {
  return trimmedString(extra?.description) ??
    trimmedString(extra?.marketingDescription) ??
    trimmedString(extra?.overview) ??
    trimmedString(asRecord(extra?.rawAttributes)?.description) ??
    trimmedString(asRecord(extra?.rawAttributes)?.marketingDescription);
}

function listingText(listing: DossierAnalystListing | null | undefined): string {
  if (!listing) return "";
  const extra = asRecord(listing.extra);
  return compact([
    listing.title ? `Title: ${listing.title}` : null,
    listing.description ?? listingDescriptionFromExtra(extra),
    Array.isArray(extra?.investmentHighlights) ? extra.investmentHighlights.join(". ") : null,
    trimmedString(extra?.propertyType),
  ]).join(". ");
}

function listingSummary(listing: DossierAnalystListing | null | undefined): string | null {
  const text = listingText(listing);
  if (!text) return null;
  const pieces = compact([
    listing?.title ? `Title reads "${shorten(listing.title, 90)}"` : null,
    listing?.price != null ? `ask ${moneyLabel(listing.price)}` : null,
    listing?.sqft != null ? `${Math.round(listing.sqft).toLocaleString("en-US")} SF` : null,
    listing?.city ?? null,
  ]);
  const lead = pieces.length > 0 ? pieces.join(" | ") : "Listing description is available";
  const firstUsefulSentence = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .find((sentence) => sentence.length >= 30);
  return firstUsefulSentence ? `${lead}. Description lead: ${shorten(firstUsefulSentence, 170)}` : lead;
}

function listingSignals(listing: DossierAnalystListing | null | undefined): {
  listingSignals: string[];
  brokerClaims: string[];
  mixedUseRetailSignals: string[];
  diligenceFlags: string[];
} {
  const text = listingText(listing);
  if (!text) {
    return {
      listingSignals: [],
      brokerClaims: [],
      mixedUseRetailSignals: [],
      diligenceFlags: [],
    };
  }

  const condition = sentenceMatches(
    text,
    [
      /\b(value[- ]add|needs?\s+(?:work|tlc)|as[- ]is|deferred|dated|original|renovated|turnkey|gut|shell|vacant|delivered vacant)\b/i,
    ],
    4
  ).map((sentence) => `Listing condition cue: ${sentence}`);
  const amenities = sentenceMatches(
    text,
    [
      /\b(roof deck|private outdoor|garden|backyard|terrace|balcony|laundry|washer|dryer|storage|parking|elevator|central air|hvac|new roof|boiler)\b/i,
    ],
    4
  ).map((sentence) => `Amenity / systems cue: ${sentence}`);
  const brokerClaims = sentenceMatches(
    text,
    [
      /\b(upside|below[- ]market|pro forma|projected|air rights|development rights|assemblage|conversion|opportunity|cap rate|noi|rent roll|income)\b/i,
    ],
    6
  ).map((sentence) => `Broker/listing claim: ${sentence}`);
  const mixedUseRetailSignals = sentenceMatches(
    text,
    [
      /\b(retail|commercial|storefront|store front|ground[- ]floor|restaurant|cafe|corridor|frontage|tenant|lease|nnn|triple net|community facility|office)\b/i,
    ],
    6
  ).map((sentence) => `Retail/commercial cue: ${sentence}`);
  const diligenceFlags = sentenceMatches(
    text,
    [
      /\b(as[- ]is|legal|certificate of occupancy|c\/o|violations?|rent[- ]stabilized|tenant occupied|delivered vacant|air rights|development rights|conversion|illegal|nonconforming)\b/i,
    ],
    5
  ).map((sentence) => `Listing diligence flag: ${sentence}`);

  return {
    listingSignals: uniqueLimited([...condition, ...amenities], 6),
    brokerClaims,
    mixedUseRetailSignals,
    diligenceFlags,
  };
}

function memoAndTakeawaySignals(details: PropertyDetails | null | undefined): string[] {
  const snapshot = getAuthoritativeOmSnapshot(details ?? null);
  const rentalOm = asRecord(details?.rentalFinancials)?.omAnalysis;
  const omAnalysis = asRecord(rentalOm);
  const memo = asRecord(snapshot?.dossierMemo) ?? asRecord(omAnalysis?.dossierMemo);
  const memoLines = memo
    ? Object.entries(memo)
        .map(([key, value]) => trimmedString(value) ? `${key}: ${trimmedString(value)}` : null)
        .filter((value): value is string => Boolean(value))
    : [];
  const takeaways = Array.isArray(snapshot?.investmentTakeaways)
    ? snapshot.investmentTakeaways
    : Array.isArray(omAnalysis?.investmentTakeaways)
      ? omAnalysis.investmentTakeaways
      : [];
  return uniqueLimited(
    [
      ...takeaways.map((value) => (typeof value === "string" ? `OM takeaway: ${value}` : null)),
      ...memoLines.map((value) => `OM memo: ${value}`),
      trimmedString(asRecord(details?.rentalFinancials?.fromLlm)?.keyTakeaways)
        ? `Listing/OM extracted takeaways: ${trimmedString(asRecord(details?.rentalFinancials?.fromLlm)?.keyTakeaways)}`
        : null,
    ],
    8
  );
}

function marketSummaryText(value: unknown): string[] {
  if (value == null) return [];
  const payloads = Array.isArray(value) ? value : [value];
  const rows: string[] = [];
  for (const payload of payloads) {
    const record = asRecord(payload);
    if (!record) continue;
    const summary = trimmedString(record.summary);
    if (summary) rows.push(`Broker market summary: ${shorten(summary)}`);
    const updatedAt = trimmedString(record.updatedAt);
    if (updatedAt) rows.push(`Broker market snapshot as of ${updatedAt}.`);
    const packageRecord = asRecord(record.package);
    const sourceName = trimmedString(packageRecord?.sourceName);
    const status = trimmedString(packageRecord?.status);
    if (sourceName || status) {
      rows.push(`Broker comp package: ${compact([sourceName, status]).join(" | ")}.`);
    }
  }
  return rows;
}

function compItemSignals(value: unknown): string[] {
  const payloads = Array.isArray(value) ? value : [value];
  const items: unknown[] = [];
  for (const payload of payloads) {
    const record = asRecord(payload);
    if (!record) continue;
    if (Array.isArray(record.items)) items.push(...record.items);
    if (Array.isArray(record.packages)) {
      for (const packagePayload of record.packages) {
        const packageRecord = asRecord(packagePayload);
        if (Array.isArray(packageRecord?.items)) items.push(...packageRecord.items);
      }
    }
  }

  const signals: string[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (!record) continue;
    if (record.includeInDossier === false) continue;
    const selection = trimmedString(record.selectionDecision);
    if (selection && /exclude|rejected|not_comparable|duplicate/i.test(selection)) continue;
    const reviewStatus = trimmedString(record.reviewStatus);
    if (reviewStatus && /rejected/i.test(reviewStatus)) continue;
    const normalized = asRecord(record.normalizedPayload) ?? asRecord(record.rawPayload) ?? record;
    const address = trimmedString(normalized.address) ?? trimmedString(normalized.propertyAddress);
    const salePrice = toFiniteNumber(normalized.salePrice) ?? toFiniteNumber(normalized.price);
    const pricePsf = toFiniteNumber(normalized.pricePsf) ?? toFiniteNumber(normalized.pricePerSqft) ?? toFiniteNumber(normalized.psf);
    const capRate = toFiniteNumber(normalized.capRate) ?? toFiniteNumber(normalized.capRatePct);
    const source = trimmedString(record.analystNote) ?? trimmedString(normalized.source);
    const parts = compact([
      address ?? "approved comp",
      salePrice != null ? moneyLabel(salePrice) : null,
      pricePsf != null ? `${moneyLabel(pricePsf)} PSF` : null,
      capRate != null ? `${pctLabel(capRate)} cap` : null,
      source,
    ]);
    if (parts.length > 1) signals.push(`Approved internal comp: ${parts.join(" | ")}`);
  }
  return uniqueLimited(signals, 5);
}

function neighborhoodSignals(details: PropertyDetails | null | undefined): string[] {
  const neighborhood = details?.neighborhood;
  const primary = asRecord(neighborhood?.primary);
  const metrics = asRecord(neighborhood?.metrics);
  const market = asRecord(neighborhood?.market);
  const name = trimmedString(primary?.name) ?? trimmedString(primary?.normalizedName);
  const borough = trimmedString(primary?.borough) ?? trimmedString(market?.borough);
  const sourceAsOf = trimmedString(metrics?.sourceAsOf);
  const medianPricePsf = toFiniteNumber(metrics?.medianPricePsf);
  const medianRent = toFiniteNumber(metrics?.medianRent) ?? toFiniteNumber(metrics?.medianRentPsf);
  const salesNeighborhood = trimmedString(market?.rollingSalesNeighborhood);
  return uniqueLimited(
    [
      name || borough ? `Neighborhood context: ${compact([name, borough]).join(", ")}.` : null,
      medianPricePsf != null
        ? `Internal neighborhood metric: median sale pricing ${moneyLabel(medianPricePsf)} PSF${sourceAsOf ? ` as of ${sourceAsOf}` : ""}.`
        : null,
      medianRent != null
        ? `Internal neighborhood rent marker: ${moneyLabel(medianRent)}${/psf/i.test(String(metrics?.medianRentPsf ?? "")) ? " PSF" : ""}${sourceAsOf ? ` as of ${sourceAsOf}` : ""}.`
        : null,
      salesNeighborhood ? `NYC sales neighborhood mapping: ${salesNeighborhood}.` : null,
      ...marketSummaryText(details?.marketComps),
      ...marketSummaryText(details?.brokerComps),
      ...compItemSignals(details?.marketComps),
      ...compItemSignals(details?.brokerComps),
      ...compItemSignals(details?.brokerCompPackage),
      ...compItemSignals(details?.brokerCompPackages),
    ],
    10
  );
}

function commercialAnnualRentFromRoll(details: PropertyDetails | null | undefined): number | null {
  const rows = resolvePreferredOmRentRoll(details ?? null);
  let total = 0;
  for (const row of rows) {
    const label = [row.unitCategory, row.unit, row.tenantName, row.notes].filter(Boolean).join(" ");
    if (!/\b(commercial|retail|storefront|office|restaurant|cafe|community facility)\b/i.test(label)) continue;
    const annual =
      row.annualTotalRent ??
      row.annualBaseRent ??
      row.annualRent ??
      (row.monthlyTotalRent != null ? row.monthlyTotalRent * 12 : null) ??
      (row.monthlyBaseRent != null ? row.monthlyBaseRent * 12 : null) ??
      (row.monthlyRent != null ? row.monthlyRent * 12 : null) ??
      null;
    if (annual != null && Number.isFinite(annual)) total += annual;
  }
  return total > 0 ? total : null;
}

function tenantLeaseSignals(details: PropertyDetails | null | undefined): string[] {
  const rows = resolvePreferredOmRentRoll(details ?? null);
  const out: string[] = [];
  for (const row of rows) {
    const label = [row.unitCategory, row.unit, row.tenantName, row.notes].filter(Boolean).join(" ");
    if (!/\b(commercial|retail|storefront|office|restaurant|cafe|community facility)\b/i.test(label)) continue;
    const parts = compact([
      row.unit ?? row.unitCategory ?? "Commercial unit",
      row.tenantName ? `tenant ${row.tenantName}` : null,
      row.leaseEndDate ? `lease ends ${row.leaseEndDate}` : null,
      row.leaseType,
      row.rentEscalations ? `escalations ${row.rentEscalations}` : null,
      row.notes,
    ]);
    if (parts.length > 1) out.push(`Commercial lease cue: ${parts.join(" | ")}`);
  }
  return uniqueLimited(out, 5);
}

function mixedUseSignals(params: {
  details: PropertyDetails | null | undefined;
  listing: DossierAnalystListing | null | undefined;
  ctx?: Pick<UnderwritingContext, "propertyMix" | "rentBreakdown" | "assumptions"> | null;
}): string[] {
  const { details, listing, ctx } = params;
  const propertyInfo = resolvePreferredOmPropertyInfo(details ?? null);
  const revenue = resolvePreferredOmRevenueComposition(details ?? null);
  const listingTextValue = listingText(listing);
  const commercialUnits =
    toFiniteNumber(propertyInfo?.unitsCommercial) ??
    (ctx?.propertyMix?.commercialUnits != null ? ctx.propertyMix.commercialUnits : null);
  const annualCommercialRent =
    toFiniteNumber(revenue?.commercialAnnualRent) ??
    toFiniteNumber(revenue?.commercialGrossRentalIncome) ??
    commercialAnnualRentFromRoll(details);
  const annualTotalRent =
    toFiniteNumber(revenue?.totalAnnualRent) ??
    toFiniteNumber(revenue?.grossRentalIncome) ??
    ctx?.rentBreakdown?.current.total ??
    null;
  const commercialShare =
    toFiniteNumber(revenue?.commercialRevenueShare) ??
    (annualCommercialRent != null && annualTotalRent != null && annualTotalRent > 0
      ? annualCommercialRent / annualTotalRent
      : null);
  const retailSqft = toFiniteNumber(details?.assessedRetailAreaGross);
  const officeSqft = toFiniteNumber(details?.assessedOfficeAreaGross);
  const annualCommercialGrowth = ctx?.assumptions.operating.annualCommercialRentGrowthPct ?? null;
  const listingRetailCues = sentenceMatches(
    listingTextValue,
    [
      /\b(retail|commercial|storefront|store front|ground[- ]floor|frontage|corridor|tenant|lease|restaurant|cafe|office)\b/i,
    ],
    4
  ).map((sentence) => `Listing retail footprint cue: ${sentence}`);

  return uniqueLimited(
    [
      commercialUnits != null && commercialUnits > 0 ? `Mixed-use count: ${commercialUnits} commercial unit(s).` : null,
      annualCommercialRent != null ? `Commercial rent basis: ${moneyLabel(annualCommercialRent)} annual rent from internal rent roll / OM fields.` : null,
      commercialShare != null ? `Commercial rent share: ${pctLabel(commercialShare)} of annual rent.` : null,
      retailSqft != null && retailSqft > 0 ? `Valuation footprint: ${Math.round(retailSqft).toLocaleString("en-US")} retail gross SF.` : null,
      officeSqft != null && officeSqft > 0 ? `Valuation footprint: ${Math.round(officeSqft).toLocaleString("en-US")} office gross SF.` : null,
      annualCommercialGrowth != null ? `Commercial growth assumption: ${pctLabel(annualCommercialGrowth)} annual rent growth.` : null,
      ...tenantLeaseSignals(details),
      ...listingRetailCues,
    ],
    10
  );
}

function validationDiligenceFlags(details: PropertyDetails | null | undefined): string[] {
  const snapshot = getAuthoritativeOmSnapshot(details ?? null);
  const flags = Array.isArray(snapshot?.validationFlags) ? snapshot.validationFlags : [];
  return uniqueLimited(
    flags.map((flag) => {
      const message = trimmedString(flag.message);
      if (message) return `OM validation flag: ${message}`;
      const field = trimmedString(flag.field) ?? "OM field";
      return `OM validation flag: verify ${field}.`;
    }),
    5
  );
}

function brokerNotesSource(brokerEmailNotes: string | null | undefined, summary: string | null | undefined): string[] {
  if (!brokerEmailNotes?.trim() && !summary?.trim()) return [];
  return uniqueLimited(
    [
      summary ? `Saved broker notes summary: ${summary}` : null,
      brokerEmailNotes?.trim() ? "Saved broker/user notes were included as an internal underwriting source." : null,
    ],
    2
  );
}

export function buildDossierAnalystContext(params: {
  details: PropertyDetails | null | undefined;
  listing?: DossierAnalystListing | null;
  brokerEmailNotes?: string | null;
  brokerNotesSummary?: string | null;
  ctx?: Pick<UnderwritingContext, "propertyMix" | "rentBreakdown" | "assumptions"> | null;
}): DossierAnalystContext | null {
  const fromListing = listingSignals(params.listing);
  const marketNeighborhoodSignals = neighborhoodSignals(params.details);
  const mixedUseRetailSignals = uniqueLimited(
    [
      ...fromListing.mixedUseRetailSignals,
      ...mixedUseSignals({
        details: params.details,
        listing: params.listing,
        ctx: params.ctx,
      }),
    ],
    12
  );
  const brokerClaims = uniqueLimited(
    [
      ...fromListing.brokerClaims,
      ...memoAndTakeawaySignals(params.details),
      ...brokerNotesSource(params.brokerEmailNotes, params.brokerNotesSummary),
    ],
    12
  );
  const diligenceFlags = uniqueLimited(
    [
      ...fromListing.diligenceFlags,
      ...validationDiligenceFlags(params.details),
      ...(params.details?.brokerCompMissingDataFlags ?? []).map((flag) => {
        const label = trimmedString(flag.label) ?? trimmedString(flag.field) ?? "Broker comp field";
        const message = trimmedString(flag.message);
        return message ? `Broker comp diligence flag: ${label}: ${message}` : `Broker comp diligence flag: verify ${label}.`;
      }),
    ],
    12
  );
  const sourceNotes = uniqueLimited(
    [
      params.listing?.url ? `Primary listing URL available: ${params.listing.url}` : null,
      getAuthoritativeOmSnapshot(params.details ?? null) ? "Authoritative OM snapshot included." : null,
      marketNeighborhoodSignals.length > 0 ? "Market/neighborhood context uses internal property details, broker comp packages, and approved comp items only." : null,
      mixedUseRetailSignals.length > 0 ? "Retail/commercial footprint context uses internal listing, OM, valuation, and rent-roll fields only." : null,
    ],
    6
  );

  const context: DossierAnalystContext = {
    listingSummary: listingSummary(params.listing),
    listingSignals: uniqueLimited(fromListing.listingSignals, 8),
    brokerClaims,
    marketNeighborhoodSignals,
    mixedUseRetailSignals,
    diligenceFlags,
    sourceNotes,
  };

  const hasAnySignal = Boolean(
    context.listingSummary ||
      context.listingSignals?.length ||
      context.brokerClaims?.length ||
      context.marketNeighborhoodSignals?.length ||
      context.mixedUseRetailSignals?.length ||
      context.diligenceFlags?.length ||
      context.sourceNotes?.length
  );
  return hasAnySignal ? context : null;
}
