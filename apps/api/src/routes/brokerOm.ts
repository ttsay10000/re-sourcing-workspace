import { randomUUID } from "crypto";
import { extname } from "path";
import { Router, type Request, type Response } from "express";
import {
  getPool,
  InboxSyncStateRepo,
  PropertyRepo,
  PropertyUploadedDocumentRepo,
} from "@re-sourcing/db";
import type { Property, PropertyDocumentCategory } from "@re-sourcing/contracts";
import {
  getAttachment,
  getAttachmentParts,
  getBodyText,
  getHeader,
  getMessage,
  listMessages,
  type GmailMessage,
  type GmailMessageListItem,
} from "../inquiry/gmailClient.js";
import { classifyInquiryAttachment } from "../inquiry/attachmentClassification.js";
import { saveUploadedDocument } from "../upload/uploadedDocStorage.js";
import { ingestAuthoritativeOm, type OmAutomationDocument } from "../om/ingestAuthoritativeOm.js";
import { syncPropertySourcingWorkflow } from "../sourcing/workflow.js";
import { analyzeAndPersistDealAnalysisOmDocuments, DealAnalysisOmImportError } from "../deal/dealAnalysisOmImport.js";

const router = Router();

const SYSTEM_START_AT = new Date("2026-03-01T00:00:00-05:00");
const DEFAULT_PROPERTY_SEARCH_LIMIT = 50;
const DEFAULT_NEW_PROPERTY_SEARCH_LIMIT = 25;
const MAX_SEARCH_LIMIT = 100;
const LARGE_ATTACHMENT_BYTES =
  Number(process.env.BROKER_OM_EMAIL_LARGE_ATTACHMENT_BYTES) || 10 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES =
  Number(process.env.BROKER_OM_EMAIL_ATTACHMENT_MAX_BYTES) || 25 * 1024 * 1024;

const VALID_DOCUMENT_CATEGORIES: PropertyDocumentCategory[] = [
  "OM",
  "Brochure",
  "Rent Roll",
  "Financial Model",
  "T12 / Operating Summary",
  "Broker Comp Package",
  "Sale Comp Package",
  "Rent Comp Package",
  "Expense Comp Package",
  "Market Analysis",
  "Other",
];

const DEAL_KEYWORD_RE =
  /\b(offering\s+memorandum|offering\s+memo|investment\s+memorandum|confidential\s+offering|\bom\b|rent\s*roll|rentroll|t\s*-?\s*12|trailing\s+twelve|operating\s+statement|financial\s+model|broker\s+package|broker\s+comp|market\s+analysis)\b/i;

type BrokerOmSearchMode = "since_last" | "system_start";

interface GmailDocumentCandidate {
  id: string;
  messageId: string;
  threadId: string | null;
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  large: boolean;
  tooLarge: boolean;
  suggestedCategory: PropertyDocumentCategory;
  classificationConfidence: "high" | "medium" | "low";
  classificationReason: string;
  previewKind: "pdf" | "text" | "none";
  subject: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  bodyPreview: string | null;
  gmailUrl: string | null;
  matchedReason: string;
}

interface NewPropertyEmailCandidate {
  id: string;
  messageId: string;
  threadId: string | null;
  subject: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  bodyPreview: string | null;
  gmailUrl: string | null;
  matchedReason: string;
  attachments: GmailDocumentCandidate[];
}

function propertyCursorKey(propertyId: string): string {
  return `gmail_property_document_pull:${propertyId}`;
}

function normalizeCategory(value: unknown): PropertyDocumentCategory {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (VALID_DOCUMENT_CATEGORIES.includes(trimmed as PropertyDocumentCategory)) {
    return trimmed as PropertyDocumentCategory;
  }
  return "Other";
}

function isOmIngestionCategory(category: PropertyDocumentCategory): boolean {
  return (
    category === "OM" ||
    category === "Brochure" ||
    category === "Rent Roll" ||
    category === "T12 / Operating Summary" ||
    category === "Financial Model"
  );
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addressFirstLine(property: Property): string {
  return property.canonicalAddress.split(",")[0]?.replace(/\s+/g, " ").trim() || property.canonicalAddress;
}

function gmailPhrase(value: string): string {
  return `"${value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()}"`;
}

function gmailDateInclusive(date: Date): string {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() - 1);
  return `${copy.getUTCFullYear()}/${copy.getUTCMonth() + 1}/${copy.getUTCDate()}`;
}

