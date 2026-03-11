import type { ListingNormalized, PriceHistoryEntry } from "@re-sourcing/contracts";

/** Map one StreetEasy sale-details payload to ListingNormalized. */
export function normalizeStreetEasySaleDetails(raw: Record<string, unknown>, index: number): ListingNormalized {
  const id = raw.id != null ? String(raw.id) : raw.address != null ? String(raw.address) : `run-${index}`;
  const address = (raw.address != null ? String(raw.address) : "").trim() || "—";
  const borough = (raw.borough != null ? String(raw.borough) : "").trim() || "New York";
  const city = borough.charAt(0).toUpperCase() + borough.slice(1).toLowerCase().replace(/-/g, " ");
  const zip = (raw.zipcode != null ? String(raw.zipcode) : raw.zip != null ? String(raw.zip) : "").trim() || "";
  const price = Number(raw.price ?? raw.closedPrice ?? 0) || 0;
  const bedsNum = Number(raw.bedrooms ?? raw.beds ?? 0) || 0;
  const bathsNum = Number(raw.bathrooms ?? raw.baths ?? 0) || 0;
  const sqftRaw = raw.sqft != null ? Number(raw.sqft) : NaN;
  const url = (raw._fetchUrl != null ? String(raw._fetchUrl) : raw.url != null ? String(raw.url) : "").trim() || "#";
  const listedAt = raw.listedAt != null ? String(raw.listedAt) : null;
  const images = raw.images;
  const imageUrls = Array.isArray(images) ? (images as string[]).filter((u): u is string => typeof u === "string") : null;
  const latLon = parseLatLonFromRaw(raw);
  const agentNames = parseAgentNames(raw);
  const { _fetchUrl: _unusedFetchUrl, ...rest } = raw;
  const extra = rest as Record<string, unknown>;
  const { monthlyHoa, monthlyTax } = parseMonthlyHoaTaxFromRaw(raw);
  if (monthlyHoa != null) extra.monthlyHoa = monthlyHoa;
  if (monthlyTax != null) extra.monthlyTax = monthlyTax;
  const { priceHistory, rentalPriceHistory } = parsePriceHistoriesFromRaw(raw);
  const priceChangeSinceListed = computePriceChangeSinceListed(price, priceHistory ?? undefined);
  if (priceChangeSinceListed != null) extra.priceChangeSinceListed = priceChangeSinceListed;

  return {
    source: "streeteasy",
    externalId: id,
    address,
    city,
    state: "NY",
    zip,
    price,
    beds: bedsNum >= 0 ? bedsNum : 0,
    baths: bathsNum >= 0 ? bathsNum : 0,
    sqft: !Number.isNaN(sqftRaw) && sqftRaw >= 0 ? Math.round(sqftRaw) : null,
    url,
    title: address !== "—" ? address : null,
    description: raw.description != null ? String(raw.description) : null,
    lat: latLon?.lat ?? null,
    lon: latLon?.lon ?? null,
    imageUrls,
    listedAt,
    agentNames,
    priceHistory: priceHistory ?? undefined,
    rentalPriceHistory: rentalPriceHistory ?? undefined,
    extra: Object.keys(extra).length > 0 ? extra : null,
  };
}

function parseAgentNames(raw: Record<string, unknown>): string[] | null {
  const arr = raw.agents ?? raw.agent_names ?? raw.listing_agents;
  if (Array.isArray(arr) && arr.length > 0) {
    const names = arr
      .map((item) => {
        if (item == null) return "";
        if (typeof item === "string") return item.trim();
        if (typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const name = obj.name ?? obj.full_name ?? obj.agent_name ?? obj.displayName;
          return name != null ? String(name).trim() : "";
        }
        return String(item).trim();
      })
      .filter(Boolean);
    return names.length > 0 ? names : null;
  }
  const single =
    raw.broker_name ??
    raw.broker ??
    raw.listing_agent ??
    raw.agent_name ??
    raw.agent ??
    raw.listing_agent_name;
  return single != null && String(single).trim() ? [String(single).trim()] : null;
}

