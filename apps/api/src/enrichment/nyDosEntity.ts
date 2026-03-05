/**
 * Fetch NY Department of State (DOS) business entity details by entity name.
 * Dataset: Active Corporations Beginning 1800 (n9v6-gdp6) on data.ny.gov.
 * Used when owner name looks like LLC, corporation, etc. to show DOS process, CEO, registered agent.
 */

import { fetchSocrataQuery } from "./socrata/client.js";

/** NY Open Data: Active Corporations Beginning 1800 (n9v6-gdp6). SODA resource endpoint for SoQL. */
const NY_DOS_ENTITY_BASE = "https://data.ny.gov/resource/n9v6-gdp6.json";

/** Row shape from NY Active Corporations dataset (snake_case columns). */
interface NyDosRow {
  initial_dos_filing_date?: string | null;
  dos_process_name?: string | null;
  dos_process_address_1?: string | null;
  dos_process_address_2?: string | null;
  dos_process_city?: string | null;
  dos_process_state?: string | null;
  dos_process_zip?: string | null;
  chairman_name?: string | null;
  chairman_address_1?: string | null;
  chairman_address_2?: string | null;
  chairman_city?: string | null;
  chairman_state?: string | null;
  chairman_zip?: string | null;
  ceo_name?: string | null;
  ceo_address_1?: string | null;
  ceo_address_2?: string | null;
  ceo_city?: string | null;
  ceo_state?: string | null;
  ceo_zip?: string | null;
  registered_agent_name?: string | null;
  registered_agent_address_1?: string | null;
  registered_agent_address_2?: string | null;
  registered_agent_city?: string | null;
  registered_agent_state?: string | null;
  registered_agent_zip?: string | null;
  [key: string]: unknown;
}

export interface NyDosEntityResult {
  filingDate: string | null;
  dosProcessName: string | null;
  dosProcessAddress: string | null;
  ceoName: string | null;
  ceoAddress: string | null;
  registeredAgentName: string | null;
  registeredAgentAddress: string | null;
}

function str(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s === "" ? null : s;
}

function combineAddress(parts: (string | null | undefined)[]): string | null {
  const joined = parts.filter((p) => p != null && String(p).trim() !== "").join(", ");
  return joined.trim() || null;
}

function rowToResult(row: NyDosRow): NyDosEntityResult {
  const dosProcessAddress = combineAddress([
    str(row.dos_process_address_1),
    str(row.dos_process_address_2),
    str(row.dos_process_city),
    str(row.dos_process_state),
    str(row.dos_process_zip),
  ]);
  const ceoName = str(row.chairman_name ?? row.ceo_name);
  const ceoAddress = combineAddress([
    str(row.chairman_address_1 ?? row.ceo_address_1),
    str(row.chairman_address_2 ?? row.ceo_address_2),
    str(row.chairman_city ?? row.ceo_city),
    str(row.chairman_state ?? row.ceo_state),
    str(row.chairman_zip ?? row.ceo_zip),
  ]);
  const registeredAgentAddress = combineAddress([
    str(row.registered_agent_address_1),
    str(row.registered_agent_address_2),
    str(row.registered_agent_city),
    str(row.registered_agent_state),
    str(row.registered_agent_zip),
  ]);

  return {
    filingDate: str(row.initial_dos_filing_date),
    dosProcessName: str(row.dos_process_name),
    dosProcessAddress,
    ceoName,
    ceoAddress,
    registeredAgentName: str(row.registered_agent_name),
    registeredAgentAddress,
  };
}

/**
 * Normalize entity name for search: trim, collapse runs of whitespace (including newlines/tabs)
 * so trailing spaces or weird syntax from PLUTO/permits don't break NY DOS matching.
 */
function normalizeEntityNameForSearch(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch first matching NY DOS entity by current entity name (case-insensitive contains).
 * Name is normalized (trim, collapse spaces) so trailing spaces or odd formatting don't cause a miss.
 * Returns null if no match or on error.
 */
export async function fetchNyDosEntityByName(
  entityName: string,
  options: { appToken?: string | null; timeoutMs?: number } = {}
): Promise<NyDosEntityResult | null> {
  const normalized = normalizeEntityNameForSearch(entityName ?? "");
  if (!normalized) return null;

  // SoQL: LIKE is case-insensitive on many Socrata backends; escape single quotes for safety
  const escaped = normalized.replace(/'/g, "''");
  const where = `UPPER(current_entity_name) LIKE '%' || UPPER('${escaped}') || '%'`;

  const params = {
    $select: [
      "initial_dos_filing_date",
      "dos_process_name",
      "dos_process_address_1",
      "dos_process_address_2",
      "dos_process_city",
      "dos_process_state",
      "dos_process_zip",
      "chairman_name",
      "chairman_address_1",
      "chairman_address_2",
      "chairman_city",
      "chairman_state",
      "chairman_zip",
      "registered_agent_name",
      "registered_agent_address_1",
      "registered_agent_address_2",
      "registered_agent_city",
      "registered_agent_state",
      "registered_agent_zip",
    ].join(","),
    $where: where,
    $order: "initial_dos_filing_date DESC",
    $limit: 1,
    $offset: 0,
  };

  try {
    const rows = await fetchSocrataQuery<NyDosRow>(NY_DOS_ENTITY_BASE, params, {
      appToken: options.appToken,
      timeoutMs: options.timeoutMs ?? 15_000,
    });
    const row = rows[0];
    if (!row) return null;
    return rowToResult(row);
  } catch (e) {
    console.warn("[nyDosEntity] fetch failed for name:", normalized, e);
    return null;
  }
}
