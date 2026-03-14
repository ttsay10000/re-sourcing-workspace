/**
 * Broker/agent enrichment: use OpenAI web search to find actual broker contact info
 * from broker/agent names. Used when listings are ingested into property data.
 */

import type { AgentEnrichmentEntry } from "@re-sourcing/contracts";
import OpenAI from "openai";
import { getEnrichmentModel } from "./openaiModels.js";

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
        required: ["name", "firm", "email", "phone"],
        properties: {
          name: { type: "string" },
          firm: { type: ["string", "null"] },
          email: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

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
  };
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

function buildLookupInput(agentNames: string[], propertyContext?: string | null): string {
  const contextLine = propertyContext?.trim()
    ? `Property/listing context for disambiguation: ${propertyContext.trim()}`
    : "Property/listing context for disambiguation: none provided";

  return [
    "Find actual contact info for NYC real estate brokers and agents.",
    contextLine,
    "",
    "For each name below, use web search queries such as:",
    ...agentNames.map((name) => `- find contact info for broker in NYC ${name}`),
    "",
    "Also check combinations like '<name> NYC broker email', '<name> StreetEasy', and '<name> real estate New York'.",
    "Only return contact info that you can directly find in search results, brokerage pages, or public agent/profile pages.",
    "Do not infer or guess email formats, phone numbers, or firms.",
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
  propertyContext?: string | null
): Promise<AgentEnrichmentEntry[] | null> {
  const response = await openai.responses.create({
    model,
    instructions: [
      "You look up actual broker contact info for NYC real estate listings.",
      "You must use web search before answering.",
      "Return only JSON matching the provided schema.",
      "Do not infer or guess contact details.",
    ].join(" "),
    input: buildLookupInput(agentNames, propertyContext),
    tools: [NYC_WEB_SEARCH_TOOL],
    tool_choice: { type: NYC_WEB_SEARCH_TOOL.type },
    parallel_tool_calls: false,
    max_output_tokens: Math.max(500, agentNames.length * 180),
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
  return agentNames.map((name, index) => normalizeEntry(name, rows[index]));
}

async function requestBrokerLookupWithRetry(
  openai: OpenAI,
  model: string,
  agentNames: string[],
  propertyContext?: string | null
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
  propertyContext?: string | null
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
  const model = getEnrichmentModel();

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
