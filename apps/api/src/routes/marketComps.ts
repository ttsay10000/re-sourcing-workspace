/**
 * Market Comps ("Rent & Expense Comping") API.
 *
 * One subject property compared against three always-on comp sets — Same
 * Submarket, Same Borough, All NYC — across operating metrics (occupancy,
 * revenue/expenses/NOI per unit & PSF, margins, pricing, rent by unit type,
 * expense categories). Every metric ships with dispersion (median, p25/p75,
 * min/max, n) and subject-vs-median variance, plus closed-sale market
 * evidence ($/SF, cap rate) from the ingested market-comp layer.
 */

import { Router, type Request, type Response } from "express";
import { getPool, NeighborhoodRepo } from "@re-sourcing/db";
import {
  buildNeighborhoodIndex,
  normalizeNeighborhoodName,
  resolveNeighborhoodId,
} from "../marketContext/neighborhoodResolve.js";
import {
  aggregateMetric,
  buildOperatingMetricsRow,
  EXPENSE_CATEGORY_LABELS,
  UNIT_TYPE_LABELS,
  toFiniteNumber,
  type ExpenseCategoryKey,
  type MetricStat,
  type OperatingMetricsRow,
  type UnitTypeKey,
} from "../marketComps/metrics.js";

const router = Router();

const BBL_BOROUGHS: Record<string, string> = {
  "1": "Manhattan",
  "2": "Bronx",
  "3": "Brooklyn",
  "4": "Queens",
  "5": "Staten Island",
};

