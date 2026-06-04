import type { AgentEnrichmentEntry, ListingNormalized, PriceHistoryEntry } from "@re-sourcing/contracts";

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
  const sqftRaw = firstPositiveNumber(
    raw.sqft,
    raw.square_feet,
    raw.sqft_feet,
    raw.squareFeet,
    raw.gross_square_feet,
    raw.grossSqft,
    raw.building_sqft,
    raw.buildingSqft,
    raw.building_size,
    raw.buildingSize,
    raw.floorArea,
    raw.floor_area,
    firstPositiveNumberFromPaths(raw, [
      ["building", "sqft"],
      ["building", "squareFeet"],
      ["building", "square_feet"],
      ["building", "grossSqft"],
      ["building", "gross_square_feet"],
      ["building", "size"],
      ["property", "sqft"],
      ["property", "squareFeet"],
      ["property", "square_feet"],
      ["listing", "sqft"],
      ["listing", "squareFeet"],
    ])
  );
  const units =
    firstPositiveNumber(
      raw.units,
      raw.unitCount,
      raw.unit_count,
      raw.totalUnits,
      raw.total_units,
      raw.numberOfUnits,
      raw.number_of_units,
      raw.num_units,
      raw.building_units
    ) ?? inferUnitCountFromText(raw.description, raw.title, raw.propertyType, raw.address);
  const neighborhood = firstString(
    raw.neighborhood,
    raw.neighborhoodName,
    raw.neighborhood_name,
    raw.area,
    raw.area_name,
    isRecord(raw.location) ? raw.location.neighborhood : null,
    isRecord(raw.address_components) ? raw.address_components.neighborhood : null
  );
  const url = (raw._fetchUrl != null ? String(raw._fetchUrl) : raw.url != null ? String(raw.url) : "").trim() || "#";
  const listedAt = raw.listedAt != null ? String(raw.listedAt) : null;
  const images = raw.images;
  const imageUrls = Array.isArray(images) ? (images as string[]).filter((u): u is string => typeof u === "string") : null;
  const latLon = parseLatLonFromRaw(raw);
  const agentFacts = parseAgentFacts(raw);
  const agentNames = agentFacts.names;
  const { _fetchUrl: _unusedFetchUrl, ...rest } = raw;
  const extra = rest as Record<string, unknown>;
  const { monthlyHoa, monthlyTax } = parseMonthlyHoaTaxFromRaw(raw);
  const sourcePricePerSqft = firstPositiveNumber(
    raw.ppsqft,
    raw.pricePerSqft,
    raw.price_per_sqft,
    raw.price_per_square_foot,
    raw.psf,
    raw.price_psf,
    firstPositiveNumberFromPaths(raw, [
      ["listing", "ppsqft"],
      ["listing", "pricePerSqft"],
      ["listing", "price_per_sqft"],
      ["property", "ppsqft"],
    ])
  );
  const computedPricePerSqft = sourcePricePerSqft ?? (price > 0 && sqftRaw != null ? Math.round(price / sqftRaw) : null);
  if (monthlyHoa != null) extra.monthlyHoa = monthlyHoa;
  if (monthlyTax != null) extra.monthlyTax = monthlyTax;
  if (sqftRaw != null) {
    extra.sqft = Math.round(sqftRaw);
    extra.squareFeet = Math.round(sqftRaw);
  }
  if (computedPricePerSqft != null) {
    extra.ppsqft = computedPricePerSqft;
    extra.pricePerSqft = computedPricePerSqft;
  }
  if (units != null) {
    extra.units = units;
    extra.unitCount = units;
  }
  if (neighborhood) {
    extra.neighborhood = neighborhood;
    extra.neighborhoodName = neighborhood;
  }
  if (borough) extra.borough = borough;
  if (agentFacts.brokerageName) extra.brokerageName = agentFacts.brokerageName;
  if (agentFacts.names?.length) extra.listingBrokerNames = agentFacts.names;
  if (agentFacts.entries?.length) extra.sourceAgentFacts = agentFacts.entries;
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
    sqft: sqftRaw != null ? Math.round(sqftRaw) : null,
    url,
    title: address !== "—" ? address : null,
    description: raw.description != null ? String(raw.description) : null,
    lat: latLon?.lat ?? null,
    lon: latLon?.lon ?? null,
    imageUrls,
    listedAt,
    agentNames,
    agentEnrichment: agentFacts.entries ?? undefined,
    priceHistory: priceHistory ?? undefined,
    rentalPriceHistory: rentalPriceHistory ?? undefined,
    extra: Object.keys(extra).length > 0 ? extra : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/[$,%\s,]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function firstPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = firstNumber(value);
    if (parsed != null && parsed > 0) return parsed;
  }
  return null;
}

function readPath(root: unknown, path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return current;
}

