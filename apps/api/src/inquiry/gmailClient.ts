/**
 * Gmail API client for process-inbox: list messages, get message (headers + body + parts), get attachment bytes.
 * Uses OAuth2 with refresh token (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN).
 */

import { google } from "googleapis";

export interface GmailMessageListItem {
  id: string;
  threadId: string;
}

export interface GmailListMessagesResult {
  messages: GmailMessageListItem[];
  nextPageToken?: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    body?: { data?: string; size?: number; attachmentId?: string };
    parts?: GmailMessagePart[];
    mimeType?: string;
    filename?: string;
  };
}

/** Redirect URI must match the OAuth client in Google Cloud Console. Use Playground URI when getting the refresh token from OAuth 2.0 Playground. */
const DEFAULT_REDIRECT_URI = "https://developers.google.com/oauthplayground";

function getOAuth2Client() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Gmail OAuth2 requires GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN");
  }
  const redirectUri = process.env.GMAIL_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

function getGmail() {
  const auth = getOAuth2Client();
  return google.gmail({ version: "v1", auth });
}

/**
 * List messages in inbox. Default maxResults 50. Use q for Gmail query (e.g. "in:inbox").
 */
export async function listMessages(options?: {
  maxResults?: number;
  q?: string;
  pageToken?: string;
}): Promise<GmailListMessagesResult> {
  const gmail = getGmail();
  const res = await gmail.users.messages.list({
    userId: "me",
    maxResults: options?.maxResults ?? 50,
    q: options?.q ?? "in:inbox",
    pageToken: options?.pageToken ?? undefined,
  });
  const messages = (res.data.messages ?? []).map((m) => ({ id: m.id!, threadId: m.threadId ?? "" }));
  return {
    messages,
    nextPageToken: res.data.nextPageToken ?? undefined,
  };
}

/**
 * Get a thread and return the list of message IDs in it.
 * Used for thread-based reply matching (e.g. broker's alternate email or teammate in same thread).
 */
export async function getThreadMessageIds(threadId: string): Promise<string[]> {
  const gmail = getGmail();
  const res = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "minimal",
  });
  const messages = res.data.messages ?? [];
  return messages.map((m) => m.id!).filter(Boolean);
}

/**
 * Get full message (format: 'full' for payload with parts and body).
 */
export async function getMessage(messageId: string): Promise<GmailMessage> {
  const gmail = getGmail();
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  const payload = res.data.payload;
  return {
    id: res.data.id!,
    threadId: res.data.threadId ?? "",
    labelIds: res.data.labelIds ?? undefined,
    snippet: res.data.snippet ?? undefined,
    payload: payload
      ? {
          headers: payload.headers as Array<{ name: string; value: string }> | undefined,
          body: payload.body
            ? { data: payload.body.data ?? undefined, size: payload.body.size ?? undefined }
            : undefined,
          parts: payload.parts as GmailMessagePart[] | undefined,
          mimeType: payload.mimeType ?? undefined,
        }
      : undefined,
  };
}

/**
 * Get attachment bytes by message id and attachment id. Returns Buffer.
 */
export async function getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
  const gmail = getGmail();
  const res = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });
  const data = res.data.data;
  if (!data) return Buffer.alloc(0);
  return Buffer.from(data, "base64url");
}

/** Get header value from message payload (e.g. "Subject", "From"). */
export function getHeader(msg: GmailMessage, name: string): string | null {
  const headers = msg.payload?.headers;
  if (!headers) return null;
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

/**
 * Extract canonical email address from a "From" header (e.g. "Name <broker@firm.com>" or "broker@firm.com").
 * Returns lowercased email or null if none found.
 */
export function parseEmailFromHeader(fromHeader: string | null | undefined): string | null {
  if (fromHeader == null || typeof fromHeader !== "string") return null;
  const trimmed = fromHeader.trim();
  if (!trimmed) return null;
  const angle = trimmed.indexOf("<");
  if (angle !== -1) {
    const end = trimmed.indexOf(">", angle);
    if (end !== -1) {
      const email = trimmed.slice(angle + 1, end).trim();
      return email ? email.toLowerCase() : null;
    }
  }
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  return null;
}

/** Decode body from message (plain or from first part). Base64url. */
export function getBodyText(msg: GmailMessage): string {
  const payload = msg.payload;
  if (!payload) return "";
  if (payload.body?.data) {
    try {
      return Buffer.from(payload.body.data, "base64url").toString("utf-8");
    } catch {
      return "";
    }
  }
  const parts = payload.parts;
  if (parts?.length) {
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        try {
          return Buffer.from(part.body.data, "base64url").toString("utf-8");
        } catch {
          continue;
        }
      }
    }
  }
  return "";
}

