/**
 * Broker/agent enrichment: one OpenAI call to look up contact info (email, phone, company)
 * from broker/agent names. Used when "Send to property data" runs on raw listings.
 */

import type { AgentEnrichmentEntry } from "@re-sourcing/contracts";
import OpenAI from "openai";
import { getEnrichmentModel } from "./openaiModels.js";

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

/**
 * Call OpenAI to search for each broker/agent name and return contact info:
 * email, phone, company (firm). Returns one entry per input name in the same order.
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
    ? agentNames.map((n) => (n != null ? String(n).trim() : "")).filter(Boolean)
    : [];
  if (names.length === 0) return null;

  const openai = new OpenAI({ apiKey: key });
  const model = getEnrichmentModel();

  const contextLine = propertyContext?.trim()
    ? `\nProperty/listing context (use to disambiguate): ${propertyContext.trim()}`
    : "";

  const prompt = `You are helping find contact info for NYC real estate brokers and agents who appear on StreetEasy (and similar NYC listing sites).

TASK: For each name below, search as you would to find who represents NYC properties on StreetEasy and get their professional contact info. Think: "NYC broker [name] contact", "[name] real estate agent New York", "[name] StreetEasy", firm websites, and licensee directories. The correct broker/agent is usually in the top 5–10 search results; accept fuzzy name matches (e.g. spelling or format variations, nicknames, middle initials) when the person is clearly the same NYC professional. For each PERSON (individual broker/agent), you MUST find at least one result from your search and return the most likely contact: provide the best-matching email and/or phone you can identify (use common patterns like firstname.lastname@firm.com, firm switchboards, known NYC brokerages). Only use null for email/phone when there is genuinely no findable or inferable contact for that person. For FIRM/OFFICE names only (e.g. "Compass", "Douglas Elliman"), firm name is enough; email/phone may be null.
${contextLine}

Names to look up (one per line, same order in your reply):
${names.map((n) => `- ${n}`).join("\n")}

Reply with a single JSON object with key "entries": an array of objects in the SAME ORDER as the names above. Each object: "name" (string), "firm" (string or null), "email" (string or null), "phone" (string or null). For each person, include at least one of email or phone with your best/most likely result; use null only when you cannot find or infer any value.
Example: {"entries":[{"name":"John Smith","firm":"Compass","email":"john.smith@compass.com","phone":"212-555-0100"},{"name":"Jane Doe","firm":"Corcoran","email":"jane.doe@corcoran.com","phone":null}]}`;

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return null;

    let jsonStr = content.trim();
    const codeBlock = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```$/);
    if (codeBlock) jsonStr = codeBlock[1].trim();

    let parsed: { entries?: unknown[] };
    try {
      parsed = JSON.parse(jsonStr) as { entries?: unknown[] };
    } catch (e) {
      console.error("[brokerEnrichment] Invalid JSON from OpenAI:", (e as Error).message);
      return null;
    }

    const arr = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const result: AgentEnrichmentEntry[] = [];

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const raw = arr[i];
      if (raw && typeof raw === "object" && raw !== null && "name" in raw) {
        const o = raw as Record<string, unknown>;
        result.push({
          name: String(o.name ?? name),
          firm: o.firm != null && o.firm !== "N/A" ? String(o.firm) : null,
          email: o.email != null && o.email !== "N/A" ? String(o.email) : null,
          phone: o.phone != null && o.phone !== "N/A" ? String(o.phone) : null,
        });
      } else {
        result.push({ name, firm: null, email: null, phone: null });
      }
    }

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[brokerEnrichment] OpenAI request failed:", msg);
    return null;
  }
}
