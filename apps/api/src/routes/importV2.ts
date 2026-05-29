/**
 * UI v2 import API.
 *
 * This router is intentionally not mounted here; the integration pass owns
 * server.ts. It wraps existing import capabilities behind v2-shaped endpoints
 * without changing legacy routes.
 */

import { Router, type Request, type Response } from "express";
import type {
  UiV2CreateImportJobRequest,
  UiV2ManualEntryImportRequest,
  UiV2OmUrlImportRequest,
  UiV2SavedSearchRunRequest,
  UiV2StreetEasyPullRequest,
  UiV2StreetEasySaleIdImportRequest,
  UiV2StreetEasyUrlImportRequest,
} from "@re-sourcing/contracts";
import {
  failedImportResponse,
  importManualEntry,
  importStreetEasySaleId,
  importStreetEasyUrl,
  omUploadPlaceholder,
  omUrlPlaceholder,
  runStreetEasyPull,
  startSavedSearchImport,
  type ImportJobRouteResult,
} from "../importV2/importJobs.js";

const router = Router();

function sendImportResult(res: Response, result: ImportJobRouteResult): void {
  res.status(result.statusCode).json(result.body);
}

function sendImportError(
  res: Response,
  jobType:
    | "om_upload"
    | "om_url"
    | "manual_entry"
    | "streeteasy_url"
    | "streeteasy_sale_id"
    | "streeteasy_pull"
    | "saved_search_run",
  err: unknown
): void {
  const message = err instanceof Error ? err.message : String(err);
  const statusCode =
    /not found/i.test(message) ? 404 :
    /already running/i.test(message) ? 409 :
    /required|valid|numeric|StreetEasy|source is enabled/i.test(message) ? 400 :
    503;
  sendImportResult(
    res,
    failedImportResponse({
      jobType,
      statusCode,
      label: "Import failed",
      errorMessage: message,
    })
  );
}

router.get("/ui-v2/import/capabilities", (_req: Request, res: Response) => {
  res.json({
    modes: {
      manualEntry: { enabled: true, endpoint: "/api/ui-v2/import/manual-entry" },
      streetEasyUrl: { enabled: true, endpoint: "/api/ui-v2/import/streeteasy-url" },
      streetEasySaleId: { enabled: true, endpoint: "/api/ui-v2/import/streeteasy-sale-id" },
      streetEasyPull: { enabled: true, endpoint: "/api/ui-v2/import/streeteasy-pull" },
      savedSearchRun: { enabled: true, endpoint: "/api/ui-v2/import/saved-search-run" },
      omUpload: {
        enabled: false,
        status: "legacy_endpoint",
        legacyEndpoint: "/api/deal-analysis/analyze-upload",
        message:
          "Use the existing deal-analysis PDF upload endpoint until OM upload extraction is shared with UI v2.",
      },
      omUrl: {
        enabled: false,
        status: "not_implemented",
        endpoint: "/api/ui-v2/import/om-url",
        message:
          "OM URL import is intentionally placeholder-only for now; PDF upload is the real path.",
      },
    },
  });
});

router.post(
  "/ui-v2/import/manual-entry",
  async (req: Request<Record<string, never>, unknown, UiV2ManualEntryImportRequest["body"]>, res: Response) => {
    try {
      sendImportResult(res, await importManualEntry(req.body ?? {} as UiV2ManualEntryImportRequest["body"]));
    } catch (err) {
      console.error("[ui-v2 import manual-entry]", err);
      sendImportError(res, "manual_entry", err);
    }
  }
);

router.post(
  "/ui-v2/import/streeteasy-url",
  async (req: Request<Record<string, never>, unknown, UiV2StreetEasyUrlImportRequest["body"]>, res: Response) => {
    try {
      sendImportResult(res, await importStreetEasyUrl(req.body ?? {} as UiV2StreetEasyUrlImportRequest["body"]));
    } catch (err) {
      console.error("[ui-v2 import streeteasy-url]", err);
      sendImportError(res, "streeteasy_url", err);
    }
  }
);

router.post(
  "/ui-v2/import/streeteasy-sale-id",
  async (req: Request<Record<string, never>, unknown, UiV2StreetEasySaleIdImportRequest["body"]>, res: Response) => {
    try {
      sendImportResult(res, await importStreetEasySaleId(req.body ?? {} as UiV2StreetEasySaleIdImportRequest["body"]));
    } catch (err) {
      console.error("[ui-v2 import streeteasy-sale-id]", err);
      sendImportError(res, "streeteasy_sale_id", err);
    }
  }
);

router.post(
  "/ui-v2/import/streeteasy-pull",
  async (req: Request<Record<string, never>, unknown, UiV2StreetEasyPullRequest["body"]>, res: Response) => {
    try {
      sendImportResult(res, await runStreetEasyPull(req.body ?? {} as UiV2StreetEasyPullRequest["body"]));
    } catch (err) {
      console.error("[ui-v2 import streeteasy-pull]", err);
      sendImportError(res, "streeteasy_pull", err);
    }
  }
);

router.post(
  "/ui-v2/import/saved-search-run",
  async (req: Request<Record<string, never>, unknown, UiV2SavedSearchRunRequest["body"]>, res: Response) => {
    try {
      sendImportResult(res, await startSavedSearchImport(req.body ?? {} as UiV2SavedSearchRunRequest["body"]));
    } catch (err) {
      console.error("[ui-v2 import saved-search-run]", err);
      sendImportError(res, "saved_search_run", err);
    }
  }
);

router.post(
  "/ui-v2/import/om-url",
  (req: Request<Record<string, never>, unknown, UiV2OmUrlImportRequest["body"]>, res: Response) => {
    sendImportResult(res, omUrlPlaceholder(req.body));
  }
);

router.post("/ui-v2/import/om-upload", (req: Request, res: Response) => {
  const body = req.body && typeof req.body === "object" ? req.body as { propertyId?: string | null } : {};
  sendImportResult(res, omUploadPlaceholder(body));
});

router.post(
  "/ui-v2/import/jobs",
  async (req: Request<Record<string, never>, unknown, UiV2CreateImportJobRequest["body"]>, res: Response) => {
    const payload = req.body;
    try {
      switch (payload?.jobType) {
        case "manual_entry":
          sendImportResult(res, await importManualEntry(payload.input));
          return;
        case "streeteasy_url":
          sendImportResult(res, await importStreetEasyUrl(payload.input));
          return;
        case "streeteasy_sale_id":
          sendImportResult(res, await importStreetEasySaleId(payload.input));
          return;
        case "streeteasy_pull":
          sendImportResult(res, await runStreetEasyPull(payload.input));
          return;
        case "saved_search_run":
          sendImportResult(res, await startSavedSearchImport(payload.input));
          return;
        case "om_url":
          sendImportResult(res, omUrlPlaceholder(payload.input));
          return;
        case "om_upload":
          sendImportResult(res, omUploadPlaceholder(payload.input));
          return;
        default:
          sendImportError(res, "manual_entry", new Error("Unknown import jobType."));
      }
    } catch (err) {
      console.error("[ui-v2 import jobs]", err);
      sendImportError(res, payload?.jobType ?? "manual_entry", err);
    }
  }
);

export default router;
