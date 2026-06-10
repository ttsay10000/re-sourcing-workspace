/**
 * "What to do next" recommendations for the Deal Progress board.
 *
 * A deterministic rule engine derives the task list from board state; the LLM
 * (when configured) only reorders the items and writes the headline. The rule
 * output is always a valid response on its own, so the board never renders an
 * empty or broken panel because of an LLM failure.
 */
import OpenAI from "openai";
import type {
  DealFlowRecommendation,
  DealFlowRecommendationKind,
  DealFlowRecommendationsResponse,
  DealFlowStageId,
} from "@re-sourcing/contracts";
import { STAGE_AGING } from "@re-sourcing/contracts";
import { getDealScoringModel } from "../enrichment/openaiModels.js";

export interface RecommendationInputRow {
  sectionId: DealFlowStageId;
  propertyId: string;
  displayAddress: string;
  brokerEmail: string | null;
  hasOm: boolean;
  omStatus: string;
  tourScheduledAt: string | null;
  postTourDecision: string | null;
  underwritingReviewRequired: boolean;
  underwritingReviewCompleted: boolean;
  /** When the deal entered its current canonical stage (null pre-migration). */
  stageEnteredAt?: string | null;
  /** Most recent broker outreach send. */
  latestOutreachAt?: string | null;
}

const STALE_OM_REQUEST_DAYS = 10;

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return Math.floor((Date.now() - time) / 86_400_000);
}

const EXAMPLE_LIMIT = 4;

function exampleAddresses(rows: RecommendationInputRow[]): string | null {
  if (rows.length === 0) return null;
  const names = rows.slice(0, EXAMPLE_LIMIT).map((row) => row.displayAddress);
  const remainder = rows.length - names.length;
  return remainder > 0 ? `${names.join(" · ")} +${remainder} more` : names.join(" · ");
}

function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural ?? `${singular}s`;
}

function recommendation(
  id: DealFlowRecommendationKind,
  rows: RecommendationInputRow[],
  title: string,
  stageId: DealFlowStageId | null
): DealFlowRecommendation {
  return {
    id,
    title,
    detail: exampleAddresses(rows),
    count: rows.length,
    stageId,
    propertyIds: rows.map((row) => row.propertyId),
  };
}

const BROKER_EMAIL_STAGES: ReadonlySet<DealFlowStageId> = new Set([
  "sourced",
  "om_requested",
  "underwriting_awaiting_review",
  "underwriting_review_completed",
]);

export function buildRuleBasedRecommendations(rows: RecommendationInputRow[]): DealFlowRecommendation[] {
  const items: DealFlowRecommendation[] = [];

  const tourInputs = rows.filter(
    (row) =>
      row.sectionId === "tour_completed_awaiting_inputs" &&
      (!row.postTourDecision || row.postTourDecision === "pending")
  );
  if (tourInputs.length > 0) {
    items.push(
      recommendation(
        "tour_inputs",
        tourInputs,
        `Add tour outcomes for ${tourInputs.length} ${pluralize(tourInputs.length, "property", "properties")}`,
        "tour_completed_awaiting_inputs"
      )
    );
  }

  const confirmTours = rows.filter((row) => row.sectionId === "tour_requested" && !row.tourScheduledAt);
  if (confirmTours.length > 0) {
    items.push(
      recommendation(
        "confirm_tours",
        confirmTours,
        `Confirm ${confirmTours.length} requested ${pluralize(confirmTours.length, "tour")}`,
        "tour_requested"
      )
    );
  }

  const missingBroker = rows.filter((row) => BROKER_EMAIL_STAGES.has(row.sectionId) && !row.brokerEmail);
  if (missingBroker.length > 0) {
    items.push(
      recommendation(
        "missing_broker_email",
        missingBroker,
        `Add broker emails for ${missingBroker.length} ${pluralize(missingBroker.length, "property", "properties")}`,
        null
      )
    );
  }

  const needsOmRequest = rows.filter(
    (row) =>
      row.sectionId === "sourced" &&
      Boolean(row.brokerEmail) &&
      !row.hasOm &&
      !["requested", "received", "needs_review", "promoted", "completed"].includes(row.omStatus)
  );
  if (needsOmRequest.length > 0) {
    items.push(
      recommendation(
        "request_oms",
        needsOmRequest,
        `Email ${needsOmRequest.length} ${pluralize(needsOmRequest.length, "broker")} to request OMs`,
        "sourced"
      )
    );
  }

  const staleOmRequests = rows.filter((row) => {
    if (row.sectionId !== "om_requested") return false;
    const sinceOutreach = daysSince(row.latestOutreachAt);
    const sinceStage = daysSince(row.stageEnteredAt);
    const age = sinceOutreach ?? sinceStage;
    return age != null && age >= STALE_OM_REQUEST_DAYS;
  });
  if (staleOmRequests.length > 0) {
    items.push(
      recommendation(
        "om_request_stale",
        staleOmRequests,
        `Follow up on ${staleOmRequests.length} stale OM ${pluralize(staleOmRequests.length, "request")} (${STALE_OM_REQUEST_DAYS}+ days quiet)`,
        "om_requested"
      )
    );
  }

  const staleUnderwriting = rows.filter((row) => {
    if (row.sectionId !== "underwriting_awaiting_review") return false;
    const age = daysSince(row.stageEnteredAt);
    return age != null && age >= STAGE_AGING.dangerDays;
  });
  if (staleUnderwriting.length > 0) {
    items.push(
      recommendation(
        "underwriting_stale",
        staleUnderwriting,
        `Clear ${staleUnderwriting.length} underwriting ${pluralize(staleUnderwriting.length, "review")} stuck ${STAGE_AGING.dangerDays}+ days`,
        "underwriting_awaiting_review"
      )
    );
  }

  const underwritingReview = rows.filter(
    (row) =>
      row.sectionId === "underwriting_awaiting_review" &&
      row.underwritingReviewRequired &&
      !row.underwritingReviewCompleted
  );
  if (underwritingReview.length > 0) {
    items.push(
      recommendation(
        "underwriting_review",
        underwritingReview,
        `Review underwriting on ${underwritingReview.length} ${pluralize(underwritingReview.length, "deal")}`,
        "underwriting_awaiting_review"
      )
    );
  }

  const loiFollowup = rows.filter((row) => row.sectionId === "offer_review");
  if (loiFollowup.length > 0) {
    items.push(
      recommendation(
        "loi_followup",
        loiFollowup,
        `Follow up on ${loiFollowup.length} open ${pluralize(loiFollowup.length, "LOI")}`,
        "offer_review"
      )
    );
  }

  return items;
}

