import { createHash, randomUUID } from "crypto";
import { extname } from "path";
import { Router, type Request, type Response } from "express";
import {
  BrokerOmEmailPullRunRepo,
  getPool,
  InboxSyncStateRepo,
  PropertyRepo,
  PropertyUploadedDocumentRepo,
  type BrokerOmEmailPullRunRecord,
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
import {
  assessMetadataDuplicates,
  buildEmailPropertyMatchers,
  emailAddressFirstLine,
  filenameLooksAddressLike,
  matchPropertiesForEmailAttachment,
  normalizeEmailSearchText,
  resolveEmailDuplicateFlag,
  type EmailDuplicateFlag,
  type EmailPropertyMatcher,
  type EmailPropertyMatchVia,
  type ExistingPropertyDocumentRef,
} from "../om/brokerOmEmailMatching.js";
import { syncPropertySourcingWorkflow } from "../sourcing/workflow.js";
import { analyzeAndPersistDealAnalysisOmDocuments, DealAnalysisOmImportError } from "../deal/dealAnalysisOmImport.js";

const router = Router();

const SYSTEM_START_AT = new Date("2026-03-01T00:00:00-05:00");
const GLOBAL_PULL_CURSOR_KEY = "gmail_property_document_pull:__all__";
const DEFAULT_PROPERTY_SEARCH_LIMIT = 50;
const DEFAULT_NEW_PROPERTY_SEARCH_LIMIT = 25;
const DEFAULT_GLOBAL_SEARCH_LIMIT = 50;
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
  "Broker Notes",
  "Other",
];

const DEAL_KEYWORD_RE =
  /\b(offering\s+memorandum|offering\s+memo|investment\s+memorandum|confidential\s+offering|om|rent\s*rolls?|rentrolls?|rents?|t\s*-?\s*12|trailing\s+twelve|operating\s+statements?|operating\s+expenses?|expense\s+statements?|expenses?|pro\s*formas?|financial\s+models?|financials?|broker\s+packages?|broker\s+comps?|market\s+analysis)\b/i;

const DEAL_SEARCH_TERMS: string[] = [
  "offering memorandum",
  "offering memo",
  "confidential offering",
  "investment memorandum",
  "rent roll",
  "rentroll",
  "t12",
  "t-12",
  "operating statement",
  "operating expenses",
  "expense statement",
  "pro forma",
  "financial model",
  "broker package",
  "broker comp",
  "market analysis",
];

const DEAL_SEARCH_BARE_TERMS: string[] = ["OM", "rent", "rents", "expenses", "financials"];

type BrokerOmSearchMode = "since_last" | "system_start" | "custom";

interface MatchedPropertyRef {
  id: string;
  canonicalAddress: string;
}

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
  matchedProperty?: MatchedPropertyRef | null;
  matchedProperties?: MatchedPropertyRef[];
  /** How the property match was made: attachment filename (preferred) or email subject/body fallback. */
  matchedVia?: EmailPropertyMatchVia | null;
  /** Set when the attachment looks like a duplicate of a document already uploaded to the matched property. */
  duplicate?: EmailDuplicateFlag | null;
  /** True when an earlier pull in this scope already surfaced this attachment. */
  previouslyPulled?: boolean;
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

/**
 * Wall-clock budget for a single email scan. Gmail calls are made serially per
 * message, so without a budget one slow mailbox keeps the HTTP request open
 * for minutes (the "hung email pull"). When the budget is hit we return what
 * we have plus truncated=true so the UI can say "partial — pull again".
 */
const EMAIL_SEARCH_BUDGET_MS = Number(process.env.BROKER_OM_EMAIL_SEARCH_BUDGET_MS) || 90_000;

