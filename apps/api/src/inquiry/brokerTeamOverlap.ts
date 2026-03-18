import type { AgentEnrichmentEntry, RecipientContactCandidate } from "@re-sourcing/contracts";

export interface BrokerTeamRecord {
  name?: string | null;
  email?: string | null;
  firm?: string | null;
}

export interface BrokerTeamSourceInput {
  listingAgents?: AgentEnrichmentEntry[] | null;
  candidateContacts?: RecipientContactCandidate[] | null;
  resolvedContactEmail?: string | null;
  extraRecords?: BrokerTeamRecord[] | null;
}

export interface BrokerTeamOverlapSourceProperty {
  propertyId: string;
  canonicalAddress: string;
  sentAt: string;
  brokers: BrokerTeamRecord[];
}

export interface BrokerTeamOverlapMatch {
  propertyId: string;
  canonicalAddress: string;
  sentAt: string;
  sharedBrokers: string[];
}

interface NormalizedBrokerTeamRecord {
  normalizedEmail: string | null;
  normalizedName: string | null;
  normalizedFirm: string | null;
  label: string;
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizeName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return normalized.includes(" ") ? normalized : null;
}

function normalizeFirm(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function buildBrokerLabel(record: BrokerTeamRecord): string {
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  if (name && email) return `${name} (${email})`;
  if (name) return name;
  if (email) return email;
  return "Unknown broker";
}

function toNormalizedBrokerRecord(record: BrokerTeamRecord): NormalizedBrokerTeamRecord | null {
  const normalizedEmail = normalizeEmail(record.email);
  const normalizedName = normalizeName(record.name);
  if (!normalizedEmail && !normalizedName) return null;
  return {
    normalizedEmail,
    normalizedName,
    normalizedFirm: normalizeFirm(record.firm),
    label: buildBrokerLabel(record),
  };
}

function mergeBrokerRecord(target: BrokerTeamRecord, incoming: BrokerTeamRecord): BrokerTeamRecord {
  return {
    email: target.email ?? incoming.email ?? null,
    name: target.name ?? incoming.name ?? null,
    firm: target.firm ?? incoming.firm ?? null,
  };
}

function dedupeBrokerRecords(records: BrokerTeamRecord[]): BrokerTeamRecord[] {
  const deduped = new Map<string, BrokerTeamRecord>();
  for (const record of records) {
    const normalizedEmail = normalizeEmail(record.email);
    const normalizedName = normalizeName(record.name);
    if (!normalizedEmail && !normalizedName) continue;
    const normalizedFirm = normalizeFirm(record.firm);
    const key = normalizedEmail ?? `${normalizedName}|${normalizedFirm ?? ""}`;
    const existing = deduped.get(key);
    deduped.set(key, existing ? mergeBrokerRecord(existing, record) : record);
  }
  return [...deduped.values()];
}

function shareBrokerIdentity(a: NormalizedBrokerTeamRecord, b: NormalizedBrokerTeamRecord): boolean {
  if (a.normalizedEmail && b.normalizedEmail && a.normalizedEmail === b.normalizedEmail) return true;
  if (!a.normalizedName || !b.normalizedName || a.normalizedName !== b.normalizedName) return false;
  return !a.normalizedFirm || !b.normalizedFirm || a.normalizedFirm === b.normalizedFirm;
}

function pickPreferredBrokerLabel(a: NormalizedBrokerTeamRecord, b: NormalizedBrokerTeamRecord): string {
  if (a.label.length === b.label.length) return a.label.localeCompare(b.label) <= 0 ? a.label : b.label;
  return a.label.length >= b.label.length ? a.label : b.label;
}

export function buildBrokerTeamRecords(input: BrokerTeamSourceInput): BrokerTeamRecord[] {
  const records: BrokerTeamRecord[] = [];
  for (const agent of input.listingAgents ?? []) {
    records.push({
      name: agent?.name ?? null,
      email: agent?.email ?? null,
      firm: agent?.firm ?? null,
    });
  }
  for (const candidate of input.candidateContacts ?? []) {
    records.push({
      name: candidate?.name ?? null,
      email: candidate?.email ?? null,
      firm: candidate?.firm ?? null,
    });
  }
  if (input.resolvedContactEmail) {
    records.push({ email: input.resolvedContactEmail });
  }
  for (const record of input.extraRecords ?? []) {
    records.push(record);
  }
  return dedupeBrokerRecords(records);
}

export function findBrokerTeamOverlapMatches(params: {
  currentBrokers: BrokerTeamRecord[];
  contactedProperties: BrokerTeamOverlapSourceProperty[];
}): BrokerTeamOverlapMatch[] {
  const current = params.currentBrokers
    .map(toNormalizedBrokerRecord)
    .filter((record): record is NormalizedBrokerTeamRecord => record != null);
  if (current.length === 0) return [];

  const matches: BrokerTeamOverlapMatch[] = [];
  for (const property of params.contactedProperties) {
    const others = property.brokers
      .map(toNormalizedBrokerRecord)
      .filter((record): record is NormalizedBrokerTeamRecord => record != null);
    if (others.length === 0) continue;

    const shared = new Set<string>();
    for (const currentBroker of current) {
      const otherBroker = others.find((candidate) => shareBrokerIdentity(currentBroker, candidate));
      if (otherBroker) {
        shared.add(pickPreferredBrokerLabel(currentBroker, otherBroker));
      }
    }
    if (shared.size === 0) continue;

    matches.push({
      propertyId: property.propertyId,
      canonicalAddress: property.canonicalAddress,
      sentAt: property.sentAt,
      sharedBrokers: [...shared].sort((a, b) => a.localeCompare(b)),
    });
  }

  return matches.sort((a, b) => {
    const timeA = Date.parse(a.sentAt);
    const timeB = Date.parse(b.sentAt);
    if (!Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA !== timeB) return timeB - timeA;
    return a.canonicalAddress.localeCompare(b.canonicalAddress);
  });
}
