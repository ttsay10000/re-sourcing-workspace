/**
 * Fetch ACRIS documents by owner name from NYC Open Data.
 * Uses ACRIS Real Property Parties (name → document_id), then Master and Legals for metadata.
 * Does not call the live ACRIS website (a836-acris.nyc.gov); that is handled separately.
 */

import { fetchSocrataQuery, resourceUrl, escapeSoQLString, type SoQLQueryParams, type FetchSocrataOptions } from "./socrata/client.js";

/** NYC Open Data ACRIS dataset IDs (resource path segment). */
const PARTIES_DATASET = "636b-3b5g"; // ACRIS - Real Property Parties
const MASTER_DATASET = "bnx9-e6tj";   // ACRIS - Real Property Master
const LEGALS_DATASET = "8h5j-fqxa";   // ACRIS - Real Property Legals

const PARTIES_BASE = resourceUrl(PARTIES_DATASET);
const MASTER_BASE = resourceUrl(MASTER_DATASET);
const LEGALS_BASE = resourceUrl(LEGALS_DATASET);

/** Max document_ids per batch for Master/Legals IN queries (avoid URL length limits). */
const BATCH_SIZE = 50;

/** Delay between batch requests to ease rate limits. */
const BATCH_DELAY_MS = 200;

export interface AcrisDocumentSummary {
  documentId: string;
  crfn: string | null;
  docType: string | null;
  documentDate: string | null;
  recordedDatetime: string | null;
  recordedBorough: number | null;
  /** From Legals: one row per BBL/location; may be multiple per document. */
  legals: Array<{
    borough: number | null;
    block: number | null;
    lot: number | null;
    streetNumber: string | null;
    streetName: string | null;
    unit: string | null;
  }>;
}

interface PartiesRow {
  document_id?: string | null;
  [key: string]: unknown;
}

interface MasterRow {
  document_id?: string | null;
  crfn?: string | null;
  doc_type?: string | null;
  document_date?: string | null;
  recorded_datetime?: string | null;
  recorded_borough?: number | string | null;
  [key: string]: unknown;
}

interface LegalsRow {
  document_id?: string | null;
  borough?: number | string | null;
  block?: number | string | null;
  lot?: number | string | null;
  street_number?: string | null;
  street_name?: string | null;
  unit?: string | null;
  [key: string]: unknown;
}

function str(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s === "" ? null : s;
}

function num(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val === "number" && !Number.isNaN(val)) return val;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}

/**
 * Normalize owner name for search: trim, collapse runs of whitespace.
 * Matches style used in nyDosEntity so "18 CHRISTOPHER STREET, LLC" and variants match.
 */