function parsePriceHistoryDate(dateStr: string): number {
  const s = String(dateStr).trim();
  if (!s) return 0;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

function computePriceChangeSinceListed(
  currentPrice: number,
  priceHistory: PriceHistoryEntry[] | undefined | null
): { listedPrice: number; currentPrice: number; changeAmount: number; changePercent: number } | null {
  if (!priceHistory?.length || !Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  const toNum = (price: string | number): number =>
    typeof price === "number"
      ? price
      : parseFloat(String(price).replace(/[$,]/g, ""));
  const withNums = priceHistory
    .map((entry) => ({ ...entry, priceNum: toNum(entry.price), dateTs: parsePriceHistoryDate(entry.date) }))
    .filter((entry) => Number.isFinite(entry.priceNum));
  if (withNums.length === 0) return null;
  const listedCandidates = withNums.filter((entry) => String(entry.event).toUpperCase() === "LISTED");
  const listedEntry = listedCandidates.length > 0
    ? listedCandidates.reduce((a, b) => (a.dateTs > b.dateTs ? a : b))
    : withNums.reduce((a, b) => (a.dateTs < b.dateTs ? a : b));
  if (!Number.isFinite(listedEntry.priceNum) || listedEntry.priceNum <= 0) return null;
  const changeAmount = currentPrice - listedEntry.priceNum;
  return {
    listedPrice: listedEntry.priceNum,
    currentPrice,
    changeAmount,
    changePercent: (changeAmount / listedEntry.priceNum) * 100,
  };
}

function parsePriceHistoriesFromRaw(raw: Record<string, unknown>): {
  priceHistory?: PriceHistoryEntry[] | null;
  rentalPriceHistory?: PriceHistoryEntry[] | null;
} {
  const from = (source: Record<string, unknown>): { sale: unknown; rental: unknown } => ({
    sale:
      source.priceHistory ??
      source.price_history ??
      source.history ??
      source.saleHistory ??
      source.sale_history ??
      source.property_history ??
      source.listing_history ??
      source.price_changes ??
      source.events,
    rental:
      source.rentalPriceHistory ??
      source.rental_price_history ??
      source.rentHistory ??
      source.rental_history,
  });

  const ensureArray = (value: unknown): unknown => {
    if (value == null || Array.isArray(value)) return value;
    if (typeof value !== "string") return value;
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : value;
    } catch {
      return value;
    }
  };

  const coerceEntries = (value: unknown): PriceHistoryEntry[] | null => {
    if (!Array.isArray(value)) return null;
    const out: PriceHistoryEntry[] = [];
    for (const row of value) {
      if (!row || typeof row !== "object") continue;
      const obj = row as Record<string, unknown>;
      const date = obj.date ?? obj.Date ?? obj.listedDate ?? obj.timestamp ?? obj.listed_date ?? obj.event_date ?? obj.eventDate;
      const price = obj.price ?? obj.Price ?? obj.amount ?? obj.list_price ?? obj.listPrice ?? obj.sale_price ?? obj.salePrice;
      const event = obj.event ?? obj.Event ?? obj.type ?? obj.reason ?? obj.description ?? obj.event_type ?? obj.eventType;
      if (date == null || price == null) continue;
      out.push({
        date: String(date),
        price: typeof price === "number" || typeof price === "string" ? price : String(price),
        event: event != null ? String(event) : "—",
      });
    }
    return out.length > 0 ? out : null;
  };

  const top = from(raw);
  let saleHistorySource = top.sale;
  let rentalHistorySource = top.rental;
  if (saleHistorySource == null || rentalHistorySource == null) {
    const nested = [
      raw.listing && typeof raw.listing === "object" ? (raw.listing as Record<string, unknown>) : null,
      raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : null,
    ];
    for (const source of nested) {
      if (!source) continue;
      const candidate = from(source);
      if (saleHistorySource == null) saleHistorySource = candidate.sale;
      if (rentalHistorySource == null) rentalHistorySource = candidate.rental;
    }
  }

  return {
    priceHistory: coerceEntries(ensureArray(saleHistorySource)) ?? undefined,
    rentalPriceHistory: coerceEntries(ensureArray(rentalHistorySource)) ?? undefined,
  };
}

function parseMonthlyHoaTaxFromRaw(raw: Record<string, unknown>): { monthlyHoa?: number; monthlyTax?: number } {
  const fees = raw.fees as Record<string, unknown> | undefined;
  const hoaRaw = raw.monthlyHoa ?? raw.monthly_hoa ?? raw.hoa ?? raw.hoa_fee ?? fees?.hoa ?? fees?.monthly_hoa;
  const taxRaw = raw.monthlyTax ?? raw.monthly_tax ?? raw.tax ?? raw.monthly_taxes ?? fees?.tax ?? fees?.monthly_tax;
  const toNumber = (value: unknown): number | undefined => {
    if (value == null) return undefined;
    const n = typeof value === "number" ? value : parseFloat(String(value).replace(/[$,]/g, ""));
    return !Number.isNaN(n) && n >= 0 ? n : undefined;
  };
  return { monthlyHoa: toNumber(hoaRaw), monthlyTax: toNumber(taxRaw) };
}

function parseLatLonFromRaw(raw: Record<string, unknown>): { lat: number; lon: number } | null {
  const coords = raw.coordinates as Record<string, unknown> | undefined;
  const loc = raw.location as Record<string, unknown> | undefined;
  const geo = raw.geo as Record<string, unknown> | undefined;
  const geom = raw.geometry as Record<string, unknown> | undefined;
  const geomCoords = Array.isArray(geom?.coordinates) ? (geom.coordinates as number[]) : null;
  const latRaw = raw.latitude ?? raw.lat ?? coords?.latitude ?? coords?.lat ?? loc?.lat ?? geo?.lat ?? (geomCoords?.[1]);
  const lonRaw = raw.longitude ?? raw.lon ?? coords?.longitude ?? coords?.lon ?? loc?.lon ?? geo?.lon ?? (geomCoords?.[0]);
  const lat = typeof latRaw === "number" ? latRaw : typeof latRaw === "string" ? parseFloat(latRaw) : NaN;
  const lon = typeof lonRaw === "number" ? lonRaw : typeof lonRaw === "string" ? parseFloat(lonRaw) : NaN;
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}
