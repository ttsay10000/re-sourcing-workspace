/**
 * Presentation LLM: takes raw dossier text and returns formatting-corrected text
 * so the PDF has consistent pipe tables, bullets, and spacing. Ensures strong UI/presentation.
 */

import OpenAI from "openai";
import { getDossierModel } from "../enrichment/openaiModels.js";

const PRESENTATION_SYSTEM = `You are a document formatting specialist. You receive a real estate deal dossier as plain text. Your job is to output the EXACT same content with only formatting corrections so it renders correctly in a PDF.

RULES:
1. Tables: Every table row must be exactly in the format | cell1 | cell2 | (or more columns). Use a single pipe between cells. No missing pipes. Preserve all numbers and labels exactly.
2. Bold in tables: Keep **text** for bold (e.g. | **NOI** | $50,000.00 |).
3. Bullets: Any bullet point must start with • (bullet character) followed by a space. Preserve the rest of the line.
4. Section headings: Keep lines like "1. PROPERTY OVERVIEW" and "--------------------" as-is. Ensure one blank line before each section heading and one after the underline.
5. Spacing: Exactly one blank line between sections. No extra blank lines inside tables.
6. Do not add, remove, or change any numbers, addresses, or labels. Only fix formatting.
7. Output ONLY the corrected dossier text. No preamble, no explanation, no markdown code fence.`;

const PRESENTATION_USER_PREFIX = `Correct the formatting of this deal dossier. Preserve all content; fix only table pipes, bullets, and spacing. Output only the corrected text.\n\n`;

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

/**
 * Run presentation LLM on dossier text. Returns formatting-corrected text, or original if API fails.
 */
export async function formatDossierForPresentation(dossierText: string): Promise<string> {
  const key = getApiKey();
  if (!key || !dossierText || dossierText.trim().length < 50) return dossierText;

  const openai = new OpenAI({ apiKey: key });
  const userContent = PRESENTATION_USER_PREFIX + dossierText;

  try {
    const completion = await openai.chat.completions.create({
      model: getDossierModel(),
      messages: [
        { role: "system", content: PRESENTATION_SYSTEM },
        { role: "user", content: userContent },
      ],
      max_tokens: 4096,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return dossierText;
    const trimmed = content.trim();
    // Remove any markdown code fence the model might have added
    const noFence = trimmed.replace(/^```(?:text)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
    return noFence.length > 50 ? noFence : dossierText;
  } catch (err) {
    console.warn("[formatDossierForPresentation]", err instanceof Error ? err.message : err);
    return dossierText;
  }
}
