/**
 * Process inbox: list Gmail messages, match by (1) subject address, (2) broker-on-record From email,
 * or (3) same thread as our sent inquiry (covers broker alternate emails or batched broker replies).
 * Upsert email (idempotent by message_id), persist attachments, and sync sourcing workflow state.
 */

import type { Pool } from "pg";
import {
  getPool,
  PropertyRepo,
  InquiryEmailRepo,
  InquiryDocumentRepo,
  InquirySendRepo,
  InboxSyncStateRepo,
  PropertyActionItemRepo,
  type InquiryReplyMatchingSendRow,
} from "@re-sourcing/db";
import { listMessages, getMessage, getAttachment, getHeader, getBodyText, getAttachmentParts, parseEmailFromHeader, getThreadMessageIds } from "./gmailClient.js";
import { parseAddressFromInquirySubject, parseAddressFromSubjectFallback } from "./addressFromSubject.js";
import { saveInquiryAttachment } from "./storage.js";
import { extractEmailSummary } from "./extractEmailSummary.js";
import { syncPropertySourcingWorkflow } from "../sourcing/workflow.js";
import {
  classifyInquiryAttachment,
  summarizeAttachmentClassification,
  type ClassifiedInquiryAttachment,
  type InquiryAttachmentClass,
} from "./attachmentClassification.js";
import {
  dedupePropertyLinks,
  mergeMessageTargets,
  type MatchedPropertyLink,
  type MessageMatchTargets,
  type ThreadReplyTargets,
} from "./replyMatching.js";

/** Build map: broker email (normalized) -> property_id. Uses first listing match per email. */
async function getBrokerEmailToPropertyIdMap(pool: Pool): Promise<Map<string, string | null>> {
  const r = await pool.query<{ property_id: string; email: string }>(
    `WITH recipient_emails AS (
       SELECT r.property_id, TRIM(r.contact_email) AS email
       FROM property_recipient_resolution r
       WHERE r.status IN ('resolved', 'manual_override')
         AND r.contact_email IS NOT NULL
         AND TRIM(r.contact_email) <> ''
       UNION ALL
       SELECT m.property_id, TRIM(e->>'email') AS email
       FROM listing_property_matches m
       JOIN listings l ON l.id = m.listing_id,
       LATERAL jsonb_array_elements(COALESCE(l.agent_enrichment, '[]'::jsonb)) AS e
       WHERE jsonb_typeof(COALESCE(l.agent_enrichment, '[]'::jsonb)) = 'array'
         AND (e->>'email') IS NOT NULL
         AND TRIM(e->>'email') <> ''
     )
     SELECT property_id, email
     FROM recipient_emails`
  );
  const map = new Map<string, string | null>();
  for (const row of r.rows) {
    const key = row.email.toLowerCase().trim();
    if (!map.has(key)) {
      map.set(key, row.property_id);
      continue;
    }
    if (map.get(key) !== row.property_id) map.set(key, null);
  }
  return map;
}

interface SavedAttachment {
  id?: string;
  propertyId: string;
  filePath: string;
  filename: string;
  mimeType?: string | null;
  classification: ClassifiedInquiryAttachment;
}

function incrementAttachmentClassification(result: ProcessInboxResult, category: InquiryAttachmentClass): void {
  result.attachmentsTriaged = (result.attachmentsTriaged ?? 0) + 1;
  const counts = result.attachmentClassifications ?? {};
  counts[category] = (counts[category] ?? 0) + 1;
  result.attachmentClassifications = counts;
}