function parseDateHeader(msg: GmailMessage): string | null {
  const dateHeader = getHeader(msg, "Date");
  if (!dateHeader) return null;
  const parsed = new Date(dateHeader);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function messageTimestamp(msg: GmailMessage): number | null {
  const receivedAt = parseDateHeader(msg);
  if (!receivedAt) return null;
  const parsed = new Date(receivedAt).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function compactPreview(value: string, maxLength = 520): string | null {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (!compacted) return null;
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 1)}...` : compacted;
}

function gmailMessageUrl(msg: GmailMessage): string | null {
  const id = msg.threadId || msg.id;
  return id ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}` : null;
}

function previewKind(filename: string, mimeType: string): GmailDocumentCandidate["previewKind"] {
  const ext = extname(filename).toLowerCase();
  const normalizedMime = mimeType.toLowerCase();
  if (normalizedMime.includes("pdf") || ext === ".pdf") return "pdf";
  if (
    normalizedMime.startsWith("text/") ||
    normalizedMime.includes("csv") ||
    [".txt", ".csv"].includes(ext)
  ) {
    return "text";
  }
  return "none";
}

function isDocumentAttachment(filename: string, mimeType: string, suggestedCategory: PropertyDocumentCategory): boolean {
  const ext = extname(filename).toLowerCase();
  const normalizedMime = mimeType.toLowerCase();
  if (suggestedCategory !== "Other") return true;
  return (
    [".pdf", ".xls", ".xlsx", ".xlsm", ".csv", ".doc", ".docx", ".ppt", ".pptx", ".txt"].includes(ext) ||
    normalizedMime.includes("pdf") ||
    normalizedMime.includes("spreadsheet") ||
    normalizedMime.includes("excel") ||
    normalizedMime.includes("csv") ||
    normalizedMime.includes("word") ||
    normalizedMime.includes("document") ||
    normalizedMime.includes("presentation") ||
    normalizedMime.startsWith("text/")
  );
}

function buildDocumentCandidates(msg: GmailMessage, matchedReason: string): GmailDocumentCandidate[] {
  const subject = getHeader(msg, "Subject");
  const fromAddress = getHeader(msg, "From");
  const receivedAt = parseDateHeader(msg);
  const bodyText = getBodyText(msg);
  const bodyPreview = compactPreview(bodyText);
  const gmailUrl = gmailMessageUrl(msg);

  return getAttachmentParts(msg)
    .map((part) => {
      const classification = classifyInquiryAttachment({
        filename: part.filename,
        mimeType: part.mimeType,
      });
      const suggestedCategory = normalizeCategory(classification.reviewCategory);
      const sizeBytes = typeof part.sizeBytes === "number" && Number.isFinite(part.sizeBytes) ? part.sizeBytes : null;
      return {
        id: `${msg.id}:${part.attachmentId}`,
        messageId: msg.id,
        threadId: msg.threadId || null,
        attachmentId: part.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType,
        sizeBytes,
        large: sizeBytes != null ? sizeBytes >= LARGE_ATTACHMENT_BYTES : false,
        tooLarge: sizeBytes != null ? sizeBytes > MAX_ATTACHMENT_BYTES : false,
        suggestedCategory,
        classificationConfidence: classification.confidence,
        classificationReason: classification.reason,
        previewKind: previewKind(part.filename, part.mimeType),
        subject,
        fromAddress,
        receivedAt,
        bodyPreview,
        gmailUrl,
        matchedReason,
      } satisfies GmailDocumentCandidate;
    })
    .filter((candidate) => isDocumentAttachment(candidate.filename, candidate.mimeType, candidate.suggestedCategory));
}

