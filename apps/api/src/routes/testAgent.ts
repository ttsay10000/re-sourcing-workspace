/**
 * Source test-agent route: StreetEasy keeps the existing two-step NYC Real Estate API flow.
 * POST starts a run (returns runId immediately); backend discovers listing URLs then builds source details per URL.
 * Runs are stored in memory with step progress, timer, and properties (raw data lake).
 * Data is NOT auto-populated to property data; user must click "Send to property data" per run.
 */

import { randomBytes } from "crypto";
import { Router, type Request, type Response } from "express";
import { fetchSaleDetailsByUrl } from "../nycRealEstateApi.js";
import { enrichBrokers, hasMeaningfulBrokerEnrichment } from "../enrichment/brokerEnrichment.js";
import { computeDuplicateScores } from "../dedup/addressDedup.js";
import {
  getSourceAdapter,
  resolveSourceAdapterId,
  type SourceAdapterId,
  type SourceAdapterRunBody,
  extractLoopNetDetailsFromHtml,
  isLoopNetUrl,
} from "../sourcing/adapters/index.js";
import {
  captureLoopNetOperatorSession,
  closeLoopNetOperatorSession,
  startLoopNetOperatorCapture,
} from "../sourcing/adapters/loopNetOperatorCapture.js";
import {
  createWorkflowRun,
  mergeWorkflowRunMetadata,
  updateWorkflowRun,
  upsertWorkflowStep,
} from "../workflow/workflowTracker.js";

const router = Router();
export const loopNetBrowserCaptureRouter = Router();

const LOOPNET_BROWSER_CAPTURE_TOKEN =
  process.env.LOOPNET_BROWSER_CAPTURE_TOKEN?.trim() || randomBytes(24).toString("base64url");
const LOOPNET_BROWSER_CAPTURE_MAX_HTML_BYTES = Number(process.env.LOOPNET_BROWSER_CAPTURE_MAX_HTML_BYTES || 12_000_000);
const LOOPNET_CAPTURE_MODES = new Set(["browser_extension", "bookmarklet", "pasted_html"]);

type StepStatus = "pending" | "running" | "completed" | "failed";

/** In-memory store for test runs. */
interface StoredTestRun {
  id: string;
  startedAt: string;
  source: SourceAdapterId;
  sourceLabel: string;
  criteria: RunRequestBody;
  step1Status: StepStatus;
  step1Label: string;
  step1Count: number;
  step1Error: string | null;
  step2Status: StepStatus;
  step2Label: string;
  step2Count: number;
  step2Total: number;
  step2Error: string | null;
  sourceMetadata: Record<string, unknown> | null;
  warnings: string[];
  /** Full sale details per URL (raw data lake). */
  properties: Record<string, unknown>[];
  errors: { url?: string; message: string }[];
}

const testRunsStore: StoredTestRun[] = [];

/** Request body: filters sent from frontend plus optional manual source URL fields. */
export type RunRequestBody = SourceAdapterRunBody;

function sourceStepLabels(source: SourceAdapterId): { step1Label: string; step2Label: string } {
  if (source === "loopnet") {
    return {
      step1Label: "Prepare LoopNet manual search",
      step2Label: "Ingest LoopNet listing URLs",
    };
  }
  return {
    step1Label: "GET Active Sales",
    step2Label: "GET Sale Details",
  };
}

function createCapturedLoopNetRun(params: {
  url: string;
  raw: Record<string, unknown>;
  captureMetadata: Record<string, unknown>;
}): StoredTestRun {
  const adapter = getSourceAdapter("loopnet");
  const labels = sourceStepLabels("loopnet");
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const run: StoredTestRun = {
    id: runId,
    startedAt,
    source: "loopnet",
    sourceLabel: adapter.displayName,
    criteria: { source: "loopnet", manualUrls: [params.url], manualUrl: params.url },
    step1Status: "completed",
    step1Label: labels.step1Label,
    step1Count: 1,
    step1Error: null,
    step2Status: "completed",
    step2Label: labels.step2Label,
    step2Count: 1,
    step2Total: 1,
    step2Error: null,
    sourceMetadata: {
      captureMode: "manual",
      ...params.captureMetadata,
    },
    warnings: [],
    properties: [{ ...params.raw, _fetchUrl: params.url, _sourceAdapter: "loopnet" }],
    errors: [],
  };
  testRunsStore.unshift(run);
  return run;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function trimString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function sanitizeLinkMetadata(value: unknown): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item) => {
    if (!isPlainRecord(item)) return [];
    const href = trimString(item.href ?? item.url, 1_500);
    if (!href) return [];
    return [{
      href,
      text: trimString(item.text ?? item.label, 250) ?? "",
    }];
  });
}

function sanitizeStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => trimString(item, maxLength))
    .filter((item): item is string => Boolean(item));
}

function sanitizeCaptureMetadata(value: unknown): Record<string, unknown> {
  const input = isPlainRecord(value) ? value : {};
  const meta = isPlainRecord(input.meta) ? Object.fromEntries(
    Object.entries(input.meta)
      .slice(0, 80)
      .map(([key, val]) => [key.slice(0, 120), trimString(val, 1_000)])
      .filter(([, val]) => val != null)
  ) : {};
  return {
    documentTitle: trimString(input.documentTitle ?? input.title, 500),
    visibleTextPreview: trimString(input.visibleText, 5_000),
    visibleTextLength: typeof input.visibleText === "string" ? input.visibleText.length : null,
    imageUrls: sanitizeStringArray(input.images, 80, 1_500),
    links: sanitizeLinkMetadata(input.links),
    meta,
    userAgent: trimString(input.userAgent, 500),
  };
}

function normalizeCaptureMode(value: unknown, fallback: "browser_extension" | "bookmarklet" | "pasted_html"): string {
  const mode = typeof value === "string" ? value.trim() : "";
  return LOOPNET_CAPTURE_MODES.has(mode) ? mode : fallback;
}

function buildCapturedLoopNetRunFromPayload(
  payload: unknown,
  fallbackCaptureMode: "browser_extension" | "bookmarklet" | "pasted_html"
): { run: StoredTestRun; raw: Record<string, unknown>; capturedUrl: string; captureMetadata: Record<string, unknown> } {
  const body = isPlainRecord(payload) ? payload : {};
  const url = trimString(body.url, 2_000) ?? "";
  const html = typeof body.html === "string" ? body.html : "";
  if (!url || !isLoopNetUrl(url)) throw new Error("Body 'url' must be a LoopNet listing URL.");
  if (!html.trim()) throw new Error("Body 'html' is required.");
  if (Buffer.byteLength(html, "utf8") > LOOPNET_BROWSER_CAPTURE_MAX_HTML_BYTES) {
    throw new Error("Captured LoopNet HTML is too large.");
  }
  const captureMode = normalizeCaptureMode(body.captureMode, fallbackCaptureMode);
  const capturedAt = new Date().toISOString();
  const metadata = sanitizeCaptureMetadata(body.metadata);
  const raw = {
    ...extractLoopNetDetailsFromHtml(html, url),
    _fetchUrl: url,
    ingestionMode: `${captureMode}_capture`,
    extractionStatus: "captured",
    extractionDiagnostics: {
      captureMode,
      capturedAt,
      htmlLength: html.length,
      metadata,
      note: "Captured from a user-controlled browser page; no credentials, cookies, CAPTCHA, stealth, proxy, or paywall automation was attempted.",
    },
  };
  const captureMetadata = {
    captureMode,
    capturedAt,
    htmlLength: html.length,
    metadata,
  };
  const run = createCapturedLoopNetRun({ url, raw, captureMetadata });
  return { run, raw, capturedUrl: url, captureMetadata };
}

function loopNetCaptureOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return true;
    return parsed.hostname === "loopnet.com" || parsed.hostname.endsWith(".loopnet.com");
  } catch {
    return false;
  }
}

function applyLoopNetBrowserCaptureCors(req: Request, res: Response): boolean {
  const origin = req.headers.origin;
  if (!loopNetCaptureOriginAllowed(origin)) return false;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-LoopNet-Capture-Token");
  res.setHeader("Access-Control-Max-Age", "600");
  return true;
}

function hasValidLoopNetBrowserCaptureToken(req: Request): boolean {
  const token = req.header("x-loopnet-capture-token") || "";
  return token.length > 0 && token === LOOPNET_BROWSER_CAPTURE_TOKEN;
}

export function getLoopNetBrowserCaptureToken(): string {
  return LOOPNET_BROWSER_CAPTURE_TOKEN;
}

loopNetBrowserCaptureRouter.options("/test-agent/loopnet/browser-capture", (req: Request, res: Response) => {
  if (!applyLoopNetBrowserCaptureCors(req, res)) {
    res.status(403).end();
    return;
  }
  res.status(204).end();
});

