import {
  deriveListingActivitySummary,
  formatListingEventLabel,
  type AgentEnrichmentEntry,
  type ListingNormalized,
  type ListingRow,
  type ListingSnapshot,
  type PriceHistoryEntry,
  type PropertySourcingUpdate,
  type PropertySourcingUpdateChange,
  type PropertySourcingUpdateChangeType,
  type SnapshotMetadata,
} from "@re-sourcing/contracts";
import { normalizeStreetEasySaleDetails } from "./normalizeStreetEasyListing.js";

interface ComparableHistory {
  signature: string | null;
  latestSummary: string | null;
}

interface ComparableListingState {
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  listedAt: string | null;
  descriptionText: string | null;
  descriptionPreview: string | null;
  listingStatus: string | null;
  agentNames: string[];
  agentEnrichmentKeys: string[];
  agentEnrichmentPreview: string | null;
  priceHistory: ComparableHistory;
  rentalPriceHistory: ComparableHistory;
  bbl: string | null;
  bin: string | null;
  monthlyHoa: number | null;
  monthlyTax: number | null;
}

export function buildListingChangeSummary(input: {
  runId: string;
  normalized: ListingNormalized;
  existing: ListingRow | null;
  previousSnapshot?: ListingSnapshot | null;
  evaluatedAt?: Date;
}): PropertySourcingUpdate {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  if (!input.existing) {
    return {
      status: "new",
      lastRunId: input.runId,
      lastEvaluatedAt: evaluatedAt.toISOString(),
      previousSnapshotId: null,
      changedFields: [],
      changes: [],
      summary: "New property added from the latest saved-search run.",
    };
  }

  const previousNormalized = getPreviousNormalizedListing(input.previousSnapshot ?? null, input.existing);
  if (!previousNormalized) {
    return {
      status: "unchanged",
      lastRunId: input.runId,
      lastEvaluatedAt: evaluatedAt.toISOString(),
      previousSnapshotId: input.previousSnapshot?.id ?? null,
      changedFields: [],
      changes: [],
      summary: "No prior saved-search snapshot was available for comparison.",
    };
  }

  const previous = toComparableListing(previousNormalized);
  const current = toComparableListing(input.normalized);
  const changes: PropertySourcingUpdateChange[] = [];

  pushScalarChange(changes, "price", "Asking price", previous.price, current.price, { formatter: formatCurrency });
  pushScalarChange(changes, "listingStatus", "Listing status", previous.listingStatus, current.listingStatus);
  pushScalarChange(changes, "priceHistory", "Listing activity", previous.priceHistory.latestSummary, current.priceHistory.latestSummary, {
    hasChanged: previous.priceHistory.signature !== current.priceHistory.signature,
  });
  pushScalarChange(
    changes,
    "rentalPriceHistory",
    "Rental activity",
    previous.rentalPriceHistory.latestSummary,
    current.rentalPriceHistory.latestSummary,
    { hasChanged: previous.rentalPriceHistory.signature !== current.rentalPriceHistory.signature }
  );
  pushDescriptionChange(changes, previous.descriptionText, previous.descriptionPreview, current.descriptionText, current.descriptionPreview);
  pushScalarChange(changes, "agentNames", "Listing agents", joinPreview(previous.agentNames), joinPreview(current.agentNames));
  pushScalarChange(
    changes,
    "agentEnrichment",
    "Broker contacts",
    previous.agentEnrichmentPreview,
    current.agentEnrichmentPreview,
    { hasChanged: joinSignature(previous.agentEnrichmentKeys) !== joinSignature(current.agentEnrichmentKeys) }
  );
  pushScalarChange(changes, "beds", "Bedrooms", previous.beds, current.beds);
  pushScalarChange(changes, "baths", "Bathrooms", previous.baths, current.baths);
  pushScalarChange(changes, "sqft", "Square footage", previous.sqft, current.sqft, { formatter: formatInteger });
  pushScalarChange(changes, "listedAt", "Listed date", previous.listedAt, current.listedAt, { formatter: formatDateOnlyValue });
  pushScalarChange(changes, "bbl", "BBL", previous.bbl, current.bbl);
  pushScalarChange(changes, "bin", "BIN", previous.bin, current.bin);
  pushScalarChange(changes, "monthlyHoa", "Monthly HOA", previous.monthlyHoa, current.monthlyHoa, { formatter: formatCurrency });
  pushScalarChange(changes, "monthlyTax", "Monthly tax", previous.monthlyTax, current.monthlyTax, { formatter: formatCurrency });

  const status = changes.length > 0 ? "updated" : "unchanged";
  return {
    status,
    lastRunId: input.runId,
    lastEvaluatedAt: evaluatedAt.toISOString(),
    previousSnapshotId: input.previousSnapshot?.id ?? null,
    changedFields: changes.map((change) => change.field),
    changes,
    summary:
      status === "updated"
        ? `Updated since last saved-search run: ${summarizeLabels(changes)}.`
        : "No material changes since the previous saved-search run.",
  };
}

