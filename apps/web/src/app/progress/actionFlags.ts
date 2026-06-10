/**
 * Deterministic workflow intelligence for the Deal Progress board.
 *
 * Pure functions that turn a board row + its stage into:
 *  - ActionFlags (what's wrong / what to do / when it's due),
 *  - SLA aging labels,
 *  - the OM follow-up cadence state,
 *  - a per-property data-completeness score,
 *  - the one-click primary CTA per card,
 *  - the "Today's Deal Actions" summary counts, and
 *  - per-column header stats.
 *
 * No fetching, no JSX, no side effects — the page owns all of that. LLM
 * recommendations (server-side) only re-phrase/prioritize; nothing here
 * auto-moves or auto-rejects a deal.
 */

import { DEAL_FLOW_STAGES, type DealFlowStageId } from "@re-sourcing/contracts";
import type { UiV2DealPathState } from "@re-sourcing/contracts";

const DAY_MS = 86_400_000;

/** Subset of the board's DealFlowRow that the rules read (all optional-safe). */
export type FlagInputRow = {
  propertyId: string;
  canonicalAddress?: string | null;
  displayAddress?: string | null;
  price?: number | null;
  units?: number | null;
  sqft?: number | null;
  pricePerSqft?: number | null;
  dealScore?: number | null;
  ltrYocPct?: number | null;
  mtrYocPct?: number | null;
  status?: string | null;
  omStatus?: string | null;
  hasOm?: boolean;
  hasComps?: boolean;
  hasDossier?: boolean;
  underwritingReviewRequired?: boolean;
  underwritingReviewCompleted?: boolean;
  dealPath?: UiV2DealPathState | null;
  openActionItemCount?: number | null;
  brokerName?: string | null;
  brokerEmail?: string | null;
  stageEnteredAt?: string | null;
  latestOutreachAt?: string | null;
  updatedAt?: string | null;
};

export type ActionFlagType =
  | "email_needed"
  | "follow_up_due"
  | "missing_contact"
  | "missing_document"
  | "underwriting_review"
  | "tour_scheduling"
  | "tour_prep"
  | "post_tour_notes"
  | "loi_follow_up"
  | "loi_copy_missing"
  | "counter_received"
  | "stale_deal"
  | "likely_reject"
  | "missing_inputs";

export type FlagSeverity = "low" | "medium" | "high";

/** How the UI should respond when the flag (or its CTA) is clicked. */
export type FlagActionKind =
  | "compose_email"
  | "request_om"
  | "add_broker_email"
  | "open_inputs"
  | "schedule_tour"
  | "complete_tour"
  | "update_loi"
  | "review_underwriting"
  | "move_stage"
  | "reject";

export type ActionFlag = {
  propertyId: string;
  type: ActionFlagType;
  severity: FlagSeverity;
  /** Short chip text, e.g. "Follow-up due". */
  label: string;
  /** One-sentence explanation shown in tooltips and the drawer. */
  reason: string;
  /** Days until due; negative = overdue by N days. Omitted when not time-based. */
  dueInDays?: number;
  /** CTA text, e.g. "Send follow-up". */
  recommendedAction: string;
  actionKind: FlagActionKind;
  /** True when resolving the flag means sending an email (Email Queue eligible). */
  email: boolean;
};

export type ComputeFlagOptions = {
  now?: number;
};

const SEVERITY_RANK: Record<FlagSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Lower = more urgent; for sorting queues. */
export function severityRank(severity: FlagSeverity): number {
  return SEVERITY_RANK[severity];
}

export const STAGE_LABEL_BY_ID: ReadonlyMap<string, string> = new Map(
  DEAL_FLOW_STAGES.map((stage) => [stage.id, stage.label])
);

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return Math.floor((now - time) / DAY_MS);
}

export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return Math.floor((time - now) / DAY_MS);
}

export function stageAgeDays(row: FlagInputRow, now = Date.now()): number | null {
  return daysSince(row.stageEnteredAt, now);
}

/** "due today" / "overdue 3d" / "due in 2d" */
export function formatDue(dueInDays: number | undefined): string | null {
  if (dueInDays == null) return null;
  if (dueInDays === 0) return "due today";
  if (dueInDays < 0) return `overdue ${Math.abs(dueInDays)}d`;
  return `due in ${dueInDays}d`;
}

/* ── OM follow-up cadence (§9): day 0 initial, 2–3 first, 5–7 second, 10–14 final, 30 revisit ── */

