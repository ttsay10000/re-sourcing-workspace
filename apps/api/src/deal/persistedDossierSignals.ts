import type { DealSignalRow, PropertyDetails } from "@re-sourcing/contracts";
import { mapDealSignalRow, type DealSignalsRepo } from "@re-sourcing/db";
import type { Pool } from "pg";
import { getPropertyDossierSummary } from "./propertyDossierState.js";

export async function getPersistedDossierSignals(params: {
  pool: Pool;
  propertyId: string;
  details: PropertyDetails | null;
  signalsRepo: DealSignalsRepo;
}): Promise<DealSignalRow | null> {
  const dossierSummary = getPropertyDossierSummary(params.details);
  if (dossierSummary?.dealSignalsId) {
    const byId = await params.pool.query(
      "SELECT * FROM deal_signals WHERE id = $1 AND property_id = $2 LIMIT 1",
      [dossierSummary.dealSignalsId, params.propertyId]
    );
    if (byId.rows[0]) return mapDealSignalRow(byId.rows[0]);
  }

  const cutoff = dossierSummary?.dealSignalsGeneratedAt ?? dossierSummary?.generatedAt ?? null;
  if (cutoff) {
    const byTimestamp = await params.pool.query(
      `SELECT *
       FROM deal_signals
       WHERE property_id = $1
         AND generated_at <= $2::timestamptz
       ORDER BY generated_at DESC
       LIMIT 1`,
      [params.propertyId, cutoff]
    );
    if (byTimestamp.rows[0]) return mapDealSignalRow(byTimestamp.rows[0]);
  }

  return params.signalsRepo.getLatestByPropertyId(params.propertyId);
}