async function listGmailMessages(query: string, maxMessages: number, deadlineAtMs?: number): Promise<GmailMessageListItem[]> {
  const messages: GmailMessageListItem[] = [];
  let pageToken: string | undefined;
  while (messages.length < maxMessages) {
    if (deadlineAtMs != null && Date.now() >= deadlineAtMs) break;
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
  deadlineAtMs?: number;
}): Promise<{ documents: GmailDocumentCandidate[]; truncated: boolean }> {
  const deadlineAtMs = params.deadlineAtMs ?? Date.now() + EMAIL_SEARCH_BUDGET_MS;
  const ids = await listGmailMessages(params.query, params.maxMessages, deadlineAtMs);
  const seenAttachments = new Set<string>();
  const candidates: GmailDocumentCandidate[] = [];
  let truncated = false;
  for (const item of ids) {
    if (Date.now() >= deadlineAtMs) {
      truncated = true;
      break;
    }
    const msg = await getMessage(item.id);
    const timestamp = messageTimestamp(msg);
    if (timestamp != null && timestamp < params.baseline.getTime()) continue;
    for (const candidate of buildDocumentCandidates(msg, params.matchedReason)) {
      if (seenAttachments.has(candidate.id)) continue;
      seenAttachments.add(candidate.id);
      candidates.push(candidate);
    }
  }
  return {
    documents: candidates.sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? "")),
    truncated,
  };
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

function buildDealKeywordSearchQuery(baseline: Date, extraQuery?: string | null): string {
  const keywordClause = `(${[...DEAL_SEARCH_TERMS.map(gmailPhrase), ...DEAL_SEARCH_BARE_TERMS].join(" OR ")})`;
  const suffix = extraQuery?.trim() ? ` ${extraQuery.trim()}` : "";
  return `in:anywhere has:attachment after:${gmailDateInclusive(baseline)} ${keywordClause}${suffix}`.trim();
}

interface ResolvedBaseline {
  mode: BrokerOmSearchMode;
  baseline: Date;
  error?: string;
}

function resolveBaseline(body: Record<string, unknown> | undefined, lastSyncedAt: string | null): ResolvedBaseline {
  const rawMode = body?.mode;
  if (rawMode === "custom") {
    const rawSince = typeof body?.sinceDate === "string" ? body.sinceDate.trim() : "";
    const sinceDate = rawSince ? new Date(rawSince) : null;
    if (!sinceDate || Number.isNaN(sinceDate.getTime())) {
      return {
        mode: "custom",
        baseline: SYSTEM_START_AT,
        error: "Custom pulls require a valid sinceDate (ISO date string).",
      };
    }
    return { mode: "custom", baseline: sinceDate };
  }
  if (rawMode === "system_start") {
    return { mode: "system_start", baseline: SYSTEM_START_AT };
  }
  return {
    mode: "since_last",
    baseline: lastSyncedAt ? new Date(lastSyncedAt) : SYSTEM_START_AT,
  };
}

/** Max attachments downloaded per pull purely to hash-compare against existing documents. */
const MAX_DUPLICATE_CONTENT_COMPARISONS =
  Number(process.env.BROKER_OM_EMAIL_DUP_COMPARE_LIMIT) || 6;

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Existing uploaded documents for the given properties with everything needed
 * for duplicate checks. The content hash is computed in Postgres so document
 * bytes never leave the database; rows imported after this change also carry
 * the hash in source_metadata, which is used first.
 */
async function loadExistingDocumentRefs(
  pool: ReturnType<typeof getPool>,
  propertyIds: string[]
): Promise<ExistingPropertyDocumentRef[]> {
  if (propertyIds.length === 0) return [];
  const r = await pool.query(
    `SELECT id, property_id, filename, category, created_at,
            source_metadata->>'gmailMessageId' AS gmail_message_id,
            source_metadata->>'gmailAttachmentId' AS gmail_attachment_id,
            NULLIF(source_metadata->>'sizeBytes', '')::bigint AS meta_size_bytes,
            octet_length(file_content) AS content_size_bytes,
            COALESCE(source_metadata->>'sha256', encode(sha256(file_content), 'hex')) AS sha256
     FROM property_uploaded_documents
     WHERE property_id = ANY($1)`,
    [propertyIds]
  );
  return r.rows.map((row: Record<string, unknown>) => {
    const metaSize = row.meta_size_bytes != null ? Number(row.meta_size_bytes) : null;
    const contentSize = row.content_size_bytes != null ? Number(row.content_size_bytes) : null;
    return {
      id: String(row.id),
      propertyId: String(row.property_id),
      filename: String(row.filename ?? ""),
      category: row.category != null ? String(row.category) : null,
      createdAt: row.created_at != null ? new Date(String(row.created_at)).toISOString() : null,
      gmailMessageId: row.gmail_message_id != null ? String(row.gmail_message_id) : null,
      gmailAttachmentId: row.gmail_attachment_id != null ? String(row.gmail_attachment_id) : null,
      sizeBytes: Number.isFinite(metaSize) && metaSize! > 0 ? metaSize : Number.isFinite(contentSize) && contentSize! > 0 ? contentSize : null,
      sha256: row.sha256 != null ? String(row.sha256) : null,
    } satisfies ExistingPropertyDocumentRef;
  });
}

