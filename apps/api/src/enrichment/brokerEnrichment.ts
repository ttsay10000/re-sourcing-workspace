/**
 * Broker/agent enrichment: use OpenAI web search to find actual broker contact info
 * from broker/agent names. Used when listings are ingested into property data.
 */

import type { AgentEnrichmentEntry, ListingNormalized } from "@re-sourcing/contracts";
import OpenAI from "openai";
import { getBrokerLookupModel } from "./openaiModels.js";

const BROKER_LOOKUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "firm", "email", "phone", "confidence", "evidence", "sourceUrl", "needsReview"],
        properties: {
          name: { type: "string" },
          firm: { type: ["string", "null"] },
          email: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          confidence: { type: ["number", "null"] },
          evidence: { type: ["string", "null"] },
          sourceUrl: { type: ["string", "null"] },
          needsReview: { type: ["boolean", "null"] },
        },
      },
    },
  },
} as const;

export interface BrokerLookupContext {
  propertyContext?: string | null;
  source?: string | null;
  listingUrl?: string | null;
  listedAt?: string | null;
  brokerageName?: string | null;
  agentFacts?: AgentEnrichmentEntry[] | null;
}

const NYC_WEB_SEARCH_TOOL = {
  type: "web_search_preview",
  search_context_size: "medium",
  user_location: {
    type: "approximate",
    city: "New York",
    region: "New York",
    country: "US",
    timezone: "America/New_York",
  },
} as const;

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

function cleanNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || /^n\/?a$/i.test(normalized) || /^unknown$/i.test(normalized)) return null;
  return normalized;
}

