/**
 * Example: run the owner flow (permit-based) for a single BBL.
 * Fetches one page of DOB permits from Socrata, builds permits_summary (first/most recent owner), prints result.
 * No database required.
 *
 * Run from repo root or apps/api:
 *   npx tsx apps/api/src/scripts/runOwnerExample.ts [BBL]
 * Default BBL: 1006150061 (137 Christopher St).
 */

import type { SoQLQueryParams } from "../enrichment/permits/socrataClient.js";
import { buildSoQLParamsByBBL, fetchPermitsPage } from "../enrichment/permits/socrataClient.js";
import type { SocrataPermitRow } from "../enrichment/permits/types.js";
import { parseDateToYyyyMmDd } from "../enrichment/permits/normalizers.js";
import type { PermitsSummary } from "../enrichment/permits/types.js";

const TEN_YEARS_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;
function getCutoffDate(): string {
  return new Date(Date.now() - TEN_YEARS_MS).toISOString().slice(0, 10);
}

function buildPermitsSummary(rows: SocrataPermitRow[]): PermitsSummary {
  let lastIssuedDate: string | undefined;
  let ownerBusinessName: string | undefined;
  let ownerName: string | undefined;

  for (const row of rows) {
    const d = parseDateToYyyyMmDd(row.issued_date) ?? parseDateToYyyyMmDd(row.approved_date);
    if (d && (!lastIssuedDate || d > lastIssuedDate)) lastIssuedDate = d;
    const hasOwner = row.owner_business_name?.trim() || row.owner_name?.trim();
    if (hasOwner) {
      if (ownerBusinessName == null && row.owner_business_name?.trim()) ownerBusinessName = row.owner_business_name.trim();
      if (ownerName == null && row.owner_name?.trim()) ownerName = row.owner_name.trim();
      break;
    }
  }

  return {
    count: rows.length,
    last_issued_date: lastIssuedDate,
    owner_business_name: ownerBusinessName,
    owner_name: ownerName,
  };
}

async function main(): Promise<void> {
  const bbl = process.argv[2]?.trim() || "1006150061";
  const cutoff = getCutoffDate();
  const appToken = process.env.SOCRATA_APP_TOKEN ?? null;

  console.log("Owner example (permit-derived)");
  console.log("BBL:", bbl, "| 10-year cutoff:", cutoff);
  console.log("");

  let params: SoQLQueryParams = buildSoQLParamsByBBL(bbl, cutoff, 100, 0);
  let rows = await fetchPermitsPage(params, { appToken, timeoutMs: 15_000 });
  if (rows.length === 0) {
    console.log("No permits in 10-year window; trying BBL-only (any date)...");
    const esc = bbl.replace(/'/g, "''");
    params = {
      $select: "bbl,borough,house_no,street_name,owner_business_name,owner_name,issued_date,approved_date",
      $where: `bbl = '${esc}'`,
      $order: "issued_date DESC",
      $limit: 100,
      $offset: 0,
    };
    rows = await fetchPermitsPage(params, { appToken, timeoutMs: 15_000 });
  }

  console.log("Permits fetched:", rows.length);
  const firstWithOwner = rows.find((r) => r.owner_name?.trim() || r.owner_business_name?.trim());
  if (firstWithOwner) {
    console.log("First row with owner (most recent):");
    console.log("  issued_date:", firstWithOwner.issued_date);
    console.log("  owner_name:", firstWithOwner.owner_name ?? "—");
    console.log("  owner_business_name:", firstWithOwner.owner_business_name ?? "—");
  } else {
    console.log("No permit row in this page has owner_name/owner_business_name.");
  }
  console.log("");

  const summary = buildPermitsSummary(rows);
  console.log("permits_summary (written to property.details when enrichment runs):");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
