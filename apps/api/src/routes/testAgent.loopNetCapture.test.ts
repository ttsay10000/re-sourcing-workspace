import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import testAgentRouter, {
  getLoopNetBrowserCaptureToken,
  loopNetBrowserCaptureRouter,
} from "./testAgent.js";

const LOOPNET_URL = "https://www.loopnet.com/Listing/332-E-6th-St-New-York-NY/40648022/";
const LOOPNET_HTML = `
  <html>
    <head>
      <title>332 E 6th St | LoopNet</title>
      <meta property="og:title" content="332 E 6th St | LoopNet" />
      <meta property="og:description" content="East Village multifamily investment." />
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "332 E 6th St",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "332 E 6th St",
            "addressLocality": "New York",
            "addressRegion": "NY",
            "postalCode": "10003"
          },
          "offers": { "@type": "Offer", "price": "3200000" },
          "geo": { "@type": "GeoCoordinates", "latitude": "40.725", "longitude": "-73.987" }
        }
      </script>
    </head>
    <body>
      <dl>
        <dt>Number of Units</dt><dd>10</dd>
        <dt>Building Size</dt><dd>8,750 SF</dd>
        <dt>Cap Rate</dt><dd>5.2%</dd>
      </dl>
      <a href="/documents/332-e-6th-st-om.pdf">Offering Memorandum</a>
    </body>
  </html>
`;

describe("LoopNet browser capture route", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api", loopNetBrowserCaptureRouter);
    app.use("/api", testAgentRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("requires the local browser capture token", async () => {
    const res = await fetch(`${baseUrl}/api/test-agent/loopnet/browser-capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.loopnet.com",
      },
      body: JSON.stringify({ url: LOOPNET_URL, html: LOOPNET_HTML }),
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://www.loopnet.com");
  });

  it("creates a native LoopNet manual run from browser-captured HTML and metadata", async () => {
    const res = await fetch(`${baseUrl}/api/test-agent/loopnet/browser-capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LoopNet-Capture-Token": getLoopNetBrowserCaptureToken(),
        Origin: "https://www.loopnet.com",
      },
      body: JSON.stringify({
        url: LOOPNET_URL,
        html: LOOPNET_HTML,
        captureMode: "bookmarklet",
        metadata: {
          documentTitle: "332 E 6th St | LoopNet",
          visibleText: "332 E 6th St Offering Memorandum",
          images: ["https://images.example/332.jpg"],
          links: [{ href: "https://www.loopnet.com/documents/332-e-6th-st-om.pdf", text: "Offering Memorandum" }],
        },
      }),
    });
    const data = await res.json() as {
      runId: string;
      raw: Record<string, unknown>;
      captureMetadata: Record<string, unknown>;
    };

    expect(res.status).toBe(201);
    expect(data.raw).toMatchObject({
      id: "40648022",
      address: "332 E 6th St",
      price: "3200000",
      ingestionMode: "bookmarklet_capture",
      extractionStatus: "captured",
    });
    expect(data.captureMetadata).toMatchObject({
      captureMode: "bookmarklet",
    });

    const runRes = await fetch(`${baseUrl}/api/test-agent/runs/${data.runId}`);
    const run = await runRes.json() as {
      source: string;
      sourceMetadata: Record<string, unknown>;
      properties: Array<Record<string, unknown>>;
    };

    expect(run.source).toBe("loopnet");
    expect(run.sourceMetadata.captureMode).toBe("bookmarklet");
    expect(run.properties[0]?._sourceAdapter).toBe("loopnet");
    expect(run.properties[0]?.attachmentHandoff).toMatchObject({
      source: "loopnet",
      publicDocumentsFound: 1,
      status: "ready_for_review",
    });
  });
});
