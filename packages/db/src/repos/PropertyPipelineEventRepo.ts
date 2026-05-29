import type { PoolClient } from "pg";

type JsonObject = Record<string, unknown>;

export interface PropertyPipelineEvent {
  id: string;
  propertyId: string;
  eventType: string;
  actor?: string | null;
  source: string;
  title: string;
  body?: string | null;
  metadata: JsonObject;
  createdAt: string;
}

export interface CreatePropertyPipelineEventParams {
  propertyId: string;
  eventType: string;
  actor?: string | null;
  source?: string | null;
  title: string;
  body?: string | null;
  metadata?: JsonObject | null;
}

export interface ListPropertyPipelineEventsOptions {
  eventTypes?: string[];
  limit?: number;
  offset?: number;
  before?: string;
  since?: string;
}

export interface PropertyPipelineEventRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

function toIso(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function toJsonObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  return {};
}

function mapPropertyPipelineEvent(row: Record<string, unknown>): PropertyPipelineEvent {
  return {
    id: row.id as string,
    propertyId: row.property_id as string,
    eventType: row.event_type as string,
    actor: (row.actor as string) ?? null,
    source: (row.source as string) ?? "system",
    title: row.title as string,
    body: (row.body as string) ?? null,
    metadata: toJsonObject(row.metadata),
    createdAt: toIso(row.created_at),
  };
}

export class PropertyPipelineEventRepo {
  constructor(private options: PropertyPipelineEventRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async create(params: CreatePropertyPipelineEventParams): Promise<PropertyPipelineEvent> {
    const r = await this.client.query(
      `INSERT INTO property_pipeline_events (
         property_id, event_type, actor, source, title, body, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        params.propertyId,
        params.eventType,
        params.actor ?? null,
        params.source ?? "system",
        params.title,
        params.body ?? null,
        JSON.stringify(params.metadata ?? {}),
      ]
    );
    return mapPropertyPipelineEvent(r.rows[0]);
  }

  async listByPropertyId(
    propertyId: string,
    options?: ListPropertyPipelineEventsOptions
  ): Promise<PropertyPipelineEvent[]> {
    const { sql, values } = this.buildListQuery("property_id = $1", [propertyId], options);
    const r = await this.client.query(sql, values);
    return r.rows.map(mapPropertyPipelineEvent);
  }

  async listByPropertyIds(
    propertyIds: string[],
    options?: Omit<ListPropertyPipelineEventsOptions, "offset">
  ): Promise<PropertyPipelineEvent[]> {
    if (propertyIds.length === 0) return [];
    const { sql, values } = this.buildListQuery("property_id = ANY($1::uuid[])", [propertyIds], options);
    const r = await this.client.query(sql, values);
    return r.rows.map(mapPropertyPipelineEvent);
  }

  async listRecent(options?: ListPropertyPipelineEventsOptions & { propertyId?: string }): Promise<PropertyPipelineEvent[]> {
    const predicates: string[] = ["1=1"];
    const values: unknown[] = [];
    if (options?.propertyId) {
      values.push(options.propertyId);
      predicates.push(`property_id = $${values.length}`);
    }
    const { sql, values: finalValues } = this.buildListQuery(predicates.join(" AND "), values, options);
    const r = await this.client.query(sql, finalValues);
    return r.rows.map(mapPropertyPipelineEvent);
  }

  private buildListQuery(
    basePredicate: string,
    baseValues: unknown[],
    options?: ListPropertyPipelineEventsOptions
  ): { sql: string; values: unknown[] } {
    const predicates = [basePredicate];
    const values = [...baseValues];
    if (options?.eventTypes?.length) {
      values.push(options.eventTypes);
      predicates.push(`event_type = ANY($${values.length}::text[])`);
    }
    if (options?.before) {
      values.push(options.before);
      predicates.push(`created_at < $${values.length}`);
    }
    if (options?.since) {
      values.push(options.since);
      predicates.push(`created_at >= $${values.length}`);
    }
    let sql = `SELECT * FROM property_pipeline_events WHERE ${predicates.join(" AND ")} ORDER BY created_at DESC`;
    if (options?.limit != null) {
      values.push(options.limit);
      sql += ` LIMIT $${values.length}`;
    }
    if (options?.offset != null) {
      values.push(options.offset);
      sql += ` OFFSET $${values.length}`;
    }
    return { sql, values };
  }
}
