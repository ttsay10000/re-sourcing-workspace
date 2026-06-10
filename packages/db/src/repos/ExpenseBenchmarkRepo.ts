import type { PoolClient } from "pg";

export interface ExpenseBenchmarkRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface ExpenseBenchmarkRow {
  id: string;
  source: string;
  sourceYear: number | null;
  geography: string;
  buildingSizeBracket: string;
  buildingEra: string;
  metric: string;
  unitBasis: "per_unit_year" | "per_unit_month" | "pct_egi" | "expense_ratio";
  lowValue: number | null;
  typicalValue: number | null;
  highValue: number | null;
  severityLow: string;
  severityHigh: string;
  notes: string | null;
  effectiveDate: string | null;
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapRow(row: Record<string, unknown>): ExpenseBenchmarkRow {
  return {
    id: String(row.id),
    source: String(row.source),
    sourceYear: toNumber(row.source_year),
    geography: String(row.geography),
    buildingSizeBracket: String(row.building_size_bracket),
    buildingEra: String(row.building_era),
    metric: String(row.metric),
    unitBasis: String(row.unit_basis) as ExpenseBenchmarkRow["unitBasis"],
    lowValue: toNumber(row.low_value),
    typicalValue: toNumber(row.typical_value),
    highValue: toNumber(row.high_value),
    severityLow: String(row.severity_low ?? "warning"),
    severityHigh: String(row.severity_high ?? "info"),
    notes: row.notes != null ? String(row.notes) : null,
    effectiveDate: row.effective_date != null ? String(row.effective_date) : null,
  };
}

export class ExpenseBenchmarkRepo {
  constructor(private options: ExpenseBenchmarkRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  /**
   * All benchmark rows applicable to a property. Returns specific rows AND
   * 'all' fallbacks; the flag engine picks the most specific per metric.
   */
  async listFor(params: {
    geography?: string | null;
    buildingSizeBracket?: string | null;
    buildingEra?: string | null;
  }): Promise<ExpenseBenchmarkRow[]> {
    const geography = params.geography?.trim().toLowerCase() || "nyc";
    const sizeBracket = params.buildingSizeBracket?.trim() || "all";
    const era = params.buildingEra?.trim() || "all";
    const result = await this.client.query(
      `SELECT *
       FROM expense_benchmarks
       WHERE geography IN ($1, 'nyc')
         AND building_size_bracket IN ($2, 'all')
         AND building_era IN ($3, 'all')
       ORDER BY metric, unit_basis,
         (geography <> 'nyc') DESC,
         (building_size_bracket <> 'all') DESC,
         (building_era <> 'all') DESC,
         source_year DESC NULLS LAST`,
      [geography, sizeBracket, era]
    );
    return result.rows.map(mapRow);
  }
}