export type FollowUpState = {
  /** Last broker touch (outreach send, else stage entry). */
  lastTouchAt: string | null;
  lastTouchDays: number | null;
  /** Which cadence step is next (1-based); 0 = initial request not sent. */
  nextStep: number;
  nextStepLabel: string;
  /** Days until the next touch is due (negative = overdue). */
  dueInDays: number | null;
};

/** A follow-up is due this many days after the last broker touch. */
const FOLLOW_UP_GAP_DAYS = 3;
const CADENCE_LABELS = ["First follow-up", "Second follow-up", "Final check-in"] as const;
const STALE_REENGAGE_DAYS = 30;

export function followUpState(row: FlagInputRow, now = Date.now()): FollowUpState {
  const lastTouchAt = row.latestOutreachAt ?? null;
  if (!lastTouchAt) {
    const age = stageAgeDays(row, now);
    return {
      lastTouchAt: null,
      lastTouchDays: null,
      nextStep: 0,
      nextStepLabel: "Initial OM request",
      // SLA: initial request within 2 days of entering the stage.
      dueInDays: age == null ? 0 : 2 - age,
    };
  }
  const since = daysSince(lastTouchAt, now) ?? 0;
  // Each send resets the clock: the next touch is due FOLLOW_UP_GAP_DAYS after
  // the last one. The label escalates with total quiet time (≈ day 3 / 7 / 14
  // of the spec cadence when no reply ever lands).
  const stepIndex = since >= 14 ? 2 : since >= 7 ? 1 : 0;
  return {
    lastTouchAt,
    lastTouchDays: since,
    nextStep: stepIndex + 1,
    nextStepLabel: CADENCE_LABELS[stepIndex],
    dueInDays: FOLLOW_UP_GAP_DAYS - since,
  };
}

/* ── Flag rules per stage (§7, §10, §14) ─────────────────────────────────── */

function flag(
  row: FlagInputRow,
  type: ActionFlagType,
  severity: FlagSeverity,
  label: string,
  reason: string,
  recommendedAction: string,
  actionKind: FlagActionKind,
  options?: { dueInDays?: number; email?: boolean }
): ActionFlag {
  return {
    propertyId: row.propertyId,
    type,
    severity,
    label,
    reason,
    recommendedAction,
    actionKind,
    email: options?.email ?? false,
    ...(options?.dueInDays != null ? { dueInDays: options.dueInDays } : {}),
  };
}

