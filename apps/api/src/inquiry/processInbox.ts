/**
 * Process inbox: list Gmail messages, parse subject for address, resolve property,
 * upsert email (idempotent by message_id), save attachments to disk, insert document rows,
 * extract text from PDF/txt attachments + body, run LLM for financials, merge into property.
 */

import type { RentalFinancials, RentalFinancialsFromLlm } from "@re-sourcing/contracts";
import { getPool, PropertyRepo, InquiryEmailRepo, InquiryDocumentRepo } from "@re-sourcing/db";
import { listMessages, getMessage, getAttachment, getHeader, getBodyText, getAttachmentParts } from "./gmailClient.js";
import { parseAddressFromInquirySubject } from "./addressFromSubject.js";
import { saveInquiryAttachment } from "./storage.js";
import { extractTextFromFile } from "./extractTextFromAttachment.js";
import { extractRentalFinancialsFromText } from "../rental/extractRentalFinancialsFromListing.js";

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
  errors: string[];
}

/**
 * Run process-inbox: fetch recent inbox messages, match by subject address, save emails and attachments.
 */
export async function processInbox(options?: { maxMessages?: number }): Promise<ProcessInboxResult> {
  const result: ProcessInboxResult = { processed: 0, matched: 0, saved: 0, skipped: 0, errors: [] };
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

  let list: Awaited<ReturnType<typeof listMessages>>;
  try {
    list = await listMessages({ maxResults: maxMessages, q: "in:inbox" });
  } catch (e) {
    result.errors.push("listMessages: " + (e instanceof Error ? e.message : String(e)));
    return result;
  }

  for (const item of list.messages) {
    result.processed++;
    try {
      const msg = await getMessage(item.id);
      const subject = getHeader(msg, "Subject");
      const address = parseAddressFromInquirySubject(subject);
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

      const attachmentParts = getAttachmentParts(msg);
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

  return result;
}