function titleCaseBorough(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const PROPERTY_SELECT = `
  SELECT
    p.id AS property_id,
    p.canonical_address,
    p.details#>>'{neighborhood,primary,borough}' AS borough,
    LEFT(p.details->>'bbl', 1) AS bbl_borough_digit,
    COALESCE(
      p.details#>>'{neighborhood,primary,name}',
      p.details#>>'{neighborhood,primary,neighborhood}',
      p.details#>>'{omData,authoritative,propertyInfo,neighborhood}',
      lst.listing_extra->>'neighborhood',
      lst.listing_extra->>'area'
    ) AS neighborhood_raw,
    p.details#>>'{omData,authoritative,propertyInfo,totalUnits}' AS om_units,
    p.details#>>'{rentalFinancials,omAnalysis,propertyInfo,totalUnits}' AS om_units_fallback,
    p.details#>>'{omData,authoritative,propertyInfo,buildingSqft}' AS om_gsf,
    p.details#>>'{omData,authoritative,propertyInfo,yearBuilt}' AS om_year_built,
    p.details#>>'{omData,authoritative,propertyInfo,propertyType}' AS om_property_type,
    p.details#>>'{omData,authoritative,income,effectiveGrossIncome}' AS om_egi,
    p.details#>>'{omData,authoritative,currentFinancials,grossRentalIncome}' AS om_gross_rent,
    p.details#>>'{omData,authoritative,currentFinancials,otherIncome}' AS om_other_income,
    p.details#>>'{omData,authoritative,income,reportedOccupancyPct}' AS om_occupancy,
    p.details#>>'{omData,authoritative,income,reportedVacancyPct}' AS om_vacancy,
    p.details#>>'{omData,authoritative,expenses,totalExpenses}' AS om_total_expenses,
    p.details#>>'{omData,authoritative,currentFinancials,operatingExpenses}' AS om_operating_expenses,
    p.details#>>'{omData,authoritative,currentFinancials,noi}' AS om_noi,
    p.details#>'{omData,authoritative,rentRoll}' AS rent_roll,
    p.details#>'{omData,authoritative,expenses,expensesTable}' AS expenses_table,
    p.details#>>'{manualSourceFacts,askingPrice}' AS ask_manual,
    p.details#>>'{omData,authoritative,propertyInfo,askingPrice}' AS ask_om,
    p.details#>>'{omData,authoritative,propertyInfo,price}' AS ask_om_price,
    lst.listing_price,
    ds.asset_cap_rate,
    ds.price_psf,
    ds.price_per_unit,
    ds.expense_ratio,
    ds.current_noi
  FROM properties p
  LEFT JOIN LATERAL (
    SELECT s.asset_cap_rate, s.price_psf, s.price_per_unit, s.expense_ratio, s.current_noi
    FROM deal_signals s
    WHERE s.property_id = p.id
    ORDER BY s.generated_at DESC
    LIMIT 1
  ) ds ON TRUE
  LEFT JOIN LATERAL (
    SELECT l.price AS listing_price, l.extra AS listing_extra
    FROM listing_property_matches m
    INNER JOIN listings l ON l.id = m.listing_id
    WHERE m.property_id = p.id AND m.status <> 'rejected'
    ORDER BY (m.status = 'accepted') DESC, m.confidence DESC NULLS LAST, m.created_at DESC
    LIMIT 1
  ) lst ON TRUE`;

function rowToMetrics(row: Record<string, unknown>): OperatingMetricsRow {
  return buildOperatingMetricsRow({
    propertyId: String(row.property_id),
    address: String(row.canonical_address),
    neighborhoodRaw: (row.neighborhood_raw as string | null) ?? null,
    borough: titleCaseBorough(
      (row.borough as string | null) ?? BBL_BOROUGHS[String(row.bbl_borough_digit ?? "")] ?? null
    ),
    units: toFiniteNumber(row.om_units) ?? toFiniteNumber(row.om_units_fallback),
    gsf: toFiniteNumber(row.om_gsf),
    yearBuilt: toFiniteNumber(row.om_year_built),
    propertyType: (row.om_property_type as string | null) ?? null,
    askingPrice:
      toFiniteNumber(row.ask_manual) ??
      toFiniteNumber(row.ask_om) ??
      toFiniteNumber(row.ask_om_price) ??
      toFiniteNumber(row.listing_price),
    signalCapRatePct: toFiniteNumber(row.asset_cap_rate),
    signalPricePsf: toFiniteNumber(row.price_psf),
    signalPricePerUnit: toFiniteNumber(row.price_per_unit),
    signalExpenseRatioPct: toFiniteNumber(row.expense_ratio),
    signalNoi: toFiniteNumber(row.current_noi),
    effectiveGrossIncome: toFiniteNumber(row.om_egi),
    grossRentalIncome: toFiniteNumber(row.om_gross_rent),
    otherIncome: toFiniteNumber(row.om_other_income),
    reportedOccupancyPct: toFiniteNumber(row.om_occupancy),
    reportedVacancyPct: toFiniteNumber(row.om_vacancy),
    totalExpenses: toFiniteNumber(row.om_total_expenses),
    operatingExpensesFallback: toFiniteNumber(row.om_operating_expenses),
    noiReported: toFiniteNumber(row.om_noi),
    rentRoll: Array.isArray(row.rent_roll) ? (row.rent_roll as Array<Record<string, unknown>>) : [],
    expenseLines: Array.isArray(row.expenses_table) ? (row.expenses_table as Array<Record<string, unknown>>) : [],
  });
}

/** Subject typeahead: prefer rows that actually carry OM operating data. */
router.get("/market-comps/subjects", async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const pool = getPool();
    const result = await pool.query(
      `SELECT p.id, p.canonical_address,
              COALESCE(
                p.details#>>'{neighborhood,primary,name}',
                p.details#>>'{omData,authoritative,propertyInfo,neighborhood}'
              ) AS neighborhood,
              (p.details#>>'{omData,authoritative,currentFinancials,noi}') IS NOT NULL AS has_om,
              p.created_at
       FROM properties p
       WHERE ($1 = '' OR LOWER(p.canonical_address) LIKE '%' || $1 || '%')
       ORDER BY ((p.details#>>'{omData,authoritative,currentFinancials,noi}') IS NOT NULL) DESC, p.created_at DESC
       LIMIT 25`,
      [q]
    );
    res.json({
      subjects: result.rows.map((row) => ({
        propertyId: String(row.id),
        address: String(row.canonical_address),
        neighborhood: (row.neighborhood as string | null) ?? null,
        hasOmData: Boolean(row.has_om),
      })),
    });
  } catch (err) {
    console.error("[market-comps subjects]", err);
    res.status(500).json({ error: "Failed to load subjects.", details: err instanceof Error ? err.message : String(err) });
  }
});

