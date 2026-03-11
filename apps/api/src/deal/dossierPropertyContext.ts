import type { PropertyDetails } from "@re-sourcing/contracts";
import { resolvePreferredOmPropertyInfo } from "../om/authoritativeOm.js";
import type { DossierPropertyOverview } from "./underwritingContext.js";

export interface DossierPackageContext {
  dossierAddress: string;
  isPackage: boolean;
  packageNote: string | null;
}

function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function comparableAddressLine(value: string): string {
  return collapseSpaces(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstAddressLine(value: string): string {
  return collapseSpaces(value.split(",")[0] ?? "");
}

function addressSuffix(value: string): string[] {
  return value
    .split(",")
    .slice(1)
    .map((part) => collapseSpaces(part))
    .filter((part) => part.length > 0);
}

function omPropertyInfo(details: PropertyDetails | null): Record<string, unknown> | null {
  return resolvePreferredOmPropertyInfo(details);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? collapseSpaces(value) : null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function omAddressLine(details: PropertyDetails | null): string | null {
  const propertyInfo = omPropertyInfo(details);
  if (!propertyInfo) return null;
  return (
    stringValue(propertyInfo.packageAddress) ??
    stringValue(propertyInfo.addressLine) ??
    stringValue(propertyInfo.address) ??
    null
  );
}

function parseLotNumbers(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => numericValue(entry))
      .filter((entry): entry is number => entry != null)
      .map((entry) => Math.round(entry));
  }
  if (typeof value === "string") {
    return Array.from(value.matchAll(/\d+/g))
      .map((match) => Number(match[0]))
      .filter((entry) => Number.isFinite(entry));
  }
  return [];
}

function lotSummary(details: PropertyDetails | null): string | null {
  const propertyInfo = omPropertyInfo(details);
  if (!propertyInfo) return null;
  const block = numericValue(propertyInfo.block);
  const lots = parseLotNumbers(propertyInfo.lotNumbers);
  if (lots.length === 0) return block != null ? `Block ${block}` : null;
  const lotLabel =
    lots.length === 1
      ? `Lot ${lots[0]}`
      : `Lots ${lots.slice(0, -1).join(", ")} and ${lots[lots.length - 1]}`;
  return block != null ? `Block ${block}, ${lotLabel}` : lotLabel;
}

function hasAddressRange(addressLine: string | null): boolean {
  return addressLine != null && /^\d+\s*[-–—]\s*\d+\b/.test(addressLine);
}

export function resolveDossierPackageContext(
  canonicalAddress: string,
  details: PropertyDetails | null
): DossierPackageContext {
  const canonicalLine = firstAddressLine(canonicalAddress);
  const omLine = omAddressLine(details);
  const suffix = addressSuffix(canonicalAddress);
  const lots = lotSummary(details);
  const isPackage =
    (omLine != null && comparableAddressLine(omLine) !== comparableAddressLine(canonicalLine)) ||
    hasAddressRange(omLine) ||
    (lots != null && /lots?\s+\d+.*\d+/i.test(lots));
  const dossierAddress =
    omLine == null
      ? canonicalAddress
      : omLine.includes(",")
        ? omLine
        : [omLine, ...suffix].join(", ");
  const packageNote = isPackage
    ? `Package OM covers multiple buildings or lots${lots ? ` (${lots})` : ""}; property-level BBL and HPD registration data may reflect only the canonical listing address.`
    : null;
  return {
    dossierAddress,
    isPackage,
    packageNote,
  };
}

export function propertyOverviewFromDetails(
  details: PropertyDetails | null,
  packageContext?: DossierPackageContext | null
): DossierPropertyOverview | null {
  if (!details) return packageContext?.packageNote ? { packageNote: packageContext.packageNote } : null;
  const propertyInfo = omPropertyInfo(details);
  const taxCode =
    stringValue(details.taxCode) ??
    stringValue(propertyInfo?.taxClass) ??
    null;
  const bblRaw = details.bbl ?? details.buildingLotBlock ?? null;
  const bbl = !packageContext?.isPackage && typeof bblRaw === "string" && bblRaw.trim().length > 0 ? bblRaw.trim() : undefined;
  const hpd = details.enrichment?.hpdRegistration as
    | {
        registrationId?: string;
        lastRegistrationDate?: string;
        registration_id?: string;
        last_registration_date?: string;
      }
    | undefined;
  const hpdRegistrationId =
    !packageContext?.isPackage ? (hpd?.registrationId ?? hpd?.registration_id ?? null) : null;
  const hpdRegistrationDate =
    !packageContext?.isPackage ? (hpd?.lastRegistrationDate ?? hpd?.last_registration_date ?? null) : null;
  if (!taxCode && !hpdRegistrationId && !hpdRegistrationDate && !bbl && !packageContext?.packageNote) {
    return null;
  }
  return {
    taxCode: taxCode ?? undefined,
    hpdRegistrationId: hpdRegistrationId ?? undefined,
    hpdRegistrationDate: hpdRegistrationDate ?? undefined,
    bbl,
    packageNote: packageContext?.packageNote ?? undefined,
  };
}
