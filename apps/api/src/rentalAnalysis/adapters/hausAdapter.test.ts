import { describe, expect, it } from "vitest";
import { parseHausListingMetadata, parseHausListingUrls } from "./hausAdapter.js";
import { evaluateExclusion } from "../exclusion.js";
import { parseRobotsDisallows, isPathAllowed } from "./politeFetch.js";

describe("parseHausListingUrls", () => {
  it("extracts listing detail links from search-page HTML and ignores nav/utility links", () => {
    const html = `
      <a href="/new-york-furnished-apartments/">All apartments</a>
      <a href="/new-york-furnished-apartments/the-grand-chelsea-2br">The Grand</a>
      <a href="https://stayhaus.co/new-york-furnished-apartments/midtown-east-studio?utm=x">Midtown East Studio</a>
      <a href="/about">About</a>
      <a href="/blog/some-post">Blog</a>
      <a href="https://other-site.com/new-york-furnished-apartments/not-ours">External</a>
    `;
    const urls = parseHausListingUrls(html);
    expect(urls).toContain("https://stayhaus.co/new-york-furnished-apartments/the-grand-chelsea-2br");
    expect(urls).toContain("https://stayhaus.co/new-york-furnished-apartments/midtown-east-studio");
    expect(urls).toHaveLength(2);
  });

  it("extracts <loc> entries from sitemap XML", () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://stayhaus.co/new-york-furnished-apartments/soho-loft-1br</loc></url>
      <url><loc>https://stayhaus.co/faq</loc></url>
    </urlset>`;
    const urls = parseHausListingUrls(xml);
    expect(urls).toEqual(["https://stayhaus.co/new-york-furnished-apartments/soho-loft-1br"]);
  });
});

describe("parseHausListingMetadata", () => {
  it("prefers JSON-LD apartment data including geo and offer price", () => {
    const html = `
      <script type="application/ld+json">${JSON.stringify({
        "@type": "Apartment",
        name: "Sunny Chelsea 1BR",
        address: { streetAddress: "200 W 24th St", addressLocality: "Chelsea" },
        geo: { latitude: 40.7445, longitude: -73.9954 },
        numberOfBedrooms: 1,
        numberOfBathroomsTotal: 1,
        floorSize: { value: 640 },
        image: ["https://img.example/1.jpg"],
        offers: { price: "5400", priceSpecification: { unitText: "MONTH" } },
      })}</script>`;
    const parsed = parseHausListingMetadata(html);

    expect(parsed.title).toBe("Sunny Chelsea 1BR");
    expect(parsed.address).toBe("200 W 24th St, Chelsea");
    expect(parsed.neighborhood).toBe("Chelsea");
    expect(parsed.latitude).toBeCloseTo(40.7445);
    expect(parsed.beds).toBe(1);
    expect(parsed.sqft).toBe(640);
    expect(parsed.imageUrl).toBe("https://img.example/1.jpg");
    expect(parsed.visibleMonthlyRate).toBe(5400);
  });

  it("falls back to text patterns for beds/baths/sqft/min-stay and prices", () => {
    const html = `
      <h1>Greenwich Village 2 Bedroom</h1>
      <ul><li>2 Bedrooms</li><li>1.5 Bathrooms</li><li>820 sq ft</li><li>Sleeps 4</li></ul>
      <p>Minimum stay: 30 nights</p>
      <div class="price">$7,200/month</div>`;
    const parsed = parseHausListingMetadata(html);

    expect(parsed.beds).toBe(2);
    expect(parsed.baths).toBe(1.5);
    expect(parsed.sqft).toBe(820);
    expect(parsed.guests).toBe(4);
    expect(parsed.minStayNights).toBe(30);
    expect(parsed.visibleMonthlyRate).toBe(7200);
  });

  it("converts month-denominated minimum stays to nights (feeds exclusion)", () => {
    const html = `<p>Minimum stay: 3 months</p><div>$6,000 per month</div>`;
    const parsed = parseHausListingMetadata(html);
    expect(parsed.minStayNights).toBe(90);
    expect(evaluateExclusion({ minStayNights: parsed.minStayNights }, 45)).toEqual({
      excluded: true,
      reason: "Minimum stay exceeds monthly comp threshold",
    });
  });

  it("survives malformed JSON-LD", () => {
    const html = `<script type="application/ld+json">{not json}</script><p>1 Bedroom · $250/night</p>`;
    const parsed = parseHausListingMetadata(html);
    expect(parsed.beds).toBe(1);
    expect(parsed.visibleAdr).toBe(250);
  });
});

describe("robots handling", () => {
  it("parses Disallow rules under the wildcard agent and checks paths", () => {
    const robots = `User-agent: Googlebot\nDisallow: /private\n\nUser-agent: *\nDisallow: /admin\nDisallow: /checkout\n`;
    const disallows = parseRobotsDisallows(robots, "re-sourcing-rental-research/1.0");
    expect(disallows).toEqual(["/admin", "/checkout"]);
    expect(isPathAllowed("/new-york-furnished-apartments/x", disallows)).toBe(true);
    expect(isPathAllowed("/admin/tools", disallows)).toBe(false);
  });

  it("a blanket Disallow: / blocks everything", () => {
    const disallows = parseRobotsDisallows(`User-agent: *\nDisallow: /\n`);
    expect(isPathAllowed("/anything", disallows)).toBe(false);
  });
});
