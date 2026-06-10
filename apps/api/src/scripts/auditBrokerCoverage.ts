/**
 * Read-only audit of broker-contact coverage and outreach-batching feasibility.
 *
 * Reports, against the configured DATABASE_URL (SELECT-only, no writes):
 *  - recipient-resolution status counts (how many properties can be emailed today)
 *  - listing agent-enrichment coverage (names present vs emails found — the LLM gap)
 *  - properties-per-broker-email distribution (how often grouped outreach would batch)
 *  - broker_contacts directory coverage
 *  - prior-send stats per recipient
 *
 * Examples:
 *   npm run audit:broker-coverage -w @re-sourcing/api
 *   npm run audit:broker-coverage -w @re-sourcing/api -- --json
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

import { closePool, getPool } from "@re-sourcing/db";

interface CountRow extends Record<string, unknown> {
  label: string;
  count: string;
}

function printSection(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function printRows(rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    console.log("(no rows)");
    return;
  }
  console.table(rows);
}

async function main(): Promise<void> {
  const asJson = process.argv.includes("--json");
  const pool = getPool();
  const report: Record<string, unknown> = {};

  const totals = await pool.query<CountRow>(
    `SELECT 'properties' AS label, COUNT(*)::text AS count FROM properties
     UNION ALL
     SELECT 'active sourcing state', COUNT(*)::text FROM property_sourcing_state WHERE disposition = 'active'
     UNION ALL
     SELECT 'listings with agent names', COUNT(*)::text FROM listings WHERE COALESCE(array_length(agent_names, 1), 0) > 0
     UNION ALL
     SELECT 'listings (all)', COUNT(*)::text FROM listings`
  );
  report.totals = totals.rows;

  // How many properties currently resolve to a sendable broker email, and why not.
  const recipientStatus = await pool.query(
    `SELECT COALESCE(r.status, 'no_resolution_row') AS status,
            COUNT(*)::int AS properties,
            COUNT(*) FILTER (WHERE r.contact_email IS NOT NULL)::int AS with_email
     FROM properties p
     LEFT JOIN property_recipient_resolution r ON r.property_id = p.id
     GROUP BY 1
     ORDER BY 2 DESC`
  );
  report.recipientResolution = recipientStatus.rows;

  // The LLM gap: listings where we know the broker name but found no email.
  const enrichmentCoverage = await pool.query(
    `WITH listing_email AS (
       SELECT id,
              COALESCE(array_length(agent_names, 1), 0) > 0 AS has_names,
              EXISTS (
                SELECT 1 FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(agent_enrichment) = 'array' THEN agent_enrichment ELSE '[]'::jsonb END
                ) AS entry
                WHERE NULLIF(BTRIM(COALESCE(entry->>'email', '')), '') IS NOT NULL
              ) AS has_email,
              EXISTS (
                SELECT 1 FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(agent_enrichment) = 'array' THEN agent_enrichment ELSE '[]'::jsonb END
                ) AS entry
                WHERE NULLIF(BTRIM(COALESCE(entry->>'firm', '')), '') IS NOT NULL
              ) AS has_firm
       FROM listings
     )
     SELECT
       COUNT(*) FILTER (WHERE has_names)::int AS listings_with_names,
       COUNT(*) FILTER (WHERE has_names AND has_email)::int AS names_and_email,
       COUNT(*) FILTER (WHERE has_names AND NOT has_email)::int AS names_no_email,
       COUNT(*) FILTER (WHERE has_names AND has_firm AND NOT has_email)::int AS names_and_firm_no_email,
       ROUND(100.0 * COUNT(*) FILTER (WHERE has_names AND has_email) / NULLIF(COUNT(*) FILTER (WHERE has_names), 0), 1) AS email_hit_rate_pct
     FROM listing_email`
  );
  report.enrichmentCoverage = enrichmentCoverage.rows[0] ?? null;

  // Grouping feasibility: when emails resolve, how many properties share a broker?
  const groupingDistribution = await pool.query(
    `WITH grouped AS (
       SELECT LOWER(TRIM(r.contact_email)) AS email, COUNT(DISTINCT r.property_id)::int AS property_count
       FROM property_recipient_resolution r
       WHERE r.contact_email IS NOT NULL
       GROUP BY 1
     )
     SELECT property_count AS properties_per_broker, COUNT(*)::int AS brokers
     FROM grouped
     GROUP BY 1
     ORDER BY 1`
  );
  report.groupingDistribution = groupingDistribution.rows;

  const topBrokers = await pool.query(
    `SELECT LOWER(TRIM(r.contact_email)) AS email, COUNT(DISTINCT r.property_id)::int AS properties
     FROM property_recipient_resolution r
     WHERE r.contact_email IS NOT NULL
     GROUP BY 1
     HAVING COUNT(DISTINCT r.property_id) > 1
     ORDER BY 2 DESC
     LIMIT 15`
  );
  report.topMultiPropertyBrokers = topBrokers.rows;

  // Directory: what the broker_contacts table already knows.
  const directory = await pool.query(
    `SELECT COUNT(*)::int AS contacts,
            COUNT(*) FILTER (WHERE normalized_email IS NOT NULL)::int AS with_email,
            COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(firm, '')), '') IS NOT NULL)::int AS with_firm,
            COUNT(DISTINCT LOWER(COALESCE(firm, '')))::int AS distinct_firms
     FROM broker_contacts`
  );
  report.brokerDirectory = directory.rows[0] ?? null;

  // Outreach history: sends per recipient (dedupe/batching context).
  const sendStats = await pool.query(
    `SELECT COUNT(*)::int AS total_sends,
            COUNT(DISTINCT LOWER(TRIM(to_address)))::int AS distinct_recipients,
            COUNT(*) FILTER (WHERE sent_at >= now() - interval '30 days')::int AS sends_last_30d
     FROM property_inquiry_sends`
  );
  report.inquirySends = sendStats.rows[0] ?? null;

  const batchStats = await pool.query(
    `SELECT status, created_by, COUNT(*)::int AS batches
     FROM outreach_batches
     GROUP BY 1, 2
     ORDER BY 3 DESC`
  );
  report.outreachBatches = batchStats.rows;

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printSection("Totals");
  printRows(totals.rows);
  printSection("Recipient resolution by status (sendable = resolved/manual_override with email)");
  printRows(recipientStatus.rows);
  printSection("Listing agent-enrichment coverage (the broker-LLM gap)");
  printRows(enrichmentCoverage.rows);
  printSection("Properties per broker email (grouped outreach batch sizes)");
  printRows(groupingDistribution.rows);
  printSection("Top multi-property brokers");
  printRows(topBrokers.rows);
  printSection("Broker directory (broker_contacts)");
  printRows(directory.rows);
  printSection("Inquiry sends");
  printRows(sendStats.rows);
  printSection("Outreach batches");
  printRows(batchStats.rows);
}

main()
  .catch((err) => {
    console.error("[auditBrokerCoverage]", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