/**
 * Attach property matches (filename first, email fallback) and duplicate
 * flags to pulled candidates. Duplicate flags are confirmed byte-for-byte
 * (bounded by MAX_DUPLICATE_CONTENT_COMPARISONS and the request deadline)
 * whenever filename/size metadata suggests the property already has the
 * document.
 */
async function annotateCandidates(params: {
  pool: ReturnType<typeof getPool>;
  documents: GmailDocumentCandidate[];
  matchers: EmailPropertyMatcher[];
  /** Property the pull is scoped to; unmatched attachments default to it unless their filename names another building. */
  contextProperty?: Property | null;
  deadlineAtMs: number;
}): Promise<GmailDocumentCandidate[]> {
  const { pool, documents, matchers, contextProperty, deadlineAtMs } = params;
  const matchResults = documents.map((candidate) =>
    matchPropertiesForEmailAttachment(
      { filename: candidate.filename, subject: candidate.subject, bodyPreview: candidate.bodyPreview },
      matchers
    )
  );

  const relevantPropertyIds = new Set<string>();
  if (contextProperty) relevantPropertyIds.add(contextProperty.id);
  for (const result of matchResults) {
    for (const match of result.matches) relevantPropertyIds.add(match.id);
  }
  const existingDocs = await loadExistingDocumentRefs(pool, [...relevantPropertyIds]);
  const docsByProperty = new Map<string, ExistingPropertyDocumentRef[]>();
  for (const doc of existingDocs) {
    const list = docsByProperty.get(doc.propertyId);
    if (list) list.push(doc);
    else docsByProperty.set(doc.propertyId, [doc]);
  }

  let comparisonsUsed = 0;
  const annotated: GmailDocumentCandidate[] = [];
  for (let index = 0; index < documents.length; index++) {
    const candidate = documents[index]!;
    const result = matchResults[index]!;
    let matches = result.matches;
    let matchedVia: EmailPropertyMatchVia | null = result.matchedVia;
    let matchedReason = candidate.matchedReason;
    if (matches.length > 0) {
      const first = matches[0]!;
      matchedReason = `${matchedVia === "filename" ? "Filename" : "Email"} matches ${first.canonicalAddress.split(",")[0]?.trim() || first.canonicalAddress}`;
    } else if (contextProperty) {
      if (filenameLooksAddressLike(candidate.filename)) {
        matchedReason = "Filename looks like a different building — review before importing here";
      } else {
        matches = [{ id: contextProperty.id, canonicalAddress: contextProperty.canonicalAddress }];
        matchedVia = "email";
      }
    }

    // Duplicate check against every property this attachment could land on
    // (the scoped property included — that is where an import defaults to).
    const duplicateScopeIds = new Set<string>(matches.map((match) => match.id));
    if (contextProperty) duplicateScopeIds.add(contextProperty.id);
    const scopedDocs = [...duplicateScopeIds].flatMap((id) => docsByProperty.get(id) ?? []);
    const assessment = assessMetadataDuplicates(
      {
        messageId: candidate.messageId,
        attachmentId: candidate.attachmentId,
        filename: candidate.filename,
        sizeBytes: candidate.sizeBytes,
      },
      scopedDocs
    );
    let candidateSha256: string | null = null;
    if (
      !assessment.alreadyImported &&
      assessment.comparisonTargets.length > 0 &&
      !candidate.tooLarge &&
      comparisonsUsed < MAX_DUPLICATE_CONTENT_COMPARISONS &&
      Date.now() < deadlineAtMs
    ) {
      comparisonsUsed++;
      try {
        candidateSha256 = sha256Hex(await getAttachment(candidate.messageId, candidate.attachmentId));
      } catch (err) {
        console.warn("[broker-om dup compare] attachment download failed", err instanceof Error ? err.message : err);
      }
    }
    const duplicate = resolveEmailDuplicateFlag({ assessment, candidateSha256 });

    annotated.push({
      ...candidate,
      matchedReason,
      matchedProperty: matches[0] ?? null,
      matchedProperties: matches,
      matchedVia: matches.length > 0 ? matchedVia : null,
      duplicate,
    });
  }
  return annotated;
}

