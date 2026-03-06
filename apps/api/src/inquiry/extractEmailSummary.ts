/**
 * Extract from inquiry email body via LLM: short summary, latest receipt date from broker/team, and list of attachments.
 */

import OpenAI from "openai";
import { getEnrichmentModel } from "../enrichment/openaiModels.js";

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

export interface EmailSummaryExtract {
  summary: string | null;
  latestReceiptDateFromBroker: string | null;
  attachmentsList: string | null;
}

/**
 * Call LLM to summarize email body and extract: summary, latest receipt date from broker/team, and attachment list.
 * attachmentFilenames: list of PDF attachment names we saved (or []); LLM will list these or "none".
 */
export async function extractEmailSummary(
  bodyText: string | null | undefined,
  attachmentFilenames: string[]
): Promise<EmailSummaryExtract | null> {
  const body = (bodyText ?? "").trim();
  const attachmentsListValue =
    attachmentFilenames.length > 0 ? attachmentFilenames.join(", ") : "none";

  if (!body) {
    return { summary: null, latestReceiptDateFromBroker: null, attachmentsList: attachmentsListValue };
  }

  const key = getApiKey();
  if (!key) return { summary: null, latestReceiptDateFromBroker: null, attachmentsList: attachmentsListValue };

  const attachmentsNote =
    attachmentFilenames.length > 0
      ? `Attachments included with this email (saved PDFs): ${attachmentFilenames.join(", ")}`
      : "No PDF attachments were included with this email.";

  const openai = new OpenAI({ apiKey: key });

  const prompt = `Below is the body text of an email from a broker or broker's team (reply to a property inquiry). 

${attachmentsNote}

Tasks:
1. Write a short summary of the email (2-4 sentences): what the sender is providing, key commitments, or next steps.
2. If the email mentions a date when something was received, will be sent, or a deadline (e.g. "I'll send the OM by Friday", "received the signed LOI on 3/1"), extract the latest such date from the broker/team and return it in a simple format (e.g. "March 1, 2026" or "Friday" or "by end of week"). If no such date is mentioned, use null.
3. List the attachments: if there are saved attachments, list their names; otherwise say "none".

Return a JSON object with exactly these keys:
- summary: string (short summary, or null if body is empty)
- latestReceiptDateFromBroker: string | null (date or deadline mentioned, or null)
- attachmentsList: string (comma-separated attachment names, or the single word "none" if no attachments)

Email body:
${body.slice(0, 8000)}`;

  try {
    const completion = await openai.chat.completions.create({
      model: getEnrichmentModel(),
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return null;

    let jsonStr = content.trim();
    const codeBlock = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```$/);
    if (codeBlock) jsonStr = codeBlock[1].trim();

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : null;
    const latestReceiptDateFromBroker =
      typeof parsed.latestReceiptDateFromBroker === "string" && parsed.latestReceiptDateFromBroker.trim()
        ? parsed.latestReceiptDateFromBroker.trim()
        : null;
    const attachmentsList =
      typeof parsed.attachmentsList === "string" && parsed.attachmentsList.trim()
        ? parsed.attachmentsList.trim()
        : attachmentsListValue;

    return { summary, latestReceiptDateFromBroker, attachmentsList };
  } catch (err) {
    console.warn("[extractEmailSummary]", err instanceof Error ? err.message : err);
    return null;
  }
}
