import { randomUUID } from "crypto";
import type { Browser, BrowserContext, Page } from "playwright";
import { extractLoopNetDetailsFromHtml, isLoopNetUrl } from "./loopNetAdapter.js";

interface LoopNetOperatorSession {
  id: string;
  requestedUrl: string;
  openedAt: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export interface LoopNetOperatorSessionSummary {
  id: string;
  requestedUrl: string;
  openedAt: string;
}

export interface LoopNetOperatorCaptureResult {
  sessionId: string;
  requestedUrl: string;
  capturedUrl: string;
  capturedAt: string;
  htmlLength: number;
  raw: Record<string, unknown>;
}

const sessions = new Map<string, LoopNetOperatorSession>();

export async function startLoopNetOperatorCapture(url: string): Promise<LoopNetOperatorSessionSummary> {
  if (!isLoopNetUrl(url)) throw new Error("LoopNet URL required.");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  const id = randomUUID();
  const openedAt = new Date().toISOString();
  sessions.set(id, { id, requestedUrl: url, openedAt, browser, context, page });
  return { id, requestedUrl: url, openedAt };
}

export async function captureLoopNetOperatorSession(sessionId: string): Promise<LoopNetOperatorCaptureResult> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("LoopNet operator browser session not found or already closed.");
  const capturedAt = new Date().toISOString();
  const capturedUrl = session.page.url() || session.requestedUrl;
  const html = await session.page.content();
  const raw = {
    ...extractLoopNetDetailsFromHtml(html, capturedUrl),
    _fetchUrl: session.requestedUrl,
    url: capturedUrl,
    ingestionMode: "manual_browser_operator_capture",
    extractionStatus: "captured",
    extractionDiagnostics: {
      captureMode: "playwright_operator",
      requestedUrl: session.requestedUrl,
      capturedUrl,
      capturedAt,
      note: "Captured from a headed browser session controlled by the user; no credentials, CAPTCHA, stealth, proxy, or paywall automation was attempted.",
    },
  };
  return {
    sessionId,
    requestedUrl: session.requestedUrl,
    capturedUrl,
    capturedAt,
    htmlLength: html.length,
    raw,
  };
}

export async function closeLoopNetOperatorSession(sessionId: string): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) return false;
  sessions.delete(sessionId);
  await session.context.close().catch(() => {});
  await session.browser.close().catch(() => {});
  return true;
}

