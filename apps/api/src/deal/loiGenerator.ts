/**
 * Deterministic Letter of Intent (LOI) PDF generator.
 *
 * Intentionally template-driven (no LLM): an LOI must be instant, predictable,
 * and editable downstream. Terms come from the deal-path offer state plus
 * operator-provided overrides.
 */

import PDFDocument from "pdfkit";

export interface LoiTerms {
  propertyAddress: string;
  offerAmount: number;
  buyerName: string;
  buyerEntity?: string | null;
  sellerName?: string | null;
  brokerName?: string | null;
  depositPct?: number | null;
  dueDiligenceDays?: number | null;
  closingDays?: number | null;
  financingContingency?: boolean | null;
  contingencies?: string[] | null;
  additionalNotes?: string | null;
  expirationDays?: number | null;
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function buildLoiFileName(address: string): string {
  const slug = address
    .split(",")[0]
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "property";
  return `LOI-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`;
}

export async function buildLoiPdf(terms: LoiTerms): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 64 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const today = new Date();
  const expiration = new Date(today.getTime() + (terms.expirationDays ?? 7) * 24 * 60 * 60 * 1000);
  const buyerLabel = terms.buyerEntity
    ? `${terms.buyerName}, on behalf of ${terms.buyerEntity} (and/or assigns)`
    : `${terms.buyerName} (and/or assigns)`;

  doc.font("Helvetica-Bold").fontSize(16).text("LETTER OF INTENT TO PURCHASE", { align: "center" });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor("#444444").text(formatDate(today), { align: "center" });
  doc.moveDown(1.2);

  doc.fillColor("#000000").fontSize(10.5);
  const intro = terms.sellerName
    ? `Dear ${terms.sellerName},`
    : terms.brokerName
      ? `Dear ${terms.brokerName},`
      : "To the Owner / Listing Broker,";
  doc.text(intro);
  doc.moveDown(0.6);
  doc.text(
    `This letter sets forth the intent of ${buyerLabel} ("Buyer") to purchase the property located at ` +
      `${terms.propertyAddress} (the "Property") on the principal terms outlined below. This letter is an ` +
      `expression of interest only and is non-binding on all parties except as expressly stated herein.`,
    { lineGap: 2 }
  );
  doc.moveDown(1);

  const rows: Array<[string, string]> = [
    ["Purchase Price", USD.format(terms.offerAmount)],
    ["Deposit", `${(terms.depositPct ?? 10).toFixed(0)}% of the Purchase Price upon contract execution, held in escrow`],
    ["Due Diligence", `${terms.dueDiligenceDays ?? 30} days from acceptance of this letter for inspections, title, and document review`],
    ["Closing", `${terms.closingDays ?? 60} days following the end of the due diligence period`],
    [
      "Financing",
      terms.financingContingency === false
        ? "Not contingent on financing"
        : "Subject to Buyer obtaining acquisition financing on commercially reasonable terms",
    ],
  ];
  const extraContingencies = (terms.contingencies ?? []).filter((entry) => entry.trim().length > 0);
  if (extraContingencies.length > 0) {
    rows.push(["Additional Contingencies", extraContingencies.join("; ")]);
  }
  rows.push(["Offer Expiration", `${formatDate(expiration)} at 5:00 PM ET, unless extended in writing`]);

  const labelX = doc.page.margins.left;
  const valueX = labelX + 150;
  const valueWidth = doc.page.width - doc.page.margins.right - valueX;
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(10).text(label, labelX, y, { width: 140 });
    doc.font("Helvetica").fontSize(10).text(value, valueX, y, { width: valueWidth, lineGap: 1.5 });
    doc.moveDown(0.55);
  }

  if (terms.additionalNotes?.trim()) {
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(10).text("Additional Notes", labelX);
    doc.font("Helvetica").fontSize(10).text(terms.additionalNotes.trim(), { lineGap: 2 });
  }

  doc.moveDown(1);
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor("#444444")
    .text(
      "This letter does not constitute a binding agreement to sell or purchase the Property; such obligations will " +
        "arise only upon execution and delivery of a mutually acceptable purchase and sale agreement. Buyer and Seller " +
        "agree to negotiate in good faith toward such an agreement during the exclusivity of this letter.",
      { lineGap: 2 }
    );

  doc.moveDown(2);
  doc.fillColor("#000000").fontSize(10);
  const signY = doc.y;
  doc.text("________________________________", labelX, signY);
  doc.text("________________________________", valueX + 40, signY);
  doc.moveDown(0.25);
  const nameY = doc.y;
  doc.font("Helvetica-Bold").text(terms.buyerName, labelX, nameY);
  doc.font("Helvetica-Bold").text(terms.sellerName ?? "Seller / Authorized Signatory", valueX + 40, nameY);
  doc.moveDown(0.1);
  const roleY = doc.y;
  doc.font("Helvetica").fontSize(9).fillColor("#555555").text("Buyer", labelX, roleY);
  doc.font("Helvetica").fontSize(9).text("Seller", valueX + 40, roleY);

  doc.end();
  return done;
}
