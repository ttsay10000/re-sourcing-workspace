/**
 * Broker/agent enrichment via OpenAI: find NYC broker by name and return firm, email, phone.
 * If OPENAI_API_KEY is missing, returns null (no-op).
 */

import type { AgentEnrichmentEntry } from "@re-sourcing/contracts";
import OpenAI from "openai";
import { getEnrichmentModel } from "./openaiModels.js";

/** Normalize API key: trim and remove surrounding quotes (e.g. from Render env). */
function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

/**
 * Call OpenAI to find broker/agent in NYC by name and return contact info.
 * For general inboxes (team name, rental office) returns whatever is possible or N/A.
 */
export async function enrichBrokers(
  agentNames: string[] | null | undefined,
  propertyContext?: string | null
): Promise<AgentEnrichmentEntry[] | null> {
  const key = getApiKey();
  if (!key) {
    console.warn("[brokerEnrichment] OPENAI_API_KEY missing or invalid (set a non-empty key in .env or Render).");
    return null;
  }

  const names = Array.isArray(agentNames) ? agentNames.filter((n) => n != null && String(n).trim()) : [];
  if (names.length === 0) return null;

  const openai = new OpenAI({ apiKey: key });
  const context = propertyContext && propertyContext.trim() ? ` representing the property: ${propertyContext.trim()}` : "";

  const prompt = `You are a real estate data assistant. For each of the following broker/agent names in NYC, find their firm (brokerage name), email, and phone if possible. Most of the time you do not need the specific property. If the name looks like a general inbox (team name, rental office, etc.), try to get whatever info you can or use "N/A" for unavailable fields.

Names to look up: ${names.map((n) => `"${n}"`).join(", ")}${context}

Respond with a JSON object with a single key "entries" that is an array of objects, one per name in the same order. Each object must have: "name" (string), "firm" (string or null), "email" (string or null), "phone" (string or null). Use "N/A" or null when information is not available. Example: {"entries":[{"name":"John Smith","firm":"Compass","email":"john@compass.com","phone":"212-555-0100"},{"name":"Rental Office","firm":null,"email":null,"phone":null}]}`;

  try {
    const completion = await openai.chat.completions.create({
      model: getEnrichmentModel(),
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return null;

    // Strip markdown code fence if present so JSON.parse works
    let jsonStr = content.trim();
    const codeBlock = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```$/);
    if (codeBlock) jsonStr = codeBlock[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error("[brokerEnrichment] LLM response was not valid JSON:", (parseErr as Error)?.message ?? parseErr);
      return null;
    }

    let arr: unknown[] = [];
    if (parsed && typeof parsed === "object" && "entries" in parsed && Array.isArray((parsed as { entries: unknown[] }).entries)) {
      arr = (parsed as { entries: unknown[] }).entries;
    } else if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (parsed && typeof parsed === "object" && "results" in parsed && Array.isArray((parsed as { results: unknown[] }).results)) {
      arr = (parsed as { results: unknown[] }).results;
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const firstArray = obj.entries ?? obj.results ?? obj.agents ?? obj.list;
      arr = Array.isArray(firstArray) ? firstArray : [];
    }

    const result: AgentEnrichmentEntry[] = [];
    for (let i = 0; i < names.length; i++) {
      const raw = arr[i];
      const name = names[i];
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
    const status = err && typeof err === "object" && "status" in err ? (err as { status?: number }).status : null;
    console.error(
      "[brokerEnrichment] OpenAI request failed:",
      status != null ? `status=${status}` : "",
      msg
    );
    return null;
  }
}