function omAlreadyRequested(row: FlagInputRow): boolean {
  const status = String(row.omStatus ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ["requested", "received", "needs_review", "promoted", "complete", "completed"].includes(status);
}

function missingCoreInputs(row: FlagInputRow): string[] {
  const missing: string[] = [];
  if (row.price == null) missing.push("ask price");
  if (row.units == null) missing.push("units");
  if (row.sqft == null) missing.push("SF");
  return missing;
}

const LOW_LTR_YIELD_PCT = 4.5;
const LOW_MTR_YIELD_PCT = 6;
const LIKELY_REJECT_SCORE = 35;

function sourcedFlags(row: FlagInputRow, now: number): ActionFlag[] {
  const flags: ActionFlag[] = [];
  const age = stageAgeDays(row, now) ?? 0;
  if (!row.brokerEmail) {
    flags.push(
      flag(row, "missing_contact", "high", "No broker email", "No broker contact on file, so the OM request cannot be sent.", "Add broker email", "add_broker_email", { email: true })
    );
  } else if (!omAlreadyRequested(row) && !row.hasOm && row.latestOutreachAt == null) {
    const dueInDays = 2 - age; // SLA: sourced without OM request → 2 days
    flags.push(
      flag(
        row,
        "email_needed",
        dueInDays < -2 ? "high" : "medium",
        "OM not requested",
        `Broker contact exists but no OM request has been sent (${age}d in Sourced).`,
        "Request OM",
        "request_om",
        { dueInDays, email: true }
      )
    );
  }
  const missing = missingCoreInputs(row);
  if (missing.length > 0) {
    flags.push(
      flag(row, "missing_inputs", "low", `Missing ${missing[0]}`, `Listing is missing ${missing.join(", ")} — quick screen is unreliable.`, "Add missing data", "open_inputs")
    );
  }
  return flags;
}

function omRequestedFlags(row: FlagInputRow, now: number): ActionFlag[] {
  const flags: ActionFlag[] = [];
  if (row.hasOm) {
    flags.push(
      flag(row, "underwriting_review", "medium", "OM on file", "An OM is already attached but the deal still sits in OM Requested.", "Move to UW review", "move_stage")
    );
  }
  if (!row.brokerEmail) {
    flags.push(
      flag(row, "missing_contact", "high", "No broker email", "Follow-ups are blocked — no broker email on file.", "Add broker email", "add_broker_email", { email: true })
    );
    return flags;
  }
  const cadence = followUpState(row, now);
  if (cadence.nextStep === 0) {
    flags.push(
      flag(row, "email_needed", "high", "OM request not sent", "Deal is in OM Requested but no outreach email has been logged.", "Send OM request", "request_om", {
        ...(cadence.dueInDays != null ? { dueInDays: cadence.dueInDays } : {}),
        email: true,
      })
    );
  } else if (cadence.lastTouchDays != null && cadence.lastTouchDays >= STALE_REENGAGE_DAYS) {
    flags.push(
      flag(row, "stale_deal", "medium", "30d+ quiet", `No broker touch in ${cadence.lastTouchDays} days — re-engage if still attractive, otherwise pass.`, "Re-engage broker", "compose_email", { email: true })
    );
  } else if (cadence.dueInDays != null && cadence.dueInDays <= 0) {
    const overdue = Math.abs(cadence.dueInDays);
    const severity: FlagSeverity = cadence.nextStep >= 3 || overdue >= 3 ? "high" : "medium";
    flags.push(
      flag(
        row,
        "follow_up_due",
        severity,
        cadence.nextStep >= 3 ? "Final check-in due" : cadence.nextStep === 2 ? "2nd follow-up due" : "Follow-up due",
        `${cadence.nextStepLabel} is due — last touch ${cadence.lastTouchDays ?? "?"}d ago, no reply logged.`,
        "Send follow-up",
        "compose_email",
        { dueInDays: cadence.dueInDays, email: true }
      )
    );
  }
  return flags;
}

function underwritingAwaitingReviewFlags(row: FlagInputRow, now: number): ActionFlag[] {
  const flags: ActionFlag[] = [];
  const age = stageAgeDays(row, now) ?? 0;
  const reviewDue = 2 - age; // SLA: review within 2 days
  flags.push(
    flag(
      row,
      "underwriting_review",
      age >= 2 ? "high" : "medium",
      age >= 2 ? `Review stale ${age}d` : "Review due",
      age >= 2
        ? `Underwriting has been waiting on user review for ${age} days.`
        : "Underwriting output needs a user review before the deal can advance.",
      "Review underwriting",
      "review_underwriting",
      { dueInDays: reviewDue }
    )
  );

  const ltr = row.ltrYocPct ?? null;
  const mtr = row.mtrYocPct ?? null;
  if (ltr != null && mtr != null && ltr < LOW_LTR_YIELD_PCT && mtr < LOW_MTR_YIELD_PCT) {
    flags.push(
      flag(row, "likely_reject", "high", "Likely reject — weak yields", `LTR ${ltr.toFixed(1)}% and MTR ${mtr.toFixed(1)}% are both below buy-box thresholds (${LOW_LTR_YIELD_PCT}% / ${LOW_MTR_YIELD_PCT}%).`, "Reject deal", "reject")
    );
  } else if (row.dealScore != null && row.dealScore < LIKELY_REJECT_SCORE) {
    flags.push(
      flag(row, "likely_reject", "high", `Likely reject — score ${Math.round(row.dealScore)}`, `Deal score ${Math.round(row.dealScore)} is below the reject threshold (${LIKELY_REJECT_SCORE}).`, "Reject deal", "reject")
    );
  } else if (ltr != null && ltr < LOW_LTR_YIELD_PCT) {
    flags.push(
      flag(row, "likely_reject", "medium", "Low LTR yield", `LTR yield ${ltr.toFixed(1)}% is below the ${LOW_LTR_YIELD_PCT}% threshold.`, "Review underwriting", "review_underwriting")
    );
  } else if (mtr != null && mtr < LOW_MTR_YIELD_PCT) {
    flags.push(
      flag(row, "likely_reject", "medium", "Low MTR yield", `MTR yield ${mtr.toFixed(1)}% is below the ${LOW_MTR_YIELD_PCT}% threshold.`, "Review underwriting", "review_underwriting")
    );
  } else if (ltr != null && mtr != null && mtr < ltr) {
    flags.push(
      flag(row, "likely_reject", "low", "MTR under LTR", `MTR yield ${mtr.toFixed(1)}% underperforms LTR ${ltr.toFixed(1)}% — the MTR strategy adds no spread.`, "Review underwriting", "review_underwriting")
    );
  }

  const missing = missingCoreInputs(row);
  if (missing.length > 0) {
    flags.push(
      flag(row, "missing_inputs", "medium", "Missing inputs", `Underwriting is missing ${missing.join(", ")}.`, "Update inputs", "open_inputs")
    );
  }
  if (!row.hasComps) {
    flags.push(
      flag(row, "missing_document", "low", "No comps", "No comp package is attached to support the underwriting.", "Request comps", "compose_email", { email: true })
    );
  }
  return flags;
}

function reviewCompletedFlags(row: FlagInputRow, now: number): ActionFlag[] {
  const flags: ActionFlag[] = [];
  const age = stageAgeDays(row, now) ?? 0;
  if (age >= 2) {
    flags.push(
      flag(row, "stale_deal", age >= 5 ? "high" : "medium", "No next step", `Review completed ${age}d ago with no decision — request a tour, draft an LOI, or reject.`, "Choose next step", "move_stage", { dueInDays: 2 - age })
    );
  }
  const attractive = (row.dealScore ?? 0) >= 60 || (row.mtrYocPct ?? 0) >= 8;
  if (attractive) {
    flags.push(
      flag(row, "tour_scheduling", "low", "Tour candidate", "Strong reviewed deal with no tour requested yet.", "Request tour", "move_stage")
    );
  }
  return flags;
}

function tourRequestedFlags(row: FlagInputRow, now: number): ActionFlag[] {
  const age = stageAgeDays(row, now) ?? 0;
  const overdue = age >= 2; // SLA: unconfirmed tour request → 2 days
  return [
    flag(
      row,
      "tour_scheduling",
      overdue ? "high" : "medium",
      overdue ? `Unconfirmed ${age}d` : "Confirm tour",
      overdue
        ? `Tour requested ${age}d ago and the broker has not confirmed a time.`
        : "Tour requested — send availability and confirm a date with the broker.",
      row.brokerEmail ? "Send availability" : "Add broker email",
      row.brokerEmail ? "compose_email" : "add_broker_email",
      { dueInDays: 2 - age, email: true }
    ),
  ];
}

function tourScheduledFlags(row: FlagInputRow, now: number): ActionFlag[] {
  const flags: ActionFlag[] = [];
  const untilTour = daysUntil(row.dealPath?.tourScheduledAt ?? null, now);
  if (untilTour != null && untilTour <= 1 && untilTour >= 0) {
    flags.push(
      flag(row, "tour_prep", "high", untilTour === 0 ? "Tour within 24h" : "Tour tomorrow", "Tour is coming up — review the deal snapshot, open questions, and items to inspect.", "Open tour prep", "open_inputs", { dueInDays: untilTour })
    );
  }
  return flags;
}

function tourCompletedFlags(row: FlagInputRow, now: number): ActionFlag[] {
  const flags: ActionFlag[] = [];
  const decision = row.dealPath?.postTourDecision ?? null;
  const hasNotes = Boolean(row.dealPath?.tourNotes?.trim());
  if (!decision || decision === "pending" || !hasNotes) {
    const tourDays = daysSince(row.dealPath?.tourCompletedAt ?? row.dealPath?.tourScheduledAt ?? row.stageEnteredAt, now) ?? 0;
    flags.push(
      flag(
        row,
        "post_tour_notes",
        "high",
        !hasNotes ? "Tour notes missing" : "Post-tour decision missing",
        `Tour completed${tourDays > 0 ? ` ${tourDays}d ago` : ""} — capture notes, condition, and a go/no-go decision before knowledge is lost.`,
        "Add tour outcomes",
        "complete_tour",
        { dueInDays: -tourDays }
      )
    );
  }
  const tourCompletedAt = row.dealPath?.tourCompletedAt ?? null;
  const tourMs = tourCompletedAt ? new Date(tourCompletedAt).getTime() : NaN;
  const outreachMs = row.latestOutreachAt ? new Date(row.latestOutreachAt).getTime() : NaN;
  const followUpSent = Number.isFinite(tourMs) && Number.isFinite(outreachMs) && outreachMs >= tourMs;
  if (tourCompletedAt && !followUpSent && row.brokerEmail) {
    flags.push(
      flag(row, "email_needed", "medium", "Post-tour follow-up", "No follow-up email has gone to the broker since the tour.", "Send follow-up", "compose_email", { email: true })
    );
  }
  return flags;
}

function offerReviewFlags(row: FlagInputRow, now: number): ActionFlag[] {
  const flags: ActionFlag[] = [];
  const offerAmount = row.dealPath?.offerAmount ?? null;
  const hasOfferContext = offerAmount != null || Boolean(row.dealPath?.offerNotes?.trim());
  if (!hasOfferContext) {
    flags.push(
      flag(row, "loi_copy_missing", "high", "LOI terms missing", "Deal sits in LOI Offered without an offer amount, notes, or an attached LOI copy.", "Complete LOI terms", "update_loi")
    );
  }
  const lastTouch = row.latestOutreachAt ?? row.dealPath?.updatedAt ?? row.stageEnteredAt;
  const since = daysSince(lastTouch, now);
  if (since != null && since >= 3) {
    flags.push(
      flag(row, "loi_follow_up", since >= 7 ? "high" : "medium", "LOI follow-up due", `LOI out with no logged response for ${since} days.`, row.brokerEmail ? "Send follow-up" : "Add broker email", row.brokerEmail ? "compose_email" : "add_broker_email", { dueInDays: 3 - since, email: true })
    );
  }
  return flags;
}

function negotiationFlags(row: FlagInputRow, now: number): ActionFlag[] {
  const age = stageAgeDays(row, now) ?? 0;
  return [
    flag(
      row,
      "counter_received",
      age >= 2 ? "high" : "medium",
      "Decision needed",
      age >= 2
        ? `Negotiation idle for ${age}d — log the latest counter and decide on the response.`
        : "Track the counter and decide: revise the offer, hold, or walk.",
      "Record counter",
      "open_inputs",
      { dueInDays: 2 - age }
    ),
  ];
}

const EMAIL_FLAG_TYPES: ReadonlySet<ActionFlagType> = new Set([
  "email_needed",
  "follow_up_due",
  "missing_contact",
  "loi_follow_up",
]);

export function computeRowFlags(sectionId: string, row: FlagInputRow, options?: ComputeFlagOptions): ActionFlag[] {
  const now = options?.now ?? Date.now();
  let flags: ActionFlag[];
  switch (sectionId as DealFlowStageId) {
    case "sourced":
      flags = sourcedFlags(row, now);
      break;
    case "om_requested":
      flags = omRequestedFlags(row, now);
      break;
    case "underwriting_awaiting_review":
      flags = underwritingAwaitingReviewFlags(row, now);
      break;
    case "underwriting_review_completed":
      flags = reviewCompletedFlags(row, now);
      break;
    case "tour_requested":
      flags = tourRequestedFlags(row, now);
      break;
    case "tour_scheduled":
      flags = tourScheduledFlags(row, now);
      break;
    case "tour_completed_awaiting_inputs":
      flags = tourCompletedFlags(row, now);
      break;
    case "offer_review":
      flags = offerReviewFlags(row, now);
      break;
    case "negotiation":
      flags = negotiationFlags(row, now);
      break;
    default:
      flags = [];
  }
  return flags.sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
      (left.dueInDays ?? 99) - (right.dueInDays ?? 99)
  );
}

