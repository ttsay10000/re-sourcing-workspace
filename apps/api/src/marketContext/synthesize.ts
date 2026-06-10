/**
 * Stage 2b: popup bullets. The model words ≤3 bullets from stats already
 * computed in code; output is validated (count, length) and every numeric
 * claim must come from the supplied records. When no LLM is configured or the
 * output fails validation, deterministic numbers-only bullets are used so the
 * popup never blocks on a model.
 */
import type { MarketComp } from "@re-sourcing/contracts";
import { MARKET_PROMPT_VERSIONS, SYNTHESIS_PROMPT } from "./prompts.js";
import type { MarketLlmResult, MarketLlmRunner } from "./llmAdapter.js";
import { effectiveSourceType, type NeighborhoodRollupDraft } from "./rollup.js";

const MAX_BULLETS = 3;
const MAX_BULLET_CHARS = 120;

export interface SynthesisOutput {
  bullets: string[];
  regulatorySkew: string | null;
}

export function validateSynthesisOutput(parsed: Record<string, unknown> | null): SynthesisOutput | null {
  if (!parsed) return null;
  const rawBullets = Array.isArray(parsed.bullets) ? parsed.bullets : null;
  if (!rawBullets) return null;
  const bullets = rawBullets
    .filter((bullet): bullet is string => typeof bullet === "string")
    .map((bullet) => bullet.trim())
    .filter((bullet) => bullet.length > 0 && bullet.length <= MAX_BULLET_CHARS)
    .slice(0, MAX_BULLETS);
  if (bullets.length === 0) return null;
  const regulatorySkew =
    typeof parsed.regulatory_skew === "string" && parsed.regulatory_skew.trim()
      ? parsed.regulatory_skew.trim()
      : null;
  return { bullets, regulatorySkew };
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function psf(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}/SF`;
}

/** Numbers-only bullets straight from the computed rollup (no model). */
export function deterministicBullets(draft: NeighborhoodRollupDraft): string[] {
  const bullets: string[] = [];
  if (draft.medianCapRate != null) {
    const range = draft.capRateRange;
    bullets.push(
      `Median cap ${pct(draft.medianCapRate)} across ${draft.compCount12mo} closed trades` +
        (range ? ` (${pct(range[0])}–${pct(range[1])})` : "")
    );
  }
  if (draft.medianPsf != null) {
    const range = draft.psfRange;
    bullets.push(
      range
        ? `${psf(range[0])}–${psf(range[1])} across ${draft.compCount12mo} trades, median ${psf(draft.medianPsf)}`
        : `Median ${psf(draft.medianPsf)} across ${draft.compCount12mo} trades`
    );
  }
  if (draft.regulatorySkew && bullets.length < MAX_BULLETS) {
    bullets.push(`${draft.compCount12mo} comps skew ${draft.regulatorySkew}; ${draft.nResearch} research / ${draft.nBroker} broker sourced`);
  }
  if (bullets.length === 0 && draft.fallbackContext) {
    bullets.push(draft.fallbackContext.slice(0, MAX_BULLET_CHARS));
  }
  return bullets.slice(0, MAX_BULLETS);
}

function compForPrompt(comp: MarketComp) {
  return {
    address: comp.address,
    sale_price: comp.salePrice,
    price_type: comp.priceType,
    sale_date: comp.saleDate,
    price_psf: comp.pricePsf,
    cap_rate: comp.capRate,
    units_total: comp.unitsTotal,
    pct_rent_stabilized: comp.pctRentStabilized,
    asset_type: comp.assetType,
    notes_short: comp.notesShort,
    cherry_pick_risk: comp.cherryPickRisk,
    is_subject_property: comp.isSubjectProperty,
    source_type: effectiveSourceType(comp),
    publisher: comp.provenance.publisher,
  };
}

export function buildSynthesisInput(draft: NeighborhoodRollupDraft): string {
  return JSON.stringify(
    {
      neighborhood_id: draft.neighborhoodId,
      computed_stats: {
        comp_count_12mo: draft.compCount12mo,
        n_research: draft.nResearch,
        n_broker: draft.nBroker,
        n_cherry_pick_excluded: draft.nCherryPickExcluded,
        n_asking_excluded: draft.nAskingExcluded,
        median_cap_rate: draft.medianCapRate,
        cap_rate_range: draft.capRateRange,
        median_psf: draft.medianPsf,
        psf_range: draft.psfRange,
        regulatory_skew: draft.regulatorySkew,
        fallback_context: draft.fallbackContext,
        data_freshness: draft.dataFreshness,
      },
      included_comps: draft.includedComps.map(compForPrompt),
      excluded_comps: draft.excludedComps.map(compForPrompt),
    },
    null,
    2
  );
}

export interface SynthesizeNeighborhoodResult {
  bullets: string[];
  regulatorySkew: string | null;
  llm: MarketLlmResult | null;
  promptVersion: string;
}

export async function synthesizeNeighborhood(params: {
  draft: NeighborhoodRollupDraft;
  llm: MarketLlmRunner | null;
}): Promise<SynthesizeNeighborhoodResult> {
  const promptVersion = MARKET_PROMPT_VERSIONS.synthesize;
  if (params.llm) {
    const llm = await params.llm({
      stage: "synthesize",
      prompt: `${SYNTHESIS_PROMPT}\n\nSUPPLIED RECORDS:\n${buildSynthesisInput(params.draft)}`,
    });
    const validated = validateSynthesisOutput(llm.parsed);
    if (validated) {
      return {
        bullets: validated.bullets,
        regulatorySkew: validated.regulatorySkew ?? params.draft.regulatorySkew,
        llm,
        promptVersion,
      };
    }
    return {
      bullets: deterministicBullets(params.draft),
      regulatorySkew: params.draft.regulatorySkew,
      llm,
      promptVersion,
    };
  }
  return {
    bullets: deterministicBullets(params.draft),
    regulatorySkew: params.draft.regulatorySkew,
    llm: null,
    promptVersion,
  };
}