function getPreviousNormalizedListing(
  previousSnapshot: ListingSnapshot | null,
  fallbackExisting: ListingRow | null
): ListingNormalized | null {
  const metadata = (previousSnapshot?.metadata ?? null) as SnapshotMetadata | null;
  const metadataNormalized = metadata?.normalizedListing;
  if (metadataNormalized && typeof metadataNormalized === "object" && !Array.isArray(metadataNormalized)) {
    return applySnapshotSupplements(metadataNormalized as unknown as ListingNormalized, metadata);
  }
  const rawPayload = metadata?.rawPayload;
  if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
    return applySnapshotSupplements(normalizeStreetEasySaleDetails(rawPayload, 0), metadata);
  }
  if (!fallbackExisting) return null;
  return {
    source: fallbackExisting.source,
    externalId: fallbackExisting.externalId,
    address: fallbackExisting.address,
    city: fallbackExisting.city,
    state: fallbackExisting.state,
    zip: fallbackExisting.zip,
    price: fallbackExisting.price,
    beds: fallbackExisting.beds,
    baths: fallbackExisting.baths,
    sqft: fallbackExisting.sqft ?? null,
    url: fallbackExisting.url,
    title: fallbackExisting.title ?? null,
    description: fallbackExisting.description ?? null,
    lat: fallbackExisting.lat ?? null,
    lon: fallbackExisting.lon ?? null,
    imageUrls: fallbackExisting.imageUrls ?? null,
    listedAt: fallbackExisting.listedAt ?? null,
    agentNames: fallbackExisting.agentNames ?? null,
    agentEnrichment: fallbackExisting.agentEnrichment ?? null,
    priceHistory: fallbackExisting.priceHistory ?? null,
    rentalPriceHistory: fallbackExisting.rentalPriceHistory ?? null,
    extra: fallbackExisting.extra ?? null,
  };
}

function applySnapshotSupplements(normalized: ListingNormalized, metadata: SnapshotMetadata | null): ListingNormalized {
  return {
    ...normalized,
    agentEnrichment: Array.isArray(metadata?.agentEnrichment) ? metadata.agentEnrichment : normalized.agentEnrichment ?? null,
    priceHistory: Array.isArray(metadata?.priceHistory) ? metadata.priceHistory : normalized.priceHistory ?? null,
    rentalPriceHistory: Array.isArray(metadata?.rentalPriceHistory) ? metadata.rentalPriceHistory : normalized.rentalPriceHistory ?? null,
  };
}

