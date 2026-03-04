/**
 * Parse "Inquiry about [address]" or "Re: Inquiry about [address]" from email subject.
 * Returns normalized address string (trim, collapse spaces) for property lookup, or null.
 */

const PREFIXES = [
  /inquiry\s+about\s+/i,
  /re:\s*inquiry\s+about\s+/i,
  /fwd:\s*inquiry\s+about\s+/i,
  /re:\s*fwd:\s*inquiry\s+about\s+/i,
];

function collapseSpaces(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * Extract address from subject. E.g. "Re: Inquiry about 416 West 20th Street" -> "416 West 20th Street".
 * Returns null if no known prefix found.
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
