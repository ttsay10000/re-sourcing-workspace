/**
 * Prompt templates for the market-context ingest pipeline (classify → extract
 * → synthesize). Raw model output is persisted per stage keyed by
 * document_id + prompt version so the corpus can be re-derived when these
 * templates improve — bump the matching version on every edit.
 */

export const MARKET_PROMPT_VERSIONS = {
  classify: "classify_v2",
  extract: "extract_read_v3",
  extractRefine: "extract_refine_v3",
  synthesize: "synthesize_v1",
  knowledge: "knowledge_v2",
  notesRead: "notes_read_v2",
  notesRefine: "notes_refine_v2",
  review: "review_v2",
} as const;

export const CLASSIFIER_PROMPT = `You are classifying a real-estate PDF for a comp database. Output ONLY valid JSON:
{
  "source_type": "broker_provided" | "market_research",
  "publisher": string | null,
  "branded": boolean,
  "document_class": "published_report" | "om" | "bov" | "comp_list" | "email" | "unknown",
  "report_title": string | null,
  "period_covered": string | null,
  "geo_scope": string | null,
  "coverage_universe": string | null,
  "subject_property": string | null,
  "classifier_confidence": "high" | "medium" | "low",
  "evidence": [string]
}
"period_covered" examples: "Q1 2026", "Jan–Feb 2026". "geo_scope" examples: "Manhattan south of 96th St", "NYC".
"coverage_universe" is the publisher's stated methodology/universe, verbatim or tightly paraphrased —
price floor, unit minimum, asset types, geography ("sales $1M+ in 5+ unit buildings, all Manhattan",
"investment sales ≥$5M south of 96th St"). Check methodology footnotes and disclaimers; null when not stated.
This is how conflicting publisher aggregates get reconciled downstream — never skip it when printed.
"subject_property" is the address if the document centers on one deal. "evidence" lists verbatim cues you relied on.

DECISION RULES — apply in order:
1. \`market_research\` requires BOTH of the following:
   (a) PUBLICATION FRAMING — at least two of: a report-series title
       ("Market Trends", "Quarter In Review", "Property Sales Report",
       "Investment Forecast"), a release cadence/date line ("Released April 2026"),
       a methodology section, research/analyst contact pages, firm name repeated in
       running headers/footers, copyright + market-data disclaimer boilerplate.
   (b) MARKET BREADTH — many properties across different owners and neighborhoods,
       aggregate market statistics, and NO single subject property being sold.
   If both hold → source_type = market_research, set publisher from branding.
2. Branding ≠ research. If the document is branded but centers on one subject
   property, an asking price, "Offering Memorandum", "Confidential", a rent roll,
   pro-forma, or a comp table assembled to support one deal → broker_provided,
   document_class = om or bov, publisher = the firm (branded = true).
3. A bare/unbranded table of sales with no publication framing →
   broker_provided, document_class = comp_list, publisher = null, branded = false.
4. Email bodies or forwarded broker blasts → broker_provided, document_class = email.
5. When uncertain, DEFAULT to broker_provided (most uploads are), set
   classifier_confidence accordingly, and list what was ambiguous in evidence.

Known research publishers (seed list, extensible): Avison Young, Ariel Property
Advisors, Alpha Realty, Marcus & Millichap, CBRE, JLL, Cushman & Wakefield,
Newmark, B6, Rosewood, Compass (research division). Recognizing a name on this
list satisfies branding only — rules 1–2 still decide source_type.`;

