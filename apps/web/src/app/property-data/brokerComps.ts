import type {
  BrokerCompDataFlag,
  BrokerCompExtractedItem,
  BrokerCompPackageReviewPayload,
  BrokerCompPricingOpinion,
} from "@re-sourcing/contracts";

export interface BrokerCompComparableRow {
  id: string;
  packageId: string | null;
  address: string | null;
  itemType: string;
  price: number | null;
  pricePerUnit: number | null;
  pricePerSqft: number | null;
  capRatePct: number | null;
  units: number | null;
  buildingSqft: number | null;
  saleDate: string | null;
  source: string | null;
  reviewStatus: string | null;
  selectionDecision: string | null;
  notes: string | null;
}

export interface BrokerCompPackageRow {
  id: string;
  label: string;
  status: string | null;
  packageType: string | null;
  sourceName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  itemCount: number;
  reviewedItemCount: number;
}

export interface BrokerCompUiSurface {
  packages: BrokerCompPackageRow[];
  comparables: BrokerCompComparableRow[];
  pricingOpinions: BrokerCompPricingOpinion[];
  missingDataFlags: BrokerCompDataFlag[];
  summary: string | null;
  status: string | null;
  updatedAt: string | null;
  hasData: boolean;
}

const PACKAGE_CONTAINER_KEYS = [
  "marketComps",
  "brokerComps",
  "brokerCompPackage",
  "brokerCompPackages",
  "compPackages",
  "compPackage",
  "packages",
  "packageDetails",
  "comps",
] as const;

const ITEM_KEYS = ["items", "extractedItems", "comparables", "reviewedComps", "comparableSales"] as const;
const PRICING_KEYS = ["pricingOpinions", "brokerPricingOpinions", "whisperPrices", "pricingOpinion"] as const;
const FLAG_KEYS = ["missingDataFlags", "dataFlags", "missingFlags", "missingFields"] as const;

export function plannedBrokerCompUploadEndpoint(propertyId: string): string {
  return `/api/properties/${encodeURIComponent(propertyId)}/broker-comps/upload`;
}

export function plannedBrokerCompReviewEndpoint(propertyId: string): string {
  return `/api/properties/${encodeURIComponent(propertyId)}/broker-comps/review`;
}

