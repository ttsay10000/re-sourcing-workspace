import { describe, expect, it } from "vitest";
import type { OutreachBatch } from "@re-sourcing/contracts";
import {
  readUiDraftMetadata,
  sendExistingDraftBatch,
  SENDABLE_DRAFT_STATUSES,
  UI_V2_DRAFT_KIND,
  type SendExistingDraftDeps,
  type UiDraftMetadata,
} from "./outreachDraftQueue.js";

function makeBatch(overrides: Partial<OutreachBatch> = {}): OutreachBatch {
  return {
    id: "batch-1",
    contactId: "contact-1",
    toAddress: "broker@example.com",
    status: "review_required",
    createdBy: "ui-v2",
    reviewReason: "Draft saved from CRM composer",
    metadata: {
      kind: UI_V2_DRAFT_KIND,
      subject: "Inquiry about 18 Christopher Street",
      body: "Hi Jane,\n\nCould you share the OM?",
      draftStatus: "draft",
      followUpAt: null,
      templateId: null,
      templateName: null,
    },
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeMeta(overrides: Partial<UiDraftMetadata> = {}): UiDraftMetadata {
  return {
    subject: "Inquiry about 18 Christopher Street",
    body: "Hi Jane,\n\nCould you share the OM?",
    followUpAt: null,
    templateId: null,
    templateName: null,
    draftStatus: "draft",
    ...overrides,
  };
}

interface FakeDeps {
  deps: SendExistingDraftDeps;
  calls: Array<{ method: string; args: unknown[] }>;
}

function makeDeps(options: { sendError?: Error; inquiryError?: Error } = {}): FakeDeps {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const deps: SendExistingDraftDeps = {
    async sendMessage(to, subject, body) {
      calls.push({ method: "sendMessage", args: [to, subject, body] });
      if (options.sendError) throw options.sendError;
      return { id: "gmail-msg-1", threadId: "gmail-thread-1" };
    },
    outreachRepo: {
      async updateStatus(id, params) {
        calls.push({ method: "updateStatus", args: [id, params] });
        return null;
      },
    },
    inquirySendRepo: {
      async create(propertyId, gmailMessageId, createOptions) {
        calls.push({ method: "inquiryCreate", args: [propertyId, gmailMessageId, createOptions] });
        if (options.inquiryError) throw options.inquiryError;
        return { id: "inquiry-1", sentAt: "2026-06-01T00:00:01.000Z" };
      },
    },
    actionItemRepo: {
      async upsertOpen(propertyId, actionType, params) {
        calls.push({ method: "upsertOpen", args: [propertyId, actionType, params] });
        return {} as never;
      },
    },
  };
  return { deps, calls };
}

describe("readUiDraftMetadata", () => {
  it("returns null for automation-shaped batches without metadata.kind", () => {
    const batch = makeBatch({
      metadata: { propertyIds: ["p-1"], canonicalAddresses: ["18 Christopher Street"] },
    });
    expect(readUiDraftMetadata(batch)).toBeNull();
  });

  it("returns null for send-now batches", () => {
    const batch = makeBatch({ metadata: { kind: "ui_v2_send_now", subject: "S", body: "B" } });
    expect(readUiDraftMetadata(batch)).toBeNull();
  });

  it("extracts draft fields for ui_v2_outreach_draft batches", () => {
    const batch = makeBatch({
      metadata: {
        kind: UI_V2_DRAFT_KIND,
        subject: "Subject",
        body: "Body",
        followUpAt: "2026-06-05T09:00:00.000Z",
        templateId: "tpl-1",
        templateName: "Warm intro",
        draftStatus: "draft",
      },
    });
    expect(readUiDraftMetadata(batch)).toEqual({
      subject: "Subject",
      body: "Body",
      followUpAt: "2026-06-05T09:00:00.000Z",
      templateId: "tpl-1",
      templateName: "Warm intro",
      draftStatus: "draft",
    });
  });

  it("tolerates null and garbage metadata", () => {
    expect(readUiDraftMetadata(makeBatch({ metadata: null }))).toBeNull();
    expect(readUiDraftMetadata(makeBatch({ metadata: [] as unknown as Record<string, unknown> }))).toBeNull();
    const garbage = makeBatch({ metadata: { kind: UI_V2_DRAFT_KIND, subject: 42, body: { nested: true } } });
    expect(readUiDraftMetadata(garbage)).toEqual({
      subject: "",
      body: "",
      followUpAt: null,
      templateId: null,
      templateName: null,
      draftStatus: null,
    });
  });
});

describe("sendExistingDraftBatch", () => {
  it("sends, marks the batch sent before recording the inquiry, and skips follow-up without followUpAt", async () => {
    const { deps, calls } = makeDeps();
    const batch = makeBatch();
    const meta = makeMeta();

    const result = await sendExistingDraftBatch(deps, batch, meta, "prop-1");

    expect(result.messageId).toBe("gmail-msg-1");
    expect(result.threadId).toBe("gmail-thread-1");
    expect(calls.map((call) => call.method)).toEqual(["sendMessage", "updateStatus", "inquiryCreate"]);

    expect(calls[0]?.args).toEqual([batch.toAddress, meta.subject, meta.body]);

    const [updateId, updateParams] = calls[1]?.args as [string, Record<string, unknown>];
    expect(updateId).toBe("batch-1");
    expect(updateParams).toMatchObject({
      status: "sent",
      gmailMessageId: "gmail-msg-1",
      gmailThreadId: "gmail-thread-1",
      metadata: { draftStatus: "sent" },
    });

    const [inquiryPropertyId, inquiryMessageId, inquiryOptions] = calls[2]?.args as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(inquiryPropertyId).toBe("prop-1");
    expect(inquiryMessageId).toBe("gmail-msg-1");
    expect(inquiryOptions).toMatchObject({
      toAddress: batch.toAddress,
      batchId: "batch-1",
      sendMode: "ui_v2_draft_send",
    });
  });

  it("opens a follow-up action item when followUpAt is set", async () => {
    const { deps, calls } = makeDeps();
    const meta = makeMeta({ followUpAt: "2026-06-05T09:00:00.000Z" });

    await sendExistingDraftBatch(deps, makeBatch(), meta, "prop-1");

    const upsert = calls.find((call) => call.method === "upsertOpen");
    expect(upsert?.args[0]).toBe("prop-1");
    expect(upsert?.args[1]).toBe("confirm_follow_up");
    expect(upsert?.args[2]).toMatchObject({
      dueAt: "2026-06-05T09:00:00.000Z",
      details: { draftId: "batch-1", source: "ui-v2", sendMode: "draft_send" },
    });
  });

  it("still resolves when the inquiry record fails (email already left)", async () => {
    const { deps, calls } = makeDeps({ inquiryError: new Error("insert failed") });

    const result = await sendExistingDraftBatch(deps, makeBatch(), makeMeta(), "prop-1");

    expect(result.messageId).toBe("gmail-msg-1");
    expect(calls.filter((call) => call.method === "updateStatus")).toHaveLength(1);
  });

  it("rejects without marking the batch sent when the Gmail send fails", async () => {
    const { deps, calls } = makeDeps({ sendError: new Error("gmail unavailable") });

    await expect(sendExistingDraftBatch(deps, makeBatch(), makeMeta(), "prop-1")).rejects.toThrow(
      "gmail unavailable"
    );
    expect(calls.some((call) => call.method === "updateStatus")).toBe(false);
    expect(calls.some((call) => call.method === "inquiryCreate")).toBe(false);
  });

  it("records custom send-mode labels for the send-now path", async () => {
    const { deps, calls } = makeDeps();
    const meta = makeMeta({ followUpAt: "2026-06-05T09:00:00.000Z" });

    await sendExistingDraftBatch(deps, makeBatch(), meta, "prop-1", {
      inquirySendMode: "ui_v2_send_now",
      followUpSendMode: "send_now",
    });

    const inquiry = calls.find((call) => call.method === "inquiryCreate");
    expect((inquiry?.args[2] as Record<string, unknown>).sendMode).toBe("ui_v2_send_now");
    const upsert = calls.find((call) => call.method === "upsertOpen");
    expect((upsert?.args[2] as { details: Record<string, unknown> }).details.sendMode).toBe("send_now");
  });
});

describe("SENDABLE_DRAFT_STATUSES", () => {
  it("accepts queue statuses and rejects terminal ones", () => {
    expect(SENDABLE_DRAFT_STATUSES.has("review_required")).toBe(true);
    expect(SENDABLE_DRAFT_STATUSES.has("failed")).toBe(true);
    expect(SENDABLE_DRAFT_STATUSES.has("sent")).toBe(false);
    expect(SENDABLE_DRAFT_STATUSES.has("skipped")).toBe(false);
    expect(SENDABLE_DRAFT_STATUSES.has("queued")).toBe(false);
  });
});