/** Comp + market-stat field schemas given to the extractor. provenance is injected by code afterward. */
const EXTRACTION_SCHEMAS = `COMP SCHEMA (array "comps"):
{
  "address": "242 Elizabeth Street",
  "neighborhood_raw": "Nolita",            // verbatim from the document; null if absent
  "borough": "Manhattan",                  // null if not stated
  "sale_price": 11750000,
  "price_type": "closed",                  // closed | asking | in_contract | unknown
  "sale_date": "2026-01-26",               // ISO date or null
  "gsf": 7667,
  "price_psf": 1533,
  "price_per_unit": 1958333,
  "units_total": 6,
  "units_resi": 5,
  "pct_rent_stabilized": 0.0,              // fraction 0..1; null if not stated
  "noi": 684250,                           // NOI exactly as printed; null if absent — NEVER inferred
  "cap_rate": 0.0582,                      // decimal; null if "N/A" — NEVER inferred
  "grm": 14.2,                             // gross rent multiplier as printed; null if absent — NEVER derived
  "asset_type": "mixed-use",               // multifamily | mixed-use | office | retail | development | conversion | null
  "buyer": "Acme Property Group LLC",      // purchaser exactly as printed; null if not stated
  "seller": "Estate of J. Smith",          // seller exactly as printed; null if not stated
  "sale_conditions": ["estate_sale"],      // ONLY when printed/footnoted, from: portfolio_sale |
                                           // partial_interest | note_sale | ground_lease | distressed |
                                           // estate_sale | delivered_vacant | 1031_exchange | related_party
  "notes_short": "5-story FM walk-up, gut renovated 2023, ground-fl retail",
  "cherry_pick_risk": false,               // true for comp tables inside OMs/BOVs
  "is_subject_property": false,            // true for the OM's own asset
  "confidence": "high",                    // high | medium | low
  "raw_text": null,                        // copy the source cell text when confidence = low
  "page": 4                                // source page number
}

MARKET STAT SCHEMA (array "market_stats"):
{
  "metric": "avg_price_psf",
  "metric_type": "level",                  // level | pct_change
  "value": 986,
  "comparison_period": null,               // e.g. "QoQ vs Q4 2025" when pct_change
  "geo_level": "submarket",                // address | neighborhood | submarket | borough | citywide
  "geo_name": "Manhattan below 96th St",   // verbatim scope
  "segment": "free_market_units_5_9",      // regulatory + size segment if stated; null otherwise — see rule 11
  "period": "trailing_6mo",                // honor footnotes — see rule 4
  "page": 7                                // source page number
}

METRIC NAMES — reuse these exact names so the same series matches across quarters
(invent a snake_case name in this style only for a metric not listed):
  avg_price_psf, median_price_psf, avg_price_per_unit, median_price_per_unit,
  avg_cap_rate, median_cap_rate, avg_grm, median_grm,
  dollar_volume, transaction_count, building_count, avg_deal_size,
  contract_volume, contract_count, listing_inventory, months_of_supply,
  avg_days_on_market, avg_price_discount

SEGMENT NAMES — snake_case, combining regulatory + size/price bucket exactly as the
report slices it: free_market, rent_stabilized, mixed_rs, units_5_9, units_10_25,
units_26_plus, under_5m, 5m_to_20m, over_20m, walk_up, elevator —
combined with "_" when the report crosses them ("free_market_units_5_9").`;

export const EXTRACTION_PROMPT = `You are extracting structured real-estate data from a {document_class} PDF
({source_type}) for a NYC multifamily acquisitions team. Output ONLY valid JSON:
{"comps": [...], "market_stats": [...]} matching the schemas provided.

HARD RULES:
1. EXTRACT, never infer. If a cap rate prints "N/A", output null. Never compute,
   estimate, or back into any metric not printed in the document. NOI and $/unit
   are printed or null — never derived. GRM is printed or null — never derived
   from price and rent, and never converted to/from cap rate.
2. Record the geographic scope of every aggregate stat exactly as stated.
   "Manhattan below 96th Street" ≠ "Manhattan". Ariel splits Northern Manhattan
   separately; Avison Young tracks south of 96th only; Alpha covers all Manhattan.
3. Percent changes are not levels. Store QoQ/YoY figures as metric_type
   "pct_change" with comparison_period. Never store a % change as a price level.
4. Footnotes change meaning. Pricing footnoted "trailing 6-month data due to low
   sales activity" must carry period = "trailing_6mo". Asterisked methodology
   notes apply to the figures they mark.
5. Record regulatory composition (% RS/RC, FM unit counts) whenever present.
6. Capture neighborhood names verbatim in neighborhood_raw. Do not normalize.
7. Every record carries the source page number.
8. price_type: closed sales reports → "closed". In broker_provided documents,
   asking/whisper/guidance prices → "asking"; do not mark them closed.
9. In OMs/BOVs: extract the subject property as one record with
   is_subject_property = true; extract their "comparable sales" tables as comps
   with cherry_pick_risk = true.
10. If a cell is ambiguous or illegible, set confidence = "low" and copy the raw
    text into raw_text. Do not guess.
11. SEGMENTED TABLES ARE THE POINT. When a report slices a metric by building
    size, price band, regulatory status, or building type (walk-up vs elevator),
    emit one stat PER SLICE with the segment named — never just the all-market
    line. A "5-9 unit buildings: $720/SF" row is worth more to this team than
    the borough average.
12. Buyer and seller names: copy exactly as printed (entity names included).
    These drive who-is-buying analysis — capture them on every comp that
    prints them, null otherwise. Never guess an entity's type or identity.
13. sale_conditions: tag ONLY conditions the document states or footnotes
    (portfolio/bulk sale, partial interest, note/loan sale, ground lease,
    distressed/REO/foreclosure → distressed, estate sale, delivered vacant,
    1031 buyer, related-party/insider). These flags keep non-comparable prints
    out of neighborhood medians — missing one corrupts the median.
14. notes_short is the analyst's one-line read of the building: stories +
    walk-up/elevator, FM vs RS mix, renovation/vacancy state, retail component,
    anything price-explaining ("estate condition", "delivered vacant", "air rights").

${EXTRACTION_SCHEMAS}`;

