import type { PoolClient } from "pg";
import type { SystemEvent } from "@re-sourcing/contracts";
import { mapEvent } from "../map.js";

export interface EventRepoOptions {
  client?: PoolClient;
  pool: import("pg").Pool;
}

export interface ListEventsFilters {
  eventType?: string;
  limit?: number;
  offset?: number;
  since?: string;
}

export class EventRepo {
  constructor(private options: EventRepoOptions) {}

  private get client() {
    return this.options.client ?? this.options.pool;
  }

  async list(filters?: ListEventsFilters): Promise<{ events: SystemEvent[]; total: number }> {
    const values: unknown[] = [];
    let i = 1;
    let sql = "SELECT * FROM system_events WHERE 1=1";
    let countSql = "SELECT count(*)::int FROM system_events WHERE 1=1";
    if (filters?.eventType) {
      sql += ` AND event_type = $${i}`;
      countSql += ` AND event_type = $${i}`;
      values.push(filters.eventType);
      i++;
    }
    if (filters?.since) {
      sql += ` AND created_at >= $${i}`;
      countSql += ` AND created_at >= $${i}`;
      values.push(filters.since);
      i++;
    }
    sql += " ORDER BY created_at DESC";
    const countValues = [...values];
    if (filters?.limit != null) {
      sql += ` LIMIT $${i}`;
      values.push(filters.limit);
      i++;
    }
    if (filters?.offset != null) {
      sql += ` OFFSET $${i}`;
      values.push(filters.offset);
    }
    const [rows, countResult] = await Promise.all([
      this.client.query(sql, values),
      this.client.query(countSql, countValues),
    ]);
    const total = (countResult.rows[0]?.count as number) ?? 0;
    return {
      events: rows.rows.map(mapEvent),
      total,
    };
  }

  async emit(eventType: string, payload: Record<string, unknown>): Promise<SystemEvent> {
    const r = await this.client.query(
      `INSERT INTO system_events (event_type, payload) VALUES ($1, $2) RETURNING *`,
      [eventType, JSON.stringify(payload ?? {})]
    );
    return mapEvent(r.rows[0]);
  }
}
