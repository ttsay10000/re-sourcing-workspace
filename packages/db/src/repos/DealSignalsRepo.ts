import type { PoolClient } from "pg";
import type { DealSignalRow } from "@re-sourcing/contracts";
import { mapDealSignalRow } from "../map.js";

export interface DealSignalsRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface InsertDealSignalsParams {
  propertyId: string;
  pricePerUnit?: number | null;
  pricePsf?: number | null;
  assetCapRate?: number | null;
  adjustedCapRate?: number | null;
  yieldSpread?: number | null;
  rentUpside?: number | null;
  rentPsfRatio?: number | null;
  expenseRatio?: number | null;
  liquidityScore?: number | null;
  riskScore?: number | null;
  priceMomentum?: number | null;
  dealScore?: number | null;
}

export class DealSignalsRepo {
  constructor(private options: DealSignalsRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async insert(params: InsertDealSignalsParams): Promise<DealSignalRow> {
    const r = await this.client.query(
      `INSERT INTO deal_signals (
        property_id, price_per_unit, price_psf, asset_cap_rate, adjusted_cap_rate,
        yield_spread, rent_upside, rent_psf_ratio, expense_ratio,
        liquidity_score, risk_score, price_momentum, deal_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        params.propertyId,
        params.pricePerUnit ?? null,
        params.pricePsf ?? null,
        params.assetCapRate ?? null,
        params.adjustedCapRate ?? null,
        params.yieldSpread ?? null,
        params.rentUpside ?? null,
        params.rentPsfRatio ?? null,
        params.expenseRatio ?? null,
        params.liquidityScore ?? null,
        params.riskScore ?? null,
        params.priceMomentum ?? null,
        params.dealScore ?? null,
      ]
    );
    return mapDealSignalRow(r.rows[0]);
  }

  async getLatestByPropertyId(propertyId: string): Promise<DealSignalRow | null> {
    const r = await this.client.query(
      "SELECT * FROM deal_signals WHERE property_id = $1 ORDER BY generated_at DESC LIMIT 1",
      [propertyId]
    );
    return r.rows[0] ? mapDealSignalRow(r.rows[0]) : null;
  }

  async listByPropertyId(propertyId: string, limit = 10): Promise<DealSignalRow[]> {
    const r = await this.client.query(
      "SELECT * FROM deal_signals WHERE property_id = $1 ORDER BY generated_at DESC LIMIT $2",
      [propertyId, limit]
    );
    return r.rows.map((row: Record<string, unknown>) => mapDealSignalRow(row));
  }
}
