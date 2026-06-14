/**
 * Market comps read API: every user-approved comparable — broker comp package
 * items AND deals extracted from market documents (research reports, OMs,
 * comp lists) — across all subject properties, with lazy Geoclient geocoding
 * so comps can be plotted next to deals on the yield map.
 *
 * GET /api/comps/market?geocode=1&limit=500&origin=all|broker|market_doc
 *   - comps[]: one row per accepted broker sale_comp / pricing_comp item plus
 *     one row per approved market-doc comp, each carrying a `source`
 *     attribution (report title + publisher + period, or package + subject)
 *   - summary: counts + medians + cap-rate coverage (psfOnly flagging)
 *
 * Review gate: broker items must be accepted/edited (pending ones sit in the
 * Comp Analysis review queue) and market-doc comps must be approved.
 *
 * Geocoding: comp addresses come from PDFs, so coordinates are resolved via
 * the NYC Geoclient address endpoint and cached in comp_address_geocodes.
 * Each request with geocode=1 resolves at most GEOCODE_BATCH_PER_REQUEST new
 * addresses; repeated loads converge until everything cacheable is cached.
 */

import { Router, type Request, type Response } from "express";
import { getPool, MarketCompRepo } from "@re-sourcing/db";
import { resolveBBLFromAddress } from "../enrichment/geoclient.js";
import { stripUnitFromAddressLine } from "../enrichment/resolvePropertyBBL.js";

const router = Router();

const GEOCODE_BATCH_PER_REQUEST = 12;
const GEOCODE_FAILED_RETRY_DAYS = 7;

export type MarketCompOrigin = "broker_package" | "market_doc";

/** Where a comp came from, rendered on Comp Analysis and yield-map popups. */
export interface MarketCompSource {
  kind: MarketCompOrigin;
  /** One-line attribution, e.g. "Tri-State Investment Sales — Manhattan property sales report" or "Sale Comps package". */
  label: string;
  title: string | null;
  publisher: string | null;
  /** e.g. "Q1 2026" for market documents. */
  period: string | null;
  documentId: string | null;
  packageId: string | null;
}

