import type { ListingNormalized, ListingRow, ListingSnapshot, PriceHistoryEntry, SnapshotMetadata } from "@re-sourcing/contracts";
import { parsePriceNumber } from "@re-sourcing/contracts";

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const direct = value.trim().split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizeHistory(history: PriceHistoryEntry[] | null | undefined): PriceHistoryEntry[] {
  if (!Array.isArray(history)) return [];
  const seen = new Set<string>();
  const rows: PriceHistoryEntry[] = [];
  for (const entry of history) {
    const date = dateOnly(entry.date);
    const price = parsePriceNumber(entry.price);
    const event = typeof entry.event === "string" && entry.event.trim() ? entry.event.trim() : "Unknown";
    if (!date || price == null) continue;
    const key = `${date}|${price}|${event.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ date, price, event });
  }
  return rows.sort((a, b) => {
    const dateCompare = String(b.date).localeCompare(String(a.date));
    if (dateCompare !== 0) return dateCompare;
    return String(a.event).localeCompare(String(b.event));
  });
}

function latestHistoryPrice(history: PriceHistoryEntry[]): number | null {
  return history.length > 0 ? parsePriceNumber(history[0]?.price) : null;
}

function historyHasPrice(history: PriceHistoryEntry[], price: number, date?: string | null): boolean {
  return history.some((entry) => {
    const entryPrice = parsePriceNumber(entry.price);
    if (entryPrice == null || Math.abs(entryPrice - price) >= 1) return false;
    return date ? dateOnly(entry.date) === date : true;
  });
}

function previousSnapshotPrice(snapshot: ListingSnapshot | null | undefined): number | null {
  const metadata = (snapshot?.metadata ?? null) as SnapshotMetadata | null;
  const normalized = metadata?.normalizedListing;
  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    return parsePriceNumber((normalized as unknown as ListingNormalized).price);
  }
  return null;
}

function previousSnapshotHistory(snapshot: ListingSnapshot | null | undefined): PriceHistoryEntry[] {
  const metadata = (snapshot?.metadata ?? null) as SnapshotMetadata | null;
  if (Array.isArray(metadata?.priceHistory)) return normalizeHistory(metadata.priceHistory);
  const normalized = metadata?.normalizedListing;
  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    return normalizeHistory((normalized as unknown as ListingNormalized).priceHistory);
  }
  return [];
}

function refreshEvent(previousPrice: number, currentPrice: number): string {
  if (currentPrice < previousPrice) return "PRICE DECREASE";
  if (currentPrice > previousPrice) return "PRICE INCREASE";
  return "PRICE CHANGE";
}

export function withRefreshPriceHistory(input: {
  normalized: ListingNormalized;
  existing?: ListingRow | null;
  previousSnapshot?: ListingSnapshot | null;
  capturedAt?: Date;
}): ListingNormalized {
  const { normalized, existing, previousSnapshot } = input;
  if (!existing) return normalized;
  if (Array.isArray(normalized.priceHistory) && normalized.priceHistory.length > 0) return normalized;

  const capturedDate = (input.capturedAt ?? new Date()).toISOString().slice(0, 10);
  const currentPrice = parsePriceNumber(normalized.price);
  if (currentPrice == null || currentPrice <= 0) return normalized;

  const carriedHistory = normalizeHistory(existing.priceHistory).length > 0
    ? normalizeHistory(existing.priceHistory)
    : previousSnapshotHistory(previousSnapshot);
  const previousPrice = latestHistoryPrice(carriedHistory) ?? previousSnapshotPrice(previousSnapshot) ?? parsePriceNumber(existing.price);

  if (previousPrice == null || previousPrice <= 0) {
    return {
      ...normalized,
      priceHistory: carriedHistory.length > 0 ? carriedHistory : normalized.priceHistory ?? null,
    };
  }

  const history = carriedHistory.length > 0
    ? [...carriedHistory]
    : [
        {
          date: dateOnly(existing.listedAt) ?? dateOnly(existing.firstSeenAt) ?? capturedDate,
          price: previousPrice,
          event: "LISTED",
        },
      ];

  if (Math.abs(currentPrice - previousPrice) >= 1 && !historyHasPrice(history, currentPrice, capturedDate)) {
    history.unshift({
      date: capturedDate,
      price: currentPrice,
      event: refreshEvent(previousPrice, currentPrice),
    });
  }

  return {
    ...normalized,
    priceHistory: history.length > 0 ? normalizeHistory(history) : normalized.priceHistory ?? null,
  };
}
