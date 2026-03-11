import type { PoolClient } from "pg";
import type { SearchProfile, SearchProfileInput } from "@re-sourcing/contracts";
import { mapProfile } from "../map.js";

export interface ProfileRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export class ProfileRepo {
  constructor(private options: ProfileRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async byId(id: string): Promise<SearchProfile | null> {
    const r = await this.client.query(
      "SELECT * FROM profiles WHERE id = $1",
      [id]
    );
    return r.rows[0] ? mapProfile(r.rows[0]) : null;
  }

  async list(): Promise<SearchProfile[]> {
    const r = await this.client.query(
      "SELECT * FROM profiles ORDER BY updated_at DESC"
    );
    return r.rows.map(mapProfile);
  }

  async create(input: SearchProfileInput): Promise<SearchProfile> {
    const r = await this.client.query(
      `INSERT INTO profiles (
        name, location_mode, single_location_slug, area_codes,
        min_price, max_price, min_beds, max_beds, min_baths, max_baths,
        max_hoa, max_tax, min_sqft, max_sqft, required_amenities, property_types, source_toggles,
        enabled, schedule_cadence, timezone, run_time_local, weekly_run_day, monthly_run_day,
        next_run_at, last_run_at, last_success_at, outreach_rules,
        schedule_cron, run_interval_minutes, result_limit
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
      RETURNING *`,
      [
        input.name,
        input.locationMode,
        input.singleLocationSlug ?? null,
        input.areaCodes ?? [],
        input.minPrice ?? null,
        input.maxPrice ?? null,
        input.minBeds ?? null,
        input.maxBeds ?? null,
        input.minBaths ?? null,
        input.maxBaths ?? null,
        input.maxHoa ?? null,
        input.maxTax ?? null,
        input.minSqft ?? null,
        input.maxSqft ?? null,
        input.requiredAmenities ?? [],
        input.propertyTypes ?? [],
        JSON.stringify(input.sourceToggles ?? { streeteasy: true, manual: true }),
        input.enabled ?? true,
        input.scheduleCadence ?? "manual",
        input.timezone ?? "America/New_York",
        input.runTimeLocal ?? null,
        input.weeklyRunDay ?? null,
        input.monthlyRunDay ?? null,
        input.nextRunAt ?? null,
        input.lastRunAt ?? null,
        input.lastSuccessAt ?? null,
        JSON.stringify(input.outreachRules ?? {}),
        input.scheduleCron ?? null,
        input.runIntervalMinutes ?? null,
        input.resultLimit ?? null,
      ]
    );
    return mapProfile(r.rows[0]);
  }

  async update(id: string, input: Partial<SearchProfileInput>): Promise<SearchProfile | null> {
    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    let i = 1;
    if (input.name !== undefined) { sets.push(`name = $${i++}`); values.push(input.name); }
    if (input.locationMode !== undefined) { sets.push(`location_mode = $${i++}`); values.push(input.locationMode); }
    if (input.singleLocationSlug !== undefined) { sets.push(`single_location_slug = $${i++}`); values.push(input.singleLocationSlug); }
    if (input.areaCodes !== undefined) { sets.push(`area_codes = $${i++}`); values.push(input.areaCodes); }
    if (input.minPrice !== undefined) { sets.push(`min_price = $${i++}`); values.push(input.minPrice); }
    if (input.maxPrice !== undefined) { sets.push(`max_price = $${i++}`); values.push(input.maxPrice); }
    if (input.minBeds !== undefined) { sets.push(`min_beds = $${i++}`); values.push(input.minBeds); }
    if (input.maxBeds !== undefined) { sets.push(`max_beds = $${i++}`); values.push(input.maxBeds); }
    if (input.minBaths !== undefined) { sets.push(`min_baths = $${i++}`); values.push(input.minBaths); }
    if (input.maxBaths !== undefined) { sets.push(`max_baths = $${i++}`); values.push(input.maxBaths); }
    if (input.maxHoa !== undefined) { sets.push(`max_hoa = $${i++}`); values.push(input.maxHoa); }
    if (input.maxTax !== undefined) { sets.push(`max_tax = $${i++}`); values.push(input.maxTax); }
    if (input.minSqft !== undefined) { sets.push(`min_sqft = $${i++}`); values.push(input.minSqft); }
    if (input.maxSqft !== undefined) { sets.push(`max_sqft = $${i++}`); values.push(input.maxSqft); }
    if (input.requiredAmenities !== undefined) { sets.push(`required_amenities = $${i++}`); values.push(input.requiredAmenities); }
    if (input.propertyTypes !== undefined) { sets.push(`property_types = $${i++}`); values.push(input.propertyTypes); }
    if (input.sourceToggles !== undefined) { sets.push(`source_toggles = $${i++}`); values.push(JSON.stringify(input.sourceToggles)); }
    if (input.enabled !== undefined) { sets.push(`enabled = $${i++}`); values.push(input.enabled); }
    if (input.scheduleCadence !== undefined) { sets.push(`schedule_cadence = $${i++}`); values.push(input.scheduleCadence); }
    if (input.timezone !== undefined) { sets.push(`timezone = $${i++}`); values.push(input.timezone); }
    if (input.runTimeLocal !== undefined) { sets.push(`run_time_local = $${i++}`); values.push(input.runTimeLocal); }
    if (input.weeklyRunDay !== undefined) { sets.push(`weekly_run_day = $${i++}`); values.push(input.weeklyRunDay); }
    if (input.monthlyRunDay !== undefined) { sets.push(`monthly_run_day = $${i++}`); values.push(input.monthlyRunDay); }
    if (input.nextRunAt !== undefined) { sets.push(`next_run_at = $${i++}`); values.push(input.nextRunAt); }
    if (input.lastRunAt !== undefined) { sets.push(`last_run_at = $${i++}`); values.push(input.lastRunAt); }
    if (input.lastSuccessAt !== undefined) { sets.push(`last_success_at = $${i++}`); values.push(input.lastSuccessAt); }
    if (input.outreachRules !== undefined) { sets.push(`outreach_rules = $${i++}`); values.push(JSON.stringify(input.outreachRules)); }
    if (input.scheduleCron !== undefined) { sets.push(`schedule_cron = $${i++}`); values.push(input.scheduleCron); }
    if (input.runIntervalMinutes !== undefined) { sets.push(`run_interval_minutes = $${i++}`); values.push(input.runIntervalMinutes); }
    if (input.resultLimit !== undefined) { sets.push(`result_limit = $${i++}`); values.push(input.resultLimit); }
    if (sets.length === 1) return this.byId(id);
    values.push(id);
    const r = await this.client.query(
      `UPDATE profiles SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    return r.rows[0] ? mapProfile(r.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.client.query("DELETE FROM profiles WHERE id = $1 RETURNING id", [id]);
    return (r.rowCount ?? 0) > 0;
  }
}