function firstPositiveNumberFromPaths(root: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const value = firstNumber(readPath(root, path));
    if (value != null && value > 0) return value;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function inferUnitCountFromText(...values: unknown[]): number | null {
  const text = values.filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
  if (!text.trim()) return null;
  const wordToNumber: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  const numberToken = "\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
  const familyMatch = new RegExp(`\\b(?:set\\s+up\\s+as\\s+|configured\\s+as\\s+|legal\\s+)?(${numberToken})[-\\s]+family\\b`).exec(text);
  const unitMatch = new RegExp(`\\b(${numberToken})\\s+(?:residential\\s+|rental\\s+|dwelling\\s+|apartment\\s+|floor\\s+|full[-\\s]+floor\\s+)?(?:units?|apartments?|residences?|dwellings?)\\b`).exec(text);
  const raw = familyMatch?.[1] ?? unitMatch?.[1] ?? null;
  if (!raw) return null;
  const parsed = /^\d+$/.test(raw) ? Number(raw) : wordToNumber[raw];
  return parsed != null && parsed > 0 ? parsed : null;
}

function parseAgentFacts(raw: Record<string, unknown>): {
  names: string[] | null;
  brokerageName: string | null;
  entries: AgentEnrichmentEntry[] | null;
} {
  const brokerageName = firstString(
    raw.brokerageName,
    raw.brokerage_name,
    raw.agencyName,
    raw.agency_name,
    raw.agency,
    raw.firm,
    raw.company,
    raw.officeName,
    raw.office_name,
    raw.listing_office,
    raw.listingOffice,
    isRecord(raw.brokerage) ? raw.brokerage.name : null,
    isRecord(raw.agency) ? raw.agency.name : null,
    isRecord(raw.office) ? raw.office.name : null
  );
  const arrayCandidates = [
    raw.agents,
    raw.agent_names,
    raw.listing_agents,
    raw.listingAgents,
    raw.brokers,
    raw.listing_brokers,
    raw.listingBrokers,
    raw.sales_agents,
    raw.salesAgents,
  ];
  const entries: AgentEnrichmentEntry[] = [];
  const names: string[] = [];
  const pushEntry = (entry: AgentEnrichmentEntry | null) => {
    if (!entry?.name) return;
    if (!names.some((name) => name.toLowerCase() === entry.name.toLowerCase())) names.push(entry.name);
    const hasFacts = Boolean(entry.firm || entry.email || entry.phone);
    if (!hasFacts) return;
    const existingIndex = entries.findIndex((existing) => existing.name.toLowerCase() === entry.name.toLowerCase());
    if (existingIndex >= 0) {
      entries[existingIndex] = {
        name: entries[existingIndex]!.name,
        firm: entries[existingIndex]!.firm ?? entry.firm ?? null,
        email: entries[existingIndex]!.email ?? entry.email ?? null,
        phone: entries[existingIndex]!.phone ?? entry.phone ?? null,
      };
    } else {
      entries.push(entry);
    }
  };

  for (const candidate of arrayCandidates) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) pushEntry(agentEntryFromRaw(item, brokerageName));
  }

  const singleName = firstString(
    raw.broker_name,
    raw.brokerName,
    raw.listing_agent,
    raw.listingAgent,
    raw.agent_name,
    raw.agentName,
    raw.agent,
    raw.broker,
    raw.listing_agent_name,
    raw.listingAgentName
  );
  if (singleName) {
    pushEntry({
      name: singleName,
      firm: brokerageName,
      email: cleanEmail(raw.broker_email ?? raw.agent_email ?? raw.email),
      phone: firstString(raw.broker_phone, raw.agent_phone, raw.phone),
    });
  }

  return {
    names: names.length > 0 ? names : null,
    brokerageName,
    entries: entries.length > 0 ? entries : brokerageName && names.length > 0
      ? names.map((name) => ({ name, firm: brokerageName, email: null, phone: null }))
      : null,
  };
}

function agentEntryFromRaw(item: unknown, fallbackFirm: string | null): AgentEnrichmentEntry | null {
  if (item == null) return null;
  if (typeof item === "string") {
    const name = item.trim();
    return name ? { name, firm: fallbackFirm, email: null, phone: null } : null;
  }
  if (typeof item !== "object" || Array.isArray(item)) {
    const name = String(item).trim();
    return name ? { name, firm: fallbackFirm, email: null, phone: null } : null;
  }
  const obj = item as Record<string, unknown>;
  const name = firstString(
    obj.name,
    obj.full_name,
    obj.fullName,
    obj.agent_name,
    obj.agentName,
    obj.displayName,
    obj.display_name,
    obj.broker_name,
    obj.brokerName
  );
  if (!name) return null;
  const firm = firstString(
    obj.firm,
    obj.company,
    obj.companyName,
    obj.company_name,
    obj.agency,
    obj.agencyName,
    obj.agency_name,
    obj.brokerage,
    obj.brokerageName,
    obj.brokerage_name,
    obj.office,
    obj.officeName,
    obj.office_name,
    fallbackFirm
  );
  return {
    name,
    firm,
    email: cleanEmail(obj.email ?? obj.emailAddress ?? obj.email_address),
    phone: firstString(obj.phone, obj.phoneNumber, obj.phone_number, obj.mobile, obj.cell),
  };
}

function cleanEmail(value: unknown): string | null {
  const email = firstString(value)?.toLowerCase() ?? null;
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
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
