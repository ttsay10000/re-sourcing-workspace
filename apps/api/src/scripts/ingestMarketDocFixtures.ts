/**
 * End-to-end market-context ingest against the real database.
 *
 * Default mode replays the five Q1 2026 fixture documents through the fixture
 * LLM runner (deterministic, no API keys needed) and prints the resulting
 * Nolita popup payload. With --live, uploads are run through the configured
 * LLM provider instead (GEMINI_API_KEY / OPENAI_API_KEY; MARKET_LLM_PROVIDER).
 * Pass --file <path> (repeatable) to ingest arbitrary local PDFs.
 *
 * Usage:
 *   npx tsx src/scripts/ingestMarketDocFixtures.ts            # fixtures, mock LLM
 *   npx tsx src/scripts/ingestMarketDocFixtures.ts --live     # fixtures, real LLM (PDF rendered)
 *   npx tsx src/scripts/ingestMarketDocFixtures.ts --live --file ~/Downloads/ay-monthly.pdf
 */
import { config } from "dotenv";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

import { readFile } from "fs/promises";
import { getPool, NeighborhoodSummaryRepo, runMigrations } from "@re-sourcing/db";
import { ingestMarketDocument } from "../marketContext/ingestMarketDocument.js";
import { PgMarketContextStore } from "../marketContext/store.js";
import { FIXTURE_AS_OF, MARKET_DOC_FIXTURES, fixtureLlmRunner } from "../marketContext/fixtures.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const live = argv.includes("--live");
  const files: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file" && argv[i + 1]) files.push(argv[i + 1]);
  }

  const pool = getPool();
  await runMigrations(pool);
  const store = new PgMarketContextStore(pool);
  const llm = live ? undefined : fixtureLlmRunner();

  if (files.length > 0) {
    for (const path of files) {
      const buffer = await readFile(path);
      const report = await ingestMarketDocument({
        filename: basename(path),
        contentType: "application/pdf",
        buffer,
        store,
        llm,
      });
      console.log(`[ingest] ${basename(path)}:`, JSON.stringify(report, null, 2));
    }
  } else {
    for (const fixture of MARKET_DOC_FIXTURES) {
      const report = await ingestMarketDocument({
        filename: fixture.filename,
        contentType: "text/plain",
        buffer: Buffer.from(fixture.text, "utf-8"),
        store,
        llm,
        asOf: FIXTURE_AS_OF,
      });
      console.log(
        `[ingest] ${fixture.id}: ${report.sourceType}/${report.documentClass} — ` +
          `${report.nComps} comps (${report.nCompsMerged} merged), ${report.nStats} stats, ` +
          `hoods: ${report.affectedNeighborhoods.join(", ") || "none"}` +
          (report.unresolvedNeighborhoods.length > 0
            ? ` | UNRESOLVED: ${report.unresolvedNeighborhoods.join(", ")}`
            : "")
      );
    }
  }

  const summaries = new NeighborhoodSummaryRepo({ pool });
  const nolita = await summaries.byId("nolita");
  console.log("\n=== Nolita popup payload ===");
  console.log(JSON.stringify(nolita, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error("[ingestMarketDocFixtures] failed:", err);
  process.exit(1);
});