export function primaryFlag(flags: ActionFlag[] | undefined): ActionFlag | null {
  return flags?.[0] ?? null;
}

export function isEmailFlag(item: ActionFlag): boolean {
  return item.email || EMAIL_FLAG_TYPES.has(item.type);
}

/* ── One-click primary CTA per card (§13) ────────────────────────────────── */

export type PrimaryCta = { label: string; actionKind: FlagActionKind };

const STAGE_DEFAULT_CTA: Record<string, PrimaryCta> = {
  sourced: { label: "Request OM", actionKind: "request_om" },
  om_requested: { label: "Follow up", actionKind: "compose_email" },
  underwriting_awaiting_review: { label: "Review underwriting", actionKind: "review_underwriting" },
  underwriting_review_completed: { label: "Choose next step", actionKind: "move_stage" },
  tour_requested: { label: "Confirm tour", actionKind: "schedule_tour" },
  tour_scheduled: { label: "Mark toured", actionKind: "complete_tour" },
  tour_completed_awaiting_inputs: { label: "Add tour outcomes", actionKind: "complete_tour" },
  offer_review: { label: "Update LOI", actionKind: "update_loi" },
  negotiation: { label: "Record counter", actionKind: "open_inputs" },
  contract_signed: { label: "Update inputs", actionKind: "open_inputs" },
  deal_closed: { label: "Update inputs", actionKind: "open_inputs" },
};