export const EXTRACTION_REFINE_PROMPT = `You are the senior NYC multifamily acquisitions analyst reviewing a source-faithful
market-document extraction. You receive: (1) the document classification, (2) the
first-pass extraction JSON from the document reader, and (3) any extracted page
text. Produce the final structured extraction for the database. Output ONLY valid
JSON: {"comps": [...], "market_stats": [...]} matching the exact schemas below.

REVIEW RULES:
1. Preserve source fidelity. Do not invent values absent from the first-pass
   extraction or document text. If a printed value is missing/ambiguous, set null
   and lower confidence.
2. Improve labels and completeness: normalize field names into the schema, add
   material comp/stat rows that the first pass clearly missed, dedupe duplicated
   rows, and keep source page numbers.
3. The analyst lens matters: preserve sub-10-unit, free-market vs stabilized,
   walk-up/elevator, buyer/seller, GRM, cap rate, $/SF, and sale-condition fields
   because these feed acquisitions screening.
4. Respect publisher scope and period exactly. Never blend or average across
   geographies, periods, brokerages, or coverage universes.
5. OM/BOV subject assets are asking rows; their internal comp tables are
   cherry-picked unless corroborated later by research.

${EXTRACTION_SCHEMAS}`;

export const SYNTHESIS_PROMPT = `Write the popup content for one neighborhood from the supplied computed stats and
comp records. Output ONLY JSON: {"bullets": [...], "regulatory_skew": string}.

RULES:
1. Max 3 bullets, ≤120 characters each, every claim traceable to supplied records.
2. No adjectives without numbers. "Tight pricing" is invalid; "$1,445–$1,562/SF
   across 4 trades" is valid.
3. Explain pricing with regulatory mix where relevant — a low $/SF driven by RS
   exposure is not "cheap"; a low cap with prime corner retail is not the
   neighborhood norm.
4. If broker-provided comps are in the mix, note it only when they move the
   numbers. Never present an asking price as a sale.
5. Do not invent trends across publishers' aggregates. Cite a publisher by name
   when referencing an aggregate stat.`;

/** Fills the {document_class} / {source_type} slots of EXTRACTION_PROMPT. */
export function buildExtractionPrompt(params: { documentClass: string; sourceType: string }): string {
  return EXTRACTION_PROMPT.replace("{document_class}", params.documentClass).replace(
    "{source_type}",
    params.sourceType
  );
}

/** Shared JSON schema for both notes stages (read + refine). */
const NOTES_SCHEMA = `OUTPUT SCHEMA (exact keys, no extras; every list may be empty but must be present):
{
  "title": string,                          // report title, else the filename
  "period_covered": string | null,          // e.g. "Q1 2026"
  "overview": [string],                     // 2-5 bullets: the report in numbers
  "neighborhoods": [{ "name": string, "takeaway": string }],
  "asset_types": [{ "segment": string, "direction": "up" | "down" | "flat" | "mixed", "note": string }],
  "buyer_activity": [string],
  "notable_transactions": [string],         // "address — $price, cap X%, $Y/SF, N units, buyer: Z (page P)"
  "cap_rate_psf": [string],
  "financing": [string],
  "small_building_focus": [string],
  "regulatory": [string],
  "risks_watch_items": [string],
  "investment_relevance": [string]
}`;

