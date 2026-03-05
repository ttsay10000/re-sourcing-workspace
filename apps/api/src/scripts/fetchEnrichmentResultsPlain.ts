/**
 * Fetch enrichment-style results for BBL 1013820133 from NYC Open Data only.
 * No database reads or writes – safe to run anytime; does not affect the actual system.
 * Uses the same datasets and query logic as the real enrichment pipeline; real flow
 * adds DB writes and app display from stored property.details.
 *
 * Run: SOCRATA_APP_TOKEN=optional npx tsx apps/api/src/scripts/fetchEnrichmentResultsPlain.ts
 */

const BBL = "1013820133";
const BBL_INT = 1013820133;
const LAT = 40.768347;
const LON = -73.967148;

// BBL 1013820133 -> borough 1 (Manhattan), block 01382, lot 0133
const BOROUGH = "MANHATTAN";
const BLOCK = "01382";
const LOT = "0133";

const APP_TOKEN = process.env.SOCRATA_APP_TOKEN ?? "";

function resourceUrl(datasetId: string): string {
  return `https://data.cityofnewyork.us/resource/${datasetId}.json`;
}

function escape(s: string): string {
  return s.replace(/'/g, "''");
}

async function soql<T = Record<string, unknown>>(
  datasetId: string,
  params: { $select: string; $where: string; $limit?: number; $order?: string }
): Promise<T[]> {
  const url = new URL(resourceUrl(datasetId));
  url.searchParams.set("$select", params.$select);
  url.searchParams.set("$where", params.$where);
  url.searchParams.set("$limit", String(params.$limit ?? 1000));
  if (params.$order) url.searchParams.set("$order", params.$order);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (APP_TOKEN) headers["X-App-Token"] = APP_TOKEN;
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`${datasetId} ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

async function main(): Promise<void> {
  console.log("=== Enrichment-style fetch for BBL", BBL, "===");
  console.log("Location:", LAT + ", " + LON);
  console.log("Borough/block/lot:", BOROUGH, BLOCK, LOT);
  console.log("");

  const out: string[] = [];

  try {
    const [plutoRows] = await Promise.all([
      soql<{ ownername?: string; cb2010?: string }>("64uk-42ks", {
        $select: "ownername,cb2010",
        $where: `bbl = ${BBL_INT}`,
        $limit: 1,
      }),
    ]);
    const pluto = plutoRows[0];
    out.push("--- PLUTO (owner, 2010 Census Block) ---");
    out.push("Owner: " + (pluto?.ownername ?? "—"));
    out.push("2010 Census Block (cb2010): " + (pluto?.cb2010 ?? "—"));
    out.push("");
  } catch (e) {
    out.push("PLUTO error: " + (e instanceof Error ? e.message : String(e)));
    out.push("");
  }

  try {
    type ValRow = {
      parid?: string;
      curtaxclass?: string;
      owner?: string;
      curmkttot?: number;
      curacttot?: number;
      curtxbtot?: number;
      gross_sqft?: number;
      land_area?: number;
      residential_area_gross?: number;
      office_area_gross?: number;
      retail_area_gross?: number;
      appt_date?: string;
      extracrdt?: string;
    };
    const valRows = await soql<ValRow>("8y4t-faws", {
      $select: "parid,curtaxclass,owner,curmkttot,curacttot,curtxbtot,gross_sqft,land_area,residential_area_gross,office_area_gross,retail_area_gross,appt_date,extracrdt",
      $where: `parid = '${escape(BBL)}'`,
      $limit: 1,
    });
    const v = valRows[0];
    out.push("--- Valuations (tax code, owner, assessment) ---");
    out.push("Tax code (curtaxclass): " + (v?.curtaxclass ?? "—"));
    out.push("Owner: " + (v?.owner ?? "—"));
    out.push("Market value (curmkttot): " + (v?.curmkttot != null ? String(v.curmkttot) : "—"));
    out.push("Actual assessed (curacttot): " + (v?.curacttot != null ? String(v.curacttot) : "—"));
    out.push("Tax before total (curtxbtot): " + (v?.curtxbtot != null ? String(v.curtxbtot) : "—"));
    out.push("Gross sqft: " + (v?.gross_sqft != null ? String(v.gross_sqft) : "—"));
    out.push("Land area: " + (v?.land_area != null ? String(v.land_area) : "—"));
    out.push("Residential area gross: " + (v?.residential_area_gross != null ? String(v.residential_area_gross) : "—"));
    out.push("Office area gross: " + (v?.office_area_gross != null ? String(v.office_area_gross) : "—"));
    out.push("Retail area gross: " + (v?.retail_area_gross != null ? String(v.retail_area_gross) : "—"));
    out.push("Appt date: " + (v?.appt_date ?? "—"));
    out.push("Extract date (extracrdt): " + (v?.extracrdt ?? "—"));
    out.push("");
  } catch (e) {
    out.push("Valuations error: " + (e instanceof Error ? e.message : String(e)));
    out.push("");
  }

  try {
    const zonRows = await soql<{ bbl?: number; zoning_district_1?: string; zoning_district_2?: string; zoning_map_number?: string; zoning_map_code?: string }>("fdkv-4t4z", {
      $select: "bbl,zoning_district_1,zoning_district_2,zoning_map_number,zoning_map_code",
      $where: `bbl = ${BBL_INT}`,
      $limit: 1,
    });
    const z = zonRows[0];
    out.push("--- Zoning (ZTL) ---");
    out.push("Zoning district 1: " + (z?.zoning_district_1 ?? "—"));
    out.push("Zoning district 2: " + (z?.zoning_district_2 ?? "—"));
    out.push("Zoning map number: " + (z?.zoning_map_number ?? "—"));
    out.push("Zoning map code: " + (z?.zoning_map_code ?? "—"));
    out.push("");
  } catch (e) {
    out.push("Zoning error: " + (e instanceof Error ? e.message : String(e)));
    out.push("");
  }

  try {
    const coRows = await soql<{ bbl?: string; c_of_o_status?: string; c_of_o_issuance_date?: string; job_type?: string }>("pkdm-hqz6", {
      $select: "bbl,c_of_o_status,c_of_o_issuance_date,job_type",
      $where: `bbl = '${escape(BBL)}'`,
      $order: "c_of_o_issuance_date DESC",
      $limit: 1,
    });
    const co = coRows[0];
    out.push("--- Certificate of Occupancy ---");
    out.push("CO status: " + (co?.c_of_o_status ?? "—"));
    out.push("CO issuance date: " + (co?.c_of_o_issuance_date ?? "—"));
    out.push("CO job type: " + (co?.job_type ?? "—"));
    out.push("");
  } catch (e) {
    out.push("CO error: " + (e instanceof Error ? e.message : String(e)));
    out.push("");
  }

  try {
    const hpdRows = await soql<{ registrationid?: string; lastregistrationdate?: string; boro?: string; block?: string; lot?: string }>("tesw-yqqr", {
      $select: "registrationid,lastregistrationdate,boro,block,lot",
      $where: `boro = '${BOROUGH}' AND block = '${escape(BLOCK)}' AND lot = '${escape(LOT)}'`,
      $order: "lastregistrationdate DESC",
      $limit: 5,
    });
    const hpd = hpdRows[0];
    out.push("--- HPD Registration ---");
    out.push("HPD Registration ID: " + (hpd?.registrationid ?? "—"));
    out.push("HPD Last Registration Date: " + (hpd?.lastregistrationdate ?? "—"));
    out.push("Rows found: " + String(hpdRows.length));
    out.push("");
  } catch (e) {
    out.push("HPD Registration error: " + (e instanceof Error ? e.message : String(e)));
    out.push("");
  }

  try {
    const permitRows = await soql<{ bbl?: string; owner_name?: string; owner_business_name?: string; bin?: string }>("rbx6-tga4", {
      $select: "bbl,owner_name,owner_business_name,bin",
      $where: `bbl = '${escape(BBL)}'`,
      $limit: 1000,
    });
    const firstPermit = permitRows[0];
    out.push("--- Permits ---");
    out.push("Permits count: " + String(permitRows.length));
    out.push("First row owner_name: " + (firstPermit?.owner_name ?? "—"));
    out.push("First row owner_business_name: " + (firstPermit?.owner_business_name ?? "—"));
    out.push("First row BIN (for DOB complaints): " + (firstPermit?.bin ?? "—"));
    out.push("");
  } catch (e) {
    out.push("Permits error: " + (e instanceof Error ? e.message : String(e)));
    out.push("");
  }

  try {
    const violRows = await soql("wvxf-dwi5", {
      $select: "violationid",
      $where: `boro = '${BOROUGH}' AND block = '${escape(BLOCK)}' AND lot = '${escape(LOT)}'`,
      $limit: 5000,
    });
    out.push("--- HPD Violations ---");
    out.push("Violations count: " + String(violRows.length));
    out.push("");
  } catch (e) {
    out.push("HPD Violations error: " + (e instanceof Error ? e.message : String(e)));
    out.push("");
  }

  try {
    const permitRowsForBin = await soql<{ bin?: string }>("rbx6-tga4", {
      $select: "bin",
      $where: `bbl = '${escape(BBL)}'`,
      $limit: 1,
    });
    const bin = permitRowsForBin[0]?.bin?.trim();
    if (bin) {
      const complaintRows = await soql("eabe-havv", {
        $select: "bin",
        $where: `bin = '${escape(bin)}'`,
        $limit: 5000,
      });
      out.push("--- DOB Complaints (by BIN from permits) ---");
      out.push("BIN used: " + bin);
      out.push("Complaints count: " + String(complaintRows.length));
    } else {
      out.push("--- DOB Complaints ---");
      out.push("No BIN from permits; cannot query DOB complaints.");
    }
    out.push("");
  } catch (e) {
    out.push("DOB Complaints error: " + (e instanceof Error ? e.message : String(e)));
    out.push("");
  }

  console.log(out.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