function cleanEmail(value: unknown): string | null {
  const normalized = cleanNullableString(value)?.toLowerCase() ?? null;
  if (!normalized) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function cleanConfidence(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : null;
  if (numeric == null || !Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function cleanBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }
  return null;
}

function cleanSourceUrl(value: unknown): string | null {
  const normalized = cleanNullableString(value);
  if (!normalized) return null;
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

function normalizeEntry(name: string, raw: unknown): AgentEnrichmentEntry {
  if (!raw || typeof raw !== "object") {
    return { name, firm: null, email: null, phone: null };
  }
  const entry = raw as Record<string, unknown>;
  return {
    name: cleanNullableString(entry.name) ?? name,
    firm: cleanNullableString(entry.firm),
    email: cleanEmail(entry.email),
    phone: cleanNullableString(entry.phone),
    source: cleanNullableString(entry.source),
    confidence: cleanConfidence(entry.confidence),
    evidence: cleanNullableString(entry.evidence),
    sourceUrl: cleanSourceUrl(entry.sourceUrl ?? entry.source_url ?? entry.url),
    needsReview: cleanBoolean(entry.needsReview ?? entry.needs_review),
  };
}

function normalizeFirmKey(value: string | null | undefined): string | null {
  const cleaned = cleanNullableString(value)?.toLowerCase() ?? null;
  if (!cleaned) return null;
  const withoutNoise = cleaned
    .replace(/\b(real estate|brokerage|brokers?|group|team|llc|inc|corp|corporation|company|co|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return withoutNoise || cleaned.replace(/[^a-z0-9]+/g, "");
}

function firmsCompatible(sourceFirm: string | null | undefined, candidateFirm: string | null | undefined): boolean {
  const source = normalizeFirmKey(sourceFirm);
  const candidate = normalizeFirmKey(candidateFirm);
  if (!source || !candidate) return true;
  return source === candidate || source.includes(candidate) || candidate.includes(source);
}

function isMeaningfulBrokerEntry(entry: AgentEnrichmentEntry | null | undefined): boolean {
  if (!entry) return false;
  return Boolean(entry.firm || entry.email || entry.phone);
}

export function hasMeaningfulBrokerEnrichment(
  entries: AgentEnrichmentEntry[] | null | undefined
): boolean {
  return Array.isArray(entries) && entries.some((entry) => isMeaningfulBrokerEntry(entry));
}

function findSourceFact(name: string, context: BrokerLookupContext | null): AgentEnrichmentEntry | null {
  const normalizedName = name.trim().toLowerCase();
  if (!normalizedName || !Array.isArray(context?.agentFacts)) return null;
  return (
    context.agentFacts.find((entry) => entry.name?.trim().toLowerCase() === normalizedName) ??
    context.agentFacts.find((entry) => {
      const entryName = entry.name?.trim().toLowerCase() ?? "";
      return entryName.includes(normalizedName) || normalizedName.includes(entryName);
    }) ??
    null
  );
}

function normalizeLookupContext(input?: string | BrokerLookupContext | null): BrokerLookupContext | null {
  if (typeof input === "string") return { propertyContext: input };
  if (!input || typeof input !== "object") return null;
  return {
    propertyContext: cleanNullableString(input.propertyContext),
    source: cleanNullableString(input.source),
    listingUrl: cleanNullableString(input.listingUrl),
    listedAt: cleanNullableString(input.listedAt),
    brokerageName: cleanNullableString(input.brokerageName),
    agentFacts: Array.isArray(input.agentFacts)
      ? input.agentFacts.map((entry) => normalizeEntry(entry.name ?? "Listing agent", entry))
      : null,
  };
}

export function brokerLookupContextFromListing(
  listing: Pick<
    ListingNormalized,
    "address" | "city" | "zip" | "source" | "url" | "listedAt" | "extra" | "agentEnrichment"
  >
): BrokerLookupContext {
  const extra = listing.extra && typeof listing.extra === "object" && !Array.isArray(listing.extra)
    ? listing.extra as Record<string, unknown>
    : {};
  const brokerageName = cleanNullableString(
    extra.brokerageName ??
      extra.brokerage_name ??
      extra.agencyName ??
      extra.agency_name ??
      extra.agency ??
      extra.firm ??
      extra.officeName ??
      extra.office_name
  );
  const agentFactsFromExtra = Array.isArray(extra.sourceAgentFacts)
    ? extra.sourceAgentFacts.map((entry) => normalizeEntry("Listing agent", entry))
    : null;
  const agentFacts = agentFactsFromExtra?.length
    ? agentFactsFromExtra
    : Array.isArray(listing.agentEnrichment)
      ? listing.agentEnrichment
      : null;
  const agentFactBrokerage = agentFacts?.map((entry) => cleanNullableString(entry.firm)).find(Boolean) ?? null;
  return {
    propertyContext: [listing.address, listing.city, listing.zip].filter(Boolean).join(", ") || null,
    source: listing.source,
    listingUrl: listing.url,
    listedAt: listing.listedAt ?? null,
    brokerageName: brokerageName ?? agentFactBrokerage,
    agentFacts,
  };
}

export function mergeBrokerEnrichment(
  agentNames: string[],
  sourceEntries: AgentEnrichmentEntry[] | null | undefined,
  lookupEntries: AgentEnrichmentEntry[] | null | undefined,
  context?: BrokerLookupContext | string | null
): AgentEnrichmentEntry[] | null {
  const normalizedContext = normalizeLookupContext(context);
  const sourceByName = new Map<string, AgentEnrichmentEntry>();
  for (const entry of sourceEntries ?? []) {
    const name = cleanNullableString(entry.name);
    if (name) sourceByName.set(name.toLowerCase(), normalizeEntry(name, entry));
  }

  const lookupByName = new Map<string, AgentEnrichmentEntry>();
  for (const entry of lookupEntries ?? []) {
    const name = cleanNullableString(entry.name);
    if (name) lookupByName.set(name.toLowerCase(), normalizeEntry(name, entry));
  }

  const merged = agentNames.map((agentName) => {
    const key = agentName.trim().toLowerCase();
    const source =
      sourceByName.get(key) ??
      findSourceFact(agentName, normalizedContext) ??
      null;
    const lookup =
      lookupByName.get(key) ??
      (lookupEntries ?? []).find((entry) => {
        const entryName = entry.name?.trim().toLowerCase() ?? "";
        return entryName.includes(key) || key.includes(entryName);
      }) ??
      null;
    const sourceFirm = source?.firm ?? normalizedContext?.brokerageName ?? null;
    const lookupFirm = lookup?.firm ?? null;
    const lookupAllowed = firmsCompatible(sourceFirm, lookupFirm);
    const sourceHasContact = Boolean(source?.email || source?.phone);
    const lookupConfidence = lookup?.confidence ?? null;
    const lookupHasUsableEvidence = lookupAllowed && (lookupConfidence == null || lookupConfidence >= 70);
    const lookupEmail = lookupHasUsableEvidence ? lookup?.email ?? null : null;
    const lookupPhone = lookupHasUsableEvidence ? lookup?.phone ?? null : null;
    const usedLookupContact = !sourceHasContact && Boolean(lookupEmail || lookupPhone);
    return {
      name: source?.name ?? lookup?.name ?? agentName,
      firm: source?.firm ?? (lookupAllowed ? lookup?.firm ?? null : sourceFirm),
      email: source?.email ?? lookupEmail,
      phone: source?.phone ?? lookupPhone,
      source: sourceHasContact ? "source" : usedLookupContact ? "llm" : source?.source ?? lookup?.source ?? null,
      confidence: sourceHasContact ? 100 : lookupHasUsableEvidence ? lookupConfidence : null,
      evidence: sourceHasContact ? source?.evidence ?? "Broker contact provided by source listing payload." : lookup?.evidence ?? null,
      sourceUrl: sourceHasContact ? source?.sourceUrl ?? normalizedContext?.listingUrl ?? null : lookup?.sourceUrl ?? null,
      needsReview: sourceHasContact ? false : Boolean(usedLookupContact || lookup?.needsReview),
    };
  });

  return hasMeaningfulBrokerEnrichment(merged) ? merged : null;
}

function buildLookupInput(agentNames: string[], contextInput?: string | BrokerLookupContext | null): string {
  const context = normalizeLookupContext(contextInput);
  const contextLine = context?.propertyContext?.trim()
    ? `Property/listing context for disambiguation: ${context.propertyContext.trim()}`
    : "Property/listing context for disambiguation: none provided";
  const listingFacts = [
    context?.source ? `Source: ${context.source}` : null,
    context?.listingUrl ? `StreetEasy/listing URL: ${context.listingUrl}` : null,
    context?.listedAt ? `Listed date: ${context.listedAt}` : null,
    context?.brokerageName ? `Listing-time agency/brokerage from source: ${context.brokerageName}` : null,
  ].filter(Boolean);
  const sourceAgentLines = agentNames.map((name) => {
    const fact = findSourceFact(name, context);
    const firm = fact?.firm ?? context?.brokerageName ?? null;
    const pieces = [
      `- ${name}`,
      firm ? `source agency: ${firm}` : "source agency: not provided",
      fact?.email ? `source email: ${fact.email}` : null,
      fact?.phone ? `source phone: ${fact.phone}` : null,
    ].filter(Boolean);
    return pieces.join(" | ");
  });

  return [
    "Find actual contact info for NYC real estate brokers and agents for a specific listing.",
    contextLine,
    ...listingFacts,
    "",
    "Use only the broker names supplied in Source agent facts. Do not search for, select, substitute, or guess a different broker/contact name.",
    "The listing-time agency/brokerage supplied here is a required disambiguation constraint. Search for the exact broker name together with that brokerage first.",
    "Return each entry's name exactly as provided in the input list, even if a search result displays a variation.",
    "The source listing facts are primary constraints. Agents move firms; do not return an email or phone from a different current brokerage when the listing-time agency is known.",
    "If the source agency is known, only return contact details that public evidence ties to that same agency, the exact StreetEasy listing, or an official listing/team page for the same property.",
    "If you cannot verify the agent at the listing-time agency, return null for email and phone instead of guessing.",
    "Set confidence from 0 to 100, include a short evidence note, include the best source URL, and set needsReview true unless the evidence explicitly ties the broker, brokerage, and property/listing together.",
    "",
    "Source agent facts:",
    ...sourceAgentLines,
    "",
    "For each name below, use web search queries such as:",
    ...agentNames.map((name) => {
      const fact = findSourceFact(name, context);
      const firm = fact?.firm ?? context?.brokerageName ?? "";
      return `- ${name} ${firm} ${context?.propertyContext ?? ""} StreetEasy broker email`;
    }),
    "",
    "Also check combinations like '<name> <agency> StreetEasy', '<name> <property address>', and '<name> <agency> email'.",
    "Only return contact info that you can directly find in search results, brokerage pages, or public agent/profile pages.",
    "Do not infer or guess email formats, phone numbers, firms, or broker names.",
    "Keep the reply in the same order as the input names.",
    "",
    "Names:",
    ...agentNames.map((name) => `- ${name}`),
  ].join("\n");
}

async function requestBrokerLookup(
  openai: OpenAI,
  model: string,
  agentNames: string[],
  propertyContext?: string | BrokerLookupContext | null
): Promise<AgentEnrichmentEntry[] | null> {
  const response = await openai.responses.create({
    model,
    instructions: [
      "You look up actual broker contact info for NYC real estate listings.",
      "You must use web search before answering.",
      "The caller supplies the listing broker name and listing-time brokerage. Never invent, replace, or infer a different contact name.",
      "Listing-time brokerage matters more than a broker's current firm.",
      "If evidence points to a different current agency than the listing-time agency, leave contact fields null.",
      "Return confidence, evidence, sourceUrl, and needsReview for every entry.",
      "Return only JSON matching the provided schema.",
      "Do not infer or guess contact details.",
    ].join(" "),
    input: buildLookupInput(agentNames, propertyContext),
    tools: [NYC_WEB_SEARCH_TOOL],
    tool_choice: { type: NYC_WEB_SEARCH_TOOL.type },
    parallel_tool_calls: false,
    max_output_tokens: Math.max(700, agentNames.length * 260),
    text: {
      format: {
        type: "json_schema",
        name: "broker_lookup",
        strict: true,
        schema: BROKER_LOOKUP_SCHEMA,
      },
    },
  });

  const content = response.output_text?.trim();
  if (!content) return null;

  let parsed: { entries?: unknown[] };
  try {
    parsed = JSON.parse(content) as { entries?: unknown[] };
  } catch (err) {
    console.error("[brokerEnrichment] Invalid JSON from OpenAI:", err instanceof Error ? err.message : err);
    return null;
  }

  const rows = Array.isArray(parsed.entries) ? parsed.entries : [];
  return agentNames.map((name, index) => ({ ...normalizeEntry(name, rows[index]), name }));
}

async function requestBrokerLookupWithRetry(
  openai: OpenAI,
  model: string,
  agentNames: string[],
  propertyContext?: string | BrokerLookupContext | null
): Promise<AgentEnrichmentEntry[] | null> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const entries = await requestBrokerLookup(openai, model, agentNames, propertyContext);
      if (entries) return entries;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (lastError) {
    console.error("[brokerEnrichment] OpenAI request failed:", lastError);
  }
  return null;
}

/**
 * Use OpenAI web search to find contact info for each broker/agent name and return
 * one entry per input name in the same order.
 */
export async function enrichBrokers(
  agentNames: string[] | null | undefined,
  propertyContext?: string | BrokerLookupContext | null
): Promise<AgentEnrichmentEntry[] | null> {
  const key = getApiKey();
  if (!key) {
    console.warn("[brokerEnrichment] OPENAI_API_KEY missing or invalid.");
    return null;
  }

  const names = Array.isArray(agentNames)
    ? agentNames.map((name) => (name != null ? String(name).trim() : "")).filter(Boolean)
    : [];
  if (names.length === 0) return null;

  const openai = new OpenAI({ apiKey: key });
  const model = getBrokerLookupModel();

  try {
    const initial = await requestBrokerLookupWithRetry(openai, model, names, propertyContext);
    if (!initial) return null;

    const unresolvedIndexes = initial
      .map((entry, index) => (!entry.email ? index : -1))
      .filter((index) => index >= 0);

    for (const index of unresolvedIndexes) {
      const retried = await requestBrokerLookupWithRetry(openai, model, [names[index]!], propertyContext);
      if (retried?.[0] && isMeaningfulBrokerEntry(retried[0])) {
        initial[index] = retried[0];
      }
    }

    return hasMeaningfulBrokerEnrichment(initial) ? initial : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[brokerEnrichment] OpenAI request failed:", msg);
    return null;
  }
}