/**
 * Notes stage 1 (Gemini, native PDF read): exhaustive analyst notes — what a
 * NYC multifamily acquisitions VP would highlight in this document.
 */
export const NOTES_READ_PROMPT = `You are a VP of acquisitions at a NYC multifamily investment firm reading a market
document (research report, OM, BOV, or comp list) cover to cover. The firm buys
free-market buildings under 10 units, roughly $1-20M, mostly Manhattan. Write the
deal-team notes: everything that changes where you hunt or what you underwrite.
Output ONLY valid JSON.

CAPTURE — be thorough, with numbers and verbatim geographies on every line:
1. NEIGHBORHOODS: every submarket/neighborhood the document covers, each with its
   key figures ($/SF, cap rate, GRM, volume, txn count) and printed change (QoQ/YoY).
   Capture RELATIVE VALUE whenever the report ranks or spreads neighborhoods
   ("East Village trades 18% under West Village $/SF") — spreads are how a VP
   spots mispricing.
2. ASSET TYPES rising or falling: multifamily vs mixed-use vs office/retail;
   walk-up vs elevator; small private-market buildings vs institutional product;
   size and price-band breakdowns (5-9 units vs 10-25; under $5M vs $5-20M).
   Direction must come from printed figures, not your judgment.
3. BUYING / SELLING ACTIVITY: institutional share of volume and its trend, named
   active buyers/sellers and what they bought, private/family-office/1031/foreign
   capital shifts, contract pipelines, seller motivation and distress signals
   (estate sales, note sales, lender-driven dispositions).
4. NOTABLE TRANSACTIONS: individual deals with address, price, cap rate or GRM,
   $/SF, units, buyer/seller when printed, sale conditions (portfolio, partial
   interest, vacant delivery), and the source page. Prioritize sub-10-unit and
   sub-$20M trades — they are this team's comps.
5. CAP RATES, $/SF & GRM: every level and movement printed, scoped exactly as
   stated, including the FM vs RS pricing spread whenever both print (the
   FM-vs-stabilized gap is a core underwriting input).
6. FINANCING / LOAN ENVIRONMENT: rates, spreads, lender appetite, maturities
   coming due, refinancing pressure, agency vs bank vs debt-fund activity,
   anything about leverage available on small balance deals.
7. SMALL-BUILDING FOCUS: everything about sub-10-unit buildings — pricing vs the
   broader market, velocity, buyer competition, $/SF by condition (renovated vs
   estate), walk-up discounts, vacancy-at-sale premiums.
8. REGULATORY: rent stabilization share effects on pricing, 421a/485x, good-cause
   eviction, property-tax developments — with the pricing impact when printed.
9. RISKS / WATCH ITEMS + OUTLOOK: risks the document calls out AND its printed
   forward-looking views ("expect cap rates to compress in H2") — prefix
   forecasts with "Outlook:".
10. INVESTMENT RELEVANCE: 3-6 bullets on why this matters for acquiring small NYC
    free-market multifamily now — which neighborhoods/segments screen cheap or
    rich, what to underwrite differently. Written from the document's facts only.

HARD RULES:
- Extract, never infer. No number that is not printed in the document.
- Keep the publisher's exact geographic scopes ("Manhattan below 96th St" ≠ "Manhattan").
- Each bullet ≤200 characters, self-contained, and carries at least one number when
  the document provides one; name the metric's period (Q1 2026, trailing 6-mo).
- Empty array when the document is silent on a topic — never pad.

${NOTES_SCHEMA}`;

/**
 * Notes stage 2 (OpenAI refine): tighten + complete the stage-1 notes using the
 * structured extraction (comps/stats) as cross-check, same output schema.
 */
