import { describe, expect, it } from "vitest";
import { getAttachmentParts, getBodyText, type GmailMessage } from "./gmailClient.js";

function encodeBody(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

describe("getBodyText", () => {
  it("walks nested MIME parts and prefers text/plain over HTML", () => {
    const message: GmailMessage = {
      id: "msg-1",
      threadId: "thread-1",
      payload: {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              {
                mimeType: "text/html",
                body: { data: encodeBody("<p>HTML fallback</p>") },
              },
              {
                mimeType: "text/plain",
                body: { data: encodeBody("Plain body\nwith details") },
              },
            ],
          },
          {
            filename: "Offering Memorandum.pdf",
            mimeType: "application/pdf",
            body: { attachmentId: "att-1" },
          },
        ],
      },
    };

    expect(getBodyText(message)).toBe("Plain body\nwith details");
    expect(getAttachmentParts(message)).toEqual([
      {
        filename: "Offering Memorandum.pdf",
        mimeType: "application/pdf",
        attachmentId: "att-1",
      },
    ]);
  });

  it("falls back to readable HTML text when no plain body exists", () => {
    const message: GmailMessage = {
      id: "msg-2",
      threadId: "thread-2",
      payload: {
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/html",
            body: {
              data: encodeBody(
                "<html><head><style>.x{}</style></head><body><p>Hi Tyler,</p><div>Please see the <strong>OM</strong> &amp; rent roll.</div><script>ignore()</script></body></html>"
              ),
            },
          },
        ],
      },
    };

    expect(getBodyText(message)).toBe("Hi Tyler,\nPlease see the OM & rent roll.");
  });

  it("does not treat text file attachments as the email body", () => {
    const message: GmailMessage = {
      id: "msg-3",
      threadId: "thread-3",
      payload: {
        mimeType: "multipart/mixed",
        parts: [
          {
            filename: "notes.txt",
            mimeType: "text/plain",
            body: { data: encodeBody("attachment text") },
          },
          {
            mimeType: "text/html",
            body: { data: encodeBody("<p>Actual email body</p>") },
          },
        ],
      },
    };

    expect(getBodyText(message)).toBe("Actual email body");
  });
});