/** Collect all attachment parts (part with attachmentId and filename). */
export function getAttachmentParts(msg: GmailMessage): Array<{ filename: string; mimeType: string; attachmentId: string }> {
  const out: Array<{ filename: string; mimeType: string; attachmentId: string }> = [];
  function walk(parts: GmailMessagePart[] | undefined) {
    if (!parts) return;
    for (const part of parts) {
      if (part.body?.attachmentId && part.filename) {
        out.push({
          filename: part.filename,
          mimeType: part.mimeType ?? "application/octet-stream",
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.parts?.length) walk(part.parts);
    }
  }
  walk(msg.payload?.parts);
  const pl = msg.payload;
  if (!out.length && pl?.body?.attachmentId && pl.filename) {
    out.push({
      filename: pl.filename,
      mimeType: pl.mimeType ?? "application/octet-stream",
      attachmentId: pl.body.attachmentId,
    });
  }
  return out;
}

/** Return only PDF attachments (by mimeType or .pdf extension). Other types (e.g. PNG) are skipped. */
export function getPdfAttachmentParts(msg: GmailMessage): Array<{ filename: string; mimeType: string; attachmentId: string }> {
  return getAttachmentParts(msg).filter(
    (p) =>
      p.mimeType === "application/pdf" ||
      (typeof p.filename === "string" && p.filename.toLowerCase().endsWith(".pdf"))
  );
}

/**
 * Send an email via Gmail API (uses the authenticated account as sender).
 * Requires OAuth2 scope https://www.googleapis.com/auth/gmail.send
 */
export async function sendMessage(
  to: string,
  subject: string,
  body: string,
  options?: { threadId?: string | null }
): Promise<{ id: string; threadId: string | null }> {
  const gmail = getGmail();
  const lines: string[] = [
    `To: ${to}`,
    `Subject: ${subject.replace(/\r?\n/g, " ")}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"),
  ];
  const raw = lines.join("\r\n");
  const encoded = Buffer.from(raw, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encoded,
      threadId: options?.threadId ?? undefined,
    },
  });
  return { id: res.data.id!, threadId: res.data.threadId ?? null };
}

/** Attachment for sendMessageWithAttachments: filename and buffer. */
export interface EmailAttachment {
  filename: string;
  buffer: Buffer;
  mimeType?: string;
}

const CRLF = "\r\n";

/**
 * Encode a string for use in a MIME header (e.g. filename with special chars).
 */
function mimeEncodeFilename(name: string): string {
  const safe = name.replace(/[\r\n"]/g, "_");
  if (/[^\x20-\x7E]/.test(safe)) return `UTF-8''${encodeURIComponent(name)}`;
  return `"${safe}"`;
}

/**
 * Send an email with attachments via Gmail API (multipart/mixed MIME).
 * Body is plain text; each attachment has Content-Disposition: attachment.
 * Gmail limit: 25 MB total; keep attachments small.
 */
export async function sendMessageWithAttachments(
  to: string,
  subject: string,
  body: string,
  attachments: EmailAttachment[],
  options?: { threadId?: string | null }
): Promise<{ id: string; threadId: string | null }> {
  const gmail = getGmail();
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  const parts: string[] = [];

  parts.push(`To: ${to}`);
  parts.push(`Subject: ${subject.replace(/\r?\n/g, " ")}`);
  parts.push("MIME-Version: 1.0");
  parts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  parts.push("");

  parts.push(`--${boundary}`);
  parts.push("Content-Type: text/plain; charset=utf-8");
  parts.push("Content-Transfer-Encoding: 7bit");
  parts.push("");
  parts.push(body.replace(/\r\n/g, "\n").replace(/\n/g, CRLF));
  parts.push("");

  for (const att of attachments) {
    const mimeType = att.mimeType ?? "application/octet-stream";
    const base64 = att.buffer.toString("base64");
    const lines = base64.match(/.{1,76}/g) ?? [base64];
    parts.push(`--${boundary}`);
    parts.push(`Content-Disposition: attachment; filename=${mimeEncodeFilename(att.filename)}`);
    parts.push(`Content-Type: ${mimeType}; name=${mimeEncodeFilename(att.filename)}`);
    parts.push("Content-Transfer-Encoding: base64");
    parts.push("");
    parts.push(lines.join(CRLF));
    parts.push("");
  }

  parts.push(`--${boundary}--`);

  const raw = parts.join(CRLF);
  const encoded = Buffer.from(raw, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encoded,
      threadId: options?.threadId ?? undefined,
    },
  });
  return { id: res.data.id!, threadId: res.data.threadId ?? null };
}