export const NOTES_REFINE_PROMPT = `You are the reviewing VP of acquisitions (small free-market NYC multifamily,
under 10 units, $1-20M). A first-pass reader produced DRAFT NOTES JSON for a
market document; you also receive the document's CLASSIFICATION (including its
coverage universe) and the STRUCTURED EXTRACTION (comps + aggregate stats)
pulled from the same file. Produce the final, improved notes. Output ONLY valid
JSON in the same schema.

IMPROVE BY:
1. Deduplicating and merging overlapping bullets; keep the most specific number.
2. Cross-checking against the structured extraction — add material comps/stats the
   draft missed (cap rates, GRM, $/SF, notable sales with addresses and buyers),
   and correct any draft figure that conflicts with the extraction.
3. Making every bullet decision-useful for a small-multifamily acquirer: lead with
   the number, scope, and period. Strip filler adjectives.
4. Surfacing the segment story: size buckets (sub-10-unit), FM vs RS spreads,
   walk-up vs elevator, price bands — promote these over all-market averages.
   Note the publisher's coverage universe when it limits what the figures mean
   (a ≥$5M universe says little about $2M walk-ups).
5. Sharpening investment_relevance into the "so what": where pricing is soft or
   compressing, which segments are over/under-bid, where sellers look motivated,
   what to underwrite differently.
6. Keeping the draft's facts otherwise — do NOT invent numbers not present in the
   draft or the extraction. Empty arrays stay empty when there is nothing real.

${NOTES_SCHEMA}`;

/**
 * Live AI market review: cross-document synthesis for the market docs page.
 * Regenerated on demand from every currently included document's notes.
 */
export const MARKET_REVIEW_PROMPT = `You are the acquisitions team's market analyst. You receive analyst notes (and key
stats) for EVERY market document currently in the workspace — multiple brokerages,
multiple periods. Write the live market review for a principal buying small NYC
multifamily (roughly 4-30 units, $1-20M, free-market and mixed RS). Output ONLY valid JSON.

PRIORITIES:
(a) headline + market_pulse: the highest-level cross-report read. Every claim carries
    a number, publisher, and period. Mark trends over time within ONE publisher's
    series ("Manhattan MF $/SF $576→$649, Q1'25→Q1'26, PropertyShark").
(b) small_multifamily_focus: smaller buildings and unit counts specifically — sub-10-unit
    pricing and velocity, walk-up vs elevator, FM vs rent-stabilized value gaps (quote
    the spread when both sides print), GRM levels, where small deals are clearing vs
    sitting, who is competing for them.
(c) cap_rate_trends: compression/expansion in bps with scopes and periods; note when
    cap and GRM series disagree about direction.
(d) buyer_seller_activity: institutional share of volume and its trend within one
    publisher's series, named active buyers and what they bought, private/1031/foreign
    capital shifts, seller motivation/distress signals (estate, note sales,
    lender-driven dispositions).
(e) loan_environment: rates, lender appetite, maturities, refi pressure — anything the
    notes carry about debt, especially small-balance lending.
(f) opportunities: where to hunt now — low or falling $/SF pockets, neighborhoods
    trading at a printed discount to their peers (relative value), segments with
    softening pricing but stable fundamentals, motivated-seller clusters.
    Every entry needs the supporting number.
(g) qoq_comparisons: for each publisher with documents covering DIFFERENT periods,
    what changed between consecutive periods (both values + delta). Same-publisher
    series only.
(h) discrepancies: where different brokerages disagree about the same market/trend —
    cite each side's number with publisher + period, and EXPLAIN via their stated
    coverage universes when supplied (e.g. "Ariel tracks 10+ units ≥$1M; AY tracks
    ≥$5M below 96th — the gap is universe, not market"). Universe-explained gaps
    still get listed, with the explanation in "note".

HARD RULES:
1. Use ONLY the supplied notes and stats. Never infer, average, or blend numbers
   across publishers (their universes differ — each document's coverage_universe
   is supplied when known; treat figures as statements about THAT universe only).
2. Bullets ≤200 characters; numbers + sources, zero filler.
3. Empty arrays where the corpus is silent — never pad.
4. sources: one "Publisher — period (title)" entry per supplied document.

OUTPUT SCHEMA (exact keys, no extras):
{
  "headline": string,
  "market_pulse": [string],
  "small_multifamily_focus": [string],
  "cap_rate_trends": [string],
  "buyer_seller_activity": [string],
  "loan_environment": [string],
  "opportunities": [string],
  "qoq_comparisons": [{ "publisher": string, "from_period": string, "to_period": string, "changes": [string] }],
  "discrepancies": [{ "topic": string, "positions": [{ "source": string, "period": string | null, "claim": string }], "note": string | null }],
  "sources": [string]
}`;

