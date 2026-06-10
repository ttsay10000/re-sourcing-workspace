/**
 * Market comps read API: every comparable extracted from broker comp packages,
 * across all subject properties, with lazy Geoclient geocoding so comps can be
 * plotted next to deals on the yield map.
 *
 * GET /api/comps/market?geocode=1&limit=500
 *   - comps[]: one row per accepted sale_comp / pricing_comp item
 *   - summary: counts + medians + cap-rate coverage (psfOnly flagging)
 *
 * Geocoding: comp addresses come from PDFs, so coordinates are resolved via
 * the NYC Geoclient address endpoint and cached in comp_address_geocodes.
 * Each request with geocode=1 resolves at most GEOCODE_BATCH_PER_REQUEST new
 * addresses; repeated loads converge until everything cacheable is cached.
 */

import { Router, type Request, type Response } from "express";
import { getPool } from "@re-sourcing/db";
import { resolveBBLFromAddress } from "../enrichment/geoclient.js";
import { stripUnitFromAddressLine } from "../enrichment/resolvePropertyBBL.js";

const router = Router();

const GEOCODE_BATCH_PER_REQUEST = 12;
const GEOCODE_FAILED_RETRY_DAYS = 7;

export interface MarketCompRow {
  itemId: string;
  packageId: string;
  packageType: string;
  packageCreatedAt: string | null;
  subjectPropertyId: string;
  subjectAddress: string;
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

  try {
    const pool = getPool();
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

    const comps: MarketCompRow[] = [];
    const parsedByKey = new Map<string, ParsedCompAddress>();
    const keyByItemId = new Map<string, string>();

    for (const row of result.rows) {
      const payload = {
        ...((row.normalized_payload as Record<string, unknown> | null) ?? {}),
        ...((row.reviewed_payload as Record<string, unknown> | null) ?? {}),
      };
      const capRatePct = toNumber(payload.capRatePct ?? payload.capRate);
      const pricePsf = toNumber(payload.pricePerSqft ?? payload.salePsf ?? payload.soldPpsf ?? payload.askingPpsf);
      const address = toText(payload.address ?? payload.propertyAddress);
      const subjectBorough = toText(row.subject_borough);
      const comp: MarketCompRow = {
        itemId: String(row.id),
        packageId: String(row.package_id),
        packageType: String(row.package_type),
        packageCreatedAt: toIso(row.package_created_at),
        subjectPropertyId: String(row.subject_property_id),
        subjectAddress: String(row.subject_address),
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
        lat: null,
        lng: null,
      };

      if (address) {
        const parsed = parseCompAddress(address, subjectBorough);
        if (parsed) {
          const key = geocodeKey(parsed.addressLine, parsed.borough);
          parsedByKey.set(key, parsed);
          keyByItemId.set(comp.itemId, key);
        }
      }
      comps.push(comp);
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
        const key = keyByItemId.get(comp.itemId);
        const hit = key ? cacheByKey.get(key) : undefined;
        if (hit && hit.geocode_status === "ok") {
          comp.lat = toNumber(hit.lat);
          comp.lng = toNumber(hit.lng);
        }
      }
    }

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
