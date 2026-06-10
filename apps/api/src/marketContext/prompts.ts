/**
 * Prompt templates for the market-context ingest pipeline (classify → extract
 * → synthesize). Raw model output is persisted per stage keyed by
 * document_id + prompt version so the corpus can be re-derived when these
 * templates improve — bump the matching version on every edit.
 */

export const MARKET_PROMPT_VERSIONS = {
  classify: "classify_v1",
  extract: "extract_v1",
  synthesize: "synthesize_v1",
  knowledge: "knowledge_v1",
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
  "subject_property": string | null,
  "classifier_confidence": "high" | "medium" | "low",
  "evidence": [string]
}
"period_covered" examples: "Q1 2026", "Jan–Feb 2026". "geo_scope" examples: "Manhattan south of 96th St", "NYC".
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
  "units_total": 6,
  "units_resi": 5,
  "pct_rent_stabilized": 0.0,              // fraction 0..1; null if not stated
  "cap_rate": 0.0582,                      // decimal; null if "N/A" — NEVER inferred
  "asset_type": "mixed-use",               // multifamily | mixed-use | office | retail | development | conversion | null
  "notes_short": "5-story elevator bldg, all FM, renovated, ground-fl retail",
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
  "segment": "free_market_incl_421a",      // regulatory/asset segment if stated; null otherwise
  "period": "trailing_6mo",                // honor footnotes — see rule 4
  "page": 7                                // source page number
}`;

export const EXTRACTION_PROMPT = `You are extracting structured real-estate data from a {document_class} PDF
({source_type}). Output ONLY valid JSON: {"comps": [...], "market_stats": [...]}
matching the schemas provided.

HARD RULES:
1. EXTRACT, never infer. If a cap rate prints "N/A", output null. Never compute,
   estimate, or back into any metric not printed in the document.
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
