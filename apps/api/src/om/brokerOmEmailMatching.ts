/**
 * Pure matching/dedup logic for the broker OM email pull.
 *
 * Property matching is document-title-first: an attachment is matched against
 * canonical property addresses by its FILENAME before we ever look at the
 * email subject/body, because brokers regularly send OMs for other buildings
 * on an existing thread. The subject/body is only a fallback when the
 * filename carries no address signal.
 */

export interface EmailMatchPropertyRef {
  id: string;
  canonicalAddress: string;
}

export interface EmailPropertyMatcher extends EmailMatchPropertyRef {
  normalizedFirstLine: string;
}

export type EmailPropertyMatchVia = "filename" | "email";

export interface EmailAttachmentMatchInput {
  filename: string;
  subject: string | null;
  bodyPreview: string | null;
}

export interface EmailAttachmentMatchResult {
  matches: EmailMatchPropertyRef[];
  matchedVia: EmailPropertyMatchVia | null;
}

export function normalizeEmailSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function emailAddressFirstLine(canonicalAddress: string): string {
  return canonicalAddress.split(",")[0]?.replace(/\s+/g, " ").trim() || canonicalAddress;
}

export function buildEmailPropertyMatchers(properties: EmailMatchPropertyRef[]): EmailPropertyMatcher[] {
  return properties
    .map((property) => ({
      id: property.id,
      canonicalAddress: property.canonicalAddress,
      normalizedFirstLine: normalizeEmailSearchText(emailAddressFirstLine(property.canonicalAddress)),
    }))
    .filter((matcher) => matcher.normalizedFirstLine.length >= 5);
}

function matchAgainst(haystack: string, matchers: EmailPropertyMatcher[]): EmailMatchPropertyRef[] {
  if (!haystack) return [];
  return matchers
    .filter((matcher) => haystack.includes(matcher.normalizedFirstLine))
    .sort((a, b) => b.normalizedFirstLine.length - a.normalizedFirstLine.length)
    .map((matcher) => ({ id: matcher.id, canonicalAddress: matcher.canonicalAddress }));
}

/**
 * Heuristic for "this filename names a building": a house number followed by
 * an optional direction and a street word or ordinal ("245 W 14th OM.pdf",
 * "1820-Amsterdam-Ave_RentRoll.xlsx"). Numbers glued to letters ("T12") and
 * years (19xx/20xx) are not treated as house numbers. When this is true and
 * no canonical property matches the filename, we do NOT let the email
 * subject claim the attachment for another property.
 */
export function filenameLooksAddressLike(filename: string): boolean {
  const base = filename.replace(/\.[a-z0-9]+$/i, "");
  return /(?<![a-z0-9])(?!(?:19|20)\d{2}(?![0-9a-z]))\d{1,5}[\s_.-]+(?:(?:e|w|n|s|east|west|north|south)[\s_.-]+)?(?:\d{1,4}(?:st|nd|rd|th)(?![a-z])|[a-z]{2,})/i.test(
    base
  );
}

export function matchPropertiesForEmailAttachment(
  input: EmailAttachmentMatchInput,
  matchers: EmailPropertyMatcher[]
): EmailAttachmentMatchResult {
  const filenameMatches = matchAgainst(normalizeEmailSearchText(input.filename), matchers);
  if (filenameMatches.length > 0) {
    return { matches: filenameMatches, matchedVia: "filename" };
  }
  // A filename that clearly names a building we don't know stays unmatched —
  // the surrounding email is likely about a different property.
  if (filenameLooksAddressLike(input.filename)) {
    return { matches: [], matchedVia: null };
  }
  const emailMatches = matchAgainst(
    normalizeEmailSearchText([input.subject, input.bodyPreview].filter(Boolean).join(" ")),
    matchers
  );
  if (emailMatches.length > 0) {
    return { matches: emailMatches, matchedVia: "email" };
  }
  return { matches: [], matchedVia: null };
}

// ─── Duplicate detection against already-uploaded property documents ───

export interface ExistingPropertyDocumentRef {
  id: string;
  propertyId: string;
  filename: string;
  category: string | null;
  createdAt: string | null;
  gmailMessageId: string | null;
  gmailAttachmentId: string | null;
  sizeBytes: number | null;
  sha256: string | null;
}

export type EmailDuplicateStatus =
  | "already_imported"
  | "exact_duplicate"
  | "likely_duplicate"
  | "possible_duplicate";

export interface EmailDuplicateFlag {
  status: EmailDuplicateStatus;
  propertyId: string;
  documentId: string;
  filename: string;
  category: string | null;
  uploadedAt: string | null;
  reason: string;
  /** True when the flag is backed by a byte-level (sha256) comparison. */
  contentCompared: boolean;
}

export interface EmailDuplicateCandidateInput {
  messageId: string;
  attachmentId: string;
  filename: string;
  sizeBytes: number | null;
}

export function normalizeFilenameForComparison(filename: string): string {
  return normalizeEmailSearchText(filename.replace(/\.[a-z0-9]+$/i, ""));
}