export function readBrokerCompSurface(...sources: unknown[]): BrokerCompUiSurface {
  const packages: BrokerCompPackageReviewPayload[] = [];
  const looseItems: BrokerCompExtractedItem[] = [];
  const pricingOpinions: BrokerCompPricingOpinion[] = [];
  const missingDataFlags: BrokerCompDataFlag[] = [];
  let summary: string | null = null;
  let status: string | null = null;
  let updatedAt: string | null = null;

  const visit = (value: unknown, depth = 0, inCompContainer = false): void => {
    if (value == null || depth > 4) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1, inCompContainer);
      return;
    }
    if (!isRecord(value)) return;

    if (isReviewPayload(value)) {
      const payload = normalizeReviewPayload(value);
      packages.push(payload);
      updatedAt = latestDate(updatedAt, stringValue(payload.package.updatedAt));
      status = status ?? stringValue(payload.package.status);
      return;
    }

    const hasCompContainer = PACKAGE_CONTAINER_KEYS.some((key) => key in value);
    for (const key of PACKAGE_CONTAINER_KEYS) {
      if (key in value) visit(value[key], depth + 1, true);
    }

    const hasCompPayload =
      inCompContainer ||
      ITEM_KEYS.some((key) => key in value) ||
      PRICING_KEYS.some((key) => key in value) ||
      "missingDataFlags" in value ||
      "dataFlags" in value ||
      "missingFlags" in value ||
      "whisperPrice" in value ||
      "whisper_price" in value ||
      "packageSummary" in value;
    if (!hasCompPayload) {
      if (hasCompContainer) return;
      return;
    }

    for (const key of ITEM_KEYS) {
      looseItems.push(...normalizeItems(value[key]));
    }
    for (const key of PRICING_KEYS) {
      pricingOpinions.push(...normalizePricingOpinions(value[key]));
    }
    for (const key of FLAG_KEYS) {
      missingDataFlags.push(...normalizeFlags(value[key]));
    }

    summary = summary ?? stringValue(value.summary) ?? stringValue(value.packageSummary) ?? stringValue(value.notes);
    status = status ?? stringValue(value.status) ?? stringValue(value.reviewStatus);
    updatedAt = latestDate(
      updatedAt,
      stringValue(value.updatedAt) ?? stringValue(value.reviewedAt) ?? stringValue(value.extractedAt) ?? stringValue(value.createdAt)
    );

    const whisperPrice = numberValue(value.whisperPrice ?? value.whisper_price);
    if (whisperPrice != null) {
      pricingOpinions.push({
        amount: whisperPrice,
        source: stringValue(value.whisperPriceSource) ?? stringValue(value.sourceName) ?? "Broker",
        sourceType: "broker",
        note: stringValue(value.whisperPriceNote) ?? "Whisper price",
        observedAt: stringValue(value.whisperPriceObservedAt) ?? stringValue(value.updatedAt),
      });
    }
  };

  for (const source of sources) visit(source);

  const allItems = [...packages.flatMap((entry) => entry.items), ...looseItems];
  const packageRows = packages.map(packageRow);
  const comparables = dedupeComparables(allItems.map(comparableRow).filter((row): row is BrokerCompComparableRow => row != null));
  const allPricingOpinions = dedupePricingOpinions([
    ...pricingOpinions,
    ...allItems.flatMap((item) => pricingOpinionFromItem(item)),
  ]);
  const allMissingFlags = dedupeFlags([
    ...missingDataFlags,
    ...allItems.flatMap((item) => missingFlagsFromItem(item)),
  ]);
  const reviewedItems = allItems.filter((item) => isReviewedStatus(item.reviewStatus)).length;

  return {
    packages: packageRows,
    comparables,
    pricingOpinions: allPricingOpinions,
    missingDataFlags: allMissingFlags,
    summary,
    status: status ?? packageRows[0]?.status ?? null,
    updatedAt,
    hasData:
      packageRows.length > 0 ||
      comparables.length > 0 ||
      allPricingOpinions.length > 0 ||
      allMissingFlags.length > 0 ||
      Boolean(summary) ||
      reviewedItems > 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReviewPayload(value: unknown): value is BrokerCompPackageReviewPayload {
  return isRecord(value) && isRecord(value.package) && Array.isArray(value.pages) && (Array.isArray(value.items) || Array.isArray(value.extractedItems));
}

function normalizeReviewPayload(value: BrokerCompPackageReviewPayload): BrokerCompPackageReviewPayload {
  const record = value as unknown as Record<string, unknown>;
  const packageRecord = isRecord(record.package) ? record.package : {};
  const packageMeta = isRecord(packageRecord.packageMeta) ? packageRecord.packageMeta : isRecord(packageRecord.sourceMeta) ? packageRecord.sourceMeta : null;
  const sourceName =
    stringValue(packageRecord.sourceName) ??
    stringValue(packageMeta?.source) ??
    stringValue(packageMeta?.documentCategory) ??
    stringValue(packageRecord.sourceDocumentId);
  return {
    package: {
      ...(record.package as BrokerCompPackageReviewPayload["package"]),
      sourceName,
      sourceMeta: packageMeta,
      updatedAt: stringValue(packageRecord.updatedAt) ?? stringValue(packageRecord.createdAt) ?? "",
      createdAt: stringValue(packageRecord.createdAt) ?? "",
    },
    pages: Array.isArray(record.pages) ? (record.pages as BrokerCompPackageReviewPayload["pages"]) : [],
    items: normalizeItems(record.items ?? record.extractedItems),
  };
}

function isReviewedStatus(status: unknown): boolean {
  return status === "accepted" || status === "edited" || status === "approved" || status === "promoted";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function latestDate(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (Number.isNaN(leftTime)) return right;
  if (Number.isNaN(rightTime)) return left;
  return rightTime > leftTime ? right : left;
}

function normalizeItems(value: unknown): BrokerCompExtractedItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    if (typeof entry.itemType === "string" && isRecord(entry.normalizedPayload)) {
      const item = entry as unknown as BrokerCompExtractedItem;
      return [{
        ...item,
        propertyId: stringValue(entry.propertyId) ?? stringValue(entry.property_id) ?? item.propertyId ?? "",
        packageId: stringValue(entry.packageId) ?? stringValue(entry.package_id) ?? item.packageId ?? "loose",
        pageRefs: Array.isArray(item.pageRefs) ? item.pageRefs : [],
        includeInDossier: Boolean(item.includeInDossier),
      }];
    }
    const item: BrokerCompExtractedItem = {
      id: stringValue(entry.id) ?? `loose-comp-${index}`,
      packageId: stringValue(entry.packageId) ?? "loose",
      propertyId: stringValue(entry.propertyId) ?? "",
      itemType: (stringValue(entry.itemType) ?? stringValue(entry.type) ?? "sale_comp") as BrokerCompExtractedItem["itemType"],
      rawPayload: entry,
      normalizedPayload: entry,
      pageRefs: [],
      confidence: numberValue(entry.confidence) ?? null,
      reviewStatus: (stringValue(entry.reviewStatus) ?? stringValue(entry.status) ?? "pending") as BrokerCompExtractedItem["reviewStatus"],
      selectionDecision: stringValue(entry.selectionDecision) as BrokerCompExtractedItem["selectionDecision"],
      includeInDossier: Boolean(entry.includeInDossier ?? entry.reviewed ?? false),
      analystNote: stringValue(entry.analystNote) ?? stringValue(entry.notes),
      createdAt: stringValue(entry.createdAt) ?? "",
      updatedAt: stringValue(entry.updatedAt) ?? "",
    };
    return [item];
  });
}

