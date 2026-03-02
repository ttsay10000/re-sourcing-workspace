/**
 * Resolve condo billing BBL to base (tax lot) BBL for NYC Open Data queries.
 * Geoclient returns the billing BBL (e.g. 1007167507) for condo addresses; many datasets
 * (zoning, permits, CO, HPD) key by the base BBL (e.g. 1007160052). This function looks up
 * the CONDO dataset (p8u6-a6it) and returns condo_base_bbl when the given BBL is a
 * condo_billing_bbl, so enrichment queries return rows for condos.
 * See CONDOS_IN_NYC_DATASETS.md for full research.
 */

import { resourceUrl, fetchSocrataQuery, normalizeBblForQuery } from "./socrata/index.js";

const CONDO_DATASET_ID = "p8u6-a6it";

export interface ResolveCondoBblOptions {
  appToken?: string | null;
}

/**
 * If the given BBL is a condo billing BBL, return the corresponding base BBL for API queries.
 * Otherwise return the same (normalized) BBL. Returns null if bbl is invalid.
 */
export async function resolveCondoBblForQuery(
  bbl: string | number | null | undefined,
  options: ResolveCondoBblOptions = {}
): Promise<string | null> {
  const normalized = normalizeBblForQuery(bbl);
  if (!normalized) return null;

  try {
    const url = resourceUrl(CONDO_DATASET_ID);
    const rows = await fetchSocrataQuery<{ condo_base_bbl: string }>(
      url,
      {
        $select: "condo_base_bbl",
        $where: `condo_billing_bbl = '${normalized}'`,
        $order: "1",
        $limit: 1,
        $offset: 0,
      },
      { appToken: options.appToken ?? undefined }
    );
    const base = rows[0]?.condo_base_bbl;
    if (base != null && typeof base === "string" && /^\d{10}$/.test(base.trim())) {
      return base.trim();
    }
  } catch {
    // On any error, fall back to original BBL
  }
  return normalized;
}
