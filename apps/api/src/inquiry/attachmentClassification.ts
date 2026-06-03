export type InquiryAttachmentClass =
  | "om"
  | "brochure"
  | "rent_roll"
  | "t12"
  | "model"
  | "broker_comp"
  | "sale_comp"
  | "rent_comp"
  | "expense_comp"
  | "market_analysis"
  | "other";
export type InquiryAttachmentReviewCategory =
  | "OM"
  | "Brochure"
  | "Rent Roll"
  | "T12 / Operating Summary"
  | "Financial Model"
  | "Broker Comp Package"
  | "Sale Comp Package"
  | "Rent Comp Package"
  | "Expense Comp Package"
  | "Market Analysis"
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
  broker_comp: "Broker Comp Package",
  sale_comp: "Sale Comp Package",
  rent_comp: "Rent Comp Package",
  expense_comp: "Expense Comp Package",
  market_analysis: "Market Analysis",
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
  if (category === "broker_comp") return "Broker Comp Package";
  if (category === "sale_comp") return "Sale Comp Package";
  if (category === "rent_comp") return "Rent Comp Package";
  if (category === "expense_comp") return "Expense Comp Package";
  if (category === "market_analysis") return "Market Analysis";
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

  if (/\b(market\s*analysis|broker\s*comp(s)?|comp(arable)?\s*(package|set|book|analysis))\b/.test(filename)) {
    return buildClassification("broker_comp", "high", "filename contains broker comp package or market analysis terms");
  }

  if (/\b(sale\s*comp(s)?|cap\s*rate\s*comp(s)?|noi\s*comp(s)?|investment\s*sale\s*comp(s)?|whisper\s*(price|cap|pricing))\b/.test(filename)) {
    return buildClassification("sale_comp", "high", "filename contains sale comp, NOI, cap-rate, or whisper pricing terms");
  }

  if (/\b(rent\s*comp(s)?|rental\s*comp(s)?|lease\s*comp(s)?)\b/.test(filename)) {
    return buildClassification("rent_comp", "high", "filename contains rent comp or lease comp terms");
  }

  if (/\b(expense\s*comp(s)?|opex\s*comp(s)?|operating\s*expense\s*comp(s)?)\b/.test(filename)) {
    return buildClassification("expense_comp", "high", "filename contains expense comp or operating expense comp terms");
  }

  if (/\b(rent\s*roll|rentroll|tenant\s+(schedule|roster)|lease\s+schedule)\b/.test(filename)) {
    return buildClassification("rent_roll", "high", "filename contains rent roll or tenant schedule terms");
  }

  if (/\b(t\s*12|trailing\s+twelve|trailing\s+12|operating\s+(statement|summary)|income\s+statement|p\s*l|profit\s+loss)\b/.test(filename)) {
    return buildClassification("t12", "high", "filename contains T12 or operating statement terms");
  }

  if (/\b(financial\s+model|underwriting|pro\s*forma|proforma|cash\s*flow|valuation\s+model)\b/.test(filename)) {
    return buildClassification("model", "high", "filename contains model or pro forma terms");
  }

  if (isSpreadsheet && /\b(comp|comparable|market|pricing|sale|rent|noi|cap\s*rate)\b/.test(filename)) {
    return buildClassification("broker_comp", "medium", "spreadsheet filename contains comp or market pricing terms");
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

  return buildClassification("other", "low", "no known OM, brochure, rent roll, T12, model, or comp package terms found");
}

export function summarizeAttachmentClassification(filename: string, classification: ClassifiedInquiryAttachment): string {
  return `${filename} (${classification.label})`;
}
