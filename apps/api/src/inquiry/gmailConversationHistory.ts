import { getHeader, getMessage, listMessages } from "./gmailClient.js";

export interface GmailConversationHistoryMatch {
  messageId: string;
  threadId: string | null;
  subject: string | null;
  fromAddress: string | null;
  date: string | null;
  snippet: string | null;
}

function normalizeBrokerEmail(toAddress: string | null | undefined): string | null {
  if (typeof toAddress !== "string") return null;
  const normalized = toAddress.trim().toLowerCase();
  return normalized || null;
}

export function extractGmailHistoryAddressLine(canonicalAddress: string | null | undefined): string | null {
  if (typeof canonicalAddress !== "string") return null;
  const [addressLine] = canonicalAddress
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const normalized = (addressLine ?? canonicalAddress).replace(/\s+/g, " ").trim();
  return normalized || null;
}

function extractGmailHistoryZip(canonicalAddress: string | null | undefined): string | null {
  if (typeof canonicalAddress !== "string") return null;
  const match = canonicalAddress.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match?.[1] ?? null;
}

function escapeGmailQuotedPhrase(value: string): string {
  return value.replace(/"/g, " ").replace(/\s+/g, " ").trim();
}

export function buildBrokerPropertyHistorySearchQuery(params: {
  toAddress: string | null | undefined;
  canonicalAddress: string | null | undefined;
}): string | null {
  const brokerEmail = normalizeBrokerEmail(params.toAddress);
  const addressLine = extractGmailHistoryAddressLine(params.canonicalAddress);
  if (!brokerEmail || !addressLine) return null;

  const escapedAddressLine = escapeGmailQuotedPhrase(addressLine);
  if (!escapedAddressLine) return null;

  const zip = extractGmailHistoryZip(params.canonicalAddress);
  const terms = [`in:anywhere`, `(to:${brokerEmail} OR from:${brokerEmail})`, `"${escapedAddressLine}"`];
  if (zip) terms.push(`"${zip}"`);
  return terms.join(" ");
}

export async function findBrokerPropertyConversationHistory(params: {
  toAddress: string;
  canonicalAddress: string;
  maxResults?: number;
}): Promise<{
  query: string | null;
  addressLine: string | null;
  matches: GmailConversationHistoryMatch[];
}> {
  const query = buildBrokerPropertyHistorySearchQuery(params);
  const addressLine = extractGmailHistoryAddressLine(params.canonicalAddress);
  if (!query || !addressLine) {
    return { query, addressLine, matches: [] };
  }

  const maxResults = Math.max(1, Math.min(params.maxResults ?? 3, 10));
  const list = await listMessages({ maxResults, q: query });
  const matches: GmailConversationHistoryMatch[] = [];

  for (const item of list.messages.slice(0, maxResults)) {
    try {
      const msg = await getMessage(item.id);
      matches.push({
        messageId: msg.id,
        threadId: msg.threadId ?? null,
        subject: getHeader(msg, "Subject"),
        fromAddress: getHeader(msg, "From"),
        date: getHeader(msg, "Date"),
        snippet: msg.snippet ?? null,
      });
    } catch {
      matches.push({
        messageId: item.id,
        threadId: item.threadId ?? null,
        subject: null,
        fromAddress: null,
        date: null,
        snippet: null,
      });
    }
  }

  return { query, addressLine, matches };
}