function ruleBasedHeadline(items: DealFlowRecommendation[]): string {
  if (items.length === 0) return "All caught up — no pending actions on the board.";
  const totalDeals = new Set(items.flatMap((item) => item.propertyIds)).size;
  return `${items.length} ${pluralize(items.length, "action")} across ${totalDeals} ${pluralize(totalDeals, "deal")} need your attention.`;
}

function getApiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().replace(/^["']|["']$/g, "");
  if (!key || key.length < 10) return null;
  return key;
}

const POLISH_SYSTEM = [
  "You prioritize a real-estate acquisitions to-do list.",
  "You receive JSON: an array of tasks {id, title, count}.",
  'Respond with only a JSON object: {"headline": string, "order": string[]}.',
  "headline: one short sentence (max 18 words) telling the user what matters most right now; plain language, no markdown.",
  "order: every task id exactly once, most urgent first. Blockers that stall deals (missing tour outcomes, unconfirmed tours) outrank data hygiene.",
].join("\n");

type PolishResult = { headline: string; order: DealFlowRecommendationKind[] };

function parsePolishResponse(content: string, validIds: Set<string>): PolishResult | null {
  const trimmed = content.trim().replace(/^```json?\s*|\s*```$/g, "");
  try {
    const parsed = JSON.parse(trimmed) as { headline?: unknown; order?: unknown };
    const headline = typeof parsed.headline === "string" ? parsed.headline.trim() : "";
    const order = Array.isArray(parsed.order) ? parsed.order.filter((id): id is DealFlowRecommendationKind => typeof id === "string" && validIds.has(id)) : [];
    if (!headline || order.length === 0) return null;
    return { headline, order };
  } catch {
    return null;
  }
}

async function polishWithLlm(items: DealFlowRecommendation[]): Promise<PolishResult | null> {
  const key = getApiKey();
  if (!key || items.length === 0) return null;

  const openai = new OpenAI({ apiKey: key });
  try {
    const completion = await openai.chat.completions.create({
      model: getDealScoringModel(),
      messages: [
        { role: "system", content: POLISH_SYSTEM },
        {
          role: "user",
          content: JSON.stringify(items.map(({ id, title, count }) => ({ id, title, count }))),
        },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return null;
    return parsePolishResponse(content, new Set(items.map((item) => item.id)));
  } catch (err) {
    console.warn("[progressRecommendations]", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function buildProgressRecommendations(
  rows: RecommendationInputRow[]
): Promise<DealFlowRecommendationsResponse> {
  const items = buildRuleBasedRecommendations(rows);
  const polished = await polishWithLlm(items);
  const generatedAt = new Date().toISOString();

  if (!polished) {
    return { headline: ruleBasedHeadline(items), items, generatedAt, source: "rules" };
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = polished.order.map((id) => byId.get(id)).filter((item): item is DealFlowRecommendation => Boolean(item));
  for (const item of items) {
    if (!ordered.includes(item)) ordered.push(item);
  }
  return { headline: polished.headline, items: ordered, generatedAt, source: "llm" };
}
