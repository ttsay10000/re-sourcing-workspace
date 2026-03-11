import type { IngestionRun } from "./ingestion.js";

export type PropertyWorkflowState =
  | "new"
  | "eligible_for_outreach"
  | "queued_for_send"
  | "sent_waiting_reply"
  | "review_required"
  | "held"
  | "reply_received"
  | "om_received_manual_review"
  | "not_a_fit"
  | "archived";

export type PropertyDisposition =
  | "active"
  | "held"
  | "not_a_fit"
  | "duplicate_ignore"
  | "do_not_pursue"
  | "archived";

export type RecipientResolutionStatus =
  | "resolved"
  | "missing"
  | "multiple_candidates"
  | "manual_override";

export type PropertyOutreachFlagType =
  | "missing_broker_email"
  | "recipient_history_needs_review"
  | "reply_without_om"
  | "attachment_unsupported"
  | "ambiguous_reply_match"
  | "manual_reconcile_needed";

export type PropertyActionItemType =
  | "choose_recipient"
  | "add_broker_email"
  | "review_thread_conflict"
  | "reply_received_no_om"
  | "upload_om_manually"
  | "confirm_follow_up"
  | "review_parse_failure"
  | "resolve_duplicate";

export type ItemStatus = "open" | "resolved" | "dismissed";

export type OutreachBatchStatus =
  | "queued"
  | "review_required"
  | "sent"
  | "skipped"
  | "failed";

export interface BrokerContact {
  id: string;
  normalizedEmail: string;
  displayName?: string | null;
  firm?: string | null;
  preferredThreadId?: string | null;
  lastOutreachAt?: string | null;
  lastReplyAt?: string | null;
  doNotContactUntil?: string | null;
  manualReviewOnly: boolean;
  notes?: string | null;
  activitySummary?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecipientContactCandidate {
  email: string;
  name?: string | null;
  firm?: string | null;
  contactId?: string | null;
}

export interface RecipientResolution {
  propertyId: string;
  status: RecipientResolutionStatus;
  contactId?: string | null;
  contactEmail?: string | null;
  confidence?: number | null;
  resolutionReason?: string | null;
  candidateContacts: RecipientContactCandidate[];
  createdAt: string;
  updatedAt: string;
}

export interface PropertySourcingState {
  propertyId: string;
  workflowState: PropertyWorkflowState;
  disposition: PropertyDisposition;
  holdReason?: string | null;
  holdNote?: string | null;
  originatingProfileId?: string | null;
  originatingRunId?: string | null;
  latestRunId?: string | null;
  outreachReason?: string | null;
  firstEligibleAt?: string | null;
  lastContactedAt?: string | null;
  lastReplyAt?: string | null;
  manualOmReviewAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyOutreachFlag {
  id: string;
  propertyId: string;
  flagType: PropertyOutreachFlagType | string;
  status: ItemStatus;
  summary?: string | null;
  details?: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt?: string | null;
  updatedAt: string;
}

export interface PropertyActionItem {
  id: string;
  propertyId: string;
  actionType: PropertyActionItemType | string;
  status: ItemStatus;
  priority: "low" | "medium" | "high";
  summary?: string | null;
  details?: Record<string, unknown> | null;
  createdAt: string;
  dueAt?: string | null;
  resolvedAt?: string | null;
  updatedAt: string;
}

export interface OutreachBatchItem {
  id: string;
  batchId: string;
  propertyId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutreachBatch {
  id: string;
  contactId?: string | null;
  toAddress: string;
  status: OutreachBatchStatus | string;
  createdBy: string;
  reviewReason?: string | null;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  sentAt?: string | null;
  metadata?: Record<string, unknown> | null;
  items?: OutreachBatchItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PropertyOutreachSummary {
  sourcingState?: PropertySourcingState | null;
  recipientResolution?: RecipientResolution | null;
  openFlags: PropertyOutreachFlag[];
  openActionItems: PropertyActionItem[];
  lastBatch?: OutreachBatch | null;
}

export interface HomeOperationsSummary {
  needsInputBeforeOm: number;
  readyToAutoSendToday: number;
  awaitingBrokerReply: number;
  replyReceivedManualOmReview: number;
  heldOrDoNotPursue: number;
}

export interface HomeActivityItem {
  id: string;
  eventType: string;
  title: string;
  propertyId?: string | null;
  propertyAddress?: string | null;
  createdAt: string;
}

export type SavedSearchRun = IngestionRun;