function uniqueAttachmentSummaries(savedAttachments: SavedAttachment[]): string[] {
  const seen = new Set<string>();
  const summaries: string[] = [];
  for (const attachment of savedAttachments) {
    const key = `${attachment.filename.toLowerCase()}|${attachment.classification.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    summaries.push(summarizeAttachmentClassification(attachment.filename, attachment.classification));
  }
  return summaries;
}

function recordMatchReporting(
  result: ProcessInboxResult,
  targets: MessageMatchTargets,
  phase: "matched" | "saved"
): void {
  const hasBatchMatch = targets.matchedBatchIds.length > 0 || targets.matchSources.includes("batch_thread");
  if (hasBatchMatch) {
    if (phase === "matched") result.batchMatched = (result.batchMatched ?? 0) + 1;
    else result.batchSaved = (result.batchSaved ?? 0) + 1;
  }
  if (phase === "matched" && targets.propertyLinks.length > 1) {
    result.multiPropertyMatched = (result.multiPropertyMatched ?? 0) + 1;
  }
  if (phase === "matched" && targets.matchedBatchIds.length > 1) {
    result.multiBatchMatched = (result.multiBatchMatched ?? 0) + 1;
  }
  if (phase === "matched" && targets.matchedBatchIds.length > 0) {
    const merged = new Set([...(result.matchedBatchIds ?? []), ...targets.matchedBatchIds]);
    result.matchedBatchIds = [...merged].sort();
  }
}

async function queueOmReviewActionItems(params: {
  actionRepo: PropertyActionItemRepo;
  result: ProcessInboxResult;
  savedAttachments: SavedAttachment[];
  inquiryEmailId: string;
  messageId: string;
  gmailThreadId?: string | null;
  matchedBatchId?: string | null;
  matchedBatchIds: string[];
  matchSources: string[];
  subject?: string | null;
  fromAddress?: string | null;
  receivedAt?: string | null;
}): Promise<void> {
  const byProperty = new Map<string, SavedAttachment[]>();
  for (const attachment of params.savedAttachments) {
    if (!attachment.classification.omReviewCandidate) continue;
    const current = byProperty.get(attachment.propertyId) ?? [];
    current.push(attachment);
    byProperty.set(attachment.propertyId, current);
  }

  for (const [propertyId, attachments] of byProperty) {
    const documents = attachments.map((attachment) => ({
      id: attachment.id ?? null,
      origin: "inquiry_attachment",
      filename: attachment.filename,
      mimeType: attachment.mimeType ?? null,
      filePath: attachment.filePath,
      classification: attachment.classification.category,
      classificationLabel: attachment.classification.label,
      classificationConfidence: attachment.classification.confidence,
      category: attachment.classification.reviewCategory,
      reviewRole: attachment.classification.reviewRole,
    }));
    await params.actionRepo.upsertOpen(propertyId, "review_om_attachment", {
      priority: "high",
      summary:
        attachments.length === 1
          ? `Create OM review run from ${attachments[0]?.filename ?? "broker attachment"}`
          : `Create OM review run from ${attachments.length} broker attachments`,
      details: {
        source: "process_inbox_attachment_triage",
        inquiryEmailId: params.inquiryEmailId,
        messageId: params.messageId,
        gmailThreadId: params.gmailThreadId ?? null,
        matchedBatchId: params.matchedBatchId ?? null,
        matchedBatchIds: params.matchedBatchIds,
        matchSources: params.matchSources,
        subject: params.subject ?? null,
        fromAddress: params.fromAddress ?? null,
        receivedAt: params.receivedAt ?? null,
        attachmentCandidates: documents,
        omReviewRunHandoff: {
          service: "ingestAuthoritativeOm",
          sourceType: "inquiry_attachment",
          triggerDossier: false,
          params: {
            propertyId,
            sourceType: "inquiry_attachment",
            documents,
            triggerDossier: false,
          },
        },
      },
    });
    params.result.omReviewActionsQueued = (params.result.omReviewActionsQueued ?? 0) + 1;
    params.result.omReviewAttachmentCandidates =
      (params.result.omReviewAttachmentCandidates ?? 0) + attachments.length;
  }
}

function parseReceivedAt(dateHeader: string | null): string | null {
  if (!dateHeader) return null;
  try {
    return new Date(dateHeader).toISOString();
  } catch {
    return null;
  }
}

async function buildThreadReplyTargets(
  recentSends: InquiryReplyMatchingSendRow[],
  result: ProcessInboxResult
): Promise<Map<string, ThreadReplyTargets>> {
  const threadTargets = new Map<string, ThreadReplyTargets>();

  for (const send of recentSends) {
    const threadIds = new Set<string>();
    const knownThreadIds = [send.gmailThreadId, send.batchThreadId]
      .map((value) => value?.trim() || null)
      .filter((value): value is string => Boolean(value));
    for (const threadId of knownThreadIds) threadIds.add(threadId);

    if (threadIds.size === 0) {
      try {
        const msg = await getMessage(send.gmailMessageId);
        if (msg.threadId?.trim()) threadIds.add(msg.threadId.trim());
      } catch (e) {
        result.errors.push(`thread send ${send.gmailMessageId}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }

    if (threadIds.size === 0) continue;
    const matchSource = send.batchId ? "batch_thread" : "thread_reply";
    for (const threadId of threadIds) {
      let entry = threadTargets.get(threadId);
      if (!entry) {
        if (threadTargets.size >= MAX_THREADS_PER_RUN) continue;
        entry = { propertyLinks: [], batchIds: new Set<string>() };
        threadTargets.set(threadId, entry);
      }
      entry.propertyLinks.push({ propertyId: send.propertyId, matchSource });
      if (send.batchId) entry.batchIds.add(send.batchId);
    }
  }

  for (const entry of threadTargets.values()) {
    entry.propertyLinks = dedupePropertyLinks(entry.propertyLinks);
  }

  return threadTargets;
}

