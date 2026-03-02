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
  _propertyContext?: string | null
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

  const prompt = `You are a real estate data assistant. For each of the following broker or agent names (NYC area), look up their contact information and return:
- company: brokerage/firm name
- email: contact email if found
- phone: contact phone if found

Names to look up (one per line):\n${names.map((n) => `- ${n}`).join("\n")}

Reply with a single JSON object with key "entries": an array of objects in the SAME ORDER as the names above. Each object must have: "name" (string, the name you looked up), "firm" (string or null), "email" (string or null), "phone" (string or null). Use null for any field you cannot find. Example:
{"entries":[{"name":"John Smith","firm":"Compass","email":"john@compass.com","phone":"212-555-0100"},{"name":"Jane Doe","firm":null,"email":null,"phone":null}]}`;

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
