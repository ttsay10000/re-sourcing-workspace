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
  const addressLine = normalizeAddressLineForDisplay(rawAddressLine);
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