export function normalizeOwnerNameForSearch(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch unique document_ids from ACRIS Real Property Parties where party name matches.
 * Uses party_type 1 (grantors/owners) only to focus on ownership-related documents; optional filter.
 */
async function fetchDocumentIdsByOwnerName(
  ownerName: string,
  options: FetchSocrataOptions & { partyType1Only?: boolean } = {}
): Promise<string[]> {
  const normalized = normalizeOwnerNameForSearch(ownerName);
  if (!normalized) return [];

  const escaped = escapeSoQLString(normalized);
  // Case-insensitive contains: UPPER(name) LIKE '%' || UPPER('...') || '%'
  const whereClause = options.partyType1Only
    ? `(UPPER(name) LIKE '%' || UPPER('${escaped}') || '%' AND party_type = '1')`
    : `UPPER(name) LIKE '%' || UPPER('${escaped}') || '%'`;

  const params: SoQLQueryParams = {
    $select: "document_id",
    $where: whereClause,
    $order: "document_id",
    $limit: 1000,
    $offset: 0,
  };

  const rows = await fetchSocrataQuery<PartiesRow>(PARTIES_BASE, params, options);
  const ids = new Set<string>();
  for (const row of rows) {
    const id = str(row.document_id);
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

/**
 * Fetch Master rows for the given document_ids (batched).
 */
async function fetchMasterRows(
  documentIds: string[],
  options: FetchSocrataOptions
): Promise<MasterRow[]> {
  if (documentIds.length === 0) return [];

  const all: MasterRow[] = [];
  for (let i = 0; i < documentIds.length; i += BATCH_SIZE) {
    const batch = documentIds.slice(i, i + BATCH_SIZE);
    const inList = batch.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(",");
    const params: SoQLQueryParams = {
      $select: "document_id,crfn,doc_type,document_date,recorded_datetime,recorded_borough",
      $where: `document_id in (${inList})`,
      $order: "document_id",
      $limit: BATCH_SIZE,
      $offset: 0,
    };
    const page = await fetchSocrataQuery<MasterRow>(MASTER_BASE, params, options);
    all.push(...page);
    if (i + BATCH_SIZE < documentIds.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  return all;
}

/**
 * Fetch Legals rows for the given document_ids (batched).
 */
async function fetchLegalsRows(
  documentIds: string[],
  options: FetchSocrataOptions
): Promise<LegalsRow[]> {
  if (documentIds.length === 0) return [];

  const all: LegalsRow[] = [];
  for (let i = 0; i < documentIds.length; i += BATCH_SIZE) {
    const batch = documentIds.slice(i, i + BATCH_SIZE);
    const inList = batch.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(",");
    const params: SoQLQueryParams = {
      $select: "document_id,borough,block,lot,street_number,street_name,unit",
      $where: `document_id in (${inList})`,
      $order: "document_id",
      $limit: 5000,
      $offset: 0,
    };
    const page = await fetchSocrataQuery<LegalsRow>(LEGALS_BASE, params, options);
    all.push(...page);
    if (i + BATCH_SIZE < documentIds.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  return all;
}

/**
 * Fetch ACRIS documents by owner name from NYC Open Data.
 * Queries Parties by name → document_ids, then Master and Legals for metadata.
 * Optionally filter by BBL (borough-block-lot): only return documents that have a Legals row matching the given BBL.
 */
export async function fetchAcrisDocumentsByOwnerName(
  ownerName: string,
  options: FetchSocrataOptions & {
    /** If set, only return documents that have at least one Legals row matching this BBL (e.g. "10013820133"). */
    bbl?: string | null;
    /** If true, only match party_type = 1 (grantors/owners) in Parties. */
    partyType1Only?: boolean;
  } = {}
): Promise<AcrisDocumentSummary[]> {
  const documentIds = await fetchDocumentIdsByOwnerName(ownerName, {
    appToken: options.appToken,
    timeoutMs: options.timeoutMs,
    partyType1Only: options.partyType1Only ?? false,
  });

  if (documentIds.length === 0) return [];

  const [masterRows, legalsRows] = await Promise.all([
    fetchMasterRows(documentIds, options),
    fetchLegalsRows(documentIds, options),
  ]);

  const masterByDocId = new Map<string, MasterRow>();
  for (const row of masterRows) {
    const id = str(row.document_id);
    if (id && !masterByDocId.has(id)) masterByDocId.set(id, row);
  }

  const legalsByDocId = new Map<string, LegalsRow[]>();
  for (const row of legalsRows) {
    const id = str(row.document_id);
    if (!id) continue;
    const list = legalsByDocId.get(id) ?? [];
    list.push(row);
    legalsByDocId.set(id, list);
  }

  /** Parse BBL "10013820133" into borough, block, lot (1, 1382, 133). */
  const bblParts = options.bbl
    ? parseBbl(options.bbl)
    : null;

  const results: AcrisDocumentSummary[] = [];
  for (const docId of documentIds) {
    const master = masterByDocId.get(docId);
    const legalsList = legalsByDocId.get(docId) ?? [];

    if (bblParts && legalsList.length > 0) {
      const matchesBbl = legalsList.some(
        (l) =>
          num(l.borough) === bblParts.borough &&
          num(l.block) === bblParts.block &&
          num(l.lot) === bblParts.lot
      );
      if (!matchesBbl) continue;
    }

    const legals = legalsList.map((l) => ({
      borough: num(l.borough),
      block: num(l.block),
      lot: num(l.lot),
      streetNumber: str(l.street_number),
      streetName: str(l.street_name),
      unit: str(l.unit),
    }));

    results.push({
      documentId: docId,
      crfn: master ? str(master.crfn) : null,
      docType: master ? str(master.doc_type) : null,
      documentDate: master ? str(master.document_date) : null,
      recordedDatetime: master ? str(master.recorded_datetime) : null,
      recordedBorough: master ? num(master.recorded_borough) : null,
      legals,
    });
  }

  // Sort by recorded date descending when available, then by document_id
  results.sort((a, b) => {
    const aDate = a.recordedDatetime ?? a.documentDate ?? "";
    const bDate = b.recordedDatetime ?? b.documentDate ?? "";
    if (aDate !== bDate) return bDate.localeCompare(aDate);
    return a.documentId.localeCompare(b.documentId);
  });

  return results;
}

function parseBbl(bbl: string): { borough: number; block: number; lot: number } | null {
  const s = String(bbl).trim();
  if (s.length < 10) return null;
  const borough = parseInt(s.slice(0, 1), 10);
  const block = parseInt(s.slice(1, 6), 10);
  const lot = parseInt(s.slice(6), 10);
  if (Number.isNaN(borough) || Number.isNaN(block) || Number.isNaN(lot)) return null;
  return { borough, block, lot };
}
