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
        min_sqft, max_sqft, required_amenities, source_toggles,
        schedule_cron, run_interval_minutes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
        input.minSqft ?? null,
        input.maxSqft ?? null,
        input.requiredAmenities ?? [],
        JSON.stringify(input.sourceToggles ?? { streeteasy: true, manual: true }),
        input.scheduleCron ?? null,
        input.runIntervalMinutes ?? null,
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
    if (input.minSqft !== undefined) { sets.push(`min_sqft = $${i++}`); values.push(input.minSqft); }
    if (input.maxSqft !== undefined) { sets.push(`max_sqft = $${i++}`); values.push(input.maxSqft); }
    if (input.requiredAmenities !== undefined) { sets.push(`required_amenities = $${i++}`); values.push(input.requiredAmenities); }
    if (input.sourceToggles !== undefined) { sets.push(`source_toggles = $${i++}`); values.push(JSON.stringify(input.sourceToggles)); }
    if (input.scheduleCron !== undefined) { sets.push(`schedule_cron = $${i++}`); values.push(input.scheduleCron); }
    if (input.runIntervalMinutes !== undefined) { sets.push(`run_interval_minutes = $${i++}`); values.push(input.runIntervalMinutes); }
    if (sets.length === 1) return this.byId(id);
    values.push(id);
    const r = await this.client.query(
      `UPDATE profiles SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    return r.rows[0] ? mapProfile(r.rows[0]) : null;
  }
}