interface MetricDescriptor {
  key: string;
  label: string;
  format: "currency" | "currency2" | "percent" | "number";
  pick: (row: OperatingMetricsRow) => number | null;
}

const METRICS: MetricDescriptor[] = [
  { key: "occupancyPct", label: "Occupancy", format: "percent", pick: (row) => row.occupancyPct },
  { key: "revenuePerUnit", label: "Revenue / Unit", format: "currency", pick: (row) => row.revenuePerUnit },
  { key: "revenuePsf", label: "Revenue PSF", format: "currency2", pick: (row) => row.revenuePsf },
  { key: "expensePerUnit", label: "Op Exp / Unit", format: "currency", pick: (row) => row.expensePerUnit },
  { key: "expensePsf", label: "Exp PSF", format: "currency2", pick: (row) => row.expensePsf },
  { key: "expenseRatioPct", label: "Expense Ratio", format: "percent", pick: (row) => row.expenseRatioPct },
  { key: "noiPerUnit", label: "NOI / Unit", format: "currency", pick: (row) => row.noiPerUnit },
  { key: "noiPsf", label: "NOI PSF", format: "currency2", pick: (row) => row.noiPsf },
  { key: "noiMarginPct", label: "NOI Margin", format: "percent", pick: (row) => row.noiMarginPct },
  { key: "avgMonthlyRentPerUnit", label: "Avg Rent / Unit (Mo)", format: "currency", pick: (row) => row.avgMonthlyRentPerUnit },
  { key: "capRatePct", label: "Cap Rate (YoC)", format: "percent", pick: (row) => row.capRatePct },
  { key: "pricePerUnit", label: "Price / Unit", format: "currency", pick: (row) => row.pricePerUnit },
  { key: "pricePsf", label: "Price PSF", format: "currency", pick: (row) => row.pricePsf },
];

type CompSetKey = "submarket" | "borough" | "nyc";

