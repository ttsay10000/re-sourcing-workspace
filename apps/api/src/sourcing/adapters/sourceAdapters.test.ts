import { describe, expect, it, vi } from "vitest";
import {
  buildStreetEasyCriteriaFromBody,
  buildLoopNetSearchUrl,
  extractLoopNetDetailsFromHtml,
  extractLoopNetListingId,
  getSourceAdapter,
  listEnabledSavedSearchAdapters,
  normalizeLoopNetPayload,
  sanitizeSourceToggles,
} from "./index.js";

describe("source adapter registry", () => {
  it("keeps StreetEasy as the saved-search adapter", () => {
    const adapters = listEnabledSavedSearchAdapters({ streeteasy: true, manual: false, loopnet: true });

    expect(adapters.map((adapter) => adapter.id)).toEqual(["streeteasy"]);
    expect(getSourceAdapter("streeteasy").listingSource).toBe("streeteasy");
  });

  it("preserves unknown-source DB fallback toggles", () => {
    expect(sanitizeSourceToggles({ streeteasy: false, manual: false, loopnet: true })).toMatchObject({
      streeteasy: false,
      manual: false,
      loopnet: true,
    });
  });
});

describe("StreetEasy adapter", () => {
  it("expands multifamily searches to include townhouse house records", () => {
    const criteria = buildStreetEasyCriteriaFromBody({
      areas: "all-downtown",
      minPrice: 4000000,
      types: "multi_family",
      limit: 100,
    });

    expect(criteria.requestedTypes).toBe("multi_family");
    expect(criteria.types).toBe("multi_family,house");
  });
});

describe("LoopNet adapter", () => {
  it("builds a first-page NYC multifamily search URL", () => {
    expect(buildLoopNetSearchUrl({ location: "New York, NY", minPrice: 1000000, maxPrice: 5000000 })).toBe(
      "https://www.loopnet.com/search/apartment-buildings/new-york-ny/for-sale/?min-price=1000000&max-price=5000000"
    );
  });

  it("normalizes LoopNet-shaped payloads to the native listing source", () => {
    const normalized = normalizeLoopNetPayload({
      url: "https://www.loopnet.com/Listing/123-Main-St-New-York-NY/31948105/",
      name: "123 Main St",
      address: "123 Main St",
      city: "New York",
      state: "NY",
      zip_code: "10001",
      price: "$2,800,000",
      size_sqft: "12,500 SF",
      broker_name: "Ada Broker",
      broker_company: "Example Realty",
    }, 0);

    expect(extractLoopNetListingId(normalized.url)).toBe("31948105");
    expect(normalized.source).toBe("loopnet");
    expect(normalized.externalId).toBe("loopnet:31948105");
    expect(normalized.price).toBe(2800000);
    expect(normalized.sqft).toBe(12500);
    expect(normalized.extra?.sourceAdapter).toBe("loopnet");
  });

  it("extracts canonical fields and document handoff metadata from accessible LoopNet HTML", () => {
    const html = `
      <html>
        <head>
          <title>332 E 6th St | LoopNet</title>
          <meta property="og:title" content="332 E 6th St | LoopNet" />
          <meta property="og:description" content="East Village multifamily investment." />
          <meta property="og:image" content="https://images.example/332-main.jpg" />
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "332 E 6th St",
              "image": ["https://images.example/332-2.jpg"],
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
            <dt>Property Type</dt><dd>Apartment Buildings</dd>
            <dt>Cap Rate</dt><dd>5.2%</dd>
            <dt>Number of Units</dt><dd>10</dd>
            <dt>Building Size</dt><dd>8,750 SF</dd>
            <dt>Lot Size</dt><dd>2,300 SF</dd>
            <dt>Zoning</dt><dd>R7A</dd>
            <dt>Year Built</dt><dd>1910</dd>
            <dt>APN</dt><dd>00447-0033</dd>
          </dl>
          <a href="/documents/332-e-6th-st-om.pdf">Offering Memorandum</a>
          <a href="mailto:broker@example.com">Email Broker</a>
          <a href="tel:(212) 555-0100">Call</a>
        </body>
      </html>
    `;

    const raw = extractLoopNetDetailsFromHtml(
      html,
      "https://www.loopnet.com/Listing/332-E-6th-St-New-York-NY/40648022/"
    );
    const normalized = normalizeLoopNetPayload(raw, 0);

    expect(raw.id).toBe("40648022");
    expect(normalized.externalId).toBe("loopnet:40648022");
    expect(normalized.address).toBe("332 E 6th St");
    expect(normalized.zip).toBe("10003");
    expect(normalized.price).toBe(3200000);
    expect(normalized.sqft).toBe(8750);
    expect(normalized.lat).toBe(40.725);
    expect(normalized.lon).toBe(-73.987);
    expect(normalized.imageUrls).toEqual(["https://images.example/332-main.jpg", "https://images.example/332-2.jpg"]);
    expect(normalized.extra?.units).toBe(10);
    expect(normalized.extra?.capRate).toBe("5.2%");
    expect(normalized.extra?.zoning).toBe("R7A");
    expect(normalized.extra?.yearBuilt).toBe(1910);
    expect(normalized.extra?.apn).toBe("00447-0033");
    expect(normalized.extra?.attachmentHandoff).toMatchObject({
      source: "loopnet",
      publicDocumentsFound: 1,
      status: "ready_for_review",
    });
  });

  it("uses stable LoopNet identity keys for the supplied NYC examples", () => {
    expect(extractLoopNetListingId("https://www.loopnet.com/Listing/332-E-6th-St-New-York-NY/40648022/")).toBe("40648022");
    expect(extractLoopNetListingId("https://www.loopnet.com/Listing/48-E-7th-St-New-York-NY/40525481/")).toBe("40525481");
  });

  it("keeps a diagnostic scaffold when LoopNet blocks unauthenticated HTML fetches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html><h1>Access Denied</h1></html>", {
      status: 403,
      statusText: "Forbidden",
      headers: { "content-type": "text/html" },
    })));
    try {
      const raw = await getSourceAdapter("loopnet").fetchDetailsByUrl(
        "https://www.loopnet.com/Listing/332-E-6th-St-New-York-NY/40648022/",
        { runKind: "manual" }
      );

      expect(raw.id).toBe("40648022");
      expect(raw.address).toBe("332 E 6th St");
      expect(raw.extractionStatus).toBe("blocked");
      expect(raw.extractionDiagnostics).toMatchObject({
        httpStatus: 403,
        blockedReason: "HTTP 403 Forbidden",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
