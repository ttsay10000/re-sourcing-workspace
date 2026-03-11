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
  type InquiryReplyMatchingSendRow,
} from "@re-sourcing/db";
import { listMessages, getMessage, getAttachment, getHeader, getBodyText, getAttachmentParts, parseEmailFromHeader, getThreadMessageIds } from "./gmailClient.js";
import { parseAddressFromInquirySubject, parseAddressFromSubjectFallback } from "./addressFromSubject.js";
import { saveInquiryAttachment } from "./storage.js";
import { extractTextFromFile } from "./extractTextFromAttachment.js";
import { extractEmailSummary } from "./extractEmailSummary.js";
import { syncPropertySourcingWorkflow } from "../sourcing/workflow.js";
import { ingestAuthoritativeOm } from "../om/ingestAuthoritativeOm.js";

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

/** Min combined text length to run OM-style extraction (same as manual upload). Skip when nothing readable from OM. */
const OM_STYLE_MIN_READABLE_CHARS = 50;

interface SavedAttachment {
  id?: string;
  filePath: string;
  filename: string;
  mimeType?: string | null;
  buffer?: Buffer;
}

interface MatchedPropertyLink {
  propertyId: string;
  matchSource: string;
}

interface ThreadReplyTargets {
  propertyLinks: MatchedPropertyLink[];
  batchIds: Set<string>;
}

interface MessageMatchTargets {
  propertyLinks: MatchedPropertyLink[];
  matchedBatchId: string | null;
  processingStatus: string;
}

function attachmentDocs(savedAttachments: SavedAttachment[]): SavedAttachment[] | undefined {
  return savedAttachments.length > 0 ? savedAttachments : undefined;
}

function dedupePropertyLinks(propertyLinks: MatchedPropertyLink[]): MatchedPropertyLink[] {
  const deduped = new Map<string, string>();
  for (const link of propertyLinks) {
    const propertyId = link.propertyId?.trim();
    if (!propertyId || deduped.has(propertyId)) continue;
    deduped.set(propertyId, link.matchSource?.trim() || "legacy_property");
  }
  return [...deduped.entries()].map(([propertyId, matchSource]) => ({ propertyId, matchSource }));
}

function buildProcessingStatus(propertyLinks: MatchedPropertyLink[]): string {
  if (propertyLinks.length > 1) return "batch_matched_multi_property";
  const source = propertyLinks[0]?.matchSource ?? "";
  if (source === "batch_thread" || source === "thread_reply") return "thread_matched";
  return "saved";
}

function mergeMessageTargets(
  directLinks: MatchedPropertyLink[],
  threadTargets?: ThreadReplyTargets | null
): MessageMatchTargets | null {
  const propertyLinks = dedupePropertyLinks([...directLinks, ...(threadTargets?.propertyLinks ?? [])]);
  if (propertyLinks.length === 0) return null;
  const batchIds = threadTargets ? [...threadTargets.batchIds] : [];
  return {
    propertyLinks,
    matchedBatchId: batchIds.length === 1 ? batchIds[0] ?? null : null,
    processingStatus: buildProcessingStatus(propertyLinks),
  };
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
    try {
      const buffer = await getAttachment(params.messageId, part.attachmentId);
      let primarySaved: SavedAttachment | null = null;
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
          if (!primarySaved) {
            primarySaved = { id: savedDoc.id, filePath, filename: part.filename, mimeType: part.mimeType, buffer };
          }
        } catch (e) {
          result.errors.push(
            `${params.phaseLabel} attachment ${part.filename} (${link.propertyId}): ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
      if (primarySaved) savedPaths.push(primarySaved);
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
    const emailSummary = await extractEmailSummary(bodyText, savedPaths.map((attachment) => attachment.filename));
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

  const attachmentTexts: string[] = [];
  for (const { filePath, filename } of savedPaths) {
    const text = await extractTextFromFile(filePath, filename);
    if (text) attachmentTexts.push(text);
  }
  const combinedText = [bodyText, ...attachmentTexts].filter(Boolean).join("\n\n");
  const omDocs = attachmentDocs(savedPaths);
  if (
    ENABLE_OM_AUTOMATION_V2 &&
    params.targets.propertyLinks.length === 1 &&
    (combinedText.length >= OM_STYLE_MIN_READABLE_CHARS || omDocs?.length)
  ) {
    try {
      await runOmStyleExtractionAndMerge(params.propertyRepo, primaryProperty, combinedText, omDocs);
    } catch (e) {
      params.result.errors.push(`${params.phaseLabel} llm merge: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const link of params.targets.propertyLinks) {
    await syncPropertySourcingWorkflow(link.propertyId, { pool: params.pool });
  }
  return true;
}

/**
 * Run the same OM-style financial extraction as manual upload: forceOmStyle + enrichmentContext,
 * then merge into property.details.rentalFinancials so the user can recall on the property and re-run enrichment if needed.
 */
async function runOmStyleExtractionAndMerge(
  propertyRepo: PropertyRepo,
  property: { id: string; details?: unknown },
  combinedText: string,
  documentFiles?: SavedAttachment[]
): Promise<void> {
  void propertyRepo;
  void combinedText;
  if (!documentFiles || documentFiles.length === 0) return;
  const result = await ingestAuthoritativeOm({
    propertyId: property.id,
    sourceType: "inquiry_attachment",
    documents: documentFiles.map((doc, index) => ({
      id: doc.id ?? `inbox:${property.id}:${index}:${doc.filename}`,
      origin: "inquiry_attachment",
      filename: doc.filename,
      mimeType: doc.mimeType ?? "application/pdf",
      filePath: doc.filePath,
      buffer: doc.buffer,
    })),
  });
  if (result.error) throw new Error(result.error);
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
  errors: string[];
}

/**
 * Run process-inbox: fetch recent inbox messages, match by subject address, save emails and attachments.
 */
const MAX_MESSAGES_PER_BROKER = 30;

const THREAD_LOOKBACK_DAYS = 90;
const MAX_THREADS_PER_RUN = 50;
const INBOX_SYNC_OVERLAP_DAYS = 2;
const ENABLE_OM_AUTOMATION_V2 = process.env.ENABLE_OM_AUTOMATION_V2 === "1";
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
      if (saved) result.saved++;
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
        }
      } catch (e) {
        result.errors.push(`thread message ${messageId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  await syncStateRepo.upsert("gmail", syncCompletedAt);
  return result;
}