export interface MarketCompRow {
  itemId: string;
  packageId: string;
  packageType: string;
  packageCreatedAt: string | null;
  /** Null for market-doc comps (no subject deal behind a research report). */
  subjectPropertyId: string | null;
  subjectAddress: string | null;
  itemType: string;
  propertyName: string | null;
  address: string | null;
  neighborhood: string | null;
  borough: string | null;
  units: number | null;
  yearCompleted: number | null;
  capRatePct: number | null;
  noi: number | null;
  salePrice: number | null;
  saleDate: string | null;
  pricePsf: number | null;
  pricePerUnit: number | null;
  percentSoldPct: number | null;
  /** True when the comp has $/PSF data but no cap rate — needs better comps from the broker. */
  psfOnly: boolean;
  confidence: number | null;
  reviewStatus: string;
  selectionDecision: string | null;
  origin: MarketCompOrigin;
  source: MarketCompSource;
  assetType: string | null;
  priceType: string | null;
  /** Purchaser as printed (institutional-trend tracking). */
  buyer: string | null;
  /** Printed sale-condition flags (portfolio, partial interest, estate, ...). */
  saleConditions: string[];
  /** Comp tables inside OMs/BOVs — usable but flagged. */
  cherryPickRisk: boolean;
  lat: number | null;
  lng: number | null;
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const numeric = typeof value === "string" ? Number(value.replace(/[$,%\s,]/g, "")) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : null;
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function packageTypeLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function marketDocSourceLabel(input: {
  publisher: string | null | undefined;
  title: string | null | undefined;
  period: string | null | undefined;
  fallback: string | null | undefined;
}): string {
  const base = [input.publisher, input.title].filter((part): part is string => Boolean(part)).join(" — ");
  const label = base || input.fallback || "Market document";
  return input.period ? `${label} · ${input.period}` : label;
}

const BOROUGH_NAMES = ["manhattan", "bronx", "brooklyn", "queens", "staten island"];

function normalizeBoroughName(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "new york" || raw === "new york city" || raw === "ny" || raw === "nyc") return "Manhattan";
  for (const name of BOROUGH_NAMES) {
    if (raw.includes(name)) return name.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  return null;
}

/** Cache key: normalized building-level address line + borough hint. */
function geocodeKey(addressLine: string, borough: string): string {
  return `${addressLine.toLowerCase().replace(/\s+/g, " ").trim()}|${borough.toLowerCase()}`;
}

interface ParsedCompAddress {
  addressLine: string;
  houseNumber: string;
  street: string;
  borough: string;
  zip: string;
}

/**
 * Parse a free-text comp address ("210 East 39th Street, New York, NY 10016")
 * into Geoclient inputs. Borough falls back to the subject property's borough
 * (comps cluster around the subject), then Manhattan.
 */
function parseCompAddress(rawAddress: string, fallbackBorough: string | null): ParsedCompAddress | null {
  const segments = rawAddress.split(",").map((part) => part.trim()).filter(Boolean);
  const addressLine = stripUnitFromAddressLine(segments[0] ?? "");
  const parts = addressLine.split(/\s+/);
  const houseNumber = parts[0] ?? "";
  const street = parts.slice(1).join(" ").trim();
  if (!/^\d/.test(houseNumber) || !street) return null;

  const zipMatch = rawAddress.match(/\b(\d{5})(?:-\d{4})?\b/);
  const boroughFromAddress = segments
    .slice(1)
    .map((segment) => normalizeBoroughName(segment))
    .find((value) => value != null);
  const borough = boroughFromAddress ?? normalizeBoroughName(fallbackBorough) ?? "Manhattan";

  return {
    addressLine,
    houseNumber,
    street,
    borough,
    zip: zipMatch?.[1] ?? "",
  };
}

interface GeocodeCacheRow {
  address_key: string;
  lat: number | string | null;
  lng: number | string | null;
  geocode_status: string;
  geocoded_at: Date | string | null;
}

router.get("/comps/market", async (req: Request, res: Response) => {
  const limit = Math.max(1, Math.min(toNumber(req.query.limit) ?? 500, 1000));
  const shouldGeocode = req.query.geocode === "1" || req.query.geocode === "true";
  const origin =
    req.query.origin === "broker" ? "broker_package" : req.query.origin === "market_doc" ? "market_doc" : "all";

  try {
    const pool = getPool();
    const comps: MarketCompRow[] = [];
    const parsedByKey = new Map<string, ParsedCompAddress>();
    const keyByItemId = new Map<string, string>();
    const registerForGeocode = (itemId: string, address: string, fallbackBorough: string | null) => {
      const parsed = parseCompAddress(address, fallbackBorough);
      if (!parsed) return;
      const key = geocodeKey(parsed.addressLine, parsed.borough);
      parsedByKey.set(key, parsed);
      keyByItemId.set(itemId, key);
    };

    if (origin !== "market_doc") {
      const result = await pool.query(
        `SELECT
           i.id,
           i.package_id,
           i.item_type,
           i.normalized_payload,
           i.reviewed_payload,
           i.confidence,
           i.review_status,
           i.selection_decision,
           pkg.package_type,
           pkg.created_at AS package_created_at,
           p.id AS subject_property_id,
           p.canonical_address AS subject_address,
           p.details#>>'{neighborhood,primary,borough}' AS subject_borough
         FROM broker_comp_extracted_items i
         INNER JOIN broker_comp_packages pkg ON pkg.id = i.package_id
         INNER JOIN properties p ON p.id = i.property_id
         WHERE i.item_type IN ('sale_comp', 'pricing_comp')
           AND i.review_status IN ('accepted', 'edited')
           AND (i.selection_decision IS NULL OR i.selection_decision IN ('include', 'watch'))
           AND pkg.status IN ('approved', 'needs_review', 'extracted', 'classified')
         ORDER BY pkg.created_at DESC, i.created_at DESC
         LIMIT $1`,
        [limit]
      );

      for (const row of result.rows) {
        const payload = {
          ...((row.normalized_payload as Record<string, unknown> | null) ?? {}),
          ...((row.reviewed_payload as Record<string, unknown> | null) ?? {}),
        };
        const capRatePct = toNumber(payload.capRatePct ?? payload.capRate);
        const pricePsf = toNumber(payload.pricePerSqft ?? payload.salePsf ?? payload.soldPpsf ?? payload.askingPpsf);
        const address = toText(payload.address ?? payload.propertyAddress);
        const subjectBorough = toText(row.subject_borough);
        const packageType = String(row.package_type);
        const subjectAddress = String(row.subject_address);
        const comp: MarketCompRow = {
          itemId: String(row.id),
          packageId: String(row.package_id),
          packageType,
          packageCreatedAt: toIso(row.package_created_at),
          subjectPropertyId: String(row.subject_property_id),
          subjectAddress,
          itemType: String(row.item_type),
          propertyName: toText(payload.propertyName),
          address,
          neighborhood: toText(payload.neighborhood),
          borough: normalizeBoroughName(toText(payload.borough)) ?? normalizeBoroughName(subjectBorough),
          units: toNumber(payload.units),
          yearCompleted: toNumber(payload.yearCompleted),
          capRatePct,
          noi: toNumber(payload.noi),
          salePrice: toNumber(payload.salePrice),
          saleDate: toText(payload.saleDate),
          pricePsf,
          pricePerUnit: toNumber(payload.pricePerUnit),
          percentSoldPct: toNumber(payload.percentSoldPct),
          psfOnly: capRatePct == null && pricePsf != null,
          confidence: toNumber(row.confidence),
          reviewStatus: String(row.review_status),
          selectionDecision: (row.selection_decision as string | null) ?? null,
          origin: "broker_package",
          source: {
            kind: "broker_package",
            label: `${packageTypeLabel(packageType)} package · ${subjectAddress.split(",")[0]}`,
            title: null,
            publisher: null,
            period: null,
            documentId: null,
            packageId: String(row.package_id),
          },
          assetType: toText(payload.assetType),
          priceType: null,
          buyer: toText(payload.buyer ?? payload.purchaser),
          saleConditions: [],
          cherryPickRisk: false,
          lat: null,
          lng: null,
        };

        if (address) registerForGeocode(comp.itemId, address, subjectBorough);
        comps.push(comp);
      }
    }

    if (origin !== "broker_package") {
      // Deals extracted from market documents (research reports, OMs, comp
      // lists) that the user approved in the review queue. Subject properties
      // never count as comps; asking-price rows keep their priceType label.
      const docRows = await new MarketCompRepo({ pool }).listApprovedWithDocuments(limit);
      for (const { comp: docComp, document } of docRows) {
        const capRatePct = docComp.capRate != null ? docComp.capRate * 100 : null;
        const publisher = document?.publisher ?? docComp.provenance.publisher;
        const title = document?.reportTitle ?? docComp.provenance.report_title;
        const period = document?.periodCovered ?? null;
        const comp: MarketCompRow = {
          itemId: docComp.id,
          packageId: document?.id ?? docComp.documentId ?? docComp.id,
          packageType: document?.documentClass ?? docComp.provenance.document_class,
          packageCreatedAt: docComp.createdAt,
          subjectPropertyId: null,
          subjectAddress: null,
          itemType: "market_doc_comp",
          propertyName: null,
          address: docComp.address,
          neighborhood: docComp.neighborhoodRaw,
          borough: normalizeBoroughName(docComp.borough),
          units: docComp.unitsTotal,
          yearCompleted: null,
          capRatePct,
          noi: docComp.noi,
          salePrice: docComp.salePrice,
          saleDate: docComp.saleDate,
          pricePsf: docComp.pricePsf,
          pricePerUnit:
            docComp.pricePerUnit ??
            (docComp.salePrice != null && docComp.unitsTotal != null && docComp.unitsTotal > 0
              ? docComp.salePrice / docComp.unitsTotal
              : null),
          percentSoldPct: null,
          psfOnly: capRatePct == null && docComp.pricePsf != null,
          confidence: null,
          reviewStatus: docComp.reviewStatus,
          selectionDecision: null,
          origin: "market_doc",
          source: {
            kind: "market_doc",
            label: marketDocSourceLabel({
              publisher,
              title,
              period,
              fallback: document?.filename,
            }),
            title,
            publisher,
            period,
            documentId: document?.id ?? docComp.documentId,
            packageId: null,
          },
          assetType: docComp.assetType,
          priceType: docComp.priceType,
          buyer: docComp.buyer,
          saleConditions: docComp.saleConditions,
          cherryPickRisk: docComp.cherryPickRisk,
          lat: docComp.lat,
          lng: docComp.lng,
        };

        if (comp.lat == null && docComp.address) registerForGeocode(comp.itemId, docComp.address, docComp.borough);
        comps.push(comp);
      }
    }

    // Attach cached coordinates; optionally geocode a bounded batch of misses.
    const keys = [...parsedByKey.keys()];
    if (keys.length > 0) {
      const cached = await pool.query<GeocodeCacheRow>(
        `SELECT address_key, lat, lng, geocode_status, geocoded_at
           FROM comp_address_geocodes
          WHERE address_key = ANY($1::text[])`,
        [keys]
      );
      const cacheByKey = new Map(cached.rows.map((row) => [row.address_key, row]));

      if (shouldGeocode) {
        const retryBefore = Date.now() - GEOCODE_FAILED_RETRY_DAYS * 24 * 60 * 60 * 1000;
        const pending = keys
          .filter((key) => {
            const hit = cacheByKey.get(key);
            if (!hit) return true;
            if (hit.geocode_status === "ok") return false;
            const at = hit.geocoded_at ? new Date(hit.geocoded_at).getTime() : 0;
            return at < retryBefore;
          })
          .slice(0, GEOCODE_BATCH_PER_REQUEST);

        for (const key of pending) {
          const parsed = parsedByKey.get(key);
          if (!parsed) continue;
          let lat: number | null = null;
          let lng: number | null = null;
          let bbl: string | null = null;
          try {
            const resolved = await resolveBBLFromAddress(parsed.houseNumber, parsed.street, {
              borough: parsed.borough,
              zip: parsed.zip || null,
            });
            lat = resolved?.lat ?? null;
            lng = resolved?.lon ?? null;
            bbl = resolved?.bbl ?? null;
          } catch {
            // treated as a failed lookup below
          }
          const status = lat != null && lng != null ? "ok" : "failed";
          await pool.query(
            `INSERT INTO comp_address_geocodes (address_key, address, borough_hint, lat, lng, bbl, geocode_status, geocoded_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now())
             ON CONFLICT (address_key) DO UPDATE SET
               lat = EXCLUDED.lat,
               lng = EXCLUDED.lng,
               bbl = EXCLUDED.bbl,
               geocode_status = EXCLUDED.geocode_status,
               geocoded_at = now()`,
            [key, parsed.addressLine, parsed.borough, lat, lng, bbl, status]
          );
          cacheByKey.set(key, { address_key: key, lat, lng, geocode_status: status, geocoded_at: new Date() });
        }
      }

      for (const comp of comps) {
        if (comp.lat != null && comp.lng != null) continue;
        const key = keyByItemId.get(comp.itemId);
        const hit = key ? cacheByKey.get(key) : undefined;
        if (hit && hit.geocode_status === "ok") {
          comp.lat = toNumber(hit.lat);
          comp.lng = toNumber(hit.lng);
        }
      }
    }

    comps.sort((a, b) => (b.packageCreatedAt ?? "").localeCompare(a.packageCreatedAt ?? ""));
    // Each origin queried up to `limit` rows; honor the contract on the union too.
    if (comps.length > limit) comps.length = limit;
    const capRates = comps.map((comp) => comp.capRatePct).filter((value): value is number => value != null);
    const psfs = comps.map((comp) => comp.pricePsf).filter((value): value is number => value != null);
    res.json({
      comps,
      summary: {
        count: comps.length,
        withCapRate: capRates.length,
        psfOnly: comps.filter((comp) => comp.psfOnly).length,
        withCoordinates: comps.filter((comp) => comp.lat != null && comp.lng != null).length,
        medianCapRatePct: median(capRates),
        medianPricePsf: median(psfs),
        originCounts: {
          broker: comps.filter((comp) => comp.origin === "broker_package").length,
          marketDoc: comps.filter((comp) => comp.origin === "market_doc").length,
        },
      },
    });
  } catch (err) {
    console.error("[comps market]", err);
    const pgCode = (err as { code?: string } | null)?.code;
    const message = err instanceof Error ? err.message : String(err);
    const migrationHint =
      pgCode === "42P01" && /comp_address_geocodes/i.test(message)
        ? " The database schema is behind — run `npm run db:migrate` (migration 059 adds comp_address_geocodes)."
        : "";
    res.status(500).json({ error: `Failed to load market comps.${migrationHint}`, details: message });
  }
});

export default router;
