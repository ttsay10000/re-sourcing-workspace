import { describe, expect, it } from "vitest";
import {
  assessMetadataDuplicates,
  buildEmailPropertyMatchers,
  filenameLooksAddressLike,
  matchPropertiesForEmailAttachment,
  resolveEmailDuplicateFlag,
  type ExistingPropertyDocumentRef,
} from "./brokerOmEmailMatching.js";

const matchers = buildEmailPropertyMatchers([
  { id: "p-main", canonicalAddress: "245 West 14th Street, New York, NY 10011" },
  { id: "p-other", canonicalAddress: "1820 Amsterdam Avenue, New York, NY 10031" },
]);

describe("matchPropertiesForEmailAttachment", () => {
  it("matches the property named in the attachment filename over the email subject", () => {
    const result = matchPropertiesForEmailAttachment(
      {
        filename: "1820-Amsterdam-Avenue-OM.pdf",
        subject: "Re: 245 West 14th Street — rent roll",
        bodyPreview: "Also attaching another deal you might like at 245 West 14th Street.",
      },
      matchers
    );
    expect(result.matchedVia).toBe("filename");
    expect(result.matches.map((match) => match.id)).toEqual(["p-other"]);
  });

  it("falls back to the email subject when the filename has no address signal", () => {
    const result = matchPropertiesForEmailAttachment(
      {
        filename: "OM_Final_v2.pdf",
        subject: "Offering memorandum — 245 West 14th Street",
        bodyPreview: null,
      },
      matchers
    );
    expect(result.matchedVia).toBe("email");
    expect(result.matches.map((match) => match.id)).toEqual(["p-main"]);
  });

  it("does not let the subject claim an address-like filename for an unknown building", () => {
    const result = matchPropertiesForEmailAttachment(
      {
        filename: "789 Pine Street OM.pdf",
        subject: "Re: 245 West 14th Street",
        bodyPreview: null,
      },
      matchers
    );
    expect(result.matchedVia).toBeNull();
    expect(result.matches).toEqual([]);
  });
});

describe("filenameLooksAddressLike", () => {
  it("detects house-number style filenames", () => {
    expect(filenameLooksAddressLike("245 W 14th OM.pdf")).toBe(true);
    expect(filenameLooksAddressLike("1820-Amsterdam_RentRoll.xlsx")).toBe(true);
  });

  it("ignores generic document names", () => {
    expect(filenameLooksAddressLike("OM_Final_v2.pdf")).toBe(false);
    expect(filenameLooksAddressLike("RentRoll.xlsx")).toBe(false);
  });
});

function existingDoc(overrides: Partial<ExistingPropertyDocumentRef>): ExistingPropertyDocumentRef {
  return {
    id: "doc-1",
    propertyId: "p-main",
    filename: "245 West 14th OM.pdf",
    category: "OM",
    createdAt: "2026-05-01T00:00:00.000Z",
    gmailMessageId: null,
    gmailAttachmentId: null,
    sizeBytes: 1_000_000,
    sha256: "abc",
    ...overrides,
  };
}

describe("duplicate detection", () => {
  const candidate = {
    messageId: "m1",
    attachmentId: "a1",
    filename: "245 West 14th OM.pdf",
    sizeBytes: 1_000_000,
  };

  it("flags the exact Gmail attachment as already imported", () => {
    const assessment = assessMetadataDuplicates(candidate, [
      existingDoc({ gmailMessageId: "m1", gmailAttachmentId: "a1" }),
    ]);
    const flag = resolveEmailDuplicateFlag({ assessment, candidateSha256: null });
    expect(flag?.status).toBe("already_imported");
  });

  it("confirms an exact duplicate when content hashes match", () => {
    const assessment = assessMetadataDuplicates(candidate, [existingDoc({})]);
    const flag = resolveEmailDuplicateFlag({ assessment, candidateSha256: "abc" });
    expect(flag?.status).toBe("exact_duplicate");
    expect(flag?.contentCompared).toBe(true);
  });

  it("downgrades to possible duplicate when same filename has different content", () => {
    const assessment = assessMetadataDuplicates(candidate, [existingDoc({ sha256: "different" })]);
    const flag = resolveEmailDuplicateFlag({ assessment, candidateSha256: "abc" });
    expect(flag?.status).toBe("possible_duplicate");
    expect(flag?.reason).toContain("content differs");
  });

  it("clears a size-only coincidence once content was compared and differs", () => {
    const assessment = assessMetadataDuplicates(candidate, [
      existingDoc({ filename: "completely different brochure.pdf", sha256: "different" }),
    ]);
    const flag = resolveEmailDuplicateFlag({ assessment, candidateSha256: "abc" });
    expect(flag).toBeNull();
  });

  it("marks same name+size as likely duplicate when content could not be compared", () => {
    const assessment = assessMetadataDuplicates(candidate, [existingDoc({})]);
    const flag = resolveEmailDuplicateFlag({ assessment, candidateSha256: null });
    expect(flag?.status).toBe("likely_duplicate");
    expect(flag?.contentCompared).toBe(false);
  });

  it("returns null when nothing overlaps", () => {
    const assessment = assessMetadataDuplicates(candidate, [
      existingDoc({ filename: "other.pdf", sizeBytes: 5, sha256: "zzz" }),
    ]);
    expect(resolveEmailDuplicateFlag({ assessment, candidateSha256: null })).toBeNull();
  });
});