export interface MetadataDuplicateAssessment {
  alreadyImported: ExistingPropertyDocumentRef | null;
  /** Docs worth a byte-level comparison, strongest signal first. */
  comparisonTargets: Array<{
    doc: ExistingPropertyDocumentRef;
    filenameMatch: boolean;
    sizeMatch: boolean;
  }>;
}

export function assessMetadataDuplicates(
  candidate: EmailDuplicateCandidateInput,
  existingDocs: ExistingPropertyDocumentRef[]
): MetadataDuplicateAssessment {
  const alreadyImported =
    existingDocs.find(
      (doc) =>
        doc.gmailMessageId === candidate.messageId &&
        doc.gmailAttachmentId != null &&
        doc.gmailAttachmentId === candidate.attachmentId
    ) ?? null;
  const candidateName = normalizeFilenameForComparison(candidate.filename);
  const comparisonTargets = existingDocs
    .map((doc) => ({
      doc,
      filenameMatch: candidateName.length > 0 && normalizeFilenameForComparison(doc.filename) === candidateName,
      sizeMatch:
        candidate.sizeBytes != null &&
        candidate.sizeBytes > 0 &&
        doc.sizeBytes != null &&
        doc.sizeBytes === candidate.sizeBytes,
    }))
    .filter((entry) => entry.filenameMatch || entry.sizeMatch)
    .sort((a, b) => Number(b.filenameMatch) + Number(b.sizeMatch) - (Number(a.filenameMatch) + Number(a.sizeMatch)));
  return { alreadyImported, comparisonTargets };
}

function shortDate(value: string | null): string {
  if (!value) return "earlier";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "earlier";
  return date.toISOString().slice(0, 10);
}

/**
 * Final duplicate verdict for one candidate. `candidateSha256` is the hash of
 * the Gmail attachment bytes when we were able to download them (null when
 * skipped for size/time budget) — with it we can say "same document" /
 * "different document" definitively instead of guessing from metadata.
 */
export function resolveEmailDuplicateFlag(params: {
  assessment: MetadataDuplicateAssessment;
  candidateSha256: string | null;
}): EmailDuplicateFlag | null {
  const { assessment, candidateSha256 } = params;
  if (assessment.alreadyImported) {
    const doc = assessment.alreadyImported;
    return {
      status: "already_imported",
      propertyId: doc.propertyId,
      documentId: doc.id,
      filename: doc.filename,
      category: doc.category,
      uploadedAt: doc.createdAt,
      reason: `This exact Gmail attachment was already imported on ${shortDate(doc.createdAt)}.`,
      contentCompared: false,
    };
  }
  if (assessment.comparisonTargets.length === 0) return null;

  if (candidateSha256) {
    const exact = assessment.comparisonTargets.find(
      (entry) => entry.doc.sha256 != null && entry.doc.sha256 === candidateSha256
    );
    if (exact) {
      return {
        status: "exact_duplicate",
        propertyId: exact.doc.propertyId,
        documentId: exact.doc.id,
        filename: exact.doc.filename,
        category: exact.doc.category,
        uploadedAt: exact.doc.createdAt,
        reason: `Byte-identical to "${exact.doc.filename}" uploaded ${shortDate(exact.doc.createdAt)}.`,
        contentCompared: true,
      };
    }
    // Content compared and differs: only a same-name doc is still worth a
    // note (likely a newer version); a size-only coincidence is cleared.
    const sameName = assessment.comparisonTargets.find((entry) => entry.filenameMatch);
    if (sameName) {
      return {
        status: "possible_duplicate",
        propertyId: sameName.doc.propertyId,
        documentId: sameName.doc.id,
        filename: sameName.doc.filename,
        category: sameName.doc.category,
        uploadedAt: sameName.doc.createdAt,
        reason: `Same filename as "${sameName.doc.filename}" (uploaded ${shortDate(
          sameName.doc.createdAt
        )}) but the content differs — possibly an updated version.`,
        contentCompared: true,
      };
    }
    return null;
  }

  const strongest = assessment.comparisonTargets[0]!;
  const { doc, filenameMatch, sizeMatch } = strongest;
  if (filenameMatch && sizeMatch) {
    return {
      status: "likely_duplicate",
      propertyId: doc.propertyId,
      documentId: doc.id,
      filename: doc.filename,
      category: doc.category,
      uploadedAt: doc.createdAt,
      reason: `Same filename and size as "${doc.filename}" uploaded ${shortDate(doc.createdAt)} (content not compared).`,
      contentCompared: false,
    };
  }
  return {
    status: "possible_duplicate",
    propertyId: doc.propertyId,
    documentId: doc.id,
    filename: doc.filename,
    category: doc.category,
    uploadedAt: doc.createdAt,
    reason: filenameMatch
      ? `Same filename as "${doc.filename}" uploaded ${shortDate(doc.createdAt)} (content not compared).`
      : `Same file size as "${doc.filename}" uploaded ${shortDate(doc.createdAt)} (content not compared).`,
    contentCompared: false,
  };
}