export const KNOWLEDGE_PROMPT = `You are a NYC multifamily acquisitions analyst maintaining the firm's living market
knowledge base. You receive: (1) the CURRENT KNOWLEDGE BASE, (2) THIS UPLOAD's
classification plus its extracted comps and aggregate stats, and (3) PRIOR data —
earlier stats for the same metrics/geographies and the computed neighborhood
rollups. Produce the analyst brief for THIS upload and the UPDATED knowledge base.
Output ONLY valid JSON matching the schema below.

PRIORITIES — weigh in exactly this order:
(a) Which submarkets are moving up or down, and by how much. Quote bps for cap
    rates, $/SF for pricing, % for volumes. "UWS softening" is invalid;
    "UWS caps +20bps QoQ (Avison Young, Q1 2026)" is valid.
(b) Asset types or segments getting more or less attention than usual —
    explicitly track free-market sub-9-unit buildings, rent-stabilized share
    effects on pricing, and north vs south of 96th Street divergence.
(c) What is NEW in THIS upload vs the existing knowledge base: new periods, new
    metrics, new submarkets, revisions to previously recorded figures.
(d) Discrepancies between sources, or within this upload itself. Always cite
    BOTH numbers with publisher + period ("AY Q2 puts Manhattan MF cap at 5.9%
    vs 5.6% in Q1 report — +30bps").
(e) Every claim carries a number AND a source/publisher + period — no claim
    without all three. NEVER infer, average, or back into a number that is not
    in the supplied records. Publisher universes differ (Alpha: all Manhattan;
    AY/Ariel: split at 96th St) — never blend their aggregates into one figure.

RULES:
1. Bullets and claim texts ≤120 characters. Numbers and sources, zero filler adjectives.
2. what_it_says: 3-6 bullets covering the most decision-relevant figures in this upload.
3. compared_to_prior: only same metric + geography + segment matches; show both
   values and the delta. Empty array when nothing is comparable.
4. discrepancies: explicit conflicts only, both numbers cited. Empty array when none.
5. The updated knowledge base RETAINS still-valid prior claims, REPLACES superseded
   figures (same metric + scope + publisher, newer period), and APPENDS new ones.
   Mark resolved discrepancies status "resolved"; keep open ones listed.
6. submarket_trends.direction must be justified by that scope's claims, with numbers.
7. asset_type_attention.attention is relative to what the knowledge base recorded before
   ("more" | "less" | "steady").
8. knowledge.sources lists "Publisher — period" for every report folded in so far.
9. executive_summary: 3-5 claims written for a principal deciding where to hunt
   deals this quarter — the HIGHEST-level read synthesized ACROSS every report
   folded in so far, not just this upload. Each claim marks the trend OVER TIME
   with prior→current values and periods inside ONE publisher's series
   ("Manhattan MF caps 5.6%→5.9%, Q4'25→Q1'26, Avison Young"); cross-publisher
   gaps belong in discrepancies, never in a trend claim. Order by decision
   relevance. ≤140 chars each. direction reflects the metric's trajectory.

OUTPUT SCHEMA (exact keys, no extras):
{
  "document_brief": {
    "title": string,                       // report title, else filename
    "what_it_says": [string],              // 3-6 bullets with numbers
    "compared_to_prior": [string],
    "discrepancies": [string]
  },
  "knowledge": {
    "as_of": string | null,                // latest period covered, e.g. "Q1 2026"
    "executive_summary": [{                // 3-5 cross-report, trends-over-time takeaways (rule 9)
      "text": string, "metric": string | null, "value": number | null,
      "unit": string | null, "source": string | null, "period": string | null,
      "direction": "up" | "down" | "flat" | "mixed" | null
    }],
    "submarket_trends": [{
      "scope": string,                     // verbatim geography, e.g. "Manhattan below 96th St"
      "direction": "up" | "down" | "flat" | "mixed",
      "claims": [{ "text": string, "metric": string | null, "value": number | null,
                   "unit": string | null, "source": string | null, "period": string | null }]
    }],
    "asset_type_attention": [{ "segment": string, "attention": "more" | "less" | "steady", "note": string }],
    "cap_rate_psf_movements": [{ "text": string, "metric": string | null, "value": number | null,
                                 "unit": string | null, "source": string | null, "period": string | null }],
    "discrepancies": [{ "topic": string, "detail": string, "sources": [string],
                        "status": "open" | "resolved" }],
    "sources": [string]
  }
}`;