async function listGmailMessages(query: string, maxMessages: number): Promise<GmailMessageListItem[]> {
  const messages: GmailMessageListItem[] = [];
  let pageToken: string | undefined;
  while (messages.length < maxMessages) {
    const page = await listMessages({
      q: query,
      maxResults: Math.min(100, maxMessages - messages.length),
      pageToken,
    });
    messages.push(...page.messages);
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return messages;
}

async function buildCandidatesForQuery(params: {
  query: string;
  baseline: Date;
  maxMessages: number;
  matchedReason: string;
}): Promise<GmailDocumentCandidate[]> {
  const ids = await listGmailMessages(params.query, params.maxMessages);
  const seenAttachments = new Set<string>();
  const candidates: GmailDocumentCandidate[] = [];
  for (const item of ids) {
    const msg = await getMessage(item.id);
    const timestamp = messageTimestamp(msg);
    if (timestamp != null && timestamp < params.baseline.getTime()) continue;
    for (const candidate of buildDocumentCandidates(msg, params.matchedReason)) {
      if (seenAttachments.has(candidate.id)) continue;
      seenAttachments.add(candidate.id);
      candidates.push(candidate);
    }
  }
  return candidates.sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
}

function buildPropertySearchQuery(property: Property, baseline: Date, extraQuery: string | null): string {
  const firstLine = addressFirstLine(property);
  const addressTerms = [firstLine, property.canonicalAddress]
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term, index, terms) => terms.indexOf(term) === index)
    .map(gmailPhrase);
  const addressQuery = addressTerms.length > 1 ? `(${addressTerms.join(" OR ")})` : addressTerms[0] ?? "";
  const suffix = extraQuery?.trim() ? ` ${extraQuery.trim()}` : "";
  return `in:anywhere has:attachment after:${gmailDateInclusive(baseline)} ${addressQuery}${suffix}`.trim();
}

function buildNewPropertySearchQuery(baseline: Date): string {
  return [
    "in:anywhere",
    "has:attachment",
    `after:${gmailDateInclusive(baseline)}`,
    "(",
    [
      gmailPhrase("offering memorandum"),
      gmailPhrase("offering memo"),
      gmailPhrase("confidential offering"),
      gmailPhrase("investment memorandum"),
      gmailPhrase("rent roll"),
      gmailPhrase("rentroll"),
      gmailPhrase("t12"),
      gmailPhrase("t-12"),
      gmailPhrase("operating statement"),
      gmailPhrase("financial model"),
      gmailPhrase("broker package"),
      gmailPhrase("broker comp"),
      gmailPhrase("market analysis"),
      "OM",
    ].join(" OR "),
    ")",
  ].join(" ");
}

function messageMentionsProperty(candidate: GmailDocumentCandidate, property: Property): boolean {
  const firstLine = normalizeSearchText(addressFirstLine(property));
  if (!firstLine) return false;
  const haystack = normalizeSearchText([
    candidate.subject,
    candidate.bodyPreview,
    candidate.filename,
  ].filter(Boolean).join(" "));
  return haystack.includes(firstLine);
}

function dealKeywordReason(candidate: GmailDocumentCandidate): string | null {
  const text = [candidate.subject, candidate.bodyPreview, candidate.filename].filter(Boolean).join(" ");
  const match = text.match(DEAL_KEYWORD_RE);
  return match?.[0] ? `Keyword: ${match[0]}` : null;
}

async function buildNewPropertyCandidates(params: {
  property: Property;
  maxMessages: number;
}): Promise<NewPropertyEmailCandidate[]> {
  const query = buildNewPropertySearchQuery(SYSTEM_START_AT);
  const documents = await buildCandidatesForQuery({
    query,
    baseline: SYSTEM_START_AT,
    maxMessages: params.maxMessages,
    matchedReason: "Deal document keyword since March 2026",
  });
  const grouped = new Map<string, NewPropertyEmailCandidate>();
  for (const document of documents) {
    if (messageMentionsProperty(document, params.property)) continue;
    const reason = dealKeywordReason(document);
    if (!reason) continue;
    const entry = grouped.get(document.messageId) ?? {
      id: document.messageId,
      messageId: document.messageId,
      threadId: document.threadId,
      subject: document.subject,
      fromAddress: document.fromAddress,
      receivedAt: document.receivedAt,
      bodyPreview: document.bodyPreview,
      gmailUrl: document.gmailUrl,
      matchedReason: reason,
      attachments: [],
    };
    entry.attachments.push(document);
    grouped.set(document.messageId, entry);
  }
  return [...grouped.values()].sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
}

