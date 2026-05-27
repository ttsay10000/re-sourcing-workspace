import { describe, expect, it } from "vitest";
import { buildProcessingStatus, mergeMessageTargets } from "./replyMatching.js";

describe("mergeMessageTargets", () => {
  it("reports a single batch thread match across multiple properties", () => {
    const targets = mergeMessageTargets([], {
      propertyLinks: [
        { propertyId: "property-1", matchSource: "batch_thread" },
        { propertyId: "property-2", matchSource: "batch_thread" },
      ],
      batchIds: new Set(["batch-1"]),
    });

    expect(targets).toEqual({
      propertyLinks: [
        { propertyId: "property-1", matchSource: "batch_thread" },
        { propertyId: "property-2", matchSource: "batch_thread" },
      ],
      matchedBatchId: "batch-1",
      matchedBatchIds: ["batch-1"],
      matchSources: ["batch_thread"],
      processingStatus: "batch_matched_multi_property",
    });
  });

  it("keeps all batch ids when a thread maps to multiple batches", () => {
    const targets = mergeMessageTargets([{ propertyId: "property-1", matchSource: "subject_address" }], {
      propertyLinks: [
        { propertyId: "property-1", matchSource: "batch_thread" },
        { propertyId: "property-2", matchSource: "batch_thread" },
      ],
      batchIds: new Set(["batch-2", "batch-1"]),
    });

    expect(targets?.matchedBatchId).toBeNull();
    expect(targets?.matchedBatchIds).toEqual(["batch-1", "batch-2"]);
    expect(targets?.matchSources).toEqual(["batch_thread", "subject_address"]);
    expect(targets?.processingStatus).toBe("batch_matched_multi_batch");
    expect(targets?.propertyLinks).toEqual([
      { propertyId: "property-1", matchSource: "subject_address" },
      { propertyId: "property-2", matchSource: "batch_thread" },
    ]);
  });
});

describe("buildProcessingStatus", () => {
  it("uses thread-specific statuses for single-property matches", () => {
    expect(buildProcessingStatus([{ propertyId: "property-1", matchSource: "batch_thread" }], ["batch-1"])).toBe(
      "batch_thread_matched"
    );
    expect(buildProcessingStatus([{ propertyId: "property-1", matchSource: "thread_reply" }])).toBe(
      "thread_matched"
    );
  });
});
