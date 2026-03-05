/**
 * Parse address from email subject for property matching.
 * (1) Strict: "Inquiry about [address]" or "Re: Inquiry about [address]" -> address after prefix.
 * (2) Fallback: subject contains any known property address first line -> that address.
 * We care mostly that the subject includes the property address; exact wording may vary.
 */

const PREFIXES = [
  /inquiry\s+about\s+/i,
  /re:\s*inquiry\s+about\s+/i,
  /fwd:\s*inquiry\s+about\s+/i,
  /re:\s*fwd:\s*inquiry\s+about\s+/i,
];

export function collapseSpaces(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * Normalize subject for matching: strip Re:/Fwd:, collapse spaces, lowercased for contains check.
 */
function normalizeSubjectForMatch(subject: string): string {
  const stripped = subject.replace(/^(re:\s*|fwd:\s*)+/gi, "").trim();
  return collapseSpaces(stripped).toLowerCase();
}

/**
 * Extract address from subject using strict "Inquiry about [address]" (and Re:/Fwd:) prefix.
 * E.g. "Re: Inquiry about 416 West 20th Street" -> "416 West 20th Street". Returns null if no prefix.
 */
export function parseAddressFromInquirySubject(subject: string | null | undefined): string | null {
  if (subject == null || typeof subject !== "string") return null;
  const trimmed = subject.trim();
  if (!trimmed) return null;
  for (const re of PREFIXES) {
    const match = trimmed.match(re);
    if (match) {
      const after = trimmed.slice(match.index! + match[0].length).trim();
      const normalized = collapseSpaces(after);
      return normalized || null;
    }
  }
  return null;
}

/**
 * If subject doesn't match the strict prefix, check whether it contains any known property address.
 * Returns the matching address first line (longest match wins to avoid "20" matching "20th Street").
 */
export function parseAddressFromSubjectFallback(
  subject: string | null | undefined,
  addressFirstLines: string[]
): string | null {
  if (subject == null || typeof subject !== "string" || addressFirstLines.length === 0) return null;
  const normalizedSubject = normalizeSubjectForMatch(subject);
  if (!normalizedSubject) return null;
  const candidates = addressFirstLines
    .map((line) => collapseSpaces(line))
    .filter((line) => line.length > 0)
    .filter((line) => normalizedSubject.includes(line.toLowerCase()));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}
