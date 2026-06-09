import { normalizeAddressLineForDisplay } from "../enrichment/resolvePropertyBBL.js";
import { normalizeBorough } from "../enrichment/permits/normalizers.js";

export interface ResolvedOmPropertyAddress {
  rawAddress: string;
  addressLine: string;
  locality: string | null;
  zip: string | null;
  canonicalAddress: string;
  addressSource: "packageAddress" | "addressLine" | "address";
  canAttemptBblResolution: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? collapseSpaces(value) : null;
}

function titleCaseWords(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

const DIRECTIONAL_TOKENS: Record<string, string> = {
  e: "East",
  east: "East",
  w: "West",
  west: "West",
  n: "North",
  north: "North",
  s: "South",
  south: "South",
};

const STREET_SUFFIX_TOKENS: Record<string, string> = {
  aly: "Alley",
  alley: "Alley",
  ave: "Avenue",
  av: "Avenue",
  avenue: "Avenue",
  blvd: "Boulevard",
  boulevard: "Boulevard",
  cir: "Circle",
  circle: "Circle",
  ct: "Court",
  court: "Court",
  dr: "Drive",
  drive: "Drive",
  expy: "Expressway",
  expressway: "Expressway",
  ln: "Lane",
  lane: "Lane",
  pl: "Place",
  place: "Place",
  pkwy: "Parkway",
  parkway: "Parkway",
  rd: "Road",
  road: "Road",
  sq: "Square",
  square: "Square",
  st: "Street",
  street: "Street",
  ter: "Terrace",
  terrace: "Terrace",
  way: "Way",
};

function ordinalizeStreetNumber(value: string): string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return value;
  const mod100 = parsed % 100;
  const suffix = mod100 >= 11 && mod100 <= 13
    ? "th"
    : parsed % 10 === 1
      ? "st"
      : parsed % 10 === 2
        ? "nd"
        : parsed % 10 === 3
          ? "rd"
          : "th";
  return `${parsed}${suffix}`;
}

function titleCaseAddressToken(value: string): string {
  const ordinal = value.match(/^(\d+)(st|nd|rd|th)$/i);
  if (ordinal) return `${ordinal[1]}${ordinal[2].toLowerCase()}`;
  return value
    .split("-")
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1).toLowerCase() : part))
    .join("-");
}

function looksLikeHouseNumber(value: string): boolean {
  return /^\d+[a-z]?(?:-\d+[a-z]?)?$/i.test(value);
}

function stripTrailingLocationFromAddressLine(value: string): string {
  let current = collapseSpaces(value);
  while (current) {
    const next = collapseSpaces(
      current.replace(
        /(?:[,\s]+)(?:new york|nyc|ny|manhattan|brooklyn|queens|bronx|staten island)$/i,
        " "
      )
    );
    if (next === current) return current;
    current = next;
  }
  return current;
}

function normalizeOmAddressLineForDisplay(value: string): string {
  const base = stripTrailingLocationFromAddressLine(
    normalizeAddressLineForDisplay(value).replace(/\b\d{5}(?:-\d{4})?\b/g, " ")
  );
  const tokens = collapseSpaces(base.replace(/[.,#]/g, " "))
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-z0-9-]+|[^A-Za-z0-9-]+$/g, ""))
    .filter(Boolean);
  if (tokens.length === 0) return "";

  const firstStreetTokenIndex = tokens.length > 1 && looksLikeHouseNumber(tokens[0]!) ? 1 : 0;
  const normalized = tokens.map((token, index) => {
    const lower = token.toLowerCase().replace(/\.$/, "");
    if (index === firstStreetTokenIndex && DIRECTIONAL_TOKENS[lower]) {
      return DIRECTIONAL_TOKENS[lower];
    }
    if (index === tokens.length - 1 && STREET_SUFFIX_TOKENS[lower]) {
      return STREET_SUFFIX_TOKENS[lower];
    }
    const nextLower = tokens[index + 1]?.toLowerCase().replace(/\.$/, "");
    if (index > firstStreetTokenIndex && /^\d+$/.test(token) && nextLower && STREET_SUFFIX_TOKENS[nextLower]) {
      return ordinalizeStreetNumber(token);
    }
    return titleCaseAddressToken(token);
  });

  return collapseSpaces(normalized.join(" "));
}

function normalizeLocality(value: string | null): string | null {
  if (!value) return null;
  const borough = normalizeBorough(value);
  if (borough) return titleCaseWords(borough);
  const cleaned = collapseSpaces(
    value
      .replace(/\bNY(?:C|S)?\b/gi, " ")
      .replace(/\b\d{5}(?:-\d{4})?\b/g, " ")
      .replace(/^[,\s]+|[,\s]+$/g, " ")
  );
  if (!cleaned) return null;
  return cleaned;
}

function extractZip(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match?.[1] ?? null;
}

function resolveRawAddressSource(
  propertyInfo: Record<string, unknown>
): { source: ResolvedOmPropertyAddress["addressSource"]; rawAddress: string } | null {
  const packageAddress = readText(propertyInfo.packageAddress);
  if (packageAddress) return { source: "packageAddress", rawAddress: packageAddress };
  const addressLine = readText(propertyInfo.addressLine);
  if (addressLine) return { source: "addressLine", rawAddress: addressLine };
  const address = readText(propertyInfo.address);
  if (address) return { source: "address", rawAddress: address };
  return null;
}

export function resolveOmPropertyAddress(
  propertyInfo: Record<string, unknown> | null | undefined
): ResolvedOmPropertyAddress | null {
  const info = asRecord(propertyInfo);
  if (!info) return null;

  const resolvedRaw = resolveRawAddressSource(info);
  if (!resolvedRaw) return null;

  const parts = resolvedRaw.rawAddress
    .split(",")
    .map((part) => collapseSpaces(part))
    .filter((part) => part.length > 0);
  const rawAddressLine = parts[0] ?? resolvedRaw.rawAddress;
  const addressLine = normalizeOmAddressLineForDisplay(rawAddressLine);
  if (!addressLine || addressLine === "—") return null;

  const locality =
    normalizeLocality(readText(info.borough)) ??
    parts.slice(1).map((part) => normalizeLocality(part)).find((part): part is string => !!part) ??
    null;
  const zip =
    extractZip(readText(info.zip)) ??
    parts.map((part) => extractZip(part)).find((part): part is string => !!part) ??
    extractZip(resolvedRaw.rawAddress);
  const canonicalLocality = locality ?? (zip ? "NYC" : null);
  const canonicalAddressParts = [addressLine];
  if (canonicalLocality) canonicalAddressParts.push(canonicalLocality);
  if (zip) canonicalAddressParts.push(`NY ${zip}`);
  else if (canonicalLocality) canonicalAddressParts.push("NY");
  const canonicalAddress = canonicalAddressParts.join(", ");

  return {
    rawAddress: resolvedRaw.rawAddress,
    addressLine,
    locality,
    zip,
    canonicalAddress,
    addressSource: resolvedRaw.source,
    canAttemptBblResolution: Boolean(locality || zip),
  };
}
