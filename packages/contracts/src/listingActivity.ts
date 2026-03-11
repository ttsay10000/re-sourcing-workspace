import type { ListingActivitySummary, PriceHistoryEntry } from "./listing.js";

interface ParsedHistoryEntry {
  dateRaw: string;
  dateIso: string | null;
  dateTs: number;
  price: number | null;
  event: string | null;
}

function toIsoDate(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = trimmed.split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function parsePriceNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatListingEventLabel(event: string | null | undefined): string {
  if (!event || typeof event !== "string") return "—";
  const lower = event.trim().toLowerCase().replace(/_/g, " ");
  if (!lower) return "—";
  return lower.replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseHistoryEntries(priceHistory: PriceHistoryEntry[] | null | undefined): ParsedHistoryEntry[] {
  if (!Array.isArray(priceHistory) || priceHistory.length === 0) return [];
  return priceHistory
    .map((entry) => {
      const dateRaw = typeof entry.date === "string" ? entry.date.trim() : String(entry.date ?? "");
      const dateIso = toIsoDate(dateRaw);
      const dateTs = dateIso ? new Date(`${dateIso}T12:00:00Z`).getTime() : 0;
      return {
        dateRaw,
        dateIso,
        dateTs,
        price: parsePriceNumber(entry.price),
        event: typeof entry.event === "string" && entry.event.trim() ? entry.event.trim() : null,
      };
    })
    .filter((entry) => entry.dateIso != null)
    .sort((a, b) => b.dateTs - a.dateTs);
}

export function deriveListingActivitySummary(input: {
  listedAt?: string | null;
  currentPrice?: number | null;
  priceHistory?: PriceHistoryEntry[] | null;
}): ListingActivitySummary | null {
  const listedAtIso = toIsoDate(input.listedAt);
  const currentPrice = parsePriceNumber(input.currentPrice ?? null);
  const entries = parseHistoryEntries(input.priceHistory);
  if (entries.length === 0 && listedAtIso == null) return null;

  const latest = entries[0] ?? null;
  let latestPriceChangeDate: string | null = null;
  let latestPriceChangeEvent: string | null = null;
  let latestPriceChangePrice: number | null = null;
  let latestPriceChangeAmount: number | null = null;
  let latestPriceChangePercent: number | null = null;
  let latestPriceDecreaseDate: string | null = null;
  let latestPriceDecreasePrice: number | null = null;
  let latestPriceDecreaseAmount: number | null = null;
  let latestPriceDecreasePercent: number | null = null;
  let totalPriceDrops = 0;

  for (let index = 0; index < entries.length - 1; index += 1) {
    const newer = entries[index];
    const older = entries[index + 1];
    if (newer.price == null || older.price == null || older.price === 0) continue;
    const changeAmount = newer.price - older.price;
    if (Math.abs(changeAmount) < 0.005) continue;
    const changePercent = (changeAmount / older.price) * 100;
    if (latestPriceChangeDate == null) {
      latestPriceChangeDate = newer.dateIso;
      latestPriceChangeEvent = newer.event;
      latestPriceChangePrice = newer.price;
      latestPriceChangeAmount = changeAmount;
      latestPriceChangePercent = changePercent;
    }
    if (changeAmount < 0) {
      totalPriceDrops += 1;
      if (latestPriceDecreaseDate == null) {
        latestPriceDecreaseDate = newer.dateIso;
        latestPriceDecreasePrice = newer.price;
        latestPriceDecreaseAmount = Math.abs(changeAmount);
        latestPriceDecreasePercent = Math.abs(changePercent);
      }
    }
  }

  const listedCandidates = entries.filter((entry) => (entry.event ?? "").toUpperCase() === "LISTED");
  const originalListEntry =
    listedCandidates.length > 0 ? listedCandidates[listedCandidates.length - 1] : entries[entries.length - 1] ?? null;
  const baselinePrice = originalListEntry?.price ?? null;
  const effectiveCurrentPrice = currentPrice ?? latest?.price ?? null;
  const currentDiscountFromOriginalAskAmount =
    baselinePrice != null && effectiveCurrentPrice != null ? baselinePrice - effectiveCurrentPrice : null;
  const currentDiscountFromOriginalAskPct =
    currentDiscountFromOriginalAskAmount != null && baselinePrice != null && baselinePrice > 0
      ? (currentDiscountFromOriginalAskAmount / baselinePrice) * 100
      : null;

  const lastActivityDate = latest?.dateIso ?? listedAtIso ?? null;
  const lastActivityEvent = latest?.event ?? (listedAtIso ? "LISTED" : null);
  const lastActivityPrice = latest?.price ?? effectiveCurrentPrice ?? null;
  const hasMeaningfulActivity =
    entries.length > 1 ||
    (lastActivityDate != null && listedAtIso != null && lastActivityDate !== listedAtIso) ||
    latestPriceChangeDate != null;

  return {
    sortDate: lastActivityDate ?? listedAtIso ?? null,
    lastActivityDate,
    lastActivityEvent,
    lastActivityPrice,
    hasMeaningfulActivity,
    latestPriceChangeDate,
    latestPriceChangeEvent,
    latestPriceChangePrice,
    latestPriceChangeAmount,
    latestPriceChangePercent,
    latestPriceDecreaseDate,
    latestPriceDecreasePrice,
    latestPriceDecreaseAmount,
    latestPriceDecreasePercent,
    totalPriceDrops,
    currentDiscountFromOriginalAskAmount,
    currentDiscountFromOriginalAskPct,
  };
}

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function describeListingActivity(activity: ListingActivitySummary | null | undefined): string | null {
  if (!activity?.lastActivityDate) return null;
  const eventLabel = formatListingEventLabel(activity.lastActivityEvent);
  if (
    activity.latestPriceDecreaseDate &&
    activity.latestPriceDecreaseDate === activity.lastActivityDate &&
    activity.latestPriceDecreasePercent != null
  ) {
    const priorCut = `${activity.latestPriceDecreasePercent.toFixed(1)}%`;
    const belowOriginal =
      activity.currentDiscountFromOriginalAskPct != null
        ? `, ${activity.currentDiscountFromOriginalAskPct.toFixed(1)}% below original ask`
        : "";
    return `${activity.lastActivityDate}: ${eventLabel} to ${formatMoney(activity.lastActivityPrice)} (${priorCut} below prior ask${belowOriginal})`;
  }
  return `${activity.lastActivityDate}: ${eventLabel}${activity.lastActivityPrice != null ? ` at ${formatMoney(activity.lastActivityPrice)}` : ""}`;
}
