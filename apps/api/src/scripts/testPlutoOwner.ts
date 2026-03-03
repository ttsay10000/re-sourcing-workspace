/**
 * Quick test: fetch PLUTO owner for several BBLs (no DB).
 * Run: npx tsx apps/api/src/scripts/testPlutoOwner.ts [BBL1 BBL2 ...]
 */

import { fetchPlutoOwnerByBbl } from "../enrichment/plutoOwner.js";

const DEFAULT_BBLS = ["1006150061", "1007167507", "4051980021", "2027470001", "3012380016"];

async function main(): Promise<void> {
  const bbls = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_BBLS;
  console.log("PLUTO owner test – BBLs:", bbls.join(", "));
  console.log("");

  for (const bbl of bbls) {
    try {
      const result = await fetchPlutoOwnerByBbl(bbl, { timeoutMs: 15_000 });
      console.log(`${bbl}: ${result?.ownername ?? "(no result)"}`);
    } catch (e) {
      console.log(`${bbl}: ERROR ${e instanceof Error ? e.message : e}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
