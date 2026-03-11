import type { ListingRow, OmAnalysis, PropertyDetails } from "@re-sourcing/contracts";
import OpenAI from "openai";
import type { ChatCompletionContentPart, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  getPropertyConditionModel,
  getPropertyConditionReasoningEffort,
  supportsReasoningEffort,
} from "../enrichment/openaiModels.js";
import type { DossierConditionReviewContext } from "./underwritingContext.js";

const MAX_CONDITION_IMAGES = 6;
const MAX_TEXT_HINT_CHARS = 5_000;

interface TextConditionHeuristic {
  overallCondition: string | null;
  renovationScope: string | null;
  textSignals: string[];
  summaryBullets: string[];
  confidence: number | null;
}

interface ConditionPattern {
  key: string;
  label: string;
  regex: RegExp;
  summary: string;
  overallCondition: string | null;
  renovationScope: string | null;
  rank: number;
}

const CONDITION_PATTERNS: ConditionPattern[] = [
  {
    key: "development",
    label: "development / build opportunity language",
    regex: /\b(build opportunity|development opportunity|redevelop(?:ment)?|teardown|tear down|assemblage|ground[- ]up|vacant site|land value)\b/i,
    summary: "Marketing copy frames the deal as a redevelopment or major repositioning opportunity.",
    overallCondition: "Development / repositioning opportunity",
    renovationScope: "Development / repositioning",
    rank: 50,
  },
  {
    key: "heavy_rehab",
    label: "fixer / major renovation language",
    regex: /\b(fixer(?:-|\s)?upper|gut renovation|full gut|heavy rehab|major renovation|substantial rehab|shell condition|requires extensive renovation|developer special)\b/i,
    summary: "Text cues suggest heavy rehab or major capital work before stabilization.",
    overallCondition: "Needs rehab",
    renovationScope: "Heavy",
    rank: 40,
  },
  {
    key: "value_add",
    label: "value-add / dated-condition language",
    regex: /\b(value-add|value add|renovation(?:s)? needed|needs work|needs tlc|deferred maintenance|dated|original condition|as[- ]is|estate condition|update opportunity)\b/i,
    summary: "OM or listing language points to a value-add story with dated finishes or deferred work.",
    overallCondition: "Dated / value-add",
    renovationScope: "Moderate",
    rank: 30,
  },
  {
    key: "vacancy",
    label: "vacancy / lease-up language",
    regex: /\b(delivered vacant|vacant units?|lease-up opportunity|vacancy upside|below-market rents?|upside in rents?)\b/i,
    summary: "Text mentions vacancy or lease-up upside, which supports a repositioning thesis even when finish quality is unclear.",
    overallCondition: null,
    renovationScope: "Light to moderate",
    rank: 20,
  },
  {
    key: "renovated",
    label: "recent renovation / updated-finish language",
    regex: /\b(recently renovated|newly renovated|fully renovated|gut renovated|turnkey|move[- ]in ready|updated kitchens?|updated baths?|modernized|new roof|new boiler|new windows)\b/i,
    summary: "Text cues indicate recent renovation or updated finishes, which may reduce near-term capex.",
    overallCondition: "Renovated / updated",
    renovationScope: "None to minor",
    rank: 10,
  },
];

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

function uniqueStrings(values: Array<string | null | undefined>, limit?: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(trimmed);
    if (limit != null && out.length >= limit) break;
  }
  return out;
}

function sanitizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(
    value.map((entry) => (typeof entry === "string" ? entry.replace(/\s+/g, " ").trim() : null)),
    limit
  );
}

function summarizeOmHints(omAnalysis: OmAnalysis | null | undefined): string[] {
  if (!omAnalysis) return [];
  const memo = omAnalysis.dossierMemo && typeof omAnalysis.dossierMemo === "object"
    ? Object.entries(omAnalysis.dossierMemo)
        .filter(([, value]) => typeof value === "string" && value.trim())
        .map(([key, value]) => `${key}: ${value}`)
    : [];
  const takeaways = Array.isArray(omAnalysis.investmentTakeaways)
    ? omAnalysis.investmentTakeaways.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      )
    : [];
  return uniqueStrings([...takeaways, ...memo], 8);
}