function numericBody(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

async function findExistingGmailImport(params: {
  propertyId: string;
  messageId: string;
  attachmentId: string;
}): Promise<{ id: string; filename: string } | null> {
  const pool = getPool();
  const r = await pool.query<{ id: string; filename: string }>(
    `SELECT id, filename
     FROM property_uploaded_documents
     WHERE property_id = $1
       AND source_metadata->>'gmailMessageId' = $2
       AND source_metadata->>'gmailAttachmentId' = $3
     LIMIT 1`,
    [params.propertyId, params.messageId, params.attachmentId]
  );
  return r.rows[0] ?? null;
}

function safeFilename(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || "gmail-attachment";
}

function sourceLabel(fromAddress: string | null): string {
  return fromAddress?.trim() ? `Gmail manual pull from ${fromAddress.trim()}` : "Gmail manual pull";
}

router.get("/broker-om/properties/:id/email-pull-state", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const pool = getPool();
    const property = await new PropertyRepo({ pool }).byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const syncState = await new InboxSyncStateRepo({ pool }).get(propertyCursorKey(propertyId));
    res.json({
      propertyId,
      canonicalAddress: property.canonicalAddress,
      systemStartAt: SYSTEM_START_AT.toISOString(),
      lastPulledAt: syncState?.lastSyncedAt ?? null,
      largeAttachmentBytes: LARGE_ATTACHMENT_BYTES,
      maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[broker-om email pull state]", err);
    res.status(503).json({ error: "Failed to load email pull state.", details: message });
  }
});

router.post("/broker-om/properties/:id/email-search", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const property = await propertyRepo.byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }
    const syncRepo = new InboxSyncStateRepo({ pool });
    const syncState = await syncRepo.get(propertyCursorKey(propertyId));
    const mode: BrokerOmSearchMode = req.body?.mode === "system_start" ? "system_start" : "since_last";
    const baseline =
      mode === "system_start" || !syncState?.lastSyncedAt
        ? SYSTEM_START_AT
        : new Date(syncState.lastSyncedAt);
    const maxMessages = numericBody(req.body?.maxMessages, DEFAULT_PROPERTY_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
    const includeNewPropertyCandidates = req.body?.includeNewPropertyCandidates !== false;
    const maxNewPropertyMessages = numericBody(
      req.body?.maxNewPropertyMessages,
      DEFAULT_NEW_PROPERTY_SEARCH_LIMIT,
      MAX_SEARCH_LIMIT
    );
    const extraQuery = typeof req.body?.query === "string" ? req.body.query.trim() || null : null;
    const query = buildPropertySearchQuery(property, baseline, extraQuery);
    const searchRunAt = new Date().toISOString();

    const [documents, newPropertyCandidates] = await Promise.all([
      buildCandidatesForQuery({
        query,
        baseline,
        maxMessages,
        matchedReason: extraQuery ? "Property address plus user query" : "Property address",
      }),
      includeNewPropertyCandidates
        ? buildNewPropertyCandidates({ property, maxMessages: maxNewPropertyMessages })
        : Promise.resolve([]),
    ]);

    await syncRepo.upsert(propertyCursorKey(propertyId), searchRunAt);
    res.json({
      ok: true,
      property: {
        id: property.id,
        canonicalAddress: property.canonicalAddress,
      },
      mode,
      query,
      baselineAt: baseline.toISOString(),
      previousLastPulledAt: syncState?.lastSyncedAt ?? null,
      searchRunAt,
      lastPulledAt: searchRunAt,
      systemStartAt: SYSTEM_START_AT.toISOString(),
      largeAttachmentBytes: LARGE_ATTACHMENT_BYTES,
      maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
      documents,
      newPropertyCandidates,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[broker-om email search]", err);
    res.status(503).json({ error: "Failed to search Gmail for broker documents.", details: message });
  }
});

router.get("/broker-om/email-attachments/preview", async (req: Request, res: Response) => {
  try {
    const messageId = typeof req.query.messageId === "string" ? req.query.messageId.trim() : "";
    const attachmentId = typeof req.query.attachmentId === "string" ? req.query.attachmentId.trim() : "";
    const filename = safeFilename(req.query.filename);
    const mimeType =
      typeof req.query.mimeType === "string" && req.query.mimeType.trim()
        ? req.query.mimeType.trim()
        : "application/octet-stream";
    if (!messageId || !attachmentId) {
      res.status(400).json({ error: "messageId and attachmentId are required." });
      return;
    }
    const buffer = await getAttachment(messageId, attachmentId);
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      res.status(413).json({
        error: "Attachment too large to preview",
        sizeBytes: buffer.length,
        maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
      });
      return;
    }
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[broker-om attachment preview]", err);
    res.status(503).json({ error: "Failed to load Gmail attachment preview.", details: message });
  }
});