export function primaryCtaForRow(sectionId: string, row: FlagInputRow, flags: ActionFlag[] | undefined): PrimaryCta {
  const top = primaryFlag(flags);
  if (top && top.severity !== "low") {
    return { label: top.recommendedAction, actionKind: top.actionKind };
  }
  if (sectionId === "sourced" && !row.brokerEmail) {
    return { label: "Add broker email", actionKind: "add_broker_email" };
  }
  if (sectionId === "om_requested" && !row.brokerEmail) {
    return { label: "Add broker email", actionKind: "add_broker_email" };
  }
  return STAGE_DEFAULT_CTA[sectionId] ?? { label: "Update inputs", actionKind: "open_inputs" };
}

/* ── Data completeness (§15) ─────────────────────────────────────────────── */

export type CompletenessItem = { key: string; label: string; done: boolean };

export type Completeness = {
  items: CompletenessItem[];
  done: number;
  total: number;
  /** Highest-impact missing item label, e.g. "Broker email". */
  topMissing: string | null;
};

const STAGE_INDEX: ReadonlyMap<string, number> = new Map(DEAL_FLOW_STAGES.map((stage, index) => [stage.id, index]));

export function dataCompleteness(sectionId: string, row: FlagInputRow): Completeness {
  const stageIndex = STAGE_INDEX.get(sectionId) ?? 0;
  const tourIndex = STAGE_INDEX.get("tour_requested") ?? 4;
  const tourDoneIndex = STAGE_INDEX.get("tour_completed_awaiting_inputs") ?? 6;
  const loiIndex = STAGE_INDEX.get("offer_review") ?? 7;
  const items: CompletenessItem[] = [
    { key: "price", label: "Ask price", done: row.price != null },
    { key: "sqft", label: "Square feet", done: row.sqft != null },
    { key: "units", label: "Units", done: row.units != null },
    { key: "broker", label: "Broker email", done: Boolean(row.brokerEmail) },
    { key: "om", label: "OM", done: row.hasOm === true },
    { key: "comps", label: "Comps", done: row.hasComps === true },
    { key: "dossier", label: "Dossier", done: row.hasDossier === true },
    { key: "review", label: "UW review", done: row.underwritingReviewCompleted === true },
  ];
  if (stageIndex >= tourIndex) {
    items.push({ key: "tour_date", label: "Tour date", done: Boolean(row.dealPath?.tourScheduledAt) });
  }
  if (stageIndex >= tourDoneIndex) {
    items.push({ key: "tour_notes", label: "Tour notes", done: Boolean(row.dealPath?.tourNotes?.trim()) });
  }
  if (stageIndex >= loiIndex) {
    items.push({ key: "loi", label: "LOI terms", done: row.dealPath?.offerAmount != null });
  }
  const done = items.filter((item) => item.done).length;
  const missingOrder = ["broker", "om", "loi", "tour_notes", "tour_date", "price", "review", "comps", "units", "sqft", "dossier"];
  const topMissing =
    missingOrder
      .map((key) => items.find((item) => item.key === key && !item.done))
      .find((item) => item != null)?.label ?? null;
  return { items, done, total: items.length, topMissing };
}

