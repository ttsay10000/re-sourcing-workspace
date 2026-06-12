import type { OutreachBatch } from "@re-sourcing/contracts";
import type { InquirySendRepo, OutreachBatchRepo, PropertyActionItemRepo } from "@re-sourcing/db";

/** metadata.kind written by the ui-v2 composer draft POST; automation batches carry no kind. */
export const UI_V2_DRAFT_KIND = "ui_v2_outreach_draft";

/** Queue statuses a saved draft can be acted on from (send or dismiss). */
export const SENDABLE_DRAFT_STATUSES = new Set(["review_required", "failed"]);

export interface UiDraftMetadata {
  subject: string;
  body: string;
  followUpAt: string | null;
  templateId: string | null;
  templateName: string | null;
  draftStatus: string | null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extract the composer draft fields from a batch's metadata.
 * Returns null unless metadata.kind === UI_V2_DRAFT_KIND, so automation
 * review batches (which have no kind) and send-now batches are excluded.
 */
export function readUiDraftMetadata(batch: OutreachBatch): UiDraftMetadata | null {
  const metadata = batch.metadata;
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  if (record.kind !== UI_V2_DRAFT_KIND) return null;
  return {
    subject: readString(record, "subject") ?? "",
    body: readString(record, "body") ?? "",
    followUpAt: readString(record, "followUpAt"),
    templateId: readString(record, "templateId"),
    templateName: readString(record, "templateName"),
    draftStatus: readString(record, "draftStatus"),
  };
}

export interface SendExistingDraftDeps {
  sendMessage(to: string, subject: string, body: string): Promise<{ id: string; threadId: string | null }>;
  outreachRepo: Pick<OutreachBatchRepo, "updateStatus">;
  inquirySendRepo: Pick<InquirySendRepo, "create">;
  actionItemRepo: Pick<PropertyActionItemRepo, "upsertOpen">;
}

export interface SendExistingDraftResult {
  messageId: string;
  threadId: string | null;
  sentAt: string;
}

export interface SendExistingDraftOptions {
  /** send_mode recorded on the inquiry row. */
  inquirySendMode?: string;
  /** sendMode recorded in the follow-up action item details. */
  followUpSendMode?: string;
}

/**
 * Send a saved draft batch via Gmail and record the outcome.
 * The batch is marked sent before the inquiry row is written (mirroring the
 * automation sender) so a bookkeeping failure can never leave a batch marked
 * failed after the email actually left.
 */
export async function sendExistingDraftBatch(
  deps: SendExistingDraftDeps,
  batch: OutreachBatch,
  meta: UiDraftMetadata,
  propertyId: string,
  options?: SendExistingDraftOptions
): Promise<SendExistingDraftResult> {
  const result = await deps.sendMessage(batch.toAddress, meta.subject, meta.body);
  const sentAt = new Date().toISOString();
  await deps.outreachRepo.updateStatus(batch.id, {
    status: "sent",
    gmailMessageId: result.id,
    gmailThreadId: result.threadId,
    sentAt,
    metadata: { draftStatus: "sent" },
  });
  try {
    await deps.inquirySendRepo.create(propertyId, result.id, {
      toAddress: batch.toAddress,
      source: "gmail_api",
      gmailThreadId: result.threadId,
      batchId: batch.id,
      sendMode: options?.inquirySendMode ?? "ui_v2_draft_send",
      sentAt,
    });
  } catch (err) {
    console.warn("[outreach-draft-queue inquiry record]", err);
  }
  if (meta.followUpAt) {
    await deps.actionItemRepo.upsertOpen(propertyId, "confirm_follow_up", {
      priority: "medium",
      summary: "Follow up with broker",
      details: {
        contactId: batch.contactId ?? null,
        draftId: batch.id,
        source: "ui-v2",
        sendMode: options?.followUpSendMode ?? "draft_send",
      },
      dueAt: meta.followUpAt,
    });
  }
  return { messageId: result.id, threadId: result.threadId, sentAt };
}