router.post("/broker-om/properties/:id/import-email-documents", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const pool = getPool();
    const property = await new PropertyRepo({ pool }).byId(propertyId);
    if (!property) {
      res.status(404).json({ error: "Property not found", propertyId });
      return;
    }

    const requestedDocuments = Array.isArray(req.body?.documents) ? req.body.documents : [];
    if (requestedDocuments.length === 0) {
      res.status(400).json({ error: "Select at least one Gmail attachment to import." });
      return;
    }

    const docRepo = new PropertyUploadedDocumentRepo({ pool });
    const imported: Array<Awaited<ReturnType<PropertyUploadedDocumentRepo["insert"]>>> = [];
    const skipped: Array<{ messageId: string; attachmentId: string; reason: string; documentId?: string | null }> = [];
    const errors: Array<{ messageId: string; attachmentId: string; error: string }> = [];
    const uploadedAt = new Date().toISOString();

    for (const requestDoc of requestedDocuments) {
      const messageId = typeof requestDoc?.messageId === "string" ? requestDoc.messageId.trim() : "";
      const attachmentId = typeof requestDoc?.attachmentId === "string" ? requestDoc.attachmentId.trim() : "";
      if (!messageId || !attachmentId) {
        errors.push({ messageId, attachmentId, error: "messageId and attachmentId are required." });
        continue;
      }
      const existing = await findExistingGmailImport({ propertyId, messageId, attachmentId });
      if (existing) {
        skipped.push({
          messageId,
          attachmentId,
          reason: "already_imported",
          documentId: existing.id,
        });
        continue;
      }

      try {
        const msg = await getMessage(messageId);
        const attachmentPart = getAttachmentParts(msg).find((part) => part.attachmentId === attachmentId);
        const filename = safeFilename(requestDoc?.filename ?? attachmentPart?.filename);
        const mimeType =
          (typeof requestDoc?.mimeType === "string" && requestDoc.mimeType.trim()) ||
          attachmentPart?.mimeType ||
          "application/octet-stream";
        const category = normalizeCategory(requestDoc?.category ?? requestDoc?.suggestedCategory);
        const buffer = await getAttachment(messageId, attachmentId);
        if (buffer.length === 0) {
          errors.push({ messageId, attachmentId, error: "Gmail returned an empty attachment." });
          continue;
        }
        if (buffer.length > MAX_ATTACHMENT_BYTES) {
          skipped.push({
            messageId,
            attachmentId,
            reason: `too_large:${buffer.length}`,
            documentId: null,
          });
          continue;
        }
        const docId = randomUUID();
        const filePath = await saveUploadedDocument(propertyId, docId, filename, buffer);
        const inserted = await docRepo.insert({
          id: docId,
          propertyId,
          filename,
          contentType: mimeType,
          filePath,
          category,
          source: sourceLabel(getHeader(msg, "From")),
          sourceUrl: gmailMessageUrl(msg),
          sourceMetadata: {
            uploadedVia: "broker_om_manual_gmail_pull",
            uploadedAt,
            gmailMessageId: messageId,
            gmailThreadId: msg.threadId || null,
            gmailAttachmentId: attachmentId,
            gmailSubject: getHeader(msg, "Subject"),
            gmailFrom: getHeader(msg, "From"),
            gmailDate: parseDateHeader(msg),
            originalFileName: filename,
            sizeBytes: buffer.length,
            classificationMethod: requestDoc?.category ? "user_selected" : "filename_auto",
          },
          fileContent: buffer,
        });
        imported.push(inserted);
      } catch (error) {
        errors.push({
          messageId,
          attachmentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const omDocuments: OmAutomationDocument[] = imported
      .filter((document) => isOmIngestionCategory(document.category))
      .map((document) => ({
        id: document.id,
        origin: "uploaded_document",
        filename: document.filename,
        mimeType: document.contentType ?? null,
        filePath: document.filePath,
        category: document.category,
        source: document.source ?? null,
        createdAt: document.createdAt,
      }));
    const runOmReview = req.body?.runOmReview !== false && omDocuments.length > 0;
    const omReview = runOmReview
      ? await ingestAuthoritativeOm({
          propertyId,
          sourceType: "uploaded_document",
          documents: omDocuments,
          autoPromote: false,
          triggerDossier: false,
          pool,
        }).catch((error) => ({
          documentsProcessed: 0,
          documentsSkippedNoFile: 0,
          runId: null,
          snapshotId: null,
          dossierGenerated: false,
          error: error instanceof Error ? error.message : String(error),
        }))
      : null;

    await syncPropertySourcingWorkflow(propertyId, { pool }).catch(() => {});
    res.status(imported.length > 0 ? 201 : 200).json({
      ok: errors.length === 0,
      propertyId,
      imported,
      skipped,
      errors,
      omReview,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[broker-om import email documents]", err);
    res.status(503).json({ error: "Failed to import Gmail documents.", details: message });
  }
});

router.post("/broker-om/create-property-from-email-document", async (req: Request, res: Response) => {
  try {
    const messageId = typeof req.body?.messageId === "string" ? req.body.messageId.trim() : "";
    const attachmentId = typeof req.body?.attachmentId === "string" ? req.body.attachmentId.trim() : "";
    if (!messageId || !attachmentId) {
      res.status(400).json({ error: "messageId and attachmentId are required." });
      return;
    }
    const msg = await getMessage(messageId);
    const part = getAttachmentParts(msg).find((attachment) => attachment.attachmentId === attachmentId);
    const filename = safeFilename(req.body?.filename ?? part?.filename);
    const mimeType =
      (typeof req.body?.mimeType === "string" && req.body.mimeType.trim()) ||
      part?.mimeType ||
      "application/octet-stream";
    const isPdf = mimeType.toLowerCase().includes("pdf") || extname(filename).toLowerCase() === ".pdf";
    if (!isPdf) {
      res.status(400).json({ error: "Creating a property from email currently requires a PDF OM attachment." });
      return;
    }
    const buffer = await getAttachment(messageId, attachmentId);
    if (buffer.length === 0) {
      res.status(400).json({ error: "Gmail returned an empty attachment." });
      return;
    }
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      res.status(413).json({
        error: "Attachment too large to import",
        sizeBytes: buffer.length,
        maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
      });
      return;
    }

    const result = await analyzeAndPersistDealAnalysisOmDocuments({
      documents: [
        {
          filename,
          mimeType,
          buffer,
          sizeBytes: buffer.length,
        },
      ],
      sourceType: "pipeline_document_upload",
      sourceLabel: sourceLabel(getHeader(msg, "From")),
      propertyContext: [
        "Manual broker OM Gmail pull.",
        getHeader(msg, "Subject") ? `Subject: ${getHeader(msg, "Subject")}` : null,
        getBodyText(msg) ? `Email body preview: ${compactPreview(getBodyText(msg), 1200)}` : null,
      ].filter(Boolean).join("\n"),
      sourceMetadata: {
        uploadedVia: "broker_om_manual_new_property_gmail_pull",
        gmailMessageId: messageId,
        gmailThreadId: msg.threadId || null,
        gmailAttachmentId: attachmentId,
        gmailSubject: getHeader(msg, "Subject"),
        gmailFrom: getHeader(msg, "From"),
        gmailDate: parseDateHeader(msg),
        gmailUrl: gmailMessageUrl(msg),
        originalFileName: filename,
      },
    });

    res.status(result.createdProperty ? 201 : 200).json({
      ok: true,
      propertyId: result.propertyId,
      canonicalAddress: result.canonicalAddress,
      createdProperty: result.createdProperty,
      matchStrategy: result.matchStrategy,
      uploadedDocuments: result.uploadedDocuments,
      omReview: result.omReview,
      enrichment: result.enrichment,
    });
  } catch (err) {
    const message = err instanceof DealAnalysisOmImportError || err instanceof Error ? err.message : String(err);
    const status = err instanceof DealAnalysisOmImportError ? err.statusCode : 503;
    console.error("[broker-om create property from email]", err);
    res.status(status).json({ error: "Failed to create property from Gmail OM.", details: message });
  }
});

export default router;