function buildTextHintBlock(
  listing: Pick<ListingRow, "title" | "description"> | null | undefined,
  omAnalysis: OmAnalysis | null | undefined
): string {
  const parts: string[] = [];
  if (listing?.title?.trim()) parts.push(`Listing title: ${listing.title.trim()}`);
  if (listing?.description?.trim()) parts.push(`Listing description:\n${listing.description.trim()}`);
  const omHints = summarizeOmHints(omAnalysis);
  if (omHints.length > 0) parts.push(`OM / brochure condition hints:\n- ${omHints.join("\n- ")}`);
  return parts.join("\n\n").slice(0, MAX_TEXT_HINT_CHARS);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function collectConditionImageUrls(
  listing: Pick<ListingRow, "imageUrls" | "extra"> | null | undefined,
  details?: PropertyDetails | null
): string[] {
  const listingImages = Array.isArray(listing?.imageUrls) ? listing?.imageUrls ?? [] : [];
  const extra = listing?.extra as Record<string, unknown> | null | undefined;
  const extraImages = Array.isArray(extra?.images)
    ? (extra.images as unknown[]).filter((value): value is string => typeof value === "string")
    : [];
  const rentalImages =
    Array.isArray(details?.rentalFinancials?.rentalUnits)
      ? details.rentalFinancials!.rentalUnits!
          .flatMap((unit) =>
            Array.isArray(unit?.images)
              ? unit.images.filter((value): value is string => typeof value === "string")
              : []
          )
      : [];
  return uniqueStrings(
    [...listingImages, ...extraImages, ...rentalImages]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(isHttpUrl),
    MAX_CONDITION_IMAGES
  );
}

export function extractConditionSignalsFromText(
  listingDescription: string | null | undefined,
  omAnalysis: OmAnalysis | null | undefined
): TextConditionHeuristic {
  const combined = [listingDescription ?? "", ...summarizeOmHints(omAnalysis)].join("\n").toLowerCase();
  if (!combined.trim()) {
    return {
      overallCondition: null,
      renovationScope: null,
      textSignals: [],
      summaryBullets: [],
      confidence: null,
    };
  }

  const matches = CONDITION_PATTERNS
    .filter((pattern) => pattern.regex.test(combined))
    .sort((a, b) => b.rank - a.rank);

  if (matches.length === 0) {
    return {
      overallCondition: null,
      renovationScope: null,
      textSignals: [],
      summaryBullets: [],
      confidence: null,
    };
  }

  const hasPositiveRenovationCue = matches.some((match) => match.key === "renovated");
  const hasNegativeCue = matches.some((match) => match.key === "development" || match.key === "heavy_rehab" || match.key === "value_add");
  const top = matches[0]!;

  const summaryBullets = uniqueStrings(
    [
      hasPositiveRenovationCue && hasNegativeCue
        ? "Text signals are mixed: both recent-renovation language and value-add / rehab language appear in the OM or listing."
        : null,
      ...matches.map((match) => match.summary),
    ],
    3
  );

  const overallCondition =
    hasPositiveRenovationCue && hasNegativeCue
      ? "Mixed condition signals"
      : top.overallCondition;
  const renovationScope =
    hasPositiveRenovationCue && hasNegativeCue
      ? "Unclear from text alone"
      : top.renovationScope;

  return {
    overallCondition,
    renovationScope,
    textSignals: uniqueStrings(matches.map((match) => match.label), 4),
    summaryBullets,
    confidence: matches.length > 1 ? 0.45 : 0.35,
  };
}

function normalizeShortLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function buildConditionPrompt(
  canonicalAddress: string,
  imageCount: number,
  textHints: string,
  textHeuristic: TextConditionHeuristic
): string {
  const heuristicLines = [
    textHeuristic.overallCondition ? `- Text-only overall condition guess: ${textHeuristic.overallCondition}` : null,
    textHeuristic.renovationScope ? `- Text-only renovation scope guess: ${textHeuristic.renovationScope}` : null,
    textHeuristic.textSignals.length > 0 ? `- Text signals already detected: ${textHeuristic.textSignals.join("; ")}` : null,
  ].filter((line): line is string => typeof line === "string");

  return `You are reviewing real-estate listing photos for acquisition diligence.

Assess two separate things:
1. the apparent condition / finish level of the property shown, and
2. the quality and usefulness of the listing photos themselves.

Use the photos and the text hints together. Do not produce pricing guidance or an offer.
Do not infer hidden roof, structural, plumbing, HVAC, or system condition unless directly visible in the images or explicitly stated in the text hints.
If the photos are staged, heavily edited, repetitive, low-resolution, or selective, lower confidence and say so.

Return exactly one JSON object with these keys:
- overallCondition: concise label such as "Renovated / updated", "Good", "Fair", "Dated / value-add", "Needs rehab", "Development / repositioning opportunity", or "Unclear"
- renovationScope: concise label such as "None to minor", "Light", "Moderate", "Heavy", "Development / repositioning", or "Unknown"
- imageQuality: "High", "Medium", "Low", or "Insufficient"
- confidence: number from 0 to 1
- coverageSeen: array of short labels for areas shown in the photos
- coverageMissing: array of short labels for important areas not shown
- observedSignals: array of short phrases for visible condition clues
- summaryBullets: 2 to 4 concise bullets combining what the photos show and what the text hints imply

Property: ${canonicalAddress}
Images provided: ${imageCount}

Text hints:
${textHints || "No useful text hints available."}

${heuristicLines.length > 0 ? `Existing text-only signals:\n${heuristicLines.join("\n")}\n` : ""}`;
}

async function runImageConditionReview(
  canonicalAddress: string,
  imageUrls: string[],
  listing: Pick<ListingRow, "title" | "description"> | null | undefined,
  omAnalysis: OmAnalysis | null | undefined
): Promise<Partial<DossierConditionReviewContext> | null> {
  const key = getApiKey();
  if (!key || imageUrls.length === 0) return null;

  const openai = new OpenAI({ apiKey: key });
  const model = getPropertyConditionModel();
  const reasoningEffort = getPropertyConditionReasoningEffort();
  const textHints = buildTextHintBlock(listing, omAnalysis);
  const textHeuristic = extractConditionSignalsFromText(listing?.description ?? null, omAnalysis);
  const prompt = buildConditionPrompt(canonicalAddress, imageUrls.length, textHints, textHeuristic);
  const content: ChatCompletionContentPart[] = [
    { type: "text", text: prompt },
    ...imageUrls.map((url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "low" as const },
    })),
  ];
  const messages: ChatCompletionMessageParam[] = [{ role: "user", content }];

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages,
      response_format: { type: "json_object" },
      ...(supportsReasoningEffort(model) ? { reasoning_effort: reasoningEffort } : {}),
    });
    const contentText = completion.choices[0]?.message?.content;
    if (!contentText || typeof contentText !== "string") return null;
    const parsed = JSON.parse(contentText) as Record<string, unknown>;
    return {
      source: "images_and_text",
      overallCondition: normalizeShortLabel(parsed.overallCondition),
      renovationScope: normalizeShortLabel(parsed.renovationScope),
      imageQuality: normalizeShortLabel(parsed.imageQuality),
      confidence: normalizeConfidence(parsed.confidence),
      imageCountAnalyzed: imageUrls.length,
      coverageSeen: sanitizeStringArray(parsed.coverageSeen, 6),
      coverageMissing: sanitizeStringArray(parsed.coverageMissing, 6),
      observedSignals: sanitizeStringArray(parsed.observedSignals, 6),
      summaryBullets: sanitizeStringArray(parsed.summaryBullets, 4),
    };
  } catch (err) {
    console.warn(
      "[propertyConditionReview] Image-assisted condition review failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function analyzePropertyConditionReview(args: {
  canonicalAddress: string;
  listing: Pick<ListingRow, "title" | "description" | "imageUrls" | "extra"> | null | undefined;
  details?: PropertyDetails | null;
  omAnalysis?: OmAnalysis | null;
}): Promise<DossierConditionReviewContext | null> {
  const { canonicalAddress, listing, details, omAnalysis } = args;
  const textHeuristic = extractConditionSignalsFromText(listing?.description ?? null, omAnalysis ?? null);
  const imageUrls = collectConditionImageUrls(listing, details ?? null);
  const imageReview = await runImageConditionReview(canonicalAddress, imageUrls, listing, omAnalysis ?? null);

  const overallCondition =
    imageReview?.overallCondition ??
    textHeuristic.overallCondition;
  const renovationScope =
    imageReview?.renovationScope ??
    textHeuristic.renovationScope;
  const confidence =
    imageReview?.confidence ??
    textHeuristic.confidence;
  const observedSignals = uniqueStrings(
    [
      ...(imageReview?.observedSignals ?? []),
      ...textHeuristic.textSignals,
    ],
    6
  );
  const summaryBullets = uniqueStrings(
    [
      ...(imageReview?.summaryBullets ?? []),
      ...textHeuristic.summaryBullets,
    ],
    4
  );

  if (
    !overallCondition &&
    !renovationScope &&
    observedSignals.length === 0 &&
    summaryBullets.length === 0 &&
    imageUrls.length === 0
  ) {
    return null;
  }

  return {
    source: imageReview ? "images_and_text" : "text_only",
    overallCondition,
    renovationScope,
    imageQuality: imageReview?.imageQuality ?? null,
    confidence,
    imageCountAnalyzed: imageReview?.imageCountAnalyzed ?? 0,
    coverageSeen: imageReview?.coverageSeen ?? [],
    coverageMissing: imageReview?.coverageMissing ?? [],
    observedSignals,
    textSignals: textHeuristic.textSignals,
    summaryBullets,
  };
}
