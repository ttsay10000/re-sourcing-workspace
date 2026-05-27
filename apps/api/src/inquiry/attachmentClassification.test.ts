import { describe, expect, it } from "vitest";
import { classifyInquiryAttachment, type InquiryAttachmentClass } from "./attachmentClassification.js";

describe("classifyInquiryAttachment", () => {
  it.each<Array<[string, string | null, InquiryAttachmentClass]>>([
    ["18 Main Offering Memorandum.pdf", "application/pdf", "om"],
    ["OM.pdf", "application/pdf", "om"],
    ["Marketing Brochure.pdf", "application/pdf", "brochure"],
    ["Current Rent Roll.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "rent_roll"],
    ["2025 T-12 Operating Statement.pdf", "application/pdf", "t12"],
    ["Underwriting Model.xlsx", "application/vnd.ms-excel", "model"],
    ["broker-logo.png", "image/png", "other"],
  ])("classifies %s as %s", (filename, mimeType, expected) => {
    expect(classifyInquiryAttachment({ filename, mimeType }).category).toBe(expected);
  });

  it("marks non-other attachment classes as OM review candidates", () => {
    expect(classifyInquiryAttachment({ filename: "Rent Roll.pdf" }).omReviewCandidate).toBe(true);
    expect(classifyInquiryAttachment({ filename: "signature.png" }).omReviewCandidate).toBe(false);
  });

  it("maps document review categories and model support role", () => {
    expect(classifyInquiryAttachment({ filename: "2025 T12.pdf" })).toMatchObject({
      category: "t12",
      reviewCategory: "T12 / Operating Summary",
      reviewRole: "primary_candidate",
    });
    expect(classifyInquiryAttachment({ filename: "Underwriting Model.xlsx" })).toMatchObject({
      category: "model",
      reviewCategory: "Financial Model",
      reviewRole: "supporting",
    });
  });
});