/* ── Email Queue (§8) ────────────────────────────────────────────────────── */

export type EmailQueueItem = {
  propertyId: string;
  address: string;
  stageId: string;
  stageLabel: string;
  brokerName: string | null;
  brokerEmail: string | null;
  flag: ActionFlag;
  emailTypeLabel: string;
  lastTouchAt: string | null;
  suggestedSubject: string;
  /** Email nags muted for this property (still listed under "show snoozed"). */
  snoozed: boolean;
};

const EMAIL_TYPE_LABELS: Partial<Record<ActionFlagType, string>> = {
  email_needed: "OM request",
  follow_up_due: "OM follow-up",
  missing_contact: "Needs broker email",
  loi_follow_up: "LOI follow-up",
  tour_scheduling: "Tour availability",
  stale_deal: "Re-engagement",
  missing_document: "Document request",
};

function streetOnly(address: string): string {
  const street = address.split(",")[0]?.trim();
  return street || address;
}

export function suggestedSubjectFor(flagItem: ActionFlag, address: string): string {
  const street = streetOnly(address);
  switch (flagItem.type) {
    case "email_needed":
      return flagItem.actionKind === "request_om" ? `OM request — ${street}` : `Following up — ${street}`;
    case "follow_up_due":
      return `Following up on ${street}`;
    case "loi_follow_up":
      return `LOI follow-up — ${street}`;
    case "tour_scheduling":
      return `Tour availability — ${street}`;
    case "stale_deal":
      return `Checking back in — ${street}`;
    case "missing_document":
      return `Document request — ${street}`;
    default:
      return street;
  }
}

