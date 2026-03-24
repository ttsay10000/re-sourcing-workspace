import { basename } from "path";
import {
  deleteSalesDataset,
  importSalesDatasetFromFile,
  listSalesDatasets,
} from "../salesMetrics/store.js";

async function main(): Promise<void> {
  const filePaths = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
  if (filePaths.length === 0) {
    throw new Error("Provide one or more spreadsheet paths to import.");
  }

  const existing = await listSalesDatasets();
  for (const filePath of filePaths) {
    const originalFileName = basename(filePath);
    for (const dataset of existing.filter((entry) => entry.originalFileName === originalFileName)) {
      await deleteSalesDataset(dataset.id);
    }
    const imported = await importSalesDatasetFromFile({ filePath, sourceKind: "seeded" });
    console.log(
      `[sales-metrics] imported ${imported.name} (${imported.originalFileName}) with ${imported.pricedSaleCount} priced sales`
    );
  }
}

main().catch((err) => {
  console.error("[sales-metrics] import failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