loopNetBrowserCaptureRouter.post("/test-agent/loopnet/browser-capture", (req: Request, res: Response) => {
  if (!applyLoopNetBrowserCaptureCors(req, res)) {
    res.status(403).json({ error: "LoopNet browser capture origin is not allowed." });
    return;
  }
  if (!hasValidLoopNetBrowserCaptureToken(req)) {
    res.status(401).json({ error: "LoopNet browser capture token required." });
    return;
  }
  try {
    const { run, raw, capturedUrl, captureMetadata } = buildCapturedLoopNetRunFromPayload(req.body, "browser_extension");
    res.status(201).json({
      ok: true,
      runId: run.id,
      capturedUrl,
      propertiesCount: run.properties.length,
      captureMetadata,
      raw,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(/LoopNet listing URL|required|too large/i.test(message) ? 400 : 500).json({ error: message });
  }
});

/** Run the two-step flow in the background and update the stored run. */
async function runTwoStepFlow(run: StoredTestRun): Promise<void> {
  const adapter = getSourceAdapter(run.source);
  const criteria = adapter.buildManualCriteria(run.criteria);

  // Step 1: discover source listing URLs or validate manually supplied URLs.
  run.step1Status = "running";
  try {
    const { urls, metadata, warnings } = await adapter.fetchSearch(criteria, { runKind: "manual" });
    run.sourceMetadata = metadata ?? null;
    if (warnings?.length) run.warnings.push(...warnings);
    run.step1Count = urls.length;
    run.step1Status = "completed";
    run.step1Error = null;

    // Step 2: fetch or construct one raw source payload per URL.
    run.step2Total = urls.length;
    run.step2Status = "running";
    run.step2Error = null;
    for (let i = 0; i < urls.length; i++) {
      try {
        const details = await adapter.fetchDetailsByUrl(urls[i], { runKind: "manual" });
        run.properties.push({ ...details, _fetchUrl: urls[i], _sourceAdapter: adapter.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        run.errors.push({ url: urls[i], message });
      }
      run.step2Count = i + 1;
      // Small delay to avoid rate limits.
      if (i < urls.length - 1) await new Promise((r) => setTimeout(r, 200));
    }
    run.step2Status = "completed";
  } catch (err) {
    run.step1Status = "failed";
    run.step1Error = err instanceof Error ? err.message : String(err);
    run.step2Status = "failed";
    run.step2Error = run.step1Error;
  }
}

/** Single route: POST to start a run. Returns runId; two-step flow runs in background. */
router.post("/test-agent/run", (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as RunRequestBody;
    const source = resolveSourceAdapterId(body.source);
    const adapter = getSourceAdapter(source);
    const labels = sourceStepLabels(source);
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const run: StoredTestRun = {
      id: runId,
      startedAt,
      source,
      sourceLabel: adapter.displayName,
      criteria: { ...body, source },
      step1Status: "pending",
      step1Label: labels.step1Label,
      step1Count: 0,
      step1Error: null,
      step2Status: "pending",
      step2Label: labels.step2Label,
      step2Count: 0,
      step2Total: 0,
      step2Error: null,
      sourceMetadata: null,
      warnings: [],
      properties: [],
      errors: [],
    };
    testRunsStore.unshift(run);
    res.status(202).json({ runId, startedAt });

    runTwoStepFlow(run).catch((err) => {
      if (run.step1Status !== "failed") {
        run.step1Status = "failed";
        run.step1Error = err instanceof Error ? err.message : String(err);
      }
      run.step2Status = "failed";
      run.step2Error = run.step1Error;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.post("/test-agent/loopnet/operator/start", async (req: Request, res: Response) => {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!url || !isLoopNetUrl(url)) {
    res.status(400).json({ error: "Body 'url' must be a LoopNet listing URL." });
    return;
  }
  try {
    const session = await startLoopNetOperatorCapture(url);
    res.status(201).json({
      ok: true,
      session,
      message:
        "A headed browser opened for manual LoopNet capture. Load the listing manually, complete any user-visible checks yourself, then call capture.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[loopnet operator start]", err);
    res.status(503).json({ error: "Failed to start LoopNet operator browser.", details: message });
  }
});

router.post("/test-agent/loopnet/operator/:sessionId/capture", async (req: Request, res: Response) => {
  try {
    const captured = await captureLoopNetOperatorSession(req.params.sessionId);
    const run = createCapturedLoopNetRun({
      url: captured.requestedUrl,
      raw: captured.raw,
      captureMetadata: {
        captureMode: "playwright_operator",
        capturedUrl: captured.capturedUrl,
        capturedAt: captured.capturedAt,
        htmlLength: captured.htmlLength,
        sessionId: captured.sessionId,
      },
    });
    if (req.body?.close !== false) await closeLoopNetOperatorSession(req.params.sessionId);
    res.status(201).json({
      ok: true,
      runId: run.id,
      capturedUrl: captured.capturedUrl,
      propertiesCount: run.properties.length,
      raw: captured.raw,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[loopnet operator capture]", err);
    res.status(503).json({ error: "Failed to capture LoopNet operator browser content.", details: message });
  }
});

router.delete("/test-agent/loopnet/operator/:sessionId", async (req: Request, res: Response) => {
  const closed = await closeLoopNetOperatorSession(req.params.sessionId);
  res.json({ ok: true, closed });
});

router.get("/test-agent/loopnet/browser-capture-config", (_req: Request, res: Response) => {
  res.json({
    endpointPath: "/api/test-agent/loopnet/browser-capture",
    token: getLoopNetBrowserCaptureToken(),
    preferredCaptureModes: ["browser_extension", "bookmarklet"],
    fallbackCaptureModes: ["pasted_html", "playwright_operator"],
  });
});

router.post("/test-agent/loopnet/html-capture", (req: Request, res: Response) => {
  try {
    const { run, raw, capturedUrl, captureMetadata } = buildCapturedLoopNetRunFromPayload(
      { ...(isPlainRecord(req.body) ? req.body : {}), captureMode: "pasted_html" },
      "pasted_html"
    );
    res.status(201).json({
      ok: true,
      runId: run.id,
      capturedUrl,
      propertiesCount: run.properties.length,
      captureMetadata,
      raw,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(/LoopNet listing URL|required|too large/i.test(message) ? 400 : 500).json({ error: message });
  }
});

/** List test runs (newest first) with step progress and timer. */
router.get("/test-agent/runs", (_req: Request, res: Response) => {
  const runs = testRunsStore.map((r) => ({
    id: r.id,
    startedAt: r.startedAt,
    source: r.source,
    sourceLabel: r.sourceLabel,
    criteria: r.criteria,
    step1Status: r.step1Status,
    step1Label: r.step1Label,
    step1Count: r.step1Count,
    step1Error: r.step1Error,
    step2Status: r.step2Status,
    step2Label: r.step2Label,
    step2Count: r.step2Count,
    step2Total: r.step2Total,
    step2Error: r.step2Error,
    sourceMetadata: r.sourceMetadata,
    propertiesCount: r.properties.length,
    errorsCount: r.errors.length,
    warningsCount: r.warnings.length,
  }));
  res.json({ runs });
});

/** Get one test run with full properties (raw data lake). */
router.get("/test-agent/runs/:id", (req: Request, res: Response) => {
  const run = testRunsStore.find((r) => r.id === req.params.id);
  if (!run) {
    res.status(404).json({ error: "Test run not found." });
    return;
  }
  res.json(run);
});

/**
 * GET /api/test-agent/sale-details?url=<StreetEasy URL>
 * Fetches GET sale details for a single URL and returns raw payload + summary of
 * BBL/BIN/lat/lon (used by permit enrichment). Use to debug why enrichment may not have data.
 */
router.get("/test-agent/sale-details", async (req: Request, res: Response) => {
  const url = typeof req.query.url === "string" ? req.query.url.trim() : null;
  if (!url) {
    res.status(400).json({ error: "Query param 'url' required (e.g. ?url=https://streeteasy.com/sale/1795579)" });
    return;
  }
  try {
    const raw = await fetchSaleDetailsByUrl(url);
    const bbl =
      (typeof (raw as Record<string, unknown>).bbl === "string" && (raw as Record<string, unknown>).bbl) ||
      (typeof (raw as Record<string, unknown>).BBL === "string" && (raw as Record<string, unknown>).BBL) ||
      (typeof (raw as Record<string, unknown>).borough_block_lot === "string" && (raw as Record<string, unknown>).borough_block_lot) ||
      null;
    const bin =
      (typeof (raw as Record<string, unknown>).bin === "string" && (raw as Record<string, unknown>).bin) ||
      (typeof (raw as Record<string, unknown>).BIN === "string" && (raw as Record<string, unknown>).BIN) ||
      (typeof (raw as Record<string, unknown>).building_identification_number === "string" && (raw as Record<string, unknown>).building_identification_number) ||
      null;
    const r = raw as Record<string, unknown>;
    let lat: number | null = null;
    let lon: number | null = null;
    const coords = r.coordinates as Record<string, unknown> | undefined;
    const loc = r.location as Record<string, unknown> | undefined;
    const geo = r.geo as Record<string, unknown> | undefined;
    const latRaw = r.latitude ?? r.lat ?? coords?.latitude ?? coords?.lat ?? loc?.lat ?? geo?.lat;
    const lonRaw = r.longitude ?? r.lon ?? coords?.longitude ?? coords?.lon ?? loc?.lon ?? geo?.lon;
    if (typeof latRaw === "number" && !Number.isNaN(latRaw)) lat = latRaw;
    else if (typeof latRaw === "string") lat = parseFloat(latRaw);
    if (typeof lonRaw === "number" && !Number.isNaN(lonRaw)) lon = lonRaw;
    else if (typeof lonRaw === "string") lon = parseFloat(lonRaw);
    const priceHistoryKeys = [
      "priceHistory", "price_history", "history", "saleHistory", "sale_history",
      "property_history", "listing_history", "price_changes", "events",
      "rentalPriceHistory", "rental_price_history", "rentHistory", "rental_history",
    ];
    const priceHistoryInRaw: Record<string, unknown> = {};
    for (const k of priceHistoryKeys) {
      const v = r[k];
      if (v !== undefined && v !== null) {
        priceHistoryInRaw[k] = Array.isArray(v) ? { length: (v as unknown[]).length, sample: (v as unknown[])[0] } : v;
      }
    }

    const summary = {
      bbl: bbl ?? null,
      bin: bin ?? null,
      lat,
      lon,
      address: r.address ?? r.street_address ?? r.formatted_address ?? null,
      borough: r.borough ?? null,
      city: r.city ?? null,
      zip: r.zip ?? r.zipcode ?? null,
      topLevelKeys: Object.keys(raw).sort(),
      priceHistoryInRaw: Object.keys(priceHistoryInRaw).length ? priceHistoryInRaw : null,
    };
    res.json({ url, summary, raw });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[test-agent/sale-details]", err);
    res.status(502).json({ error: "Failed to fetch sale details.", details: message });
  }
});

const ENRICHMENT_RATE_LIMIT_MS = Number(process.env.ENRICHMENT_RATE_LIMIT_DELAY_MS || process.env.PERMITS_RATE_LIMIT_DELAY_MS) || 300;

/**
 * POST /api/test-agent/test-single-property
 * Body: { url: "https://streeteasy.com/sale/1795579" }
 * Full flow: fetch sale details → create raw listing → create canonical property + match → run permit + 7 enrichment modules.
 * Returns whether BBL/BIN was captured and the property details. Requires DB and RAPIDAPI_KEY.
 */
router.post("/test-agent/test-single-property", async (req: Request, res: Response) => {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : null;
  if (!url) {
    res.status(400).json({ error: "Body 'url' required (e.g. { \"url\": \"https://streeteasy.com/sale/1795579\" })" });
    return;
  }
  try {
    const raw = await fetchSaleDetailsByUrl(url);
    const rawWithUrl = { ...raw, _fetchUrl: url } as Record<string, unknown>;
    const normalized = getSourceAdapter("streeteasy").normalize(rawWithUrl, 0);

    const db = await import("@re-sourcing/db");
    const pool = db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const listingRepo = new db.ListingRepo({ pool, client });
      const propertyRepo = new db.PropertyRepo({ pool, client });
      const matchRepo = new db.MatchRepo({ pool, client });

      const existing = await listingRepo.bySourceAndExternalId(normalized.source, normalized.externalId);
      if (!existing) {
        const propertyContext = [normalized.address, normalized.city, normalized.zip].filter(Boolean).join(", ") || undefined;
        const agentEnrichment = await enrichBrokers(normalized.agentNames, propertyContext);
        if (hasMeaningfulBrokerEnrichment(agentEnrichment)) normalized.agentEnrichment = agentEnrichment;
      } else {
        normalized.agentEnrichment = existing.agentEnrichment ?? null;
        normalized.priceHistory = normalized.priceHistory ?? existing.priceHistory ?? null;
        normalized.rentalPriceHistory = normalized.rentalPriceHistory ?? existing.rentalPriceHistory ?? null;
      }

      const { listing } = await listingRepo.upsert(normalized, { uploadedRunId: null });

      const canonicalAddress = [listing.address, listing.city, listing.state, listing.zip]
        .filter(Boolean)
        .join(", ") || listing.address || "Unknown";
      const property = await propertyRepo.create(canonicalAddress);
      await matchRepo.create({
        listingId: listing.id,
        propertyId: property.id,
        confidence: 1,
        reasons: { addressMatch: true, normalizedAddressDistance: 0 },
      });

      const merge: Record<string, unknown> = {};
      if (listing.lat != null && typeof listing.lat === "number" && !Number.isNaN(listing.lat) &&
          listing.lon != null && typeof listing.lon === "number" && !Number.isNaN(listing.lon)) {
        merge.lat = listing.lat;
        merge.lon = listing.lon;
      }
      const extra = listing.extra as Record<string, unknown> | null | undefined;
      if (extra && typeof extra === "object") {
        const bbl = extra.bbl ?? extra.BBL ?? extra.borough_block_lot;
        const bin = extra.bin ?? extra.BIN ?? extra.building_identification_number;
        const bblStr = typeof bbl === "string" && /^\d{10}$/.test(bbl.trim()) ? bbl.trim() : null;
        if (bblStr) {
          merge.bbl = bblStr;
          if (typeof bin === "string" && bin.trim()) merge.bin = bin.trim();
        }
        const hoa = extra.monthlyHoa ?? extra.monthly_hoa ?? extra.hoa;
        const tax = extra.monthlyTax ?? extra.monthly_tax ?? extra.tax;
        if (typeof hoa === "number" && !Number.isNaN(hoa) && hoa >= 0) merge.monthlyHoa = hoa;
        else if (typeof hoa === "string" && hoa.trim()) {
          const n = parseFloat(hoa.replace(/[$,]/g, ""));
          if (!Number.isNaN(n) && n >= 0) merge.monthlyHoa = n;
        }
        if (typeof tax === "number" && !Number.isNaN(tax) && tax >= 0) merge.monthlyTax = tax;
        else if (typeof tax === "string" && tax.trim()) {
          const n = parseFloat(tax.replace(/[$,]/g, ""));
          if (!Number.isNaN(n) && n >= 0) merge.monthlyTax = n;
        }
      }
      if (Object.keys(merge).length > 0) await propertyRepo.mergeDetails(property.id, merge);

      await client.query("COMMIT");
      client.release();

      const { runEnrichmentForProperty } = await import("../enrichment/runEnrichment.js");
      const appToken = process.env.SOCRATA_APP_TOKEN ?? null;
      const out = await runEnrichmentForProperty(property.id, undefined, {
        appToken,
        rateLimitDelayMs: ENRICHMENT_RATE_LIMIT_MS,
      });

      const repoWithPool = new db.PropertyRepo({ pool });
      const propertyAfter = await repoWithPool.byId(property.id);
      const details = (propertyAfter?.details as Record<string, unknown>) ?? {};
      const bblCaptured = typeof details.bbl === "string" && /^\d{10}$/.test(details.bbl.trim());
      const binCaptured = typeof details.bin === "string" && String(details.bin).trim().length > 0;

      res.json({
        ok: true,
        url,
        listingId: listing.id,
        propertyId: property.id,
        canonicalAddress: propertyAfter?.canonicalAddress ?? canonicalAddress,
        bblCaptured,
        binCaptured,
        bbl: bblCaptured ? details.bbl : null,
        bin: binCaptured ? details.bin : null,
        detailsKeys: Object.keys(details),
        enrichment: { ok: out.ok, results: out.results },
      });
    } finally {
      client.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[test-agent/test-single-property]", err);
    if (/DATABASE_URL|connection|ECONNREFUSED|getPool/i.test(message)) {
      res.status(503).json({ error: "Database unavailable.", details: message });
    } else {
      res.status(502).json({ error: "Failed to run test flow.", details: message });
    }
  }
});

/**
 * Send this run's properties to property data (listings + snapshots). No auto-populate; user-triggered only.
 * Flow: for new listings run broker LLM enrichment only; source details carry price history when available.
 * Upsert listing with enrichment, then create a snapshot with full metadata.
 * Lat/lon from source details are included in each run property and are persisted to raw listings when available.
 */
router.post("/test-agent/runs/:id/send-to-property-data", async (req: Request, res: Response) => {
  const run = testRunsStore.find((r) => r.id === req.params.id);
  if (!run) {
    res.status(404).json({ error: "Test run not found." });
    return;
  }
  if (run.properties.length === 0) {
    res.status(400).json({ error: "Run has no properties to send." });
    return;
  }
  const adapter = getSourceAdapter(run.source);
  const workflowStartedAt = new Date().toISOString();
  const workflowRunId = await createWorkflowRun({
    runType: "send_to_property_data",
    displayName: `Send ${run.sourceLabel} to property data`,
    scopeLabel: `${run.properties.length} listing${run.properties.length === 1 ? "" : "s"}`,
    triggerSource: "manual",
    totalItems: run.properties.length,
    metadata: {
      testRunId: run.id,
      source: run.source,
      sourceLabel: run.sourceLabel,
      criteria: run.criteria,
      sourceMetadata: run.sourceMetadata,
      warnings: run.warnings,
    },
    steps: [
      {
        stepKey: "raw_ingest",
        totalItems: run.properties.length,
        status: "running",
        startedAt: workflowStartedAt,
        lastMessage: `Starting raw ingest for ${run.properties.length} listing${run.properties.length === 1 ? "" : "s"}`,
      },
    ],
  });
  try {
    const db = await import("@re-sourcing/db");
    const pool = db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const listingRepo = new db.ListingRepo({ pool, client });
      const snapshotRepo = new db.SnapshotRepo({ pool, client });

      const results: { listingId: string; externalId: string; created: boolean }[] = [];
      let listingsCreated = 0;
      let listingsUpdated = 0;
      let listingsProcessed = 0;
      for (let i = 0; i < run.properties.length; i++) {
        const normalized = adapter.normalize(run.properties[i] as Record<string, unknown>, i);
        const existing = await listingRepo.bySourceAndExternalId(normalized.source, normalized.externalId);

        if (existing) {
          normalized.priceHistory = normalized.priceHistory ?? existing.priceHistory ?? null;
          normalized.rentalPriceHistory = normalized.rentalPriceHistory ?? existing.rentalPriceHistory ?? null;
        }

        // Refresh broker enrichment on each pull so new broker emails or corrected agent data are captured.
        const agentNames = normalized.agentNames ?? [];
        const hasAgentNames = Array.isArray(agentNames) && agentNames.length > 0;
        const existingHasEnrichment = existing?.agentEnrichment != null && Array.isArray(existing.agentEnrichment) && existing.agentEnrichment.length > 0;
        const shouldRunBrokerLlm = hasAgentNames;
        if (shouldRunBrokerLlm) {
          const propertyContext = [normalized.address, normalized.city, normalized.zip].filter(Boolean).join(", ") || undefined;
          try {
            const agentEnrichment = await enrichBrokers(normalized.agentNames, propertyContext);
            if (hasMeaningfulBrokerEnrichment(agentEnrichment)) {
              normalized.agentEnrichment = agentEnrichment;
              console.log(`[send-to-property-data] Broker LLM enriched ${agentEnrichment?.length ?? 0} agent(s) for ${normalized.externalId}`);
            } else if (existingHasEnrichment) {
              normalized.agentEnrichment = existing?.agentEnrichment ?? null;
            } else {
              normalized.agentEnrichment = null;
              console.warn(`[send-to-property-data] Broker LLM returned no enrichment for ${normalized.externalId} (agentNames: ${agentNames.length}). Check OPENAI_API_KEY and OPENAI_MODEL.`);
            }
          } catch (err) {
            normalized.agentEnrichment = existingHasEnrichment ? (existing?.agentEnrichment ?? null) : null;
            console.warn(
              `[send-to-property-data] Broker enrichment failed for ${normalized.externalId}:`,
              err instanceof Error ? err.message : err
            );
          }
        } else if (existing) {
          normalized.agentEnrichment = existing.agentEnrichment ?? null;
        } else {
          normalized.agentEnrichment = null;
        }

        // Dedupe by listing ID (source + external_id): upsert updates existing or inserts new
        const { listing, created } = await listingRepo.upsert(normalized, {
          uploadedRunId: run.id,
        });
        if (created) listingsCreated++;
        else listingsUpdated++;
        const rawPayload = run.properties[i] as Record<string, unknown>;
        let metadata: Record<string, unknown>;
        try {
          metadata = {
            testRunId: run.id,
            source: run.source,
            sourceLabel: run.sourceLabel,
            capturedAt: new Date().toISOString(),
            rawPayload,
            sourceMetadata: run.sourceMetadata,
            warnings: run.warnings,
            // Store LLM outputs in snapshot so they're persisted and we have a full record.
            agentEnrichment: normalized.agentEnrichment ?? null,
            priceHistory: normalized.priceHistory ?? null,
            rentalPriceHistory: normalized.rentalPriceHistory ?? null,
            normalizedListing: normalized as unknown as Record<string, unknown>,
          };
          JSON.stringify(metadata);
        } catch (_ser) {
          throw new Error("Snapshot payload could not be serialized (e.g. circular reference).");
        }
        await snapshotRepo.create({
          listingId: listing.id,
          runId: null,
          rawPayloadPath: "inline",
          metadata,
        });
        results.push({ listingId: listing.id, externalId: normalized.externalId, created });
        listingsProcessed++;
        await upsertWorkflowStep(workflowRunId, {
          stepKey: "raw_ingest",
          totalItems: run.properties.length,
          completedItems: listingsProcessed,
          failedItems: 0,
          status: listingsProcessed >= run.properties.length ? "completed" : "running",
          startedAt: workflowStartedAt,
          finishedAt: listingsProcessed >= run.properties.length ? new Date().toISOString() : null,
          lastMessage: `${listingsProcessed}/${run.properties.length} listings ingested`,
        });
      }
      // Dedup: always scan all active listings so duplicate_score is correct for every row (new and existing)
      const { listings: allActive } = await listingRepo.list({ lifecycleState: "active", limit: 1000 });
      const dedupUpdates = computeDuplicateScores(
        allActive.map((l) => ({ id: l.id, address: l.address, city: l.city, state: l.state, zip: l.zip }))
      );
      await listingRepo.updateDuplicateScores(dedupUpdates);

      let runNumber: number | null = null;
      try {
        await client.query(
          `INSERT INTO property_data_run_log (run_id, criteria, listings_created, listings_updated)
           VALUES ($1, $2, $3, $4)`,
          [run.id, JSON.stringify(run.criteria), listingsCreated, listingsUpdated]
        );
        const logRow = await client.query(
          "SELECT run_number FROM property_data_run_log WHERE run_id = $1 ORDER BY sent_at DESC LIMIT 1",
          [run.id]
        );
        runNumber = logRow.rows[0]?.run_number ?? null;
      } catch (logErr) {
        if (!/relation "property_data_run_log" does not exist/i.test(String(logErr))) throw logErr;
      }
      await client.query("COMMIT");
      await mergeWorkflowRunMetadata(workflowRunId, {
        runNumber,
        listingsCreated,
        listingsUpdated,
        listingsProcessed,
      });
      await updateWorkflowRun(workflowRunId, {
        status: "completed",
        finishedAt: new Date().toISOString(),
      });
      res.json({
        ok: true,
        sent: results.length,
        created: listingsCreated,
        updated: listingsUpdated,
        runNumber,
        results,
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[send-to-property-data]", err);
    await upsertWorkflowStep(workflowRunId, {
      stepKey: "raw_ingest",
      totalItems: run.properties.length,
      completedItems: 0,
      failedItems: run.properties.length,
      status: "failed",
      startedAt: workflowStartedAt,
      finishedAt: new Date().toISOString(),
      lastError: message,
      lastMessage: "Raw ingest failed",
    });
    await mergeWorkflowRunMetadata(workflowRunId, { error: message });
    await updateWorkflowRun(workflowRunId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    let errorMessage: string;
    if (/DATABASE_URL is required|connection|ECONNREFUSED|getPool|config/i.test(message)) {
      errorMessage =
        "Database unavailable. Set DATABASE_URL in the API environment and ensure Postgres is running.";
    } else if (/column.*does not exist|relation.*does not exist|more expressions than target columns/i.test(message)) {
      errorMessage =
        "Database schema is out of date. Run migrations: npm run db:migrate (with DATABASE_URL set).";
    } else {
      errorMessage = "Database unavailable or failed to persist.";
    }
    res.status(503).json({ error: errorMessage, details: message });
  }
});

/** List property data run log (all "Send to property data" runs) for data integrity comparison. */
router.get("/test-agent/property-data/runs", async (_req: Request, res: Response) => {
  try {
    const db = await import("@re-sourcing/db");
    const pool = db.getPool();
    const r = await pool.query(
      `SELECT run_number, run_id, sent_at, criteria, listings_created, listings_updated
       FROM property_data_run_log
       ORDER BY sent_at DESC
       LIMIT 200`
    );
    const runs = r.rows.map((row: Record<string, unknown>) => ({
      runNumber: row.run_number,
      runId: row.run_id,
      sentAt: row.sent_at != null ? new Date(row.sent_at as Date).toISOString() : null,
      criteria: row.criteria,
      listingsCreated: Number(row.listings_created ?? 0),
      listingsUpdated: Number(row.listings_updated ?? 0),
    }));
    res.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/relation "property_data_run_log" does not exist/i.test(message)) {
      res.json({ runs: [] });
      return;
    }
    console.error("[property-data runs list]", err);
    res.status(503).json({ error: "Failed to load run log.", details: message });
  }
});

/** Clear all raw listings (and their snapshots via CASCADE). For testing. Requires ?confirm=1 or body { confirm: true }. */
router.delete("/test-agent/property-data", async (req: Request, res: Response) => {
  const confirm = req.query.confirm === "1" || req.query.confirm === "true" || (req.body && req.body.confirm === true);
  if (!confirm) {
    res.status(400).json({
      error: "Confirmation required. Use ?confirm=1 or body { confirm: true } to clear all raw listings and snapshots.",
    });
    return;
  }
  try {
    const db = await import("@re-sourcing/db");
    const pool = db.getPool();
    const r = await pool.query("DELETE FROM listings RETURNING id");
    const deleted = r.rowCount ?? 0;
    res.json({ ok: true, deleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[clear-property-data]", err);
    if (/DATABASE_URL is required|connection|ECONNREFUSED|getPool|config/i.test(message)) {
      res.status(503).json({
        error: "Database unavailable. Set DATABASE_URL and ensure Postgres is running.",
        details: message,
      });
    } else {
      res.status(503).json({ error: "Failed to clear property data.", details: message });
    }
  }
});

export default router;
