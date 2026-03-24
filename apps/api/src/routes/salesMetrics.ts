import { Router, type Request, type Response } from "express";
import multer from "multer";
import {
  deleteSalesDataset,
  importSalesDatasetFromBuffer,
  listSalesDatasets,
  querySalesMetrics,
} from "../salesMetrics/store.js";

const router = Router();
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 20 },
});

function handleUploadMulterError(_req: Request, res: Response, next: (err?: unknown) => void) {
  return (err: unknown) => {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "File too large.",
        details: "Max 40 MB per dataset file.",
        maxBytes: 40 * 1024 * 1024,
      });
      return;
    }
    next(err);
  };
}

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[$,\s]/g, "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDatasetIds(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const flattened = value
      .flatMap((entry) => String(entry).split(","))
      .map((entry) => entry.trim())
      .filter(Boolean);
    return flattened.length > 0 ? flattened : undefined;
  }
  if (typeof value !== "string") return undefined;
  const ids = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function parseStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const flattened = value
      .flatMap((entry) => String(entry).split(","))
      .map((entry) => entry.trim())
      .filter(Boolean);
    return flattened.length > 0 ? flattened : undefined;
  }
  if (typeof value !== "string") return undefined;
  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

router.get("/sales-metrics/datasets", async (_req: Request, res: Response) => {
  try {
    const datasets = await listSalesDatasets();
    res.json({ datasets });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sales metrics datasets]", err);
    res.status(503).json({ error: "Failed to load stored sales datasets.", details: message, datasets: [] });
  }
});

router.post(
  "/sales-metrics/datasets/upload",
  (req, res, next) => {
    uploadMemory.array("files", 20)(req, res, handleUploadMulterError(req, res, next));
  },
  async (req: Request, res: Response) => {
    try {
      const files = ((req as Request & { files?: Express.Multer.File[] }).files ?? []).filter((file) => file.buffer);
      if (files.length === 0) {
        res.status(400).json({ error: "Missing files. Send multipart/form-data with one or more 'files' fields." });
        return;
      }

      const imported = [];
      const failed = [];
      for (const file of files) {
        try {
          const dataset = await importSalesDatasetFromBuffer({
            buffer: file.buffer,
            originalFileName: file.originalname?.trim() || "sales-dataset.xlsx",
            sourceKind: "uploaded",
          });
          imported.push(dataset);
        } catch (err) {
          failed.push({
            fileName: file.originalname?.trim() || "sales-dataset.xlsx",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      res.status(imported.length > 0 ? 201 : 400).json({
        imported,
        failed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[sales metrics upload]", err);
      res.status(503).json({ error: "Failed to import sales datasets.", details: message });
    }
  }
);

router.delete("/sales-metrics/datasets/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await deleteSalesDataset(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Sales dataset not found.", datasetId: req.params.id });
      return;
    }
    res.json({ ok: true, deleted: req.params.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sales metrics delete]", err);
    res.status(503).json({ error: "Failed to delete sales dataset.", details: message });
  }
});

router.get("/sales-metrics/query", async (req: Request, res: Response) => {
  try {
    const payload = await querySalesMetrics({
      datasetIds: parseDatasetIds(req.query.datasetIds),
      neighborhoods: parseStringList(req.query.neighborhoods ?? req.query.neighborhood),
      buildingClassCategory:
        typeof req.query.buildingClassCategory === "string" ? req.query.buildingClassCategory : null,
      taxClass: typeof req.query.taxClass === "string" ? req.query.taxClass : null,
      minUnits: parseOptionalNumber(req.query.minUnits),
      maxUnits: parseOptionalNumber(req.query.maxUnits),
      minGrossSquareFeet: parseOptionalNumber(req.query.minGrossSquareFeet),
      maxGrossSquareFeet: parseOptionalNumber(req.query.maxGrossSquareFeet),
      minPrice: parseOptionalNumber(req.query.minPrice),
      maxPrice: parseOptionalNumber(req.query.maxPrice),
    });
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sales metrics query]", err);
    res.status(503).json({ error: "Failed to query sales metrics.", details: message });
  }
});

export default router;