function toComparableListing(listing: ListingNormalized): ComparableListingState {
  const descriptionText = normalizeText(listing.description);
  const priceHistory = summarizeHistory(listing.priceHistory ?? null, listing.price);
  const rentalPriceHistory = summarizeHistory(listing.rentalPriceHistory ?? null, null);
  const extra = listing.extra ?? null;
  return {
    price: normalizeNumber(listing.price),
    beds: normalizeNumber(listing.beds),
    baths: normalizeNumber(listing.baths),
    sqft: normalizeNumber(listing.sqft ?? null),
    listedAt: normalizeDateOnly(listing.listedAt),
    descriptionText,
    descriptionPreview: descriptionText ? truncate(descriptionText, 72) : null,
    listingStatus: inferListingStatus(extra),
    agentNames: normalizeStringList(listing.agentNames),
    agentEnrichmentKeys: normalizeAgentEnrichmentKeys(listing.agentEnrichment),
    agentEnrichmentPreview: summarizeAgentEnrichment(listing.agentEnrichment),
    priceHistory,
    rentalPriceHistory,
    bbl: extractCanonicalString(extra, ["bbl", "BBL", "borough_block_lot"]),
    bin: extractCanonicalString(extra, ["bin", "BIN", "building_identification_number"]),
    monthlyHoa: extractCanonicalNumber(extra, ["monthlyHoa", "monthly_hoa", "hoa"]),
    monthlyTax: extractCanonicalNumber(extra, ["monthlyTax", "monthly_tax", "tax"]),
  };
}

function pushDescriptionChange(
  changes: PropertySourcingUpdateChange[],
  previousText: string | null,
  previousPreview: string | null,
  currentText: string | null,
  currentPreview: string | null
) {
  if (previousText === currentText) return;
  changes.push({
    field: "description",
    label: "Description",
    changeType: classifyChangeType(previousText, currentText),
    previousValue: previousPreview ?? (previousText ? "Present" : null),
    currentValue: currentPreview ?? (currentText ? "Present" : null),
  });
}

function pushScalarChange(
  changes: PropertySourcingUpdateChange[],
  field: string,
  label: string,
  previousValue: string | number | boolean | null,
  currentValue: string | number | boolean | null,
  options?: {
    formatter?: (value: string | number | boolean | null) => string | number | boolean | null;
    hasChanged?: boolean;
  }
) {
  const hasChanged = options?.hasChanged ?? previousValue !== currentValue;
  if (!hasChanged) return;
  const formattedPrevious = options?.formatter ? options.formatter(previousValue) : previousValue;
  const formattedCurrent = options?.formatter ? options.formatter(currentValue) : currentValue;
  changes.push({
    field,
    label,
    changeType: classifyChangeType(previousValue, currentValue),
    previousValue: formattedPrevious,
    currentValue: formattedCurrent,
  });
}

function classifyChangeType(
  previousValue: string | number | boolean | null,
  currentValue: string | number | boolean | null
): PropertySourcingUpdateChangeType {
  if (isMissingValue(previousValue) && !isMissingValue(currentValue)) return "added";
  if (!isMissingValue(previousValue) && isMissingValue(currentValue)) return "removed";
  return "updated";
}

function isMissingValue(value: string | number | boolean | null): boolean {
  return value == null || value === "";
}

function summarizeHistory(history: PriceHistoryEntry[] | null | undefined, currentPrice: number | null): ComparableHistory {
  const normalized = normalizeHistoryEntries(history);
  if (normalized.length === 0) return { signature: null, latestSummary: null };
  const summary = deriveListingActivitySummary({
    currentPrice,
    priceHistory: normalized,
  });
  const latestSummary =
    summary?.lastActivityDate != null
      ? `${summary.lastActivityDate} · ${formatListingEventLabel(summary.lastActivityEvent)}${summary.lastActivityPrice != null ? ` · ${formatCurrency(summary.lastActivityPrice)}` : ""}`
      : null;
  return {
    signature: JSON.stringify(normalized.map((entry) => [entry.date, normalizeText(entry.event) ?? "", normalizeNumberString(entry.price)])),
    latestSummary,
  };
}