interface PullLedgerResult {
  fresh: GmailDocumentCandidate[];
  skippedPreviouslyPulled: number;
}

/**
 * Drop (or mark, when includePreviouslyPulled) attachments earlier pulls in
 * this scope already surfaced. Matches on (message, attachmentId) and on
 * (message, filename) since Gmail attachment ids are not guaranteed stable.
 */
async function applyPullLedger(params: {
  pullRepo: BrokerOmEmailPullRunRepo;
  scopeKey: string;
  documents: GmailDocumentCandidate[];
  includePreviouslyPulled: boolean;
}): Promise<PullLedgerResult> {
  const { pullRepo, scopeKey, documents, includePreviouslyPulled } = params;
  if (documents.length === 0) return { fresh: [], skippedPreviouslyPulled: 0 };
  const messageIds = [...new Set(documents.map((document) => document.messageId))];
  const seen = await pullRepo.seenAttachmentsForMessages(scopeKey, messageIds);
  const seenKeys = new Set<string>();
  for (const entry of seen) {
    seenKeys.add(`${entry.messageId}:att:${entry.attachmentId}`);
    if (entry.filename) seenKeys.add(`${entry.messageId}:name:${entry.filename}`);
  }
  const fresh: GmailDocumentCandidate[] = [];
  let skippedPreviouslyPulled = 0;
  for (const document of documents) {
    const wasPulled =
      seenKeys.has(`${document.messageId}:att:${document.attachmentId}`) ||
      seenKeys.has(`${document.messageId}:name:${document.filename}`);
    if (wasPulled && !includePreviouslyPulled) {
      skippedPreviouslyPulled++;
      continue;
    }
    fresh.push(wasPulled ? { ...document, previouslyPulled: true } : document);
  }
  return { fresh, skippedPreviouslyPulled };
}

async function persistPullRun(params: {
  pullRepo: BrokerOmEmailPullRunRepo;
  scopeKey: string;
  propertyId: string | null;
  mode: BrokerOmSearchMode;
  query: string;
  baselineAt: string;
  runAt: string;
  truncated: boolean;
  totalFound: number;
  skippedPreviouslyPulled: number;
  documents: GmailDocumentCandidate[];
}): Promise<BrokerOmEmailPullRunRecord | null> {
  try {
    await params.pullRepo.recordPulledAttachments(
      params.scopeKey,
      params.documents.map((document) => ({
        messageId: document.messageId,
        attachmentId: document.attachmentId,
        filename: document.filename,
        sizeBytes: document.sizeBytes,
      }))
    );
    return await params.pullRepo.insertRun({
      scopeKey: params.scopeKey,
      propertyId: params.propertyId,
      mode: params.mode,
      query: params.query,
      baselineAt: params.baselineAt,
      runAt: params.runAt,
      truncated: params.truncated,
      documentCount: params.totalFound,
      newDocumentCount: params.documents.filter((document) => !document.previouslyPulled).length,
      skippedPreviouslyPulled: params.skippedPreviouslyPulled,
      documents: params.documents,
    });
  } catch (err) {
    // Persisting the run is bookkeeping; the pull response must not fail on it.
    console.warn("[broker-om persist pull run]", err instanceof Error ? err.message : err);
    return null;
  }
}

function dealKeywordReason(candidate: GmailDocumentCandidate): string | null {
  const text = [candidate.subject, candidate.bodyPreview, candidate.filename].filter(Boolean).join(" ");
  const match = text.match(DEAL_KEYWORD_RE);
  return match?.[0] ? `Keyword: ${match[0]}` : null;
}