async function saveMatchedAttachments(
  docRepo: InquiryDocumentRepo,
  result: ProcessInboxResult,
  params: {
    messageId: string;
    inquiryEmailId: string;
    propertyLinks: MatchedPropertyLink[];
    phaseLabel: string;
    attachmentParts: Array<{ filename: string; mimeType: string; attachmentId: string }>;
  }
): Promise<SavedAttachment[]> {
  const savedPaths: SavedAttachment[] = [];
  for (const part of params.attachmentParts) {
    const classification = classifyInquiryAttachment({ filename: part.filename, mimeType: part.mimeType });
    incrementAttachmentClassification(result, classification.category);
    try {
      const buffer = await getAttachment(params.messageId, part.attachmentId);
      for (const link of params.propertyLinks) {
        try {
          const filePath = await saveInquiryAttachment(link.propertyId, params.inquiryEmailId, part.filename, buffer);
          const savedDoc = await docRepo.insert({
            propertyId: link.propertyId,
            inquiryEmailId: params.inquiryEmailId,
            filename: part.filename,
            contentType: part.mimeType,
            filePath,
            fileContent: buffer,
          });
          savedPaths.push({
            id: savedDoc.id,
            propertyId: link.propertyId,
            filePath,
            filename: part.filename,
            mimeType: part.mimeType,
            classification,
          });
        } catch (e) {
          result.errors.push(
            `${params.phaseLabel} attachment ${part.filename} (${link.propertyId}): ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    } catch (e) {
      result.errors.push(`${params.phaseLabel} attachment ${part.filename}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return savedPaths;
}

async function persistMatchedMessage(
  params: {
    pool: Pool;
    propertyRepo: PropertyRepo;
    emailRepo: InquiryEmailRepo;
    docRepo: InquiryDocumentRepo;
    result: ProcessInboxResult;
    msg: Awaited<ReturnType<typeof getMessage>>;
    targets: MessageMatchTargets;
    phaseLabel: string;
    primaryProperty?: { id: string; details?: unknown } | null;
  }
): Promise<boolean> {
  const primaryPropertyId = params.targets.propertyLinks[0]?.propertyId ?? null;
  if (!primaryPropertyId) return false;
  const primaryProperty =
    params.primaryProperty?.id === primaryPropertyId
      ? params.primaryProperty
      : await params.propertyRepo.byId(primaryPropertyId);
  if (!primaryProperty) {
    params.result.errors.push(`${params.phaseLabel} property ${primaryPropertyId} not found`);
    return false;
  }

  const subject = getHeader(params.msg, "Subject");
  const fromAddress = getHeader(params.msg, "From");
  const receivedAt = parseReceivedAt(getHeader(params.msg, "Date"));
  const bodyText = getBodyText(params.msg);
  const actionRepo = new PropertyActionItemRepo({ pool: params.pool });

  const emailRow = await params.emailRepo.upsert({
    propertyId: primaryPropertyId,
    propertyLinks: params.targets.propertyLinks,
    messageId: params.msg.id,
    subject: subject ?? null,
    fromAddress: fromAddress ?? null,
    receivedAt,
    bodyText: bodyText || null,
    gmailThreadId: params.msg.threadId ?? null,
    matchedBatchId: params.targets.matchedBatchId,
    processingStatus: params.targets.processingStatus,
  });

  const savedPaths = await saveMatchedAttachments(params.docRepo, params.result, {
    messageId: params.msg.id,
    inquiryEmailId: emailRow.id,
    propertyLinks: params.targets.propertyLinks,
    phaseLabel: params.phaseLabel,
    attachmentParts: getAttachmentParts(params.msg),
  });

  try {
    const emailSummary = await extractEmailSummary(bodyText, uniqueAttachmentSummaries(savedPaths));
    if (emailSummary) {
      await params.emailRepo.updateLlmFields(emailRow.id, {
        bodySummary: emailSummary.summary,
        receiptDateFromBroker: emailSummary.latestReceiptDateFromBroker,
        attachmentsList: emailSummary.attachmentsList,
      });
    }
  } catch (e) {
    params.result.errors.push(`${params.phaseLabel} email summary: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    await queueOmReviewActionItems({
      actionRepo,
      result: params.result,
      savedAttachments: savedPaths,
      inquiryEmailId: emailRow.id,
      messageId: params.msg.id,
      gmailThreadId: params.msg.threadId ?? null,
      matchedBatchId: params.targets.matchedBatchId,
      matchedBatchIds: params.targets.matchedBatchIds,
      matchSources: params.targets.matchSources,
      subject,
      fromAddress,
      receivedAt,
    });
  } catch (e) {
    params.result.errors.push(`${params.phaseLabel} OM review action: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const link of params.targets.propertyLinks) {
    await syncPropertySourcingWorkflow(link.propertyId, { pool: params.pool });
  }
  return true;
}

export interface ProcessInboxResult {
  processed: number;
  matched: number;
  saved: number;
  skipped: number;
  /** Count of emails matched and saved via broker-from (in addition to subject match). */
  brokerMatched?: number;
  brokerSaved?: number;
  /** Count of emails matched and saved via thread (same thread as our sent inquiry; e.g. alternate broker email or teammate). */
  threadMatched?: number;
  threadSaved?: number;
  /** Count of emails linked to one or more outreach batches through Gmail thread matching. */
  batchMatched?: number;
  batchSaved?: number;
  /** Count of inbound emails linked to multiple properties or multiple batches. */
  multiPropertyMatched?: number;
  multiBatchMatched?: number;
  matchedBatchIds?: string[];
  /** Attachment triage reporting by classified attachment part, not per property link. */
  attachmentsTriaged?: number;
  attachmentClassifications?: Partial<Record<InquiryAttachmentClass, number>>;
  /** Manual action items queued for operator-run OM review handoff. */
  omReviewActionsQueued?: number;
  omReviewAttachmentCandidates?: number;
  errors: string[];
}

export function shouldBlockAutomatedOutreachAfterInboxCheck(result: ProcessInboxResult): boolean {
  if (result.processed > 0 || result.matched > 0 || result.saved > 0) return false;
  return result.errors.some((error) =>
    error.startsWith("Gmail not configured or auth failed:")
    || error.startsWith("listMessages:")
  );
}

/**
 * Run process-inbox: fetch recent inbox messages, match by subject address, save emails and attachments.
 */
const MAX_MESSAGES_PER_BROKER = 30;

const THREAD_LOOKBACK_DAYS = 90;
const MAX_THREADS_PER_RUN = 50;
const INBOX_SYNC_OVERLAP_DAYS = 2;
const INBOX_INITIAL_SYNC_START = new Date("2026-03-01T00:00:00-05:00");

export async function processInbox(options?: { maxMessages?: number }): Promise<ProcessInboxResult> {
  const result: ProcessInboxResult = {
    processed: 0,
    matched: 0,
    saved: 0,
    skipped: 0,
    brokerMatched: 0,
    brokerSaved: 0,
    threadMatched: 0,
    threadSaved: 0,
    batchMatched: 0,
    batchSaved: 0,
    multiPropertyMatched: 0,
    multiBatchMatched: 0,
    matchedBatchIds: [],
    attachmentsTriaged: 0,
    attachmentClassifications: {},
    omReviewActionsQueued: 0,
    omReviewAttachmentCandidates: 0,
    errors: [],
  };
  const maxMessages = options?.maxMessages ?? 50;
  const subjectPhaseMessageIds = new Set<string>();

  try {
    await listMessages({ maxResults: 1 });
  } catch (e) {
    result.errors.push("Gmail not configured or auth failed: " + (e instanceof Error ? e.message : String(e)));
    return result;
  }

  const pool = getPool();
  const propertyRepo = new PropertyRepo({ pool });
  const emailRepo = new InquiryEmailRepo({ pool });
  const docRepo = new InquiryDocumentRepo({ pool });
  const inquirySendRepo = new InquirySendRepo({ pool });
  const syncStateRepo = new InboxSyncStateRepo({ pool });
  const recentSends = await inquirySendRepo.listRecentSendsForReplyMatching(THREAD_LOOKBACK_DAYS);
  const threadReplyTargets = await buildThreadReplyTargets(recentSends, result);
  const ourSentIds = new Set(recentSends.map((send) => send.gmailMessageId));

  const syncCompletedAt = new Date().toISOString();
  const syncState = await syncStateRepo.get("gmail");
  const afterDateAnchor = syncState?.lastSyncedAt
    ? new Date(syncState.lastSyncedAt)
    : new Date(INBOX_INITIAL_SYNC_START);
  if (syncState?.lastSyncedAt) {
    afterDateAnchor.setUTCDate(afterDateAnchor.getUTCDate() - INBOX_SYNC_OVERLAP_DAYS);
  }
  const afterDate = `${afterDateAnchor.getUTCFullYear()}/${afterDateAnchor.getUTCMonth() + 1}/${afterDateAnchor.getUTCDate()}`;
  const inboxQuery = `in:inbox after:${afterDate}`;

  let list: Awaited<ReturnType<typeof listMessages>>;
  try {
    list = await listMessages({ maxResults: maxMessages, q: inboxQuery });
  } catch (e) {
    result.errors.push("listMessages: " + (e instanceof Error ? e.message : String(e)));
    return result;
  }

  const addressFirstLines = await propertyRepo.listAddressFirstLines();

  for (const item of list.messages) {
    if (subjectPhaseMessageIds.has(item.id)) continue;
    subjectPhaseMessageIds.add(item.id);
    result.processed++;
    try {
      const alreadySaved = await emailRepo.byMessageId(item.id);
      if (alreadySaved) {
        result.skipped++;
        continue;
      }
      const msg = await getMessage(item.id);
      const subject = getHeader(msg, "Subject");
      const address =
        parseAddressFromInquirySubject(subject) ?? parseAddressFromSubjectFallback(subject, addressFirstLines);
      if (!address) {
        result.skipped++;
        continue;
      }
      const property = await propertyRepo.findByAddressFirstLine(address);
      if (!property) {
        result.skipped++;
        continue;
      }
      const targets = mergeMessageTargets(
        [{ propertyId: property.id, matchSource: "subject_address" }],
        msg.threadId ? threadReplyTargets.get(msg.threadId) ?? null : null
      );
      if (!targets) {
        result.skipped++;
        continue;
      }

      result.matched++;
      recordMatchReporting(result, targets, "matched");
      const saved = await persistMatchedMessage({
        pool,
        propertyRepo,
        emailRepo,
        docRepo,
        result,
        msg,
        targets,
        phaseLabel: "subject",
        primaryProperty: property,
      });
      if (saved) {
        result.saved++;
        recordMatchReporting(result, targets, "saved");
      }
    } catch (e) {
      result.errors.push(`message ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const brokerMap = await getBrokerEmailToPropertyIdMap(pool);
  const brokerEmails = [...brokerMap.keys()];
  for (const brokerEmail of brokerEmails) {
    const brokerQuery = `in:inbox from:${brokerEmail} after:${afterDate}`;
    let brokerList: Awaited<ReturnType<typeof listMessages>>;
    try {
      brokerList = await listMessages({ maxResults: MAX_MESSAGES_PER_BROKER, q: brokerQuery });
    } catch (e) {
      result.errors.push(`listMessages broker ${brokerEmail}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const item of brokerList.messages) {
      const existing = await emailRepo.byMessageId(item.id);
      if (existing) continue;
      result.processed++;
      try {
        const msg = await getMessage(item.id);
        const fromHeader = getHeader(msg, "From");
        const fromEmail = parseEmailFromHeader(fromHeader);
        const propertyId = fromEmail ? brokerMap.get(fromEmail) : null;
        if (!propertyId) {
          result.skipped++;
          continue;
        }
        const property = await propertyRepo.byId(propertyId);
        if (!property) {
          result.skipped++;
          continue;
        }
        const targets = mergeMessageTargets(
          [{ propertyId: property.id, matchSource: "broker_email" }],
          msg.threadId ? threadReplyTargets.get(msg.threadId) ?? null : null
        );
        if (!targets) {
          result.skipped++;
          continue;
        }

        result.matched++;
        result.brokerMatched = (result.brokerMatched ?? 0) + 1;
        recordMatchReporting(result, targets, "matched");

        const saved = await persistMatchedMessage({
          pool,
          propertyRepo,
          emailRepo,
          docRepo,
          result,
          msg,
          targets,
          phaseLabel: "broker",
          primaryProperty: property,
        });
        if (saved) {
          result.saved++;
          result.brokerSaved = (result.brokerSaved ?? 0) + 1;
          recordMatchReporting(result, targets, "saved");
        }
      } catch (e) {
        result.errors.push(`broker message ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const overlapStart = new Date(afterDateAnchor);
  overlapStart.setUTCHours(0, 0, 0, 0);
  const overlapStartMs = overlapStart.getTime();

  for (const [threadId, threadTargets] of threadReplyTargets) {
    let threadMessageIds: string[];
    try {
      threadMessageIds = await getThreadMessageIds(threadId);
    } catch (e) {
      result.errors.push(`thread ${threadId}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const messageId of threadMessageIds) {
      if (ourSentIds.has(messageId)) continue;
      const alreadySaved = await emailRepo.byMessageId(messageId);
      if (alreadySaved) continue;
      result.processed++;
      try {
        const msg = await getMessage(messageId);
        const receivedAt = parseReceivedAt(getHeader(msg, "Date"));
        const msgTime = receivedAt ? new Date(receivedAt).getTime() : 0;
        if (msgTime > 0 && msgTime < overlapStartMs) continue;

        const targets = mergeMessageTargets([], threadTargets);
        if (!targets) {
          result.skipped++;
          continue;
        }

        result.matched++;
        result.threadMatched = (result.threadMatched ?? 0) + 1;
        recordMatchReporting(result, targets, "matched");
        const saved = await persistMatchedMessage({
          pool,
          propertyRepo,
          emailRepo,
          docRepo,
          result,
          msg,
          targets,
          phaseLabel: "thread",
        });
        if (saved) {
          result.saved++;
          result.threadSaved = (result.threadSaved ?? 0) + 1;
          recordMatchReporting(result, targets, "saved");
        }
      } catch (e) {
        result.errors.push(`thread message ${messageId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  await syncStateRepo.upsert("gmail", syncCompletedAt);
  return result;
}