/** Email queue exclusion: OM on file + UW review done means we're already in
 *  contact with the broker — nagging to email again is noise. */
export function excludedFromEmailQueue(row: FlagInputRow): boolean {
  return row.hasOm === true && row.underwritingReviewCompleted === true;
}

export function buildEmailQueue(
  sections: Array<{ id: string; rows?: FlagInputRow[] | null }>,
  flagsByProperty: ReadonlyMap<string, ActionFlag[]>,
  snoozedIds?: ReadonlySet<string>
): EmailQueueItem[] {
  const items: EmailQueueItem[] = [];
  for (const section of sections) {
    for (const row of section.rows ?? []) {
      if (excludedFromEmailQueue(row)) continue;
      // Properties without a broker email live in the Flags queue instead.
      if (!row.brokerEmail) continue;
      const flags = flagsByProperty.get(row.propertyId) ?? [];
      const emailFlag = flags.find(isEmailFlag);
      if (!emailFlag) continue;
      const address = row.displayAddress || row.canonicalAddress || row.propertyId;
      items.push({
        propertyId: row.propertyId,
        address,
        stageId: section.id,
        stageLabel: STAGE_LABEL_BY_ID.get(section.id) ?? section.id,
        brokerName: row.brokerName ?? null,
        brokerEmail: row.brokerEmail ?? null,
        flag: emailFlag,
        emailTypeLabel: EMAIL_TYPE_LABELS[emailFlag.type] ?? emailFlag.label,
        lastTouchAt: row.latestOutreachAt ?? null,
        suggestedSubject: suggestedSubjectFor(emailFlag, address),
        snoozed: snoozedIds?.has(row.propertyId) ?? false,
      });
    }
  }
  return items.sort(
    (left, right) =>
      Number(left.snoozed) - Number(right.snoozed) ||
      SEVERITY_RANK[left.flag.severity] - SEVERITY_RANK[right.flag.severity] ||
      (left.flag.dueInDays ?? 99) - (right.flag.dueInDays ?? 99)
  );
}

/* ── Flags queue: every property without a broker email attached ─────────── */

export type FlaggedContactItem = {
  propertyId: string;
  address: string;
  stageId: string;
  stageLabel: string;
  /** Existing missing_contact flag when the stage rules raised one. */
  flag: ActionFlag | null;
  ageDays: number | null;
};

export function buildFlagsQueue(
  sections: Array<{ id: string; rows?: FlagInputRow[] | null }>,
  flagsByProperty: ReadonlyMap<string, ActionFlag[]>,
  now = Date.now()
): FlaggedContactItem[] {
  const items: FlaggedContactItem[] = [];
  for (const section of sections) {
    for (const row of section.rows ?? []) {
      if (row.brokerEmail) continue;
      const flags = flagsByProperty.get(row.propertyId) ?? [];
      items.push({
        propertyId: row.propertyId,
        address: row.displayAddress || row.canonicalAddress || row.propertyId,
        stageId: section.id,
        stageLabel: STAGE_LABEL_BY_ID.get(section.id) ?? section.id,
        flag: flags.find((item) => item.type === "missing_contact") ?? null,
        ageDays: stageAgeDays(row, now),
      });
    }
  }
  return items.sort((left, right) => (right.ageDays ?? 0) - (left.ageDays ?? 0));
}

/* ── Action summary strip (§11) ──────────────────────────────────────────── */

export type SummaryActionKind = "focus" | "email_queue" | "broker_stepper" | "followup_stepper" | "needs_action";

export type ActionSummaryItem = {
  id: string;
  label: string;
  count: number;
  severity: FlagSeverity;
  propertyIds: string[];
  stageId: string | null;
  action: SummaryActionKind;
};