async function buildNewPropertyCandidates(params: {
  matchers: EmailPropertyMatcher[];
  maxMessages: number;
  deadlineAtMs?: number;
}): Promise<NewPropertyEmailCandidate[]> {
  const query = buildDealKeywordSearchQuery(SYSTEM_START_AT);
  const { documents } = await buildCandidatesForQuery({
    query,
    baseline: SYSTEM_START_AT,
    maxMessages: params.maxMessages,
    matchedReason: "Deal document keyword since March 2026",
    deadlineAtMs: params.deadlineAtMs,
  });
  const grouped = new Map<string, NewPropertyEmailCandidate>();
  for (const document of documents) {
    // Anything matching a property we already track (by filename first, then
    // email subject/body) is not a new-property candidate.
    const match = matchPropertiesForEmailAttachment(
      { filename: document.filename, subject: document.subject, bodyPreview: document.bodyPreview },
      params.matchers
    );
    if (match.matches.length > 0) continue;
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
    const [syncState, latestRun] = await Promise.all([
      new InboxSyncStateRepo({ pool }).get(propertyCursorKey(propertyId)),
      new BrokerOmEmailPullRunRepo({ pool }).latestForScope(propertyCursorKey(propertyId)),
    ]);
    res.json({
      propertyId,
      canonicalAddress: property.canonicalAddress,
      systemStartAt: SYSTEM_START_AT.toISOString(),
      lastPulledAt: syncState?.lastSyncedAt ?? null,
      largeAttachmentBytes: LARGE_ATTACHMENT_BYTES,
      maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
      latestRun,
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
    const { mode, baseline, error: baselineError } = resolveBaseline(req.body, syncState?.lastSyncedAt ?? null);
    if (baselineError) {
      res.status(400).json({ error: baselineError });
      return;
    }
    const maxMessages = numericBody(req.body?.maxMessages, DEFAULT_PROPERTY_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
    const includeNewPropertyCandidates = req.body?.includeNewPropertyCandidates !== false;
    const includePreviouslyPulled = req.body?.includePreviouslyPulled === true;
    const maxNewPropertyMessages = numericBody(
      req.body?.maxNewPropertyMessages,
      DEFAULT_NEW_PROPERTY_SEARCH_LIMIT,
      MAX_SEARCH_LIMIT
    );
    const extraQuery = typeof req.body?.query === "string" ? req.body.query.trim() || null : null;
    const query = buildPropertySearchQuery(property, baseline, extraQuery);
    const searchRunAt = new Date().toISOString();
    const deadlineAtMs = Date.now() + EMAIL_SEARCH_BUDGET_MS;

    const properties = await propertyRepo.list();
    const matchers = buildEmailPropertyMatchers(properties);
    const [searchResult, newPropertyCandidates] = await Promise.all([
      buildCandidatesForQuery({
        query,
        baseline,
        maxMessages,
        matchedReason: extraQuery ? "Property address plus user query" : "Property address",
        deadlineAtMs,
      }),
      includeNewPropertyCandidates
        ? buildNewPropertyCandidates({ matchers, maxMessages: maxNewPropertyMessages, deadlineAtMs })
        : Promise.resolve([]),
    ]);

    const pullRepo = new BrokerOmEmailPullRunRepo({ pool });
    const scopeKey = propertyCursorKey(propertyId);
    const { fresh, skippedPreviouslyPulled } = await applyPullLedger({
      pullRepo,
      scopeKey,
      documents: searchResult.documents,
      includePreviouslyPulled,
    });
    const documents = await annotateCandidates({
      pool,
      documents: fresh,
      matchers,
      contextProperty: property,
      deadlineAtMs,
    });
    const storedRun = await persistPullRun({
      pullRepo,
      scopeKey,
      propertyId,
      mode,
      query,
      baselineAt: baseline.toISOString(),
      runAt: searchRunAt,
      truncated: searchResult.truncated,
      totalFound: searchResult.documents.length,
      skippedPreviouslyPulled,
      documents,
    });

    await syncRepo.upsert(scopeKey, searchRunAt);
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
      totalFound: searchResult.documents.length,
      skippedPreviouslyPulled,
      truncated: searchResult.truncated,
      runId: storedRun?.id ?? null,
      newPropertyCandidates,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[broker-om email search]", err);
    res.status(503).json({ error: "Failed to search Gmail for broker documents.", details: message });
  }
});

router.get("/broker-om/email-pull-state", async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const [syncState, latestRun] = await Promise.all([
      new InboxSyncStateRepo({ pool }).get(GLOBAL_PULL_CURSOR_KEY),
      new BrokerOmEmailPullRunRepo({ pool }).latestForScope(GLOBAL_PULL_CURSOR_KEY),
    ]);
    res.json({
      propertyId: null,
      canonicalAddress: null,
      systemStartAt: SYSTEM_START_AT.toISOString(),
      lastPulledAt: syncState?.lastSyncedAt ?? null,
      largeAttachmentBytes: LARGE_ATTACHMENT_BYTES,
      maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
      latestRun,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[broker-om global email pull state]", err);
    res.status(503).json({ error: "Failed to load email pull state.", details: message });
  }
});

router.post("/broker-om/email-search", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const syncRepo = new InboxSyncStateRepo({ pool });
    const syncState = await syncRepo.get(GLOBAL_PULL_CURSOR_KEY);
    const { mode, baseline, error: baselineError } = resolveBaseline(req.body, syncState?.lastSyncedAt ?? null);
    if (baselineError) {
      res.status(400).json({ error: baselineError });
      return;
    }
    const maxMessages = numericBody(req.body?.maxMessages, DEFAULT_GLOBAL_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
    const includePreviouslyPulled = req.body?.includePreviouslyPulled === true;
    const extraQuery = typeof req.body?.query === "string" ? req.body.query.trim() || null : null;
    const query = buildDealKeywordSearchQuery(baseline, extraQuery);
    const searchRunAt = new Date().toISOString();
    const deadlineAtMs = Date.now() + EMAIL_SEARCH_BUDGET_MS;

    const [searchResult, properties] = await Promise.all([
      buildCandidatesForQuery({
        query,
        baseline,
        maxMessages,
        matchedReason: "Deal document keywords",
        deadlineAtMs,
      }),
      new PropertyRepo({ pool }).list(),
    ]);

    const matchers = buildEmailPropertyMatchers(properties);
    const pullRepo = new BrokerOmEmailPullRunRepo({ pool });
    const { fresh, skippedPreviouslyPulled } = await applyPullLedger({
      pullRepo,
      scopeKey: GLOBAL_PULL_CURSOR_KEY,
      documents: searchResult.documents,
      includePreviouslyPulled,
    });
    const annotated = await annotateCandidates({
      pool,
      documents: fresh,
      matchers,
      deadlineAtMs,
    });
    const documents = annotated.map((candidate) => {
      if (candidate.matchedProperty) return candidate;
      const keywordReason = dealKeywordReason(candidate);
      return keywordReason ? { ...candidate, matchedReason: keywordReason } : candidate;
    });
    const storedRun = await persistPullRun({
      pullRepo,
      scopeKey: GLOBAL_PULL_CURSOR_KEY,
      propertyId: null,
      mode,
      query,
      baselineAt: baseline.toISOString(),
      runAt: searchRunAt,
      truncated: searchResult.truncated,
      totalFound: searchResult.documents.length,
      skippedPreviouslyPulled,
      documents,
    });

    await syncRepo.upsert(GLOBAL_PULL_CURSOR_KEY, searchRunAt);
    res.json({
      ok: true,
      property: null,
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
      totalFound: searchResult.documents.length,
      skippedPreviouslyPulled,
      truncated: searchResult.truncated,
      runId: storedRun?.id ?? null,
      newPropertyCandidates: [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[broker-om global email search]", err);
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

interface EmailImportRequestDoc {
  messageId?: unknown;
  attachmentId?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  category?: unknown;
  suggestedCategory?: unknown;
  propertyId?: unknown;
}

/** Imported row plus everything the deal-analysis run needs (bytes + email context). */
interface ImportedEmailDocument {
  inserted: Awaited<ReturnType<PropertyUploadedDocumentRepo["insert"]>>;
  buffer: Buffer;
  mimeType: string;
  messageId: string;
  subject: string | null;
  fromAddress: string | null;
}

async function findExistingContentDuplicate(params: {
  pool: ReturnType<typeof getPool>;
  propertyId: string;
  sha256: string;
}): Promise<{ id: string; filename: string } | null> {
  const r = await params.pool.query<{ id: string; filename: string }>(
    `SELECT id, filename
     FROM property_uploaded_documents
     WHERE property_id = $1
       AND (source_metadata->>'sha256' = $2 OR encode(sha256(file_content), 'hex') = $2)
     LIMIT 1`,
    [params.propertyId, params.sha256]
  );
  return r.rows[0] ?? null;
}

/**
 * The deal-analysis LLM run for OM-category documents imported from Gmail —
 * the same single-package process the deal-analysis upload page uses (the
 * all-properties import calls this once per property group, mirroring the
 * batch/separate-properties process). It extracts, promotes the snapshot,
 * refreshes deal signals, and runs enrichment so the property carries all
 * derived characteristics without a manual review step.
 */
async function runEmailImportDealAnalysis(params: {
  pool: ReturnType<typeof getPool>;
  property: Property;
  documents: ImportedEmailDocument[];
}) {
  const { pool, property, documents } = params;
  const subjects = [...new Set(documents.map((document) => document.subject).filter(Boolean))] as string[];
  const fromAddresses = [...new Set(documents.map((document) => document.fromAddress).filter(Boolean))] as string[];
  try {
    const result = await analyzeAndPersistDealAnalysisOmDocuments({
      documents: documents.map((document) => ({
        filename: document.inserted.filename,
        mimeType: document.mimeType,
        buffer: document.buffer,
        sizeBytes: document.buffer.length,
      })),
      sourceType: "pipeline_document_upload",
      sourceLabel: sourceLabel(fromAddresses[0] ?? null),
      targetPropertyId: property.id,
      propertyContext: [
        `Broker OM email import for tracked property: ${property.canonicalAddress}.`,
        "Determine the property address from the attached documents themselves (cover page, title, headers). Broker threads often carry OMs for other buildings, so the email subject below is fallback context only — use it solely when the documents state no address.",
        subjects.length > 0 ? `Email subject(s) (fallback context only): ${subjects.join(" | ")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      sourceMetadata: {
        uploadedVia: "broker_om_manual_gmail_pull",
        gmailMessageIds: [...new Set(documents.map((document) => document.messageId))],
      },
      runDossier: false,
      prePersistedDocuments: documents.map((document) => ({
        id: document.inserted.id,
        fileName: document.inserted.filename,
        contentType: document.inserted.contentType ?? null,
        category: document.inserted.category ?? null,
        createdAt: document.inserted.createdAt,
      })),
      pool,
    });

    // Safety check for threads carrying someone else's OM: compare the
    // address the documents themselves state with the target property.
    const extractedFirstLine = result.resolvedAddress
      ? normalizeEmailSearchText(result.resolvedAddress.addressLine)
      : null;
    const propertyFirstLine = normalizeEmailSearchText(emailAddressFirstLine(property.canonicalAddress));
    const addressMismatch =
      extractedFirstLine && propertyFirstLine && extractedFirstLine !== propertyFirstLine
        ? {
            extractedAddress: result.resolvedAddress?.canonicalAddress ?? null,
            propertyAddress: property.canonicalAddress,
            warning: `The document states ${result.resolvedAddress?.canonicalAddress ?? "a different address"} but was imported to ${property.canonicalAddress}.`,
          }
        : null;

    return {
      ok: true,
      dealAnalysis: true,
      status: "promoted" as const,
      runId: result.omReview?.runId ?? null,
      snapshotId: result.omReview?.snapshotId ?? null,
      dossierGenerated: result.omReview?.dossierGenerated ?? false,
      underwritingRefreshed: result.omReview?.underwritingRefreshed ?? false,
      documentsProcessed: documents.length,
      extractedAddress: result.resolvedAddress?.canonicalAddress ?? null,
      addressMismatch,
      enrichment: result.enrichment ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      dealAnalysis: true,
      status: "failed" as const,
      runId: null,
      snapshotId: null,
      dossierGenerated: false,
      underwritingRefreshed: false,
      documentsProcessed: documents.length,
      extractedAddress: null,
      addressMismatch: null,
      enrichment: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function importEmailDocumentsForProperty(params: {
  pool: ReturnType<typeof getPool>;
  property: Property;
  documents: EmailImportRequestDoc[];
  runOmReview: boolean;
}) {
  const { pool, property } = params;
  const propertyId = property.id;
  const docRepo = new PropertyUploadedDocumentRepo({ pool });
  const imported: Array<Awaited<ReturnType<PropertyUploadedDocumentRepo["insert"]>>> = [];
  const importedWithBuffers: ImportedEmailDocument[] = [];
  const skipped: Array<{ messageId: string; attachmentId: string; reason: string; documentId?: string | null }> = [];
  const errors: Array<{ messageId: string; attachmentId: string; error: string }> = [];
  const uploadedAt = new Date().toISOString();

  for (const requestDoc of params.documents) {
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
      // Byte-identical to a document this property already has (regardless of
      // which email it arrived on) — skip instead of storing a duplicate.
      const contentSha256 = sha256Hex(buffer);
      const contentDuplicate = await findExistingContentDuplicate({ pool, propertyId, sha256: contentSha256 });
      if (contentDuplicate) {
        skipped.push({
          messageId,
          attachmentId,
          reason: `duplicate_content:${contentDuplicate.filename}`,
          documentId: contentDuplicate.id,
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
          sha256: contentSha256,
          classificationMethod: requestDoc?.category ? "user_selected" : "filename_auto",
        },
        fileContent: buffer,
      });
      imported.push(inserted);
      importedWithBuffers.push({
        inserted,
        buffer,
        mimeType,
        messageId,
        subject: getHeader(msg, "Subject"),
        fromAddress: getHeader(msg, "From"),
      });
    } catch (error) {
      errors.push({
        messageId,
        attachmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const omDocuments = importedWithBuffers.filter((document) => isOmIngestionCategory(document.inserted.category));
  const omReview =
    params.runOmReview && omDocuments.length > 0
      ? await runEmailImportDealAnalysis({ pool, property, documents: omDocuments })
      : null;

  await syncPropertySourcingWorkflow(propertyId, { pool }).catch(() => {});
  return { imported, skipped, errors, omReview };
}

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

    const { imported, skipped, errors, omReview } = await importEmailDocumentsForProperty({
      pool,
      property,
      documents: requestedDocuments,
      runOmReview: req.body?.runOmReview !== false,
    });
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

router.post("/broker-om/import-email-documents", async (req: Request, res: Response) => {
  try {
    const requestedDocuments: EmailImportRequestDoc[] = Array.isArray(req.body?.documents) ? req.body.documents : [];
    if (requestedDocuments.length === 0) {
      res.status(400).json({ error: "Select at least one Gmail attachment to import." });
      return;
    }

    const pool = getPool();
    const propertyRepo = new PropertyRepo({ pool });
    const runOmReview = req.body?.runOmReview !== false;

    const errors: Array<{ messageId: string; attachmentId: string; error: string }> = [];
    const grouped = new Map<string, EmailImportRequestDoc[]>();
    for (const requestDoc of requestedDocuments) {
      const docPropertyId = typeof requestDoc?.propertyId === "string" ? requestDoc.propertyId.trim() : "";
      const messageId = typeof requestDoc?.messageId === "string" ? requestDoc.messageId.trim() : "";
      const attachmentId = typeof requestDoc?.attachmentId === "string" ? requestDoc.attachmentId.trim() : "";
      if (!docPropertyId) {
        errors.push({
          messageId,
          attachmentId,
          error: "Assign a property to each document before importing an all-properties pull.",
        });
        continue;
      }
      const group = grouped.get(docPropertyId);
      if (group) group.push(requestDoc);
      else grouped.set(docPropertyId, [requestDoc]);
    }

    const imported: Array<Awaited<ReturnType<PropertyUploadedDocumentRepo["insert"]>>> = [];
    const skipped: Array<{ messageId: string; attachmentId: string; reason: string; documentId?: string | null }> = [];
    const omReviews: Array<{ propertyId: string; canonicalAddress: string; omReview: unknown }> = [];
    for (const [docPropertyId, documents] of grouped) {
      const property = await propertyRepo.byId(docPropertyId);
      if (!property) {
        for (const requestDoc of documents) {
          errors.push({
            messageId: typeof requestDoc?.messageId === "string" ? requestDoc.messageId : "",
            attachmentId: typeof requestDoc?.attachmentId === "string" ? requestDoc.attachmentId : "",
            error: `Property not found: ${docPropertyId}`,
          });
        }
        continue;
      }
      const result = await importEmailDocumentsForProperty({
        pool,
        property,
        documents,
        runOmReview,
      });
      imported.push(...result.imported);
      skipped.push(...result.skipped);
      errors.push(...result.errors);
      if (result.omReview) {
        omReviews.push({
          propertyId: docPropertyId,
          canonicalAddress: property.canonicalAddress,
          omReview: result.omReview,
        });
      }
    }

    res.status(imported.length > 0 ? 201 : 200).json({
      ok: errors.length === 0,
      imported,
      skipped,
      errors,
      omReviews,
      omReview: omReviews[0]?.omReview ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[broker-om import email documents all-properties]", err);
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
        "Determine the property address from the attached document itself (cover page, title, headers). Broker threads often reference a different building in the subject line — only fall back to the email subject/body below when the document states no address.",
        getHeader(msg, "Subject") ? `Email subject (fallback context only): ${getHeader(msg, "Subject")}` : null,
        getBodyText(msg) ? `Email body preview (fallback context only): ${compactPreview(getBodyText(msg), 1200)}` : null,
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
