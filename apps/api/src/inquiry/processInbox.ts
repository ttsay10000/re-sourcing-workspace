/**
 * Process inbox: list Gmail messages, match by (1) subject address, (2) broker-on-record From email,
 * or (3) same thread as our sent inquiry (covers broker's alternate email or teammate reply).
 * Upsert email (idempotent by message_id), save attachments, run LLM for financials.
 */

import type { RentalFinancials, RentalFinancialsFromLlm } from "@re-sourcing/contracts";
import type { Pool } from "pg";
import { getPool, PropertyRepo, InquiryEmailRepo, InquiryDocumentRepo, InquirySendRepo } from "@re-sourcing/db";
import { listMessages, getMessage, getAttachment, getHeader, getBodyText, getPdfAttachmentParts, parseEmailFromHeader, getThreadMessageIds } from "./gmailClient.js";
import { parseAddressFromInquirySubject, parseAddressFromSubjectFallback } from "./addressFromSubject.js";
import { saveInquiryAttachment } from "./storage.js";
import { extractTextFromFile } from "./extractTextFromAttachment.js";
import { extractEmailSummary } from "./extractEmailSummary.js";
import { extractRentalFinancialsFromText } from "../rental/extractRentalFinancialsFromListing.js";

/** Build map: broker email (normalized) -> property_id. Uses first listing match per email. */
async function getBrokerEmailToPropertyIdMap(pool: Pool): Promise<Map<string, string>> {
  const r = await pool.query<{ property_id: string; email: string }>(
    `SELECT m.property_id, TRIM(e->>'email') AS email
     FROM listing_property_matches m
     JOIN listings l ON l.id = m.listing_id,
     LATERAL jsonb_array_elements(COALESCE(l.agent_enrichment, '[]'::jsonb)) AS e
     WHERE jsonb_typeof(COALESCE(l.agent_enrichment, '[]'::jsonb)) = 'array'
       AND (e->>'email') IS NOT NULL AND TRIM(e->>'email') <> ''`
  );
  const map = new Map<string, string>();
  for (const row of r.rows) {
    const key = row.email.toLowerCase().trim();
    if (!map.has(key)) map.set(key, row.property_id);
  }
  return map;
}