function normalizePricingOpinions(value: unknown): BrokerCompPricingOpinion[] {
  const entries = Array.isArray(value) ? value : value == null ? [] : [value];
  return entries.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const amount = numberValue(entry.amount ?? entry.value ?? entry.price ?? entry.whisperPrice);
    const low = numberValue(entry.low);
    const high = numberValue(entry.high);
    if (amount == null && low == null && high == null) return [];
    const rangeNote = low != null || high != null ? `Range: ${low ?? "-"} to ${high ?? "-"}` : null;
    return [{
      amount,
      source: stringValue(entry.source) ?? stringValue(entry.sourceName) ?? stringValue(entry.label) ?? `Opinion ${index + 1}`,
      sourceType: stringValue(entry.sourceType) ?? stringValue(entry.opinionType) ?? stringValue(entry.type) ?? "broker",
      confidence: numberValue(entry.confidence) ?? numberValue(entry.confidenceScore),
      note: stringValue(entry.note) ?? stringValue(entry.notes) ?? rangeNote,
      observedAt: stringValue(entry.observedAt) ?? stringValue(entry.updatedAt) ?? stringValue(entry.createdAt),
    }];
  });
}

function normalizeFlags(value: unknown): BrokerCompDataFlag[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (typeof entry === "string" && entry.trim()) {
      const flag: BrokerCompDataFlag = { field: entry.trim(), label: entry.trim(), severity: "warning", message: entry.trim() };
      return [flag];
    }
    if (!isRecord(entry)) return [];
    const field = stringValue(entry.field) ?? stringValue(entry.key) ?? stringValue(entry.label) ?? `flag_${index + 1}`;
    const flag: BrokerCompDataFlag = {
      field,
      label: stringValue(entry.label) ?? field,
      severity: stringValue(entry.severity) ?? "warning",
      message: stringValue(entry.message) ?? stringValue(entry.note) ?? stringValue(entry.reason),
      source: stringValue(entry.source),
      resolved: typeof entry.resolved === "boolean" ? entry.resolved : null,
    };
    return [flag];
  });
}

function packageRow(payload: BrokerCompPackageReviewPayload): BrokerCompPackageRow {
  const accepted = payload.items.filter((item) => isReviewedStatus(item.reviewStatus)).length;
  return {
    id: payload.package.id,
    label: payload.package.sourceName || payload.package.packageType || payload.package.id,
    status: payload.package.status ?? null,
    packageType: payload.package.packageType ?? null,
    sourceName: payload.package.sourceName ?? null,
    createdAt: payload.package.createdAt ?? null,
    updatedAt: payload.package.updatedAt ?? null,
    itemCount: payload.items.length,
    reviewedItemCount: accepted,
  };
}

function comparableRow(item: BrokerCompExtractedItem): BrokerCompComparableRow | null {
  if (!["sale_comp", "operating_snapshot", "pricing_comp", "subject_projected_pricing"].includes(item.itemType)) {
    return null;
  }
  const data = item.normalizedPayload ?? {};
  return {
    id: item.id,
    packageId: item.packageId ?? null,
    address: stringValue(data.address) ?? stringValue(data.propertyAddress) ?? stringValue(data.compAddress),
    itemType: item.itemType,
    price: numberValue(data.salePrice ?? data.price ?? data.askingPrice ?? data.value),
    pricePerUnit: numberValue(data.pricePerUnit ?? data.ppu),
    pricePerSqft: numberValue(data.pricePerSqft ?? data.pricePsf ?? data.ppsf),
    capRatePct: numberValue(data.capRatePct ?? data.capRate),
    units: numberValue(data.units ?? data.unitCount),
    buildingSqft: numberValue(data.buildingSqft ?? data.sqft ?? data.squareFeet),
    saleDate: stringValue(data.saleDate) ?? stringValue(data.closedAt) ?? stringValue(data.date),
    source: stringValue(data.source) ?? stringValue(data.sourceName),
    reviewStatus: item.reviewStatus ?? null,
    selectionDecision: item.selectionDecision ?? null,
    notes: item.analystNote ?? stringValue(data.notes) ?? stringValue(data.note),
  };
}

function pricingOpinionFromItem(item: BrokerCompExtractedItem): BrokerCompPricingOpinion[] {
  if (item.itemType !== "pricing_opinion" && item.itemType !== "subject_projected_pricing" && item.itemType !== "broker_note") {
    return [];
  }
  return normalizePricingOpinions(item.normalizedPayload);
}

function missingFlagsFromItem(item: BrokerCompExtractedItem): BrokerCompDataFlag[] {
  const data = item.normalizedPayload ?? {};
  return [
    ...normalizeFlags(data.missingDataFlags),
    ...normalizeFlags(data.missingFields),
  ];
}

function dedupeComparables(rows: BrokerCompComparableRow[]): BrokerCompComparableRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [row.address, row.price, row.saleDate, row.itemType].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupePricingOpinions(rows: BrokerCompPricingOpinion[]): BrokerCompPricingOpinion[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [row.amount, row.source, row.sourceType, row.note].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeFlags(rows: BrokerCompDataFlag[]): BrokerCompDataFlag[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [row.field, row.message, row.source].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