function normalizeHistoryEntries(history: PriceHistoryEntry[] | null | undefined): PriceHistoryEntry[] {
  if (!Array.isArray(history)) return [];
  const entries: Array<PriceHistoryEntry | null> = history.map((entry): PriceHistoryEntry | null => {
      const date = normalizeDateOnly(entry.date);
      const price = normalizeNumberString(entry.price);
      const event = normalizeText(entry.event) ?? "Unknown";
      if (!date || !price) return null;
      return { date, price, event };
    });
  return entries
    .filter((entry): entry is PriceHistoryEntry => entry != null)
    .sort((a, b) => {
      const dateCompare = String(b.date).localeCompare(String(a.date));
      if (dateCompare !== 0) return dateCompare;
      const eventCompare = String(a.event).localeCompare(String(b.event));
      if (eventCompare !== 0) return eventCompare;
      return String(a.price).localeCompare(String(b.price));
    });
}

function normalizeNumberString(value: string | number): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.round(value * 100) / 100);
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? String(Math.round(parsed * 100) / 100) : String(value).trim();
}

function inferListingStatus(extra: Record<string, unknown> | null | undefined): string | null {
  if (!extra) return null;
  const contractFlag = extractBoolean(extra, ["inContract", "in_contract", "isInContract"]);
  if (contractFlag === true) return "In contract";
  const direct = extractCanonicalString(extra, [
    "listingStatus",
    "listing_status",
    "status",
    "saleStatus",
    "sale_status",
    "marketStatus",
    "market_status",
    "availability",
    "contractStatus",
    "contract_status",
  ]);
  return direct ? titleCase(direct) : null;
}

function extractBoolean(value: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "boolean") return candidate;
    if (typeof candidate === "string") {
      const normalized = candidate.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }
  return null;
}

function extractCanonicalString(value: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!value) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      const normalized = normalizeText(candidate);
      if (normalized) return normalized;
    } else if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }
  return null;
}

function extractCanonicalNumber(value: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!value) return null;
  for (const key of keys) {
    const candidate = value[key];
    const normalized = normalizeNumber(candidate);
    if (normalized != null) return normalized;
  }
  return null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const direct = value.trim().split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringList(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter((value): value is string => Boolean(value)))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function normalizeAgentEnrichmentKeys(entries: AgentEnrichmentEntry[] | null | undefined): string[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => [
      normalizeText(entry.name)?.toLowerCase() ?? "",
      normalizeText(entry.firm)?.toLowerCase() ?? "",
      normalizeText(entry.email)?.toLowerCase() ?? "",
      normalizeText(entry.phone)?.toLowerCase() ?? "",
    ].join("|"))
    .filter((value) => value.replace(/\|/g, "").length > 0)
    .sort((a, b) => a.localeCompare(b));
}

function summarizeAgentEnrichment(entries: AgentEnrichmentEntry[] | null | undefined): string | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const labels = entries
    .map((entry) => {
      const pieces = [normalizeText(entry.name), normalizeText(entry.email), normalizeText(entry.firm)].filter(
        (value): value is string => Boolean(value)
      );
      return pieces.join(" · ");
    })
    .filter((value) => value.length > 0);
  if (labels.length === 0) return `${entries.length} contact${entries.length === 1 ? "" : "s"}`;
  const preview = labels.slice(0, 2).join("; ");
  return labels.length > 2 ? `${preview} (+${labels.length - 2} more)` : preview;
}

function joinPreview(values: string[]): string | null {
  if (values.length === 0) return null;
  const preview = values.slice(0, 3).join(", ");
  return values.length > 3 ? `${preview} (+${values.length - 3} more)` : preview;
}

function joinSignature(values: string[]): string {
  return values.join("||");
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function summarizeLabels(changes: PropertySourcingUpdateChange[]): string {
  const labels = changes.map((change) => change.label.toLowerCase());
  const visible = labels.slice(0, 3).join(", ");
  return labels.length > 3 ? `${visible}, +${labels.length - 3} more` : visible;
}

function formatCurrency(value: string | number | boolean | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return value == null ? null : String(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatInteger(value: string | number | boolean | null): string | number | boolean | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return Math.round(value);
}

function formatDateOnlyValue(value: string | number | boolean | null): string | number | boolean | null {
  if (typeof value !== "string") return value;
  const normalized = normalizeDateOnly(value);
  return normalized ?? value;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