export function buildActionSummary(
  sections: Array<{ id: string; rows?: FlagInputRow[] | null }>,
  flagsByProperty: ReadonlyMap<string, ActionFlag[]>
): ActionSummaryItem[] {
  const collect = (predicate: (item: ActionFlag, row: FlagInputRow) => boolean): { ids: string[]; stageIds: Set<string> } => {
    const ids: string[] = [];
    const stageIds = new Set<string>();
    for (const section of sections) {
      for (const row of section.rows ?? []) {
        const flags = flagsByProperty.get(row.propertyId) ?? [];
        if (flags.some((item) => predicate(item, row))) {
          ids.push(row.propertyId);
          stageIds.add(section.id);
        }
      }
    }
    return { ids, stageIds };
  };

  const candidates: Array<ActionSummaryItem | null> = [];
  const push = (
    id: string,
    label: (count: number) => string,
    severity: FlagSeverity,
    action: SummaryActionKind,
    predicate: (item: ActionFlag, row: FlagInputRow) => boolean
  ) => {
    const { ids, stageIds } = collect(predicate);
    if (ids.length === 0) {
      candidates.push(null);
      return;
    }
    candidates.push({
      id,
      label: label(ids.length),
      count: ids.length,
      severity,
      propertyIds: ids,
      stageId: stageIds.size === 1 ? [...stageIds][0] : null,
      action,
    });
  };

  push(
    "emails_due",
    (n) => `${n} email${n === 1 ? "" : "s"} due`,
    "high",
    "email_queue",
    (item, row) => isEmailFlag(item) && item.type !== "missing_contact" && Boolean(row.brokerEmail) && !excludedFromEmailQueue(row)
  );
  push("missing_broker", (n) => `${n} missing broker email`, "high", "broker_stepper", (item, row) => item.type === "missing_contact" || !row.brokerEmail);
  push("post_tour", (n) => `${n} tour outcome${n === 1 ? "" : "s"} missing`, "high", "focus", (item) => item.type === "post_tour_notes");
  push("uw_stale", (n) => `${n} UW review${n === 1 ? "" : "s"} stale`, "medium", "focus", (item) => item.type === "underwriting_review" && (item.dueInDays ?? 0) < 0);
  push("likely_reject", (n) => `${n} likely reject${n === 1 ? "" : "s"}`, "medium", "focus", (item) => item.type === "likely_reject" && item.severity === "high");
  push("tours", (n) => `${n} tour${n === 1 ? "" : "s"} to confirm`, "medium", "focus", (item) => item.type === "tour_scheduling" && item.severity !== "low");
  push("loi_missing", (n) => `${n} LOI missing terms`, "high", "focus", (item) => item.type === "loi_copy_missing");
  push("loi_followup", (n) => `${n} LOI follow-up${n === 1 ? "" : "s"}`, "medium", "email_queue", (item) => item.type === "loi_follow_up");
  push("stale", (n) => `${n} stale deal${n === 1 ? "" : "s"}`, "low", "needs_action", (item) => item.type === "stale_deal");

  return candidates.filter((item): item is ActionSummaryItem => item != null);
}

/* ── Column header stats (§12) ───────────────────────────────────────────── */

export type ColumnStats = {
  count: number;
  askTotal: number;
  actionCount: number;
  staleCount: number;
};

export function columnStats(
  rows: FlagInputRow[],
  flagsByProperty: ReadonlyMap<string, ActionFlag[]>,
  now = Date.now()
): ColumnStats {
  let askTotal = 0;
  let actionCount = 0;
  let staleCount = 0;
  for (const row of rows) {
    askTotal += row.price ?? 0;
    const flags = flagsByProperty.get(row.propertyId) ?? [];
    if (flags.some((item) => item.severity !== "low")) actionCount += 1;
    const age = stageAgeDays(row, now);
    if (age != null && age >= 7) staleCount += 1;
  }
  return { count: rows.length, askTotal, actionCount, staleCount };
}

/* ── Derived activity timeline for the drawer (§16D) ─────────────────────── */

export type TimelineEvent = { at: string; label: string };

export function deriveTimeline(row: FlagInputRow): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const add = (at: string | null | undefined, label: string) => {
    if (!at) return;
    const time = new Date(at).getTime();
    if (Number.isNaN(time)) return;
    events.push({ at, label });
  };
  add(row.stageEnteredAt, "Entered current stage");
  add(row.latestOutreachAt, "Last broker email sent");
  add(row.dealPath?.tourScheduledAt, "Tour scheduled");
  add(row.dealPath?.tourCompletedAt, "Tour completed");
  add(row.dealPath?.updatedAt, "Deal path updated");
  add(row.updatedAt, "Record updated");
  return events.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}
