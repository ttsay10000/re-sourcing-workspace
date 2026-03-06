/**
 * Test ACRIS document fetch by owner name (NYC Open Data only).
 * Run from repo root or apps/api:
 *   [SOCRATA_APP_TOKEN=...] npx tsx apps/api/src/scripts/testAcris18Christopher.ts
 *
 * Expect: rows from ACRIS Real Property Parties, Master, and Legals for "18 CHRISTOPHER STREET, LLC".
 * Prints a quick-search table (doc type + document ID + CRFN) then optional details.
 */

import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  loadEnvFile(join(__dirname, "../../.env"));
} catch {
  // .env optional
}

import { fetchAcrisDocumentsByOwnerName } from "../enrichment/acrisDocuments.js";

const OWNER_NAME = "18 CHRISTOPHER STREET, LLC";

async function main(): Promise<void> {
  console.log("Fetching ACRIS documents for owner:", OWNER_NAME);
  console.log("(NYC Open Data: Parties → Master + Legals)\n");

  const documents = await fetchAcrisDocumentsByOwnerName(OWNER_NAME, {
    appToken: process.env.SOCRATA_APP_TOKEN ?? null,
    timeoutMs: 90_000,
  });

  console.log("Total documents:", documents.length);

  // Count by document type for quick overview
  const byType = new Map<string, number>();
  for (const doc of documents) {
    const type = doc.docType ?? "(no type)";
    byType.set(type, (byType.get(type) ?? 0) + 1);
  }
  console.log("\nBy document type:");
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // Quick-search table: doc type + document ID + CRFN (for pasting into ACRIS search)
  console.log("\n--- Quick search (Doc Type | Document ID | CRFN) ---");
  console.log("Doc Type".padEnd(14) + "  Document ID".padEnd(22) + "  CRFN");
  console.log("-".repeat(14) + "  " + "-".repeat(22) + "  " + "-".repeat(16));
  for (const doc of documents) {
    const type = (doc.docType ?? "—").padEnd(14);
    const id = doc.documentId.padEnd(22);
    const crfn = (doc.crfn ?? "—").padEnd(16);
    console.log(`${type}  ${id}  ${crfn}`);
  }

  // Optional: first 15 with full details
  console.log("\n--- Sample details (first 15) ---");
  for (let i = 0; i < Math.min(documents.length, 15); i++) {
    const doc = documents[i];
    console.log(`\n${i + 1}. [${doc.docType ?? "—"}] ${doc.documentId}`);
    console.log("   CRFN:", doc.crfn ?? "—");
    console.log("   Document date:", doc.documentDate ?? "—");
    console.log("   Recorded:", doc.recordedDatetime ?? "—");
    if (doc.legals.length > 0) {
      console.log("   Legals (BBL/address):");
      for (const l of doc.legals.slice(0, 3)) {
        console.log(`     Boro ${l.borough} Block ${l.block} Lot ${l.lot} | ${[l.streetNumber, l.streetName, l.unit].filter(Boolean).join(" ")}`.trim());
      }
      if (doc.legals.length > 3) console.log(`     ... +${doc.legals.length - 3} more`);
    }
  }
  if (documents.length > 15) {
    console.log(`\n... and ${documents.length - 15} more (see quick-search table above).`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
