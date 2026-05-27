export type InquiryAttachmentClass = "om" | "brochure" | "rent_roll" | "t12" | "model" | "other";
export type InquiryAttachmentReviewCategory =
  | "OM"
  | "Brochure"
  | "Rent Roll"
  | "T12 / Operating Summary"
  | "Financial Model"
  | "Other";
export type InquiryAttachmentReviewRole = "primary_candidate" | "supporting" | "ignore";

export interface AttachmentClassificationInput {
  filename?: string | null;
  mimeType?: string | null;
}

export interface ClassifiedInquiryAttachment {
  category: InquiryAttachmentClass;
  label: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  omReviewCandidate: boolean;
  reviewCategory: InquiryAttachmentReviewCategory;
  reviewRole: InquiryAttachmentReviewRole;
}

const LABELS: Record<InquiryAttachmentClass, string> = {
  om: "OM",
  brochure: "Brochure",
  rent_roll: "Rent Roll",
  t12: "T12 / Operating Summary",
  model: "Financial Model",
  other: "Other",
};

function normalizeForMatching(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9.+\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fileExtension(filename: string | null | undefined): string {
  const normalized = (filename ?? "").trim().toLowerCase();
  const match = normalized.match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function buildClassification(
  category: InquiryAttachmentClass,
  confidence: ClassifiedInquiryAttachment["confidence"],
  reason: string
): ClassifiedInquiryAttachment {
  const reviewCategory = mapInquiryAttachmentClassToReviewCategory(category);
  return {
    category,
    label: LABELS[category],
    confidence,
    reason,
    omReviewCandidate: category !== "other",
    reviewCategory,
    reviewRole: category === "other" ? "ignore" : category === "model" ? "supporting" : "primary_candidate",
  };
}

export function mapInquiryAttachmentClassToReviewCategory(
  category: InquiryAttachmentClass
): InquiryAttachmentReviewCategory {
  if (category === "om") return "OM";
  if (category === "brochure") return "Brochure";
  if (category === "rent_roll") return "Rent Roll";
  if (category === "t12") return "T12 / Operating Summary";
  if (category === "model") return "Financial Model";
  return "Other";
}

export function classifyInquiryAttachment(
  input: AttachmentClassificationInput
): ClassifiedInquiryAttachment {
  const filename = normalizeForMatching(input.filename);
  const mimeType = normalizeForMatching(input.mimeType);
  const ext = fileExtension(input.filename);
  const isSpreadsheet =
    ["xls", "xlsx", "xlsm", "csv"].includes(ext) ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    mimeType.includes("csv");

  if (/\b(rent\s*roll|rentroll|tenant\s+(schedule|roster)|lease\s+schedule)\b/.test(filename)) {
    return buildClassification("rent_roll", "high", "filename contains rent roll or tenant schedule terms");
  }

  if (/\b(t\s*12|trailing\s+twelve|trailing\s+12|operating\s+(statement|summary)|income\s+statement|p\s*l|profit\s+loss)\b/.test(filename)) {
    return buildClassification("t12", "high", "filename contains T12 or operating statement terms");
  }

  if (/\b(financial\s+model|underwriting|pro\s*forma|proforma|cash\s*flow|valuation\s+model)\b/.test(filename)) {
    return buildClassification("model", "high", "filename contains model or pro forma terms");
  }

  if (isSpreadsheet && /\b(financial|noi|income|expense|valuation|underwriting|model)\b/.test(filename)) {
    return buildClassification("model", "medium", "spreadsheet filename contains financial model terms");
  }

  if (/\b(offering\s+(memorandum|memo)|investment\s+(memorandum|memo)|confidential\s+offering|(^|[^a-z])om([^a-z]|$))\b/.test(filename)) {
    return buildClassification("om", "high", "filename contains offering memorandum terms");
  }

  if (/\b(brochure|flyer|marketing\s+(package|materials?)|teaser)\b/.test(filename)) {
    return buildClassification("brochure", "high", "filename contains brochure or marketing package terms");
  }

  if (isSpreadsheet) {
    return buildClassification("model", "low", "spreadsheet attachment requires manual triage");
  }

  return buildClassification("other", "low", "no known OM, brochure, rent roll, T12, or model terms found");
}

export function summarizeAttachmentClassification(filename: string, classification: ClassifiedInquiryAttachment): string {
  return `${filename} (${classification.label})`;
}