function mergeFromLlm(
  existing: RentalFinancialsFromLlm | null | undefined,
  incoming: RentalFinancialsFromLlm | null | undefined
): RentalFinancialsFromLlm | null {
  if (!incoming || typeof incoming !== "object") return existing ?? null;
  const out = { ...(existing && typeof existing === "object" ? existing : {}) };
  for (const [k, v] of Object.entries(incoming)) {
    if (v != null && (typeof v !== "string" || v.trim() !== "")) (out as Record<string, unknown>)[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
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

export async function processInbox(options?: { maxMessages?: number }): Promise<ProcessInboxResult> {
  const result: ProcessInboxResult = { processed: 0, matched: 0, saved: 0, skipped: 0, brokerMatched: 0, brokerSaved: 0, threadMatched: 0, threadSaved: 0, errors: [] };
  const maxMessages = options?.maxMessages ?? 50;

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

  // Only process emails from yesterday onward (project started using inquiry sends recently).
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const afterDate = `${yesterday.getUTCFullYear()}/${yesterday.getUTCMonth() + 1}/${yesterday.getUTCDate()}`;
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
    result.processed++;
    try {
      // Skip already-saved messages so we never re-process or duplicate attachments
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
      result.matched++;

      const messageId = msg.id;
      const from = getHeader(msg, "From");
      const dateHeader = getHeader(msg, "Date");
      let receivedAt: string | null = null;
      if (dateHeader) {
        try {
          receivedAt = new Date(dateHeader).toISOString();
        } catch {
          receivedAt = null;
        }
      }
      const bodyText = getBodyText(msg);

      const emailRow = await emailRepo.upsert({
        propertyId: property.id,
        messageId,
        subject: subject ?? null,
        fromAddress: from ?? null,
        receivedAt,
        bodyText: bodyText || null,
      });
      result.saved++;

      const attachmentParts = getPdfAttachmentParts(msg);
      const savedPaths: { filePath: string; filename: string }[] = [];
      for (const part of attachmentParts) {
        try {
          const buffer = await getAttachment(msg.id, part.attachmentId);
          const filePath = await saveInquiryAttachment(property.id, emailRow.id, part.filename, buffer);
          await docRepo.insert({
            propertyId: property.id,
            inquiryEmailId: emailRow.id,
            filename: part.filename,
            contentType: part.mimeType,
            filePath,
          });
          savedPaths.push({ filePath, filename: part.filename });
        } catch (e) {
          result.errors.push(`attachment ${part.filename}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      try {
        const emailSummary = await extractEmailSummary(bodyText, savedPaths.map((p) => p.filename));
        if (emailSummary) {
          await emailRepo.updateLlmFields(emailRow.id, {
            bodySummary: emailSummary.summary,
            receiptDateFromBroker: emailSummary.latestReceiptDateFromBroker,
            attachmentsList: emailSummary.attachmentsList,
          });
        }
      } catch (e) {
        result.errors.push(`email summary: ${e instanceof Error ? e.message : String(e)}`);
      }

      const attachmentTexts: string[] = [];
      for (const { filePath, filename } of savedPaths) {
        const t = await extractTextFromFile(filePath, filename);
        if (t) attachmentTexts.push(t);
      }
      const combinedText = [bodyText, ...attachmentTexts].filter(Boolean).join("\n\n");
      if (combinedText.length >= 20) {
        try {
          const fromLlm = await extractRentalFinancialsFromText(combinedText);
          if (fromLlm) {
            const prop = await propertyRepo.byId(property.id);
            const existing = (prop?.details?.rentalFinancials ?? null) as RentalFinancials | null;
            const mergedFromLlm = mergeFromLlm(existing?.fromLlm ?? null, fromLlm);
            const rentalFinancials: RentalFinancials = {
              ...(existing ?? {}),
              fromLlm: mergedFromLlm ?? undefined,
              source: existing?.source ?? "inquiry",
              lastUpdatedAt: new Date().toISOString(),
            };
            await propertyRepo.mergeDetails(property.id, { rentalFinancials });
          }
        } catch (e) {
          result.errors.push(`llm merge: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      result.errors.push(`message ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Phase 2: fetch emails from brokers on record (from yesterday onward), match by From address, save to property
  const brokerMap = await getBrokerEmailToPropertyIdMap(pool);
  const brokerEmails = [...brokerMap.keys()];
  const seenMessageIds = new Set<string>();

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
      if (seenMessageIds.has(item.id)) continue;
      seenMessageIds.add(item.id);
      // Skip already-saved (e.g. from subject match or prior run) so we only process new emails
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
        result.matched++;
        result.brokerMatched = (result.brokerMatched ?? 0) + 1;

        const messageId = msg.id;
        const subject = getHeader(msg, "Subject");
        const dateHeader = getHeader(msg, "Date");
        let receivedAt: string | null = null;
        if (dateHeader) {
          try {
            receivedAt = new Date(dateHeader).toISOString();
          } catch {
            receivedAt = null;
          }
        }
        const bodyText = getBodyText(msg);

        const emailRow = await emailRepo.upsert({
          propertyId: property.id,
          messageId,
          subject: subject ?? null,
          fromAddress: fromHeader ?? null,
          receivedAt,
          bodyText: bodyText || null,
        });
        result.saved++;
        result.brokerSaved = (result.brokerSaved ?? 0) + 1;

        const attachmentParts = getPdfAttachmentParts(msg);
        const savedPaths: { filePath: string; filename: string }[] = [];
        for (const part of attachmentParts) {
          try {
            const buffer = await getAttachment(msg.id, part.attachmentId);
            const filePath = await saveInquiryAttachment(property.id, emailRow.id, part.filename, buffer);
            await docRepo.insert({
              propertyId: property.id,
              inquiryEmailId: emailRow.id,
              filename: part.filename,
              contentType: part.mimeType,
              filePath,
            });
            savedPaths.push({ filePath, filename: part.filename });
          } catch (e) {
            result.errors.push(`broker attachment ${part.filename}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        try {
          const emailSummary = await extractEmailSummary(bodyText, savedPaths.map((p) => p.filename));
          if (emailSummary) {
            await emailRepo.updateLlmFields(emailRow.id, {
              bodySummary: emailSummary.summary,
              receiptDateFromBroker: emailSummary.latestReceiptDateFromBroker,
              attachmentsList: emailSummary.attachmentsList,
            });
          }
        } catch (e) {
          result.errors.push(`broker email summary: ${e instanceof Error ? e.message : String(e)}`);
        }

        const attachmentTexts: string[] = [];
        for (const { filePath, filename } of savedPaths) {
          const t = await extractTextFromFile(filePath, filename);
          if (t) attachmentTexts.push(t);
        }
        const combinedText = [bodyText, ...attachmentTexts].filter(Boolean).join("\n\n");
        if (combinedText.length >= 20) {
          try {
            const fromLlm = await extractRentalFinancialsFromText(combinedText);
            if (fromLlm) {
              const prop = await propertyRepo.byId(property.id);
              const existingRental = (prop?.details?.rentalFinancials ?? null) as RentalFinancials | null;
              const mergedFromLlm = mergeFromLlm(existingRental?.fromLlm ?? null, fromLlm);
              const rentalFinancials: RentalFinancials = {
                ...(existingRental ?? {}),
                fromLlm: mergedFromLlm ?? undefined,
                source: existingRental?.source ?? "inquiry",
                lastUpdatedAt: new Date().toISOString(),
              };
              await propertyRepo.mergeDetails(property.id, { rentalFinancials });
            }
          } catch (e) {
            result.errors.push(`broker llm merge: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } catch (e) {
        result.errors.push(`broker message ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Phase 3: thread-based matching — replies in the same thread as our sent inquiry (broker's alternate email or teammate)
  const inquirySendRepo = new InquirySendRepo({ pool });
  const recentSends = await inquirySendRepo.listRecentSendsWithMessageId(THREAD_LOOKBACK_DAYS);
  const ourSentIds = new Set(recentSends.map((s) => s.gmailMessageId));
  const threadIdToPropertyId = new Map<string, string>();
  const yesterdayStart = new Date();
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
  yesterdayStart.setUTCHours(0, 0, 0, 0);
  const yesterdayMs = yesterdayStart.getTime();

  for (const send of recentSends.slice(0, MAX_THREADS_PER_RUN)) {
    try {
      const msg = await getMessage(send.gmailMessageId);
      if (msg.threadId && !threadIdToPropertyId.has(msg.threadId)) {
        threadIdToPropertyId.set(msg.threadId, send.propertyId);
      }
    } catch (e) {
      result.errors.push(`thread send ${send.gmailMessageId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const [threadId, propertyId] of threadIdToPropertyId) {
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
        const dateHeader = getHeader(msg, "Date");
        let receivedAt: string | null = null;
        if (dateHeader) {
          try {
            receivedAt = new Date(dateHeader).toISOString();
          } catch {
            receivedAt = null;
          }
        }
        const msgTime = dateHeader ? new Date(dateHeader).getTime() : 0;
        if (msgTime > 0 && msgTime < yesterdayMs) continue;

        const property = await propertyRepo.byId(propertyId);
        if (!property) {
          result.skipped++;
          continue;
        }
        result.matched++;
        result.threadMatched = (result.threadMatched ?? 0) + 1;

        const subject = getHeader(msg, "Subject");
        const fromHeader = getHeader(msg, "From");
        const bodyText = getBodyText(msg);

        const emailRow = await emailRepo.upsert({
          propertyId: property.id,
          messageId: msg.id,
          subject: subject ?? null,
          fromAddress: fromHeader ?? null,
          receivedAt,
          bodyText: bodyText || null,
        });
        result.saved++;
        result.threadSaved = (result.threadSaved ?? 0) + 1;

        const attachmentParts = getPdfAttachmentParts(msg);
        const savedPaths: { filePath: string; filename: string }[] = [];
        for (const part of attachmentParts) {
          try {
            const buffer = await getAttachment(msg.id, part.attachmentId);
            const filePath = await saveInquiryAttachment(property.id, emailRow.id, part.filename, buffer);
            await docRepo.insert({
              propertyId: property.id,
              inquiryEmailId: emailRow.id,
              filename: part.filename,
              contentType: part.mimeType,
              filePath,
            });
            savedPaths.push({ filePath, filename: part.filename });
          } catch (e) {
            result.errors.push(`thread attachment ${part.filename}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        try {
          const emailSummary = await extractEmailSummary(bodyText, savedPaths.map((p) => p.filename));
          if (emailSummary) {
            await emailRepo.updateLlmFields(emailRow.id, {
              bodySummary: emailSummary.summary,
              receiptDateFromBroker: emailSummary.latestReceiptDateFromBroker,
              attachmentsList: emailSummary.attachmentsList,
            });
          }
        } catch (e) {
          result.errors.push(`thread email summary: ${e instanceof Error ? e.message : String(e)}`);
        }

        const attachmentTexts: string[] = [];
        for (const { filePath, filename } of savedPaths) {
          const t = await extractTextFromFile(filePath, filename);
          if (t) attachmentTexts.push(t);
        }
        const combinedText = [bodyText, ...attachmentTexts].filter(Boolean).join("\n\n");
        if (combinedText.length >= 20) {
          try {
            const fromLlm = await extractRentalFinancialsFromText(combinedText);
            if (fromLlm) {
              const prop = await propertyRepo.byId(property.id);
              const existingRental = (prop?.details?.rentalFinancials ?? null) as RentalFinancials | null;
              const mergedFromLlm = mergeFromLlm(existingRental?.fromLlm ?? null, fromLlm);
              const rentalFinancials: RentalFinancials = {
                ...(existingRental ?? {}),
                fromLlm: mergedFromLlm ?? undefined,
                source: existingRental?.source ?? "inquiry",
                lastUpdatedAt: new Date().toISOString(),
              };
              await propertyRepo.mergeDetails(property.id, { rentalFinancials });
            }
          } catch (e) {
            result.errors.push(`thread llm merge: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } catch (e) {
        result.errors.push(`thread message ${messageId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return result;
}