router.get("/market-comps/analysis", async (req: Request, res: Response) => {
  try {
    const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : "";
    if (!propertyId) {
      res.status(400).json({ error: "propertyId is required." });
      return;
    }
    const vintageMin = toFiniteNumber(req.query.vintageMin);
    const vintageMax = toFiniteNumber(req.query.vintageMax);
    const unitsMin = toFiniteNumber(req.query.unitsMin);
    const unitsMax = toFiniteNumber(req.query.unitsMax);

    const pool = getPool();
    const result = await pool.query(
      `${PROPERTY_SELECT}
       WHERE ds.asset_cap_rate IS NOT NULL
          OR p.details#>>'{omData,authoritative,currentFinancials,noi}' IS NOT NULL
          OR p.details#>>'{omData,authoritative,income,effectiveGrossIncome}' IS NOT NULL
          OR p.id = $1
       LIMIT 1500`,
      [propertyId]
    );

    const allRows = result.rows.map(rowToMetrics);
    const subject = allRows.find((row) => row.propertyId === propertyId);
    if (!subject) {
      res.status(404).json({ error: "Subject property not found." });
      return;
    }

    // Canonicalize neighborhoods through the market layer's alias map so the
    // "Same Submarket" set survives StreetEasy/OM/publisher label variants.
    try {
      const hoods = await new NeighborhoodRepo({ pool }).listAll();
      if (hoods.length > 0) {
        const index = buildNeighborhoodIndex(hoods);
        const nameById = new Map(hoods.map((hood) => [hood.id, hood.name]));
        for (const row of allRows) {
          if (!row.neighborhoodRaw) continue;
          const id = resolveNeighborhoodId(row.neighborhoodRaw, index);
          row.neighborhoodKey = id ?? normalizeNeighborhoodName(row.neighborhoodRaw);
          row.neighborhoodName = (id ? nameById.get(id) : null) ?? row.neighborhoodRaw;
        }
      } else {
        for (const row of allRows) {
          row.neighborhoodKey = row.neighborhoodRaw ? normalizeNeighborhoodName(row.neighborhoodRaw) : null;
        }
      }
    } catch {
      for (const row of allRows) {
        row.neighborhoodKey = row.neighborhoodRaw ? normalizeNeighborhoodName(row.neighborhoodRaw) : null;
      }
    }

    const peers = allRows.filter((row) => {
      if (row.propertyId === subject.propertyId) return false;
      if (vintageMin != null && (row.yearBuilt == null || row.yearBuilt < vintageMin)) return false;
      if (vintageMax != null && (row.yearBuilt == null || row.yearBuilt > vintageMax)) return false;
      if (unitsMin != null && (row.units == null || row.units < unitsMin)) return false;
      if (unitsMax != null && (row.units == null || row.units > unitsMax)) return false;
      return true;
    });

    const sets: Record<CompSetKey, OperatingMetricsRow[]> = {
      submarket: peers.filter(
        (row) => subject.neighborhoodKey != null && row.neighborhoodKey === subject.neighborhoodKey
      ),
      borough: peers.filter(
        (row) =>
          subject.borough != null && (row.borough ?? "").toLowerCase() === subject.borough.toLowerCase()
      ),
      nyc: peers,
    };

    const setMeta = (key: CompSetKey, label: string) => ({
      key,
      label,
      propertyCount: sets[key].length,
      unitCount: sets[key].reduce((sum, row) => sum + (row.units ?? 0), 0),
    });

    const metrics = METRICS.map((descriptor) => {
      const subjectValue = descriptor.pick(subject);
      const bySet = {} as Record<CompSetKey, MetricStat>;
      for (const key of ["submarket", "borough", "nyc"] as CompSetKey[]) {
        bySet[key] = aggregateMetric(sets[key].map(descriptor.pick), subjectValue);
      }
      return {
        key: descriptor.key,
        label: descriptor.label,
        format: descriptor.format,
        subject: subjectValue,
        sets: bySet,
      };
    });

    // Rent by unit type: pool each set's per-property bucket medians.
    const unitTypeKeys: UnitTypeKey[] = ["studio", "br1", "br2", "br3plus"];
    const rentByUnitType = unitTypeKeys
      .map((unitType) => {
        const subjectBucket = subject.rentByUnitType[unitType] ?? null;
        const bySet = {} as Record<CompSetKey, MetricStat & { rentPsfMedian: number | null }>;
        for (const key of ["submarket", "borough", "nyc"] as CompSetKey[]) {
          const rents = sets[key].map((row) => row.rentByUnitType[unitType]?.monthlyRent ?? null);
          const psfs = sets[key]
            .map((row) => row.rentByUnitType[unitType]?.rentPsf ?? null)
            .filter((value): value is number => value != null)
            .sort((a, b) => a - b);
          bySet[key] = {
            ...aggregateMetric(rents, subjectBucket?.monthlyRent ?? null),
            rentPsfMedian: psfs.length > 0 ? psfs[Math.floor((psfs.length - 1) / 2)] : null,
          };
        }
        const hasAny =
          subjectBucket != null || (Object.values(bySet) as MetricStat[]).some((stat) => stat.count > 0);
        return hasAny
          ? {
              unitType,
              label: UNIT_TYPE_LABELS[unitType],
              subjectMonthlyRent: subjectBucket?.monthlyRent ?? null,
              subjectRentPsf: subjectBucket?.rentPsf ?? null,
              subjectUnitCount: subjectBucket?.unitCount ?? 0,
              sets: bySet,
            }
          : null;
      })
      .filter((row): row is NonNullable<typeof row> => row != null);

    // Expense categories, normalized per unit so buildings of different size compare.
    const categoryKeys = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategoryKey[];
    const expenseCategories = categoryKeys
      .map((category) => {
        const perUnitOf = (row: OperatingMetricsRow) => {
          const amount = row.expenseByCategory[category];
          return amount != null && row.units != null && row.units > 0 ? amount / row.units : null;
        };
        const subjectPerUnit = perUnitOf(subject);
        const bySet = {} as Record<CompSetKey, MetricStat>;
        for (const key of ["submarket", "borough", "nyc"] as CompSetKey[]) {
          bySet[key] = aggregateMetric(sets[key].map(perUnitOf), subjectPerUnit);
        }
        const hasAny = subjectPerUnit != null || (Object.values(bySet) as MetricStat[]).some((stat) => stat.count > 0);
        return hasAny
          ? { category, label: EXPENSE_CATEGORY_LABELS[category], subjectPerUnit, sets: bySet }
          : null;
      })
      .filter((row): row is NonNullable<typeof row> => row != null);

    // Closed-sale market evidence from ingested research/broker comps.
    const marketCompsResult = await pool.query(
      `SELECT neighborhood_id, neighborhood_raw, borough, price_psf, cap_rate, price_type
       FROM market_comps
       WHERE (price_psf IS NOT NULL AND price_psf > 0) OR (cap_rate IS NOT NULL AND cap_rate > 0)`
    );
    const evidenceRows = marketCompsResult.rows.map((row) => ({
      neighborhoodKey:
        (row.neighborhood_id as string | null) ??
        (row.neighborhood_raw ? normalizeNeighborhoodName(String(row.neighborhood_raw)) : null),
      borough: titleCaseBorough((row.borough as string | null) ?? null) ?? "Manhattan",
      pricePsf: toFiniteNumber(row.price_psf),
      // market_comps.cap_rate stores decimals (0.0582 = 5.82%).
      capRatePct: toFiniteNumber(row.cap_rate) != null ? (toFiniteNumber(row.cap_rate) as number) * 100 : null,
      closed: row.price_type === "closed",
    }));
    const evidenceSets: Record<CompSetKey, typeof evidenceRows> = {
      submarket: evidenceRows.filter(
        (row) => subject.neighborhoodKey != null && row.neighborhoodKey === subject.neighborhoodKey
      ),
      borough: evidenceRows.filter(
        (row) => subject.borough != null && row.borough.toLowerCase() === subject.borough.toLowerCase()
      ),
      nyc: evidenceRows,
    };
    const marketEvidence = (["submarket", "borough", "nyc"] as CompSetKey[]).map((key) => {
      const rows = evidenceSets[key];
      const closed = rows.filter((row) => row.closed);
      return {
        set: key,
        compCount: rows.length,
        closedCount: closed.length,
        pricePsf: aggregateMetric(rows.map((row) => row.pricePsf), subject.pricePsf),
        closedPricePsf: aggregateMetric(closed.map((row) => row.pricePsf), subject.pricePsf),
        capRatePct: aggregateMetric(rows.map((row) => row.capRatePct), subject.capRatePct),
        closedCapRatePct: aggregateMetric(closed.map((row) => row.capRatePct), subject.capRatePct),
      };
    });

    res.json({
      subject: {
        propertyId: subject.propertyId,
        address: subject.address,
        neighborhood: subject.neighborhoodName,
        borough: subject.borough,
        units: subject.units,
        gsf: subject.gsf,
        yearBuilt: subject.yearBuilt,
        propertyType: subject.propertyType,
        askingPrice: subject.askingPrice,
        hasOmData: subject.revenue != null || subject.noi != null,
      },
      compSets: [
        setMeta("submarket", subject.neighborhoodName ? `Same Submarket · ${subject.neighborhoodName}` : "Same Submarket"),
        setMeta("borough", subject.borough ? `${subject.borough}` : "Same Borough"),
        setMeta("nyc", "All NYC Deals"),
      ],
      metrics,
      rentByUnitType,
      expenseCategories,
      marketEvidence,
      peerRows: peers.slice(0, 300).map((row) => ({
        propertyId: row.propertyId,
        address: row.address,
        neighborhood: row.neighborhoodName,
        borough: row.borough,
        units: row.units,
        yearBuilt: row.yearBuilt,
        occupancyPct: row.occupancyPct,
        revenuePerUnit: row.revenuePerUnit,
        expensePerUnit: row.expensePerUnit,
        noiPerUnit: row.noiPerUnit,
        capRatePct: row.capRatePct,
        pricePsf: row.pricePsf,
        inSubmarket: subject.neighborhoodKey != null && row.neighborhoodKey === subject.neighborhoodKey,
      })),
      filters: { vintageMin, vintageMax, unitsMin, unitsMax },
    });
  } catch (err) {
    console.error("[market-comps analysis]", err);
    res.status(500).json({ error: "Failed to build market comp analysis.", details: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
